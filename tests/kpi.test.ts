// KPI, elenco clienti e ambiti (attività e importi visibili) di CRM e ticketing (decisione #45).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { riserva } from '../src/documenti.js';
import { elencoClienti, dettaglioCliente } from '../src/crm.js';
import { kpiClienti, kpiFatturato, kpiTicket, panoramica, serie, perBusiness, ErroreKpi } from '../src/kpi.js';
import { AMBITO_TOTALE, type Ambito } from '../src/sql.js';
import { mezzanotteRoma, periodo } from '../src/api-crm.js';
import { AUTH, admin, costruisci, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const ORE = 3600_000;
const ADESSO = new Date();
const periodo30 = () => ({ da: new Date(ADESSO.getTime() - 30 * 24 * ORE), a: new Date(ADESSO.getTime() + ORE) });
const SOLO_SERRANDA: Ambito = { business: ['serrandasu.it'], soldi: false };
const AMMINISTRAZIONE_HEYCIAR: Ambito = { business: ['heyciar.it'], soldi: true };

interface T {
  ref: string;
  business: string;
  fonte?: string;
  stato?: string;
  priorita?: string;
  apertoOreFa: number;
  rispostaDopoOre?: number;
  risoltoDopoOre?: number;
  slaRisposta?: number;
  slaRisoluzione?: number;
  cliente?: string;
  categoria?: string;
  assegnato?: string;
}
async function ticket(t: T) {
  const aperto = new Date(Date.now() - t.apertoOreFa * ORE);
  const quando = (ore?: number) => (ore === undefined ? null : new Date(aperto.getTime() + ore * ORE));
  await admin.query(
    `INSERT INTO ticket (ref, fonte, business, oggetto, stato, priorita, aperto_il, prima_risposta_il, risolto_il, scade_prima_risposta, scade_risoluzione, cliente_task_id, categoria, assegnato_a)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      t.ref, t.fonte ?? t.business.split('.')[0], t.business, `Oggetto ${t.ref}`, t.stato ?? 'aperto', t.priorita ?? 'normale', aperto, quando(t.rispostaDopoOre), quando(t.risoltoDopoOre),
      quando(t.slaRisposta ?? 24), quando(t.slaRisoluzione ?? 72), t.cliente ?? null, t.categoria ?? null, t.assegnato ?? null,
    ],
  );
}
async function documento(ref: string, tipo: 'fattura' | 'proforma', business: string, cliente: Record<string, unknown>, importi: number[], giorniFa = 1, annullato = false) {
  const d = await riserva(pool, { ref, tipo, fonte: 'clickup', business, payload: { cliente, righe: importi.map((importo, i) => ({ descrizione: `r${i}`, importo })) } });
  await admin.query(`UPDATE documenti SET data_riserva = now() - make_interval(days => $2), stato = $3 WHERE id = $1`, [d.id, giorniFa, annullato ? 'annullato' : 'creato']);
}
async function clienteCache(id: string, nome: string, businesses: string[], extra: Record<string, unknown> = {}) {
  await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, partita_iva, businesses, stato, creato_il) VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now()))`, [
    id, nome, extra.email ?? null, extra.piva ?? null, businesses, extra.stato ?? 'Attivo', extra.creato ?? null,
  ]);
}

async function scenario() {
  // heyciar: A risolto in tempo, B senza risposta oltre la scadenza (SLA scaduto), C urgente in lavorazione
  await ticket({ ref: 'heyciar|A', business: 'heyciar.it', stato: 'risolto', apertoOreFa: 72, rispostaDopoOre: 2, risoltoDopoOre: 30, cliente: 'c1', categoria: 'accessi', assegnato: 'elia' });
  await ticket({ ref: 'heyciar|B', business: 'heyciar.it', stato: 'aperto', apertoOreFa: 120, cliente: 'c1', categoria: 'fatturazione' });
  await ticket({ ref: 'heyciar|C', business: 'heyciar.it', stato: 'in_lavorazione', priorita: 'urgente', apertoOreFa: 3, rispostaDopoOre: 1, slaRisposta: 6, slaRisoluzione: 24, cliente: 'c2', categoria: 'accessi', assegnato: 'elia' });
  // serrandasu: D aperto da poco
  await ticket({ ref: 'serrandasu|D', business: 'serrandasu.it', stato: 'in_attesa_cliente', apertoOreFa: 10, rispostaDopoOre: 4 });
  // ticket vecchio di 3 mesi: fuori dal periodo
  await ticket({ ref: 'reti|E', business: 'reti.gazzolaelia.it', stato: 'chiuso', apertoOreFa: 24 * 90, rispostaDopoOre: 1, risoltoDopoOre: 5 });

  await clienteCache('c1', 'Rossi Srl', ['heyciar.it'], { email: 'info@rossi.it', piva: '12345678901', creato: new Date(Date.now() - 5 * 24 * ORE) });
  await clienteCache('c2', 'Bianchi', ['heyciar.it', 'serrandasu.it'], { email: 'b@bianchi.it', creato: new Date(Date.now() - 200 * 24 * ORE) });
  await clienteCache('c3', 'Verdi (reti)', ['reti.gazzolaelia.it'], { email: 'v@verdi.it' });

  await documento('p1|fattura|unica', 'fattura', 'heyciar.it', { ragione_sociale: 'Rossi Srl', partita_iva: 'IT12345678901', email: 'info@rossi.it' }, [100, 50]);
  await documento('p2|fattura|unica', 'fattura', 'serrandasu.it', { nome: 'Bianchi', email: 'B@Bianchi.it' }, [200], 2);
  await documento('p3|fattura|unica', 'fattura', 'heyciar.it', { nome: 'Rossi Srl', email: 'info@rossi.it' }, [999], 3, true); // annullata: non conta
  await documento('p4|proforma|unica', 'proforma', 'heyciar.it', { nome: 'Rossi Srl', email: 'info@rossi.it' }, [70]);
  await documento('p5|fattura|unica', 'fattura', 'reti.gazzolaelia.it', { nome: 'Verdi', email: 'v@verdi.it' }, [30], 400); // oltre 12 mesi
}

describe('KPI ticket', () => {
  it('carico, flusso, tempi e SLA', async () => {
    await scenario();
    const k = await kpiTicket(pool, AMBITO_TOTALE, periodo30());
    expect(k).toMatchObject({ da_prendere: 1, in_lavorazione: 1, in_attesa_cliente: 1, backlog: 3, backlog_urgenti: 1 });
    expect(k.sla_risposta_scaduti).toBe(1); // solo B
    expect(k.sla_risoluzione_scaduti).toBe(1); // B è aperto da 120 ore, il limite era 72
    expect(k.arrivati).toBe(4); // E è fuori periodo
    expect(k.risolti).toBe(1); // A
    // prima risposta media su A (2h), C (1h), D (4h) = 2.3h
    expect(k.prima_risposta_media_ore).toBeCloseTo(2.3, 1);
    expect(k.prima_risposta_mediana_ore).toBe(2);
    expect(k.risoluzione_media_ore).toBe(30);
    // SLA risposta: valutati A, B(scaduto), C, D = 4; rispettati A, C, D = 3
    expect(k.sla_risposta_pct).toBe(75);
    expect(k.sla_risoluzione_pct).toBe(100);
  });

  it('un periodo vuoto non produce divisioni per zero', async () => {
    const k = await kpiTicket(pool, AMBITO_TOTALE, periodo30());
    expect(k).toMatchObject({ backlog: 0, arrivati: 0, prima_risposta_media_ore: null, sla_risposta_pct: null, sla_risoluzione_pct: null });
  });

  it('filtri per attività e fonte; ambito ristretto non vede le altre attività', async () => {
    await scenario();
    const f = periodo30();
    expect((await kpiTicket(pool, AMBITO_TOTALE, { ...f, business: ['heyciar.it'] })).backlog).toBe(2);
    expect((await kpiTicket(pool, AMBITO_TOTALE, { ...f, fonte: ['serrandasu'] })).backlog).toBe(1);
    expect((await kpiTicket(pool, SOLO_SERRANDA, f)).backlog).toBe(1);
    // chi ha un ambito ristretto non può "allargarlo" chiedendo un'altra attività: vede zero, non il dato altrui
    expect((await kpiTicket(pool, SOLO_SERRANDA, { ...f, business: ['heyciar.it'] })).backlog).toBe(0);
  });
});

describe('KPI fatturato e clienti', () => {
  it('fatturato per attività: escluse annullate e proforme dal totale fatture; primi clienti', async () => {
    await scenario();
    const f = (await kpiFatturato(pool, AMBITO_TOTALE, periodo30()))!;
    expect(f.fatture).toBe(2);
    expect(f.fatturato).toBe(350); // 150 heyciar + 200 serrandasu
    expect(f.media_fattura).toBe(175);
    expect(f.per_business).toEqual([
      { business: 'serrandasu.it', fatture: 1, fatturato: 200, proforme: 0, proforme_importo: 0 },
      { business: 'heyciar.it', fatture: 1, fatturato: 150, proforme: 1, proforme_importo: 70 },
    ]);
    expect(f.top_clienti.map((c) => [c.nome, c.fatturato])).toEqual([['Bianchi', 200], ['Rossi Srl', 150]]);
  });

  it('chi non vede gli importi non ottiene fatturato', async () => {
    await scenario();
    expect(await kpiFatturato(pool, SOLO_SERRANDA, periodo30())).toBeNull();
    const k = await kpiClienti(pool, SOLO_SERRANDA, periodo30());
    expect(k.attivi_12m).toBeNull();
  });

  it('clienti: totali, nuovi nel periodo, su più attività, attivi, con ticket aperti', async () => {
    await scenario();
    const k = await kpiClienti(pool, AMBITO_TOTALE, periodo30());
    expect(k).toMatchObject({ totali: 3, nuovi: 2, multi_business: 1, con_ticket_aperti: 2 });
    // Rossi (fattura 1 giorno fa) e Bianchi (2 giorni fa) sì; Verdi ha solo una fattura di 400 giorni fa
    expect(k.attivi_12m).toBe(2);
    expect((await kpiClienti(pool, AMMINISTRAZIONE_HEYCIAR, periodo30())).totali).toBe(2);
  });

  it('per attività: una riga per attività con ticket, clienti e fatturato', async () => {
    await scenario();
    const r = await perBusiness(pool, AMBITO_TOTALE, periodo30());
    const h = r.find((x) => x.business === 'heyciar.it')!;
    expect(h).toMatchObject({ backlog: 2, sla_scaduti: 1, arrivati: 3, risolti: 1, clienti: 2, fatture: 1, fatturato: 150 });
    const senzaSoldi = await perBusiness(pool, SOLO_SERRANDA, periodo30());
    expect(senzaSoldi.map((x) => x.business)).toEqual(['serrandasu.it']);
    expect(senzaSoldi[0]).toMatchObject({ fatture: null, fatturato: null });
  });
});

describe('serie e panoramica', () => {
  it('serie giornaliera con tutti i giorni del periodo, anche quelli vuoti', async () => {
    await scenario();
    const f = { da: new Date(Date.now() - 6 * 24 * ORE), a: new Date(Date.now() + 1 * ORE) };
    const s = await serie(pool, AMBITO_TOTALE, f, 'giorno');
    expect(s.length).toBeGreaterThanOrEqual(7);
    expect(s.reduce((n, p) => n + p.ticket_arrivati, 0)).toBe(4);
    expect(s.reduce((n, p) => n + (p.fatturato ?? 0), 0)).toBe(350);
    expect(s.reduce((n, p) => n + p.ticket_risolti, 0)).toBe(1);
    const senzaSoldi = await serie(pool, SOLO_SERRANDA, f, 'giorno');
    expect(senzaSoldi.every((p) => p.fatturato === null)).toBe(true);
  });

  it('serie mensile e limite ai punti', async () => {
    await scenario();
    const m = await serie(pool, AMBITO_TOTALE, { da: new Date(Date.now() - 400 * 24 * ORE), a: new Date() }, 'mese');
    expect(m.length).toBeGreaterThanOrEqual(13);
    await expect(serie(pool, AMBITO_TOTALE, { da: new Date(Date.now() - 800 * 24 * ORE), a: new Date() }, 'giorno')).rejects.toBeInstanceOf(ErroreKpi);
    await expect(serie(pool, AMBITO_TOTALE, { da: new Date(), a: new Date(Date.now() - ORE) }, 'giorno')).rejects.toBeInstanceOf(ErroreKpi);
  });

  it('panoramica: tutto insieme, con distribuzioni', async () => {
    await scenario();
    const p = await panoramica(pool, AMBITO_TOTALE, periodo30(), 'settimana');
    expect(p.ticket.backlog).toBe(3);
    expect(p.fatturato!.fatturato).toBe(350);
    expect(p.distribuzioni.per_stato.map((x) => x.voce).sort()).toEqual(['aperto', 'chiuso', 'in_attesa_cliente', 'in_lavorazione', 'risolto']);
    expect(p.distribuzioni.per_categoria[0]).toEqual({ voce: 'accessi', n: 2 });
    expect(p.distribuzioni.per_assegnato.find((x) => x.voce === 'elia')?.n).toBe(2);
    expect(p.per_business.length).toBe(3);
    expect(p.serie.length).toBeGreaterThan(0);
  });
});

describe('elenco clienti', () => {
  it('con ticket aperti, fatture e fatturato 12 mesi; filtri e ordine', async () => {
    await scenario();
    const r = await elencoClienti(pool, AMBITO_TOTALE, { ordine: 'fatturato' });
    expect(r.totale).toBe(3);
    const per = Object.fromEntries(r.clienti.map((c) => [c.nome as string, c]));
    expect(per['Rossi Srl']).toMatchObject({ ticket_aperti: 1, ticket_totali: 2, fatture: 1, fatturato_12m: '150' });
    expect(per['Bianchi']).toMatchObject({ ticket_aperti: 1, fatture: 1, fatturato_12m: '200' });
    expect(per['Verdi (reti)']).toMatchObject({ ticket_aperti: 0, fatture: 1, fatturato_12m: '0' }); // la fattura è di oltre 12 mesi fa
    expect(r.clienti.map((c) => c.nome)).toEqual(['Bianchi', 'Rossi Srl', 'Verdi (reti)']);

    expect((await elencoClienti(pool, AMBITO_TOTALE, { conTicketAperti: true })).totale).toBe(2);
    expect((await elencoClienti(pool, AMBITO_TOTALE, { q: 'bianchi' })).clienti.map((c) => c.nome)).toEqual(['Bianchi']);
    expect((await elencoClienti(pool, AMBITO_TOTALE, { q: '12345678901' })).clienti.map((c) => c.nome)).toEqual(['Rossi Srl']);
    expect((await elencoClienti(pool, AMBITO_TOTALE, { business: ['serrandasu.it'] })).clienti.map((c) => c.nome)).toEqual(['Bianchi']);
    await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, businesses) VALUES ('c9', 'Senza fatture', '{heyciar.it}')`);
    expect((await elencoClienti(pool, AMBITO_TOTALE, { senzaFatture: true })).clienti.map((c) => c.nome)).toEqual(['Senza fatture']);
    const p1 = await elencoClienti(pool, AMBITO_TOTALE, { limite: 2, offset: 0 });
    expect(p1.totale).toBe(4);
    expect(p1.clienti).toHaveLength(2);
  });

  it('ambito ristretto: solo i clienti delle proprie attività e conteggi solo su quelle', async () => {
    await scenario();
    const r = await elencoClienti(pool, SOLO_SERRANDA, {});
    expect(r.clienti.map((c) => c.nome)).toEqual(['Bianchi']);
    // Bianchi ha un ticket aperto su heyciar (non visibile) e uno su serrandasu (D non ha cliente collegato): per serrandasu 0
    expect(r.clienti[0]).toMatchObject({ ticket_aperti: 0, fatture: null, fatturato_12m: null });
    // ordinare per fatturato senza vedere gli importi ricade sul nome, senza errori
    expect((await elencoClienti(pool, SOLO_SERRANDA, { ordine: 'fatturato' })).totale).toBe(1);
    // un'altra attività chiesta esplicitamente non allarga l'ambito
    expect((await elencoClienti(pool, SOLO_SERRANDA, { business: ['reti.gazzolaelia.it'] })).totale).toBe(0);
  });

  it('dettaglio cliente: ticket e documenti dentro l\'ambito; fuori ambito non esiste', async () => {
    await scenario();
    const intero = (await dettaglioCliente(pool, AMBITO_TOTALE, 'c2'))!;
    expect(intero.ticket.map((t: { ref: string }) => t.ref)).toEqual(['heyciar|C']);
    expect(intero.documenti!.map((d: { ref: string }) => d.ref)).toEqual(['p2|fattura|unica']);
    const ristretto = (await dettaglioCliente(pool, SOLO_SERRANDA, 'c2'))!;
    expect(ristretto.ticket).toEqual([]); // il ticket C è di heyciar
    expect(ristretto.documenti).toBeNull();
    expect(await dettaglioCliente(pool, SOLO_SERRANDA, 'c1')).toBeUndefined(); // cliente solo heyciar
    expect(await dettaglioCliente(pool, AMBITO_TOTALE, 'inesistente')).toBeUndefined();
  });
});

describe('API KPI e clienti', () => {
  it('rotte /v1: token owner/dashboard/n8n sì, fonti no; parametri validati', async () => {
    await scenario();
    const { app } = await costruisci({ pool });
    const get = (url: string, headers: Record<string, string> = AUTH.dashboard) => app.inject({ method: 'GET', url, headers });
    const p = await get('/v1/kpi/panoramica?giorni=30&granularita=settimana');
    expect(p.statusCode).toBe(200);
    expect(p.json().ticket.backlog).toBe(3);
    expect(p.json().fatturato.fatturato).toBe(350);
    expect((await get('/v1/kpi/panoramica', {})).statusCode).toBe(401);
    expect((await get('/v1/kpi/panoramica?granularita=anno')).statusCode).toBe(400);
    expect((await get('/v1/kpi/panoramica?giorni=0')).statusCode).toBe(400);
    expect((await get('/v1/kpi/panoramica?da=ieri')).statusCode).toBe(400);
    expect((await get('/v1/kpi/serie?giorni=3000&granularita=giorno')).statusCode).toBe(400);
    expect((await get('/v1/kpi/serie?giorni=14')).json().serie.length).toBeGreaterThanOrEqual(14);
    expect((await get('/v1/kpi/business?business=heyciar.it')).json().per_business).toHaveLength(1);
    expect((await get('/v1/kpi/ticket')).json().distribuzioni.per_fonte.length).toBeGreaterThan(0);
    expect((await get('/v1/kpi/clienti')).json().clienti.totali).toBe(3);
    const c = await get('/v1/clienti?q=rossi');
    expect(c.json().clienti).toHaveLength(1);
    const id = c.json().clienti[0].clickup_task_id;
    expect((await get(`/v1/clienti/${id}`)).json().nome).toBe('Rossi Srl');
    expect((await get('/v1/clienti/inesistente')).statusCode).toBe(404);
    const filtri = (await get('/v1/filtri')).json();
    expect(filtri.business).toEqual(['heyciar.it', 'reti.gazzolaelia.it', 'serrandasu.it']);
    expect(filtri.fonti).toEqual(['heyciar', 'reti', 'serrandasu']);
    expect(filtri.stati_ticket).toContain('in_attesa_cliente');
    await app.close();
  });

  it('POST /v1/sync/esegui: solo owner, 404 se la sincronizzazione non è configurata, altrimenti risponde con l\'esito', async () => {
    const { app } = await costruisci({ pool });
    expect((await app.inject({ method: 'POST', url: '/v1/sync/esegui', headers: AUTH.n8n, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/sync/esegui', headers: AUTH.owner, payload: {} })).statusCode).toBe(404);
    await app.close();
  });
});

describe('date e periodi', () => {
  it('mezzanotte di Roma, in inverno e in estate', () => {
    expect(mezzanotteRoma('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(mezzanotteRoma('2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(mezzanotteRoma('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z'); // giorno del cambio all'ora legale: mezzanotte ancora a +1
    expect(mezzanotteRoma('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });

  it('"a" con la sola data è inclusiva; giorni e date si combinano', () => {
    const ora = new Date('2026-11-20T12:00:00Z');
    const p = periodo({ da: '2026-11-01', a: '2026-11-10' }, ora);
    expect(p.da.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(p.a.toISOString()).toBe('2026-11-10T23:00:00.000Z');
    const g = periodo({ giorni: '7' }, ora);
    expect(g.a.toISOString()).toBe(ora.toISOString());
    expect(g.da.toISOString()).toBe('2026-11-13T12:00:00.000Z');
    expect(() => periodo({ da: 'boh' }, ora)).toThrow();
  });
});
