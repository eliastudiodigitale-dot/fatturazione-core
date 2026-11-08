// Scenari operativi end-to-end: flussi ClickUp/n8n, dashboard, Stripe, GoCardless, guasti e casi limite.
import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { creaStripe, elaboratoreStripe, type StripeApi } from '../src/stripe.js';
import { elaboratoreGc, type GcApi } from '../src/gocardless.js';
import { creaClickUp, ErroreClickUp } from '../src/clickup.js';
import { creaNotificatore } from '../src/notifiche.js';
import { FONTI_ESTERNE, FONTI_INTERNE, giroWorker, type DepsWorker } from '../src/worker.js';
import { riconcilia } from '../src/riconciliazione.js';
import { AUTH, ClickUpFinto, admin, aspetta, bustaClickup, cfgTest, costruisci, logCatturato, logMuto, notificheFinte, poolApp, svuota } from './helpers.js';
import { ENV_TEST } from './setup/env.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const ANNO = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date()));
const q = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows;
const post = (app: Awaited<ReturnType<typeof costruisci>>['app'], payload: unknown, h = AUTH.n8n) => app.inject({ method: 'POST', url: '/v1/documenti', headers: h, payload: payload as object });
const enc = encodeURIComponent;

// ---- finti esterni
const vera = creaStripe(ENV_TEST.STRIPE_API_KEY!, ENV_TEST.STRIPE_WEBHOOK_SECRET!);
const stripeApi = (o: { piHaFattura?: boolean } = {}): StripeApi => ({
  verifica: vera.verifica,
  piHaFattura: async () => o.piHaFattura ?? false,
  righeFattura: async () => [],
  clienteDaCharge: async () => ({ nome: 'Cliente Carta', email: 'carta@example.com' }),
  businessDaProdotto: async (id: string) => ({ prod_serr: 'serrandasu.it', prod_hey: 'heyciar.it' })[id],
});
const firmaS = (b: string) => Stripe.webhooks.generateTestHeaderString({ payload: b, secret: ENV_TEST.STRIPE_WEBHOOK_SECRET! });
function invoice(id: string, o: Record<string, unknown> = {}, ev: Record<string, unknown> = {}) {
  return {
    id: `evt_${id}`,
    type: 'invoice.paid',
    livemode: true,
    ...ev,
    data: {
      object: {
        id,
        status: 'paid',
        currency: 'eur',
        total: 2900,
        amount_paid: 2900,
        metadata: { business: 'saas-a' },
        customer: 'cus_1',
        customer_name: 'Cliente Abbonato',
        customer_email: 'abbonato@example.com',
        lines: { data: [{ description: 'Piano mensile', amount: 2900 }], has_more: false },
        ...o,
      },
    },
  };
}
function gcApi(o: { stato?: string; subMeta?: Record<string, string>; payMeta?: Record<string, string>; recupero?: string[] } = {}): GcApi {
  return {
    pagamento: async (id) => ({ id, status: o.stato ?? 'confirmed', currency: 'EUR', amount: 4900, description: 'Rata', metadata: o.payMeta ?? { business: 'saas-b' }, links: { mandate: 'MD1', subscription: 'SB1' } }),
    mandato: async () => ({ links: { customer: 'CU1' }, metadata: {} }),
    cliente: async () => ({ id: 'CU1', given_name: 'Anna', family_name: 'Bianchi', email: 'anna@example.com', metadata: {} }),
    abbonamento: async () => ({ metadata: o.subMeta ?? {} }),
    pagamentiPerStato: async () => (o.recupero ?? []).map((id) => ({ id })),
  };
}
const firmaG = (b: string) => createHmac('sha256', ENV_TEST.GC_WEBHOOK_SECRET!).update(b).digest('hex');
const batchGc = (evs: { id: string; pay: string; action?: string; resource?: string }[]) =>
  JSON.stringify({ events: evs.map((e) => ({ id: e.id, resource_type: e.resource ?? 'payments', action: e.action ?? 'confirmed', links: { payment: e.pay } })) });

async function sistema(o: { gc?: GcApi; stripe?: StripeApi; cfg?: Record<string, string>; sbloccato?: boolean } = {}) {
  const notif = notificheFinte();
  const sApi = o.stripe ?? stripeApi();
  const cfg = cfgTest(o.cfg);
  const s = await costruisci({
    pool,
    cfg,
    stripe: sApi,
    sbloccato: o.sbloccato,
    elaboratori: {
      stripe: elaboratoreStripe({ pool, api: sApi, tipo: 'fattura', log: logMuto, notif, livemode: cfg.stripe!.livemode, businessPredefinito: cfg.stripe!.businessPredefinito, businessPerAccount: cfg.stripe!.businessPerAccount, chiaveOrganizzazione: cfg.stripe!.chiaveOrganizzazione }),
      gocardless: elaboratoreGc({ pool, api: o.gc ?? gcApi(), tipo: 'fattura', trigger: 'confirmed', notif, businessPredefinito: cfg.gocardless!.businessPredefinito }),
    },
  });
  return { ...s, notifEl: notif };
}
const elaborati = async (n: number) => aspetta(async () => (await q('SELECT count(*)::int AS n FROM eventi_ricevuti WHERE elaborato'))[0].n >= n);

