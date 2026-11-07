import { createHmac } from 'node:crypto';
import type pg from 'pg';
import type { GcTrigger, Tipo } from './config.js';
import { hmacUguale } from './auth.js';
import { riserva } from './documenti.js';
import { Rifiuto, type Elaboratore } from './eventi.js';

type Obj = Record<string, any>;

export interface GcApi {
  pagamento(id: string): Promise<Obj>;
  mandato(id: string): Promise<Obj>;
  cliente(id: string): Promise<Obj>;
  /** Pagamenti con lo stato dato creati dopo `dal` (per la riconciliazione). */
  pagamentiPerStato(stato: string, dal: Date): Promise<Obj[]>;
}

/** Webhook-Signature = HMAC-SHA256 esadecimale del body grezzo. */
export function firmaGcValida(body: Buffer, firma: string | undefined, segreto: string): boolean {
  if (!firma || !/^[0-9a-f]{64}$/i.test(firma)) return false;
  const atteso = createHmac('sha256', segreto).update(body).digest();
  return hmacUguale(Buffer.from(firma, 'hex'), atteso);
}

export function creaGc(apiUrl: string, token: string, fetchFn: typeof fetch = fetch): GcApi {
  async function get(path: string): Promise<Obj> {
    const res = await fetchFn(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'GoCardless-Version': '2015-07-06', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GoCardless GET ${path.split('?')[0]} -> ${res.status}`);
    return (await res.json()) as Obj;
  }
  return {
    pagamento: async (id) => (await get(`/payments/${encodeURIComponent(id)}`)).payments,
    mandato: async (id) => (await get(`/mandates/${encodeURIComponent(id)}`)).mandates,
    cliente: async (id) => (await get(`/customers/${encodeURIComponent(id)}`)).customers,
    async pagamentiPerStato(stato, dal) {
      const out: Obj[] = [];
      let after: string | undefined;
      for (let i = 0; i < 100; i++) {
        const q = new URLSearchParams({ status: stato, 'created_at[gte]': dal.toISOString(), limit: '500' });
        if (after) q.set('after', after);
        const r = await get(`/payments?${q}`);
        out.push(...(r.payments as Obj[]));
        after = r.meta?.cursors?.after ?? undefined;
        if (!after) break;
      }
      return out;
    },
  };
}

/** Stati del pagamento compatibili con l'azione scelta come trigger. */
const STATI_OK: Record<GcTrigger, string[]> = { confirmed: ['confirmed', 'paid_out'], paid_out: ['paid_out'] };

export function refGc(paymentId: string, tipo: Tipo) {
  return `gocardless|${paymentId}|${tipo}`;
}

export function elaboratoreGc(deps: { pool: pg.Pool; api: GcApi; tipo: Tipo; trigger: GcTrigger }): Elaboratore {
  return async (raw) => {
    const ev = raw as Obj;
    if (ev.resource_type !== 'payments' || ev.action !== deps.trigger) return 'fatto';
    const pid = ev.links?.payment;
    if (typeof pid !== 'string') throw new Rifiuto('gc_evento_senza_pagamento', { evento: String(ev.id) });
    // Eventi duplicati e fuori ordine: si decide sullo stato corrente letto dall'API.
    const p = await deps.api.pagamento(pid);
    if (!STATI_OK[deps.trigger].includes(p.status)) throw new Rifiuto('gc_stato_incoerente', { pagamento: pid, stato: String(p.status) });
    if (String(p.currency).toUpperCase() !== 'EUR') throw new Rifiuto('gc_valuta_non_eur', { pagamento: pid });
    const business = p.metadata?.business ?? null;
    if (!business) throw new Rifiuto('gc_business_mancante', { pagamento: pid });
    const m = await deps.api.mandato(p.links.mandate);
    const c = await deps.api.cliente(m.links.customer);
    const nome = c.company_name || [c.given_name, c.family_name].filter(Boolean).join(' ') || null;
    await riserva(deps.pool, {
      ref: refGc(pid, deps.tipo),
      tipo: deps.tipo,
      fonte: 'gocardless',
      business,
      payload: {
        cliente: {
          nome,
          email: c.email ?? null,
          indirizzo: { riga1: c.address_line1 ?? null, citta: c.city ?? null, cap: c.postal_code ?? null, paese: c.country_code ?? null },
          gc_customer: c.id,
        },
        righe: [{ descrizione: p.description ?? 'Pagamento', importo: p.amount / 100 }],
        dati_fonte: { gocardless: { payment_id: pid } },
      },
    });
    return 'fatto';
  };
}
