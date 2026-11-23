import type pg from 'pg';
import type { CampiClienti } from './config.js';
import type { TaskCrm } from './clickup.js';
import { DOC_DI_CLIENTE, TOT_DOC, Condizioni, businessEffettivi, limiteOffset, normalizzaEmail, normalizzaPiva, perIlike, type Ambito } from './sql.js';

/** Scheda cliente come la tiene la cache locale (copia di ClickUp, #45). */
export interface ClienteCache {
  clickup_task_id: string;
  nome: string;
  email: string | null;
  partita_iva: string | null;
  codice_fiscale: string | null;
  telefono: string | null;
  businesses: string[];
  stato: string | null;
  tag: string[];
  creato_il: Date | null;
  modificato_il: Date | null;
}

const comeTesto = (v: string | string[] | null | undefined): string | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Elenco di attività da un campo (menu, etichette o testo separato da virgola), con gli alias di ClickUp ("reti" → "reti.gazzolaelia.it"). */
export function businessDaCampo(v: string | string[] | null | undefined, alias: Record<string, string>): string[] {
  const grezzi = Array.isArray(v) ? v : (v ?? '').split(',');
  const fuori = new Set<string>();
  for (const g of grezzi) {
    const k = g.trim().toLowerCase();
    if (!k) continue;
    const nome = alias[k] ?? k;
    if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(nome)) fuori.add(nome);
  }
  return [...fuori];
}

export function clienteDaTask(t: TaskCrm, campi: CampiClienti, alias: Record<string, string> = {}): ClienteCache {
  const v = (id?: string) => (id ? t.campi[id] : undefined);
  return {
    clickup_task_id: t.id,
    nome: t.nome.trim() || '(senza nome)',
    email: normalizzaEmail(comeTesto(v(campi.email))),
    partita_iva: normalizzaPiva(comeTesto(v(campi.partitaIva))),
    codice_fiscale: comeTesto(v(campi.codiceFiscale))?.replace(/\s+/g, '').toUpperCase() || null,
    telefono: comeTesto(v(campi.telefono)),
    businesses: businessDaCampo(v(campi.business), alias),
    stato: t.stato.nome || null,
    tag: t.tag,
    creato_il: t.creata,
    modificato_il: t.modificata,
  };
}

export async function salvaClienti(db: pg.Pool | pg.PoolClient, righe: ClienteCache[]): Promise<void> {
  for (const c of righe) {
    await db.query(
      `INSERT INTO crm_clienti (clickup_task_id, nome, email, partita_iva, codice_fiscale, telefono, businesses, stato, tag, creato_il, modificato_il, sync_il, eliminato)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), false)
       ON CONFLICT (clickup_task_id) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email, partita_iva = EXCLUDED.partita_iva,
         codice_fiscale = EXCLUDED.codice_fiscale, telefono = EXCLUDED.telefono, businesses = EXCLUDED.businesses, stato = EXCLUDED.stato,
         tag = EXCLUDED.tag, creato_il = EXCLUDED.creato_il, modificato_il = EXCLUDED.modificato_il, sync_il = now(), eliminato = false`,
      [c.clickup_task_id, c.nome, c.email, c.partita_iva, c.codice_fiscale, c.telefono, c.businesses, c.stato, c.tag, c.creato_il, c.modificato_il],
    );
  }
}

/** Ticket senza scheda cliente collegata: dopo una sincronizzazione dei clienti si riprova il collegamento per email e partita IVA. */
export async function collegaTicketAiClienti(db: pg.Pool): Promise<number> {
  const r = await db.query(
    `UPDATE ticket t SET cliente_task_id = c.clickup_task_id, aggiornato_il = now()
       FROM crm_clienti c
      WHERE t.cliente_task_id IS NULL AND NOT c.eliminato AND t.cliente_email IS NOT NULL AND c.email IS NOT NULL AND lower(t.cliente_email) = lower(c.email)`,
  );
  return r.rowCount ?? 0;
}

export interface FiltroClienti {
  business?: string[];
  q?: string;
  stato?: string;
  conTicketAperti?: boolean;
  senzaFatture?: boolean;
  ordine?: 'nome' | 'recenti' | 'ticket' | 'fatturato';
  limite?: number;
  offset?: number;
}

/**
 * Elenco clienti con i numeri che servono a colpo d'occhio: ticket aperti e, per chi vede gli importi, fatture e fatturato 12 mesi.
 * Con un ambito ristretto ticket e documenti sono contati solo per le attività consentite.
 */