describe('ClickUp / n8n', () => {
  it('acconto e saldo sullo stesso progetto: due numeri, entrambi collegati al progetto', async () => {
    const { app } = await costruisci({ pool });
    const a = await post(app, bustaClickup('PRJ1', { rata: 'acconto' }));
    const s = await post(app, bustaClickup('PRJ1', { rata: 'saldo' }));
    expect([a.json().numero, s.json().numero]).toEqual([1, 2]);
    const cu = new ClickUpFinto();
    await giroWorker({ pool, api: cu, cfg: cfgTest().clickup!, log: logMuto, notif: notificheFinte() }, FONTI_INTERNE);
    expect([...cu.task.values()].map((t) => t.collegati)).toEqual([['PRJ1'], ['PRJ1']]);
    await app.close();
  });

  it('proforma poi fattura dallo stesso progetto: numerazioni separate e collegamento alla proforma', async () => {
    const { app } = await costruisci({ pool });
    const p = await post(app, bustaClickup('PRJ2', { tipo: 'proforma' }));
    const f = await post(app, { ...bustaClickup('PRJ2'), rif_proforma: p.json().ref });
    expect(p.json()).toMatchObject({ tipo: 'proforma', numero: 1 });
    expect(f.json()).toMatchObject({ tipo: 'fattura', numero: 1 });
    expect((await q('SELECT payload FROM documenti WHERE tipo = $1', ['fattura']))[0].payload.rif_proforma).toBe('PRJ2|proforma|unica');
    expect((await post(app, { ...bustaClickup('PRJ3'), rif_proforma: 'nessuna|proforma|unica' })).json().codice).toBe('proforma_inesistente');
    await app.close();
  });

  it('n8n riprova dopo un timeout (stessa busta, anche in parallelo): stesso numero, 200', async () => {
    const { app } = await costruisci({ pool });
    const b = bustaClickup('PRJ4');
    const r = await Promise.all(Array.from({ length: 10 }, () => post(app, b)));
    expect(new Set(r.map((x) => x.statusCode))).toEqual(new Set([200]));
    expect(new Set(r.map((x) => x.json().numero)).size).toBe(1);
    await app.close();
  });

  it('stessa ref con importo cambiato: 409, il documento esistente resta com\'era, nessun numero consumato', async () => {
    const { app } = await costruisci({ pool });
    await post(app, bustaClickup('PRJ5'));
    const cambiata = { ...bustaClickup('PRJ5'), righe: [{ descrizione: 'Progetto', importo: 1200 }] };
    const r = await post(app, cambiata);
    expect(r.statusCode).toBe(409);
    expect(r.json().codice).toBe('ref_con_dati_diversi');
    expect((await q('SELECT payload FROM documenti'))[0].payload.righe[0].importo).toBe(1000);
    expect((await q('SELECT ultimo FROM contatori'))[0].ultimo).toBe(1);
    await app.close();
  });

  it('proforma annullata e rifatta: la stessa ref dà 409, con versione 2 prende il primo numero libero', async () => {
    const { app } = await costruisci({ pool });
    await post(app, bustaClickup('PRJ6', { tipo: 'proforma' })); // 1
    await post(app, bustaClickup('PRJ7', { tipo: 'proforma' })); // 2
    await app.inject({ method: 'POST', url: `/v1/documenti/${enc('PRJ6|proforma|unica')}/annulla`, headers: AUTH.owner, payload: { motivo: 'importo sbagliato' } });
    const stessa = await post(app, bustaClickup('PRJ6', { tipo: 'proforma' }));
    expect(stessa.json().codice).toBe('ref_annullata');
    const v2 = await post(app, { ...bustaClickup('PRJ6', { tipo: 'proforma' }), ref: 'PRJ6|proforma|unica|v2', versione: 2 });
    expect(v2.statusCode).toBe(200);
    expect(v2.json().numero).toBe(3);
    // una fattura non può riferirsi alla proforma annullata
    expect((await post(app, { ...bustaClickup('PRJ6'), rif_proforma: 'PRJ6|proforma|unica' })).json().codice).toBe('proforma_annullata');
    await app.close();
  });

  it('importi: totale zero o negativo e 3 decimali rifiutati; sconto in riga ammesso se il totale è positivo', async () => {
    const { app } = await costruisci({ pool });
    const con = (righe: { descrizione: string; importo: number }[], p = 'PRJ8') => post(app, { ...bustaClickup(p), righe });
    expect((await con([{ descrizione: 'x', importo: 0 }])).statusCode).toBe(400);
    expect((await con([{ descrizione: 'x', importo: 100 }, { descrizione: 'storno', importo: -100 }])).statusCode).toBe(400);
    expect((await con([{ descrizione: 'x', importo: 10.005 }])).statusCode).toBe(400);
    const ok = await con([{ descrizione: 'Sito', importo: 1500.1 }, { descrizione: 'Sconto', importo: -100.1 }]);
    expect(ok.statusCode).toBe(200);
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 1 }]);
    await app.close();
  });

  it('dati cliente: formati controllati, avvisi per lo SDI senza bloccare', async () => {
    const { app } = await costruisci({ pool });
    const senza = await post(app, bustaClickup('PRJ9'));
    expect(senza.json().avvisi.length).toBeGreaterThan(0);
    const completo = await post(app, {
      ...bustaClickup('PRJ10'),
      cliente: { ragione_sociale: 'Studio Srl', partita_iva: '01234567890', codice_destinatario: 'ABC1234', indirizzo: { via: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI', paese: 'IT' } },
    });
    expect(completo.json().avvisi).toEqual([]);
    expect((await post(app, { ...bustaClickup('PRJ11'), cliente: { nome: 'X', partita_iva: '123' } })).statusCode).toBe(400);
    expect((await post(app, { ...bustaClickup('PRJ12'), cliente: { email: 'solo@email.it' } })).statusCode).toBe(400);
    await app.close();
  });

  it('una lista ClickUp sbagliata blocca solo quel documento, gli altri vengono creati', async () => {
    const { app } = await costruisci({ pool });
    await post(app, bustaClickup('PRJ13'));
    const errata = bustaClickup('PRJ14');
    (errata.dati_fonte.clickup as Record<string, string>).list_id_documenti = 'lista-inesistente';
    await post(app, errata);
    await post(app, bustaClickup('PRJ15'));
    const cu = new ClickUpFinto();
    cu.rifiutaLista.add('lista-inesistente');
    const notif = notificheFinte();
    expect(await giroWorker({ pool, api: cu, cfg: cfgTest().clickup!, log: logMuto, notif }, FONTI_INTERNE)).toEqual({ creati: 2 });
    expect(notif.lista.map((n) => n.codice)).toEqual(['clickup_documento_rifiutato']);
    expect((await q("SELECT ref FROM documenti WHERE stato = 'riservato'"))[0].ref).toBe('PRJ14|fattura|unica');
    await app.close();
  });
});

