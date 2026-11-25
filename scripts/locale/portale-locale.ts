// Portale operativo in locale, per vederlo e provarlo sul Mac (mai in produzione, mai con dati veri).
//
// Cosa avvia:
//  - il VERO servizio (stesso codice, stesso DB Postgres locale delle migrazioni 001-005) su 127.0.0.1:4381;
//  - un finto backend ticket per heyciar e un finto ClickUp per le schede cliente (in memoria: servono solo per provare i giri);
//  - un accesso locale su http://127.0.0.1:4380/dashboard che inserisce da solo la sessione del ruolo scelto, senza Keycloak.
//    Ascolta solo su 127.0.0.1 ed è solo per prove: in produzione il login è Keycloak.
//
// Uso:  npx tsx scripts/locale/portale-locale.ts [owner|amministrazione|assistenza]
// Prima serve il DB:  bash scripts/locale/avvia-db.sh
import http from 'node:http';
import pg from 'pg';
import { caricaConfig } from '../../src/config.js';
import { creaPool } from '../../src/db.js';
import { firma } from '../../src/dashboard-auth.js';
import { SlaStore } from '../../src/sla.js';
import { giroTicketRemoti } from '../../src/ticket-ops.js';
import type { BackendTicket, MessaggioRemoto, ModificaRemota, TicketRemoto } from '../../src/ticket-backend.js';
import { ClickUpFinto, costruisci } from '../../tests/helpers.js';
import { ENV_TEST } from '../../tests/setup/env.js';

const RUOLO = (process.argv[2] ?? 'owner') as 'owner' | 'amministrazione' | 'assistenza';
if (!['owner', 'amministrazione', 'assistenza'].includes(RUOLO)) throw new Error('ruolo: owner, amministrazione o assistenza');
// Porte insolite apposta: 8080 e 8081 sono spesso occupate da altri server di sviluppo (es. Expo/Metro).
const PORTA_APP = 4381;
const PORTA_PORTALE = 4380;
const PG_PORTA = 55433;
const SEGRETO = 'locale-'.padEnd(40, 'x');
const URL_PORTALE = `http://127.0.0.1:${PORTA_PORTALE}`;

// ------------------------------------------------------------------ configurazione di prova (non sono segreti)
const cfg = caricaConfig({
  ...ENV_TEST,
  PG_HOST: '127.0.0.1',
  PG_PORT: String(PG_PORTA),
  APP_PG_PASS: 'app_locale',
  KEYCLOAK_ISSUER: 'http://localhost:8180/realms/locale',
  KEYCLOAK_CLIENT_ID: 'locale',
  KEYCLOAK_CLIENT_SECRET: 'segreto-locale-non-usato',
  DASHBOARD_SESSION_SECRET: SEGRETO,
  DASHBOARD_URL_BASE: URL_PORTALE,
  TICKET_BACKEND_URL_HEYCIAR: 'http://localhost:9/finto',
  TICKET_BACKEND_TOKEN_HEYCIAR: 'token-backend-locale-'.padEnd(40, 'x'),
});

// ------------------------------------------------------------------ DB e dati di esempio (solo se il DB è vuoto)
const admin = new pg.Pool({ host: '127.0.0.1', port: PG_PORTA, user: 'postgres', password: 'locale', database: 'fatturazione', max: 2 });
const pool = creaPool(cfg.pg);

