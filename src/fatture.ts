// Sezione Fatturazione del portale (#46): solo lettura, filtrabile. Chi non vede gli importi (ruolo assistenza) non ha questa sezione.
import type pg from 'pg';
import { ErroreCrm } from './crm-ops.js';
import { TOT_DOC, Condizioni, businessEffettivi, limiteOffset, perIlike, type Ambito } from './sql.js';

export interface FiltroDocumenti {
  tipo?: string[];
  stato?: string[];
  fonte?: string[];
  business?: string[];
  anno?: number;
  q?: string;
  cliente?: string;
  da?: string;
  a?: string;
  importoMin?: number;
  importoMax?: number;
  ordine?: 'recenti' | 'vecchi' | 'importo' | 'numero';
  limite?: number;
  offset?: number;
}

const ORDINI = {
  recenti: 'd.data_riserva DESC, d.id DESC',
  vecchi: 'd.data_riserva ASC, d.id ASC',
  importo: 'totale DESC, d.id DESC',
  numero: 'd.anno DESC, d.tipo, d.numero DESC',
} as const;

const NOME_CLIENTE = `COALESCE(NULLIF(d.payload->'cliente'->>'ragione_sociale', ''), NULLIF(d.payload->'cliente'->>'nome', ''), d.payload->'cliente'->>'email')`;

function richiedi(ambito: Ambito) {
  if (!ambito.soldi) throw new ErroreCrm(403, 'la sezione Fatturazione non è disponibile per questo ruolo');
}

/** `esporta` toglie il limite di pagina (fino a 5000 righe) per il CSV. */
export async function elencoDocumenti(pool: pg.Pool, ambito: Ambito, f: FiltroDocumenti, esporta = false) {
  richiedi(ambito);
  const cond = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) cond.aggiungi('d.business = ANY(?)', b);
  if (f.tipo?.length) cond.aggiungi('d.tipo = ANY(?)', f.tipo);
  if (f.stato?.length) cond.aggiungi('d.stato = ANY(?)', f.stato);
  if (f.fonte?.length) cond.aggiungi('d.fonte = ANY(?)', f.fonte);
  if (f.anno) cond.aggiungi('d.anno = ?', f.anno);
  if (f.da) cond.aggiungi('d.data_riserva >= ?::timestamptz', f.da);
  if (f.a) cond.aggiungi('d.data_riserva < ?::timestamptz', f.a);
  if (f.cliente) {
    // Il testo contiene "(?=" (espressione regolare): il segnaposto va preso con parametro(), non con "?".
    const p = cond.parametro(f.cliente);
    cond.fissa(
      `EXISTS (SELECT 1 FROM crm_clienti c WHERE c.clickup_task_id = ${p} AND ((c.partita_iva IS NOT NULL AND NULLIF(regexp_replace(upper(d.payload->'cliente'->>'partita_iva'), '^IT(?=[0-9]{11}$)', ''), '') = c.partita_iva)
         OR (c.email IS NOT NULL AND NULLIF(lower(d.payload->'cliente'->>'email'), '') = lower(c.email))))`,
    );
  }
  if (f.q) {
    cond.aggiungi(
      `(d.ref ILIKE ? OR (d.numero::text || '/' || d.anno::text) ILIKE ? OR ${NOME_CLIENTE} ILIKE ? OR d.payload->'cliente'->>'partita_iva' ILIKE ? OR d.payload->'cliente'->>'email' ILIKE ?)`,
      perIlike(f.q),
    );
  }
  if (f.importoMin !== undefined) cond.aggiungi(`${TOT_DOC} >= ?`, f.importoMin);
  if (f.importoMax !== undefined) cond.aggiungi(`${TOT_DOC} <= ?`, f.importoMax);
  const { limite, offset } = esporta ? { limite: 5000, offset: 0 } : limiteOffset(f.limite, f.offset);
  const r = await pool.query(
    `SELECT d.ref, d.tipo, d.anno, d.numero, d.stato, d.fonte, d.business, d.data_riserva, d.clickup_task_id, ${NOME_CLIENTE} AS cliente_nome,
            d.payload->'cliente'->>'partita_iva' AS partita_iva, d.payload->'cliente'->>'email' AS email, d.payload->>'rif_proforma' AS rif_proforma,
            ${TOT_DOC} AS totale, count(*) OVER()::int AS n_totale,
            COALESCE(sum(${TOT_DOC}) FILTER (WHERE d.stato <> 'annullato') OVER(), 0) AS somma_totale
       FROM documenti d ${cond.where} ORDER BY ${ORDINI[f.ordine ?? 'recenti']} LIMIT ${cond.parametro(limite)} OFFSET ${cond.parametro(offset)}`,
    cond.params,
  );
  const righe = r.rows as (Record<string, unknown> & { n_totale: number; somma_totale: string })[];
  return {
    totale: righe[0]?.n_totale ?? 0,
    // Somma dei documenti non annullati che corrispondono ai filtri (su tutta la selezione, non solo sulla pagina).
    somma: Number(righe[0]?.somma_totale ?? 0),
    documenti: righe.map(({ n_totale: _n, somma_totale: _s, ...resto }) => resto),
  };
}