describe('Stripe', () => {
  const invia = (app: Awaited<ReturnType<typeof costruisci>>['app'], ev: unknown) => {
    const b = JSON.stringify(ev);
    return app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaS(b), 'content-type': 'application/json' }, payload: b });
  };

  it('evento di test con il servizio in produzione: ignorato, nessun numero', async () => {
    const { app } = await sistema();
    await invia(app, invoice('in_test', {}, { livemode: false }));
    await elaborati(1);
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 0 }]);
    await app.close();
  });

  it('coupon: righe al netto degli sconti; righe incoerenti col totale -> nessun numero e anomalia', async () => {
    const { app, notif } = await sistema();
    await invia(app, invoice('in_coupon', { total: 2500, amount_paid: 2500, lines: { data: [{ description: 'Piano annuale', amount: 3000, discount_amounts: [{ amount: 500 }] }], has_more: false } }));
    await invia(app, invoice('in_rotta', { total: 2600, amount_paid: 2600, lines: { data: [{ description: 'Piano', amount: 3000, discount_amounts: [{ amount: 500 }] }], has_more: false } }));
    await aspetta(async () => notif.lista.length > 0 && (await q('SELECT count(*)::int AS n FROM documenti'))[0].n === 1);
    expect((await q('SELECT payload FROM documenti'))[0].payload.righe).toEqual([{ descrizione: 'Piano annuale', importo: 25 }]);
    expect(notif.lista.map((n) => n.codice)).toContain('stripe_righe_diverse_dal_totale');
    await app.close();
  });

  it('IVA addebitata in Stripe (regime forfettario): non si emette, anomalia', async () => {
    const { app, notif } = await sistema();
    await invia(app, invoice('in_iva', { total: 3538, amount_paid: 3538, total_taxes: [{ amount: 638 }] }));
    await aspetta(async () => notif.lista.length > 0);
    expect(notif.lista[0]!.codice).toBe('stripe_iva_presente');
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 0 }]);
    await app.close();
  });

  it('business preso dai metadata dell\'abbonamento, oppure dal default configurato', async () => {
    const { app } = await sistema({ cfg: { STRIPE_BUSINESS_PREDEFINITO: 'saas-default' } });
    await invia(app, invoice('in_sub', { metadata: {}, parent: { subscription_details: { metadata: { business: 'saas-sub' } } } }));
    await invia(app, invoice('in_def', { metadata: {} }));
    await elaborati(2);
    expect((await q('SELECT ref, business FROM documenti ORDER BY numero')).map((r) => r.business)).toEqual(['saas-sub', 'saas-default']);
    await app.close();
  });

  it('rimborso o contestazione: nessun numero, anomalia "nota di credito da valutare"', async () => {
    const { app, notifEl } = await sistema();
    await invia(app, { id: 'evt_rimb', type: 'charge.refunded', livemode: true, data: { object: { id: 'ch_1' } } });
    await elaborati(1);
    expect(notifEl.lista[0]).toMatchObject({ codice: 'stripe_correzione_da_fare' });
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 0 }]);
    await app.close();
  });

  it('pagamento singolo con cliente dalla carta: un numero, cliente compilato', async () => {
    const { app } = await sistema();
    await invia(app, { id: 'evt_pi1', type: 'payment_intent.succeeded', livemode: true, data: { object: { id: 'pi_1', currency: 'eur', amount_received: 15000, description: 'Consulenza', metadata: { business: 'consulenze' }, latest_charge: 'ch_9' } } });
    await elaborati(1);
    const d = (await q('SELECT ref, payload FROM documenti'))[0];
    expect(d.ref).toBe('stripe|pi_1|fattura');
    expect(d.payload.cliente.nome).toBe('Cliente Carta');
    expect(d.payload.righe).toEqual([{ descrizione: 'Consulenza', importo: 150 }]);
    await app.close();
  });
});

describe('GoCardless', () => {
  const invia = (app: Awaited<ReturnType<typeof costruisci>>['app'], b: string) =>
    app.inject({ method: 'POST', url: '/webhooks/gocardless', headers: { 'webhook-signature': firmaG(b), 'content-type': 'application/json' }, payload: b });

  it('pagamento di abbonamento senza metadata propri: business dall\'abbonamento', async () => {
    const { app } = await sistema({ gc: gcApi({ payMeta: {}, subMeta: { business: 'saas-sub-gc' } }) });
    await invia(app, batchGc([{ id: 'EVs1', pay: 'PMs1' }]));
    await elaborati(1);
    expect((await q('SELECT business FROM documenti'))[0].business).toBe('saas-sub-gc');
    await app.close();
  });

  it('storno o rimborso: nessun numero, anomalia', async () => {
    const { app, notifEl } = await sistema();
    await invia(app, batchGc([{ id: 'EVr1', pay: 'PMr1', action: 'charged_back' }, { id: 'EVr2', pay: 'PMr1', resource: 'refunds', action: 'created' }]));
    await elaborati(2);
    expect(notifEl.lista.map((n) => n.codice)).toEqual(['gc_correzione_da_fare', 'gc_correzione_da_fare']);
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 0 }]);
    await app.close();
  });

  it('webhook mai arrivato: la riconciliazione trova il pagamento confermato e crea il documento', async () => {
    const api = gcApi({ recupero: ['PMlost'] });
    const { eventi } = await sistema({ gc: api });
    const r = await riconcilia({ pool, notif: notificheFinte(), log: logMuto, riservatoMaxOre: 24, gc: { api, trigger: 'confirmed', tipo: 'fattura', eventi } });
    expect(r.gcRecuperati).toEqual(['PMlost']);
    expect((await q('SELECT ref FROM documenti'))[0].ref).toBe('gocardless|PMlost|fattura');
    // seconda riconciliazione: niente doppioni
    await riconcilia({ pool, notif: notificheFinte(), log: logMuto, riservatoMaxOre: 24, gc: { api, trigger: 'confirmed', tipo: 'fattura', eventi } });
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 1 }]);
  });
});

