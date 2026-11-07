import Stripe from 'stripe';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { Tipo } from './config.js';
import { riserva } from './documenti.js';
import { Rifiuto, type Elaboratore } from './eventi.js';

type Riga = { descrizione: string; importo: number };
type Cliente = Record<string, unknown>;

/** Ciò che serve da Stripe (chiave ristretta in sola lettura). Nei test si sostituisce. */
export interface StripeApi {
  /** Verifica la firma sul body grezzo e restituisce l'evento; lancia se non valida. */
  verifica(body: Buffer, firma: string): Promise<{ id: string; type: string; data: { object: unknown } }>;
  /** true se il payment_intent è collegato a una invoice (allora vale solo invoice.paid). */
  piHaFattura(piId: string): Promise<boolean>;
  righeFattura(invoiceId: string): Promise<Riga[]>;
  clienteDaCharge(chargeId: string): Promise<Cliente>;
}

export function creaStripe(apiKey: string, webhookSecret: string): StripeApi {
  const s = new Stripe(apiKey, { maxNetworkRetries: 2, timeout: 15_000 });
  return {
    async verifica(body, firma) {
      const ev = await s.webhooks.constructEventAsync(body, firma, webhookSecret);
      return ev as unknown as { id: string; type: string; data: { object: unknown } };
    },
    async piHaFattura(piId) {
      const r = await s.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: piId }, limit: 1 });
      return r.data.length > 0;
    },
    async righeFattura(id) {
      const out: Riga[] = [];
      for await (const l of s.invoices.listLineItems(id, { limit: 100 })) out.push({ descrizione: l.description ?? 'Voce', importo: l.amount / 100 });
      return out;
    },
    async clienteDaCharge(chargeId) {
      const ch = await s.charges.retrieve(chargeId);
      const b = ch.billing_details;
      return { nome: b.name, email: b.email, indirizzo: b.address, stripe_customer: typeof ch.customer === 'string' ? ch.customer : (ch.customer?.id ?? null) };
    },
  };
}

type Obj = Record<string, any>;

export function elaboratoreStripe(deps: { pool: pg.Pool; api: StripeApi; tipo: Tipo; log: FastifyBaseLogger }): Elaboratore {
  return async (raw) => {
    const ev = raw as { id: string; type: string; data: { object: Obj } };
    const o = ev.data.object;

    if (ev.type === 'invoice.paid') {
      if (o.status !== 'paid') return 'fatto';
      if (!o.amount_paid) {
        deps.log.info({ evento: ev.id, invoice: o.id }, 'invoice a importo zero: nessun documento');
        return 'fatto';
      }
      if (String(o.currency).toLowerCase() !== 'eur') throw new Rifiuto('stripe_valuta_non_eur', { invoice: o.id });
      const business = o.metadata?.business ?? o.parent?.subscription_details?.metadata?.business ?? null;
      if (!business) throw new Rifiuto('stripe_business_mancante', { invoice: o.id });
      let righe: Riga[] = (o.lines?.data ?? []).map((l: Obj) => ({ descrizione: l.description ?? 'Voce', importo: l.amount / 100 }));
      if (o.lines?.has_more || righe.length === 0) righe = await deps.api.righeFattura(o.id);
      const cliente: Cliente = { nome: o.customer_name ?? null, email: o.customer_email ?? null, indirizzo: o.customer_address ?? null, stripe_customer: o.customer ?? null };
      await riserva(deps.pool, {
        ref: `stripe|${o.id}|${deps.tipo}`,
        tipo: deps.tipo,
        fonte: 'stripe',
        business,
        payload: { cliente, righe, dati_fonte: { stripe: { invoice_id: o.id } } },
      });
      return 'fatto';
    }

    if (ev.type === 'payment_intent.succeeded') {
      // Primo pagamento di un abbonamento: arrivano entrambi gli eventi; vale solo invoice.paid.
      if (o.invoice || (await deps.api.piHaFattura(o.id))) return 'fatto';
      if (String(o.currency).toLowerCase() !== 'eur') throw new Rifiuto('stripe_valuta_non_eur', { payment_intent: o.id });
      const business = o.metadata?.business ?? null;
      if (!business) throw new Rifiuto('stripe_business_mancante', { payment_intent: o.id });
      const charge = typeof o.latest_charge === 'string' ? o.latest_charge : o.latest_charge?.id;
      if (!charge) throw new Rifiuto('stripe_charge_mancante', { payment_intent: o.id });
      const cliente = await deps.api.clienteDaCharge(charge);
      await riserva(deps.pool, {
        ref: `stripe|${o.id}|${deps.tipo}`,
        tipo: deps.tipo,
        fonte: 'stripe',
        business,
        payload: {
          cliente,
          righe: [{ descrizione: o.description ?? 'Pagamento', importo: o.amount_received / 100 }],
          dati_fonte: { stripe: { payment_intent_id: o.id } },
        },
      });
      return 'fatto';
    }
    return 'fatto'; // altri tipi di evento: ignorati
  };
}
