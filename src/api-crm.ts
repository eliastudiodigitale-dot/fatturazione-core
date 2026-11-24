import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import type { Notificatore } from './notifiche.js';
import type { SlaStore } from './sla.js';
import type { FonteAutenticata } from './auth.js';
import { dettaglioCliente, elencoClienti, type FiltroClienti } from './crm.js';
import { ErroreKpi, controllaPeriodo, distribuzioni, kpiClienti, kpiFatturato, kpiTicket, panoramica, perBusiness, serie, statoSync, type FiltroKpi, type Granularita } from './kpi.js';
import { AMBITO_TOTALE, type Ambito } from './sql.js';
import { PRIORITA, STATI_TICKET, aggiungiMessaggio, creaTicket, pianiAmmessi, dettaglioTicket, elencoTicket, type FiltroTicket, type Priorita, type StatoTicket } from './ticket.js';

/** Errore di una richiesta con parametri sbagliati: diventa un 400 con il messaggio. */
export class ErroreRichiesta extends Error {}

type Query = Record<string, string | undefined>;
export type ParteSync = 'clienti' | 'ticket' | 'tutto';

export interface DepsCrmApi {
  pool: pg.Pool;
  cfg: Config;
  notif: Notificatore;
  sla: SlaStore;
  /** Esegue subito una sincronizzazione con ClickUp (solo se CRM configurato). */
  sincronizza?: (parte: ParteSync, completa: boolean) => Promise<Record<string, unknown> | 'occupato'>;
}

// ------------------------------------------------------------------ parametri

const lista = (s?: string): string[] | undefined => {
  const v = s?.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
  return v?.length ? v : undefined;
};
const intero = (s: string | undefined, nome: string, min: number, max: number): number | undefined => {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || n > max) throw new ErroreRichiesta(`${nome} non valido`);
  return n;
};
const insieme = <T extends string>(s: string | undefined, nome: string, ammessi: readonly T[]): T[] | undefined => {
  const v = lista(s);
  if (!v) return undefined;
  for (const x of v) if (!(ammessi as readonly string[]).includes(x)) throw new ErroreRichiesta(`${nome} non valido: ${x}`);
  return v as T[];
};

/** Mezzanotte di Roma del giorno indicato (AAAA-MM-GG), come istante. */
export function mezzanotteRoma(giorno: string): Date {
  const [y, m, d] = giorno.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d);
  const ora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date(utc)));
  return new Date(utc - ora * 3600_000);
}
const SOLO_DATA = /^\d{4}-\d{2}-\d{2}$/;
function dataParam(s: string | undefined, nome: string, fineGiorno = false): Date | undefined {
  if (s === undefined || s === '') return undefined;
  if (SOLO_DATA.test(s)) {
    const d = mezzanotteRoma(s);
    if (Number.isNaN(d.getTime())) throw new ErroreRichiesta(`${nome} non valida`);
    // "a" con la sola data è inclusiva: arriva alla mezzanotte seguente.
    return fineGiorno ? mezzanotteRoma(new Date(d.getTime() + 36 * 3600_000).toISOString().slice(0, 10)) : d;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ErroreRichiesta(`${nome} non valida`);
  return d;
}

export function periodo(q: Query, ora = new Date()): { da: Date; a: Date } {
  const giorni = intero(q.giorni, 'giorni', 1, 3660);
  const a = dataParam(q.a, 'a', true) ?? ora;
  const da = dataParam(q.da, 'da') ?? new Date(a.getTime() - (giorni ?? 30) * 86_400_000);
  return { da, a };
}

function filtroKpi(q: Query): FiltroKpi {
  return { business: lista(q.business), fonte: lista(q.fonte), ...periodo(q) };
}
function granularita(q: Query): Granularita {
  const g = q.granularita ?? 'giorno';
  if (g !== 'giorno' && g !== 'settimana' && g !== 'mese') throw new ErroreRichiesta('granularita non valida (giorno, settimana, mese)');
  return g;
}
function filtroTicket(q: Query): FiltroTicket {
  const ordine = q.ordine as FiltroTicket['ordine'] | undefined;
  if (ordine && !['recenti', 'vecchi', 'scadenza', 'priorita'].includes(ordine)) throw new ErroreRichiesta('ordine non valido');
  const da = dataParam(q.da, 'da');
  const a = dataParam(q.a, 'a', true);
  return {
    business: lista(q.business),
    fonte: lista(q.fonte),
    stato: insieme<StatoTicket>(q.stato, 'stato', STATI_TICKET),
    priorita: insieme<Priorita>(q.priorita, 'priorita', PRIORITA),
    assegnato: q.assegnato || undefined,
    nonAssegnati: q.non_assegnati === 'true',
    piano: lista(q.piano),
    cliente: q.cliente || undefined,
    q: q.q?.trim() || undefined,
    scaduti: q.scaduti === 'true',
    da: da?.toISOString(),
    a: a?.toISOString(),
    ordine,
    limite: intero(q.limite, 'limite', 1, 200),
    offset: intero(q.offset, 'offset', 0, 1_000_000),
  };
}
function filtroClienti(q: Query): FiltroClienti {
  const ordine = q.ordine as FiltroClienti['ordine'] | undefined;
  if (ordine && !['nome', 'recenti', 'ticket', 'fatturato'].includes(ordine)) throw new ErroreRichiesta('ordine non valido');
  return {
    business: lista(q.business),
    q: q.q?.trim() || undefined,
    stato: q.stato || undefined,
    conTicketAperti: q.con_ticket_aperti === 'true',
    senzaFatture: q.senza_fatture === 'true',
    ordine,
    limite: intero(q.limite, 'limite', 1, 200),
    offset: intero(q.offset, 'offset', 0, 1_000_000),
  };
}

const schemaQuery = (nomi: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(nomi.map((n) => [n, { type: 'string', maxLength: 200 }])),
});
const QUERY_TICKET = schemaQuery(['business', 'fonte', 'stato', 'priorita', 'assegnato', 'non_assegnati', 'piano', 'cliente', 'q', 'scaduti', 'da', 'a', 'ordine', 'limite', 'offset']);
const QUERY_CLIENTI = schemaQuery(['business', 'q', 'stato', 'con_ticket_aperti', 'senza_fatture', 'ordine', 'limite', 'offset']);
const QUERY_KPI = schemaQuery(['business', 'fonte', 'da', 'a', 'giorni', 'granularita']);

