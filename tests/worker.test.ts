// Test 6, 7, 8 (SPEC 11): ClickUp giù, processo interrotto a metà lotto, task eliminata. Più riconciliazione.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { riserva } from '../src/documenti.js';
import { FONTI_INTERNE, giroWorker, type DepsWorker } from '../src/worker.js';
import { riconcilia } from '../src/riconciliazione.js';
import { LOCK_CLICKUP } from '../src/db.js';
import { ClickUpFinto, admin, cfgTest, logMuto, notificheFinte, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

function deps(api: ClickUpFinto): DepsWorker & { notif: ReturnType<typeof notificheFinte> } {
  return { pool, api, cfg: cfgTest().clickup!, log: logMuto, notif: notificheFinte() };
}
async function riservaN(n: number) {
  for (let i = 1; i <= n; i++)
    await riserva(pool, {
      ref: `p${i}|fattura|unica`,
      tipo: 'fattura',
      fonte: 'clickup',
      business: 'b',
      payload: { cliente: { nome: `C${i}` }, righe: [{ descrizione: 'r', importo: 10 }], dati_fonte: { clickup: { task_progetto_id: `p${i}`, campo_relationship_id: 'campo-rel' } } },
    });
}
const stati = async () => (await admin.query('SELECT numero, stato, clickup_task_id FROM documenti ORDER BY numero')).rows;
const contatore = async () => (await admin.query('SELECT ultimo FROM contatori')).rows[0]?.ultimo;

describe('worker ClickUp', () => {
  it('crea le task con numero definitivo e relationship al progetto', async () => {
    await riservaN(3);
    const api = new ClickUpFinto();
    expect(await giroWorker(deps(api), FONTI_INTERNE)).toEqual({ creati: 3 });
    expect((await stati()).every((s) => s.stato === 'creato' && s.clickup_task_id)).toBe(true);
    const t = [...api.task.values()];
    expect(t.map((x) => x.chiave)).toEqual(['fattura|' + new Date().getFullYear() + '|1', 'fattura|' + new Date().getFullYear() + '|2', 'fattura|' + new Date().getFullYear() + '|3']);
    expect(t[0]!.collegati).toEqual(['p1']);
    expect(t[0]!.t!.nome).toMatch(/^Fattura 1\/\d{4} - C1$/);
  });

  it('6. ClickUp giù: restano riservato; poi il worker riprende senza duplicare né consumare numeri', async () => {
    await riservaN(3);
    const api = new ClickUpFinto();
    api.giu = true;
    expect(await giroWorker(deps(api), FONTI_INTERNE)).toEqual({ creati: 0 });
    expect((await stati()).every((s) => s.stato === 'riservato')).toBe(true);
    api.giu = false;
    expect(await giroWorker(deps(api), FONTI_INTERNE)).toEqual({ creati: 3 });
    expect(api.task.size).toBe(3);
    expect(await contatore()).toBe(3);
  });

  it('7. processo interrotto dopo la creazione: nessun doppione, nessun buco', async () => {
    await riservaN(3);
    const api = new ClickUpFinto();
    api.crashDopoCreazione = true; // la task 1 viene creata ma la conferma si perde
    await giroWorker(deps(api), FONTI_INTERNE);
    expect(api.task.size).toBe(1);
    expect((await stati())[0]!.stato).toBe('riservato');
    await giroWorker(deps(api), FONTI_INTERNE);
    expect(api.task.size).toBe(3);
    expect((await stati()).map((s) => s.stato)).toEqual(['creato', 'creato', 'creato']);
    expect(await contatore()).toBe(3);
  });

  it('7b. lock: un solo worker alla volta, e il lock cade con la connessione', async () => {
    await riservaN(1);
    const api = new ClickUpFinto();
    const altro = new pg.Client({ ...cfgTest().pg, ssl: false });
    await altro.connect();
    await altro.query('SELECT pg_advisory_lock($1)', [LOCK_CLICKUP]);
    expect(await giroWorker(deps(api), FONTI_INTERNE)).toBe('occupato');
    await altro.end(); // "pod ucciso": la connessione cade, il lock con lei
    expect(await giroWorker(deps(api), FONTI_INTERNE)).toEqual({ creati: 1 });
  });

  it('8. task eliminata: la riconciliazione la rigenera con lo stesso numero', async () => {
    await riservaN(2);
    const api = new ClickUpFinto();
    await giroWorker(deps(api), FONTI_INTERNE);
    const vecchia = (await stati())[0]!.clickup_task_id;
    api.task.delete(vecchia);
    const d = deps(api);
    const r = await riconcilia({ pool, notif: d.notif, log: logMuto, riservatoMaxOre: 24, clickup: d });
    expect(r.rigenerate).toEqual(['p1|fattura|unica']);
    const s = await stati();
    expect(s[0]!.numero).toBe(1);
    expect(s[0]!.clickup_task_id).not.toBe(vecchia);
    expect(api.task.get(s[0]!.clickup_task_id)!.chiave).toMatch(/\|1$/);
    expect(await contatore()).toBe(2);
    const st = await admin.query(`SELECT dettaglio FROM storico WHERE da_stato = 'creato' AND a_stato = 'creato'`);
    expect(st.rows[0].dettaglio.rigenerata).toBe(true);
  });

  it('riconciliazione: conferma persa allineata, doppioni e orfane segnalati, mai numeri toccati', async () => {
    await riservaN(2);
    const api = new ClickUpFinto();
    api.crashDopoCreazione = true;
    await giroWorker(deps(api), FONTI_INTERNE); // task 1 creata, documento ancora riservato
    const anno = new Date().getFullYear();
    await api.creaTask('lista-fatture', { nome: 'x', descrizione: '', campi: [{ id: 'campo-chiave', value: `fattura|${anno}|9` }] });
    await api.creaTask('lista-fatture', { nome: 'y', descrizione: '', campi: [{ id: 'campo-chiave', value: `fattura|${anno}|9` }] });
    const d = deps(api);
    const r = await riconcilia({ pool, notif: d.notif, log: logMuto, riservatoMaxOre: 24, clickup: d });
    expect(r.allineati).toEqual(['p1|fattura|unica']);
    expect(r.taskDoppie).toHaveLength(1);
    expect(r.taskOrfane).toEqual([`fattura|${anno}|9`]);
    expect(r.buchi).toEqual([]);
    expect(d.notif.lista.map((n) => n.codice)).toContain('riconciliazione');
    expect(await contatore()).toBe(2);
  });
});
