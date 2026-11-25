// Portale operativo (#46): SLA a piani, ticket nei backend dei business, schede cliente su ClickUp, CRM, fatturazione in lettura.
// La sessione si firma direttamente con il segreto di prova: il giro di login con Keycloak è già coperto da dashboard.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { firma } from '../src/dashboard-auth.js';
import { scadenze, PIANO_NESSUNO } from '../src/ticket.js';
import { SlaStore, leggiSla } from '../src/sla.js';
import { applicaTicketRemoto, giroTicketRemoti } from '../src/ticket-ops.js';
import { inCsv } from '../src/crm-ops.js';
import { creaBackendHttp, ticketRemoto } from '../src/ticket-backend.js';
import { ErroreClickUp } from '../src/clickup.js';
import { AUTH_FONTE, BackendFinto, ClickUpFinto, admin, cfgTest, costruisci, poolApp, svuota } from './helpers.js';
import { ENV_TEST } from './setup/env.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const URL_BASE = 'https://gestione.example.org';
const SEGRETO = 's'.repeat(40);
const ENV_DASH = {
  KEYCLOAK_ISSUER: 'https://kc.example.org/realms/business',
  KEYCLOAK_CLIENT_ID: 'gestione',
  KEYCLOAK_CLIENT_SECRET: 'segreto-keycloak-di-prova',
  DASHBOARD_SESSION_SECRET: SEGRETO,
  DASHBOARD_URL_BASE: URL_BASE,
  TICKET_BACKEND_URL_HEYCIAR: 'http://heyciar-backend.platform.svc.cluster.local:8080/api/ticket',
  TICKET_BACKEND_TOKEN_HEYCIAR: 'backend-heyciar-token-di-prova-almeno-32-caratteri',
};

/** Come in produzione: heyciar.it senza piano a pagamento è senza SLA (best effort). */
const senzaSlaPerHeyciar = () => admin.query(`UPDATE sla_business SET piano_predefinito = 'nessuno' WHERE business = 'heyciar.it'`);
const slaStore = () => new SlaStore(pool);

type Ruolo = 'owner' | 'amministrazione' | 'assistenza';
const cookie = (ruoli: Ruolo[], business: string[] | null = null, sub = 'u1') => ({
  cookie: `dash_sess=${firma({ sub, nome: `Utente ${sub}`, email: `${sub}@example.org`, ruoli, business, exp: Math.floor(Date.now() / 1000) + 3600 }, SEGRETO)}`,
});
const OWNER = cookie(['owner'], null, 'owner');
const scrive = { 'x-richiesta': 'portale', origin: URL_BASE };

async function portale(o: { backend?: BackendFinto; clickup?: ClickUpFinto; extra?: Record<string, string> } = {}) {
  const backend = o.backend ?? new BackendFinto();
  const clickup = o.clickup ?? new ClickUpFinto();
  await senzaSlaPerHeyciar();
  const cfg = cfgTest({ ...ENV_DASH, ...o.extra });
  const t = await costruisci({ pool, cfg, operativo: { backends: { heyciar: backend }, crm: { api: clickup, cfg: cfg.crm } } });
  return { ...t, backend, clickup, cfg };
}

const remoto = (id: string, extra: Record<string, unknown> = {}) =>
  ticketRemoto({ id, oggetto: `Ticket ${id}`, stato: 'aperto', priorita: 'normale', aperto_il: new Date().toISOString(), cliente: { email: 'info@rossi.it', nome: 'Rossi' }, ...extra })!;

async function ticketHeyciar(app: Awaited<ReturnType<typeof portale>>['app'], id = 'h1', extra: Record<string, unknown> = {}) {
  const r = await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: { id_esterno: id, oggetto: 'Non riesco ad accedere', ...extra } });
  expect(r.statusCode).toBeLessThan(300);
  return r.json();
}

