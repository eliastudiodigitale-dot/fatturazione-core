import { caricaConfig, riassuntoConfig } from './config.js';
import { creaPool } from './db.js';
import { Blocco, controlloContatori } from './blocco.js';
import { creaApp } from './app.js';
import { creaEventi, type Elaboratore } from './eventi.js';
import { creaNotificatore } from './notifiche.js';
import { creaStripe, elaboratoreStripe } from './stripe.js';
import { creaGc, elaboratoreGc } from './gocardless.js';
import { creaClickUp } from './clickup.js';
import { FONTI_ESTERNE, FONTI_INTERNE, giroWorker, type DepsWorker } from './worker.js';
import { riconcilia } from './riconciliazione.js';
import { giroCrm, type DepsCrm } from './sync.js';
import { SlaStore } from './sla.js';
import { creaBackendHttp, type BackendTicket } from './ticket-backend.js';
import { giroTicketRemoti, type DepsOps } from './ticket-ops.js';

const cfg = caricaConfig();
const pool = creaPool(cfg.pg);
const blocco = new Blocco(cfg.forzaBlocco);

// Logger provvisorio per costruire le dipendenze; l'app ha il suo (stessa configurazione).
const { default: Fastify } = await import('fastify');
const boot = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } }).log;
const notif = creaNotificatore(boot, { telegram: cfg.telegram });

const stripe = cfg.stripe ? creaStripe(cfg.stripe.apiKey, cfg.stripe.webhookSecret) : undefined;
const gc = cfg.gocardless ? creaGc(cfg.gocardless.apiUrl, cfg.gocardless.apiToken) : undefined;
const clickup = cfg.clickup ? creaClickUp({ token: cfg.clickup.token, apiUrl: cfg.clickup.apiUrl, rpm: cfg.clickup.rpm, campi: cfg.clickup.campi }) : undefined;

const elaboratori: Record<string, Elaboratore> = {};
if (stripe && cfg.pagamentiTipo) elaboratori.stripe = elaboratoreStripe({ pool, api: stripe, tipo: cfg.pagamentiTipo, log: boot, notif, livemode: cfg.stripe!.livemode, businessPredefinito: cfg.stripe!.businessPredefinito, businessPerAccount: cfg.stripe!.businessPerAccount, chiaveOrganizzazione: cfg.stripe!.chiaveOrganizzazione });
if (gc && cfg.gocardless && cfg.pagamentiTipo) elaboratori.gocardless = elaboratoreGc({ pool, api: gc, tipo: cfg.pagamentiTipo, trigger: cfg.gocardless.trigger, notif, businessPredefinito: cfg.gocardless.businessPredefinito });
const eventi = creaEventi(pool, boot, notif, elaboratori, () => blocco.bloccato);

// CRM e ticket (#45): la sincronizzazione con ClickUp parte solo se ClickUp e almeno una lista sono configurati.
let depsCrm: DepsCrm | undefined;
// Backend ticket dei business (#46): i ticket vivono lì e il portale li richiama via API.
const backends: Record<string, BackendTicket> = {};
for (const [fonte, f] of Object.entries(cfg.ticket.fonti)) if (f.backend) backends[fonte] = creaBackendHttp(f.backend);
const sla = new SlaStore(pool);
const depsOps: DepsOps = { pool, cfg, sla, backends, notif };
const haBackend = Object.keys(backends).length > 0;

async function sincronizza(parte: 'clienti' | 'ticket' | 'tutto', completa: boolean) {
  const out: Record<string, unknown> = {};
  if ((parte === 'clienti' || parte === 'tutto') && depsCrm) {
    const r = await giroCrm(depsCrm);
    if (r === 'occupato') return 'occupato' as const;
    Object.assign(out, r);
  }
  if ((parte === 'ticket' || parte === 'tutto') && haBackend) {
    const r = await giroTicketRemoti(depsOps, { completa });
    if (r === 'occupato') return 'occupato' as const;
    out.backend = r;
  }
  return out;
}

const app = await creaApp({
  cfg, pool, blocco, eventi, stripe, notif, sla,
  sincronizza: cfg.crm || haBackend ? sincronizza : undefined,
  operativo: { backends, crm: clickup && cfg.crm ? { api: clickup, cfg: cfg.crm } : undefined },
});
app.log.info({ config: riassuntoConfig(cfg) }, 'avvio');
if ((cfg.stripe || cfg.gocardless) && !cfg.pagamentiTipo) app.log.warn('PAGAMENTI_TIPO_DOCUMENTO non impostata: webhook di pagamento disattivati');
if (!clickup) app.log.warn('ClickUp non configurato: worker e confronto ClickUp disattivati');
if (clickup && cfg.crm) depsCrm = { pool, api: clickup, cfg: cfg.crm, log: app.log, notif };
if (Object.keys(cfg.ticket.fonti).length === 0) app.log.info('nessuna fonte ticket configurata (TICKET_FONTI): POST /v1/ticket accetta solo n8n e owner');