describe('Guasti e modalità bloccata', () => {
  it('servizio bloccato: il webhook viene accettato e messo in coda; allo sblocco il documento nasce', async () => {
    const { app, blocco, eventi } = await sistema({ sbloccato: false });
    const b = batchGc([{ id: 'EVb1', pay: 'PMb1' }]);
    const r = await app.inject({ method: 'POST', url: '/webhooks/gocardless', headers: { 'webhook-signature': firmaG(b) }, payload: b });
    expect(r.statusCode).toBe(204);
    await new Promise((x) => setTimeout(x, 200));
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 0 }]);
    blocco.esito([]);
    expect(await eventi.riprendi()).toBe(1);
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 1 }]);
    await app.close();
  });

  it('client ClickUp reale: 429 e errore di rete vengono ritentati, 400 no', async () => {
    let n = 0;
    const risposte: (() => Response)[] = [
      () => new Response('{}', { status: 429 }),
      () => {
        throw new Error('ECONNRESET');
      },
      () => new Response(JSON.stringify({ id: 'tOK' }), { status: 200 }),
      () => new Response('{}', { status: 400 }),
    ];
    const fetchFn = (async () => risposte[n++]!()) as unknown as typeof fetch;
    const cu = creaClickUp({ token: 't', apiUrl: 'https://x', rpm: 6000, campi: cfgTest().clickup!.campi, fetchFn });
    expect(await cu.creaTask('l', { nome: 'a', descrizione: '', campi: [] })).toBe('tOK');
    expect(n).toBe(3);
    await expect(cu.creaTask('l', { nome: 'a', descrizione: '', campi: [] })).rejects.toBeInstanceOf(ErroreClickUp);
    expect(n).toBe(4);
  }, 20_000);

  it('notifiche Telegram: inviate una volta per anomalia, senza token nei log', async () => {
    const inviati: { url: string; body: string }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      inviati.push({ url, body: String(init.body) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const { righe, logger } = logCatturato();
    const { app } = await costruisci({ pool, logger });
    const notif = creaNotificatore(app.log, { telegram: { token: 'TOKEN-SEGRETO', chatId: '42' }, fetchFn });
    notif.anomalia('prova', { ref: 'x|fattura|unica' });
    notif.anomalia('prova', { ref: 'x|fattura|unica' });
    await new Promise((x) => setTimeout(x, 50));
    expect(inviati).toHaveLength(1);
    expect(JSON.parse(inviati[0]!.body)).toMatchObject({ chat_id: '42' });
    expect(righe.join('')).not.toContain('TOKEN-SEGRETO');
    await app.close();
  });
});

describe('Giornata tipo: tutte le fonti insieme', () => {
  it('n8n, dashboard, Stripe e GoCardless in parallelo: sequenza continua, task giuste, riconciliazione pulita', async () => {
    const { app } = await sistema();
    const stripeEv = (i: number) => {
      const b = JSON.stringify(invoice(`in_m${i}`));
      return app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaS(b) }, payload: b });
    };
    const gcB = batchGc(Array.from({ length: 10 }, (_, i) => ({ id: `EVm${i}`, pay: `PMm${i}` })));
    const lavori = [
      ...Array.from({ length: 15 }, (_, i) => post(app, bustaClickup(`M${i}`))),
      ...Array.from({ length: 5 }, (_, i) => post(app, { ...bustaClickup(`D${i}`), fonte: 'dashboard', ref: `dashboard|D${i}|fattura`, dati_fonte: undefined }, AUTH.dashboard)),
      ...Array.from({ length: 5 }, (_, i) => post(app, bustaClickup(`MP${i}`, { tipo: 'proforma' }))),
      ...Array.from({ length: 10 }, (_, i) => stripeEv(i)),
      app.inject({ method: 'POST', url: '/webhooks/gocardless', headers: { 'webhook-signature': firmaG(gcB) }, payload: gcB }),
      ...Array.from({ length: 10 }, (_, i) => stripeEv(i)), // Stripe rimanda gli stessi eventi
    ];
    const risposte = await Promise.all(lavori);
    expect(risposte.filter((r) => r.statusCode >= 300).map((r) => `${r.statusCode} ${r.body}`)).toEqual([]);
    await elaborati(20);

    const fatture = (await q(`SELECT numero FROM documenti WHERE tipo = 'fattura' ORDER BY data_riserva, id`)).map((r) => r.numero);
    expect(fatture).toEqual(Array.from({ length: 40 }, (_, i) => i + 1)); // 15 + 5 + 10 + 10
    expect((await q(`SELECT max(numero)::int AS m FROM documenti WHERE tipo = 'proforma'`))[0].m).toBe(5);

    const cu = new ClickUpFinto();
    const deps: DepsWorker = { pool, api: cu, cfg: cfgTest().clickup!, log: logMuto, notif: notificheFinte() };
    expect(await giroWorker(deps, FONTI_INTERNE)).toEqual({ creati: 25 });
    expect(await giroWorker(deps, FONTI_ESTERNE)).toEqual({ creati: 20 });
    expect(await giroWorker(deps, [...FONTI_INTERNE, ...FONTI_ESTERNE])).toEqual({ creati: 0 });
    expect(cu.task.size).toBe(45);

    const r = await riconcilia({ pool, notif: deps.notif, log: logMuto, riservatoMaxOre: 24, clickup: deps });
    expect({ buchi: r.buchi, doppie: r.taskDoppie, orfane: r.taskOrfane, vecchi: r.riservatiVecchi, errori: r.errori }).toEqual({ buchi: [], doppie: [], orfane: [], vecchi: [], errori: [] });

    const rie = await app.inject({ method: 'GET', url: '/v1/riepilogo', headers: AUTH.dashboard });
    expect(rie.json().ultimi).toEqual([
      { anno: ANNO, tipo: 'fattura', ultimo: 40 },
      { anno: ANNO, tipo: 'proforma', ultimo: 5 },
    ]);
    expect(rie.json().servizio.bloccato).toBe(false);
    expect(JSON.stringify(rie.json())).not.toContain('@example.com');
    const st = await app.inject({ method: 'GET', url: `/v1/documenti/${enc('M0|fattura|unica')}/storico`, headers: AUTH.dashboard });
    expect(st.json().storico.map((s: { a_stato: string }) => s.a_stato)).toEqual(['riservato', 'creato']);
    await app.close();
  }, 60_000);
});

