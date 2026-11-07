// Test 1, 2, 3 (SPEC 11): idempotenza, concorrenza, permessi.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { riserva } from '../src/documenti.js';
import { admin, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const doc = (ref: string) => ({ ref, tipo: 'fattura' as const, fonte: 'clickup', business: 'x', payload: { cliente: { nome: 'a' }, righe: [{ descrizione: 'r', importo: 1 }] } });

describe('riserva_numero', () => {
  it('1. idempotenza: 50 richieste parallele con la stessa ref -> un solo numero', async () => {
    const r = await Promise.all(Array.from({ length: 50 }, () => riserva(pool, doc('p1|fattura|unica'))));
    expect(new Set(r.map((d) => d.numero)).size).toBe(1);
    const n = await admin.query('SELECT count(*)::int AS n FROM documenti');
    expect(n.rows[0].n).toBe(1);
    const c = await admin.query('SELECT ultimo FROM contatori');
    expect(c.rows[0].ultimo).toBe(1);
  });

  it('2. concorrenza: 50 ref diverse -> 50 numeri consecutivi, nessun buco né doppione', async () => {
    const r = await Promise.all(Array.from({ length: 50 }, (_, i) => riserva(pool, doc(`p${i}|fattura|unica`))));
    const numeri = r.map((d) => d.numero).sort((a, b) => a - b);
    expect(numeri).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    // numero e data nello stesso ordine
    const o = await admin.query('SELECT numero FROM documenti ORDER BY data_riserva, id');
    const perData = o.rows.map((x) => x.numero);
    expect(perData).toEqual([...perData].sort((a, b) => a - b));
  });

  it('3. permessi: fatturazione_app non può modificare numero né cancellare', async () => {
    await riserva(pool, doc('p1|fattura|unica'));
    await expect(pool.query('UPDATE documenti SET numero = 99')).rejects.toThrow(/permission denied/);
    await expect(pool.query('UPDATE documenti SET ref = $1', ['x'])).rejects.toThrow(/permission denied/);
    await expect(pool.query('DELETE FROM documenti')).rejects.toThrow(/permission denied/);
    await expect(pool.query('DELETE FROM storico')).rejects.toThrow(/permission denied/);
    await expect(pool.query('UPDATE storico SET a_stato = $1', ['x'])).rejects.toThrow(/permission denied/);
    await expect(pool.query('UPDATE contatori SET ultimo = 0')).rejects.toThrow(/permission denied/);
    // anche l'owner non può cancellare: trigger
    await expect(admin.query('DELETE FROM documenti')).rejects.toThrow(/operazione non consentita/);
  });
});
