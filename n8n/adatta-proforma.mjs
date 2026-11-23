// Trasforma il flusso n8n "auto_pro-forma (from clickup) +subtasks" di Elia nella versione che prende il numero
// dal servizio fatturazione-core. Tocca la numerazione; PDF, approvazione Telegram, note ed email restano identici.
// Decisione #44: il numero si prende DOPO l'OK. Prima dell'OK si manda una BOZZA del PDF senza numero.
//
//   node n8n/adatta-proforma.mjs ~/n8n-auto-proforma.json      -> n8n/auto-proforma-servizio.json (da importare, spento)
//
// Percorso nuovo:
//  Get a task -> [Busta per il servizio] -> [Dati ok?] -> calc-nr bozza -> Build HTML bozza -> Convert to File bozza ->
//  Gotenberg bozza -> Code in JavaScript3 bozza -> Send a document (BOZZA) -> spunta tolta -> approvazione -> If
//   - NO / tempo scaduto: solo l'avviso, nessun numero consumato
//   - OK: [Riserva numero (servizio)] -> [Numero ok?] -> calc-nr -> Build HTML -> Convert to File -> Gotenberg ->
//         Code in JavaScript3 -> If1 (email) -> ... (i nodi originali, con il numero vero)
// Modifiche:
//  1. calc-nr (versione definitiva) non calcola: riporta il numero del servizio nello stesso formato (_nr)
//  2. "proforma" aggiunge il campo "Chiave documento" (e si ferma se il campo non esiste: mai task senza chiave)
//  3. "Create a task" -> anche [Conferma al servizio] (stato creato + id della task)
//  4. Dati sbagliati (totale, business, email del cliente mancante) PRIMA della bozza: avviso e spunta tolta, nessun numero
//  5. Errore del servizio dopo l'OK: avviso e spunta tolta (premi di nuovo inviapf); email mancante dopo la riserva (non
//     dovrebbe più succedere) -> [Annulla proforma (email)]
import { readFileSync, writeFileSync } from 'node:fs';

const SERVIZIO = 'http://fatturazione-core.platform.svc.cluster.local:8080/v1/documenti';
const CRED_FC = { httpHeaderAuth: { name: 'fatturazione-core' } };
const logica = readFileSync(new URL('prepara-busta.js', import.meta.url), 'utf8');

export const CONFIG_BUSTA = {
  businessPredefinito: 'gazzolaelia.it', // risposta di Elia per "3d e Rendering"
  aliasBusiness: { 'studio digitale di elia gazzola': 'gazzolaelia.it' }, // [DA CONFERMARE]
  campoProgettoDocumenti: 'ce95ab64-a43b-4a75-bc93-ec8a4cbb8410', // progetto-rif in "proforme e fatture"
  campiCliente: {
    ragione_sociale: ['Azienda'], nome: ['nome'], cognome: ['Cognome'], email: ['email lavoro', 'email'], pec: ['pec'],
    telefono: ['cellulare', 'telefono'], partita_iva: ['P.iva'], codice_fiscale: ['C.F.'], codice_destinatario: ['sdi'],
    indirizzo_unico: ['Indirizzo'], via: [], cap: [], citta: [], provincia: [], paese: [],
  },
};