describe('Lista ClickUp reale (una lista, numeri storici a mano, campi esistenti)', () => {
  const UNICA = { CLICKUP_LIST_ID_FATTURA: 'lista-unica', CLICKUP_LIST_ID_PROFORMA: 'lista-unica', CLICKUP_CAMPO_AREA_ID: 'campo-area', CLICKUP_CAMPO_METODO_ID: 'campo-metodo' };
  const opzioni = [
    { id: 'campo-area', name: 'AREA', type: 'drop_down', options: [{ id: 'op-serr', name: 'Serrandasu' }, { id: 'op-gaz', name: 'gazzolaelia.it' }] },
    { id: 'campo-metodo', name: 'metodo-pag', type: 'drop_down', options: [{ id: 'op-bon', name: 'Bonifico' }, { id: 'op-str', name: 'Stripe' }] },
  ];

  it('numeri già usati a mano: il servizio resta bloccato finché il contatore non è riallineato, poi riparte dal successivo', async () => {
    const { controlloContatori } = await import('../src/blocco.js');
    const cu = new ClickUpFinto();
    cu.aggiungiAMano('lista-unica', [{ tipo: 'fattura', anno: ANNO, numero: 37 }]);
    cu.aggiungiAMano('lista-unica', [{ tipo: 'proforma', anno: ANNO, numero: 12 }, { tipo: 'fattura', anno: ANNO, numero: 36 }]);
    const lid = { fattura: 'lista-unica', proforma: 'lista-unica' };
    const problemi = await controlloContatori(pool, { api: cu, listId: lid });
    expect(problemi).toEqual([`contatore ${ANNO}|fattura = 0 < massimo trovato 37`, `contatore ${ANNO}|proforma = 0 < massimo trovato 12`]);
    // riallineamento come lo script owner (qui da superutente del DB di prova)
    await admin.query(`INSERT INTO contatori(anno, tipo, ultimo) VALUES ($1, 'fattura', 37), ($1, 'proforma', 12)`, [ANNO]);
    expect(await controlloContatori(pool, { api: cu, listId: lid })).toEqual([]);
    const { app } = await costruisci({ pool });
    expect((await post(app, bustaClickup('NUOVO'))).json().numero).toBe(38);
    expect((await post(app, bustaClickup('NUOVO', { tipo: 'proforma' }))).json().numero).toBe(13);
    await app.close();
  });

  it('la task nasce con i campi della lista: numero, anno, checkbox, totale, data, cliente, AREA e pagamento', async () => {
    const { app } = await sistema({ cfg: UNICA });
    await post(app, { ...bustaClickup('P1'), business: 'serrandasu.it', righe: [{ descrizione: 'Serranda', importo: 1200.5 }] });
    const b = JSON.stringify(invoice('in_area', { metadata: { business: 'gazzolaelia.it' } }));
    await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaS(b) }, payload: b });
    await elaborati(1);
    const cu = new ClickUpFinto();
    cu.opzioni = opzioni;
    const notif = notificheFinte();
    const deps = { pool, api: cu, cfg: cfgTest(UNICA).clickup!, log: logMuto, notif };
    await giroWorker(deps, [...FONTI_INTERNE, ...FONTI_ESTERNE]);
    const [f1, f2] = [...cu.task.values()];
    const campi = (t: typeof f1) => Object.fromEntries(t!.t!.campi.map((c) => [c.id, c.value]));
    expect(campi(f1)).toMatchObject({ 'campo-chiave': `fattura|${ANNO}|1`, 'campo-anno': ANNO, 'campo-nr-f': 1, 'campo-flag-f': true, 'campo-tot-f': 1200.5, 'campo-ragione': 'Mario Rossi', 'campo-email': 'mario.rossi@example.com', 'campo-area': 'op-serr' });
    expect(campi(f1)).not.toHaveProperty('campo-pagata');
    expect(f1!.t!.campi.find((c) => c.id === 'campo-data')!.value_options).toEqual({ time: false });
    expect(campi(f2)).toMatchObject({ 'campo-nr-f': 2, 'campo-pagata': true, 'campo-metodo': 'op-str', 'campo-area': 'op-gaz', 'campo-tot-f': 29 });
    expect(f1!.lista).toBe('lista-unica');
    expect(notif.lista).toEqual([]);
    await app.close();
  });

  it('attività non presente nel menu AREA: la task nasce lo stesso, arriva un avviso', async () => {
    const { app } = await costruisci({ pool });
    await post(app, { ...bustaClickup('P2'), business: 'heyciar.it' });
    const cu = new ClickUpFinto();
    cu.opzioni = opzioni;
    const notif = notificheFinte();
    expect(await giroWorker({ pool, api: cu, cfg: cfgTest(UNICA).clickup!, log: logMuto, notif }, FONTI_INTERNE)).toEqual({ creati: 1 });
    expect(notif.lista.map((n) => n.codice)).toEqual(['clickup_area_sconosciuta']);
    await app.close();
  });

  it('riconciliazione: task storiche non sono "orfane"; un numero usato sia a mano sia dal servizio è segnalato', async () => {
    const { app } = await costruisci({ pool });
    await post(app, bustaClickup('P3'));
    const cu = new ClickUpFinto();
    cu.aggiungiAMano('lista-unica', [{ tipo: 'proforma', anno: ANNO - 1, numero: 80 }]);
    cu.aggiungiAMano('lista-unica', [{ tipo: 'fattura', anno: ANNO, numero: 1 }]); // stesso numero che emetterà il servizio
    const deps = { pool, api: cu, cfg: cfgTest(UNICA).clickup!, log: logMuto, notif: notificheFinte() };
    await giroWorker(deps, FONTI_INTERNE);
    const r = await riconcilia({ pool, notif: deps.notif, log: logMuto, riservatoMaxOre: 24, clickup: deps });
    expect(r.taskOrfane).toEqual([]);
    expect(r.taskDoppie).toEqual([]); // stessa lista per fatture e proforme: nessun falso doppione
    expect(r.collisioni).toEqual([`fattura|${ANNO}|1`]);
    await app.close();
  });

  it('Stripe con più attività: attività dal metadata del prodotto; prodotti di attività diverse nella stessa invoice -> bloccata', async () => {
    const { app, notif } = await sistema();
    const inv = (id: string, prodotti: string[]) =>
      invoice(id, { metadata: {}, lines: { data: prodotti.map((p) => ({ description: 'Piano', amount: 2900 / prodotti.length, pricing: { price_details: { product: p } } })), has_more: false } });
    const invia = (ev: unknown) => { const b = JSON.stringify(ev); return app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaS(b) }, payload: b }); };
    await invia(inv('in_p1', ['prod_serr']));
    await invia(inv('in_p2', ['prod_serr', 'prod_hey']));
    await aspetta(async () => notif.lista.length > 0 && (await q('SELECT count(*)::int AS n FROM documenti'))[0].n === 1);
    expect((await q('SELECT business FROM documenti'))[0].business).toBe('serrandasu.it');
    expect(notif.lista.map((n) => n.codice)).toContain('stripe_business_ambiguo');
    await app.close();
  });
});

