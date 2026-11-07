// Logica dei nodi Code del workflow n8n "Fatture da ClickUp". JavaScript puro, senza import:
// genera-workflow.mjs copia queste funzioni dentro i nodi, i test le eseguono così come sono.
// I campi ClickUp si trovano per NOME (configurabile nel nodo "Configurazione"), non per ID.

/* eslint-disable no-unused-vars */
function campoPerNome(task, nomi) {
  const n = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const cercati = nomi.map(n);
  return (task.custom_fields ?? []).find((c) => cercati.includes(n(c.name))) ?? null;
}

/** Valore leggibile di un campo ClickUp: testo, numero, nome dell'opzione per i menu, id per le relazioni. */
function valoreCampo(c) {
  if (!c || c.value === undefined || c.value === null || c.value === '') return null;
  if (c.type === 'drop_down') {
    const ops = c.type_config?.options ?? [];
    const op = ops.find((o) => o.id === c.value || o.orderindex === c.value || String(o.orderindex) === String(c.value));
    return op ? op.name : null;
  }
  if (c.type === 'list_relationship' || c.type === 'tasks') return Array.isArray(c.value) ? c.value.map((t) => t.id) : [];
  if (c.type === 'currency' || c.type === 'number') {
    const v = Number(c.value);
    return Number.isFinite(v) ? v : null;
  }
  if (c.type === 'location') return c.value?.formatted_address ?? null;
  return typeof c.value === 'string' ? c.value.trim() : c.value;
}

const slug = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_-]/g, '');

/**
 * Primo filtro sulla task di progetto. Restituisce null se non va emesso nulla,
 * altrimenti {ok:true, ...} oppure {ok:false, errore} (errore di dati: si commenta la task, nessun numero consumato).
 */
function daEmettere(task, C) {
  const emetti = valoreCampo(campoPerNome(task, C.campi.emetti));
  if (!emetti) return null;
  const tipo = /fatt/i.test(emetti) ? 'fattura' : /pro/i.test(emetti) ? 'proforma' : null;
  const base = { task_id: task.id, task_nome: task.name, campo_emetti_id: campoPerNome(task, C.campi.emetti)?.id ?? null };
  if (!tipo) return { ...base, ok: false, errore: `valore di "${C.campi.emetti[0]}" non riconosciuto: ${emetti}` };
  const importo = valoreCampo(campoPerNome(task, C.campi.importo));
  if (!(importo > 0)) return { ...base, ok: false, errore: `manca "${C.campi.importo[0]}" (importo maggiore di zero)` };
  const clienti = valoreCampo(campoPerNome(task, C.campi.cliente)) ?? [];
  if (clienti.length !== 1) return { ...base, ok: false, errore: `"${C.campi.cliente[0]}" deve collegare esattamente un contatto (ora: ${clienti.length})` };
  const listaId = task.list?.id ?? '';
  const business = C.businessPerLista[listaId] ?? valoreCampo(campoPerNome(task, C.campi.attivita)) ?? null;
  if (!business) return { ...base, ok: false, errore: `attività sconosciuta per la lista ${listaId}: aggiungerla in Configurazione` };
  const rata = slug(valoreCampo(campoPerNome(task, C.campi.rata)) ?? 'unica') || 'unica';
  const versione = valoreCampo(campoPerNome(task, C.campi.versione));
  const descrizione = valoreCampo(campoPerNome(task, C.campi.descrizione)) ?? task.name;
  return { ...base, ok: true, tipo, importo, cliente_id: clienti[0], business: String(business).toLowerCase().trim().replace(/[^a-z0-9._-]/g, ''), rata, versione: Number.isInteger(versione) && versione >= 2 ? versione : null, descrizione, url: task.url ?? null };
}

