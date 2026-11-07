// Genera n8n/fatture-da-clickup.json (da importare in n8n) a partire da prepara-busta.js.
// Uso: node n8n/genera-workflow.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const logica = readFileSync(new URL('prepara-busta.js', dir), 'utf8');

// Tutto ciò che si adatta senza toccare la logica. I nomi dei campi si confrontano senza maiuscole, accenti e spazi.
const CONFIG = {
  // Liste dei progetti da controllare (spazio "Studio 3D & Render" > Progetti attivi) [DA CONFERMARE con la ricognizione-3]
  liste: ['901517931489', '901521040352'],
  // Attività di ogni lista progetti (risposta di Elia nel Centro Fatturazione: gazzolaelia.it).
  // Se il progetto ha il menu "Business" compilato vale quello (nome a dominio, o tramite aliasBusiness).
  businessPerLista: { '901517931489': 'gazzolaelia.it', '901521040352': 'gazzolaelia.it' },
  // Opzioni del menu "Business" che non sono un dominio [DA CONFERMARE].
  aliasBusiness: { 'studio digitale di elia gazzola': 'gazzolaelia.it' },
  campi: {
    emetti: ['Emetti documento'],
    importo: ['Importo documento'],
    cliente: ['Cliente', 'cliente-rif', 'Cliente rif'],
    rata: ['Rata'],
    versione: ['Versione documento'],
    descrizione: ['Descrizione documento'],
    attivita: ['Business'], // NON "AREA": AREA è il settore del cliente (Edilizia, Carpenteria, ...)
    segnaProforma: ['pf-creata'], // spuntato quando la proforma è riservata (come faceva il flusso precedente)
    segnaFattura: ['# fattura'], // scritto "n/anno" quando la fattura è riservata
  },
  campiCliente: {
    ragione_sociale: ['Azienda', 'Ragione sociale', 'ragione'],
    nome: ['nome'],
    cognome: ['Cognome'],
    email: ['email lavoro', 'Email', 'E-mail', 'emailcliente', 'Mail'],
    pec: ['PEC'],
    telefono: ['telefono', 'cellulare'],
    partita_iva: ['Partita IVA', 'P.IVA', 'PIVA', 'P IVA'],
    codice_fiscale: ['C.F.', 'Codice fiscale', 'CF'],
    codice_destinatario: ['Codice destinatario', 'SDI', 'Codice SDI'],
    indirizzo_unico: ['Indirizzo'], // nei contatti è un solo campo: "Via Roma 1, 20100 Milano (MI)"
    via: ['Via'],
    cap: ['CAP'],
    citta: ['Città', 'Comune'],
    provincia: ['Provincia', 'Prov'],
    paese: ['Paese', 'Nazione'],
  },
  // Campo relationship "progetto-rif" nella lista "proforme e fatture": collega la task del documento al progetto.
  campoProgettoDocumenti: 'ce95ab64-a43b-4a75-bc93-ec8a4cbb8410',
};

