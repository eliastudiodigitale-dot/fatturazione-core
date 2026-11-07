// Workflow n8n: la logica dei nodi Code produce buste che il servizio vero accetta, e reagisce bene agli esiti.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTH, admin, costruisci, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const src = readFileSync(new URL('../n8n/prepara-busta.js', import.meta.url), 'utf8');
const L = new Function(`${src}; return { daEmettere, costruisciBusta, esitoRisposta, valoreCampo, clienteDaContatto };`)() as Record<string, (...a: unknown[]) => any>;
execFileSync(process.execPath, [new URL('../n8n/genera-workflow.mjs', import.meta.url).pathname]);
const wf = JSON.parse(readFileSync(new URL('../n8n/fatture-da-clickup.json', import.meta.url), 'utf8'));
const C = new Function(wf.nodes.find((n: { name: string }) => n.name === 'Configurazione').parameters.jsCode)()[0].json;
C.businessPerLista = { '901517931489': 'gazzolaelia.it' };

// Task come le restituisce l'API ClickUp (menu = orderindex, valuta = stringa, relazione = array di task).
const progetto = (o: { emetti?: number | null; importo?: string; clienti?: { id: string }[]; rata?: number; versione?: number } = {}) => ({
  id: '86c1abcde', name: 'Render villa Rossi', url: 'https://app.clickup.com/t/86c1abcde', list: { id: '901517931489' },
  custom_fields: [
    { id: 'f-em', name: 'Emetti documento', type: 'drop_down', type_config: { options: [{ id: 'o-p', name: 'Proforma', orderindex: 0 }, { id: 'o-f', name: 'Fattura', orderindex: 1 }] }, value: o.emetti === undefined ? 0 : o.emetti },
    { id: 'f-imp', name: 'Importo documento', type: 'currency', value: o.importo ?? '1500.5' },
    { id: 'f-cli', name: 'Cliente', type: 'list_relationship', value: o.clienti ?? [{ id: '86cliente1' }] },
    { id: 'f-rata', name: 'Rata', type: 'drop_down', type_config: { options: [{ id: 'r-u', name: 'Unica', orderindex: 0 }, { id: 'r-a', name: 'Acconto', orderindex: 1 }, { id: 'r-s', name: 'Saldo', orderindex: 2 }] }, value: o.rata ?? null },
    { id: 'f-ver', name: 'Versione documento', type: 'number', value: o.versione ?? null },
  ],
});
const contatto = {
  id: '86cliente1', name: 'Mario Rossi',
  custom_fields: [
    { id: 'c1', name: 'Ragione sociale', type: 'short_text', value: 'Rossi Costruzioni Srl' },
    { id: 'c2', name: 'P.IVA', type: 'short_text', value: 'IT 01234567890'.replace(' ', '') },
    { id: 'c3', name: 'Email', type: 'email', value: 'amministrazione@example.com' },
    { id: 'c4', name: 'Codice SDI', type: 'short_text', value: 'abc1234' },
    { id: 'c5', name: 'Indirizzo', type: 'short_text', value: 'Via Roma 1' },
    { id: 'c6', name: 'CAP', type: 'short_text', value: '20100' },
    { id: 'c7', name: 'Città', type: 'short_text', value: 'Milano' },
    { id: 'c8', name: 'Provincia', type: 'short_text', value: 'mi' },
  ],
};