export async function dettaglioDocumento(pool: pg.Pool, ambito: Ambito, ref: string) {
  richiedi(ambito);
  const cond = new Condizioni();
  cond.aggiungi('d.ref = ?', ref);
  const b = businessEffettivi(ambito);
  if (b !== null) cond.aggiungi('d.business = ANY(?)', b);
  const r = await pool.query(
    `SELECT d.ref, d.tipo, d.anno, d.numero, d.stato, d.fonte, d.business, d.data_riserva, d.clickup_task_id, d.note_annullo, d.payload, ${TOT_DOC} AS totale FROM documenti d ${cond.where}`,
    cond.params,
  );
  const d = r.rows[0] as { payload: { cliente?: { partita_iva?: string; email?: string } } } | undefined;
  if (!d) return undefined;
  const [storico, cliente] = await Promise.all([
    pool.query('SELECT s.quando, s.da_stato, s.a_stato FROM storico s JOIN documenti d ON d.id = s.documento_id WHERE d.ref = $1 ORDER BY s.id', [ref]),
    pool.query(
      `SELECT clickup_task_id, nome FROM crm_clienti c WHERE NOT eliminato AND ((c.partita_iva IS NOT NULL AND c.partita_iva = NULLIF(regexp_replace(upper($1::text), '^IT(?=[0-9]{11}$)', ''), ''))
         OR (c.email IS NOT NULL AND lower(c.email) = NULLIF(lower($2::text), ''))) LIMIT 1`,
      [d.payload.cliente?.partita_iva ?? null, d.payload.cliente?.email ?? null],
    ),
  ]);
  return { ...d, storico: storico.rows, scheda_cliente: cliente.rows[0] ?? null };
}

/** Totali per mese e tipo, per la barra di riepilogo della sezione (non annullati). */
export async function riepilogoMensile(pool: pg.Pool, ambito: Ambito, f: Pick<FiltroDocumenti, 'business' | 'anno'>) {
  richiedi(ambito);
  const cond = new Condizioni();
  cond.fissa(`d.stato <> 'annullato'`);
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) cond.aggiungi('d.business = ANY(?)', b);
  cond.aggiungi('d.anno = ?', f.anno ?? new Date().getFullYear());
  const r = await pool.query(
    `SELECT to_char(d.data_riserva AT TIME ZONE 'Europe/Rome', 'MM') AS mese, d.tipo, count(*)::int AS n, COALESCE(sum(${TOT_DOC}), 0) AS totale
       FROM documenti d ${cond.where} GROUP BY 1, 2 ORDER BY 1, 2`,
    cond.params,
  );
  return r.rows;
}
