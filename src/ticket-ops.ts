// Operazioni sui ticket dal portale (#46): si inoltrano al backend del business (se il ticket vive lì) e poi si aggiorna la copia.
// Prima l'API del business, poi il DB: se il backend rifiuta o non risponde, la copia non cambia e l'utente vede l'errore.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Config } from './config.js';
import type { Notificatore } from './notifiche.js';
import { ErroreBackend, type BackendTicket, type ModificaRemota, type TicketRemoto } from './ticket-backend.js';
import { ErroreTicket, aggiornaTicket, aggiungiMessaggio, creaTicket, messaggiLocali, ticketPerRef, type ModificaTicket, type NuovoTicket, type Priorita, type Ticket } from './ticket.js';
import { conLockCrm, segna } from './sync.js';

export interface DepsOps {
  pool: pg.Pool;
  cfg: Config;
  /** Un backend per fonte (solo le fonti che ne hanno uno configurato). */
  backends: Record<string, BackendTicket>;
  notif: Notificatore;
}

const comeErrore = (e: unknown): never => {
  if (e instanceof ErroreBackend) throw new ErroreTicket(502, e.message);
  throw e;
};

/** Fonte che serve un'attività: quella configurata per lei, altrimenti i ticket vivono qui e la fonte è "dashboard". */
export function fonteDiBusiness(cfg: Config, business: string): string | undefined {
  return Object.entries(cfg.ticket.fonti).find(([, f]) => f.business === business)?.[0];
}

export interface NuovoDaPortale {
  business: string;
  oggetto: string;
  testo?: string;
  priorita?: Priorita;
  categoria?: string;
  cliente?: { nome?: string; email?: string; partita_iva?: string };
  piano_sla?: string;
}

/** Apre un ticket dal portale (per un cliente che ha scritto per telefono o email): nel backend del business se c'è, altrimenti qui. */
export async function creaDaPortale(d: DepsOps, n: NuovoDaPortale, chi: string): Promise<Ticket> {
  const fonte = fonteDiBusiness(d.cfg, n.business);
  const backend = fonte ? d.backends[fonte] : undefined;
  const base: NuovoTicket = { fonte: fonte ?? 'dashboard', business: n.business, idEsterno: '', oggetto: n.oggetto, testo: n.testo, priorita: n.priorita, categoria: n.categoria, canale: 'portale', cliente: n.cliente, pianoSla: n.piano_sla };
  if (backend) {
    const r = await backend.crea({ oggetto: n.oggetto, testo: n.testo, priorita: n.priorita, categoria: n.categoria, cliente: n.cliente, creato_da: chi }).catch(comeErrore);
    const { ticket } = await creaTicket(d.pool, d.cfg.ticket.sla, { ...base, idEsterno: r.id, origine: 'remoto' });
    return ticket;
  }
  const { ticket } = await creaTicket(d.pool, d.cfg.ticket.sla, { ...base, idEsterno: randomUUID(), origine: 'locale' });
  return ticket;
}

const backendDi = (d: DepsOps, t: Ticket): BackendTicket => {
  const b = d.backends[t.fonte];
  if (!b) throw new ErroreTicket(502, `backend ticket di "${t.fonte}" non configurato`);
  return b;
};

/** Cambia stato, priorità, assegnatario, categoria o piano SLA. Stato, priorità, assegnatario e categoria vanno anche al backend del business. */
export async function modifica(d: DepsOps, ref: string, mod: ModificaTicket, chi: string): Promise<Ticket> {
  const t = await ticketPerRef(d.pool, ref);
  if (!t) throw new ErroreTicket(404, 'ticket non trovato');
  if (mod.piano_sla !== undefined && mod.piano_sla !== 'nessuno' && mod.piano_sla !== 'standard' && !d.cfg.ticket.sla.piani[mod.piano_sla]) throw new ErroreTicket(400, `piano SLA sconosciuto: ${mod.piano_sla}`);
  if (t.origine === 'remoto') {
    const r: ModificaRemota = {};
    if (mod.stato !== undefined) r.stato = mod.stato;
    if (mod.priorita !== undefined) r.priorita = mod.priorita;
    if (mod.assegnato_a !== undefined) r.assegnato_a = mod.assegnato_a.trim() === '' ? null : mod.assegnato_a.trim();
    if (mod.categoria !== undefined) r.categoria = mod.categoria.trim() === '' ? null : mod.categoria.trim();
    if (Object.keys(r).length > 0) await backendDi(d, t).aggiorna(t.id_remoto!, r).catch(comeErrore);
  }
  return aggiornaTicket(d.pool, d.cfg.ticket.sla, ref, mod, chi);
}

