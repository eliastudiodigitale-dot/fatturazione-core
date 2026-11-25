// Funzioni di servizio del portale: conteggi delle viste dei ticket, ricerca globale, risposte rapide.
import type pg from 'pg';
import { ErroreCrm } from './crm-ops.js';
import { Condizioni, TOT_DOC, businessEffettivi, perIlike, type Ambito } from './sql.js';
import { APERTO, SLA_A_RISCHIO, SLA_RISOLUZIONE_SCADUTA, SLA_RISPOSTA_SCADUTA } from './ticket.js';

/** Numeri accanto alle viste dei ticket (una sola query). `chi` = email o nome di chi guarda, per "Assegnati a me". */
export async function conteggiViste(pool: pg.Pool, ambito: Ambito, chi: string, business?: string[]) {
  const cond = new Condizioni();
  const b = businessEffettivi(ambito, business);
  if (b !== null) cond.aggiungi('business = ANY(?)', b);
  const mio = cond.parametro(chi);
  const r = await pool.query(
    `SELECT
       count(*) FILTER (WHERE ${APERTO})::int AS aperti,
       count(*) FILTER (WHERE stato = 'aperto' AND assegnato_a IS NULL)::int AS da_prendere,
       count(*) FILTER (WHERE ${APERTO} AND assegnato_a IS NULL)::int AS non_assegnati,
       count(*) FILTER (WHERE ${APERTO} AND lower(assegnato_a) = lower(${mio}::text))::int AS miei,
       count(*) FILTER (WHERE stato = 'in_attesa_cliente')::int AS in_attesa,
       count(*) FILTER (WHERE ${SLA_RISPOSTA_SCADUTA} OR ${SLA_RISOLUZIONE_SCADUTA})::int AS sla_scaduti,
       count(*) FILTER (WHERE ${SLA_A_RISCHIO})::int AS sla_a_rischio,
       count(*) FILTER (WHERE stato IN ('risolto','chiuso') AND risolto_il >= now() - interval '7 days')::int AS risolti_7g
     FROM ticket ${cond.where}`,
    cond.params,
  );
  return r.rows[0] as Record<string, number>;
}

/** Ricerca globale (ticket, clienti, documenti): pochi risultati per gruppo, solo nell'ambito di chi cerca. */
export async function cerca(pool: pg.Pool, ambito: Ambito, q: string, business?: string[]) {
  const testo = q.trim();
  if (testo.length < 2) return { ticket: [], clienti: [], documenti: [] };
  const like = perIlike(testo);
  const b = businessEffettivi(ambito, business);
  const [t, c, d] = await Promise.all([
    pool.query(
      `SELECT ref, oggetto, stato, priorita, business, cliente_nome, aperto_il FROM ticket
        WHERE ($1::text[] IS NULL OR business = ANY($1::text[])) AND (oggetto ILIKE $2 OR cliente_nome ILIKE $2 OR cliente_email ILIKE $2 OR ref ILIKE $2)
        ORDER BY (CASE WHEN ${APERTO} THEN 0 ELSE 1 END), aperto_il DESC LIMIT 6`,
      [b, like],
    ),
    pool.query(
      `SELECT clickup_task_id, nome, email, partita_iva, businesses FROM crm_clienti
        WHERE NOT eliminato AND ($1::text[] IS NULL OR businesses && $1::text[]) AND (nome ILIKE $2 OR email ILIKE $2 OR partita_iva ILIKE $2 OR telefono ILIKE $2)
        ORDER BY lower(nome) LIMIT 6`,
      [b, like],
    ),
    ambito.soldi
      ? pool.query(
          `SELECT d.ref, d.tipo, d.numero, d.anno, d.stato, d.business, COALESCE(NULLIF(d.payload->'cliente'->>'ragione_sociale', ''), d.payload->'cliente'->>'nome') AS cliente_nome, ${TOT_DOC} AS totale
             FROM documenti d
            WHERE ($1::text[] IS NULL OR d.business = ANY($1::text[]))
              AND (d.ref ILIKE $2 OR (d.numero::text || '/' || d.anno::text) ILIKE $2 OR d.payload->'cliente'->>'ragione_sociale' ILIKE $2 OR d.payload->'cliente'->>'nome' ILIKE $2 OR d.payload->'cliente'->>'partita_iva' ILIKE $2)
            ORDER BY d.data_riserva DESC LIMIT 6`,
          [b, like],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  return { ticket: t.rows, clienti: c.rows, documenti: d.rows };
}

// ------------------------------------------------------------------ risposte rapide

export interface DatiRisposta {
  nome?: string;
  testo?: string;
  business?: string | null;
}

/** Risposte valide per l'ambito: quelle di tutte le attività e quelle delle attività consentite. */
export async function elencoRisposte(pool: pg.Pool, ambito: Ambito) {
  const r = await pool.query(
    `SELECT id, nome, testo, business FROM risposte_rapide
      WHERE attivo AND ($1::text[] IS NULL OR business IS NULL OR business = ANY($1::text[])) ORDER BY lower(nome)`,
    [ambito.business],
  );
  return r.rows as { id: string; nome: string; testo: string; business: string | null }[];
}

export async function creaRisposta(pool: pg.Pool, r: DatiRisposta & { nome: string; testo: string }, chi: string): Promise<number> {
  const x = await pool.query<{ id: string }>('INSERT INTO risposte_rapide (nome, testo, business, creato_da) VALUES ($1,$2,$3,$4) RETURNING id', [r.nome.trim(), r.testo.trim(), r.business ?? null, chi]);
  return Number(x.rows[0]!.id);
}

export async function aggiornaRisposta(pool: pg.Pool, id: number, r: DatiRisposta): Promise<void> {
  const x = await pool.query(
    `UPDATE risposte_rapide SET nome = COALESCE($2, nome), testo = COALESCE($3, testo), business = CASE WHEN $4::boolean THEN $5 ELSE business END WHERE id = $1 AND attivo`,
    [id, r.nome?.trim() ?? null, r.testo?.trim() ?? null, r.business !== undefined, r.business ?? null],
  );
  if (!x.rowCount) throw new ErroreCrm(404, 'risposta non trovata');
}

export async function eliminaRisposta(pool: pg.Pool, id: number): Promise<void> {
  const x = await pool.query('UPDATE risposte_rapide SET attivo = false WHERE id = $1 AND attivo', [id]);
  if (!x.rowCount) throw new ErroreCrm(404, 'risposta non trovata');
}
