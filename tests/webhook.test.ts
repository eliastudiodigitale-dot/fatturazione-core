// Test 4 e 5 (SPEC 11): webhook duplicati e firma errata, più le regole Stripe/GoCardless.
import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { creaStripe, elaboratoreStripe, type StripeApi } from '../src/stripe.js';
import { elaboratoreGc, type GcApi } from '../src/gocardless.js';
import { admin, aspetta, costruisci, logMuto, poolApp, svuota } from './helpers.js';
import { ENV_TEST } from './setup/env.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const vera = creaStripe(ENV_TEST.STRIPE_API_KEY!, ENV_TEST.STRIPE_WEBHOOK_SECRET!);
function stripeFinto(o: { piHaFattura?: boolean } = {}): StripeApi {
  return {
    verifica: vera.verifica, // verifica firma reale della libreria ufficiale
    piHaFattura: async () => o.piHaFattura ?? false,
    righeFattura: async () => [{ descrizione: 'Abbonamento', importo: 29 }],
    clienteDaCharge: async () => ({ nome: 'Cliente Stripe', email: 'c@example.com' }),
  };
}
function firmaStripe(body: string) {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret: ENV_TEST.STRIPE_WEBHOOK_SECRET! });
}
const conteggio = async (t: string) => (await admin.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n as number;

const invoicePaid = (evId: string, invId = 'in_1') => ({
  id: evId,
  type: 'invoice.paid',
  data: { object: { id: invId, status: 'paid', amount_paid: 2900, currency: 'eur', metadata: { business: 'saas-a' }, customer_name: 'Cliente', customer_email: 'c@example.com', lines: { data: [{ description: 'Abbonamento', amount: 2900 }], has_more: false } } },
});

describe('webhook Stripe', () => {
  it('4. lo stesso evento ricevuto 3 volte -> un solo documento', async () => {
    const api = stripeFinto();
    const { app, eventi } = await costruisci({ pool, stripe: api, elaboratori: { stripe: elaboratoreStripe({ pool, api, tipo: 'fattura', log: logMuto }) } });
    const body = JSON.stringify(invoicePaid('evt_1'));
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaStripe(body), 'content-type': 'application/json' }, payload: body });
      expect(r.statusCode).toBe(200);
    }
    // stesso pagamento, evento diverso: nessun secondo numero
    const body2 = JSON.stringify(invoicePaid('evt_2'));
    await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaStripe(body2), 'content-type': 'application/json' }, payload: body2 });
    await aspetta(async () => (await admin.query('SELECT count(*)::int AS n FROM eventi_ricevuti WHERE elaborato')).rows[0].n === 2);
    expect(await conteggio('eventi_ricevuti')).toBe(2);
    expect(await conteggio('documenti')).toBe(1);
    const d = (await admin.query('SELECT ref, fonte, business FROM documenti')).rows[0];
    expect(d).toEqual({ ref: 'stripe|in_1|fattura', fonte: 'stripe', business: 'saas-a' });
    expect(await eventi.riprendi()).toBe(0);
    await app.close();
  });

  it('5. firma errata -> 400 e nessuna riga in eventi_ricevuti', async () => {
    const { app } = await costruisci({ pool, stripe: stripeFinto() });
    const body = JSON.stringify(invoicePaid('evt_x'));
    const falsa = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_altro' });
    expect((await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': falsa }, payload: body })).statusCode).toBe(400);
    // body modificato dopo la firma
    const r = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaStripe(body) }, payload: body.replace('2900', '1') });
    expect(r.statusCode).toBe(400);
    expect(await conteggio('eventi_ricevuti')).toBe(0);
    await app.close();
  });

  it('payment_intent con invoice collegata viene ignorato (vale invoice.paid)', async () => {
    const api = stripeFinto({ piHaFattura: true });
    const el = elaboratoreStripe({ pool, api, tipo: 'fattura', log: logMuto });
    const esito = await el({ id: 'evt_pi', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', currency: 'eur', amount_received: 2900, metadata: { business: 'saas-a' }, latest_charge: 'ch_1' } } });
    expect(esito).toBe('fatto');
    expect(await conteggio('documenti')).toBe(0);
  });

  it('fail closed: business mancante -> nessun numero, evento resta da elaborare, anomalia', async () => {
    const api = stripeFinto();
    const { app, notif } = await costruisci({ pool, stripe: api, elaboratori: { stripe: elaboratoreStripe({ pool, api, tipo: 'fattura', log: logMuto }) } });
    const ev = invoicePaid('evt_nb');
    ev.data.object.metadata = {} as never;
    const body = JSON.stringify(ev);
    await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'stripe-signature': firmaStripe(body) }, payload: body });
    await aspetta(async () => notif.lista.length > 0);
    expect(notif.lista[0]!.codice).toBe('stripe_business_mancante');
    expect(await conteggio('documenti')).toBe(0);
    expect((await admin.query('SELECT elaborato FROM eventi_ricevuti')).rows[0].elaborato).toBe(false);
    await app.close();
  });
});

