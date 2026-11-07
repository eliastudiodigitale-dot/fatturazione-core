import Stripe from 'stripe';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { Tipo } from './config.js';
import { riserva } from './documenti.js';
import { Rifiuto, type Elaboratore } from './eventi.js';
import type { Notificatore } from './notifiche.js';

/** Riga in centesimi già al netto degli sconti. */
export type RigaCent = { descrizione: string; centesimi: number };
type Cliente = Record<string, unknown>;
type Obj = Record<string, any>;

/** Ciò che serve da Stripe (chiave ristretta in sola lettura). Nei test si sostituisce. */
export interface StripeApi {
  /** Verifica la firma sul body grezzo e restituisce l'evento; lancia se non valida. */
  verifica(body: Buffer, firma: string): Promise<{ id: string; type: string; livemode?: boolean; account?: string; data: { object: unknown } }>;
  /** true se il payment_intent è collegato a una invoice (allora vale solo invoice.paid). */
  piHaFattura(piId: string): Promise<boolean>;
  righeFattura(invoiceId: string): Promise<RigaCent[]>;
  clienteDaCharge(chargeId: string): Promise<Cliente>;
}

/** Importo netto di una riga di invoice: amount meno gli sconti applicati alla riga. */
export function nettoRiga(l: Obj): number {
  const sconti = (l.discount_amounts ?? []).reduce((s: number, d: Obj) => s + (d.amount ?? 0), 0);
  return (l.amount ?? 0) - sconti;
}

export function indirizzoStripe(a: Obj | null | undefined) {
  if (!a) return undefined;
  return { via: [a.line1, a.line2].filter(Boolean).join(', ') || undefined, cap: a.postal_code ?? undefined, citta: a.city ?? undefined, provincia: a.state ?? undefined, paese: a.country ?? undefined };
}

/** Partita IVA / codice fiscale dai tax id del cliente Stripe (eu_vat, it_cf...). */
export function idFiscaliStripe(ids: Obj[] | null | undefined) {
  const out: { partita_iva?: string; codice_fiscale?: string } = {};
  for (const t of ids ?? []) {
    if (t.type === 'eu_vat' && typeof t.value === 'string') out.partita_iva = t.value.replace(/^IT/, '');
    if ((t.type === 'it_cf' || t.type === 'it_tin') && typeof t.value === 'string') out.codice_fiscale = t.value;
  }
  return out;
}

export function creaStripe(apiKey: string, webhookSecret: string): StripeApi {
  const s = new Stripe(apiKey, { maxNetworkRetries: 2, timeout: 15_000 });
  return {
    async verifica(body, firma) {
      const ev = await s.webhooks.constructEventAsync(body, firma, webhookSecret);
      return ev as unknown as Awaited<ReturnType<StripeApi['verifica']>>;
    },
    async piHaFattura(piId) {
      const r = await s.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: piId }, limit: 1 });
      return r.data.length > 0;
    },
    async righeFattura(id) {
      const out: RigaCent[] = [];
      for await (const l of s.invoices.listLineItems(id, { limit: 100 })) out.push({ descrizione: l.description ?? 'Voce', centesimi: nettoRiga(l as unknown as Obj) });
      return out;
    },
    async clienteDaCharge(chargeId) {
      const ch = await s.charges.retrieve(chargeId);
      const b = ch.billing_details;
      return { nome: b.name ?? undefined, email: b.email ?? undefined, indirizzo: indirizzoStripe(b.address as Obj | null), stripe_customer: typeof ch.customer === 'string' ? ch.customer : (ch.customer?.id ?? undefined) };
    },
  };
}

/** Eventi che non generano documenti ma richiedono una nota di credito o un controllo manuale. */
const EVENTI_CORREZIONE = new Set(['charge.refunded', 'charge.dispute.created', 'credit_note.created', 'invoice.marked_uncollectible']);