describe('Lettura dei campi ClickUp nel formato reale delle API', () => {
  it('numeri come testo, checkbox "true"/true, checkbox spenta o anno mancante = nessun numero', async () => {
    const { infoTask } = await import('../src/clickup.js');
    const campi = cfgTest().clickup!.campi;
    const t = (cf: { id: string; value?: unknown }[]) => infoTask({ id: 'x', custom_fields: cf }, campi).numeri;
    expect(t([{ id: 'campo-anno', value: '2026' }, { id: 'campo-nr-f', value: '37' }, { id: 'campo-flag-f', value: 'true' }])).toEqual([{ tipo: 'fattura', anno: 2026, numero: 37 }]);
    expect(t([{ id: 'campo-anno', value: 2026 }, { id: 'campo-nr-p', value: 5 }, { id: 'campo-flag-p', value: true }, { id: 'campo-nr-f', value: 9 }, { id: 'campo-flag-f', value: true }])).toHaveLength(2);
    expect(t([{ id: 'campo-anno', value: 2026 }, { id: 'campo-nr-f', value: 37 }])).toEqual([]); // checkbox non spuntata
    expect(t([{ id: 'campo-nr-f', value: 37 }, { id: 'campo-flag-f', value: true }])).toEqual([]); // né anno né data
    const ms = String(Date.UTC(2025, 5, 10));
    expect(t([{ id: 'campo-nr-f', value: 37 }, { id: 'campo-flag-f', value: true }, { id: 'campo-data', value: ms }])).toEqual([{ tipo: 'fattura', anno: 2025, numero: 37 }]); // anno dalla data
    expect(infoTask({ id: 'y', custom_fields: [{ id: 'campo-chiave', value: 'proforma|2026|4' }] }, campi).numeri).toEqual([{ tipo: 'proforma', anno: 2026, numero: 4 }]);
  });
});

describe('Configurazione', () => {
  it('ClickUp configurato a metà: il servizio non parte (mai "ClickUp spento" in silenzio)', () => {
    expect(() => cfgTest({ CLICKUP_CAMPO_CHIAVE_ID: '' })).toThrow(/ClickUp configurato a metà/);
    expect(cfgTest().clickup).toBeDefined();
  });
});

