import type pg from 'pg';
import { SLA_RISOLUZIONE_SCADUTA, SLA_RISPOSTA_SCADUTA } from './ticket.js';
import { Condizioni, DOC_DI_CLIENTE, EMAIL_DOC, PIVA_DOC, TOT_DOC, businessEffettivi, type Ambito } from './sql.js';

export type Granularita = 'giorno' | 'settimana' | 'mese';
const UNITA: Record<Granularita, string> = { giorno: 'day', settimana: 'week', mese: 'month' };
const MAX_PUNTI = 400;

export interface FiltroKpi {
  business?: string[];
  fonte?: string[];
  /** Inizio del periodo (incluso) e fine (esclusa). */
  da: Date;
  a: Date;
}

export class ErroreKpi extends Error {}

const ore = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const num = (v: unknown): number => Number(v ?? 0);
const euro = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;
const pct = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

/** Condizioni sui ticket (attività e fonte) più i segnaposto del periodo. */
function perTicket(ambito: Ambito, f: FiltroKpi, conPeriodo = true) {
  const c = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) c.aggiungi('business = ANY(?)', b);
  if (f.fonte?.length) c.aggiungi('fonte = ANY(?)', f.fonte);
  // Senza periodo non si aggiungono parametri: Postgres rifiuta quelli che nessuna query usa.
  if (!conPeriodo) return { c, da: '', a: '' };
  const da = `${c.parametro(f.da.toISOString())}::timestamptz`;
  const a = `${c.parametro(f.a.toISOString())}::timestamptz`;
  return { c, da, a };
}

/** Condizioni sui documenti (alias d): solo fatture/proforme dell'ambito. */
function perDocumenti(ambito: Ambito, f: FiltroKpi) {
  const c = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) c.aggiungi('d.business = ANY(?)', b);
  c.fissa(`d.stato <> 'annullato'`);
  const da = `${c.parametro(f.da.toISOString())}::timestamptz`;
  const a = `${c.parametro(f.a.toISOString())}::timestamptz`;
  return { c, da, a };
}

function perClienti(ambito: Ambito, f: FiltroKpi) {
  const c = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  c.fissa('NOT c.eliminato');
  if (b !== null) c.aggiungi('c.businesses && ?::text[]', b);
  const da = `${c.parametro(f.da.toISOString())}::timestamptz`;
  const a = `${c.parametro(f.a.toISOString())}::timestamptz`;
  return { c, da, a };
}

export function controllaPeriodo(f: FiltroKpi, gran?: Granularita): void {
  if (!(f.da < f.a)) throw new ErroreKpi('periodo non valido: "da" deve precedere "a"');
  const giorni = (f.a.getTime() - f.da.getTime()) / 86_400_000;
  if (giorni > 3660) throw new ErroreKpi('periodo troppo lungo (massimo 10 anni)');
  if (gran) {
    const punti = gran === 'giorno' ? giorni : gran === 'settimana' ? giorni / 7 : giorni / 30;
    if (punti > MAX_PUNTI) throw new ErroreKpi(`troppi punti per la granularità "${gran}": restringi il periodo o usa una granularità più larga`);
  }
}

