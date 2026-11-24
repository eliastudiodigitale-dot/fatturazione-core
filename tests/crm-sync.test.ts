// Sincronizzazione dei clienti con ClickUp (#42, #45): cache clienti e clienti creati al pagamento. I ticket non passano da ClickUp (#47).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ErroreClickUp, taskCrm, valoreCampo } from '../src/clickup.js';
import { clienteDaTask, businessDaCampo } from '../src/crm.js';
import { riserva } from '../src/documenti.js';
import { giroCrm, sincronizzaClienti, type DepsCrm } from '../src/sync.js';
import { creaTicket } from '../src/ticket.js';
import { leggiSla } from '../src/sla.js';
import { ClickUpFinto, admin, cfgTest, logMuto, notificheFinte, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

function deps(api: ClickUpFinto, extra: Record<string, string> = {}): DepsCrm & { notif: ReturnType<typeof notificheFinte> } {
  const cfg = cfgTest(extra);
  return { pool, api, cfg: cfg.crm!, log: logMuto, notif: notificheFinte() };
}
const CLIENTI = 'lista-clienti';

function cliente(api: ClickUpFinto, id: string, nome: string, campi: Record<string, string | string[] | null>) {
  return api.aggiungiCrm(CLIENTI, { id, nome, campi });
}

describe('lettura dei campi ClickUp', () => {
  it('menu a tendina, etichette, relazioni e testo diventano testo', () => {
    const opz = [{ id: 'o1', name: 'Reti', orderindex: 0 }, { id: 'o2', name: 'HeyCiar', orderindex: 1 }];
    expect(valoreCampo({ id: 'x', type: 'drop_down', value: 1, type_config: { options: opz } })).toBe('HeyCiar');
    expect(valoreCampo({ id: 'x', type: 'labels', value: ['o1', 'o2'], type_config: { options: [{ id: 'o1', label: 'Reti' }, { id: 'o2', label: 'HeyCiar' }] } })).toEqual(['Reti', 'HeyCiar']);
    expect(valoreCampo({ id: 'x', type: 'list_relationship', value: [{ id: 'abc', name: 'Rossi' }] })).toEqual(['abc']);
    expect(valoreCampo({ id: 'x', type: 'short_text', value: '  ciao ' })).toBe('ciao');
    expect(valoreCampo({ id: 'x', type: 'short_text', value: '' })).toBeNull();
    expect(valoreCampo({ id: 'x', type: 'number', value: 12 })).toBe('12');
    const t = taskCrm({ id: 't1', name: 'N', status: { status: 'In lavorazione', type: 'custom' }, priority: { id: '2' }, date_created: '1700000000000', assignees: [{ username: 'elia' }], tags: [{ name: 'vip' }], custom_fields: [{ id: 'f', type: 'short_text', value: 'v' }] });
    expect(t).toMatchObject({ id: 't1', nome: 'N', stato: { nome: 'In lavorazione' }, priorita: 2, assegnati: ['elia'], tag: ['vip'], campi: { f: 'v' } });
    expect(t.creata?.getTime()).toBe(1700000000000);
  });

  it('attività con alias e nomi liberi; partita IVA ed email normalizzate', () => {
    const alias = { reti: 'reti.gazzolaelia.it' };
    expect(businessDaCampo(['Reti', 'heyciar.it', 'Nome Con Spazi'], alias)).toEqual(['reti.gazzolaelia.it', 'heyciar.it']);
    expect(businessDaCampo('reti, serrandasu.it', alias)).toEqual(['reti.gazzolaelia.it', 'serrandasu.it']);
    const c = clienteDaTask(
      { id: 'c1', nome: ' Rossi Srl ', stato: { nome: 'Attivo', tipo: 'open' }, priorita: null, creata: null, modificata: null, chiusa: null, assegnati: [], tag: [], campi: { 'cc-email': 'INFO@Rossi.IT', 'cc-piva': 'it 12345678901', 'cc-business': 'reti' } },
      cfgTest().crm!.campiClienti,
      alias,
    );
    expect(c).toMatchObject({ nome: 'Rossi Srl', email: 'info@rossi.it', partita_iva: '12345678901', businesses: ['reti.gazzolaelia.it'] });
  });
});

describe('sincronizzazione clienti', () => {
  it('copia i clienti in cache, aggiorna al giro dopo e segna eliminati quelli spariti', async () => {
    const api = new ClickUpFinto();
    cliente(api, 'c1', 'Rossi Srl', { 'cc-email': 'info@rossi.it', 'cc-piva': '12345678901', 'cc-business': 'reti' });
    cliente(api, 'c2', 'Bianchi', { 'cc-email': 'b@bianchi.it', 'cc-business': 'heyciar.it' });
    const d = deps(api);
    expect(await sincronizzaClienti(d)).toMatchObject({ letti: 2, eliminati: 0 });
    expect((await admin.query('SELECT clickup_task_id, nome, businesses FROM crm_clienti ORDER BY 1')).rows).toEqual([
      { clickup_task_id: 'c1', nome: 'Rossi Srl', businesses: ['reti.gazzolaelia.it'] },
      { clickup_task_id: 'c2', nome: 'Bianchi', businesses: ['heyciar.it'] },
    ]);
    api.crm.set(CLIENTI, [{ ...api.crm.get(CLIENTI)![0]!, nome: 'Rossi SpA' }]);
    expect(await sincronizzaClienti(d)).toMatchObject({ letti: 1, eliminati: 1 });
    const r = (await admin.query('SELECT clickup_task_id, nome, eliminato FROM crm_clienti ORDER BY 1')).rows;
    expect(r).toEqual([{ clickup_task_id: 'c1', nome: 'Rossi SpA', eliminato: false }, { clickup_task_id: 'c2', nome: 'Bianchi', eliminato: true }]);
    const s = (await admin.query(`SELECT ultimo_ok, ultimo_errore FROM crm_sync WHERE nome = 'clienti'`)).rows[0];
    expect(s.ultimo_ok).not.toBeNull();
    expect(s.ultimo_errore).toBeNull();
  });

  it('lista vuota con clienti in cache: non cancella nulla e avvisa', async () => {
    const api = new ClickUpFinto();
    cliente(api, 'c1', 'Rossi', {});
    const d = deps(api);
    await sincronizzaClienti(d);
    api.crm.set(CLIENTI, []);
    await sincronizzaClienti(d);
    expect((await admin.query('SELECT eliminato FROM crm_clienti')).rows).toEqual([{ eliminato: false }]);
    expect(d.notif.lista.map((x) => x.codice)).toContain('crm_lista_clienti_vuota');
  });

  it('ClickUp giù: errore registrato in crm_sync, ultimo giro riuscito conservato', async () => {
    const api = new ClickUpFinto();
    cliente(api, 'c1', 'Rossi', {});
    const d = deps(api);
    await sincronizzaClienti(d);
    api.giu = true;
    await expect(sincronizzaClienti(d)).rejects.toThrow('ClickUp giù');
    const s = (await admin.query(`SELECT ultimo_ok, ultimo_errore FROM crm_sync WHERE nome = 'clienti'`)).rows[0];
    expect(s.ultimo_ok).not.toBeNull();
    expect(s.ultimo_errore).toContain('ClickUp giù');
    expect((await admin.query('SELECT count(*)::int AS n FROM crm_clienti')).rows[0].n).toBe(1);
  });

  it('dopo la sincronizzazione i ticket senza cliente si collegano per email', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    await creaTicket(pool, await leggiSla(pool), { fonte: 'heyciar', business: 'heyciar.it', idEsterno: '1', oggetto: 'x', cliente: { email: 'info@rossi.it' } });
    expect((await admin.query('SELECT cliente_task_id FROM ticket')).rows[0].cliente_task_id).toBeNull();
    cliente(api, 'c1', 'Rossi Srl', { 'cc-email': 'info@rossi.it' });
    expect(await sincronizzaClienti(d)).toMatchObject({ collegati: 1 });
    expect((await admin.query('SELECT cliente_task_id FROM ticket')).rows[0].cliente_task_id).toBe('c1');
  });
});