/** Risposta al cliente (o nota interna) dal portale. */
export async function rispondi(d: DepsOps, ref: string, m: { testo: string; interno: boolean }, chi: string): Promise<Ticket> {
  const t = await ticketPerRef(d.pool, ref);
  if (!t) throw new ErroreTicket(404, 'ticket non trovato');
  if (t.origine === 'remoto') await backendDi(d, t).rispondi(t.id_remoto!, { testo: m.testo, autore: chi, interno: m.interno }).catch(comeErrore);
  const r = await aggiungiMessaggio(d.pool, ref, { da: 'staff', testo: m.testo, chi, interno: m.interno });
  return r.ticket;
}

export interface Conversazione {
  quando: Date | string;
  da: 'cliente' | 'staff';
  autore: string | null;
  interno: boolean;
  testo: string | null;
}

/** Messaggi del ticket: dal DB per i locali (con il testo iniziale in testa), dal backend del business per i remoti. */
export async function conversazione(d: DepsOps, ref: string): Promise<{ messaggi: Conversazione[]; da_backend: boolean }> {
  const t = await ticketPerRef(d.pool, ref);
  if (!t) throw new ErroreTicket(404, 'ticket non trovato');
  if (t.origine === 'remoto') {
    const m = await backendDi(d, t).messaggi(t.id_remoto!).catch(comeErrore);
    return { messaggi: m.map((x) => ({ quando: x.quando, da: x.da, autore: x.autore ?? null, interno: x.interno, testo: x.testo })), da_backend: true };
  }
  const salvati = await messaggiLocali(d.pool, t.id);
  const primo: Conversazione[] = t.testo ? [{ quando: t.aperto_il, da: 'cliente', autore: t.cliente_nome ?? t.cliente_email, interno: false, testo: t.testo }] : [];
  return { messaggi: [...primo, ...salvati], da_backend: false };
}

// ------------------------------------------------------------------ sincronizzazione dei ticket remoti