/** KPI ticket: carico attuale, flusso nel periodo, tempi di risposta e rispetto dell'SLA. */
export async function kpiTicket(pool: pg.Pool, ambito: Ambito, f: FiltroKpi) {
  const { c, da, a } = perTicket(ambito, f);
  const r = await pool.query(
    `SELECT
       count(*) FILTER (WHERE stato = 'aperto')::int AS da_prendere,
       count(*) FILTER (WHERE stato = 'in_lavorazione')::int AS in_lavorazione,
       count(*) FILTER (WHERE stato = 'in_attesa_cliente')::int AS in_attesa_cliente,
       count(*) FILTER (WHERE stato NOT IN ('risolto','chiuso'))::int AS backlog,
       count(*) FILTER (WHERE stato NOT IN ('risolto','chiuso') AND priorita IN ('urgente','alta'))::int AS backlog_urgenti,
       count(*) FILTER (WHERE ${SLA_RISPOSTA_SCADUTA})::int AS sla_risposta_scaduti,
       count(*) FILTER (WHERE ${SLA_RISOLUZIONE_SCADUTA})::int AS sla_risoluzione_scaduti,
       extract(epoch FROM avg(now() - aperto_il) FILTER (WHERE stato NOT IN ('risolto','chiuso'))) / 3600 AS eta_media_backlog_ore,
       count(*) FILTER (WHERE aperto_il >= ${da} AND aperto_il < ${a})::int AS arrivati,
       count(*) FILTER (WHERE risolto_il >= ${da} AND risolto_il < ${a})::int AS risolti,
       extract(epoch FROM avg(prima_risposta_il - aperto_il) FILTER (WHERE prima_risposta_il IS NOT NULL AND aperto_il >= ${da} AND aperto_il < ${a})) / 3600 AS prima_risposta_media_ore,
       extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY prima_risposta_il - aperto_il) FILTER (WHERE prima_risposta_il IS NOT NULL AND aperto_il >= ${da} AND aperto_il < ${a})) / 3600 AS prima_risposta_mediana_ore,
       extract(epoch FROM avg(risolto_il - aperto_il) FILTER (WHERE risolto_il >= ${da} AND risolto_il < ${a})) / 3600 AS risoluzione_media_ore,
       -- SLA risposta: tra i ticket arrivati nel periodo che hanno già avuto risposta o hanno già superato la scadenza
       count(*) FILTER (WHERE aperto_il >= ${da} AND aperto_il < ${a} AND scade_prima_risposta IS NOT NULL AND (prima_risposta_il IS NOT NULL OR scade_prima_risposta < now()))::int AS sla_risposta_valutati,
       count(*) FILTER (WHERE aperto_il >= ${da} AND aperto_il < ${a} AND prima_risposta_il IS NOT NULL AND prima_risposta_il <= scade_prima_risposta)::int AS sla_risposta_rispettati,
       -- SLA risoluzione: tra i ticket risolti nel periodo
       count(*) FILTER (WHERE risolto_il >= ${da} AND risolto_il < ${a} AND scade_risoluzione IS NOT NULL)::int AS sla_risoluzione_valutati,
       count(*) FILTER (WHERE risolto_il >= ${da} AND risolto_il < ${a} AND risolto_il <= scade_risoluzione)::int AS sla_risoluzione_rispettati
     FROM ticket ${c.where}`,
    c.params,
  );
  const x = r.rows[0]!;
  return {
    da_prendere: num(x.da_prendere),
    in_lavorazione: num(x.in_lavorazione),
    in_attesa_cliente: num(x.in_attesa_cliente),
    backlog: num(x.backlog),
    backlog_urgenti: num(x.backlog_urgenti),
    eta_media_backlog_ore: ore(x.eta_media_backlog_ore),
    sla_risposta_scaduti: num(x.sla_risposta_scaduti),
    sla_risoluzione_scaduti: num(x.sla_risoluzione_scaduti),
    arrivati: num(x.arrivati),
    risolti: num(x.risolti),
    prima_risposta_media_ore: ore(x.prima_risposta_media_ore),
    prima_risposta_mediana_ore: ore(x.prima_risposta_mediana_ore),
    risoluzione_media_ore: ore(x.risoluzione_media_ore),
    sla_risposta_pct: pct(num(x.sla_risposta_rispettati), num(x.sla_risposta_valutati)),
    sla_risoluzione_pct: pct(num(x.sla_risoluzione_rispettati), num(x.sla_risoluzione_valutati)),
  };
}

