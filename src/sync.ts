import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { CrmConfig } from './config.js';
import { LOCK_CRM } from './db.js';
import { ErroreClickUp, type CampoLista, type ClickUpApi, type NuovaTask, type ValoreCampo } from './clickup.js';
import type { Notificatore } from './notifiche.js';
import { businessDaCampo, clienteDaTask, collegaTicketAiClienti, salvaClienti } from './crm.js';
import { trovaCliente } from './ticket.js';
import { DOC_DI_CLIENTE, EMAIL_DOC, PIVA_DOC, normalizzaEmail, normalizzaPiva } from './sql.js';
import { opzionePerNome } from './worker.js';

export interface DepsCrm {
  pool: pg.Pool;
  api: ClickUpApi;
  cfg: CrmConfig;
  log: FastifyBaseLogger;
  notif: Notificatore;
}

const comeTesto = (v: string | string[] | null | undefined): string | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const clientError = (e: unknown) => e instanceof ErroreClickUp && e.status >= 400 && e.status < 500 && e.status !== 429;

/** Esegue `fn` solo se nessun'altra sincronizzazione CRM è in corso. Il lock cade con la connessione. */
export async function conLockCrm<T>(pool: pg.Pool, fn: () => Promise<T>): Promise<T | 'occupato'> {
  const c = await pool.connect();
  let preso = false;
  try {
    preso = Boolean((await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_CRM])).rows[0]?.ok);
    if (!preso) return 'occupato';
    return await fn();
  } finally {
    if (preso) await c.query('SELECT pg_advisory_unlock($1)', [LOCK_CRM]).catch(() => undefined);
    c.release();
  }
}

export async function segna(pool: pg.Pool, nome: string, inizio: Date, esito: { ok: boolean; errore?: string; dettaglio?: Record<string, unknown> }) {
  await pool.query(
    `INSERT INTO crm_sync (nome, ultimo_inizio, ultimo_ok, ultimo_errore, dettaglio) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (nome) DO UPDATE SET ultimo_inizio = EXCLUDED.ultimo_inizio,
       ultimo_ok = CASE WHEN $6 THEN EXCLUDED.ultimo_ok ELSE crm_sync.ultimo_ok END,
       ultimo_errore = EXCLUDED.ultimo_errore,
       dettaglio = CASE WHEN $6 THEN EXCLUDED.dettaglio ELSE crm_sync.dettaglio END`,
    [nome, inizio, esito.ok ? new Date() : null, esito.errore ?? null, esito.dettaglio ? JSON.stringify(esito.dettaglio) : null, esito.ok],
  );
}

// ---------------------------------------------------------------- clienti