// ------------------------------------------------------------------ opzioni dei filtri

/** Valori già presenti nei dati, per riempire i menu dei filtri (solo attività dell'ambito). */
export async function opzioniFiltri(pool: pg.Pool, ambito: Ambito) {
  const b = ambito.business;
  const [bu, fo, as, ca, st] = await Promise.all([
    pool.query(
      `SELECT DISTINCT x AS v FROM (
         SELECT business AS x FROM ticket UNION SELECT unnest(businesses) FROM crm_clienti WHERE NOT eliminato UNION SELECT business FROM documenti WHERE business IS NOT NULL
       ) u WHERE x IS NOT NULL AND ($1::text[] IS NULL OR x = ANY($1::text[])) ORDER BY 1`,
      [b],
    ),
    pool.query(`SELECT DISTINCT fonte AS v FROM ticket WHERE ($1::text[] IS NULL OR business = ANY($1::text[])) ORDER BY 1`, [b]),
    pool.query(`SELECT DISTINCT assegnato_a AS v FROM ticket WHERE assegnato_a IS NOT NULL AND ($1::text[] IS NULL OR business = ANY($1::text[])) ORDER BY 1 LIMIT 100`, [b]),
    pool.query(`SELECT DISTINCT categoria AS v FROM ticket WHERE categoria IS NOT NULL AND ($1::text[] IS NULL OR business = ANY($1::text[])) ORDER BY 1 LIMIT 100`, [b]),
    pool.query(`SELECT DISTINCT stato AS v FROM crm_clienti WHERE stato IS NOT NULL AND NOT eliminato AND ($1::text[] IS NULL OR businesses && $1::text[]) ORDER BY 1`, [b]),
  ]);
  const v = (r: { rows: { v: string }[] }) => r.rows.map((x) => x.v);
  return { business: v(bu), fonti: v(fo), assegnati: v(as), categorie: v(ca), stati_cliente: v(st), stati_ticket: STATI_TICKET, priorita: PRIORITA };
}

// ------------------------------------------------------------------ letture (condivise tra API a token e dashboard)