/** KPI clienti. Chi non vede gli importi non ha il conteggio dei clienti attivi (si ricava dalle fatture). */
export async function kpiClienti(pool: pg.Pool, ambito: Ambito, f: FiltroKpi) {
  const cl = perClienti(ambito, f);
  const attivi = ambito.soldi
    ? `count(*) FILTER (WHERE EXISTS (SELECT 1 FROM documenti d WHERE d.tipo = 'fattura' AND d.stato <> 'annullato' AND d.data_riserva > now() - interval '12 months' AND ${DOC_DI_CLIENTE}))::int`
    : 'NULL::int';
  const r = await pool.query(
    `SELECT count(*)::int AS totali,
            count(*) FILTER (WHERE c.creato_il >= ${cl.da} AND c.creato_il < ${cl.a})::int AS nuovi,
            count(*) FILTER (WHERE cardinality(c.businesses) > 1)::int AS multi_business,
            ${attivi} AS attivi_12m,
            max(c.sync_il) AS aggiornato_il
       FROM crm_clienti c ${cl.c.where}`,
    cl.c.params,
  );
  const b = businessEffettivi(ambito, f.business);
  const tk = await pool.query(
    `SELECT count(DISTINCT cliente_task_id)::int AS n FROM ticket WHERE cliente_task_id IS NOT NULL AND stato NOT IN ('risolto','chiuso') AND ($1::text[] IS NULL OR business = ANY($1::text[]))`,
    [b],
  );
  const x = r.rows[0]!;
  return {
    totali: num(x.totali),
    nuovi: num(x.nuovi),
    multi_business: num(x.multi_business),
    attivi_12m: x.attivi_12m === null ? null : num(x.attivi_12m),
    con_ticket_aperti: num(tk.rows[0]!.n),
    aggiornato_il: x.aggiornato_il ?? null,
  };
}

/** Fatturato per attività nel periodo. Solo per chi vede gli importi. Gli importi sono la somma delle righe, prima del bollo. */
export async function kpiFatturato(pool: pg.Pool, ambito: Ambito, f: FiltroKpi) {
  if (!ambito.soldi) return null;
  const { c, da, a } = perDocumenti(ambito, f);
  c.fissa(`d.data_riserva >= ${da} AND d.data_riserva < ${a}`);
  const per = await pool.query(
    `SELECT COALESCE(d.business, '(senza attività)') AS business,
            count(*) FILTER (WHERE d.tipo = 'fattura')::int AS fatture,
            COALESCE(sum(${TOT_DOC}) FILTER (WHERE d.tipo = 'fattura'), 0) AS fatturato,
            count(*) FILTER (WHERE d.tipo = 'proforma')::int AS proforme,
            COALESCE(sum(${TOT_DOC}) FILTER (WHERE d.tipo = 'proforma'), 0) AS proforme_importo
       FROM documenti d ${c.where} GROUP BY 1 ORDER BY 3 DESC`,
    c.params,
  );
  const per_business = per.rows.map((x) => ({ business: x.business as string, fatture: num(x.fatture), fatturato: euro(x.fatturato), proforme: num(x.proforme), proforme_importo: euro(x.proforme_importo) }));
  const fatture = per_business.reduce((s, x) => s + x.fatture, 0);
  const fatturato = Math.round(per_business.reduce((s, x) => s + x.fatturato, 0) * 100) / 100;
  const top = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) top.aggiungi('d.business = ANY(?)', b);
  top.fissa(`d.tipo = 'fattura' AND d.stato <> 'annullato'`);
  top.fissa(`d.data_riserva >= ${top.parametro(f.da.toISOString())}::timestamptz AND d.data_riserva < ${top.parametro(f.a.toISOString())}::timestamptz`);
  const t = await pool.query(
    `SELECT COALESCE(${PIVA_DOC}, ${EMAIL_DOC}, d.ref) AS chiave,
            max(COALESCE(d.payload->'cliente'->>'ragione_sociale', d.payload->'cliente'->>'nome', d.payload->'cliente'->>'email')) AS nome,
            count(*)::int AS fatture, sum(${TOT_DOC}) AS fatturato
       FROM documenti d ${top.where} GROUP BY 1 ORDER BY 4 DESC LIMIT 10`,
    top.params,
  );
  return {
    fatture,
    fatturato,
    media_fattura: fatture ? Math.round((fatturato / fatture) * 100) / 100 : null,
    per_business,
    top_clienti: t.rows.map((x) => ({ nome: x.nome as string, fatture: num(x.fatture), fatturato: euro(x.fatturato) })),
  };
}

