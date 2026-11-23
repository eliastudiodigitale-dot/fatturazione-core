import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { CrmConfig, SlaConfig } from './config.js';
import { LOCK_CRM, inTransazione } from './db.js';
import { ErroreClickUp, type CampoLista, type ClickUpApi, type NuovaTask, type TaskCrm, type ValoreCampo } from './clickup.js';
import type { Notificatore } from './notifiche.js';
import { businessDaCampo, clienteDaTask, collegaTicketAiClienti, salvaClienti } from './crm.js';
import { PRIORITA_CLICKUP, STATI_CHIUSI, prioritaDaClickUp, scadenze, statoDaClickUp, trovaCliente, type Priorita, type StatoTicket, type Ticket } from './ticket.js';
import { DOC_DI_CLIENTE, EMAIL_DOC, PIVA_DOC, normalizzaEmail, normalizzaPiva } from './sql.js';
import { opzionePerNome } from './worker.js';

export interface DepsCrm {
  pool: pg.Pool;
  api: ClickUpApi;
  cfg: CrmConfig;
  sla: SlaConfig;
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

// ---------------------------------------------------------------- ticket: da ClickUp al DB

/** Applica una task della lista Ticket al DB: la crea se è nata in ClickUp, altrimenti ne aggiorna stato, priorità e assegnatario. */
export async function applicaTaskTicket(d: DepsCrm, task: TaskCrm): Promise<'nuovo' | 'aggiornato' | 'invariato' | 'saltato'> {
  const c = d.cfg.campiTicket;
  const campo = (id?: string) => (id ? task.campi[id] : undefined);
  const refCampo = comeTesto(campo(c.ref))?.trim() || null;
  const stato = statoDaClickUp(task.stato);
  const priorita = prioritaDaClickUp(task.priorita);
  const businessTask = businessDaCampo(campo(c.business), d.cfg.alias)[0];
  const assegnato = task.assegnati.join(', ') || null;
  const categoria = comeTesto(campo(c.categoria));
  const clienteRel = Array.isArray(campo(c.cliente)) ? (campo(c.cliente) as string[])[0] : undefined;
  const oggetto = task.nome.trim().slice(0, 300) || '(senza oggetto)';

  return inTransazione(d.pool, async (db): Promise<'nuovo' | 'aggiornato' | 'invariato' | 'saltato'> => {
    const r = await db.query<Ticket>(
      `SELECT * FROM ticket WHERE clickup_task_id = $1 OR ($2::text IS NOT NULL AND ref = $2) ORDER BY (clickup_task_id = $1) DESC NULLS LAST LIMIT 1 FOR UPDATE`,
      [task.id, refCampo],
    );
    const t = r.rows[0];
    if (!t) {
      const business = businessTask ?? d.cfg.businessPredefinito;
      if (!business) {
        d.notif.anomalia('ticket_senza_business', { task: task.id, azione: 'compilare il campo attività del ticket o impostare CRM_BUSINESS_PREDEFINITO' });
        return 'saltato';
      }
      const emailCampo = comeTesto(campo(c.email));
      const cliente = clienteRel ?? (await trovaCliente(db, { email: emailCampo }));
      const aperto = task.creata ?? new Date();
      const p: Priorita = priorita ?? 'normale';
      const sc = scadenze(d.sla, business, p, aperto);
      const chiuso = STATI_CHIUSI.includes(stato);
      const fonte = (comeTesto(campo(c.fonte)) ?? 'manuale').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'manuale';
      const ins = await db.query<{ id: string }>(
        `INSERT INTO ticket (ref, fonte, business, oggetto, priorita, stato, categoria, cliente_email, cliente_task_id, assegnato_a, aperto_il,
                             prima_risposta_il, risolto_il, scade_prima_risposta, scade_risoluzione, clickup_task_id, sync_il)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
         ON CONFLICT (ref) DO NOTHING RETURNING id`,
        [
          refCampo ?? `clickup|${task.id}`, fonte, business, oggetto, p, stato, categoria, normalizzaEmail(emailCampo), cliente, assegnato, aperto,
          stato === 'aperto' ? null : (task.modificata ?? new Date()), chiuso ? (task.chiusa ?? new Date()) : null, sc.primaRisposta, sc.risoluzione, task.id,
        ],
      );
      if (!ins.rows[0]) return 'saltato';
      await db.query(`INSERT INTO ticket_eventi (ticket_id, tipo, da, dettaglio) VALUES ($1, 'aperto', 'clickup', $2)`, [ins.rows[0].id, JSON.stringify({ stato })]);
      return 'nuovo';
    }

    const cambi: string[] = [];
    const sets: string[] = [];
    const val: unknown[] = [];
    const imposta = (colonna: string, v: unknown) => {
      val.push(v);
      sets.push(`${colonna} = $${val.length}`);
    };
    const eventi: { tipo: string; dettaglio: Record<string, unknown> }[] = [];

    if (t.clickup_task_id !== task.id) imposta('clickup_task_id', task.id);
    if (t.oggetto !== oggetto) {
      imposta('oggetto', oggetto);
      cambi.push('oggetto');
    }
    if (t.stato !== stato) {
      imposta('stato', stato);
      eventi.push({ tipo: 'stato', dettaglio: { da: t.stato, a: stato } });
      cambi.push('stato');
      if (STATI_CHIUSI.includes(stato) && !t.risolto_il) imposta('risolto_il', task.chiusa ?? new Date());
      if (!STATI_CHIUSI.includes(stato) && t.risolto_il) imposta('risolto_il', null); // riaperto
      if (stato !== 'aperto' && !t.prima_risposta_il) imposta('prima_risposta_il', task.modificata ?? new Date());
    }
    if (priorita && t.priorita !== priorita) {
      imposta('priorita', priorita);
      const sc = scadenze(d.sla, t.business, priorita, new Date(t.aperto_il));
      imposta('scade_prima_risposta', sc.primaRisposta);
      imposta('scade_risoluzione', sc.risoluzione);
      eventi.push({ tipo: 'priorita', dettaglio: { da: t.priorita, a: priorita } });
      cambi.push('priorita');
    }
    if ((t.assegnato_a ?? null) !== assegnato) {
      imposta('assegnato_a', assegnato);
      eventi.push({ tipo: 'assegnato', dettaglio: { a: assegnato } });
      cambi.push('assegnato');
    }
    if (categoria !== null && t.categoria !== categoria) {
      imposta('categoria', categoria);
      cambi.push('categoria');
    }
    if (clienteRel && t.cliente_task_id !== clienteRel) {
      imposta('cliente_task_id', clienteRel);
      cambi.push('cliente');
    }
    if (businessTask && t.business !== businessTask) {
      imposta('business', businessTask);
      cambi.push('business');
    }
    if (cambi.length) sets.push('aggiornato_il = now()');
    sets.push('sync_il = now()');
    val.push(t.id);
    await db.query(`UPDATE ticket SET ${sets.join(', ')} WHERE id = $${val.length}`, val);
    for (const e of eventi) await db.query(`INSERT INTO ticket_eventi (ticket_id, tipo, da, dettaglio) VALUES ($1, $2, 'clickup', $3)`, [t.id, e.tipo, JSON.stringify(e.dettaglio)]);
    return cambi.length ? 'aggiornato' : 'invariato';
  });
}

/**
 * Rilegge i ticket da ClickUp. Il giro "completo" rilegge tutta la lista; gli altri solo le task cambiate dall'ultima volta
 * (con 10 minuti di margine), per stare largamente sotto il limite di richieste di ClickUp.
 */
export async function sincronizzaTicket(d: DepsCrm, completa: boolean): Promise<{ letti: number; nuovi: number; aggiornati: number } | undefined> {
  const lista = d.cfg.ticketListId;
  if (!lista) return undefined;
  const inizio = new Date();
  try {
    const prec = (await d.pool.query<{ ultimo_ok: Date | null; completa_il: string | null }>(`SELECT ultimo_ok, dettaglio->>'completa_il' AS completa_il FROM crm_sync WHERE nome = 'ticket'`)).rows[0];
    let dopo: Date | undefined;
    if (!completa && prec?.ultimo_ok) dopo = new Date(new Date(prec.ultimo_ok).getTime() - 10 * 60_000);
    const tasks = await d.api.elencaTaskCrm(lista, { modificateDopo: dopo });
    let nuovi = 0;
    let aggiornati = 0;
    for (const t of tasks) {
      const esito = await applicaTaskTicket(d, t);
      if (esito === 'nuovo') nuovi++;
      if (esito === 'aggiornato') aggiornati++;
    }
    const eCompleta = !dopo;
    const dettaglio = { letti: tasks.length, nuovi, aggiornati, completa: eCompleta, completa_il: eCompleta ? inizio.toISOString() : (prec?.completa_il ?? null) };
    await segna(d.pool, 'ticket', inizio, { ok: true, dettaglio });
    return { letti: tasks.length, nuovi, aggiornati };
  } catch (e) {
    await segna(d.pool, 'ticket', inizio, { ok: false, errore: (e as Error).message.slice(0, 300) }).catch(() => undefined);
    throw e;
  }
}

// ---------------------------------------------------------------- ticket: dal DB a ClickUp

function descrizioneTicket(t: Ticket): string {
  return [
    `**Ticket** \`${t.ref}\``,
    `Attività: ${t.business} · Fonte: ${t.fonte}${t.canale ? ` · Canale: ${t.canale}` : ''}`,
    t.cliente_nome || t.cliente_email ? `Cliente: ${[t.cliente_nome, t.cliente_email ? `<${t.cliente_email}>` : ''].filter(Boolean).join(' ')}` : '',
    `Scadenza prima risposta: ${t.scade_prima_risposta ? new Date(t.scade_prima_risposta).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : '-'}`,
    '',
    t.testo ?? '',
  ]
    .filter((x, i, a) => x !== '' || a[i - 1] !== '')
    .join('\n');
}

/** Crea in ClickUp la task dei ticket arrivati dalle fonti e non ancora lì; poi svuota il testo dal DB (#7, #8). */
export async function inviaTicket(d: DepsCrm, max = 20): Promise<number> {
  const lista = d.cfg.ticketListId;
  if (!lista) return 0;
  const r = await d.pool.query<Ticket>(`SELECT * FROM ticket WHERE clickup_task_id IS NULL AND origine = 'locale' ORDER BY id LIMIT $1`, [max]);
  if (r.rows.length === 0) return 0;
  const c = d.cfg.campiTicket;
  const campiLista = await d.api.campiLista(lista);
  const campoDi = (id?: string) => (id ? campiLista.find((x) => x.id === id) : undefined);
  let inviati = 0;
  for (const t of r.rows) {
    const campi: NuovaTask['campi'] = [];
    const metti = (id: string | undefined, v: ValoreCampo | ValoreCampo[] | undefined) => {
      if (id && v !== undefined && v !== '') campi.push({ id, value: v as ValoreCampo });
    };
    metti(c.ref, t.ref);
    metti(c.business, valorePerCampo(campoDi(c.business), nomiAttivita(t.business, d.cfg.alias)));
    metti(c.fonte, valorePerCampo(campoDi(c.fonte), [t.fonte]));
    if (t.categoria) metti(c.categoria, valorePerCampo(campoDi(c.categoria), [t.categoria]));
    if (t.cliente_email) metti(c.email, t.cliente_email);
    try {
      const id = await d.api.creaTask(lista, { nome: `[${t.business}] ${t.oggetto}`.slice(0, 250), descrizione: descrizioneTicket(t), campi, priorita: PRIORITA_CLICKUP[t.priorita] });
      if (t.cliente_task_id && c.cliente) await d.api.collegaProgetto(id, c.cliente, t.cliente_task_id).catch(() => undefined);
      await d.pool.query('UPDATE ticket SET clickup_task_id = $2, testo = NULL, sync_il = now(), aggiornato_il = now() WHERE id = $1 AND clickup_task_id IS NULL', [t.id, id]);
      inviati++;
    } catch (e) {
      if (clientError(e)) {
        d.notif.anomalia('ticket_rifiutato_clickup', { ticket: t.id, status: (e as ErroreClickUp).status });
        continue;
      }
      throw e;
    }
  }
  return inviati;
}

/** Porta in ClickUp, come commenti, i messaggi arrivati dalle fonti; poi ne svuota il testo dal DB. */
export async function inviaMessaggi(d: DepsCrm, max = 50): Promise<number> {
  if (!d.cfg.ticketListId) return 0;
  const r = await d.pool.query<{ id: string; da: string; testo: string | null; quando: Date; clickup_task_id: string }>(
    `SELECT m.id, m.da, m.testo, m.quando, t.clickup_task_id FROM ticket_messaggi m JOIN ticket t ON t.id = m.ticket_id
      WHERE m.inviato_il IS NULL AND t.clickup_task_id IS NOT NULL ORDER BY m.id LIMIT $1`,
    [max],
  );
  let inviati = 0;
  for (const m of r.rows) {
    const quando = new Date(m.quando).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    const testo = `${m.da === 'cliente' ? 'Cliente' : 'Staff'} (${quando}): ${m.testo ?? '(messaggio senza testo)'}`;
    try {
      await d.api.commenta(m.clickup_task_id, testo);
      await d.pool.query('UPDATE ticket_messaggi SET inviato_il = now(), testo = NULL WHERE id = $1', [m.id]);
      inviati++;
    } catch (e) {
      if (clientError(e)) {
        d.notif.anomalia('ticket_commento_rifiutato', { messaggio: m.id, status: (e as ErroreClickUp).status });
        continue;
      }
      throw e;
    }
  }
  return inviati;
}

// ---------------------------------------------------------------- giro

export type Parte = 'clienti' | 'ticket';

/** Quando conviene rileggere tutta la lista ticket invece delle sole task cambiate: una volta al giorno. */
async function serveCompleta(pool: pg.Pool): Promise<boolean> {
  const r = await pool.query<{ completa_il: string | null }>(`SELECT dettaglio->>'completa_il' AS completa_il FROM crm_sync WHERE nome = 'ticket'`);
  const ultima = r.rows[0]?.completa_il;
  return !ultima || Date.now() - new Date(ultima).getTime() > 24 * 3600_000;
}

/**
 * Un giro di sincronizzazione. Prima si legge da ClickUp (così una task creata da un giro interrotto viene riconosciuta per ref
 * e non duplicata), poi si scrive verso ClickUp. Un errore di rete ferma il giro: il successivo riparte da dove serve.
 */
export async function giroCrm(d: DepsCrm, parte: Parte, o: { completa?: boolean } = {}): Promise<Record<string, unknown> | 'occupato'> {
  return conLockCrm(d.pool, async () => {
    const out: Record<string, unknown> = {};
    if (parte === 'clienti') {
      out.clienti = await sincronizzaClienti(d);
      out.creati = await creaClientiMancanti(d);
    } else {
      out.ticket = await sincronizzaTicket(d, o.completa ?? (await serveCompleta(d.pool)));
      out.inviati = await inviaTicket(d);
      out.messaggi = await inviaMessaggi(d);
    }
    return out;
  });
}