/** Rotte di sola lettura: stesse risposte per i token (ambito totale) e per la dashboard (ambito della sessione). */
export function registraLetture(
  app: FastifyInstance,
  d: { pool: pg.Pool },
  prefisso: string,
  preHandler: preHandlerAsyncHookHandler[],
  ambitoDi: (req: FastifyRequest) => Ambito,
) {
  const { pool } = d;
  const opz = { preHandler };

  app.get<{ Querystring: Query }>(`${prefisso}/ticket`, { ...opz, schema: { querystring: QUERY_TICKET } }, async (req) => elencoTicket(pool, ambitoDi(req), filtroTicket(req.query)));

  app.get<{ Params: { ref: string } }>(`${prefisso}/ticket/:ref`, opz, async (req, reply) => {
    const t = await dettaglioTicket(pool, ambitoDi(req), req.params.ref);
    if (!t) return reply.code(404).send({ errore: 'ticket non trovato' });
    return t;
  });

  app.get<{ Querystring: Query }>(`${prefisso}/clienti`, { ...opz, schema: { querystring: QUERY_CLIENTI } }, async (req) => elencoClienti(pool, ambitoDi(req), filtroClienti(req.query)));

  app.get<{ Params: { id: string } }>(`${prefisso}/clienti/:id`, opz, async (req, reply) => {
    const c = await dettaglioCliente(pool, ambitoDi(req), req.params.id);
    if (!c) return reply.code(404).send({ errore: 'cliente non trovato' });
    return c;
  });

  app.get<{ Querystring: Query }>(`${prefisso}/kpi/panoramica`, { ...opz, schema: { querystring: QUERY_KPI } }, async (req) =>
    panoramica(pool, ambitoDi(req), filtroKpi(req.query), granularita(req.query)),
  );
  app.get<{ Querystring: Query }>(`${prefisso}/kpi/serie`, { ...opz, schema: { querystring: QUERY_KPI } }, async (req) => ({
    serie: await serie(pool, ambitoDi(req), filtroKpi(req.query), granularita(req.query)),
  }));
  app.get<{ Querystring: Query }>(`${prefisso}/kpi/business`, { ...opz, schema: { querystring: QUERY_KPI } }, async (req) => {
    const f = filtroKpi(req.query);
    controllaPeriodo(f);
    return { per_business: await perBusiness(pool, ambitoDi(req), f) };
  });
  app.get<{ Querystring: Query }>(`${prefisso}/kpi/ticket`, { ...opz, schema: { querystring: QUERY_KPI } }, async (req) => {
    const f = filtroKpi(req.query);
    controllaPeriodo(f);
    const a = ambitoDi(req);
    return { ticket: await kpiTicket(pool, a, f), distribuzioni: await distribuzioni(pool, a, f) };
  });
  app.get<{ Querystring: Query }>(`${prefisso}/kpi/clienti`, { ...opz, schema: { querystring: QUERY_KPI } }, async (req) => {
    const f = filtroKpi(req.query);
    controllaPeriodo(f);
    const a = ambitoDi(req);
    return { clienti: await kpiClienti(pool, a, f), fatturato: await kpiFatturato(pool, a, f) };
  });

  app.get(`${prefisso}/filtri`, opz, async (req) => opzioniFiltri(pool, ambitoDi(req)));
  app.get(`${prefisso}/sync/stato`, opz, async () => ({ sync: await statoSync(pool) }));
}

// ------------------------------------------------------------------ scritture (ticket dalle fonti) e sincronizzazione

declare module 'fastify' {
  interface FastifyRequest {
    fonteTicket?: FonteAutenticata;
  }
}

const testo = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
const schemaNuovoTicket = {
  type: 'object',
  additionalProperties: false,
  required: ['id_esterno', 'oggetto'],
  properties: {
    id_esterno: { type: 'string', pattern: '^[A-Za-z0-9._:/-]{1,120}$' },
    fonte: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{1,31}$' },
    business: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' },
    oggetto: testo(300),
    testo: testo(8000),
    priorita: { type: 'string', enum: PRIORITA },
    categoria: testo(80),
    canale: testo(40),
    piano_sla: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,15}$' },
    cliente: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nome: testo(200),
        email: { type: 'string', maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
        partita_iva: { type: 'string', pattern: '^([0-9]{11}|[A-Za-z]{2}[A-Za-z0-9]{2,13})$' },
      },
    },
    dati_fonte: { type: 'object', maxProperties: 20 },
    aperto_il: { type: 'string', format: 'date-time' },
  },
} as const;

interface BodyTicket {
  id_esterno: string;
  fonte?: string;
  business?: string;
  oggetto: string;
  testo?: string;
  priorita?: Priorita;
  categoria?: string;
  canale?: string;
  piano_sla?: string;
  cliente?: { nome?: string; email?: string; partita_iva?: string };
  dati_fonte?: Record<string, unknown>;
  aperto_il?: string;
}

