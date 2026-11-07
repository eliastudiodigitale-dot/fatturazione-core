import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { Config, Tipo } from './config.js';
import { LOCK_CLICKUP } from './db.js';
import { chiaveDocumento, ErroreClickUp, type CampoLista, type ClickUpApi, type NuovaTask } from './clickup.js';
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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Opzione di un menu a tendina scelta per nome: "serrandasu.it" trova "Serrandasu.it", "serrandasu" o "SERRANDASU". */
export function opzionePerNome(campo: CampoLista | undefined, nomi: string[]): string | undefined {
  if (!campo) return undefined;
  const cerca = nomi.flatMap((n) => [norm(n), norm(n.replace(/\.[a-z]{2,}$/i, ''))]).filter(Boolean);
  return campo.options.find((o) => cerca.includes(norm(o.name)))?.id;
}

const METODO_PER_FONTE: Record<string, string[]> = { stripe: ['stripe', 'carta'], gocardless: ['gocardless', 'sepa', 'addebito'] };

export function taskDaDocumento(d: Documento, cfg: DepsWorker['cfg'], campiLista: CampoLista[] = [], notif?: DepsWorker['notif']): NuovaTask {
  const etichetta: Record<Tipo, string> = { fattura: 'Fattura', proforma: 'Proforma' };
  const totaleCent = d.payload.righe.reduce((s, r) => s + Math.round(r.importo * 100), 0);
  const totale = totaleCent / 100;
  const cliente = d.payload.cliente as { nome?: unknown; ragione_sociale?: unknown; email?: unknown };
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
  const c = cfg.campi;
  const quando = new Date(d.data_riserva).getTime();
  const campi: NuovaTask['campi'] = [{ id: c.chiave, value: chiaveDocumento(d.tipo, d.anno, d.numero) }];
  const metti = (id: string | undefined, value: NuovaTask['campi'][number]['value'] | undefined, data = false) => {
    if (id && value !== undefined && value !== '') campi.push(data ? { id, value, value_options: { time: false } } : { id, value });
  };
  metti(c.anno, d.anno);
  metti(c.numero[d.tipo], d.numero);
  metti(c.flag[d.tipo], true);
  metti(c.totale[d.tipo], totale);
  metti(c.dataDocumento, quando, true);
  if (d.tipo === 'fattura') metti(c.dataFattura, quando, true);
  metti(c.ragione, nomeCliente || undefined);
  if (typeof cliente.email === 'string') metti(c.email, cliente.email);
  if (c.rata && d.payload.rata && d.payload.rata !== 'unica') metti(c.rata, d.payload.rata);
  // Pagamenti già incassati (Stripe, GoCardless): la task nasce pagata.
  if (d.fonte === 'stripe' || d.fonte === 'gocardless') {
    metti(c.pagata, true);
    metti(c.dataIncasso, quando, true);
  }
  if (c.area && d.business) {
    const op = opzionePerNome(campiLista.find((x) => x.id === c.area), [d.business]);
    if (op) metti(c.area, op);
    else notif?.anomalia('clickup_area_sconosciuta', { business: d.business, azione: 'aggiungere l\'opzione nel menu AREA' });
  }
  if (c.metodo && METODO_PER_FONTE[d.fonte]) metti(c.metodo, opzionePerNome(campiLista.find((x) => x.id === c.metodo), METODO_PER_FONTE[d.fonte]!));
  // Stesso nome che usa il flusso n8n di Elia ("F-<progetto>-<anno>") quando il progetto è noto.
  const nomeProgetto = (d.payload.dati_fonte as { clickup?: { nome_progetto?: string } } | undefined)?.clickup?.nome_progetto;
  const nome = nomeProgetto ? `F-${nomeProgetto}-${d.anno}` : `${etichetta[d.tipo]} ${d.numero}/${d.anno}${nomeCliente ? ` - ${nomeCliente}` : ''}`;
  return { nome, descrizione: descrizione.join('\n'), campi };
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
  let id = trovate[0];
  if (!id) {
    const servonoOpzioni = Boolean(deps.cfg.campi.area || deps.cfg.campi.metodo);
    const campiLista = servonoOpzioni ? await deps.api.campiLista(lista) : [];
    id = await deps.api.creaTask(lista, taskDaDocumento(d, deps.cfg, campiLista, deps.notif));
  }
  const ck = (d.payload.dati_fonte as { clickup?: { task_progetto_id?: string; campo_relationship_id?: string } } | undefined)?.clickup;
  const rel = ck?.campo_relationship_id ?? deps.cfg.campi.progetto;
  if (ck?.task_progetto_id && rel) await deps.api.collegaProgetto(id, rel, ck.task_progetto_id);
  const cli = (ck as { cliente_task_id?: string } | undefined)?.cliente_task_id;
  if (cli && deps.cfg.campi.cliente) await deps.api.collegaProgetto(id, deps.cfg.campi.cliente, cli);
  return id;
}

/**
 * Un giro del worker: fotografia dei documenti 'riservato' con data_riserva precedente all'avvio del giro.
 * Se ClickUp fallisce ci si ferma: i documenti restano 'riservato' e il giro dopo li riprende con lo stesso numero.
 */
export async function giroWorker(deps: DepsWorker, fonti: string[], attesaClickupMin = 0): Promise<{ creati: number } | 'occupato'> {
  return conLockClickUp(deps.pool, async () => {
    const r = await deps.pool.query<Documento>(
      `SELECT * FROM documenti WHERE stato = 'riservato' AND data_riserva < now() AND fonte = ANY($1)
         AND (fonte <> 'clickup' OR data_riserva < now() - make_interval(mins => $2))
       ORDER BY anno, tipo, numero`,
      [fonti, attesaClickupMin],
    );
    let creati = 0;
    for (const d of r.rows) {
      try {
        const id = await assicuraTask(deps, d);
        if (!id) continue;
        if (d.fonte === 'clickup' && attesaClickupMin > 0) deps.notif.anomalia('clickup_task_dal_servizio', { ref: d.ref, azione: 'il workflow n8n non ha confermato: controllare che la proforma sia stata inviata' });
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
