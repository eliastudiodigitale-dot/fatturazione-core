// Sincronizzazione CRM e ticket con ClickUp (decisione #45): cache clienti, ticket dalle fonti verso ClickUp e ritorno, clienti creati al pagamento.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ErroreClickUp, taskCrm, valoreCampo } from '../src/clickup.js';
import { clienteDaTask, businessDaCampo } from '../src/crm.js';
import { riserva } from '../src/documenti.js';
import { applicaTaskTicket, giroCrm, inviaMessaggi, inviaTicket, sincronizzaClienti, sincronizzaTicket, type DepsCrm } from '../src/sync.js';
import { aggiungiMessaggio, creaTicket } from '../src/ticket.js';
import { ClickUpFinto, admin, cfgTest, logMuto, notificheFinte, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

function deps(api: ClickUpFinto, extra: Record<string, string> = {}): DepsCrm & { notif: ReturnType<typeof notificheFinte> } {
  const cfg = cfgTest(extra);
  return { pool, api, cfg: cfg.crm!, sla: cfg.ticket.sla, log: logMuto, notif: notificheFinte() };
}
const CLIENTI = 'lista-clienti';
const TICKET = 'lista-ticket';

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
    await creaTicket(pool, d.sla, { fonte: 'heyciar', business: 'heyciar.it', idEsterno: '1', oggetto: 'x', cliente: { email: 'info@rossi.it' } });
    expect((await admin.query('SELECT cliente_task_id FROM ticket')).rows[0].cliente_task_id).toBeNull();
    cliente(api, 'c1', 'Rossi Srl', { 'cc-email': 'info@rossi.it' });
    expect(await sincronizzaClienti(d)).toMatchObject({ collegati: 1 });
    expect((await admin.query('SELECT cliente_task_id FROM ticket')).rows[0].cliente_task_id).toBe('c1');
  });
});