describe('SLA a piani (#46)', () => {
  const t0 = new Date('2026-11-01T10:00:00Z');
  const sla = async () => {
    await senzaSlaPerHeyciar();
    return leggiSla(pool);
  };

  it('heyciar: piani 48h, 3g, 5g, 7g; il piano ha termini fissi e la priorità non li cambia', async () => {
    const c = await sla();
    expect(Object.keys(c.business['heyciar.it']!.piani).sort()).toEqual(['3g', '48h', '5g', '7g']);
    const normale = scadenze(c, 'heyciar.it', 'normale', t0, '48h');
    const urgente = scadenze(c, 'heyciar.it', 'urgente', t0, '48h');
    expect(normale.risoluzione!.toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(urgente.risoluzione!.toISOString()).toBe(normale.risoluzione!.toISOString());
    expect(scadenze(c, 'heyciar.it', 'normale', t0, '7g').risoluzione!.toISOString()).toBe('2026-11-08T10:00:00.000Z');
    expect(normale.piano).toBe('48h');
  });
  it('senza piano a pagamento (nessuno) non ci sono scadenze: best effort', async () => {
    const c = await sla();
    expect(scadenze(c, 'heyciar.it', 'normale', t0)).toEqual({ primaRisposta: null, risoluzione: null, piano: PIANO_NESSUNO });
    expect(scadenze(c, 'heyciar.it', 'urgente', t0, 'nessuno').risoluzione).toBeNull();
  });
  it('le altre attività: SLA di partenza 24/72 scalato dalla priorità; i loro piani sono solo i propri', async () => {
    const c = await sla();
    expect(scadenze(c, 'reti.gazzolaelia.it', 'normale', t0).piano).toBeNull();
    expect(scadenze(c, 'reti.gazzolaelia.it', 'normale', t0).primaRisposta!.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(() => scadenze(c, 'heyciar.it', 'normale', t0, '9g')).toThrow('9g');
    expect(() => scadenze(c, 'reti.gazzolaelia.it', 'normale', t0, '48h')).toThrow('48h');
  });
  it('configurazione: backend https (http solo nel cluster) con token; le regole SLA non sono più nelle variabili', () => {
    expect(() => cfgTest({ ...ENV_DASH, TICKET_BACKEND_URL_HEYCIAR: 'http://example.org/api' })).toThrow('https');
    expect(() => cfgTest({ ...ENV_DASH, TICKET_BACKEND_TOKEN_HEYCIAR: undefined as never })).toThrow('TICKET_BACKEND_TOKEN_HEYCIAR');
    expect(() => cfgTest({ ...ENV_DASH, TICKET_BACKEND_URL_HEYCIAR: 'https://user:pw@example.org/api' })).toThrow('credenziali');
    expect(cfgTest(ENV_DASH).ticket.fonti.heyciar!.backend!.url).toBe('http://heyciar-backend.platform.svc.cluster.local:8080/api/ticket');
    expect(cfgTest({ TICKET_SYNC_MIN: '2' }).ticket.syncMin).toBe(2);
  });
  it('ticket heyciar: senza piano nessuna scadenza; con piano 48h scadenze del piano; il piano del cliente vale se non indicato', async () => {
    const { app } = await portale();
    const a = await ticketHeyciar(app, 'h1');
    expect(a).toMatchObject({ piano_sla: 'nessuno', scade_risoluzione: null, scade_prima_risposta: null });
    const b = await ticketHeyciar(app, 'h2', { piano_sla: '48h' });
    expect(b.piano_sla).toBe('48h');
    expect(new Date(b.scade_risoluzione).getTime() - Date.now()).toBeGreaterThan(47 * 3600_000);
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, businesses, piano_sla) VALUES ('c1','Rossi','info@rossi.it','{heyciar.it}','3g')`);
    const c = await ticketHeyciar(app, 'h3', { cliente: { email: 'info@rossi.it' } });
    expect(c.piano_sla).toBe('3g');
    expect((await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: { id_esterno: 'h4', oggetto: 'x', piano_sla: 'oro' } })).statusCode).toBe(400);
    await app.close();
  });
  it('i ticket senza SLA non falsano le percentuali SLA dei KPI', async () => {
    const { app } = await portale();
    await ticketHeyciar(app, 'h1');
    await app.inject({ method: 'POST', url: '/v1/ticket/heyciar%7Ch1/messaggi', headers: AUTH_FONTE.heyciar, payload: { da: 'staff', testo: 'ok' } });
    const k = (await app.inject({ method: 'GET', url: '/dashboard/api/kpi/ticket', headers: OWNER })).json();
    expect(k.ticket.sla_prima_risposta_pct ?? null).toBeNull();
    await app.close();
  });
});

describe('impostazioni SLA dal portale (#46)', () => {
  const url = '/dashboard/api/impostazioni/sla';
  const heyciar = { business: 'heyciar.it', standard: null, piano_predefinito: 'nessuno', piani: [{ piano: '48h', prima_risposta_ore: 24, risoluzione_ore: 48 }, { piano: '3g', prima_risposta_ore: 36, risoluzione_ore: 72 }] };
  const reti = (extra: Record<string, unknown> = {}) => ({ business: 'reti.gazzolaelia.it', standard: { prima_risposta_ore: 8, risoluzione_ore: 24 }, piano_predefinito: null, piani: [{ piano: 'oro', prima_risposta_ore: 2, risoluzione_ore: 4 }], ...extra });
  const put = (app: Awaited<ReturnType<typeof portale>>['app'], body: unknown, h: Record<string, string> = { ...OWNER, ...scrive }) => app.inject({ method: 'PUT', url, headers: h, payload: body as never });

  it('lettura: valori di partenza, piani di heyciar e anche le attività senza regole', async () => {
    const { app } = await portale();
    const r = (await app.inject({ method: 'GET', url, headers: OWNER })).json();
    expect(r.predefinito).toEqual({ prima_risposta_ore: 24, risoluzione_ore: 72 });
    const h = r.business.find((b: { business: string }) => b.business === 'heyciar.it');
    expect(h.piano_predefinito).toBe('nessuno');
    expect(h.piani.map((p: { piano: string }) => p.piano).sort()).toEqual(['3g', '48h', '5g', '7g']);
    expect(r.business.map((b: { business: string }) => b.business)).toEqual(expect.arrayContaining(['heyciar.it', 'serrandasu.it', 'reti.gazzolaelia.it']));
    await app.close();
  });

  it('una modifica vale subito per i ticket nuovi, senza riavviare; i ticket già aperti non cambiano', async () => {
    const { app } = await portale();
    const prima = await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.reti, payload: { id_esterno: 'r0', oggetto: 'Prima' } });
    const scadPrima = prima.json().scade_risoluzione;
    const r = await put(app, { predefinito: { prima_risposta_ore: 24, risoluzione_ore: 72 }, business: [heyciar, reti({ piano_predefinito: 'oro' })] });
    expect(r.statusCode).toBe(200);
    expect(r.json().business.find((b: { business: string }) => b.business === 'reti.gazzolaelia.it').piano_predefinito).toBe('oro');
    const dopo = (await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.reti, payload: { id_esterno: 'r1', oggetto: 'Dopo' } })).json();
    expect(dopo.piano_sla).toBe('oro');
    expect(new Date(dopo.scade_risoluzione).getTime() - Date.now()).toBeLessThan(4.1 * 3600_000);
    expect((await admin.query(`SELECT scade_risoluzione FROM ticket WHERE ref = 'reti|r0'`)).rows[0].scade_risoluzione.toISOString()).toBe(new Date(scadPrima).toISOString());
    await app.close();
  });

  it('SLA standard di un\'attività: sostituisce il valore di partenza ed è scalato dalla priorità', async () => {
    const { app } = await portale();
    await put(app, { predefinito: { prima_risposta_ore: 24, risoluzione_ore: 72 }, business: [heyciar, reti()] });
    const t = (await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.reti, payload: { id_esterno: 'r2', oggetto: 'x', priorita: 'urgente' } })).json();
    // 24 ore di risoluzione standard x 0,25 per l'urgente = 6 ore
    expect(new Date(t.scade_risoluzione).getTime() - Date.now()).toBeLessThan(6.1 * 3600_000);
    expect(new Date(t.scade_risoluzione).getTime() - Date.now()).toBeGreaterThan(5.9 * 3600_000);
    await app.close();
  });

  it('un piano tolto resta nel DB ma non si può più assegnare; i ticket che lo avevano non cambiano', async () => {
    const { app } = await portale();
    const a = await ticketHeyciar(app, 'h1', { piano_sla: '48h' });
    const r = await put(app, { predefinito: { prima_risposta_ore: 24, risoluzione_ore: 72 }, business: [{ ...heyciar, piani: [{ piano: '3g', prima_risposta_ore: 36, risoluzione_ore: 72 }] }] });
    expect(r.statusCode).toBe(200);
    expect((await admin.query(`SELECT piano, attivo FROM sla_piani WHERE business = 'heyciar.it' ORDER BY piano`)).rows).toEqual([
      { piano: '3g', attivo: true }, { piano: '48h', attivo: false }, { piano: '5g', attivo: false }, { piano: '7g', attivo: false },
    ]);
    expect((await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: { id_esterno: 'h2', oggetto: 'x', piano_sla: '48h' } })).statusCode).toBe(400);
    expect((await admin.query(`SELECT piano_sla, scade_risoluzione FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0]).toMatchObject({ piano_sla: '48h' });
    expect(new Date((await admin.query(`SELECT scade_risoluzione FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0].scade_risoluzione).toISOString()).toBe(new Date(a.scade_risoluzione).toISOString());
    // cambiare la priorità di quel ticket non si blocca per il piano ormai tolto: ricade sullo standard
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/heyciar%7Ch1', headers: { ...OWNER, ...scrive }, payload: { priorita: 'alta' } })).statusCode).toBe(200);
    // un piano tolto si può rimettere
    await put(app, { predefinito: { prima_risposta_ore: 24, risoluzione_ore: 72 }, business: [heyciar] });
    expect((await admin.query(`SELECT attivo FROM sla_piani WHERE business = 'heyciar.it' AND piano = '48h'`)).rows[0].attivo).toBe(true);
    await app.close();
  });

  it('valori sbagliati: errore chiaro e nessuna modifica', async () => {
    const { app } = await portale();
    const base = { predefinito: { prima_risposta_ore: 24, risoluzione_ore: 72 } };
    const casi: [unknown, string][] = [
      [{ ...base, business: [reti({ standard: { prima_risposta_ore: 30, risoluzione_ore: 10 } })] }, 'non può superare'],
      [{ ...base, business: [reti({ piano_predefinito: 'platino' })] }, 'non esiste'],
      [{ ...base, business: [reti({ piani: [{ piano: 'nessuno', prima_risposta_ore: 1, risoluzione_ore: 2 }] })] }, 'nome piano non valido'],
      [{ ...base, business: [reti({ piani: [{ piano: 'oro', prima_risposta_ore: 1, risoluzione_ore: 2 }, { piano: 'oro', prima_risposta_ore: 1, risoluzione_ore: 2 }] })] }, 'ripetuto'],
      [{ ...base, business: [reti(), reti()] }, 'ripetuta'],
      [{ predefinito: { prima_risposta_ore: 100, risoluzione_ore: 50 }, business: [] }, 'non può superare'],
    ];
    for (const [corpo, testo] of casi) {
      const r = await put(app, corpo);
      expect(r.statusCode).toBe(400);
      expect(r.body).toContain(testo);
    }
    for (const corpo of [{ ...base, business: [reti({ standard: { prima_risposta_ore: 0, risoluzione_ore: 5 } })] }, { ...base, business: [reti({ extra: 1 })] }, { business: [] }]) expect((await put(app, corpo)).statusCode).toBe(400);
    expect((await admin.query(`SELECT count(*)::int AS n FROM sla_business WHERE business = 'reti.gazzolaelia.it'`)).rows[0].n).toBe(0);
    await app.close();
  });

  it('solo owner, e solo con la protezione CSRF', async () => {
    const { app } = await portale();
    const corpo = { predefinito: { prima_risposta_ore: 24, risoluzione_ore: 72 }, business: [] };
    for (const ruolo of ['amministrazione', 'assistenza'] as Ruolo[]) {
      const h = cookie([ruolo], ['heyciar.it']);
      expect((await app.inject({ method: 'GET', url, headers: h })).statusCode).toBe(403);
      expect((await put(app, corpo, { ...h, ...scrive })).statusCode).toBe(403);
    }
    expect((await put(app, corpo, OWNER)).statusCode).toBe(403);
    expect((await put(app, corpo)).statusCode).toBe(200);
    await app.close();
  });

  it('piani per attività disponibili ai menu', async () => {
    const { app } = await portale();
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/piani-sla', headers: cookie(['assistenza'], ['heyciar.it']) })).json();
    expect(r.per_business['heyciar.it'].sort()).toEqual(['3g', '48h', '5g', '7g', 'nessuno']);
    expect(r.predefiniti['heyciar.it']).toBe('nessuno');
    await app.close();
  });
});

describe('ticket nei backend dei business', () => {
  it('modifica dal portale: prima il backend, poi la copia; stato risolto fissa la data, riaprire la azzera', async () => {
    const { app, backend } = await portale();
    await ticketHeyciar(app, 'h1');
    const url = '/dashboard/api/ticket/heyciar%7Ch1';
    const r = await app.inject({ method: 'PATCH', url, headers: { ...OWNER, ...scrive }, payload: { stato: 'in_lavorazione', assegnato_a: 'assistenza@example.org', priorita: 'alta' } });
    expect(r.statusCode).toBe(200);
    expect(backend.chiamate.find((c) => c.op === 'aggiorna')).toMatchObject({ id: 'h1', dati: { stato: 'in_lavorazione', assegnato_a: 'assistenza@example.org', priorita: 'alta' } });
    const riga = (await admin.query(`SELECT stato, assegnato_a, priorita, risolto_il FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0];
    expect(riga).toMatchObject({ stato: 'in_lavorazione', assegnato_a: 'assistenza@example.org', priorita: 'alta', risolto_il: null });
    await app.inject({ method: 'PATCH', url, headers: { ...OWNER, ...scrive }, payload: { stato: 'risolto' } });
    expect((await admin.query(`SELECT risolto_il FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0].risolto_il).not.toBeNull();
    await app.inject({ method: 'PATCH', url, headers: { ...OWNER, ...scrive }, payload: { stato: 'aperto' } });
    expect((await admin.query(`SELECT risolto_il FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0].risolto_il).toBeNull();
    const eventi = (await admin.query(`SELECT tipo FROM ticket_eventi ORDER BY id`)).rows.map((x) => x.tipo);
    expect(eventi).toEqual(expect.arrayContaining(['aperto', 'stato', 'assegnato', 'priorita']));
    await app.close();
  });

  it('backend giù: 502, la copia non cambia e il messaggio non contiene segreti', async () => {
    const { app, backend } = await portale();
    await ticketHeyciar(app, 'h1');
    backend.giu = true;
    const r = await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/heyciar%7Ch1', headers: { ...OWNER, ...scrive }, payload: { stato: 'chiuso' } });
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain(ENV_DASH.TICKET_BACKEND_TOKEN_HEYCIAR);
    expect((await admin.query(`SELECT stato FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0].stato).toBe('aperto');
    const c = await app.inject({ method: 'GET', url: '/dashboard/api/ticket/heyciar%7Ch1/conversazione', headers: OWNER });
    expect(c.statusCode).toBe(502);
    await app.close();
  });

  it('piano e SLA si cambiano solo nel portale (non vanno al backend) e ricalcolano le scadenze', async () => {
    const { app, backend } = await portale();
    await ticketHeyciar(app, 'h1');
    const r = await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/heyciar%7Ch1', headers: { ...OWNER, ...scrive }, payload: { piano_sla: '5g' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().piano_sla).toBe('5g');
    expect(r.json().scade_risoluzione).not.toBeNull();
    expect(backend.chiamate.filter((c) => c.op === 'aggiorna')).toHaveLength(0);
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/heyciar%7Ch1', headers: { ...OWNER, ...scrive }, payload: { piano_sla: 'oro' } })).statusCode).toBe(400);
    await app.close();
  });

  it('risposta al cliente: va al backend e registra la prima risposta; la nota interna no', async () => {
    const { app, backend } = await portale();
    await ticketHeyciar(app, 'h1');
    const url = '/dashboard/api/ticket/heyciar%7Ch1/messaggi';
    await app.inject({ method: 'POST', url, headers: { ...OWNER, ...scrive }, payload: { testo: 'Ne parliamo internamente', interno: true } });
    expect((await admin.query(`SELECT prima_risposta_il FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0].prima_risposta_il).toBeNull();
    const r = await app.inject({ method: 'POST', url, headers: { ...OWNER, ...scrive }, payload: { testo: 'Ciao, ce ne occupiamo noi' } });
    expect(r.statusCode).toBe(200);
    expect(backend.chiamate.filter((c) => c.op === 'rispondi')).toHaveLength(2);
    expect(backend.chiamate.filter((c) => c.op === 'rispondi')[1]).toMatchObject({ id: 'h1', dati: { testo: 'Ciao, ce ne occupiamo noi', autore: 'owner@example.org', interno: false } });
    expect((await admin.query(`SELECT prima_risposta_il FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0].prima_risposta_il).not.toBeNull();
    // il testo dei ticket remoti non si copia nel DB
    expect((await admin.query(`SELECT count(*)::int AS n FROM ticket_messaggi`)).rows[0].n).toBe(0);
    await app.close();
  });

  it('la conversazione dei ticket remoti si legge dal backend', async () => {
    const { app, backend } = await portale();
    await ticketHeyciar(app, 'h1');
    backend.msg.set('h1', [{ quando: new Date('2026-11-01T10:00:00Z'), da: 'cliente', testo: 'Aiuto', interno: false }]);
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/ticket/heyciar%7Ch1/conversazione', headers: OWNER })).json();
    expect(r).toMatchObject({ da_backend: true, messaggi: [{ da: 'cliente', testo: 'Aiuto' }] });
    await app.close();
  });

  it('ticket di un business senza backend: vive nel DB, con testo e conversazione', async () => {
    const { app } = await portale();
    const a = await app.inject({
      method: 'POST', url: '/dashboard/api/ticket', headers: { ...OWNER, ...scrive },
      payload: { business: 'visual.gazzolaelia.it', oggetto: 'Telefonata cliente', testo: 'Chiede un preventivo', cliente: { nome: 'Bianchi', email: 'b@bianchi.it' } },
    });
    expect(a.statusCode).toBe(201);
    const ref = a.json().ref as string;
    expect(ref.startsWith('dashboard|')).toBe(true);
    await app.inject({ method: 'POST', url: `/dashboard/api/ticket/${encodeURIComponent(ref)}/messaggi`, headers: { ...OWNER, ...scrive }, payload: { testo: 'Le mando il preventivo' } });
    const c = (await app.inject({ method: 'GET', url: `/dashboard/api/ticket/${encodeURIComponent(ref)}/conversazione`, headers: OWNER })).json();
    expect(c.da_backend).toBe(false);
    expect(c.messaggi.map((m: { testo: string }) => m.testo)).toEqual(['Chiede un preventivo', 'Le mando il preventivo']);
    await app.close();
  });

  it('apertura dal portale per un business con backend: il ticket nasce nel backend', async () => {
    const { app, backend } = await portale();
    const a = await app.inject({ method: 'POST', url: '/dashboard/api/ticket', headers: { ...OWNER, ...scrive }, payload: { business: 'heyciar.it', oggetto: 'Chiamata', piano_sla: '3g' } });
    expect(a.statusCode).toBe(201);
    expect(a.json().ref).toBe('heyciar|r1');
    expect(backend.chiamate[0]).toMatchObject({ op: 'crea', dati: { oggetto: 'Chiamata', creato_da: 'owner@example.org' } });
    await app.close();
  });

  it('sincronizzazione: crea i nuovi, aggiorna i cambiati, usa le date vere del backend, un backend giù non ferma il giro', async () => {
    const { backend, cfg } = await portale();
    const notif = { lista: [] as string[], anomalia: (c: string) => void notif.lista.push(c) };
    const d = { pool, cfg, sla: slaStore(), backends: { heyciar: backend }, notif };
    const aperto = new Date(Date.now() - 5 * 3600_000).toISOString();
    backend.ticket = [remoto('a', { aperto_il: aperto }), remoto('b', { stato: 'in_lavorazione', assegnato_a: 'anna' })];
    expect(await giroTicketRemoti(d)).toMatchObject({ heyciar: { letti: 2, nuovi: 2, aggiornati: 0 } });
    expect((await admin.query(`SELECT stato, assegnato_a, origine, id_remoto FROM ticket WHERE ref = 'heyciar|b'`)).rows[0]).toEqual({ stato: 'in_lavorazione', assegnato_a: 'anna', origine: 'remoto', id_remoto: 'b' });

    const risolto = new Date(Date.now() - 3600_000).toISOString();
    backend.ticket = [remoto('a', { aperto_il: aperto, stato: 'risolto', risolto_il: risolto, prima_risposta_il: new Date(Date.now() - 4 * 3600_000).toISOString() }), remoto('b', { stato: 'in_lavorazione', assegnato_a: 'anna' })];
    expect(await giroTicketRemoti(d)).toMatchObject({ heyciar: { letti: 2, nuovi: 0, aggiornati: 1 } });
    expect(backend.ultimoDopo).toBeInstanceOf(Date);
    const a = (await admin.query(`SELECT stato, risolto_il, prima_risposta_il FROM ticket WHERE ref = 'heyciar|a'`)).rows[0];
    expect(a.stato).toBe('risolto');
    expect(new Date(a.risolto_il).toISOString()).toBe(risolto);
    expect(a.prima_risposta_il).not.toBeNull();
    // uguale a prima: nessun cambiamento
    expect(await giroTicketRemoti(d)).toMatchObject({ heyciar: { aggiornati: 0 } });
    // completo: nessuna data di partenza
    await giroTicketRemoti(d, { completa: true });
    expect(backend.ultimoDopo).toBeUndefined();

    backend.giu = true;
    const r = (await giroTicketRemoti(d)) as Record<string, { errore?: string }>;
    expect(r.heyciar!.errore).toContain('non raggiungibile');
    expect(notif.lista).toContain('ticket_backend_non_risponde');
    expect((await admin.query(`SELECT ultimo_errore FROM crm_sync WHERE nome = 'ticket:heyciar'`)).rows[0].ultimo_errore).toContain('non raggiungibile');
    expect((await applicaTicketRemoto(d, 'heyciar', 'heyciar.it', remoto('a', { stato: 'risolto' })))).toBeDefined();
  });

  it('il client HTTP legge con prudenza e non perde il token negli errori', async () => {
    const chiamate: { url: string; auth: string }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      chiamate.push({ url, auth: String((init.headers as Record<string, string>).Authorization) });
      if (url.includes('/tickets?')) return new Response(JSON.stringify({ tickets: [{ id: 5, oggetto: 'Ok', aperto_il: '2026-11-01T10:00:00Z', stato: 'boh' }, { id: 'a b;x', oggetto: 'cattivo', aperto_il: '2026-11-01T10:00:00Z' }, { oggetto: 'senza id' }] }), { status: 200 });
      return new Response('{}', { status: 500 });
    }) as unknown as typeof fetch;
    const b = creaBackendHttp({ url: 'https://b.example.org/api', token: 'tok-segretissimo-di-prova-123456789012', fetchFn });
    const t = await b.elenca(new Date('2026-11-01T00:00:00Z'));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: '5', stato: 'aperto', priorita: 'normale' });
    expect(chiamate[0]!.url).toContain('aggiornati_dopo=2026-11-01T00%3A00%3A00.000Z');
    expect(chiamate[0]!.auth).toBe('Bearer tok-segretissimo-di-prova-123456789012');
    await expect(b.aggiorna('5', { stato: 'chiuso' })).rejects.toThrow('500');
    await expect(b.aggiorna('5', { stato: 'chiuso' })).rejects.not.toThrow('tok-segretissimo');
  });
});

describe('permessi, ambito e protezioni', () => {
  it('senza intestazione del portale o con origine estranea le scritture sono rifiutate (CSRF)', async () => {
    const { app } = await portale();
    await ticketHeyciar(app, 'h1');
    const url = '/dashboard/api/ticket/heyciar%7Ch1';
    expect((await app.inject({ method: 'PATCH', url, headers: OWNER, payload: { stato: 'chiuso' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url, headers: { ...OWNER, 'x-richiesta': 'portale', origin: 'https://altro.example.com' }, payload: { stato: 'chiuso' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url, headers: { ...scrive }, payload: { stato: 'chiuso' } })).statusCode).toBe(401);
    expect((await admin.query(`SELECT stato FROM ticket WHERE ref = 'heyciar|h1'`)).rows[0].stato).toBe('aperto');
    await app.close();
  });

  it('assistenza: gestisce i ticket delle sue attività, non vede fatturazione né modifica anagrafiche; amministrazione non tocca i ticket', async () => {
    const { app } = await portale();
    await ticketHeyciar(app, 'h1');
    await admin.query(`INSERT INTO ticket (ref, fonte, business, oggetto) VALUES ('reti|1','reti','reti.gazzolaelia.it','altro')`);
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, businesses) VALUES ('c1','Rossi','{heyciar.it}')`);
    const ass = { ...cookie(['assistenza'], ['heyciar.it']), ...scrive };
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/heyciar%7Ch1', headers: ass, payload: { stato: 'in_lavorazione' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/reti%7C1', headers: ass, payload: { stato: 'chiuso' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/ticket', headers: ass, payload: { business: 'reti.gazzolaelia.it', oggetto: 'x' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/documenti', headers: ass })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/clienti/c1', headers: ass, payload: { nome: 'Nuovo' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/clienti/c1/note', headers: ass, payload: { testo: 'ok' } })).statusCode).toBe(201);
    const amm = { ...cookie(['amministrazione'], ['heyciar.it']), ...scrive };
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/heyciar%7Ch1', headers: amm, payload: { stato: 'chiuso' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/documenti', headers: amm })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/sync', headers: ass, payload: {} })).statusCode).toBe(403);
    await app.close();
  });

  it('validazione: stato o priorità sconosciuti e campi in più sono rifiutati', async () => {
    const { app } = await portale();
    await ticketHeyciar(app, 'h1');
    for (const payload of [{ stato: 'finito' }, { priorita: 'altissima' }, { chissa: 1 }]) {
      expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/heyciar%7Ch1', headers: { ...OWNER, ...scrive }, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/ticket/non%7Cesiste', headers: { ...OWNER, ...scrive }, payload: { stato: 'chiuso' } })).statusCode).toBe(404);
    await app.close();
  });

  it('accesso registra chi è assegnabile: gli utenti vedono solo colleghi delle proprie attività', async () => {
    const { app } = await portale();
    await admin.query(`INSERT INTO utenti_dashboard (sub, nome, email, ruoli, business) VALUES ('a','Anna','anna@example.org','{assistenza}','{heyciar.it}'), ('b','Bruno','bruno@example.org','{assistenza}','{reti.gazzolaelia.it}'), ('o','Elia','elia@example.org','{owner}',NULL)`);
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/utenti', headers: cookie(['assistenza'], ['heyciar.it']) })).json();
    expect(r.utenti.map((u: { nome: string }) => u.nome).sort()).toEqual(['Anna', 'Elia']);
    await app.close();
  });
});

