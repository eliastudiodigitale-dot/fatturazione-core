import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Config } from './config.js';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function creaPool(c: Config['pg']): pg.Pool {
  let ssl: pg.PoolConfig['ssl'] = false;
  if (c.ssl === 'require') ssl = { rejectUnauthorized: false };
  if (c.ssl === 'verify-full') ssl = { rejectUnauthorized: true, ca: c.caFile ? readFileSync(c.caFile, 'utf8') : undefined };
  return new pg.Pool({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    ssl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: 'fatturazione-core',
  });
}

export async function inTransazione<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Chiavi degli advisory lock (una sola istanza di worker/riconciliazione alla volta). */
export const LOCK_CLICKUP = 7_302_026_001;
export const LOCK_EVENTI = 7_302_026; // usato con la forma a due argomenti (classe, id evento)