const JS_BUSTA = `${logica}
// ---- nodo "Busta per il servizio": stessi dati e stesso totale di Build HTML
const C = ${JSON.stringify(CONFIG_BUSTA)};
const pack = $('Code in JavaScript').first().json;
const contatto = $('Get a task').first().json;
const b = pack.billing || {};
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const valorePf = n(b.valoreProforma);
const totale = valorePf > 0 ? valorePf : Math.max(0, n(b.firmatoPer) + n(b.extra) + n(b.spese) - Math.max(0, n(b.scontoApplicato ?? b.sconto)));
const etichetta = pack.project?.businessLabel ? String(pack.project.businessLabel).trim() : '';
const alias = etichetta ? C.aliasBusiness[etichetta.toLowerCase()] : undefined;
const business = etichetta ? (alias ?? (/^[a-z0-9.-]+\\.[a-z]{2,}$/i.test(etichetta) ? etichetta.toLowerCase() : null)) : C.businessPredefinito;
const cliente = clienteDaContatto(contatto, C);
const errori = [];
if (!(totale > 0)) errori.push('totale della proforma zero: controlla "Firmato per" / extra / spese');
if (!cliente.email) errori.push('email del cliente mancante (campo "email lavoro"): la proforma non si può inviare');
if (!business) errori.push('Business "' + etichetta + '" non riconosciuto');
if (!pack.project?.taskId) errori.push('progetto senza id');
const busta = {
  fonte: 'clickup',
  ref: pack.project.taskId + '|proforma|unica',
  auto_versione: true,
  tipo: 'proforma',
  business,
  cliente,
  righe: [{ descrizione: String(pack.project.name || 'Prestazione').slice(0, 1000), importo: Math.round(totale * 100) / 100 }],
  dati_fonte: { clickup: {
    task_progetto_id: pack.project.taskId,
    campo_relationship_id: C.campoProgettoDocumenti,
    nome_progetto: String(pack.project.name || '').slice(0, 200) || undefined,
    cliente_task_id: pack.client?.contactTaskId || undefined,
  } },
};
return [{ json: { busta, errori } }];`;

const JS_CALC_NR = `// calc-nr (versione servizio): il numero NON si calcola più qui. Lo assegna fatturazione-core
// (contatore unico, mai riusato, anche per le proforme annullate). Stesso formato _nr di prima.
const r = $('Riserva numero (servizio)').first().json;
let d = r.body;
if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
if (r.statusCode !== 200 || !d || !(d.numero > 0)) throw new Error('numero non ricevuto dal servizio: ' + (r.statusCode ?? 'rete'));
const clientItems = $items('Get a task') || [];
const clientTask = (clientItems[0] && clientItems[0].json) ? clientItems[0].json : {};
return [{ json: { ...clientTask, _nr: {
  currentYear: d.anno,
  nextNrProforma: d.numero,
  proformaLabel: String(d.numero).padStart(2, '0') + '/' + d.anno,
  ref: d.ref,
  chiave: 'proforma|' + d.anno + '|' + d.numero,
  avvisi: d.avvisi || [],
} } }];`;

const JS_CALC_NR_BOZZA = `// calc-nr (BOZZA, decisione #44): nessun numero e nessuna chiamata al servizio. Stesso formato _nr, con bozza: true.
const clientItems = $items('Get a task') || [];
const clientTask = (clientItems[0] && clientItems[0].json) ? clientItems[0].json : {};
return [{ json: { ...clientTask, _nr: {
  currentYear: new Date().getFullYear(),
  nextNrProforma: 0,
  proformaLabel: 'BOZZA',
  chiave: null,
  bozza: true,
  avvisi: [],
} } }];`;

const JS_CHIAVE = `
// ---- (servizio) Chiave documento: serve al servizio per riconoscere questa task e non crearne un doppione
const idChiave = getCustomFieldId('Chiave documento');
let chiaveDoc = null;
try { chiaveDoc = $items('calc-nr')[0].json._nr.chiave; } catch (e) { chiaveDoc = null; }
if (!idChiave) throw new Error('Campo "Chiave documento" non trovato nella lista "proforme e fatture": crealo prima di usare il flusso');
if (!chiaveDoc) throw new Error('chiave del documento mancante da calc-nr');
cfArray.push({ id: idChiave, value: chiaveDoc });
`;