describe('CRM operativo', () => {
  it('cliente creato dal portale: va su ClickUp con i campi, nella cache, e un doppione è un 409', async () => {
    const { app, clickup } = await portale();
    const r = await app.inject({
      method: 'POST', url: '/dashboard/api/clienti', headers: { ...OWNER, ...scrive },
      payload: { nome: 'Verdi Srl', email: 'Info@Verdi.it', partita_iva: '12345678901', telefono: '333 1234567', businesses: ['reti.gazzolaelia.it'] },
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().clickup_task_id as string;
    const t = clickup.task.get(id)!;
    expect(t.lista).toBe('lista-clienti');
    expect(t.t!.campi).toEqual(expect.arrayContaining([{ id: 'cc-email', value: 'info@verdi.it' }, { id: 'cc-piva', value: '12345678901' }]));
    expect((await admin.query(`SELECT nome, email, partita_iva, businesses FROM crm_clienti WHERE clickup_task_id = $1`, [id])).rows[0]).toEqual({ nome: 'Verdi Srl', email: 'info@verdi.it', partita_iva: '12345678901', businesses: ['reti.gazzolaelia.it'] });
    const dup = await app.inject({ method: 'POST', url: '/dashboard/api/clienti', headers: { ...OWNER, ...scrive }, payload: { nome: 'Altro nome', email: 'info@verdi.it' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().clickup_task_id).toBe(id);
    expect(clickup.task.size).toBe(1);
    await app.close();
  });

  it('modifica scheda: scrive su ClickUp (nome e campi, vuoto = svuota) e aggiorna la cache; ClickUp giù = 502 senza toccare la cache', async () => {
    const { app, clickup } = await portale();
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, telefono, businesses) VALUES ('c1','Rossi','info@rossi.it','111','{heyciar.it}')`);
    const r = await app.inject({ method: 'PATCH', url: '/dashboard/api/clienti/c1', headers: { ...OWNER, ...scrive }, payload: { nome: 'Rossi Spa', telefono: '', businesses: ['heyciar.it', 'reti.gazzolaelia.it'] } });
    expect(r.statusCode).toBe(200);
    expect(clickup.aggiornamenti).toEqual([{ taskId: 'c1', mod: { nome: 'Rossi Spa', stato: undefined } }]);
    expect(clickup.campiImpostati).toEqual(expect.arrayContaining([{ taskId: 'c1', campoId: 'cc-tel', valore: null }, { taskId: 'c1', campoId: 'cc-business', valore: 'heyciar.it' }]));
    expect((await admin.query(`SELECT nome, telefono, businesses FROM crm_clienti WHERE clickup_task_id = 'c1'`)).rows[0]).toEqual({ nome: 'Rossi Spa', telefono: null, businesses: ['heyciar.it', 'reti.gazzolaelia.it'] });
    clickup.aggiornaTask = async () => {
      throw new ErroreClickUp(0, 'rete');
    };
    const e = await app.inject({ method: 'PATCH', url: '/dashboard/api/clienti/c1', headers: { ...OWNER, ...scrive }, payload: { nome: 'Cambiato' } });
    expect(e.statusCode).toBe(502);
    expect((await admin.query(`SELECT nome FROM crm_clienti WHERE clickup_task_id = 'c1'`)).rows[0].nome).toBe('Rossi Spa');
    await app.close();
  });

  it('ruolo ristretto: non crea né sposta clienti su attività non sue', async () => {
    const { app } = await portale();
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, businesses) VALUES ('c1','Rossi','{heyciar.it}'), ('c2','Verdi','{reti.gazzolaelia.it}')`);
    const amm = { ...cookie(['amministrazione'], ['heyciar.it']), ...scrive };
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/clienti', headers: amm, payload: { nome: 'X', businesses: ['reti.gazzolaelia.it'] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/clienti', headers: amm, payload: { nome: 'X' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/clienti/c2', headers: amm, payload: { nome: 'Y' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/dashboard/api/clienti/c1', headers: amm, payload: { businesses: ['reti.gazzolaelia.it'] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/clienti/c2/scheda', headers: amm })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/clienti/c2/note', headers: amm, payload: { testo: 'x' } })).statusCode).toBe(404);
    await app.close();
  });

  it('contatti, note e attività: crea, modifica, completa, elimina (cancellazione logica) e compaiono nella scheda', async () => {
    const { app } = await portale();
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, businesses) VALUES ('c1','Rossi','info@rossi.it','{heyciar.it}')`);
    const h = { ...OWNER, ...scrive };
    const co = (await app.inject({ method: 'POST', url: '/dashboard/api/clienti/c1/contatti', headers: h, payload: { nome: 'Mario', ruolo: 'Titolare', email: 'MARIO@rossi.it', principale: true } })).json().id;
    await app.inject({ method: 'POST', url: '/dashboard/api/clienti/c1/contatti', headers: h, payload: { nome: 'Lucia', principale: true } });
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/clienti/c1/contatti', headers: h, payload: { nome: 'Err', email: 'non-una-email' } })).statusCode).toBe(400);
    const n = (await app.inject({ method: 'POST', url: '/dashboard/api/clienti/c1/note', headers: h, payload: { testo: 'Preferisce essere chiamato al mattino' } })).json().id;
    await app.inject({ method: 'PATCH', url: `/dashboard/api/note/${n}`, headers: h, payload: { fissata: true } });
    const at = (await app.inject({ method: 'POST', url: '/dashboard/api/attivita', headers: h, payload: { titolo: 'Richiamare per rinnovo', tipo: 'chiamata', cliente: 'c1', scadenza: new Date(Date.now() - 3600_000).toISOString(), assegnato_a: 'owner@example.org' } })).json().id;
    let s = (await app.inject({ method: 'GET', url: '/dashboard/api/clienti/c1/scheda', headers: OWNER })).json();
    expect(s.contatti.map((x: { nome: string; principale: boolean }) => [x.nome, x.principale])).toEqual([['Lucia', true], ['Mario', false]]);
    expect(s.note[0]).toMatchObject({ testo: 'Preferisce essere chiamato al mattino', fissata: true, autore: 'owner@example.org' });
    expect(s.attivita[0]).toMatchObject({ titolo: 'Richiamare per rinnovo', scaduta: true, completata_il: null });
    expect(s.cronologia.map((x: { tipo: string }) => x.tipo)).toEqual(expect.arrayContaining(['nota', 'attivita']));

    const scadute = (await app.inject({ method: 'GET', url: '/dashboard/api/attivita?scadute=true&assegnato=owner', headers: OWNER })).json();
    expect(scadute.totale).toBe(1);
    await app.inject({ method: 'PATCH', url: `/dashboard/api/attivita/${at}`, headers: h, payload: { completata: true } });
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/attivita?scadute=true', headers: OWNER })).json().totale).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/attivita?stato=completate', headers: OWNER })).json().totale).toBe(1);
    await app.inject({ method: 'DELETE', url: `/dashboard/api/contatti/${co}`, headers: h });
    await app.inject({ method: 'DELETE', url: `/dashboard/api/note/${n}`, headers: h });
    s = (await app.inject({ method: 'GET', url: '/dashboard/api/clienti/c1/scheda', headers: OWNER })).json();
    expect(s.contatti).toHaveLength(1);
    expect(s.note).toHaveLength(0);
    expect((await admin.query(`SELECT count(*)::int AS n FROM crm_note`)).rows[0].n).toBe(1); // cancellazione logica
    await app.close();
  });

  it('piano di assistenza del cliente: vale per i ticket successivi', async () => {
    const { app } = await portale();
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, businesses) VALUES ('c1','Rossi','info@rossi.it','{heyciar.it}')`);
    const h = { ...OWNER, ...scrive };
    expect((await app.inject({ method: 'PUT', url: '/dashboard/api/clienti/c1/piano-sla', headers: h, payload: { piano_sla: '7g' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/dashboard/api/clienti/c1/piano-sla', headers: h, payload: { piano_sla: 'oro' } })).statusCode).toBe(400);
    const t = await ticketHeyciar(app, 'h1', { cliente: { email: 'info@rossi.it' } });
    expect(t.piano_sla).toBe('7g');
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/clienti/c1/scheda', headers: OWNER })).json().piano_sla).toBe('7g');
    await app.close();
  });

  it('trattative: pipeline per fase con valori, chiusura fissa la data, ruolo senza importi non vede i valori', async () => {
    const { app } = await portale();
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, businesses) VALUES ('c1','Rossi','{heyciar.it}')`);
    const h = { ...OWNER, ...scrive };
    const a = (await app.inject({ method: 'POST', url: '/dashboard/api/opportunita', headers: h, payload: { titolo: 'Pacchetto ore', business: 'heyciar.it', cliente: 'c1', valore: 500, fase: 'proposta' } })).json().id;
    await app.inject({ method: 'POST', url: '/dashboard/api/opportunita', headers: h, payload: { titolo: 'Nuovo lead', business: 'reti.gazzolaelia.it', prospect: 'Azienda Bianchi', valore: 1200 } });
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/opportunita', headers: h, payload: { titolo: 'Senza nessuno', business: 'reti.gazzolaelia.it' } })).statusCode).toBe(400);
    let r = (await app.inject({ method: 'GET', url: '/dashboard/api/opportunita', headers: OWNER })).json();
    expect(r.per_fase.find((f: { fase: string }) => f.fase === 'proposta')).toEqual({ fase: 'proposta', n: 1, valore: 500 });
    expect(r.per_fase.find((f: { fase: string }) => f.fase === 'nuova')).toEqual({ fase: 'nuova', n: 1, valore: 1200 });
    await app.inject({ method: 'PATCH', url: `/dashboard/api/opportunita/${a}`, headers: h, payload: { fase: 'vinta' } });
    expect((await admin.query(`SELECT chiusa_il FROM crm_opportunita WHERE id = $1`, [a])).rows[0].chiusa_il).not.toBeNull();
    await app.inject({ method: 'PATCH', url: `/dashboard/api/opportunita/${a}`, headers: h, payload: { fase: 'trattativa' } });
    expect((await admin.query(`SELECT chiusa_il FROM crm_opportunita WHERE id = $1`, [a])).rows[0].chiusa_il).toBeNull();
    const ass = cookie(['assistenza'], ['heyciar.it']);
    r = (await app.inject({ method: 'GET', url: '/dashboard/api/opportunita', headers: ass })).json();
    expect(r.opportunita).toHaveLength(1);
    expect(r.opportunita[0].valore).toBeNull();
    expect(r.per_fase.every((f: { valore: unknown }) => f.valore === null)).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/opportunita', headers: { ...ass, ...scrive }, payload: { titolo: 'x', business: 'heyciar.it', prospect: 'y' } })).statusCode).toBe(403);
    await app.close();
  });

  it('duplicati: schede con stessa partita IVA o email', async () => {
    const { app } = await portale();
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, partita_iva, businesses) VALUES ('a','Rossi','x@rossi.it','12345678901','{heyciar.it}'), ('b','Rossi Srl','y@rossi.it','12345678901','{reti.gazzolaelia.it}'), ('c','Altro','x@rossi.it',NULL,'{heyciar.it}'), ('d','Unico','u@u.it',NULL,'{heyciar.it}')`);
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/clienti-duplicati', headers: OWNER })).json();
    expect(r.duplicati.map((x: { motivo: string; valore: string; schede: unknown[] }) => [x.motivo, x.valore, x.schede.length])).toEqual([['email', 'x@rossi.it', 2], ['partita_iva', '12345678901', 2]]);
    await app.close();
  });

  it('viste salvate: proprie e condivise; solo owner o chi le ha create le elimina', async () => {
    const { app } = await portale();
    const h = { ...OWNER, ...scrive };
    const v = (await app.inject({ method: 'POST', url: '/dashboard/api/viste', headers: h, payload: { sezione: 'ticket', nome: 'Urgenti heyciar', filtro: { business: 'heyciar.it', priorita: 'urgente' }, condivisa: true } })).json().id;
    await app.inject({ method: 'POST', url: '/dashboard/api/viste', headers: { ...cookie(['assistenza'], null, 'u2'), ...scrive }, payload: { sezione: 'ticket', nome: 'Mie', filtro: {} } });
    const dueSess = (await app.inject({ method: 'GET', url: '/dashboard/api/viste?sezione=ticket', headers: cookie(['assistenza'], null, 'u2') })).json().viste;
    expect(dueSess.map((x: { nome: string }) => x.nome).sort()).toEqual(['Mie', 'Urgenti heyciar']);
    expect((await app.inject({ method: 'DELETE', url: `/dashboard/api/viste/${v}`, headers: { ...cookie(['assistenza'], null, 'u2'), ...scrive } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/dashboard/api/viste/${v}`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/viste?sezione=ticket', headers: h })).json().viste).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/viste?sezione=boh', headers: h })).statusCode).toBe(400);
    await app.close();
  });
});

describe('fatturazione in lettura', () => {
  async function documenti() {
    const doc = (ref: string, anno: number, tipo: string, numero: number, business: string, stato: string, cliente: object, importo: number, fonte = 'clickup') =>
      admin.query(`INSERT INTO documenti (ref, anno, tipo, numero, fonte, business, stato, payload, data_riserva) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($4::int * interval '1 day'))`, [
        ref, anno, tipo, numero, fonte, business, stato, JSON.stringify({ cliente, righe: [{ descrizione: 'x', importo }] }),
      ]);
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, businesses) VALUES ('c1','Rossi','info@rossi.it','{heyciar.it}')`);
    await doc('d1', 2026, 'fattura', 1, 'heyciar.it', 'creato', { ragione_sociale: 'Rossi Spa', email: 'info@rossi.it', partita_iva: 'IT12345678901' }, 120, 'stripe');
    await doc('d2', 2026, 'fattura', 2, 'reti.gazzolaelia.it', 'creato', { nome: '=cmd|evil', email: 'evil@example.org' }, 300);
    await doc('d3', 2026, 'proforma', 3, 'heyciar.it', 'annullato', { nome: 'Verdi' }, 900);
    await doc('d4', 2025, 'fattura', 1, 'heyciar.it', 'inviato_sdi', { nome: 'Bianchi', partita_iva: '99999999999' }, 50);
  }

  it('elenco con filtri e somma sulla selezione (annullati esclusi dalla somma)', async () => {
    const { app } = await portale();
    await documenti();
    const get = async (q: string, h: Record<string, string> = OWNER) => (await app.inject({ method: 'GET', url: `/dashboard/api/documenti${q}`, headers: h })).json();
    const tutti = await get('');
    expect(tutti.totale).toBe(4);
    expect(tutti.somma).toBe(470);
    expect((await get('?business=heyciar.it&anno=2026')).documenti.map((x: { ref: string }) => x.ref).sort()).toEqual(['d1', 'd3']);
    expect((await get('?tipo=proforma')).totale).toBe(1);
    expect((await get('?stato=annullato,inviato_sdi')).totale).toBe(2);
    expect((await get('?fonte=stripe')).documenti[0].ref).toBe('d1');
    expect((await get('?q=rossi')).totale).toBe(1);
    expect((await get('?q=12345678901')).totale).toBe(1);
    expect((await get('?importo_min=100&importo_max=500')).totale).toBe(2);
    expect((await get('?cliente=c1')).documenti.map((x: { ref: string }) => x.ref)).toEqual(['d1']);
    expect((await get('?ordine=importo')).documenti[0].ref).toBe('d3');
    expect((await get('?limite=2&offset=2')).documenti).toHaveLength(2);
    // un ruolo ristretto vede solo la propria attività, anche se chiede altro
    const amm = cookie(['amministrazione'], ['reti.gazzolaelia.it']);
    expect((await get('', amm)).documenti.map((x: { ref: string }) => x.ref)).toEqual(['d2']);
    expect((await get('?business=heyciar.it', amm)).totale).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/documenti?ordine=boh', headers: OWNER })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/documenti?da=ieri', headers: OWNER })).statusCode).toBe(400);
    await app.close();
  });

  it('dettaglio con righe, storico e scheda cliente collegata; riepilogo mensile', async () => {
    const { app } = await portale();
    await documenti();
    const d = (await app.inject({ method: 'GET', url: '/dashboard/api/documenti/d1', headers: OWNER })).json();
    expect(d).toMatchObject({ ref: 'd1', totale: '120', scheda_cliente: { clickup_task_id: 'c1' } });
    expect(d.payload.righe).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/documenti/zzz', headers: OWNER })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/documenti/d1', headers: cookie(['amministrazione'], ['reti.gazzolaelia.it']) })).statusCode).toBe(404);
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/documenti-riepilogo?anno=2026', headers: OWNER })).json();
    expect(r.mesi.reduce((s: number, m: { totale: string }) => s + Number(m.totale), 0)).toBe(420);
    await app.close();
  });

  it('esportazione CSV con gli stessi filtri e protezione dalle formule', async () => {
    const { app } = await portale();
    await documenti();
    const r = await app.inject({ method: 'GET', url: '/dashboard/api/export/documenti?business=reti.gazzolaelia.it', headers: OWNER });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.body.startsWith('﻿Rif;Tipo;Anno')).toBe(true);
    expect(r.body).toContain("'=cmd|evil");
    expect(r.body).not.toContain(';=cmd');
    expect(r.body.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/export/boh', headers: OWNER })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/export/documenti', headers: cookie(['assistenza'], ['heyciar.it']) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/export/ticket', headers: OWNER })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/export/clienti', headers: cookie(['assistenza'], ['heyciar.it']) })).body).not.toContain('Fatturato');
    await app.close();
  });

  it('inCsv: virgolette, a capo e separatori nei testi', () => {
    expect(inCsv([{ a: 'x;y', b: 'riga\n2', c: 'di "cita"', d: null, e: 3 }], [{ chiave: 'a', titolo: 'A' }, { chiave: 'b', titolo: 'B' }, { chiave: 'c', titolo: 'C' }, { chiave: 'd', titolo: 'D' }, { chiave: 'e', titolo: 'E' }])).toBe(
      '﻿A;B;C;D;E\r\n"x;y";"riga\n2";"di ""cita""";;3\r\n',
    );
  });
});