export async function elencoClienti(pool: pg.Pool, ambito: Ambito, f: FiltroClienti) {
  const cond = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  cond.fissa('NOT c.eliminato');
  if (b !== null) cond.aggiungi('c.businesses && ?::text[]', b);
  if (f.q) cond.aggiungi(`(c.nome ILIKE ? OR c.email ILIKE ? OR c.partita_iva ILIKE ? OR c.telefono ILIKE ?)`, perIlike(f.q));
  if (f.stato) cond.aggiungi('c.stato ILIKE ?', perIlike(f.stato));
  // $bt serve nelle LATERAL: null = tutte le attività.
  const bt = cond.parametro(b);
  if (f.conTicketAperti) cond.fissa('COALESCE(t.aperti, 0) > 0');
  if (f.senzaFatture) cond.fissa('COALESCE(d.n_fatture, 0) = 0');
  const ordini = {
    nome: 'lower(c.nome) ASC',
    recenti: 'c.creato_il DESC NULLS LAST',
    ticket: 'COALESCE(t.aperti, 0) DESC, lower(c.nome) ASC',
    fatturato: 'COALESCE(d.fatt12, 0) DESC, lower(c.nome) ASC',
  } as const;
  const ordine = f.ordine === 'fatturato' && !ambito.soldi ? 'nome' : (f.ordine ?? 'nome');
  const { limite, offset } = limiteOffset(f.limite, f.offset);
  const r = await pool.query(
    `SELECT c.clickup_task_id, c.nome, c.email, c.partita_iva, c.telefono, c.businesses, c.stato, c.tag, c.creato_il, c.sync_il,
            COALESCE(t.aperti, 0) AS ticket_aperti, COALESCE(t.totali, 0) AS ticket_totali,
            ${ambito.soldi ? 'COALESCE(d.n_fatture, 0) AS fatture, d.ultima_fattura, COALESCE(d.fatt12, 0) AS fatturato_12m' : 'NULL::int AS fatture, NULL::timestamptz AS ultima_fattura, NULL::numeric AS fatturato_12m'},
            count(*) OVER()::int AS totale
       FROM crm_clienti c
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE stato NOT IN ('risolto','chiuso'))::int AS aperti, count(*)::int AS totali
           FROM ticket WHERE cliente_task_id = c.clickup_task_id AND (${bt}::text[] IS NULL OR business = ANY(${bt}::text[]))
       ) t ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n_fatture, max(x.quando) AS ultima_fattura,
                COALESCE(sum(x.tot) FILTER (WHERE x.quando > now() - interval '12 months'), 0) AS fatt12
           FROM (SELECT d.data_riserva AS quando, ${TOT_DOC} AS tot FROM documenti d
                  WHERE d.tipo = 'fattura' AND d.stato <> 'annullato' AND ${DOC_DI_CLIENTE}
                    AND (${bt}::text[] IS NULL OR d.business = ANY(${bt}::text[]))) x
       ) d ON true
      ${cond.where}
      ORDER BY ${ordini[ordine]} LIMIT ${cond.parametro(limite)} OFFSET ${cond.parametro(offset)}`,
    cond.params,
  );
  const righe = r.rows as (Record<string, unknown> & { totale: number })[];
  return { totale: righe[0]?.totale ?? 0, clienti: righe.map(({ totale: _t, ...resto }) => resto) };
}

export async function dettaglioCliente(pool: pg.Pool, ambito: Ambito, id: string) {
  const cl = await pool.query('SELECT clickup_task_id, nome, email, partita_iva, codice_fiscale, telefono, businesses, stato, tag, creato_il, modificato_il, sync_il, eliminato FROM crm_clienti c WHERE clickup_task_id = $1', [id]);
  const cliente = cl.rows[0] as { businesses: string[] } | undefined;
  if (!cliente) return undefined;
  // Chi ha un ambito ristretto vede la scheda solo se il cliente compra per una sua attività.
  if (ambito.business !== null && !cliente.businesses.some((x) => ambito.business!.includes(x))) return undefined;
  const b = ambito.business;
  const [ticket, documenti] = await Promise.all([
    pool.query(
      `SELECT ref, fonte, business, oggetto, priorita, stato, aperto_il, risolto_il FROM ticket
        WHERE cliente_task_id = $1 AND ($2::text[] IS NULL OR business = ANY($2::text[])) ORDER BY aperto_il DESC LIMIT 50`,
      [id, b],
    ),
    ambito.soldi
      ? pool.query(
          `SELECT d.ref, d.tipo, d.anno, d.numero, d.stato, d.business, d.data_riserva, ${TOT_DOC} AS totale
             FROM documenti d JOIN crm_clienti c ON c.clickup_task_id = $1
            WHERE ${DOC_DI_CLIENTE} AND ($2::text[] IS NULL OR d.business = ANY($2::text[]))
            ORDER BY d.data_riserva DESC LIMIT 50`,
          [id, b],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  return { ...cliente, ticket: ticket.rows, documenti: ambito.soldi ? documenti.rows : null };
}