const depsWorker: DepsWorker | undefined = clickup && cfg.clickup ? { pool, api: clickup, cfg: cfg.clickup, log: app.log, notif } : undefined;

async function controllo() {
  try {
    const problemi = await controlloContatori(pool, depsWorker ? { api: depsWorker.api, listId: depsWorker.cfg.listId } : undefined);
    // Senza ClickUp non si vedono i numeri già usati a mano: mai sbloccare alla cieca.
    if (!depsWorker && !cfg.avvioSenzaClickup) problemi.push('ClickUp non configurato: impossibile confrontare i numeri già usati');
    const prima = blocco.bloccato;
    blocco.esito(problemi);
    if (blocco.bloccato) app.log.warn({ motivo: blocco.motivo }, 'modalità bloccata');
    else if (prima) app.log.info('controllo contatori superato: servizio sbloccato');
    for (const p of problemi) notif.anomalia('contatore', { dettaglio: p });
  } catch (e) {
    blocco.esito([`controllo non eseguibile: ${(e as Error).message}`]);
    notif.anomalia('avvio_bloccato', { motivo: 'controllo contatori non eseguibile (DB o ClickUp non raggiungibili)' });
    app.log.error({ err: (e as Error).message }, 'controllo contatori fallito: resto bloccato');
  }
}

const timer: NodeJS.Timeout[] = [];
function ogni(sec: number, nome: string, fn: () => Promise<unknown>) {
  let inCorso = false;
  timer.push(
    setInterval(() => {
      if (inCorso) return;
      inCorso = true;
      fn()
        .catch((e: Error) => app.log.error({ err: e.message }, `${nome} fallito`))
        .finally(() => (inCorso = false));
    }, sec * 1000),
  );
}

await controllo();
ogni(60, 'controllo', async () => {
  if (blocco.bloccato) await controllo(); // ritenta lo sblocco finché il controllo non passa
});
ogni(300, 'ripresa eventi', () => eventi.riprendi());
if (depsWorker) {
  ogni(cfg.worker.interniSec, 'worker interni', async () => !blocco.bloccato && giroWorker(depsWorker, FONTI_INTERNE, cfg.worker.attesaClickupMin));
  ogni(cfg.worker.esterniSec, 'worker esterni', async () => !blocco.bloccato && giroWorker(depsWorker, FONTI_ESTERNE));
}
if (depsCrm && cfg.crm) {
  // Prima lettura dei clienti poco dopo l'avvio (non blocca l'avvio), poi a intervalli.
  const crm = depsCrm;
  setTimeout(() => void giroCrm(crm).catch((e: Error) => app.log.error({ err: e.message }, 'sync clienti fallita')), 20_000).unref();
  ogni(cfg.crm.syncClientiMin * 60, 'sync clienti', async () => giroCrm(crm));
}
if (haBackend) {
  // Copia dei ticket dei business per filtri, KPI e SLA: prima lettura poco dopo l'avvio, poi ogni TICKET_SYNC_MIN minuti; tutta la lista una volta al giorno.
  let ultimaCompleta = 0;
  const giro = async () => {
    const completa = Date.now() - ultimaCompleta > 24 * 3600_000;
    const r = await giroTicketRemoti(depsOps, { completa });
    if (completa && r !== 'occupato') ultimaCompleta = Date.now();
  };
  setTimeout(() => void giro().catch((e: Error) => app.log.error({ err: e.message }, 'sync ticket dei business fallita')), 15_000).unref();
  ogni(cfg.ticket.syncMin * 60, 'sync ticket dei business', giro);
}
let ultimoGiorno = '';
ogni(60, 'riconciliazione', async () => {
  const ora = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const giorno = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
  if (Number(ora) !== cfg.riconciliazione.oraRoma || giorno === ultimoGiorno) return;
  ultimoGiorno = giorno;
  await riconcilia({
    pool,
    notif,
    log: app.log,
    riservatoMaxOre: cfg.riconciliazione.riservatoMaxOre,
    clickup: depsWorker,
    gc: gc && cfg.gocardless && cfg.pagamentiTipo ? { api: gc, trigger: cfg.gocardless.trigger, tipo: cfg.pagamentiTipo, eventi } : undefined,
  });
});

async function chiudi(segnale: string) {
  app.log.info({ segnale }, 'arresto');
  for (const t of timer) clearInterval(t);
  await app.close().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void chiudi('SIGTERM'));
process.on('SIGINT', () => void chiudi('SIGINT'));

await app.listen({ host: '0.0.0.0', port: cfg.port });