export async function sincronizzaClienti(d: DepsCrm): Promise<{ letti: number; eliminati: number; collegati: number } | undefined> {
  const lista = d.cfg.clientiListId;
  if (!lista) return undefined;
  const inizio = new Date();
  try {
    const tasks = await d.api.elencaTaskCrm(lista);
    await salvaClienti(d.pool, tasks.map((t) => clienteDaTask(t, d.cfg.campiClienti, d.cfg.alias)));
    let eliminati = 0;
    if (tasks.length > 0) {
      const r = await d.pool.query('UPDATE crm_clienti SET eliminato = true, sync_il = now() WHERE NOT eliminato AND NOT (clickup_task_id = ANY($1::text[]))', [tasks.map((t) => t.id)]);
      eliminati = r.rowCount ?? 0;
    } else {
      const n = (await d.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM crm_clienti WHERE NOT eliminato')).rows[0]!.n;
      // Lista vuota con clienti già in cache: quasi certamente un errore di configurazione, non si cancella nulla.
      if (n > 0) d.notif.anomalia('crm_lista_clienti_vuota', { clientiInCache: n, azione: 'controllare CLICKUP_LIST_ID_CLIENTI' });
    }
    const collegati = await collegaTicketAiClienti(d.pool);
    const esito = { letti: tasks.length, eliminati, collegati };
    await segna(d.pool, 'clienti', inizio, { ok: true, dettaglio: esito });
    return esito;
  } catch (e) {
    await segna(d.pool, 'clienti', inizio, { ok: false, errore: (e as Error).message.slice(0, 300) }).catch(() => undefined);
    throw e;
  }
}

/** Opzione di un menu/etichette o testo libero: scrive il valore giusto per il tipo del campo (nome o id opzione). */
export function valorePerCampo(campo: CampoLista | undefined, nomi: string[]): ValoreCampo | ValoreCampo[] | undefined {
  // Campo non descritto dalla lista: si tratta come testo (se l'ID è sbagliato ClickUp rifiuta e il servizio avvisa).
  if (!campo) return nomi[0];
  if (campo.type === 'drop_down' || campo.type === 'labels') {
    const id = opzionePerNome(campo, nomi);
    if (!id) return undefined;
    return campo.type === 'labels' ? [id] : id;
  }
  return nomi[0];
}

/** Nomi con cui l'attività si chiama in ClickUp: il nome del servizio e gli alias che puntano ad esso. */
export const nomiAttivita = (business: string, alias: Record<string, string>): string[] => [business, ...Object.entries(alias).filter(([, v]) => v === business).map(([k]) => k)];

/** Crea in ClickUp la scheda dei clienti pagati via Stripe/GoCardless che non ci sono ancora (#42). Spento se CRM_CREA_CLIENTI non è "true". */
export async function creaClientiMancanti(d: DepsCrm, max = 20): Promise<number> {
  const lista = d.cfg.clientiListId;
  if (!d.cfg.creaClienti || !lista) return 0;
  const r = await d.pool.query<{ ref: string; business: string | null; cliente: Record<string, string | undefined> }>(
    `SELECT d.ref, d.business, d.payload->'cliente' AS cliente FROM documenti d
      WHERE d.fonte IN ('stripe','gocardless') AND d.stato <> 'annullato' AND (${PIVA_DOC} IS NOT NULL OR ${EMAIL_DOC} IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM crm_clienti c WHERE NOT c.eliminato AND ${DOC_DI_CLIENTE})
      ORDER BY d.id LIMIT $1`,
    [max],
  );
  if (r.rows.length === 0) return 0;
  const campiLista = await d.api.campiLista(lista);
  const campo = (id?: string) => (id ? campiLista.find((x) => x.id === id) : undefined);
  const c = d.cfg.campiClienti;
  let creati = 0;
  for (const doc of r.rows) {
    const cl = doc.cliente;
    // Stesso cliente su più documenti nello stesso giro: dopo la prima creazione la cache lo conosce.
    if (await trovaCliente(d.pool, { email: cl.email, partita_iva: cl.partita_iva })) continue;
    const nome = cl.ragione_sociale ?? cl.nome ?? cl.email ?? '(senza nome)';
    const campi: NuovaTask['campi'] = [];
    const metti = (id: string | undefined, v: ValoreCampo | ValoreCampo[] | undefined) => {
      if (id && v !== undefined && v !== '') campi.push({ id, value: v as ValoreCampo });
    };
    metti(c.email, normalizzaEmail(cl.email) ?? undefined);
    metti(c.partitaIva, normalizzaPiva(cl.partita_iva) ?? undefined);
    metti(c.codiceFiscale, cl.codice_fiscale);
    metti(c.telefono, cl.telefono);
    const business = doc.business ?? d.cfg.businessPredefinito;
    if (business) metti(c.business, valorePerCampo(campo(c.business), nomiAttivita(business, d.cfg.alias)));
    try {
      const id = await d.api.creaTask(lista, { nome, descrizione: `Cliente creato dal servizio di fatturazione al primo pagamento (rif. ${doc.ref}).`, campi });
      await salvaClienti(d.pool, [
        {
          clickup_task_id: id, nome, email: normalizzaEmail(cl.email), partita_iva: normalizzaPiva(cl.partita_iva), codice_fiscale: cl.codice_fiscale ?? null,
          telefono: cl.telefono ?? null, businesses: business ? [business] : [], stato: null, tag: [], creato_il: new Date(), modificato_il: new Date(),
        },
      ]);
      creati++;
    } catch (e) {
      if (clientError(e)) {
        d.notif.anomalia('crm_cliente_rifiutato', { ref: doc.ref, status: (e as ErroreClickUp).status });
        continue;
      }
      throw e;
    }
  }
  return creati;
}

// ---------------------------------------------------------------- giro

/**
 * Un giro di sincronizzazione dei clienti da ClickUp (#42). Prima si legge da ClickUp, poi si crea (se CRM_CREA_CLIENTI): se un giro si
 * interrompe dopo aver creato una scheda, il giro dopo la riconosce per email o P.IVA e non la duplica. Un solo giro alla volta (lock Postgres).
 * I ticket non passano da qui: vivono nei backend dei business (#47).
 */
export async function giroCrm(d: DepsCrm): Promise<Record<string, unknown> | 'occupato'> {
  return conLockCrm(d.pool, async () => ({ clienti: await sincronizzaClienti(d), creati: await creaClientiMancanti(d) }));
}