describe('workflow n8n "Fatture da ClickUp"', () => {
  it('il JSON generato è coerente: nodi collegati esistono, i nodi Code compilano', () => {
    const nomi = new Set(wf.nodes.map((n: { name: string }) => n.name));
    for (const [da, c] of Object.entries(wf.connections as Record<string, { main: { node: string }[][] }>)) {
      expect(nomi.has(da)).toBe(true);
      for (const uscita of c.main) for (const v of uscita) expect(nomi.has(v.node)).toBe(true);
    }
    for (const n of wf.nodes.filter((n: { type: string }) => n.type === 'n8n-nodes-base.code'))
      expect(() => new Function('$input', '$json', '$', n.parameters.jsCode)).not.toThrow();
    expect(wf.active).toBe(false);
    expect(JSON.stringify(wf)).not.toMatch(/pk_|Bearer [a-f0-9]{20}/);
  });

  it('progetto completo: busta accettata dal servizio, stesso numero ai giri successivi', async () => {
    const sel = L.daEmettere(progetto(), C);
    expect(sel).toMatchObject({ ok: true, tipo: 'proforma', importo: 1500.5, business: 'gazzolaelia.it', rata: 'unica' });
    const busta = L.costruisciBusta(sel, contatto, C);
    expect(busta.cliente).toEqual({ ragione_sociale: 'Rossi Costruzioni Srl', partita_iva: '01234567890', email: 'amministrazione@example.com', codice_destinatario: 'ABC1234', indirizzo: { via: 'Via Roma 1', cap: '20100', citta: 'Milano', provincia: 'MI' } });
    const { app } = await costruisci({ pool });
    const r1 = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: busta });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: busta });
    expect(r2.json().numero).toBe(r1.json().numero);
    const e = L.esitoRisposta(200, r1.body, sel);
    expect(e).toMatchObject({ azione: 'fatto', pulisci: true });
    expect(e.commento).toMatch(/^✅ Proforma 1\/\d{4} riservata/);
    await app.close();
  });

  it('acconto e saldo: due documenti; importo cambiato sulla stessa rata: errore chiaro, nessun numero', async () => {
    const { app } = await costruisci({ pool });
    const invia = (p: object) => app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: L.costruisciBusta(L.daEmettere(p, C), contatto, C) });
    expect((await invia(progetto({ emetti: 1, rata: 1 }))).json().numero).toBe(1);
    expect((await invia(progetto({ emetti: 1, rata: 2 }))).json().numero).toBe(2);
    const r = await invia(progetto({ emetti: 1, rata: 2, importo: '999' }));
    expect(r.statusCode).toBe(409);
    expect(L.esitoRisposta(409, r.body, {}).commento).toMatch(/esiste già fattura 2\//);
    expect((await admin.query('SELECT ultimo FROM contatori WHERE tipo = $1', ['fattura'])).rows[0].ultimo).toBe(2);
    await app.close();
  });

  it('dati mancanti: nessuna chiamata al servizio, commento con cosa manca', () => {
    expect(L.daEmettere(progetto({ emetti: null }), C)).toBeNull();
    expect(L.daEmettere(progetto({ importo: '0' }), C)).toMatchObject({ ok: false, errore: expect.stringMatching(/Importo documento/) });
    expect(L.daEmettere(progetto({ clienti: [] }), C)).toMatchObject({ ok: false, errore: expect.stringMatching(/Cliente/) });
    expect(L.daEmettere({ ...progetto(), list: { id: 'altra' } }, C)).toMatchObject({ ok: false, errore: expect.stringMatching(/attività sconosciuta/) });
  });

  it('proforma annullata e rifatta con "Versione documento" = 2', async () => {
    const { app } = await costruisci({ pool });
    const b1 = L.costruisciBusta(L.daEmettere(progetto(), C), contatto, C);
    const r1 = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b1 });
    await app.inject({ method: 'POST', url: `/v1/documenti/${encodeURIComponent(r1.json().ref)}/annulla`, headers: AUTH.owner, payload: { motivo: 'importo errato' } });
    const r2 = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b1 });
    expect(L.esitoRisposta(r2.statusCode, r2.body, {}).commento).toMatch(/Versione documento/);
    const b3 = L.costruisciBusta(L.daEmettere(progetto({ versione: 2 }), C), contatto, C);
    const r3 = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b3 });
    expect(r3.statusCode).toBe(200);
    expect(r3.json().numero).toBe(2);
    await app.close();
  });

  it('servizio giù o lento: si riprova al giro dopo, il campo resta impostato', () => {
    for (const s of [undefined, 429, 500, 503]) expect(L.esitoRisposta(s, '', { task_id: 'x' })).toMatchObject({ azione: 'riprova', pulisci: false });
  });
});