async function datiDiEsempio() {
  const vuoto = (await admin.query('SELECT count(*)::int AS n FROM crm_clienti')).rows[0].n === 0 && (await admin.query('SELECT count(*)::int AS n FROM documenti')).rows[0].n === 0;
  if (!vuoto) return false;
  await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, partita_iva, telefono, businesses, stato, piano_sla, creato_il) VALUES
    ('c1','Rossi Impianti Srl','info@rossi.it','12345678901','333 1112233','{heyciar.it}','attivo','48h', now() - interval '200 days'),
    ('c2','Verdi Serramenti','verdi@verdi.it','10987654321','347 9998877','{serrandasu.it,reti.gazzolaelia.it}','attivo',NULL, now() - interval '40 days'),
    ('c3','Studio Bianchi','bianchi@studio.it',NULL,NULL,'{reti.gazzolaelia.it}','prospect',NULL, now() - interval '5 days'),
    ('c4','Hotel Aurora','info@hotelaurora.it','11122233344','06 5551234','{reti.gazzolaelia.it}','attivo',NULL, now() - interval '90 days')`);
  const doc = (ref: string, tipo: string, n: number, biz: string, stato: string, cliente: object, importo: number, fonte: string, giorni: number) =>
    admin.query(`INSERT INTO documenti (ref, anno, tipo, numero, fonte, business, stato, payload, data_riserva) VALUES ($1, $7::int, $2, $3, $4, $5, $6, $8, now() - ($9::int * interval '1 day'))`, [
      ref, tipo, n, fonte, biz, stato, new Date().getFullYear(), JSON.stringify({ cliente, righe: [{ descrizione: tipo === 'fattura' ? 'Canone mensile' : 'Proposta', importo }, { descrizione: 'Assistenza', importo: 20 }] }), giorni,
    ]);
  await doc('d1', 'fattura', 1, 'heyciar.it', 'creato', { ragione_sociale: 'Rossi Impianti Srl', email: 'info@rossi.it', partita_iva: '12345678901' }, 120, 'stripe', 40);
  await doc('d2', 'fattura', 2, 'reti.gazzolaelia.it', 'inviato_sdi', { nome: 'Hotel Aurora', email: 'info@hotelaurora.it', partita_iva: '11122233344' }, 300, 'gocardless', 25);
  await doc('d3', 'fattura', 3, 'reti.gazzolaelia.it', 'consegnato', { nome: 'Hotel Aurora', email: 'info@hotelaurora.it', partita_iva: '11122233344' }, 300, 'gocardless', 5);
  await doc('d4', 'proforma', 4, 'serrandasu.it', 'annullato', { nome: 'Verdi Serramenti', email: 'verdi@verdi.it' }, 900, 'clickup', 12);
  await admin.query(`INSERT INTO contatori (anno, tipo, ultimo) VALUES ($1,'fattura',3), ($1,'proforma',4) ON CONFLICT (anno, tipo) DO UPDATE SET ultimo = EXCLUDED.ultimo`, [new Date().getFullYear()]);
  await admin.query(`INSERT INTO ticket (ref, fonte, origine, business, oggetto, testo, stato, priorita, assegnato_a, cliente_nome, cliente_email, cliente_task_id, aperto_il, scade_prima_risposta, scade_risoluzione, categoria) VALUES
    ('serrandasu|1','serrandasu','locale','serrandasu.it','Preventivo serranda 3x2','Buongiorno, mi serve un preventivo per una serranda 3x2.','aperto','urgente',NULL,'Verdi','verdi@verdi.it','c2', now() - interval '30 hours', now() - interval '6 hours', now() + interval '40 hours','preventivo'),
    ('reti|1','reti','locale','reti.gazzolaelia.it','Wifi hotel non si connette','Da stamattina le camere non vedono la rete.','in_attesa_cliente','alta',NULL,'Hotel Aurora','info@hotelaurora.it','c4', now() - interval '1 day', now() + interval '1 hour', now() + interval '2 days','rete')`);
  await admin.query(`INSERT INTO crm_contatti (cliente_task_id, nome, ruolo, email, telefono, principale) VALUES ('c1','Mario Rossi','Titolare','mario@rossi.it','333 1112233', true), ('c4','Giulia Neri','Direttrice','giulia@hotelaurora.it','06 5551234', true)`);
  await admin.query(`INSERT INTO crm_note (cliente_task_id, autore, testo, fissata) VALUES ('c1','demo@locale','Preferisce essere chiamato al mattino', true)`);
  await admin.query(`INSERT INTO crm_attivita (cliente_task_id, business, tipo, titolo, scadenza, assegnato_a, creato_da) VALUES
    ('c1','heyciar.it','chiamata','Richiamare per rinnovo piano', now() - interval '1 day','demo@locale','demo@locale'),
    ('c2','serrandasu.it','email','Inviare preventivo', now() + interval '2 days','demo@locale','demo@locale')`);
  await admin.query(`INSERT INTO crm_opportunita (cliente_task_id, prospect, business, titolo, fase, valore, assegnato_a, creato_da) VALUES
    ('c1',NULL,'heyciar.it','Passaggio al piano 48h','proposta',1200,'demo@locale','demo@locale'),
    (NULL,'Hotel Bellavista','reti.gazzolaelia.it','Wifi per 40 camere','trattativa',4800,'demo@locale','demo@locale'),
    ('c2',NULL,'serrandasu.it','Serranda nuova','nuova',2500,NULL,'demo@locale')`);
  await admin.query(`INSERT INTO crm_opportunita (cliente_task_id, business, titolo, fase, valore, creato_da, aggiornato_il) VALUES ('c4','reti.gazzolaelia.it','Rinnovo contratto assistenza','contattato',1500,'demo@locale', now() - interval '25 days')`);
  await admin.query(`INSERT INTO risposte_rapide (nome, testo, creato_da) VALUES
    ('Presa in carico', 'Buongiorno {{cliente}}, abbiamo preso in carico la sua richiesta ({{rif}}) e le risponderemo appena possibile. {{agente}}', 'demo@locale'),
    ('Richiesta di informazioni', 'Buongiorno {{cliente}}, per procedere ci servirebbero alcune informazioni in più: può indicarci quando si è verificato il problema? {{agente}}', 'demo@locale'),
    ('Chiusura', 'Buongiorno {{cliente}}, la sua richiesta ({{rif}}) risulta risolta. Se serve altro risponda pure a questo messaggio. {{agente}}', 'demo@locale')`);
  await admin.query(`INSERT INTO utenti_dashboard (sub, nome, email, ruoli) VALUES ('anna','Anna Assistenza','anna@locale','{assistenza}'), ('luca','Luca Amministrazione','luca@locale','{amministrazione}')`);
  return true;
}

// ------------------------------------------------------------------ finto backend ticket di heyciar (in memoria)
class BackendDemo implements BackendTicket {
  private seq = 100;
  ticket: TicketRemoto[] = [];
  msg = new Map<string, MessaggioRemoto[]>();
  constructor() {
    const ore = (h: number) => new Date(Date.now() - h * 3600_000);
    this.ticket = [
      { id: '1', oggetto: 'Non riesco ad accedere al portale', stato: 'aperto', priorita: 'alta', categoria: 'accesso', cliente: { nome: 'Rossi Impianti Srl', email: 'info@rossi.it' }, aperto_il: ore(3) },
      { id: '2', oggetto: 'Domanda sulla fattura di ottobre', stato: 'in_lavorazione', priorita: 'normale', categoria: 'fatturazione', cliente: { nome: 'Rossi Impianti Srl', email: 'info@rossi.it' }, assegnato_a: 'anna@locale', aperto_il: ore(50), piano_sla: 'nessuno' },
      { id: '3', oggetto: 'Vorrei passare al piano superiore', stato: 'aperto', priorita: 'bassa', categoria: 'commerciale', cliente: { nome: 'Studio Bianchi', email: 'bianchi@studio.it' }, aperto_il: ore(8) },
    ];
    this.msg.set('1', [{ quando: ore(3), da: 'cliente', autore: 'Mario Rossi', testo: 'Da stamattina non riesco più ad entrare, mi dice password errata.', interno: false }]);
    this.msg.set('2', [
      { quando: ore(50), da: 'cliente', autore: 'Mario Rossi', testo: 'La fattura di ottobre ha un importo diverso da quello concordato.', interno: false },
      { quando: ore(40), da: 'staff', autore: 'anna@locale', testo: 'Ho chiesto conferma all’amministrazione, le faccio sapere.', interno: false },
    ]);
  }
  async elenca() {
    return this.ticket;
  }
  async messaggi(id: string) {
    return this.msg.get(id) ?? [];
  }
  async rispondi(id: string, m: { testo: string; autore: string; interno: boolean }) {
    (this.msg.get(id) ?? this.msg.set(id, []).get(id)!).push({ quando: new Date(), da: 'staff', autore: m.autore, testo: m.testo, interno: m.interno });
    const t = this.ticket.find((x) => x.id === id);
    if (t && !m.interno && !t.prima_risposta_il) t.prima_risposta_il = new Date();
  }
  async aggiorna(id: string, mod: ModificaRemota) {
    const t = this.ticket.find((x) => x.id === id);
    if (!t) return;
    if (mod.stato) {
      t.stato = mod.stato;
      t.risolto_il = mod.stato === 'risolto' || mod.stato === 'chiuso' ? new Date() : undefined;
    }
    if (mod.priorita) t.priorita = mod.priorita;
    if (mod.assegnato_a !== undefined) t.assegnato_a = mod.assegnato_a ?? undefined;
    if (mod.categoria !== undefined) t.categoria = mod.categoria ?? undefined;
  }
  async crea(n: { oggetto: string; testo?: string; priorita?: TicketRemoto['priorita']; categoria?: string; cliente?: TicketRemoto['cliente'] }) {
    const id = String(++this.seq);
    this.ticket.push({ id, oggetto: n.oggetto, stato: 'aperto', priorita: n.priorita ?? 'normale', categoria: n.categoria, cliente: n.cliente, aperto_il: new Date() });
    if (n.testo) this.msg.set(id, [{ quando: new Date(), da: 'cliente', testo: n.testo, interno: false }]);
    return { id };
  }
}

// ------------------------------------------------------------------ avvio
const seminato = await datiDiEsempio();
const backend = new BackendDemo();
const clickup = new ClickUpFinto();
const { app, notif } = await costruisci({
  pool,
  cfg,
  logger: { level: 'info' },
  operativo: { backends: { heyciar: backend }, crm: { api: clickup, cfg: cfg.crm } },
});
await app.listen({ host: '127.0.0.1', port: PORTA_APP });

const depsOps = { pool, cfg, sla: new SlaStore(pool), backends: { heyciar: backend }, notif };
const giro = () => giroTicketRemoti(depsOps, { completa: true }).catch((e: Error) => console.error('sync ticket heyciar:', e.message));
await giro();
setInterval(giro, 20_000).unref();

const business = RUOLO === 'owner' ? null : RUOLO === 'assistenza' ? ['heyciar.it', 'reti.gazzolaelia.it'] : ['heyciar.it', 'reti.gazzolaelia.it', 'serrandasu.it'];
const sessione = () => `dash_sess=${firma({ sub: RUOLO, nome: `Demo ${RUOLO}`, email: `${RUOLO}@locale`, ruoli: [RUOLO], business, exp: Math.floor(Date.now() / 1000) + 8 * 3600 }, SEGRETO)}`;
const proxy = http.createServer((req, res) => {
  const r = http.request({ host: '127.0.0.1', port: PORTA_APP, path: req.url, method: req.method, headers: { ...req.headers, cookie: sessione(), host: `127.0.0.1:${PORTA_APP}`, ...(req.headers.origin ? { origin: URL_PORTALE } : {}) } }, (u) => {
    res.writeHead(u.statusCode ?? 502, u.headers);
    u.pipe(res);
  });
  r.on('error', () => {
    res.writeHead(502);
    res.end('servizio non raggiungibile');
  });
  req.pipe(r);
});
proxy.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `La porta ${PORTA_PORTALE} è già occupata da un altro programma: chiudilo o cambia PORTA_PORTALE in scripts/locale/portale-locale.ts` : e.message);
  process.exit(1);
});
proxy.listen(PORTA_PORTALE, '127.0.0.1', () => {
  console.log('\n──────────────────────────────────────────────');
  console.log(` Portale locale pronto: ${URL_PORTALE}/dashboard`);
  console.log(` Ruolo: ${RUOLO}${business ? ` (attività: ${business.join(', ')})` : ' (tutte le attività)'}`);
  console.log(seminato ? ' Dati di esempio inseriti nel DB locale (prima volta).' : ' DB locale già popolato: dati di prima conservati.');
  console.log(` Servizio: http://127.0.0.1:${PORTA_APP} · Postgres locale: 127.0.0.1:${PG_PORTA}`);
  console.log(' Ctrl+C per fermare. Per un altro ruolo: riavvia con owner, amministrazione o assistenza.');
  console.log('──────────────────────────────────────────────\n');
});

async function ferma() {
  proxy.close();
  await app.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
  await admin.end().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', () => void ferma());
process.on('SIGTERM', () => void ferma());
