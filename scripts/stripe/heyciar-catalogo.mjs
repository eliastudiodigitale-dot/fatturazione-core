#!/usr/bin/env node
// Crea su Stripe (account heyciar.it) i prodotti e i prezzi del catalogo di heyciar. Lo lancia ELIA dal Mac.
//   node scripts/stripe/heyciar-catalogo.mjs          -> PROVA: legge Stripe e mostra cosa farebbe, non crea nulla
//   node scripts/stripe/heyciar-catalogo.mjs crea     -> chiede conferma (SI) e crea/aggiorna
// Fonte: il catalogo del repo heyciar (scripts/stripe-prodotti.mjs), così niente si ricopia a mano.
// Regole fisse (decisione #40): niente IVA, tax_behavior "inclusive" anche se il catalogo dice altro.
// Idempotente: prodotto con id fisso "heyciar_<chiave>", prezzo riconosciuto dal lookup_key. Rilanciarlo non crea doppioni.
// Un importo non si modifica su Stripe: se cambia, si crea un prezzo nuovo, gli si sposta il lookup_key e il vecchio si archivia.
// Chiave: quella del servizio letta dal Secret sul VPS (mai mostrata); serve Products e Prices in SCRITTURA per "crea".
// Per test: STRIPE_API_BASE (server finto), CHIAVE_STRIPE_TEST (salta il VPS), CATALOGO_JSON (file al posto del generatore).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const MODO = process.argv[2] ?? 'prova';
if (!['prova', 'crea'].includes(MODO)) { console.error('uso: heyciar-catalogo.mjs [prova|crea]'); process.exit(1); }
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOGO_DIR = process.env.CATALOGO_DIR ?? '/Users/elia/offline/REPO-locali/SH-saas/progetto001-accessi/catalogo';
const BASE = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com';
const VERSIONE = '2026-10-28.endive';
const TAX_BEHAVIOR = 'inclusive';   // decisione #40
const TAX_CODE = 'txcd_10000000';  // servizi digitali, come sugli altri account
const BUSINESS = 'heyciar.it';

// Account heyciar.it dalla configurazione del servizio
const conf = readFileSync(join(REPO, 'k8s', 'app.yaml'), 'utf8');
const ACCOUNT = conf.match(/(acct_[A-Za-z0-9]+)=heyciar\.it/)?.[1];
if (!ACCOUNT) { console.error('account heyciar.it non trovato in STRIPE_BUSINESS_PER_ACCOUNT (k8s/app.yaml)'); process.exit(1); }

// Catalogo
const catalogo = JSON.parse(process.env.CATALOGO_JSON
  ? readFileSync(process.env.CATALOGO_JSON, 'utf8')
  : execFileSync(process.execPath, [join(CATALOGO_DIR, 'scripts', 'stripe-prodotti.mjs')], { cwd: CATALOGO_DIR, encoding: 'utf8' }));
if (catalogo.regole?.valuta !== 'eur') { console.error('valuta del catalogo non eur: mi fermo'); process.exit(1); }

// Chiave
let KEY = process.env.CHIAVE_STRIPE_TEST;
if (!KEY) {
  console.log('Leggo la chiave Stripe del servizio dal VPS (non viene mostrata)...');
  KEY = execFileSync('ssh', ['vps-se', "kubectl -n platform get secret fatturazione-api-secrets -o jsonpath='{.data.STRIPE_API_KEY}' | base64 -d"], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
}
if (!/^(sk|rk)_(org_)?(live|test)_/.test(KEY)) { console.error('chiave non valida'); process.exit(1); }

function forma(obj, pre = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const nome = pre ? `${pre}[${k}]` : k;
    if (typeof v === 'object') forma(v, nome, out); else out.append(nome, String(v));
  }
  return out;
}
async function api(metodo, percorso, dati, idem) {
  const h = { Authorization: `Bearer ${KEY}`, 'Stripe-Version': VERSIONE, 'Stripe-Context': ACCOUNT };
  let url = `${BASE}/v1${percorso}`, body;
  if (metodo === 'GET' && dati) url += `?${forma(dati)}`;
  if (metodo === 'POST') { body = forma(dati ?? {}); h['Content-Type'] = 'application/x-www-form-urlencoded'; if (idem) h['Idempotency-Key'] = idem; }
  const r = await fetch(url, { method: metodo, headers: h, body });
  const j = await r.json();
  if (r.status === 404 && metodo === 'GET') return null;
  if (!r.ok) throw new Error(`Stripe ${metodo} ${percorso}: ${j.error?.message ?? r.status}`);
  return j;
}

const piano = []; // { cosa, fai: async () => {} }
const metaProdotto = (p) => ({ ...p.metadata, catalogo_chiave: p.chiave, business: BUSINESS });
const uguali = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

