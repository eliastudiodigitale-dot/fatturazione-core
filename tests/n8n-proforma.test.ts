// Flusso n8n "auto_pro-forma" adattato al servizio: si eseguono i nodi Code modificati con dati realistici
// e la busta prodotta va nel servizio vero. Il flusso qui è una copia minima con gli stessi nomi di nodo.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { adatta } from '../n8n/adatta-proforma.mjs';
import { AUTH, admin, costruisci, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

// Stesso schema del nodo "proforma" di Elia: getCustomFieldId sulle task lette, cfArray, return [...]
const PROFORMA_ORIGINALE = `const items = $input.all();
const tasks = items.map(i => i.json);
function getCustomFieldId(fieldName) {
  for (const task of tasks) { const f = (task.custom_fields || []).find(cf => String(cf.name).trim().toLowerCase() === String(fieldName).trim().toLowerCase()); if (f) return f.id; }
  return null;
}
const nextNrProforma = $items('calc-nr')[0].json._nr.nextNrProforma;
const cfArray = [];
cfArray.push({ id: getCustomFieldId('nr-proforma'), value: nextNrProforma });
return [{ json: { customFieldsJson: JSON.stringify(cfArray) } }];`;

const nodo = (name: string, type = 'n8n-nodes-base.code', parameters: Record<string, unknown> = { jsCode: 'return [];' }) => ({ name, type, typeVersion: 2, position: [0, 0], parameters });
const flussoMinimo = () => ({
  name: 'auto_pro-forma (from clickup) +subtasks',
  id: 'qxTGplETNXsTvKOZ',
  active: true,
  nodes: [
    nodo('Code in JavaScript'), nodo('Get a task', 'n8n-nodes-base.clickUp', {}), nodo('get proforme', 'n8n-nodes-base.clickUp', {}), nodo('calc-nr'), nodo('Build HTML'),
    nodo('proforma', 'n8n-nodes-base.code', { jsCode: PROFORMA_ORIGINALE }), nodo('Create a task', 'n8n-nodes-base.clickUp', {}), nodo('pf-creata', 'n8n-nodes-base.clickUp', {}),
    nodo('If', 'n8n-nodes-base.if', {}), nodo('If1', 'n8n-nodes-base.if', {}), nodo('Merge', 'n8n-nodes-base.merge', {}),
    { ...nodo('Send a text message2', 'n8n-nodes-base.telegram', { chatId: '21500777', text: 'x' }), credentials: { telegramApi: { id: 'tg1', name: 'Telegram' } } },
    { ...nodo('Set a custom Field on a task', 'n8n-nodes-base.clickUp', { operation: 'setCustomField', value: '={{false}}' }), credentials: { clickUpOAuth2Api: { id: 'cu1', name: 'ClickUp' } } },
    nodo('Send a text message1', 'n8n-nodes-base.telegram', {}), nodo('Get many tasks1', 'n8n-nodes-base.clickUp', {}),
  ],
  connections: {
    'Get a task': { main: [[{ node: 'get proforme', type: 'main', index: 0 }]] },
    'get proforme': { main: [[{ node: 'calc-nr', type: 'main', index: 0 }]] },
    'calc-nr': { main: [[{ node: 'Build HTML', type: 'main', index: 0 }]] },
    'Create a task': { main: [[{ node: 'pf-creata', type: 'main', index: 0 }]] },
    If: { main: [[{ node: 'Merge', type: 'main', index: 0 }], [{ node: 'Send a text message2', type: 'main', index: 0 }]] },
    If1: { main: [[{ node: 'Get many tasks1', type: 'main', index: 0 }], [{ node: 'Send a text message1', type: 'main', index: 0 }]] },
  },
  pinData: { 'Get a task': [{ json: { dati: 'di prova da non esportare' } }] },
});

/** Esegue il codice di un nodo Code con i dati degli altri nodi. */
function esegui(code: string, nodi: Record<string, unknown[]>, input: unknown[] = [], sd: Record<string, unknown> = {}) {
  const items = (n: string) => (nodi[n] ?? []).map((json) => ({ json }));
  const $ = (n: string) => ({ first: () => items(n)[0], all: () => items(n) });
  const f = new Function('$input', '$', '$items', '$getWorkflowStaticData', `return (() => { ${code} })();`);
  return f({ all: () => input.map((json) => ({ json })), first: () => ({ json: input[0] }) }, $, items, () => sd) as { json: any }[];
}

const pack = {
  project: { taskId: '86c0proj1', name: 'Render Villa Bianchi', businessLabel: 'STUDIO DIGITALE di Elia Gazzola' },
  client: { contactTaskId: '86c0cli1', name: 'Bianchi' },
  billing: { firmatoPer: 1200, scontoApplicato: 100, extra: 50, spese: 0, valoreProforma: 1150 },
  meta: { fieldIds: { proformaStatus: 'f-proforma' } },
};
const contatto = {
  id: '86c0cli1', name: 'Luca Bianchi',
  custom_fields: [
    { name: 'Azienda', type: 'short_text', value: 'Bianchi Arredi Srl' },
    { name: 'P.iva', type: 'short_text', value: '04567890123' },
    { name: 'sdi', type: 'short_text', value: 'M5UXCR1' },
    { name: 'email lavoro', type: 'email', value: 'info@bianchi.example' },
    { name: 'Indirizzo', type: 'short_text', value: 'Via Treviso 10, 31033 Castelfranco Veneto (TV)' },
  ],
};

describe('flusso auto_pro-forma adattato', () => {
  const wf = adatta(flussoMinimo());
  const js = (n: string) => wf.nodes.find((x: { name: string }) => x.name === n).parameters.jsCode as string;

  it('struttura: catena del numero, conferma, annulli; nessun dato di prova, nuovo workflow spento', () => {
    expect(wf.id).toBeUndefined();
    expect(wf.pinData).toBeUndefined();
    expect(wf.active).toBe(false);
    expect(wf.connections['Get a task'].main[0][0].node).toBe('Busta per il servizio');
    expect(wf.connections['Numero ok?'].main.map((u: { node: string }[]) => u.map((x) => x.node))).toEqual([['calc-nr'], ['Errore numero']]);
    expect(wf.connections['Create a task'].main[0].map((x: { node: string }) => x.node)).toEqual(['pf-creata', 'Conferma al servizio']);
    expect(wf.connections.If.main[1].map((x: { node: string }) => x.node)).toEqual(['Send a text message2', 'Annulla proforma (NO)']);
    expect(wf.connections.If1.main[1].map((x: { node: string }) => x.node)).toEqual(['Send a text message1', 'Annulla proforma (email)']);
    expect(wf.nodes.find((n: { name: string }) => n.name === 'Avvisa errore numero').credentials).toEqual({ telegramApi: { id: 'tg1', name: 'Telegram' } });
    expect(wf.nodes.find((n: { name: string }) => n.name === 'Togli spunta proforma').credentials).toEqual({ clickUpOAuth2Api: { id: 'cu1', name: 'ClickUp' } });
  });

  it('busta -> servizio -> calc-nr -> proforma: il numero del PDF e della task è quello del servizio, con la chiave', async () => {
    const [{ json: b }] = esegui(js('Busta per il servizio'), { 'Code in JavaScript': [pack], 'Get a task': [contatto] });
    expect(b.errori).toEqual([]);
    expect(b.busta).toMatchObject({ ref: '86c0proj1|proforma|unica', auto_versione: true, business: 'gazzolaelia.it', righe: [{ descrizione: 'Render Villa Bianchi', importo: 1150 }] });
    expect(b.busta.cliente).toMatchObject({ ragione_sociale: 'Bianchi Arredi Srl', partita_iva: '04567890123', codice_destinatario: 'M5UXCR1', indirizzo: { via: 'Via Treviso 10', cap: '31033', citta: 'Castelfranco Veneto', provincia: 'TV' } });

    const { app } = await costruisci({ pool });
    const r = await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b.busta });
    expect(r.statusCode).toBe(200);
    const risposta = { statusCode: 200, body: r.json() };

    const [{ json: cn }] = esegui(js('calc-nr'), { 'Riserva numero (servizio)': [risposta], 'Get a task': [contatto] });
    expect(cn._nr).toMatchObject({ nextNrProforma: 1, proformaLabel: `01/${r.json().anno}`, chiave: `proforma|${r.json().anno}|1` });
    expect(cn.name).toBe('Luca Bianchi'); // Build HTML continua a ricevere la task cliente

    const docs = [{ custom_fields: [{ id: 'f-nr', name: 'nr-proforma' }, { id: 'f-chiave', name: 'Chiave documento' }] }];
    const [{ json: pf }] = esegui(js('proforma'), { 'calc-nr': [cn] }, docs);
    expect(JSON.parse(pf.customFieldsJson)).toEqual([{ id: 'f-nr', value: 1 }, { id: 'f-chiave', value: `proforma|${r.json().anno}|1` }]);
    await app.close();
  });

  it('senza il campo "Chiave documento" il flusso si ferma prima di creare la task', () => {
    const cn = { _nr: { nextNrProforma: 1, chiave: 'proforma|2026|1' } };
    expect(() => esegui(js('proforma'), { 'calc-nr': [cn] }, [{ custom_fields: [{ id: 'f-nr', name: 'nr-proforma' }] }])).toThrow(/Chiave documento/);
  });

  it('calc-nr senza numero dal servizio: errore, mai un numero calcolato in casa', () => {
    expect(() => esegui(js('calc-nr'), { 'Riserva numero (servizio)': [{ statusCode: 503, body: '' }] })).toThrow(/numero non ricevuto/);
  });

  it('errori: dati sbagliati -> avviso e spunta tolta; servizio giù -> avviso al massimo ogni 30 minuti', () => {
    const base = { 'Code in JavaScript': [pack], 'Busta per il servizio': [{ errori: [] }] };
    const [{ json: e1 }] = esegui(js('Errore numero'), base, [{ statusCode: 400, body: { errore: 'cliente: serve nome o ragione_sociale' } }]);
    expect(e1).toMatchObject({ dati: true });
    expect(e1.testo).toMatch(/cliente: serve nome/);
    const sd = {};
    expect(esegui(js('Errore numero'), base, [{ statusCode: 503, body: '' }], sd)).toHaveLength(1);
    expect(esegui(js('Errore numero'), base, [{ statusCode: 503, body: '' }], sd)).toHaveLength(0);
  });

  it('totale zero o Business sconosciuto: errore locale, il servizio rifiuta senza consumare numeri', async () => {
    const [{ json: b }] = esegui(js('Busta per il servizio'), { 'Code in JavaScript': [{ ...pack, billing: {}, project: { ...pack.project, businessLabel: 'Marchio nuovo' } }], 'Get a task': [contatto] });
    expect(b.errori).toHaveLength(2);
    const { app } = await costruisci({ pool });
    expect((await app.inject({ method: 'POST', url: '/v1/documenti', headers: AUTH.n8n, payload: b.busta })).statusCode).toBe(400);
    expect((await admin.query('SELECT count(*)::int AS n FROM contatori')).rows[0].n).toBe(0);
    await app.close();
  });
});