describe('webhook GoCardless', () => {
  const gcApi = (stato = 'confirmed'): GcApi => ({
    pagamento: async (id) => ({ id, status: stato, currency: 'EUR', amount: 5000, description: 'Rata', metadata: { business: 'saas-b' }, links: { mandate: 'MD1' } }),
    mandato: async () => ({ links: { customer: 'CU1' } }),
    cliente: async () => ({ id: 'CU1', given_name: 'Anna', family_name: 'Bianchi', email: 'a@example.com' }),
    pagamentiPerStato: async () => [],
  });
  const firma = (b: string) => createHmac('sha256', ENV_TEST.GC_WEBHOOK_SECRET!).update(b).digest('hex');
  const batch = (ids: string[], pagamento = 'PM1') => JSON.stringify({ events: ids.map((id) => ({ id, resource_type: 'payments', action: 'confirmed', links: { payment: pagamento } })) });

  it('4. batch ripetuto 3 volte -> un solo documento; 204', async () => {
    const { app } = await costruisci({ pool, elaboratori: { gocardless: elaboratoreGc({ pool, api: gcApi(), tipo: 'fattura', trigger: 'confirmed' }) } });
    const body = batch(['EV1', 'EV2']); // due eventi sullo stesso pagamento
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: 'POST', url: '/webhooks/gocardless', headers: { 'webhook-signature': firma(body), 'content-type': 'application/json' }, payload: body });
      expect(r.statusCode).toBe(204);
    }
    await aspetta(async () => (await admin.query('SELECT count(*)::int AS n FROM eventi_ricevuti WHERE elaborato')).rows[0].n === 2);
    expect(await conteggio('documenti')).toBe(1);
    expect((await admin.query('SELECT ref FROM documenti')).rows[0].ref).toBe('gocardless|PM1|fattura');
    await app.close();
  });

  it('5. firma errata -> 498 e nessuna riga', async () => {
    const { app } = await costruisci({ pool });
    const body = batch(['EV1']);
    expect((await app.inject({ method: 'POST', url: '/webhooks/gocardless', headers: { 'webhook-signature': 'a'.repeat(64) }, payload: body })).statusCode).toBe(498);
    expect((await app.inject({ method: 'POST', url: '/webhooks/gocardless', payload: body })).statusCode).toBe(498);
    expect(await conteggio('eventi_ricevuti')).toBe(0);
    await app.close();
  });

  it('stato corrente non coerente (es. charged_back) -> nessun documento', async () => {
    const el = elaboratoreGc({ pool, api: gcApi('charged_back'), tipo: 'fattura', trigger: 'confirmed' });
    await expect(el({ id: 'EV9', resource_type: 'payments', action: 'confirmed', links: { payment: 'PM9' } })).rejects.toThrow('gc_stato_incoerente');
    expect(await conteggio('documenti')).toBe(0);
  });
});
