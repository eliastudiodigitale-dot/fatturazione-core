// API documenti, auth, stati, annullo, modalità bloccata e test 10 (limiti, log senza segreti/PII).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTH, admin, bustaClickup, cfgTest, costruisci, logCatturato, poolApp, svuota } from './helpers.js';
import { ENV_TEST } from './setup/env.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

describe('API', () => {
  it('riserva idempotente, lettura, elenco', async () => {
    const { app } = await costruisci({ pool });
    const b = bustaClickup('86abc');
    const r1 = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ ref: '86abc|fattura|unica', numero: 1, tipo: 'fattura', stato: 'riservato' });
    const r2 = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b });
    expect(r2.json().numero).toBe(1);
    const g = await app.inject({ method: 'GET', url: `/v1/documenti/${encodeURIComponent(b.ref)}`, headers: AUTH.dashboard });
    expect(g.statusCode).toBe(200);
    expect(g.json()).not.toHaveProperty('payload');
    const l = await app.inject({ method: 'GET', url: '/v1/documenti?stato=riservato', headers: AUTH.dashboard });
    expect(l.json().documenti).toHaveLength(1);
    await app.close();
  });

  it('auth: senza token 401, token sbagliato 401, fonte non consentita 400', async () => {
    const { app } = await costruisci({ pool });
    const b = bustaClickup('p1');
    expect((await app.inject({ method: 'POST', url: '/v1/documenti', payload: b })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/documenti', headers: { authorization: 'Bearer sbagliato' }, payload: b })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.dashboard, payload: b })).statusCode).toBe(400);
    await app.close();
  });

  it('validazione: ref incoerente, campi extra, righe vuote -> 400 e nessun numero consumato', async () => {
    const { app } = await costruisci({ pool });
    const casi = [
      { ...bustaClickup('p1'), ref: 'altro|fattura|unica' },
      { ...bustaClickup('p1'), extra: 1 },
      { ...bustaClickup('p1'), righe: [] },
      { ...bustaClickup('p1'), tipo: 'nota' },
    ];
    for (const c of casi) expect((await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: c })).statusCode).toBe(400);
    const n = await admin.query('SELECT count(*)::int AS n FROM contatori');
    expect(n.rows[0].n).toBe(0);
    await app.close();
  });

  it('stati: transizioni valide/non valide, storico nella stessa transazione, annullo solo owner', async () => {
    const { app } = await costruisci({ pool });
    const b = bustaClickup('p1', { tipo: 'proforma' });
    await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b });
    const u = `/v1/documenti/${encodeURIComponent(b.ref)}`;
    expect((await app.inject({ method: 'POST', url: `${u}/stato`, headers: AUTH.n8n, payload: { a_stato: 'inviato_sdi' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `${u}/stato`, headers: AUTH.n8n, payload: { a_stato: 'creato', clickup_task_id: 't9' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${u}/stato`, headers: AUTH.n8n, payload: { a_stato: 'annullato' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `${u}/annulla`, headers: AUTH.n8n, payload: { motivo: 'errore cliente' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${u}/annulla`, headers: AUTH.owner, payload: {} })).statusCode).toBe(400);
    const a = await app.inject({ method: 'POST', url: `${u}/annulla`, headers: AUTH.owner, payload: { motivo: 'errore cliente' } });
    expect(a.json().stato).toBe('annullato');
    expect((await app.inject({ method: 'POST', url: `${u}/annulla`, headers: AUTH.owner, payload: { motivo: 'di nuovo' } })).statusCode).toBe(409);
    const s = await admin.query('SELECT da_stato, a_stato FROM storico ORDER BY id');
    expect(s.rows.map((r) => `${r.da_stato}>${r.a_stato}`)).toEqual(['null>riservato', 'riservato>creato', 'creato>annullato']);
    const d = await admin.query('SELECT note_annullo, clickup_task_id FROM documenti');
    expect(d.rows[0]).toEqual({ note_annullo: 'errore cliente', clickup_task_id: 't9' });
    await app.close();
  });

  it('fattura riservata non si annulla (decisione #9: nota di credito)', async () => {
    const { app } = await costruisci({ pool });
    const b = bustaClickup('p1');
    await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b });
    const r = await app.inject({ method: 'POST', url: `/v1/documenti/${encodeURIComponent(b.ref)}/annulla`, headers: AUTH.owner, payload: { motivo: 'prova annullo' } });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it('proforma annullata: la rifatta prende il numero successivo, mai riusato', async () => {
    const { app } = await costruisci({ pool });
    for (const p of ['a', 'b']) await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: bustaClickup(p, { tipo: 'proforma' }) });
    await app.inject({ method: 'POST', url: `/v1/documenti/${encodeURIComponent('a|proforma|unica')}/annulla`, headers: AUTH.owner, payload: { motivo: 'da rifare' } });
    const rifatta = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: bustaClickup('a', { tipo: 'proforma', rata: 'r2' }) });
    expect(rifatta.json().numero).toBe(3);
    await app.close();
  });

  it('fattura inviata allo SDI non si annulla', async () => {
    const { app } = await costruisci({ pool });
    const b = bustaClickup('p1');
    await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b });
    const u = `/v1/documenti/${encodeURIComponent(b.ref)}`;
    await app.inject({ method: 'POST', url: `${u}/stato`, headers: AUTH.n8n, payload: { a_stato: 'creato' } });
    await app.inject({ method: 'POST', url: `${u}/stato`, headers: AUTH.n8n, payload: { a_stato: 'inviato_sdi' } });
    expect((await app.inject({ method: 'POST', url: `${u}/annulla`, headers: AUTH.owner, payload: { motivo: 'prova annullo' } })).statusCode).toBe(409);
    await app.close();
  });

  it('modalità bloccata: readyz 503 e nessuna riserva', async () => {
    const { app } = await costruisci({ pool, cfg: cfgTest({ FORZA_BLOCCO: 'true' }), sbloccato: false });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: bustaClickup('p1') })).statusCode).toBe(503);
    const n = await admin.query('SELECT count(*)::int AS n FROM documenti');
    expect(n.rows[0].n).toBe(0);
    await app.close();
  });

  it('10. limiti: body troppo grande 413, rate limit 429, nessun segreto o PII nei log', async () => {
    const { righe, logger } = logCatturato();
    const { app } = await costruisci({ pool, cfg: cfgTest({ RATE_LIMIT_PER_MIN: '5', BODY_LIMIT: '2048' }), logger });
    const grande = { ...bustaClickup('p1'), cliente: { nome: 'x'.repeat(5000) } };
    expect((await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: grande })).statusCode).toBe(413);
    const codici: number[] = [];
    for (let i = 0; i < 6; i++) codici.push((await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: bustaClickup(`q${i}`) })).statusCode);
    expect(codici.slice(0, 4).every((c) => c === 200)).toBe(true);
    expect(codici[5]).toBe(429);
    await app.close();
    const tutto = righe.join('');
    expect(tutto).toContain('riserva');
    for (const segreto of [ENV_TEST.N8N_TOKEN, ENV_TEST.OWNER_TOKEN, ENV_TEST.APP_PG_PASS]) expect(tutto).not.toContain(segreto);
    expect(tutto).not.toContain('mario.rossi@example.com');
    expect(tutto).not.toContain('Mario Rossi');
  });
});