export function registraScritture(
  app: FastifyInstance,
  d: DepsCrmApi,
  autenticaScrittura: preHandlerAsyncHookHandler,
  autentica: (ammessi: ('n8n' | 'dashboard' | 'owner')[]) => preHandlerAsyncHookHandler,
) {
  app.post<{ Body: BodyTicket }>('/v1/ticket', { schema: { body: schemaNuovoTicket }, preHandler: [autenticaScrittura] }, async (req, reply) => {
    const b = req.body;
    // Con il token di una fonte, fonte e attività sono quelle del token: se il corpo ne indica altre è un errore, non si "correggono".
    let fonte: string | undefined;
    let business: string | undefined;
    if (req.fonteTicket) {
      if ((b.fonte && b.fonte !== req.fonteTicket.fonte) || (b.business && b.business !== req.fonteTicket.business))
        return reply.code(400).send({ errore: 'fonte o business non coerenti con il token', codice: 'fonte_non_coerente' });
      fonte = req.fonteTicket.fonte;
      business = req.fonteTicket.business;
    } else {
      fonte = b.fonte;
      business = b.business;
      if (!fonte || !business) return reply.code(400).send({ errore: 'servono fonte e business', codice: 'fonte_mancante' });
      if (['clickup', 'manuale', 'dashboard', 'stripe', 'gocardless'].includes(fonte)) return reply.code(400).send({ errore: 'fonte riservata', codice: 'fonte_riservata' });
    }
    const aperto = b.aperto_il ? new Date(b.aperto_il) : undefined;
    // Un ticket "aperto nel futuro" falserebbe l'SLA; uno più vecchio di un anno è quasi certamente un errore di orologio.
    if (aperto && (aperto.getTime() > Date.now() + 5 * 60_000 || aperto.getTime() < Date.now() - 366 * 86_400_000))
      return reply.code(400).send({ errore: 'aperto_il fuori intervallo', codice: 'data_non_valida' });
    const sla = await d.sla.get();
    if (b.piano_sla && !pianiAmmessi(sla, business).includes(b.piano_sla)) return reply.code(400).send({ errore: 'piano SLA sconosciuto per questa attività', codice: 'piano_sconosciuto' });
    // Se il business ha un backend ticket, il ticket vive lì: qui resta la copia per filtri e SLA (il testo non si conserva).
    const origine = d.cfg.ticket.fonti[fonte]?.backend ? 'remoto' : 'locale';
    const { ticket, nuovo } = await creaTicket(d.pool, sla, {
      fonte, business, idEsterno: b.id_esterno, oggetto: b.oggetto, testo: b.testo, priorita: b.priorita, categoria: b.categoria, canale: b.canale,
      cliente: b.cliente, datiFonte: b.dati_fonte, apertoIl: aperto, pianoSla: b.piano_sla, origine,
    });
    if (nuovo) {
      req.log.info({ ref: ticket.ref, business: ticket.business, priorita: ticket.priorita }, 'ticket aperto');
      if (ticket.priorita === 'urgente') d.notif.anomalia('ticket_urgente', { ref: ticket.ref, business: ticket.business });
    }
    return reply.code(nuovo ? 201 : 200).send({
      ref: ticket.ref, id: Number(ticket.id), nuovo, stato: ticket.stato, priorita: ticket.priorita, piano_sla: ticket.piano_sla, scade_prima_risposta: ticket.scade_prima_risposta, scade_risoluzione: ticket.scade_risoluzione,
    });
  });

  app.post<{ Params: { ref: string }; Body: { da: 'cliente' | 'staff'; testo?: string } }>(
    '/v1/ticket/:ref/messaggi',
    {
      preHandler: [autenticaScrittura],
      schema: { body: { type: 'object', additionalProperties: false, required: ['da'], properties: { da: { type: 'string', enum: ['cliente', 'staff'] }, testo: testo(8000) } } },
    },
    async (req, reply) => {
      // Una fonte può scrivere solo sui propri ticket.
      if (req.fonteTicket && !req.params.ref.startsWith(`${req.fonteTicket.fonte}|`)) return reply.code(403).send({ errore: 'ticket di un\'altra fonte' });
      const chi = req.fonteTicket?.fonte ?? req.chiamante ?? 'api';
      const r = await aggiungiMessaggio(d.pool, req.params.ref, { da: req.body.da, testo: req.body.testo, chi });
      if (r.daRiaprire) d.notif.anomalia('ticket_risposta_su_chiuso', { ref: r.ticket.ref, azione: 'il cliente ha scritto su un ticket chiuso: riaprirlo in ClickUp' });
      return { ref: r.ticket.ref, stato: r.ticket.stato, da_riaprire: r.daRiaprire };
    },
  );

  app.post<{ Body: { parte?: ParteSync; completa?: boolean } }>(
    '/v1/sync/esegui',
    {
      preHandler: [autentica(['owner'])],
      schema: { body: { type: 'object', additionalProperties: false, properties: { parte: { type: 'string', enum: ['clienti', 'ticket', 'tutto'] }, completa: { type: 'boolean' } } } },
    },
    async (req: FastifyRequest<{ Body: { parte?: ParteSync; completa?: boolean } }>, reply: FastifyReply) => {
      if (!d.sincronizza) return reply.code(404).send({ errore: 'sincronizzazione con ClickUp non configurata' });
      const r = await d.sincronizza(req.body?.parte ?? 'tutto', req.body?.completa ?? false);
      if (r === 'occupato') return reply.code(409).send({ errore: 'una sincronizzazione è già in corso' });
      return r;
    },
  );
}

export { AMBITO_TOTALE, ErroreKpi };