describe('ENV di prova', () => {
  it('i token di prova restano distinti da quelli del backend', () => {
    expect(ENV_TEST.OWNER_TOKEN).not.toBe(ENV_DASH.TICKET_BACKEND_TOKEN_HEYCIAR);
  });
});

describe('viste con i numeri, ricerca globale, risposte rapide, trattative ferme', () => {
  const seme = async () => {
    await admin.query(`INSERT INTO ticket (ref, fonte, origine, business, oggetto, stato, priorita, assegnato_a, cliente_nome, aperto_il, prima_risposta_il, scade_prima_risposta, scade_risoluzione, risolto_il) VALUES
      ('heyciar|1','heyciar','remoto','heyciar.it','Accesso negato','aperto','alta',NULL,'Rossi Srl', now(), NULL, now() + interval '2 hours', now() + interval '40 hours', NULL),
      ('heyciar|2','heyciar','remoto','heyciar.it','Fattura errata','in_lavorazione','normale','owner@example.org','Rossi Srl', now(), now(), now() + interval '30 hours', now() + interval '2 hours', NULL),
      ('reti|1','reti','locale','reti.gazzolaelia.it','Wifi giù','aperto','urgente',NULL,'Hotel Aurora', now() - interval '2 days', NULL, now() - interval '5 hours', now() + interval '10 hours', NULL),
      ('reti|2','reti','locale','reti.gazzolaelia.it','Richiesta chiusa','risolto','normale',NULL,'Hotel Aurora', now() - interval '3 days', now() - interval '2 days', NULL, NULL, now() - interval '1 day'),
      ('reti|3','reti','locale','reti.gazzolaelia.it','In attesa','in_attesa_cliente','bassa','anna@example.org','Studio Bianchi', now(), now(), now() + interval '30 hours', now() + interval '60 hours', NULL)`);
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, partita_iva, businesses) VALUES ('c1','Rossi Srl','info@rossi.it','12345678901','{heyciar.it}'), ('c2','Hotel Aurora','info@aurora.it',NULL,'{reti.gazzolaelia.it}')`);
  };

  it('conteggi: da prendere, miei, non assegnati, a rischio entro 4 ore, scaduti, risolti di recente', async () => {
    const { app } = await portale();
    await seme();
    const c = (await app.inject({ method: 'GET', url: '/dashboard/api/ticket-viste', headers: OWNER })).json();
    expect(c).toEqual({ aperti: 4, da_prendere: 2, non_assegnati: 2, miei: 1, in_attesa: 1, sla_scaduti: 1, sla_a_rischio: 2, risolti_7g: 1 });
    // ruolo ristretto e filtro attività: i numeri seguono l'ambito
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/ticket-viste', headers: cookie(['assistenza'], ['heyciar.it'], 'anna') })).json();
    expect(r).toMatchObject({ aperti: 2, da_prendere: 1, miei: 0 });
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/ticket-viste?business=reti.gazzolaelia.it', headers: OWNER })).json().aperti).toBe(2);
    await app.close();
  });

  it('filtro "a rischio": prossima scadenza entro 4 ore, non ancora scaduta', async () => {
    const { app } = await portale();
    await seme();
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/ticket?a_rischio=true&ordine=scadenza', headers: OWNER })).json();
    expect(r.ticket.map((t: { ref: string }) => t.ref).sort()).toEqual(['heyciar|1', 'heyciar|2']);
    expect(r.ticket.every((t: { sla_a_rischio: boolean }) => t.sla_a_rischio)).toBe(true);
    await app.close();
  });

  it('ricerca globale: ticket, clienti e documenti nell\'ambito; testo troppo corto = niente', async () => {
    const { app } = await portale();
    await seme();
    await admin.query(`INSERT INTO documenti (ref, anno, tipo, numero, fonte, business, payload) VALUES ('d1', 2026, 'fattura', 7, 'stripe', 'heyciar.it', '{"cliente":{"ragione_sociale":"Rossi Srl"},"righe":[{"descrizione":"x","importo":100}]}')`);
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/cerca?q=rossi', headers: OWNER })).json();
    expect(r.ticket.map((t: { ref: string }) => t.ref).sort()).toEqual(['heyciar|1', 'heyciar|2']);
    expect(r.clienti.map((c: { nome: string }) => c.nome)).toEqual(['Rossi Srl']);
    expect(r.documenti.map((d: { ref: string }) => d.ref)).toEqual(['d1']);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/cerca?q=r', headers: OWNER })).json()).toEqual({ ticket: [], clienti: [], documenti: [] });
    const ass = (await app.inject({ method: 'GET', url: '/dashboard/api/cerca?q=aurora', headers: cookie(['assistenza'], ['heyciar.it'], 'anna') })).json();
    expect(ass).toEqual({ ticket: [], clienti: [], documenti: [] });
    const senzaSoldi = (await app.inject({ method: 'GET', url: '/dashboard/api/cerca?q=rossi', headers: cookie(['assistenza'], ['heyciar.it'], 'anna') })).json();
    expect(senzaSoldi.documenti).toEqual([]);
    expect(senzaSoldi.clienti).toHaveLength(1);
    await app.close();
  });

  it('risposte rapide: le gestisce solo owner, le leggono tutti nell\'ambito, tolte = disattivate', async () => {
    const { app } = await portale();
    const h = { ...OWNER, ...scrive };
    const a = (await app.inject({ method: 'POST', url: '/dashboard/api/risposte-rapide', headers: h, payload: { nome: 'Presa in carico', testo: 'Ciao {{cliente}}, ce ne occupiamo noi. {{agente}}' } })).json().id;
    await app.inject({ method: 'POST', url: '/dashboard/api/risposte-rapide', headers: h, payload: { nome: 'Solo reti', testo: 'Testo', business: 'reti.gazzolaelia.it' } });
    const ass = cookie(['assistenza'], ['heyciar.it'], 'anna');
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/risposte-rapide', headers: ass })).json().risposte.map((r: { nome: string }) => r.nome)).toEqual(['Presa in carico']);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/risposte-rapide', headers: OWNER })).json().risposte).toHaveLength(2);
    expect((await app.inject({ method: 'POST', url: '/dashboard/api/risposte-rapide', headers: { ...ass, ...scrive }, payload: { nome: 'x', testo: 'y' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: `/dashboard/api/risposte-rapide/${a}`, headers: h, payload: { nome: 'Presa in carico 2' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/dashboard/api/risposte-rapide/${a}`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/dashboard/api/risposte-rapide/${a}`, headers: h })).statusCode).toBe(404);
    expect((await admin.query('SELECT count(*)::int AS n FROM risposte_rapide WHERE NOT attivo')).rows[0].n).toBe(1);
    await app.close();
  });

  it('trattative ferme: aperte e non toccate da almeno N giorni', async () => {
    const { app } = await portale();
    await admin.query(`INSERT INTO crm_opportunita (prospect, business, titolo, fase, creato_da, aggiornato_il) VALUES
      ('A','reti.gazzolaelia.it','Vecchia','proposta','x', now() - interval '20 days'), ('B','reti.gazzolaelia.it','Recente','proposta','x', now()), ('C','reti.gazzolaelia.it','Persa vecchia','persa','x', now() - interval '60 days')`);
    const r = (await app.inject({ method: 'GET', url: '/dashboard/api/opportunita?ferme_giorni=14', headers: OWNER })).json();
    expect(r.opportunita.map((o: { titolo: string }) => o.titolo)).toEqual(['Vecchia']);
    await app.close();
  });
});