export function elaboratoreStripe(deps: { pool: pg.Pool; api: StripeApi; tipo: Tipo; log: FastifyBaseLogger; notif: Notificatore; livemode: boolean; businessPredefinito?: string }): Elaboratore {
  const euro = (c: number) => c / 100;
  return async (raw) => {
    const ev = raw as { id: string; type: string; livemode?: boolean; account?: string; data: { object: Obj } };
    const o = ev.data.object;

    // Eventi di test in produzione (o live in un ambiente di prova): mai un numero.
    if (Boolean(ev.livemode) !== deps.livemode) {
      deps.log.warn({ evento: ev.id, livemode: ev.livemode }, 'evento Stripe di altra modalità: ignorato');
      return 'fatto';
    }
    if (ev.account) {
      deps.notif.anomalia('stripe_evento_account_collegato', { evento: ev.id });
      return 'fatto';
    }
    if (EVENTI_CORREZIONE.has(ev.type)) {
      deps.notif.anomalia('stripe_correzione_da_fare', { evento: ev.id, tipo_evento: ev.type, oggetto: String(o.id ?? ''), azione: 'valutare nota di credito' });
      return 'fatto';
    }

    if (ev.type === 'invoice.paid') {
      if (o.status !== 'paid') return 'fatto';
      const totale: number = o.total ?? 0;
      if (totale <= 0) {
        deps.log.info({ evento: ev.id, invoice: o.id }, 'invoice a importo zero: nessun documento');
        return 'fatto';
      }
      if (String(o.currency).toLowerCase() !== 'eur') throw new Rifiuto('stripe_valuta_non_eur', { invoice: o.id });
      const iva = (o.tax ?? 0) + (o.total_taxes ?? []).reduce((s: number, t: Obj) => s + (t.amount ?? 0), 0);
      if (iva > 0) throw new Rifiuto('stripe_iva_presente', { invoice: o.id, azione: 'regime forfettario: togliere le tasse in Stripe' });
      if ((o.amount_paid ?? 0) !== totale) throw new Rifiuto('stripe_pagato_diverso_dal_totale', { invoice: o.id, pagato: o.amount_paid ?? 0, totale });
      const business = o.metadata?.business ?? o.parent?.subscription_details?.metadata?.business ?? o.subscription_details?.metadata?.business ?? deps.businessPredefinito ?? null;
      if (!business) throw new Rifiuto('stripe_business_mancante', { invoice: o.id, azione: 'aggiungere metadata.business o STRIPE_BUSINESS_PREDEFINITO' });

      let righe: RigaCent[] = (o.lines?.data ?? []).map((l: Obj) => ({ descrizione: l.description ?? 'Voce', centesimi: nettoRiga(l) }));
      if (o.lines?.has_more || righe.length === 0) righe = await deps.api.righeFattura(o.id);
      const somma = righe.reduce((s, r) => s + r.centesimi, 0);
      if (somma !== totale) throw new Rifiuto('stripe_righe_diverse_dal_totale', { invoice: o.id, righe: somma, totale });

      const cliente: Cliente = {
        nome: o.customer_name ?? undefined,
        email: o.customer_email ?? undefined,
        indirizzo: indirizzoStripe(o.customer_address),
        ...idFiscaliStripe(o.customer_tax_ids),
        stripe_customer: typeof o.customer === 'string' ? o.customer : undefined,
      };
      await riserva(deps.pool, {
        ref: `stripe|${o.id}|${deps.tipo}`,
        tipo: deps.tipo,
        fonte: 'stripe',
        business,
        payload: { cliente, righe: righe.map((r) => ({ descrizione: r.descrizione, importo: euro(r.centesimi) })), dati_fonte: { stripe: { invoice_id: o.id, numero_stripe: o.number ?? null } } },
      });
      return 'fatto';
    }

    if (ev.type === 'payment_intent.succeeded') {
      // Primo pagamento di un abbonamento: arrivano entrambi gli eventi; vale solo invoice.paid.
      if (o.invoice || (await deps.api.piHaFattura(o.id))) return 'fatto';
      if (String(o.currency).toLowerCase() !== 'eur') throw new Rifiuto('stripe_valuta_non_eur', { payment_intent: o.id });
      if (!(o.amount_received > 0)) return 'fatto';
      const business = o.metadata?.business ?? deps.businessPredefinito ?? null;
      if (!business) throw new Rifiuto('stripe_business_mancante', { payment_intent: o.id, azione: 'aggiungere metadata.business o STRIPE_BUSINESS_PREDEFINITO' });
      const charge = typeof o.latest_charge === 'string' ? o.latest_charge : o.latest_charge?.id;
      if (!charge) throw new Rifiuto('stripe_charge_mancante', { payment_intent: o.id });
      const cliente = await deps.api.clienteDaCharge(charge);
      await riserva(deps.pool, {
        ref: `stripe|${o.id}|${deps.tipo}`,
        tipo: deps.tipo,
        fonte: 'stripe',
        business,
        payload: { cliente, righe: [{ descrizione: o.description ?? 'Pagamento', importo: euro(o.amount_received) }], dati_fonte: { stripe: { payment_intent_id: o.id } } },
      });
      return 'fatto';
    }
    return 'fatto'; // altri tipi di evento: ignorati
  };
}
