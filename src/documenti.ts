import type pg from 'pg';
import type { Tipo } from './config.js';
import { inTransazione } from './db.js';
import { transizioneValida, type Stato } from './stati.js';

export interface Documento {
  id: string;
  ref: string;
  anno: number;
  tipo: Tipo;
  numero: number;
  data_riserva: Date;
  stato: Stato;
  fonte: string;
  business: string | null;
  payload: Payload;
  clickup_task_id: string | null;
  note_annullo: string | null;
}

export interface Payload {
  cliente: Record<string, unknown>;
  righe: { descrizione: string; importo: number }[];
  rata?: string;
  dati_fonte?: Record<string, unknown>;
}

export const CAMPI_LEGGERI = 'ref, anno, tipo, numero, data_riserva, stato, fonte, business, clickup_task_id';

export function vistaLeggera(d: Pick<Documento, 'ref' | 'numero' | 'anno' | 'tipo' | 'stato' | 'data_riserva'>) {
  return { ref: d.ref, numero: d.numero, anno: d.anno, tipo: d.tipo, stato: d.stato, data_riserva: d.data_riserva };
}

export async function riserva(
  pool: pg.Pool,
  p: { ref: string; tipo: Tipo; fonte: string; business: string | null; payload: Payload },
): Promise<Documento> {
  const r = await pool.query<Documento>('SELECT * FROM riserva_numero($1, $2, $3, $4, $5)', [
    p.ref,
    p.tipo,
    p.fonte,
    p.business,
    JSON.stringify(p.payload),
  ]);
  const d = r.rows[0];
  if (!d) throw new Error('riserva_numero non ha restituito righe');
  return d;
}

export async function perRef(pool: pg.Pool | pg.PoolClient, ref: string): Promise<Documento | undefined> {
  const r = await pool.query<Documento>('SELECT * FROM documenti WHERE ref = $1', [ref]);
  return r.rows[0];
}

export async function elenco(
  pool: pg.Pool,
  f: { stato?: Stato; da?: string; tipo?: Tipo; anno?: number; limite: number },
) {
  const r = await pool.query(
    `SELECT ${CAMPI_LEGGERI} FROM documenti
     WHERE ($1::text IS NULL OR stato = $1)
       AND ($2::timestamptz IS NULL OR data_riserva >= $2)
       AND ($3::text IS NULL OR tipo = $3)
       AND ($4::int IS NULL OR anno = $4)
     ORDER BY anno, tipo, numero LIMIT $5`,
    [f.stato ?? null, f.da ?? null, f.tipo ?? null, f.anno ?? null, f.limite],
  );
  return r.rows;
}

export class ErroreStato extends Error {
  constructor(
    readonly codice: 404 | 409,
    msg: string,
  ) {
    super(msg);
  }
}

/** Cambio di stato con riga in storico nella stessa transazione. */
export async function cambiaStato(
  pool: pg.Pool,
  ref: string,
  a: Stato,
  extra: { clickupTaskId?: string; noteAnnullo?: string; dettaglio?: Record<string, unknown> } = {},
): Promise<Documento> {
  return inTransazione(pool, async (c) => {
    const r = await c.query<Documento>('SELECT * FROM documenti WHERE ref = $1 FOR UPDATE', [ref]);
    const d = r.rows[0];
    if (!d) throw new ErroreStato(404, 'documento non trovato');
    if (!transizioneValida(d.tipo, d.stato, a)) throw new ErroreStato(409, `transizione non consentita: ${d.stato} -> ${a}`);
    const u = await c.query<Documento>(
      `UPDATE documenti SET stato = $2,
         clickup_task_id = COALESCE($3, clickup_task_id),
         note_annullo = COALESCE($4, note_annullo)
       WHERE id = $1 RETURNING *`,
      [d.id, a, extra.clickupTaskId ?? null, extra.noteAnnullo ?? null],
    );
    await c.query('INSERT INTO storico(documento_id, da_stato, a_stato, dettaglio) VALUES ($1, $2, $3, $4)', [
      d.id,
      d.stato,
      a,
      extra.dettaglio ? JSON.stringify(extra.dettaglio) : null,
    ]);
    return u.rows[0]!;
  });
}

/** Task ClickUp rigenerata: lo stato non cambia, si aggiorna l'ID e si lascia traccia in storico. */
export async function aggiornaTask(pool: pg.Pool, ref: string, taskId: string, dettaglio: Record<string, unknown>) {
  await inTransazione(pool, async (c) => {
    const r = await c.query<Documento>('SELECT id, stato FROM documenti WHERE ref = $1 FOR UPDATE', [ref]);
    const d = r.rows[0];
    if (!d) throw new ErroreStato(404, 'documento non trovato');
    await c.query('UPDATE documenti SET clickup_task_id = $2 WHERE id = $1', [d.id, taskId]);
    await c.query('INSERT INTO storico(documento_id, da_stato, a_stato, dettaglio) VALUES ($1, $2, $2, $3)', [
      d.id,
      d.stato,
      JSON.stringify(dettaglio),
    ]);
  });
}