describe('Integrazione con il flusso n8n "auto_pro-forma" (numero prima dell\'OK, task creata dal workflow)', () => {
  const busta = (o: Record<string, unknown> = {}) => ({ ...bustaClickup('PRJ-A', { tipo: 'proforma' }), auto_versione: true, ...o });
  const annulla = (app: Awaited<ReturnType<typeof costruisci>>['app'], ref: string, h = AUTH.n8n) =>
    app.inject({ method: 'POST', url: `/v1/documenti/${enc(ref)}/annulla`, headers: h, payload: { motivo: 'NO su Telegram' } });

  it('auto_versione: ritentativi = stesso numero; dopo un NO il nuovo invio prende il numero successivo', async () => {
    const { app } = await costruisci({ pool });
    const r1 = await post(app, busta());
    const r1b = await post(app, busta()); // n8n riprova (Gotenberg giù, ecc.)
    expect([r1.json().numero, r1b.json().numero, r1.json().ref]).toEqual([1, 1, 'PRJ-A|proforma|unica']);
    expect((await annulla(app, r1.json().ref)).statusCode).toBe(200); // NO all'approvazione
    const r2 = await post(app, busta());
    expect(r2.json()).toMatchObject({ numero: 2, ref: 'PRJ-A|proforma|unica|v2' });
    await annulla(app, r2.json().ref);
    expect((await post(app, busta())).json()).toMatchObject({ numero: 3, ref: 'PRJ-A|proforma|unica|v3' });
    await app.close();
  });

  it('n8n può annullare solo proforme proprie ancora "riservato"; mai fatture, mai dopo la task', async () => {
    const { app } = await costruisci({ pool });
    const p = (await post(app, busta())).json();
    await app.inject({ method: 'POST', url: `/v1/documenti/${enc(p.ref)}/stato`, headers: AUTH.n8n, payload: { a_stato: 'creato', clickup_task_id: 't1' } });
    expect((await annulla(app, p.ref)).statusCode).toBe(403); // già in ClickUp: solo owner
    expect((await annulla(app, p.ref, AUTH.owner)).statusCode).toBe(200);
    const f = (await post(app, bustaClickup('PRJ-F'))).json();
    expect((await annulla(app, f.ref)).statusCode).toBe(403);
    const d = (await post(app, { ...bustaClickup('X'), fonte: 'dashboard', ref: 'dashboard|X|proforma', tipo: 'proforma', dati_fonte: undefined }, AUTH.dashboard)).json();
    expect((await annulla(app, d.ref)).statusCode).toBe(403); // non è di n8n
    await app.close();
  });

  it('il worker lascia 45 minuti al workflow; poi crea lui la task (nome come il flusso) e avvisa', async () => {
    const { app } = await costruisci({ pool });
    const dfc = { task_progetto_id: 'PRJ-W', campo_relationship_id: 'campo-rel', nome_progetto: 'Villa Rossi', cliente_task_id: 'CLI1' };
    await post(app, { ...busta(), ref: 'PRJ-W|proforma|unica', dati_fonte: { clickup: dfc } });
    const cu = new ClickUpFinto();
    const notif = notificheFinte();
    const deps = { pool, api: cu, cfg: cfgTest({ CLICKUP_CAMPO_CLIENTE_ID: 'campo-cliente' }).clickup!, log: logMuto, notif };
    expect(await giroWorker(deps, FONTI_INTERNE, 45)).toEqual({ creati: 0 });
    await admin.query(`UPDATE documenti SET data_riserva = now() - interval '46 minutes'`);
    expect(await giroWorker(deps, FONTI_INTERNE, 45)).toEqual({ creati: 1 });
    const t = [...cu.task.values()][0]!;
    expect(t.t!.nome).toBe(`F-Villa Rossi-${ANNO}`);
    expect(t.collegati).toEqual(['PRJ-W', 'CLI1']);
    expect(notif.lista.map((n) => n.codice)).toEqual(['clickup_task_dal_servizio']);
    await app.close();
  });

  it('il workflow crea la task e conferma: il worker non fa nulla, nessun doppione', async () => {
    const { app } = await costruisci({ pool });
    const p = (await post(app, busta())).json();
    const cu = new ClickUpFinto();
    const id = await cu.creaTask('lista-proforme', { nome: 'F-x-2026', descrizione: '', campi: [{ id: 'campo-chiave', value: `proforma|${p.anno}|${p.numero}` }] });
    await app.inject({ method: 'POST', url: `/v1/documenti/${enc(p.ref)}/stato`, headers: AUTH.n8n, payload: { a_stato: 'creato', clickup_task_id: id } });
    await admin.query(`UPDATE documenti SET data_riserva = now() - interval '2 hours'`);
    expect(await giroWorker({ pool, api: cu, cfg: cfgTest().clickup!, log: logMuto, notif: notificheFinte() }, FONTI_INTERNE, 45)).toEqual({ creati: 0 });
    expect(cu.task.size).toBe(1);
    await app.close();
  });

  it('una task con proforma e poi fattura: entrambe le chiavi nello stesso campo', async () => {
    const { infoTask, contieneChiave } = await import('../src/clickup.js');
    const campi = cfgTest().clickup!.campi;
    const i = infoTask({ id: 'x', custom_fields: [{ id: 'campo-chiave', value: 'proforma|2026|13 fattura|2026|38' }] }, campi);
    expect(i.numeri).toEqual([{ tipo: 'proforma', anno: 2026, numero: 13 }, { tipo: 'fattura', anno: 2026, numero: 38 }]);
    expect(contieneChiave(i.chiave, 'fattura|2026|38')).toBe(true);
    expect(contieneChiave(i.chiave, 'fattura|2026|3')).toBe(false);
  });
});