/** Quanti ticket (aperti nel periodo) per fonte, priorità, categoria e assegnatario; più i backlog per attività. */
export async function distribuzioni(pool: pg.Pool, ambito: Ambito, f: FiltroKpi) {
  const out: Record<string, { voce: string; n: number }[]> = {};
  const colonne: Record<string, string> = {
    per_fonte: 'fonte',
    per_priorita: 'priorita',
    per_categoria: `COALESCE(categoria, '(nessuna)')`,
    per_assegnato: `COALESCE(assegnato_a, '(non assegnato)')`,
    per_stato: 'stato',
  };
  for (const [nome, col] of Object.entries(colonne)) {
    const { c, da, a } = perTicket(ambito, f, nome !== 'per_stato');
    if (nome !== 'per_stato') c.fissa(`aperto_il >= ${da} AND aperto_il < ${a}`);
    const r = await pool.query(`SELECT ${col} AS voce, count(*)::int AS n FROM ticket ${c.where} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12`, c.params);
    out[nome] = r.rows.map((x) => ({ voce: String(x.voce), n: num(x.n) }));
  }
  return out;
}

/** Confronto fra attività: una riga per attività con ticket, SLA, clienti e (se visibili) fatturato. */
export async function perBusiness(pool: pg.Pool, ambito: Ambito, f: FiltroKpi) {
  const t = perTicket(ambito, f);
  const tk = await pool.query(
    `SELECT business,
            count(*) FILTER (WHERE stato NOT IN ('risolto','chiuso'))::int AS backlog,
            count(*) FILTER (WHERE ${SLA_RISPOSTA_SCADUTA} OR ${SLA_RISOLUZIONE_SCADUTA})::int AS sla_scaduti,
            count(*) FILTER (WHERE aperto_il >= ${t.da} AND aperto_il < ${t.a})::int AS arrivati,
            count(*) FILTER (WHERE risolto_il >= ${t.da} AND risolto_il < ${t.a})::int AS risolti,
            extract(epoch FROM avg(prima_risposta_il - aperto_il) FILTER (WHERE prima_risposta_il IS NOT NULL AND aperto_il >= ${t.da} AND aperto_il < ${t.a})) / 3600 AS prima_risposta_media_ore
       FROM ticket ${t.c.where} GROUP BY 1`,
    t.c.params,
  );
  const b = businessEffettivi(ambito, f.business);
  const cl = await pool.query(
    `SELECT b AS business, count(*)::int AS clienti FROM crm_clienti c, unnest(c.businesses) b WHERE NOT c.eliminato AND ($1::text[] IS NULL OR b = ANY($1::text[])) GROUP BY 1`,
    [b],
  );
  const fat = await kpiFatturato(pool, ambito, f);
  const mappa = new Map<string, Record<string, unknown>>();
  const riga = (nome: string) => {
    if (!mappa.has(nome)) mappa.set(nome, { business: nome, backlog: 0, sla_scaduti: 0, arrivati: 0, risolti: 0, prima_risposta_media_ore: null, clienti: 0, fatture: ambito.soldi ? 0 : null, fatturato: ambito.soldi ? 0 : null });
    return mappa.get(nome)!;
  };
  for (const x of tk.rows) Object.assign(riga(x.business), { backlog: num(x.backlog), sla_scaduti: num(x.sla_scaduti), arrivati: num(x.arrivati), risolti: num(x.risolti), prima_risposta_media_ore: ore(x.prima_risposta_media_ore) });
  for (const x of cl.rows) Object.assign(riga(x.business), { clienti: num(x.clienti) });
  for (const x of fat?.per_business ?? []) Object.assign(riga(x.business), { fatture: x.fatture, fatturato: x.fatturato });
  return [...mappa.values()].sort((p, q) => String(p.business).localeCompare(String(q.business)));
}

