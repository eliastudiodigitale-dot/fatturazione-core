// Client dei backend ticket dei business (#46): heyciar, serrandasu.it, reti.gazzolaelia.it espongono una piccola API
// (contratto in docs/ticket-backend-api.md) e il portale la richiama per leggere, rispondere, assegnare, cambiare stato.
// Nei test si sostituisce con un finto. Nessun segreto nei messaggi d'errore.
import type { Priorita, StatoTicket } from './ticket.js';
import { PRIORITA, STATI_TICKET } from './ticket.js';

export interface TicketRemoto {
  id: string;
  oggetto: string;
  stato: StatoTicket;
  priorita: Priorita;
  categoria?: string;
  canale?: string;
  cliente?: { nome?: string; email?: string; partita_iva?: string };
  assegnato_a?: string;
  aperto_il: Date;
  prima_risposta_il?: Date;
  risolto_il?: Date;
  piano_sla?: string;
}

export interface MessaggioRemoto {
  quando: Date;
  da: 'cliente' | 'staff';
  autore?: string;
  testo: string;
  interno: boolean;
}

export interface ModificaRemota {
  stato?: StatoTicket;
  priorita?: Priorita;
  assegnato_a?: string | null;
  categoria?: string | null;
}

export interface BackendTicket {
  /** Ticket creati o cambiati dopo `dopo` (tutti se manca). */
  elenca(dopo?: Date): Promise<TicketRemoto[]>;
  messaggi(id: string): Promise<MessaggioRemoto[]>;
  rispondi(id: string, m: { testo: string; autore: string; interno: boolean }): Promise<void>;
  aggiorna(id: string, mod: ModificaRemota): Promise<void>;
  crea(n: { oggetto: string; testo?: string; priorita?: Priorita; categoria?: string; cliente?: { nome?: string; email?: string; partita_iva?: string }; creato_da: string }): Promise<{ id: string }>;
}

export class ErroreBackend extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}

const testo = (v: unknown, max = 8000): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : undefined);
const data = (v: unknown): Date | undefined => {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Un ticket del backend letto con prudenza: i campi sconosciuti si ignorano, quelli fuori formato scartano il ticket. */
export function ticketRemoto(x: unknown): TicketRemoto | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : '';
  const oggetto = testo(o.oggetto, 300);
  const aperto = data(o.aperto_il);
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(id) || !oggetto || !aperto) return undefined;
  const stato = (STATI_TICKET as readonly string[]).includes(String(o.stato)) ? (o.stato as StatoTicket) : 'aperto';
  const priorita = (PRIORITA as readonly string[]).includes(String(o.priorita)) ? (o.priorita as Priorita) : 'normale';
  const c = typeof o.cliente === 'object' && o.cliente !== null ? (o.cliente as Record<string, unknown>) : {};
  return {
    id,
    oggetto,
    stato,
    priorita,
    categoria: testo(o.categoria, 80),
    canale: testo(o.canale, 40),
    cliente: { nome: testo(c.nome, 200), email: testo(c.email, 254), partita_iva: testo(c.partita_iva, 20) },
    assegnato_a: testo(o.assegnato_a, 200),
    aperto_il: aperto,
    prima_risposta_il: data(o.prima_risposta_il),
    risolto_il: data(o.risolto_il),
    piano_sla: testo(o.piano_sla, 16),
  };
}

export function creaBackendHttp(o: { url: string; token: string; fetchFn?: typeof fetch; timeoutMs?: number }): BackendTicket {
  const f = o.fetchFn ?? fetch;
  async function chiama(metodo: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await f(`${o.url}${path}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      });
    } catch {
      throw new ErroreBackend(0, `backend ticket non raggiungibile (${metodo} ${path.split('?')[0]})`);
    }
    if (!res.ok) throw new ErroreBackend(res.status, `backend ticket ha risposto ${res.status} (${metodo} ${path.split('?')[0]})`);
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch {
      throw new ErroreBackend(res.status, `risposta del backend ticket non valida (${metodo} ${path.split('?')[0]})`);
    }
  }
  const id = (x: string) => encodeURIComponent(x);
  return {
    async elenca(dopo) {
      const out: TicketRemoto[] = [];
      for (let pagina = 1; pagina <= 200; pagina++) {
        const q = new URLSearchParams({ pagina: String(pagina), limite: '200' });
        if (dopo) q.set('aggiornati_dopo', dopo.toISOString());
        const r = (await chiama('GET', `/tickets?${q}`)) as { tickets?: unknown[]; prossima_pagina?: boolean | number | null } | null;
        for (const x of r?.tickets ?? []) {
          const t = ticketRemoto(x);
          if (t) out.push(t);
        }
        if (!r?.prossima_pagina || (r.tickets ?? []).length === 0) break;
      }
      return out;
    },
    async messaggi(tid) {
      const r = (await chiama('GET', `/tickets/${id(tid)}/messaggi`)) as { messaggi?: unknown[] } | null;
      const out: MessaggioRemoto[] = [];
      for (const x of r?.messaggi ?? []) {
        const m = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
        const t = testo(m.testo);
        const q = data(m.quando);
        if (t && q) out.push({ quando: q, da: m.da === 'staff' ? 'staff' : 'cliente', autore: testo(m.autore, 200), testo: t, interno: m.interno === true });
      }
      return out;
    },
    async rispondi(tid, m) {
      await chiama('POST', `/tickets/${id(tid)}/messaggi`, { testo: m.testo, autore: m.autore, interno: m.interno });
    },
    async aggiorna(tid, mod) {
      await chiama('PATCH', `/tickets/${id(tid)}`, mod);
    },
    async crea(n) {
      const r = (await chiama('POST', '/tickets', n)) as { id?: unknown } | null;
      const nuovo = typeof r?.id === 'string' || typeof r?.id === 'number' ? String(r.id) : '';
      if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(nuovo)) throw new ErroreBackend(502, 'il backend ticket non ha restituito l\'id del nuovo ticket');
      return { id: nuovo };
    },
  };
}