try {
  console.log(`Account heyciar.it: ${ACCOUNT}   Modo: ${MODO === 'crea' ? 'CREA' : 'PROVA (non cambia nulla)'}`);
  if (catalogo.regole?.tax_behavior && catalogo.regole.tax_behavior !== TAX_BEHAVIOR)
    console.log(`Nota: il catalogo dice tax_behavior "${catalogo.regole.tax_behavior}", uso "${TAX_BEHAVIOR}" (decisione #40).`);

  for (const p of catalogo.prodotti) {
    const id = `heyciar_${p.chiave}`;
    const voluto = { name: p.nome, description: p.descrizione, tax_code: TAX_CODE, metadata: metaProdotto(p) };
    const c = await api('GET', `/products/${id}`);
    if (!c) piano.push({ cosa: `+ prodotto ${id}  "${p.nome}"`, fai: () => api('POST', '/products', { id, ...voluto }, `heyciar-prod-${id}`) });
    else {
      const diff = c.name !== voluto.name || (c.description ?? '') !== voluto.description || c.tax_code !== TAX_CODE || !c.active
        || !uguali(Object.fromEntries(Object.entries(c.metadata ?? {}).filter(([k]) => k in voluto.metadata)), voluto.metadata);
      if (diff) piano.push({ cosa: `~ prodotto ${id}  aggiorno nome/descrizione/metadati`, fai: () => api('POST', `/products/${id}`, { ...voluto, active: true }) });
      else console.log(`= prodotto ${id}  già a posto`);
    }
    for (const pr of p.prezzi) {
      const voluto = {
        product: id, currency: 'eur', unit_amount: pr.importo, lookup_key: pr.lookup_key, nickname: pr.nickname,
        tax_behavior: TAX_BEHAVIOR, metadata: { ...(pr.metadata ?? {}), quantita: pr.quantita, business: BUSINESS },
        recurring: pr.ricorrenza ? { interval: pr.ricorrenza.interval, interval_count: pr.ricorrenza.interval_count ?? 1 } : undefined,
      };
      const euro = (pr.importo / 100).toFixed(2).replace('.', ',') + ' €' + (pr.ricorrenza ? `/${pr.ricorrenza.interval === 'month' ? 'mese' : pr.ricorrenza.interval}` : ' una tantum');
      const ex = (await api('GET', '/prices', { 'lookup_keys[]': pr.lookup_key, active: 'true', limit: 1 })).data[0];
      const idem = `heyciar-price-${pr.lookup_key}-${pr.importo}-${TAX_BEHAVIOR}-${pr.ricorrenza?.interval ?? 'una'}`;
      if (!ex) { piano.push({ cosa: `+ prezzo  ${pr.lookup_key}  ${euro}`, fai: () => api('POST', '/prices', voluto, idem) }); continue; }
      const stessoPrezzo = ex.unit_amount === pr.importo && ex.currency === 'eur' && ex.tax_behavior === TAX_BEHAVIOR
        && (ex.product?.id ?? ex.product) === id
        && (ex.recurring?.interval ?? null) === (pr.ricorrenza?.interval ?? null)
        && (ex.recurring?.interval_count ?? null) === (pr.ricorrenza ? (pr.ricorrenza.interval_count ?? 1) : null);
      if (stessoPrezzo) {
        if (ex.nickname !== pr.nickname) piano.push({ cosa: `~ prezzo  ${pr.lookup_key}  aggiorno il nome`, fai: () => api('POST', `/prices/${ex.id}`, { nickname: pr.nickname, metadata: voluto.metadata }) });
        else console.log(`= prezzo  ${pr.lookup_key}  già a posto (${euro})`);
        continue;
      }
      piano.push({
        cosa: `! prezzo  ${pr.lookup_key}  CAMBIA: ${ex.unit_amount / 100} € ${ex.tax_behavior} -> ${euro} ${TAX_BEHAVIOR} (nuovo prezzo, il vecchio ${ex.id} si archivia; gli abbonamenti esistenti restano sul vecchio)`,
        fai: async () => { await api('POST', '/prices', { ...voluto, transfer_lookup_key: true }, `${idem}-da-${ex.id}`); await api('POST', `/prices/${ex.id}`, { active: false }); },
      });
    }
  }

  // Prodotti attivi su Stripe che non sono nel catalogo (es. del modello vecchio): solo segnalati, mai toccati
  const nostri = new Set(catalogo.prodotti.map((p) => `heyciar_${p.chiave}`));
  const altri = []; let dopo;
  do {
    const r = await api('GET', '/products', { active: 'true', limit: 100, starting_after: dopo });
    altri.push(...r.data.filter((x) => !nostri.has(x.id)));
    dopo = r.has_more ? r.data.at(-1).id : undefined;
  } while (dopo);
  if (altri.length) { console.log(`\nProdotti attivi su Stripe FUORI dal catalogo (non li tocco): ${altri.length}`); for (const x of altri) console.log(`  ${x.id}  "${x.name}"`); }

  console.log(`\n== Da fare: ${piano.length}`);
  for (const x of piano) console.log(`  ${x.cosa}`);
  if (!piano.length) { console.log('Tutto già a posto: nulla da fare.'); process.exit(0); }
  if (MODO !== 'crea') { console.log('\nSolo PROVA: nulla è stato creato. Per creare: node scripts/stripe/heyciar-catalogo.mjs crea'); process.exit(0); }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(`\nCreo/aggiorno queste ${piano.length} voci su Stripe (account ${ACCOUNT}, LIVE se la chiave è live)? Scrivi SI: `);
  rl.close();
  if (r.trim() !== 'SI') { console.log('annullato: nulla è stato cambiato'); process.exit(0); }
  for (const x of piano) { await x.fai(); console.log(`  fatto: ${x.cosa}`); }
  console.log('\nFatto. Rilancia senza "crea" per controllare: deve dire "Tutto già a posto".');
} catch (e) {
  const m = String(e.message);
  console.error(`\nERRORE: ${m}`);
  if (/permission/i.test(m)) console.error('Manca un permesso sulla chiave: per la PROVA serve Products e Prices in Lettura, per "crea" in Scrittura.');
  process.exit(1);
} finally { KEY = undefined; }