describe('Avvio con lo storico reale (numeri a mano 2025 e 2026, contatore riallineato)', () => {
  it('i numeri a mano degli anni passati non bloccano; il riallineamento non produce falsi buchi', async () => {
    const { controlloContatori } = await import('../src/blocco.js');
    const cu = new ClickUpFinto();
    cu.aggiungiAMano('lista-unica', [{ tipo: 'fattura', anno: ANNO - 1, numero: 7 }, { tipo: 'proforma', anno: ANNO - 1, numero: 7 }]);
    cu.aggiungiAMano('lista-unica', [{ tipo: 'fattura', anno: ANNO, numero: 8 }, { tipo: 'proforma', anno: ANNO, numero: 15 }]);
    const lid = { fattura: 'lista-unica', proforma: 'lista-unica' };
    // contatore dell'anno in corso indietro: blocca (e l'anno scorso non viene nominato)
    expect(await controlloContatori(pool, { api: cu, listId: lid })).toEqual([`contatore ${ANNO}|fattura = 0 < massimo trovato 8`, `contatore ${ANNO}|proforma = 0 < massimo trovato 15`]);
    await admin.query(`INSERT INTO contatori(anno, tipo, ultimo) VALUES ($1, 'fattura', 8), ($1, 'proforma', 15)`, [ANNO]);
    expect(await controlloContatori(pool, { api: cu, listId: lid })).toEqual([]);
    const { app } = await costruisci({ pool });
    expect((await post(app, bustaClickup('N1', { tipo: 'proforma' }))).json().numero).toBe(16);
    const r = await riconcilia({ pool, notif: notificheFinte(), log: logMuto, riservatoMaxOre: 24 });
    expect(r.buchi).toEqual([]); // 1..15 sono a mano: non sono buchi
    await app.close();
  });
});

describe('Stripe con organizzazione (un account per attività, chiave sk_org_)', () => {
  const ORG = { STRIPE_API_KEY: 'sk_org_live_prova', STRIPE_BUSINESS_PER_ACCOUNT: 'acct_SERR=serrandasu.it,acct_HEY=heyciar.it,acct_GAZ=gazzolaelia.it' };
  const chiamate: (string | undefined)[] = [];
  const apiOrg: StripeApi = {
    verifica: vera.verifica,
    piHaFattura: async (_id, ctx) => { chiamate.push(ctx); return false; },
    righeFattura: async (_id, ctx) => { chiamate.push(ctx); return [{ descrizione: 'Piano', centesimi: 2900 }]; },
    clienteDaCharge: async (_id, ctx) => { chiamate.push(ctx); return { nome: 'Cliente Org' }; },
    businessDaProdotto: async () => 'non-deve-servire',
  };
  const invia = (app: Awaited<ReturnType<typeof costruisci>>['app'], ev: unknown) => {
    const b = JSON.stringify(ev);
    return app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaS(b) }, payload: b });
  };

  it('configurazione: chiave di organizzazione riconosciuta, mappa account -> attività', () => {
    const c = cfgTest(ORG).stripe!;
    expect(c.chiaveOrganizzazione).toBe(true);
    expect(c.businessPerAccount).toEqual({ acct_SERR: 'serrandasu.it', acct_HEY: 'heyciar.it', acct_GAZ: 'gazzolaelia.it' });
    expect(() => cfgTest({ STRIPE_BUSINESS_PER_ACCOUNT: 'serrandasu.it' })).toThrow(/STRIPE_BUSINESS_PER_ACCOUNT/);
  });

  it('l\'attività è quella dell\'account che ha incassato; le letture su Stripe usano quell\'account', async () => {
    chiamate.length = 0;
    const { app } = await sistema({ stripe: apiOrg, cfg: ORG });
    await invia(app, invoice('in_o1', { metadata: {}, lines: { data: [], has_more: true } }, { context: 'acct_SERR' }));
    await invia(app, { id: 'evt_pio', type: 'payment_intent.succeeded', livemode: true, context: 'acct_HEY', data: { object: { id: 'pi_o1', currency: 'eur', amount_received: 5000, metadata: {}, latest_charge: 'ch_o1' } } });
    await elaborati(2);
    expect((await q('SELECT ref, business, payload FROM documenti ORDER BY numero')).map((d) => [d.ref, d.business, d.payload.dati_fonte.stripe.account])).toEqual([
      ['stripe|in_o1|fattura', 'serrandasu.it', 'acct_SERR'],
      ['stripe|pi_o1|fattura', 'heyciar.it', 'acct_HEY'],
    ]);
    expect(new Set(chiamate)).toEqual(new Set(['acct_SERR', 'acct_HEY']));
    await app.close();
  });

  it('evento senza account o di un account non in mappa: nessun numero, avviso', async () => {
    const { app, notif } = await sistema({ stripe: apiOrg, cfg: ORG });
    await invia(app, invoice('in_o2'));
    await invia(app, invoice('in_o3', {}, { context: 'acct_ALTRO' }));
    await aspetta(async () => notif.lista.length >= 2);
    expect(notif.lista.map((n) => n.codice).sort()).toEqual(['stripe_account_sconosciuto', 'stripe_evento_senza_account']);
    expect(await q('SELECT count(*)::int AS n FROM documenti')).toEqual([{ n: 0 }]);
    await app.close();
  });
});

describe('Doppioni storici fatti a mano', () => {
  it('stanno nel rapporto ma non generano l\'avviso giornaliero; una collisione con il servizio sì', async () => {
    const cu = new ClickUpFinto();
    cu.aggiungiAMano('lista-unica', [{ tipo: 'fattura', anno: ANNO, numero: 3 }]);
    cu.aggiungiAMano('lista-unica', [{ tipo: 'fattura', anno: ANNO, numero: 3 }]);
    const deps = { pool, api: cu, cfg: cfgTest({ CLICKUP_LIST_ID_FATTURA: 'lista-unica', CLICKUP_LIST_ID_PROFORMA: 'lista-unica' }).clickup!, log: logMuto, notif: notificheFinte() };
    const r = await riconcilia({ pool, notif: deps.notif, log: logMuto, riservatoMaxOre: 24, clickup: deps });
    expect(r.doppiStorici).toHaveLength(1);
    expect(r.taskDoppie).toEqual([]);
    expect(deps.notif.lista).toEqual([]);
  });
});