const JS_ERRORE = `const r = $input.first().json; // modalità "una volta per tutti": niente $json
const d = typeof r.body === 'string' ? (() => { try { return JSON.parse(r.body); } catch { return {}; } })() : (r.body || {});
const pack = $('Code in JavaScript').first().json;
const errLocali = $('Busta per il servizio').first().json.errori || [];
const motivo = errLocali.length ? errLocali.join('; ')
  : !r.statusCode ? 'il servizio fatturazione-core non risponde (non ancora online o fermo). Nessun PDF inviato'
  : r.statusCode === 503 ? 'il servizio è in modalità bloccata (controllo dei numeri non superato). Nessun PDF inviato'
  : ((d.errore || ('risposta ' + r.statusCode)) + (d.dettaglio ? ' (' + String(d.dettaglio).slice(0, 300) + ')' : ''));
// Il numero si prende dopo l'OK, quando la spunta è già tolta: non c'è un giro successivo da solo. Si riprova con inviapf.
return [{ json: { dati: true, testo: '❌ Proforma NON numerata per ' + pack.project.name + ': ' + motivo + '\\nNessun numero consumato. Correggi e premi di nuovo inviapf.' } }];`;

export function adatta(wf) {
  const out = structuredClone(Array.isArray(wf) ? wf[0] : wf);
  delete out.id;
  delete out.pinData;
  delete out.staticData;
  delete out.versionId;
  // metadati dell'istanza: all'import n8n li ricrea per il workflow nuovo
  for (const k of ['createdAt', 'updatedAt', 'isArchived', 'shared', 'triggerCount', 'activeVersionId', 'activeVersion', 'parentFolder']) delete out[k];
  out.name = 'auto_pro-forma (servizio fatturazione)';
  out.active = false;
  const N = Object.fromEntries(out.nodes.map((n) => [n.name, n]));
  const serve = [
    'Get a task', 'calc-nr', 'proforma', 'Create a task', 'If', 'If1', 'Set a custom Field on a task', 'Send a text message2', 'Build HTML',
    'Convert to File', 'Gotenberg → PDF', 'Code in JavaScript3', 'Send a document', 'Send message and wait for response1', 'Send a text message3',
  ];
  for (const s of serve) if (!N[s]) throw new Error(`nodo atteso non trovato nel flusso: ${s}`);
  if (!N.proforma.parameters.jsCode.includes('return [')) throw new Error('nodo "proforma" diverso dal previsto');

  const pos = (base, dx, dy) => [(base.position?.[0] ?? 0) + dx, (base.position?.[1] ?? 0) + dy];
  const http = (name, base, dx, dy, url, body) => ({
    id: `fc-${name.replace(/\W+/g, '-').toLowerCase()}`, name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: pos(base, dx, dy),
    credentials: CRED_FC, onError: 'continueRegularOutput',
    parameters: {
      method: 'POST', url, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: body,
      options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true } } },
    },
  });
  const code = (name, base, dx, dy, jsCode) => ({ id: `fc-${name.replace(/\W+/g, '-').toLowerCase()}`, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(base, dx, dy), parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode } });
  const se = (name, base, dx, dy, left) => ({
    id: `fc-${name.replace(/\W+/g, '-').toLowerCase()}`, name, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos(base, dx, dy),
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: 'c1', leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
  });
  const ref = `{{ encodeURIComponent($('Riserva numero (servizio)').first().json.body.ref) }}`;
  const tg = N['Send a text message2'];
  const spunta = N['Set a custom Field on a task'];

  // Copie "bozza" dei nodi che producono il PDF: stesso aspetto, senza numero. I nodi originali (con i loro nomi) restano il percorso
  // definitivo, così ogni riferimento per nome dei nodi a valle (proforma, email, ecc.) vede il numero vero.
  const copia = (nome, nuovoNome, dx, dy, jsCode) => {
    const n = structuredClone(N[nome]);
    n.id = `fc-${nuovoNome.replace(/\W+/g, '-').toLowerCase()}`;
    n.name = nuovoNome;
    n.position = pos(N[nome], dx, dy);
    if (jsCode !== undefined) n.parameters.jsCode = jsCode;
    return n;
  };
  const sostituisci = (testo, da, a, dove) => {
    if (!testo.includes(da)) throw new Error(`${dove}: testo atteso non trovato (${da.slice(0, 60)})`);
    return testo.split(da).join(a);
  };
  const jsBuildBozza = (() => {
    let j = N['Build HTML'].parameters.jsCode;
    j = sostituisci(j, 'const proformaN = asNumber(', 'const proformaN = 0 * asNumber(', 'Build HTML');
    j = sostituisci(j, ': (trackId ? `PF-${trackId}` : `PF-${now.getTime()}`);', ": 'BOZZA';", 'Build HTML');
    j = sostituisci(j, 'const invoiceNumber = proformaN > 0 ? proformaLabel : safeStr(billing.invoiceNumber || proformaLabel);', "const invoiceNumber = 'BOZZA';", 'Build HTML');
    return j;
  })();
  const jsRinominaBozza = sostituisci(
    sostituisci(N['Code in JavaScript3'].parameters.jsCode, "$items('calc-nr')", "$items('calc-nr bozza')", 'Code in JavaScript3'),
    "$items('Build HTML')", "$items('Build HTML bozza')", 'Code in JavaScript3');
  const bozza = [
    copia('calc-nr', 'calc-nr bozza', 0, -240, JS_CALC_NR_BOZZA),
    copia('Build HTML', 'Build HTML bozza', 0, -240, jsBuildBozza),
    copia('Convert to File', 'Convert to File bozza', 0, -240),
    copia('Gotenberg → PDF', 'Gotenberg → PDF bozza', 0, -240),
    copia('Code in JavaScript3', 'Code in JavaScript3 bozza', 0, -240, jsRinominaBozza),
  ];
  // A monte dell'approvazione il PDF è la bozza: i nodi originali che lo citano guardano ai nodi "bozza"
  const doc = N['Send a document'].parameters.additionalFields;
  doc.caption = sostituisci(doc.caption, "$('Build HTML')", "$('Build HTML bozza')", 'Send a document');
  N['Send a text message2'].parameters.text = sostituisci(N['Send a text message2'].parameters.text, "$('Build HTML')", "$('Build HTML bozza')", 'Send a text message2');
  N['Send a text message3'].parameters.text = sostituisci(N['Send a text message3'].parameters.text, " per proforma {{ $('Build HTML').first().json.invoiceNumber }}", '', 'Send a text message3');
  const attesa = N['Send message and wait for response1'].parameters;
  attesa.message = `Questa è una BOZZA senza numero: il numero si assegna solo dopo il tuo OK.\n${attesa.message}`;

  const nuovi = [
    ...bozza,
    se('Dati ok?', N['Get a task'], 220, 0, '={{ $json.errori.length === 0 }}'),
    code('Busta per il servizio', N['Get a task'], 0, 220, JS_BUSTA),
    http('Riserva numero (servizio)', N['If'], 220, 0, SERVIZIO, "={{ JSON.stringify($('Busta per il servizio').first().json.busta) }}"),
    se('Numero ok?', N['Get a task'], 440, 220, `={{ $('Busta per il servizio').first().json.errori.length === 0 && $json.statusCode === 200 }}`),
    code('Errore numero', N['Get a task'], 660, 400, JS_ERRORE),
    { ...structuredClone(tg), id: 'fc-avvisa-errore-numero', name: 'Avvisa errore numero', position: pos(N['Get a task'], 880, 400), parameters: { ...structuredClone(tg.parameters), text: '={{ $json.testo }}' } },
    se('Errore di dati?', N['Get a task'], 880, 560, '={{ $json.dati }}'),
    { ...structuredClone(spunta), id: 'fc-togli-spunta-proforma', name: 'Togli spunta proforma', position: pos(N['Get a task'], 1100, 560),
      parameters: { ...structuredClone(spunta.parameters), task: `={{ $('Code in JavaScript').first().json.project.taskId }}`, field: `={{ $('Code in JavaScript').first().json.meta.fieldIds.proformaStatus }}` } },
    http('Conferma al servizio', N['Create a task'], 0, 220, `=${SERVIZIO}/${ref}/stato`, `={{ JSON.stringify({ a_stato: 'creato', clickup_task_id: $('Create a task').first().json.id }) }}`),
    http('Annulla proforma (email)', N.If1, 220, 220, `=${SERVIZIO}/${ref}/annulla`, `={{ JSON.stringify({ motivo: 'Email del cliente mancante: proforma non inviata' }) }}`),
  ];
  for (const n of nuovi) if (N[n.name]) throw new Error(`nodo già presente: ${n.name}`);
  out.nodes.push(...nuovi);

  N['calc-nr'].parameters.jsCode = JS_CALC_NR;
  N.proforma.parameters.jsCode = N.proforma.parameters.jsCode.replace(/\nreturn \[/, `${JS_CHIAVE}\nreturn [`);

  const c = out.connections;
  const vai = (node) => ({ node, type: 'main', index: 0 });
  c['Get a task'] = { main: [[vai('Busta per il servizio')]] }; // prima: -> get proforme (non serve più)
  delete c['get proforme'];
  // prima dell'OK: dati -> bozza (nessun numero)
  c['Busta per il servizio'] = { main: [[vai('Dati ok?')]] };
  c['Dati ok?'] = { main: [[vai('calc-nr bozza')], [vai('Errore numero')]] };
  c['calc-nr bozza'] = { main: [[vai('Build HTML bozza')]] };
  c['Build HTML bozza'] = { main: [[vai('Convert to File bozza')]] };
  c['Convert to File bozza'] = { main: [[vai('Gotenberg → PDF bozza')]] };
  c['Gotenberg → PDF bozza'] = { main: [[vai('Code in JavaScript3 bozza')], [vai('Send a text message3')]] };
  c['Code in JavaScript3 bozza'] = { main: [[vai('Send a document')]] };
  // (Send a document -> spunta tolta -> approvazione -> If: invariati)
  // dopo l'OK: numero -> PDF definitivo -> email. Con NO nessun numero consumato.
  c.If.main[0] = [vai('Riserva numero (servizio)')];
  c['Riserva numero (servizio)'] = { main: [[vai('Numero ok?')]] };
  c['Numero ok?'] = { main: [[vai('calc-nr')], [vai('Errore numero')]] };
  c['Code in JavaScript3'] = { main: [[vai('If1')]] }; // prima: -> Send a document + Merge
  delete c.Merge;
  out.nodes = out.nodes.filter((n) => n.name !== 'Merge');
  c['Errore numero'] = { main: [[vai('Avvisa errore numero'), vai('Errore di dati?')]] };
  c['Errore di dati?'] = { main: [[vai('Togli spunta proforma')], []] };
  c['Create a task'].main[0].push(vai('Conferma al servizio'));
  c.If1.main[1] = [...(c.If1.main[1] ?? []), vai('Annulla proforma (email)')];
  // Nodi morti (rami vecchi non collegati al trigger a tempo): fuori, tranne le note adesive. Elia li ha tolti a mano in n8n.
  const trigger = out.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (trigger) {
    const vivi = new Set();
    const visita = (nome) => {
      if (vivi.has(nome)) return;
      vivi.add(nome);
      for (const uscita of c[nome]?.main ?? []) for (const t of uscita) visita(t.node);
    };
    visita(trigger.name);
    out.nodes = out.nodes.filter((n) => vivi.has(n.name) || n.type === 'n8n-nodes-base.stickyNote');
    for (const k of Object.keys(c)) if (!vivi.has(k)) delete c[k];
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const src = process.argv[2];
  if (!src) throw new Error('uso: node n8n/adatta-proforma.mjs <export del flusso .json>');
  const wf = JSON.parse(readFileSync(src, 'utf8'));
  const out = adatta(wf);
  const dest = new URL('auto-proforma-servizio.json', import.meta.url);
  writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`scritto ${dest.pathname} (${out.nodes.length} nodi, spento)`);
}