describe('ticket: dalle fonti a ClickUp e ritorno', () => {
  const nuovoTicket = (d: DepsCrm, id: string, extra: Record<string, unknown> = {}) =>
    creaTicket(pool, d.sla, { fonte: 'heyciar', business: 'heyciar.it', idEsterno: id, oggetto: `Ticket ${id}`, testo: 'Dettaglio riservato', priorita: 'alta', categoria: 'accessi', cliente: { email: 'info@rossi.it' }, ...extra });

  it('crea la task con i campi giusti, svuota il testo dal DB e non la duplica al giro dopo', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email) VALUES ('c1', 'Rossi', 'info@rossi.it')`);
    await nuovoTicket(d, '1');
    expect(await inviaTicket(d)).toBe(1);
    const [id, task] = [...api.task][0]!;
    expect(task.lista).toBe(TICKET);
    expect(task.t!.nome).toBe('[heyciar.it] Ticket 1');
    expect(task.t!.priorita).toBe(2);
    expect(task.t!.descrizione).toContain('Dettaglio riservato');
    const campi = Object.fromEntries(task.t!.campi.map((c) => [c.id, c.value]));
    expect(campi).toMatchObject({ 'ct-ref': 'heyciar|1', 'ct-business': 'heyciar.it', 'ct-fonte': 'heyciar', 'ct-categoria': 'accessi', 'ct-email': 'info@rossi.it' });
    expect(task.collegati).toEqual(['c1']);
    const r = (await admin.query('SELECT clickup_task_id, testo FROM ticket')).rows[0];
    expect(r).toEqual({ clickup_task_id: id, testo: null });
    expect(await inviaTicket(d)).toBe(0);
    expect(api.task.size).toBe(1);
  });

  it('se il processo si ferma dopo aver creato la task, il giro dopo la riconosce dal ref e non la duplica', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    await nuovoTicket(d, '2');
    api.crashDopoCreazione = true;
    await expect(inviaTicket(d)).rejects.toThrow('processo interrotto');
    expect(api.task.size).toBe(1);
    expect((await admin.query('SELECT clickup_task_id FROM ticket')).rows[0].clickup_task_id).toBeNull();
    // giroCrm legge prima da ClickUp (collega per ref) e poi scrive: nessuna seconda task
    await giroCrm(d, 'ticket', { completa: true });
    expect(api.task.size).toBe(1);
    expect((await admin.query('SELECT clickup_task_id FROM ticket')).rows[0].clickup_task_id).toBe([...api.task.keys()][0]);
  });

  it('stato, priorità e assegnatario cambiati in ClickUp tornano nel DB, con prima risposta e risoluzione', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    await nuovoTicket(d, '3');
    await giroCrm(d, 'ticket', { completa: true });
    const id = [...api.task.keys()][0]!;
    const stato = async () => (await admin.query('SELECT stato, priorita, assegnato_a, prima_risposta_il, risolto_il, scade_risoluzione FROM ticket')).rows[0];
    expect((await stato()).stato).toBe('aperto');

    api.modifiche.set(id, { stato: { nome: 'In lavorazione', tipo: 'custom' }, assegnati: ['elia'], priorita: 1, modificata: new Date(Date.now() + 1000) });
    await giroCrm(d, 'ticket', { completa: true });
    let r = await stato();
    expect(r).toMatchObject({ stato: 'in_lavorazione', assegnato_a: 'elia', priorita: 'urgente' });
    expect(r.prima_risposta_il).not.toBeNull();
    expect(r.risolto_il).toBeNull();

    api.modifiche.set(id, { stato: { nome: 'Risolto', tipo: 'closed' }, assegnati: ['elia'], priorita: 1, chiusa: new Date(), modificata: new Date(Date.now() + 2000) });
    await giroCrm(d, 'ticket', { completa: true });
    r = await stato();
    expect(r.stato).toBe('risolto');
    expect(r.risolto_il).not.toBeNull();

    // riaperto in ClickUp: la risoluzione si azzera
    api.modifiche.set(id, { stato: { nome: 'to do', tipo: 'open' }, assegnati: ['elia'], priorita: 1, modificata: new Date(Date.now() + 3000) });
    await giroCrm(d, 'ticket', { completa: true });
    expect((await stato()).risolto_il).toBeNull();

    const ev = (await admin.query(`SELECT tipo FROM ticket_eventi ORDER BY id`)).rows.map((x) => x.tipo);
    expect(ev).toEqual(['aperto', 'stato', 'priorita', 'assegnato', 'stato', 'stato']);
  });

  it('priorità cambiata: le scadenze SLA si ricalcolano dall\'apertura', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    await nuovoTicket(d, '4', { priorita: 'normale' });
    await giroCrm(d, 'ticket', { completa: true });
    const id = [...api.task.keys()][0]!;
    const prima = (await admin.query('SELECT scade_prima_risposta, aperto_il FROM ticket')).rows[0];
    expect(Math.round((prima.scade_prima_risposta - prima.aperto_il) / 3600_000)).toBe(48);
    api.modifiche.set(id, { priorita: 1, modificata: new Date(Date.now() + 1000) });
    await giroCrm(d, 'ticket', { completa: true });
    const dopo = (await admin.query('SELECT scade_prima_risposta, aperto_il FROM ticket')).rows[0];
    expect(Math.round((dopo.scade_prima_risposta - dopo.aperto_il) / 3600_000)).toBe(12);
  });

  it('ticket aperto a mano in ClickUp: nasce nel DB con fonte "manuale"; senza attività si salta e si avvisa', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    api.aggiungiCrm(TICKET, { id: 'm1', nome: 'Telefonata di Rossi', campi: { 'ct-business': 'reti', 'ct-email': 'info@rossi.it' }, priorita: 2 });
    api.aggiungiCrm(TICKET, { id: 'm2', nome: 'Senza attività', campi: {} });
    const r = await sincronizzaTicket(d, true);
    expect(r).toMatchObject({ letti: 2, nuovi: 1 });
    const t = (await admin.query('SELECT ref, fonte, business, priorita, cliente_email FROM ticket')).rows;
    expect(t).toEqual([{ ref: 'clickup|m1', fonte: 'manuale', business: 'reti.gazzolaelia.it', priorita: 'alta', cliente_email: 'info@rossi.it' }]);
    expect(d.notif.lista.map((x) => x.codice)).toEqual(['ticket_senza_business']);
    // con CRM_BUSINESS_PREDEFINITO la seconda task entra
    const d2 = deps(api, { CRM_BUSINESS_PREDEFINITO: 'reti.gazzolaelia.it' });
    expect(await applicaTaskTicket(d2, api.crm.get(TICKET)![1]!)).toBe('nuovo');
  });

  it('giro non completo: legge solo le task cambiate dopo l\'ultimo giro riuscito (con margine)', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    await sincronizzaTicket(d, true);
    expect(api.ultimoFiltroData).toBeUndefined();
    await sincronizzaTicket(d, false);
    expect(api.ultimoFiltroData).toBeInstanceOf(Date);
    expect(Date.now() - api.ultimoFiltroData!.getTime()).toBeGreaterThan(9 * 60_000);
    expect(Date.now() - api.ultimoFiltroData!.getTime()).toBeLessThan(11 * 60_000);
    // il giro automatico rilegge tutto una volta al giorno: appena fatto uno completo non ne chiede un altro
    await giroCrm(d, 'ticket');
    expect(api.ultimoFiltroData).toBeInstanceOf(Date);
  });

  it('ClickUp rifiuta la task (4xx): avviso e si passa al ticket dopo; con errore di rete ci si ferma', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    await nuovoTicket(d, '5');
    await nuovoTicket(d, '6');
    api.rifiutaLista.add(TICKET);
    // il finto rifiuta con 400 su creaTask: nessun ticket arriva in ClickUp ma il giro non si ferma
    const originale = api.creaTask.bind(api);
    let n = 0;
    api.creaTask = async (l, t) => {
      if (++n === 1) throw new ErroreClickUp(400, 'campo non valido');
      api.rifiutaLista.delete(TICKET);
      return originale(l, t);
    };
    expect(await inviaTicket(d)).toBe(1);
    expect(d.notif.lista.map((x) => x.codice)).toEqual(['ticket_rifiutato_clickup']);
    api.giu = true;
    await expect(inviaTicket(d)).rejects.toThrow('ClickUp giù');
  });

  it('i messaggi dei clienti diventano commenti ClickUp e il testo sparisce dal DB; senza task restano in attesa', async () => {
    const api = new ClickUpFinto();
    const d = deps(api);
    const { ticket } = await nuovoTicket(d, '7');
    await aggiungiMessaggio(pool, ticket.ref, { da: 'cliente', testo: 'Ancora problemi', chi: 'heyciar' });
    expect(await inviaMessaggi(d)).toBe(0); // la task non c'è ancora
    await inviaTicket(d);
    expect(await inviaMessaggi(d)).toBe(1);
    expect(api.commenti).toHaveLength(1);
    expect(api.commenti[0]!.testo).toContain('Cliente');
    expect(api.commenti[0]!.testo).toContain('Ancora problemi');
    expect((await admin.query('SELECT testo, inviato_il FROM ticket_messaggi')).rows[0]).toMatchObject({ testo: null });
    expect(await inviaMessaggi(d)).toBe(0);
  });
});

describe('clienti creati al primo pagamento (#42)', () => {
  const doc = (ref: string, fonte: string, cliente: Record<string, unknown>, business = 'heyciar.it') =>
    riserva(pool, { ref, tipo: 'fattura', fonte, business, payload: { cliente, righe: [{ descrizione: 'Canone', importo: 49 }] } });

  it('di default è spento: nessuna scheda creata', async () => {
    const api = new ClickUpFinto();
    await doc('stripe|1|fattura', 'stripe', { nome: 'Verdi', email: 'verdi@x.it' });
    expect(await giroCrm(deps(api), 'clienti')).toMatchObject({ creati: 0 });
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
    const r = await giroCrm(d, 'clienti');
    expect(r).toMatchObject({ creati: 2 });
    const nomi = [...api.task.values()].map((t) => t.t!.nome).sort();
    expect(nomi).toEqual(['Neri', 'Verdi Srl']);
    const verdi = [...api.task.values()].find((t) => t.t!.nome === 'Verdi Srl')!;
    expect(Object.fromEntries(verdi.t!.campi.map((c) => [c.id, c.value]))).toMatchObject({ 'cc-email': 'verdi@x.it', 'cc-piva': '12345678901', 'cc-business': 'heyciar.it' });
    // la cache li conosce subito, e un secondo giro non ricrea nulla
    expect((await admin.query('SELECT count(*)::int AS n FROM crm_clienti')).rows[0].n).toBe(2);
    expect(await giroCrm(d, 'clienti')).toMatchObject({ creati: 0 });
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
      expect(await giroCrm(d, 'ticket')).toBe('occupato');
      expect(api.chiamate).toBe(0);
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [7_302_026_002]);
      c.release();
    }
    expect(await giroCrm(d, 'ticket')).not.toBe('occupato');
  });
});