/** Dati del cliente dalla task del contatto (lista contatti), per nome dei campi. */
function clienteDaContatto(contatto, C) {
  const v = (k) => valoreCampo(campoPerNome(contatto, C.campiCliente[k]));
  const out = {};
  const ragione = v('ragione_sociale');
  if (ragione) out.ragione_sociale = ragione;
  else out.nome = contatto.name;
  const metti = (k, val) => {
    if (val !== null && val !== undefined && val !== '') out[k] = typeof val === 'string' ? val.trim() : val;
  };
  metti('email', v('email'));
  metti('pec', v('pec'));
  metti('telefono', v('telefono'));
  const piva = v('partita_iva');
  if (piva) metti('partita_iva', String(piva).replace(/\s/g, '').replace(/^IT(?=\d{11}$)/i, ''));
  const cf = v('codice_fiscale');
  if (cf) metti('codice_fiscale', String(cf).replace(/\s/g, '').toUpperCase());
  const sdi = v('codice_destinatario');
  if (sdi) metti('codice_destinatario', String(sdi).replace(/\s/g, '').toUpperCase());
  const ind = {};
  for (const k of ['via', 'cap', 'citta', 'provincia', 'paese']) {
    const x = v(k);
    if (x) ind[k] = k === 'provincia' || k === 'paese' ? String(x).trim().toUpperCase() : String(x).trim();
  }
  if (Object.keys(ind).length) out.indirizzo = ind;
  return out;
}

/** Busta per POST /v1/documenti (ref = <task_progetto>|<tipo>|<rata>[|v<versione>], SPEC 4.2). */
function costruisciBusta(sel, contatto, C) {
  const ref = `${sel.task_id}|${sel.tipo}|${sel.rata}${sel.versione ? `|v${sel.versione}` : ''}`;
  const busta = {
    fonte: 'clickup',
    ref,
    tipo: sel.tipo,
    business: sel.business,
    cliente: clienteDaContatto(contatto, C),
    righe: [{ descrizione: String(sel.descrizione).slice(0, 1000), importo: Math.round(sel.importo * 100) / 100 }],
    dati_fonte: { clickup: { task_progetto_id: sel.task_id, campo_relationship_id: C.campoProgettoDocumenti } },
  };
  if (sel.rata !== 'unica') busta.rata = sel.rata;
  if (sel.versione) busta.versione = sel.versione;
  if (sel.url && /^https:\/\//.test(sel.url)) busta.dati_fonte.clickup.url_progetto = sel.url;
  return busta;
}

/** Cosa fare dopo la risposta del servizio. */
function esitoRisposta(status, body, sel) {
  const b = typeof body === 'string' ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : (body ?? {});
  if (status === 200) {
    const etichetta = b.tipo === 'fattura' ? 'Fattura' : 'Proforma';
    const avvisi = (b.avvisi ?? []).length ? `\nDa completare per lo SDI: ${b.avvisi.join('; ')}` : '';
    return { azione: 'fatto', commento: `✅ ${etichetta} ${b.numero}/${b.anno} riservata. La task del documento arriva in "proforme e fatture" entro 2 minuti.${avvisi}`, pulisci: true };
  }
  if (status === 400 || status === 409) {
    let msg = b.errore ?? 'dati non validi';
    if (b.codice === 'ref_annullata') msg = `documento annullato: per rifarlo metti "Versione documento" = 2 (o il numero successivo) e riscegli il tipo`;
    if (b.codice === 'ref_con_dati_diversi') msg = `esiste già ${b.documento?.tipo ?? 'un documento'} ${b.documento?.numero ?? ''}/${b.documento?.anno ?? ''} per questo progetto e rata con dati diversi. Non è stato cambiato nulla: per un documento nuovo usa un'altra rata; per correggere una fattura serve una nota di credito`;
    return { azione: 'errore', commento: `❌ Nessun numero assegnato: ${msg}`, pulisci: true };
  }
  if (status === 401 || status === 403) return { azione: 'errore', commento: '❌ n8n non è autorizzato dal servizio: controllare la credenziale "fatturazione-core"', pulisci: false };
  // 429, 5xx, rete: si riprova al prossimo giro (il campo resta impostato, la ref garantisce lo stesso numero).
  return { azione: 'riprova', commento: null, pulisci: false, task: sel.task_id };
}
