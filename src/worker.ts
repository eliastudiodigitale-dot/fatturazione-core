import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { Config, Tipo } from './config.js';
import { LOCK_CLICKUP } from './db.js';
import { chiaveDocumento, ErroreClickUp, type ClickUpApi, type NuovaTask } from './clickup.js';
import { aggiornaTask, cambiaStato, type Documento } from './documenti.js';
import type { Notificatore } from './notifiche.js';

export const FONTI_INTERNE = ['clickup', 'dashboard'];
export const FONTI_ESTERNE = ['stripe', 'gocardless'];

export interface DepsWorker {
  pool: pg.Pool;
  api: ClickUpApi;
  cfg: NonNullable<Config['clickup']>;
  log: FastifyBaseLogger;
  notif: Notificatore;
}

/** Esegue `fn` solo se nessun altro worker/riconciliazione sta lavorando su ClickUp. Il lock cade con la connessione. */
export async function conLockClickUp<T>(pool: pg.Pool, fn: () => Promise<T>): Promise<T | 'occupato'> {
  const c = await pool.connect();
  let preso = false;
  try {
    preso = Boolean((await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_CLICKUP])).rows[0]?.ok);
    if (!preso) return 'occupato';
    return await fn();
  } finally {
    if (preso) await c.query('SELECT pg_advisory_unlock($1)', [LOCK_CLICKUP]).catch(() => undefined);
    c.release();
  }
}

function listaPer(d: Documento, cfg: DepsWorker['cfg']): string {
  const daFonte = (d.payload.dati_fonte as { clickup?: { list_id_documenti?: string } } | undefined)?.clickup?.list_id_documenti;
  return daFonte ?? cfg.listId[d.tipo];
}

function euro(n: number) {
  return n.toFixed(2).replace('.', ',');
}

export function taskDaDocumento(d: Documento, cfg: DepsWorker['cfg']): NuovaTask {
  const etichetta: Record<Tipo, string> = { fattura: 'Fattura', proforma: 'Proforma' };
  const totale = d.payload.righe.reduce((s, r) => s + r.importo, 0);
  const cliente = d.payload.cliente as { nome?: unknown; ragione_sociale?: unknown };
  const nomeCliente = String(cliente.ragione_sociale ?? cliente.nome ?? '');
  const descrizione = [
    `**${etichetta[d.tipo]} ${d.numero}/${d.anno}** del ${new Date(d.data_riserva).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}`,
    nomeCliente ? `Cliente: ${nomeCliente}` : '',
    '',
    ...d.payload.righe.map((r) => `- ${r.descrizione}: € ${euro(r.importo)}`),
    '',
    `Totale: € ${euro(totale)}`,
    `Rif.: ${d.ref}`,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '');
  const campi: NuovaTask['campi'] = [{ id: cfg.campi.chiave, value: chiaveDocumento(d.tipo, d.anno, d.numero) }];
  if (cfg.campi.numero) campi.push({ id: cfg.campi.numero, value: d.numero });
  if (cfg.campi.business && d.business) campi.push({ id: cfg.campi.business, value: d.business });
  if (cfg.campi.rata && d.payload.rata) campi.push({ id: cfg.campi.rata, value: d.payload.rata });
  return { nome: `${etichetta[d.tipo]} ${d.numero}/${d.anno}${nomeCliente ? ` - ${nomeCliente}` : ''}`, descrizione: descrizione.join('\n'), campi };
}

/**
 * Trova o crea la task del documento (mai doppioni: prima si cerca per chiave) e la collega al progetto.
 * Restituisce l'id della task, oppure undefined se ci sono doppioni (si segnala e non si tocca nulla).
 */
export async function assicuraTask(deps: DepsWorker, d: Documento): Promise<string | undefined> {
  const lista = listaPer(d, deps.cfg);
  const chiave = chiaveDocumento(d.tipo, d.anno, d.numero);
  const trovate = await deps.api.cercaPerChiave(lista, chiave);
  if (trovate.length > 1) {
    deps.notif.anomalia('clickup_task_doppie', { chiave, task: trovate.join(',') });
    return undefined;
  }
  const id = trovate[0] ?? (await deps.api.creaTask(lista, taskDaDocumento(d, deps.cfg)));
  const ck = (d.payload.dati_fonte as { clickup?: { task_progetto_id?: string; campo_relationship_id?: string } } | undefined)?.clickup;
  if (ck?.task_progetto_id && ck.campo_relationship_id) await deps.api.collegaProgetto(id, ck.campo_relationship_id, ck.task_progetto_id);
  return id;
}

/**
 * Un giro del worker: fotografia dei documenti 'riservato' con data_riserva precedente all'avvio del giro.
 * Se ClickUp fallisce ci si ferma: i documenti restano 'riservato' e il giro dopo li riprende con lo stesso numero.
 */
export async function giroWorker(deps: DepsWorker, fonti: string[]): Promise<{ creati: number } | 'occupato'> {
  return conLockClickUp(deps.pool, async () => {
    const r = await deps.pool.query<Documento>(
      `SELECT * FROM documenti WHERE stato = 'riservato' AND data_riserva < now() AND fonte = ANY($1)
       ORDER BY anno, tipo, numero`,
      [fonti],
    );
    let creati = 0;
    for (const d of r.rows) {
      try {
        const id = await assicuraTask(deps, d);
        if (!id) continue;
        await cambiaStato(deps.pool, d.ref, 'creato', { clickupTaskId: id, dettaglio: { clickup_task_id: id } });
        creati++;
      } catch (e) {
        // 4xx (lista o campo sbagliato per QUESTO documento): si segnala e si passa al successivo,
        // così un documento con dati errati non blocca tutti gli altri. Rete/5xx/429: ClickUp non disponibile, ci si ferma.
        if (e instanceof ErroreClickUp && e.status >= 400 && e.status < 500 && e.status !== 429) {
          deps.notif.anomalia('clickup_documento_rifiutato', { ref: d.ref, status: e.status });
          continue;
        }
        deps.log.error({ ref: d.ref, err: (e as Error).message }, 'worker ClickUp: giro interrotto');
        break;
      }
    }
    return { creati };
  });
}

/** Task sparita in ClickUp: si rigenera dal payload con lo stesso numero (mai un numero nuovo). */
export async function rigeneraTask(deps: DepsWorker, d: Documento): Promise<string | undefined> {
  const id = await assicuraTask(deps, d);
  if (id && id !== d.clickup_task_id) await aggiornaTask(deps.pool, d.ref, id, { rigenerata: true, vecchia_task: d.clickup_task_id, nuova_task: id });
  return id;
}