/** Serie nel tempo (giorno, settimana o mese): ticket arrivati e risolti, nuovi clienti e fatturato. Date nel fuso Europe/Rome. */
export async function serie(pool: pg.Pool, ambito: Ambito, f: FiltroKpi, gran: Granularita) {
  controllaPeriodo(f, gran);
  const u = UNITA[gran];
  const periodi = await pool.query<{ p: string }>(
    `SELECT to_char(g, 'YYYY-MM-DD') AS p FROM generate_series(date_trunc('${u}', $1::timestamptz AT TIME ZONE 'Europe/Rome'), $2::timestamptz AT TIME ZONE 'Europe/Rome', '1 ${u}'::interval) g ORDER BY 1`,
    [f.da.toISOString(), f.a.toISOString()],
  );
  const punti = new Map<string, { periodo: string; ticket_arrivati: number; ticket_risolti: number; nuovi_clienti: number; fatturato: number | null }>();
  for (const x of periodi.rows) punti.set(x.p, { periodo: x.p, ticket_arrivati: 0, ticket_risolti: 0, nuovi_clienti: 0, fatturato: ambito.soldi ? 0 : null });

  const raggruppa = (col: string) => `to_char(date_trunc('${u}', ${col} AT TIME ZONE 'Europe/Rome'), 'YYYY-MM-DD')`;
  const t1 = perTicket(ambito, f);
  t1.c.fissa(`aperto_il >= ${t1.da} AND aperto_il < ${t1.a}`);
  const t2 = perTicket(ambito, f);
  t2.c.fissa(`risolto_il >= ${t2.da} AND risolto_il < ${t2.a}`);
  const c1 = perClienti(ambito, f);
  c1.c.fissa(`c.creato_il >= ${c1.da} AND c.creato_il < ${c1.a}`);
  const [arr, ris, cli] = await Promise.all([
    pool.query(`SELECT ${raggruppa('aperto_il')} AS p, count(*)::int AS n FROM ticket ${t1.c.where} GROUP BY 1`, t1.c.params),
    pool.query(`SELECT ${raggruppa('risolto_il')} AS p, count(*)::int AS n FROM ticket ${t2.c.where} GROUP BY 1`, t2.c.params),
    pool.query(`SELECT ${raggruppa('c.creato_il')} AS p, count(*)::int AS n FROM crm_clienti c ${c1.c.where} GROUP BY 1`, c1.c.params),
  ]);
  for (const x of arr.rows) if (punti.has(x.p)) punti.get(x.p)!.ticket_arrivati = num(x.n);
  for (const x of ris.rows) if (punti.has(x.p)) punti.get(x.p)!.ticket_risolti = num(x.n);
  for (const x of cli.rows) if (punti.has(x.p)) punti.get(x.p)!.nuovi_clienti = num(x.n);
  if (ambito.soldi) {
    const d = perDocumenti(ambito, f);
    d.c.fissa(`d.tipo = 'fattura' AND d.data_riserva >= ${d.da} AND d.data_riserva < ${d.a}`);
    const fat = await pool.query(`SELECT ${raggruppa('d.data_riserva')} AS p, sum(${TOT_DOC}) AS n FROM documenti d ${d.c.where} GROUP BY 1`, d.c.params);
    for (const x of fat.rows) if (punti.has(x.p)) punti.get(x.p)!.fatturato = euro(x.n);
  }
  return [...punti.values()];
}

/** Tutto ciò che serve alla pagina iniziale della dashboard in una sola chiamata. */
export async function panoramica(pool: pg.Pool, ambito: Ambito, f: FiltroKpi, gran: Granularita) {
  controllaPeriodo(f, gran);
  const [ticket, clienti, fatturato, dist, business, andamento, sync] = await Promise.all([
    kpiTicket(pool, ambito, f),
    kpiClienti(pool, ambito, f),
    kpiFatturato(pool, ambito, f),
    distribuzioni(pool, ambito, f),
    perBusiness(pool, ambito, f),
    serie(pool, ambito, f, gran),
    statoSync(pool),
  ]);
  return { periodo: { da: f.da.toISOString(), a: f.a.toISOString(), granularita: gran }, ticket, clienti, fatturato, distribuzioni: dist, per_business: business, serie: andamento, sync };
}

export async function statoSync(pool: pg.Pool) {
  const r = await pool.query(`SELECT nome, ultimo_inizio, ultimo_ok, ultimo_errore, dettaglio FROM crm_sync ORDER BY nome`);
  return r.rows;
}