describe('clienti creati al primo pagamento (#42)', () => {
  const doc = (ref: string, fonte: string, cliente: Record<string, unknown>, business = 'heyciar.it') =>
    riserva(pool, { ref, tipo: 'fattura', fonte, business, payload: { cliente, righe: [{ descrizione: 'Canone', importo: 49 }] } });

  it('di default è spento: nessuna scheda creata', async () => {
    const api = new ClickUpFinto();
    await doc('stripe|1|fattura', 'stripe', { nome: 'Verdi', email: 'verdi@x.it' });
    expect(await giroCrm(deps(api))).toMatchObject({ creati: 0 });
    expect(api.task.size).toBe(0);
  });

  it('acceso: crea la scheda dei clienti Stripe/GoCardless che mancano, una sola volta, con i campi giusti', async () => {
    const api = new ClickUpFinto();
    const d = deps(api, { CRM_CREA_CLIENTI: 'true' });
    await doc('stripe|1|fattura', 'stripe', { ragione_sociale: 'Verdi Srl', email: 'Verdi@x.it', partita_iva: 'IT12345678901' });
    await doc('stripe|2|fattura', 'stripe', { ragione_sociale: 'Verdi Srl', email: 'verdi@x.it', partita_iva: '12345678901' }); // stesso cliente
    await doc('gocardless|3|fattura', 'gocardless', { nome: 'Neri', email: 'neri@x.it' }, 'reti.gazzolaelia.it');
    await doc('stripe|4|fattura', 'stripe', { nome: 'Senza contatti' }); // né email né P.IVA: non si può riconoscere, non si crea
    await doc('p1|fattura|unica', 'clickup', { nome: 'Da progetto', email: 'p@x.it' }); // non è un pagamento
    const r = await giroCrm(d);
    expect(r).toMatchObject({ creati: 2 });
    const nomi = [...api.task.values()].map((t) => t.t!.nome).sort();
    expect(nomi).toEqual(['Neri', 'Verdi Srl']);
    const verdi = [...api.task.values()].find((t) => t.t!.nome === 'Verdi Srl')!;
    expect(Object.fromEntries(verdi.t!.campi.map((c) => [c.id, c.value]))).toMatchObject({ 'cc-email': 'verdi@x.it', 'cc-piva': '12345678901', 'cc-business': 'heyciar.it' });
    // la cache li conosce subito, e un secondo giro non ricrea nulla
    expect((await admin.query('SELECT count(*)::int AS n FROM crm_clienti')).rows[0].n).toBe(2);
    expect(await giroCrm(d)).toMatchObject({ creati: 0 });
    expect(api.task.size).toBe(2);
  });
});

describe('un solo giro alla volta', () => {
  it('se un altro giro tiene il lock, giroCrm risponde "occupato"', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    const c = await pool.connect();
    try {
      await c.query('SELECT pg_advisory_lock($1)', [7_302_026_002]);
      expect(await giroCrm(d)).toBe('occupato');
      expect(api.chiamate).toBe(0);
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [7_302_026_002]);
      c.release();
    }
    expect(await giroCrm(d)).not.toBe('occupato');
  });
});
