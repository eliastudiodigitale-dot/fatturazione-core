import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { LOCK_EVENTI } from './db.js';
import type { Notificatore } from './notifiche.js';

/** 'fatto' marca l'evento come elaborato; 'riprova' lo lascia in coda per il giro successivo. */
export type Esito = 'fatto' | 'riprova';
export type Elaboratore = (raw: unknown) => Promise<Esito>;

/** Errore "fail closed": non si emette e si avvisa (dati mancanti o incoerenti). */
export class Rifiuto extends Error {
  constructor(
    readonly codice: string,
    readonly dettagli: Record<string, string | number | boolean | null> = {},
  ) {
    super(codice);
  }
}

export function creaEventi(
  pool: pg.Pool,
  log: FastifyBaseLogger,
  notif: Notificatore,
  elaboratori: Record<string, Elaboratore>,
  bloccato: () => boolean,
) {
  /** Dedupe (SPEC 4.6): restituisce l'id della riga nuova, oppure null se l'evento era già stato ricevuto. */
  async function registra(fonte: string, eventoId: string, raw: unknown): Promise<string | null> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO eventi_ricevuti(fonte, evento_id, raw) VALUES ($1, $2, $3)
       ON CONFLICT (fonte, evento_id) DO NOTHING RETURNING id`,
      [fonte, eventoId, JSON.stringify(raw)],
    );
    return r.rows[0]?.id ?? null;
  }

  async function elabora(id: string): Promise<Esito | 'occupato'> {
    if (bloccato()) return 'riprova'; // modalità bloccata: nessuna riserva, l'evento resta in coda
    const c = await pool.connect();
    try {
      const lock = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, $2::int) AS ok', [LOCK_EVENTI, id]);
      if (!lock.rows[0]?.ok) return 'occupato';
      try {
        const r = await c.query<{ fonte: string; evento_id: string; raw: unknown; elaborato: boolean }>(
          'SELECT fonte, evento_id, raw, elaborato FROM eventi_ricevuti WHERE id = $1',
          [id],
        );
        const ev = r.rows[0];
        if (!ev || ev.elaborato) return 'fatto';
        const fn = elaboratori[ev.fonte];
        if (!fn) {
          notif.anomalia('fonte_senza_elaboratore', { fonte: ev.fonte, evento: ev.evento_id });
          return 'riprova';
        }
        let esito: Esito;
        try {
          esito = await fn(ev.raw);
        } catch (e) {
          if (e instanceof Rifiuto) notif.anomalia(e.codice, { fonte: ev.fonte, evento: ev.evento_id, ...e.dettagli });
          else log.error({ fonte: ev.fonte, evento: ev.evento_id, err: (e as Error).message }, 'elaborazione evento fallita');
          return 'riprova';
        }
        if (esito === 'fatto') await c.query('UPDATE eventi_ricevuti SET elaborato = true WHERE id = $1', [id]);
        return esito;
      } finally {
        await c.query('SELECT pg_advisory_unlock($1, $2::int)', [LOCK_EVENTI, id]);
      }
    } finally {
      c.release();
    }
  }

  /** Riprende gli eventi non elaborati (risposta 2xx già data, elaborazione fallita o interrotta). */
  async function riprendi(limite = 100): Promise<number> {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM eventi_ricevuti WHERE NOT elaborato AND ricevuto_il > now() - interval '30 days' ORDER BY id LIMIT $1`,
      [limite],
    );
    let fatti = 0;
    for (const { id } of r.rows) if ((await elabora(id)) === 'fatto') fatti++;
    return fatti;
  }

  return { registra, elabora, riprendi };
}

export type Eventi = ReturnType<typeof creaEventi>;