const URL_SERVIZIO = 'http://fatturazione-core.platform.svc.cluster.local:8080/v1/documenti';
const CU = 'https://api.clickup.com/api/v2';
const credCU = { httpHeaderAuth: { name: 'ClickUp (token)' } };
const credFC = { httpHeaderAuth: { name: 'fatturazione-core' } };
const code = (js, mode = 'runOnceForAllItems') => ({ mode, language: 'javaScript', jsCode: `${logica}\n// ---- nodo\n${js}` });
const http = (method, url, extra = {}) => ({ method, url, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { timeout: 20000 }, ...extra });
const se = (espr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
    conditions: [{ id: 'c1', leftValue: espr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});

let x = 0;
const nodo = (name, type, typeVersion, parameters, more = {}) => ({ id: `fc-${++x}`, name, type, typeVersion, position: [x * 220, 300], parameters, ...more });

const nodes = [
  nodo('Ogni 2 minuti', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } }),
  nodo('Configurazione', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `return [{ json: ${JSON.stringify(CONFIG, null, 2)} }];` }),
  nodo('Liste progetti', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `return $('Configurazione').first().json.liste.map((lista) => ({ json: { lista } }));` }),
  nodo('Task dei progetti', 'n8n-nodes-base.httpRequest', 4.2, http('GET', `=${CU}/list/{{ $json.lista }}/task?include_closed=false&subtasks=true&page=0`), { credentials: credCU }),
  nodo('Da emettere', 'n8n-nodes-base.code', 2, code(`const C = $('Configurazione').first().json;
const out = [];
for (const it of $input.all()) for (const t of it.json.tasks ?? []) { const s = daEmettere(t, C); if (s) out.push({ json: s }); }
return out;`)),
  nodo('Dati completi?', 'n8n-nodes-base.if', 2, se('={{ $json.ok }}')),
  nodo('Contatto cliente', 'n8n-nodes-base.httpRequest', 4.2, http('GET', `=${CU}/task/{{ $json.cliente_id }}`), { credentials: credCU }),
  nodo('Busta', 'n8n-nodes-base.code', 2, code(`const C = $('Configurazione').first().json;
const sel = $('Dati completi?').item.json;
return { json: { sel, busta: costruisciBusta(sel, $json, C) } };`, 'runOnceForEachItem')),
  nodo('Invia al servizio', 'n8n-nodes-base.httpRequest', 4.2, http('POST', URL_SERVIZIO, {
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.busta) }}',
    options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true } } },
  }), { credentials: credFC, onError: 'continueRegularOutput' }),
  nodo('Esito', 'n8n-nodes-base.code', 2, code(`const sel = $('Busta').item.json.sel;
const r = esitoRisposta($json.statusCode, $json.body, sel);
return { json: { ...r, task_id: sel.task_id, campo_emetti_id: sel.campo_emetti_id } };`, 'runOnceForEachItem')),
  nodo('Segna sul progetto', 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `return $input.all().flatMap((it) => (it.json.segna ?? []).map((s) => ({ json: { task_id: it.json.task_id, field_id: s.field_id, value: s.value } })));` }),
  nodo('Scrivi campo progetto', 'n8n-nodes-base.httpRequest', 4.2, http('POST', `=${CU}/task/{{ $json.task_id }}/field/{{ $json.field_id }}`, {
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ value: $json.value }) }}',
  }), { credentials: credCU }),
  nodo('Esito dati', 'n8n-nodes-base.code', 2, code(`return { json: { azione: 'errore', commento: '❌ Nessun numero assegnato: ' + $json.errore, pulisci: true, task_id: $json.task_id, campo_emetti_id: $json.campo_emetti_id } };`, 'runOnceForEachItem')),
  nodo('Da commentare?', 'n8n-nodes-base.if', 2, se('={{ !!$json.commento }}')),
  nodo('Commenta la task', 'n8n-nodes-base.httpRequest', 4.2, http('POST', `=${CU}/task/{{ $json.task_id }}/comment`, {
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ comment_text: $json.commento, notify_all: false }) }}',
  }), { credentials: credCU }),
  nodo('Svuotare il campo?', 'n8n-nodes-base.if', 2, se(`={{ $('Da commentare?').item.json.pulisci && !!$('Da commentare?').item.json.campo_emetti_id }}`)),
  nodo('Svuota "Emetti documento"', 'n8n-nodes-base.httpRequest', 4.2,
    http('DELETE', `=${CU}/task/{{ $('Da commentare?').item.json.task_id }}/field/{{ $('Da commentare?').item.json.campo_emetti_id }}`), { credentials: credCU }),
];

const vai = (to, index = 0) => ({ node: to, type: 'main', index });
const connections = {
  'Ogni 2 minuti': { main: [[vai('Configurazione')]] },
  Configurazione: { main: [[vai('Liste progetti')]] },
  'Liste progetti': { main: [[vai('Task dei progetti')]] },
  'Task dei progetti': { main: [[vai('Da emettere')]] },
  'Da emettere': { main: [[vai('Dati completi?')]] },
  'Dati completi?': { main: [[vai('Contatto cliente')], [vai('Esito dati')]] },
  'Contatto cliente': { main: [[vai('Busta')]] },
  Busta: { main: [[vai('Invia al servizio')]] },
  'Invia al servizio': { main: [[vai('Esito')]] },
  Esito: { main: [[vai('Da commentare?'), vai('Segna sul progetto')]] },
  'Segna sul progetto': { main: [[vai('Scrivi campo progetto')]] },
  'Esito dati': { main: [[vai('Da commentare?')]] },
  'Da commentare?': { main: [[vai('Commenta la task')], []] },
  'Commenta la task': { main: [[vai('Svuotare il campo?')]] },
  'Svuotare il campo?': { main: [[vai('Svuota "Emetti documento"')], []] },
};

const wf = {
  name: 'Fatture da ClickUp → fatturazione-core',
  nodes,
  connections,
  settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', timezone: 'Europe/Rome' },
  active: false,
  pinData: {},
};
writeFileSync(new URL('fatture-da-clickup.json', dir), `${JSON.stringify(wf, null, 2)}\n`);
console.log(`scritto n8n/fatture-da-clickup.json (${nodes.length} nodi)`);
