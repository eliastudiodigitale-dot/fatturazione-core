// Ticket dalle fonti (heyciar, serrandasu.it, reti): token per fonte, idempotenza, SLA, messaggi, filtri (decisione #45).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTH, AUTH_FONTE, admin, costruisci, poolApp, svuota } from './helpers.js';
import { statoDaClickUp, scadenze } from '../src/ticket.js';
import { cfgTest } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const nuovo = (id: string, extra: Record<string, unknown> = {}) => ({ id_esterno: id, oggetto: `Problema ${id}`, testo: 'Non riesco ad accedere', ...extra });

describe('POST /v1/ticket', () => {
  it('con il token di una fonte: fonte e attività sono quelle del token, risposta 201 e poi 200 (idempotente)', async () => {
    const { app } = await costruisci({ pool });
    const r1 = await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('A1', { cliente: { nome: 'Mario', email: 'Mario@Example.com' } }) });
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ ref: 'heyciar|A1', nuovo: true, stato: 'aperto', priorita: 'normale' });
    const r2 = await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('A1', { oggetto: 'Un altro oggetto' }) });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ ref: 'heyciar|A1', nuovo: false });
    const righe = (await admin.query('SELECT fonte, business, oggetto, cliente_email FROM ticket')).rows;
    expect(righe).toEqual([{ fonte: 'heyciar', business: 'heyciar.it', oggetto: 'Problema A1', cliente_email: 'mario@example.com' }]);
    await app.close();
  });

  it('SLA: 48 ore per heyciar (TICKET_SLA_ORE), tempi scalati dalla priorità, predefiniti 24/72 per le altre attività', async () => {
    const { app } = await costruisci({ pool });
    const a = (await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('S1') })).json();
    const u = (await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('S2', { priorita: 'urgente' }) })).json();
    const s = (await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.serrandasu, payload: nuovo('S3') })).json();
    const ore = (r: { scade_prima_risposta: string }, base: number) => Math.round((new Date(r.scade_prima_risposta).getTime() - base) / 3600_000);
    const t0 = Date.now();
    expect(ore(a, t0)).toBe(48);
    expect(ore(u, t0)).toBe(12);
    expect(ore(s, t0)).toBe(24);
    await app.close();
  });

  it('rifiuta: senza token 401, token del dashboard 403, business diverso dal token 400, campi extra 400, data nel futuro 400', async () => {
    const { app } = await costruisci({ pool });
    const post = (headers: Record<string, string> | undefined, payload: unknown) => app.inject({ method: 'POST', url: '/v1/ticket', headers, payload: payload as never });
    expect((await post(undefined, nuovo('X'))).statusCode).toBe(401);
    expect((await post({ authorization: 'Bearer sbagliato' }, nuovo('X'))).statusCode).toBe(401);
    expect((await post(AUTH.dashboard, nuovo('X', { fonte: 'heyciar', business: 'heyciar.it' }))).statusCode).toBe(403);
    expect((await post(AUTH_FONTE.heyciar, nuovo('X', { business: 'serrandasu.it' }))).json().codice).toBe('fonte_non_coerente');
    expect((await post(AUTH_FONTE.heyciar, nuovo('X', { extra: 1 }))).statusCode).toBe(400);
    expect((await post(AUTH_FONTE.heyciar, nuovo('X', { aperto_il: new Date(Date.now() + 3600_000).toISOString() }))).json().codice).toBe('data_non_valida');
    expect((await post(AUTH_FONTE.heyciar, { id_esterno: 'X' })).statusCode).toBe(400);
    expect((await admin.query('SELECT count(*)::int AS n FROM ticket')).rows[0].n).toBe(0);
    await app.close();
  });

  it('n8n e owner devono indicare fonte e attività; le fonti riservate (stripe, clickup...) sono vietate', async () => {
    const { app } = await costruisci({ pool });
    const post = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH.n8n, payload: payload as never });
    expect((await post(nuovo('N1'))).json().codice).toBe('fonte_mancante');
    expect((await post(nuovo('N1', { fonte: 'stripe', business: 'heyciar.it' }))).json().codice).toBe('fonte_riservata');
    const ok = await post(nuovo('N1', { fonte: 'sitoreti', business: 'reti.gazzolaelia.it' }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json().ref).toBe('sitoreti|N1');
    await app.close();
  });

  it('collega il ticket alla scheda cliente per email o partita IVA', async () => {
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, partita_iva, businesses) VALUES ('cli1', 'Rossi Srl', 'info@rossi.it', '12345678901', '{heyciar.it}')`);
    const { app } = await costruisci({ pool });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('C1', { cliente: { email: 'INFO@rossi.it' } }) });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('C2', { cliente: { partita_iva: 'IT12345678901' } }) });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('C3', { cliente: { email: 'altro@x.it' } }) });
    const r = (await admin.query('SELECT ref, cliente_task_id FROM ticket ORDER BY id')).rows;
    expect(r).toEqual([
      { ref: 'heyciar|C1', cliente_task_id: 'cli1' },
      { ref: 'heyciar|C2', cliente_task_id: 'cli1' },
      { ref: 'heyciar|C3', cliente_task_id: null },
    ]);
    await app.close();
  });

  it('ticket urgente: avviso; ticket normale: nessun avviso', async () => {
    const { app, notif } = await costruisci({ pool });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.reti, payload: nuovo('U1', { priorita: 'urgente' }) });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.reti, payload: nuovo('U2') });
    expect(notif.lista.map((x) => x.codice)).toEqual(['ticket_urgente']);
    await app.close();
  });
});

describe('messaggi sul ticket', () => {
  it('la risposta dello staff registra la prima risposta; lo stato non cambia', async () => {
    const { app } = await costruisci({ pool });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('M1') });
    const url = `/v1/ticket/${encodeURIComponent('heyciar|M1')}/messaggi`;
    const r = await app.inject({ method: 'POST', url, headers: AUTH.n8n, payload: { da: 'staff', testo: 'Ci pensiamo noi' } });
    expect(r.json()).toMatchObject({ stato: 'aperto', da_riaprire: false });
    const t = (await admin.query('SELECT prima_risposta_il FROM ticket')).rows[0];
    expect(t.prima_risposta_il).not.toBeNull();
    expect((await admin.query('SELECT da, testo FROM ticket_messaggi')).rows).toEqual([{ da: 'staff', testo: 'Ci pensiamo noi' }]);
    await app.close();
  });

  it('il cliente scrive su un ticket risolto: da_riaprire e avviso, lo stato resta quello di ClickUp', async () => {
    const { app, notif } = await costruisci({ pool });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('M2') });
    await admin.query(`UPDATE ticket SET stato = 'risolto', risolto_il = now()`);
    const r = await app.inject({ method: 'POST', url: `/v1/ticket/${encodeURIComponent('heyciar|M2')}/messaggi`, headers: AUTH_FONTE.heyciar, payload: { da: 'cliente', testo: 'Non funziona ancora' } });
    expect(r.json()).toMatchObject({ stato: 'risolto', da_riaprire: true });
    expect(notif.lista.map((x) => x.codice)).toContain('ticket_risposta_su_chiuso');
    expect((await admin.query('SELECT stato FROM ticket')).rows[0].stato).toBe('risolto');
    await app.close();
  });

  it('una fonte non può scrivere sui ticket di un\'altra fonte; ticket inesistente 404', async () => {
    const { app } = await costruisci({ pool });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.heyciar, payload: nuovo('M3') });
    const url = (ref: string) => `/v1/ticket/${encodeURIComponent(ref)}/messaggi`;
    expect((await app.inject({ method: 'POST', url: url('heyciar|M3'), headers: AUTH_FONTE.serrandasu, payload: { da: 'cliente' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: url('serrandasu|nonc'), headers: AUTH_FONTE.serrandasu, payload: { da: 'cliente' } })).statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /v1/ticket (filtri)', () => {
  async function popola() {
    const ins = (ref: string, business: string, fonte: string, stato: string, priorita: string, ore: number, extra = '') =>
      admin.query(
        `INSERT INTO ticket (ref, fonte, business, oggetto, stato, priorita, aperto_il, scade_prima_risposta, scade_risoluzione, cliente_nome ${extra ? ', assegnato_a' : ''})
         VALUES ($1,$2,$3,$4,$5,$6, now() - make_interval(hours => $7), now() - make_interval(hours => $7) + interval '24 hours', now() - make_interval(hours => $7) + interval '72 hours', 'Cliente ${ref}' ${extra ? ', $8' : ''})`,
        extra ? [ref, fonte, business, `Oggetto ${ref}`, stato, priorita, ore, extra] : [ref, fonte, business, `Oggetto ${ref}`, stato, priorita, ore],
      );
    await ins('heyciar|1', 'heyciar.it', 'heyciar', 'aperto', 'urgente', 50);
    await ins('heyciar|2', 'heyciar.it', 'heyciar', 'in_lavorazione', 'normale', 5, 'Elia');
    await ins('serrandasu|1', 'serrandasu.it', 'serrandasu', 'risolto', 'bassa', 100);
    await ins('reti|1', 'reti.gazzolaelia.it', 'reti', 'aperto', 'alta', 1);
  }

  it('filtra per attività, stato, priorità, fonte, assegnato, testo e SLA scaduti', async () => {
    await popola();
    const { app } = await costruisci({ pool });
    const q = async (qs: string) => (await app.inject({ method: 'GET', url: `/v1/ticket?${qs}`, headers: AUTH.dashboard })).json() as { totale: number; ticket: { ref: string; sla_risposta_scaduta: boolean }[] };
    expect((await q('')).totale).toBe(4);
    expect((await q('business=heyciar.it')).ticket.map((t) => t.ref).sort()).toEqual(['heyciar|1', 'heyciar|2']);
    expect((await q('stato=aperto,in_lavorazione')).totale).toBe(3);
    expect((await q('priorita=urgente,alta')).totale).toBe(2);
    expect((await q('fonte=serrandasu')).totale).toBe(1);
    expect((await q('assegnato=elia')).ticket.map((t) => t.ref)).toEqual(['heyciar|2']);
    expect((await q('q=Oggetto reti')).ticket.map((t) => t.ref)).toEqual(['reti|1']);
    // heyciar|1 è aperto da 50 ore senza risposta (scadenza a 24 ore): SLA scaduto. Il risolto non conta.
    const sc = await q('scaduti=true');
    expect(sc.ticket.map((t) => t.ref)).toEqual(['heyciar|1']);
    expect(sc.ticket[0]!.sla_risposta_scaduta).toBe(true);
    await app.close();
  });

  it('ordina, impagina e valida i parametri', async () => {
    await popola();
    const { app } = await costruisci({ pool });
    const get = (qs: string) => app.inject({ method: 'GET', url: `/v1/ticket?${qs}`, headers: AUTH.dashboard });
    const p1 = (await get('ordine=vecchi&limite=2')).json();
    expect(p1.totale).toBe(4);
    expect(p1.ticket.map((t: { ref: string }) => t.ref)).toEqual(['serrandasu|1', 'heyciar|1']);
    const p2 = (await get('ordine=vecchi&limite=2&offset=2')).json();
    expect(p2.ticket.map((t: { ref: string }) => t.ref)).toEqual(['heyciar|2', 'reti|1']);
    expect((await get('stato=boh')).statusCode).toBe(400);
    expect((await get('ordine=boh')).statusCode).toBe(400);
    expect((await get('limite=9999')).statusCode).toBe(400);
    expect((await get('inesistente=1')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/ticket' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/ticket', headers: AUTH_FONTE.heyciar })).statusCode).toBe(401); // le fonti non leggono
    await app.close();
  });

  it('dettaglio con cronologia; il testo non viene mai esposto', async () => {
    const { app } = await costruisci({ pool });
    await app.inject({ method: 'POST', url: '/v1/ticket', headers: AUTH_FONTE.reti, payload: nuovo('D1', { testo: 'testo riservato' }) });
    const r = await app.inject({ method: 'GET', url: `/v1/ticket/${encodeURIComponent('reti|D1')}`, headers: AUTH.owner });
    const t = r.json();
    expect(t.eventi.map((e: { tipo: string }) => e.tipo)).toEqual(['aperto']);
    expect(JSON.stringify(t)).not.toContain('testo riservato');
    expect((await app.inject({ method: 'GET', url: '/v1/ticket/inesistente', headers: AUTH.owner })).statusCode).toBe(404);
    await app.close();
  });
});

describe('regole pure', () => {
  it('statoDaClickUp riconosce i nomi per parola, poi per tipo', () => {
    const s = (nome: string, tipo = 'custom') => statoDaClickUp({ nome, tipo });
    expect(s('to do', 'open')).toBe('aperto');
    expect(s('In lavorazione')).toBe('in_lavorazione');
    expect(s('IN ATTESA DEL CLIENTE')).toBe('in_attesa_cliente');
    expect(s('Risolto', 'closed')).toBe('risolto');
    expect(s('Closed', 'closed')).toBe('chiuso');
    expect(s('Completato', 'done')).toBe('risolto');
    expect(s('qualcosa', 'closed')).toBe('chiuso');
  });

  it('scadenze: la priorità scala i tempi', () => {
    const sla = cfgTest().ticket.sla;
    const t0 = new Date('2026-11-01T10:00:00Z');
    expect(scadenze(sla, 'x.it', 'normale', t0).primaRisposta!.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(scadenze(sla, 'x.it', 'bassa', t0).primaRisposta!.toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(scadenze(sla, 'x.it', 'urgente', t0).risoluzione!.toISOString()).toBe('2026-11-02T04:00:00.000Z');
  });
});