/** Aggiorna la copia di un ticket remoto già noto, o lo crea. Restituisce cosa è successo. */
export async function applicaTicketRemoto(d: Pick<DepsOps, 'pool' | 'cfg'>, fonte: string, business: string, t: TicketRemoto): Promise<'nuovo' | 'aggiornato' | 'uguale'> {
  const ref = `${fonte}|${t.id}`;
  const esiste = await ticketPerRef(d.pool, ref);
  if (!esiste) {
    await creaTicket(d.pool, d.cfg.ticket.sla, {
      fonte, business, idEsterno: t.id, origine: 'remoto', oggetto: t.oggetto, priorita: t.priorita, stato: t.stato, categoria: t.categoria, canale: t.canale,
      cliente: t.cliente, assegnatoA: t.assegnato_a, apertoIl: t.aperto_il, primaRispostaIl: t.prima_risposta_il, risoltoIl: t.risolto_il, pianoSla: pianoNoto(d.cfg, t.piano_sla),
    });
    return 'nuovo';
  }
  const mod: ModificaTicket = {};
  if (t.stato !== esiste.stato) mod.stato = t.stato;
  if (t.priorita !== esiste.priorita) mod.priorita = t.priorita;
  if ((t.assegnato_a ?? '') !== (esiste.assegnato_a ?? '')) mod.assegnato_a = t.assegnato_a ?? '';
  if ((t.categoria ?? '') !== (esiste.categoria ?? '')) mod.categoria = t.categoria ?? '';
  const piano = pianoNoto(d.cfg, t.piano_sla);
  if (piano && piano !== esiste.piano_sla) mod.piano_sla = piano;
  let cambiato = Object.keys(mod).length > 0;
  if (cambiato) await aggiornaTicket(d.pool, d.cfg.ticket.sla, ref, mod, `sync:${fonte}`);
  // Gli orari veri li ha il backend: la prima risposta e la risoluzione non si "inventano" con l'orologio del portale.
  const r = await d.pool.query(
    `UPDATE ticket SET prima_risposta_il = COALESCE(prima_risposta_il, $2), risolto_il = CASE WHEN stato IN ('risolto','chiuso') THEN COALESCE($3, risolto_il) ELSE NULL END,
            oggetto = $4, sync_il = now()
      WHERE ref = $1 AND (prima_risposta_il IS DISTINCT FROM COALESCE(prima_risposta_il, $2) OR risolto_il IS DISTINCT FROM (CASE WHEN stato IN ('risolto','chiuso') THEN COALESCE($3, risolto_il) ELSE NULL END) OR oggetto <> $4)`,
    [ref, t.prima_risposta_il ?? null, t.risolto_il ?? null, t.oggetto],
  );
  cambiato = cambiato || (r.rowCount ?? 0) > 0;
  return cambiato ? 'aggiornato' : 'uguale';
}

const pianoNoto = (cfg: Config, p?: string): string | undefined => (p && (p === 'nessuno' || cfg.ticket.sla.piani[p]) ? p : undefined);

/** Rilegge i ticket di una fonte dal suo backend: solo i cambiati dall'ultimo giro (con margine), tutti se `completa`. */
export async function sincronizzaFonte(d: DepsOps, fonte: string, o: { completa?: boolean } = {}): Promise<{ letti: number; nuovi: number; aggiornati: number }> {
  const backend = d.backends[fonte];
  const business = d.cfg.ticket.fonti[fonte]?.business;
  if (!backend || !business) return { letti: 0, nuovi: 0, aggiornati: 0 };
  const nome = `ticket:${fonte}`;
  const inizio = new Date();
  try {
    const prima = await d.pool.query<{ ultimo_ok: Date | null }>('SELECT ultimo_ok FROM crm_sync WHERE nome = $1', [nome]);
    const dopo = o.completa || !prima.rows[0]?.ultimo_ok ? undefined : new Date(prima.rows[0].ultimo_ok.getTime() - 10 * 60_000);
    const lista = await backend.elenca(dopo);
    let nuovi = 0;
    let aggiornati = 0;
    for (const t of lista) {
      const e = await applicaTicketRemoto(d, fonte, business, t);
      if (e === 'nuovo') nuovi++;
      else if (e === 'aggiornato') aggiornati++;
    }
    const out = { letti: lista.length, nuovi, aggiornati };
    await segna(d.pool, nome, inizio, { ok: true, dettaglio: { ...out, completa: !dopo } });
    return out;
  } catch (e) {
    await segna(d.pool, nome, inizio, { ok: false, errore: (e as Error).message });
    throw e;
  }
}

/** Un giro su tutte le fonti con backend. Un backend giù non ferma gli altri. */
export async function giroTicketRemoti(d: DepsOps, o: { completa?: boolean } = {}): Promise<Record<string, unknown> | 'occupato'> {
  return conLockCrm(d.pool, async () => {
    const out: Record<string, unknown> = {};
    for (const fonte of Object.keys(d.backends)) {
      try {
        out[fonte] = await sincronizzaFonte(d, fonte, o);
      } catch (e) {
        out[fonte] = { errore: (e as Error).message };
        d.notif.anomalia('ticket_backend_non_risponde', { fonte, errore: (e as Error).message });
      }
    }
    return out;
  });
}
