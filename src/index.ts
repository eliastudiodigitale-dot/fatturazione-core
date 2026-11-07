import { caricaConfig, riassuntoConfig } from './config.js';
import { creaPool } from './db.js';
import { Blocco, controlloContatori } from './blocco.js';
import { creaApp } from './app.js';
import { creaEventi, type Elaboratore } from './eventi.js';
import { notificatoreLog } from './notifiche.js';
import { creaStripe, elaboratoreStripe } from './stripe.js';
import { creaGc, elaboratoreGc } from './gocardless.js';
import { creaClickUp } from './clickup.js';
import { FONTI_ESTERNE, FONTI_INTERNE, giroWorker, type DepsWorker } from './worker.js';
import { riconcilia } from './riconciliazione.js';

const cfg = caricaConfig();
const pool = creaPool(cfg.pg);
const blocco = new Blocco(cfg.forzaBlocco);

// Logger provvisorio per costruire le dipendenze; l'app ha il suo (stessa configurazione).
const { default: Fastify } = await import('fastify');
const boot = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } }).log;
const notif = notificatoreLog(boot);

const stripe = cfg.stripe ? creaStripe(cfg.stripe.apiKey, cfg.stripe.webhookSecret) : undefined;
const gc = cfg.gocardless ? creaGc(cfg.gocardless.apiUrl, cfg.gocardless.apiToken) : undefined;
const clickup = cfg.clickup ? creaClickUp({ token: cfg.clickup.token, apiUrl: cfg.clickup.apiUrl, rpm: cfg.clickup.rpm, campoChiave: cfg.clickup.campi.chiave }) : undefined;

const elaboratori: Record<string, Elaboratore> = {};
if (stripe && cfg.pagamentiTipo) elaboratori.stripe = elaboratoreStripe({ pool, api: stripe, tipo: cfg.pagamentiTipo, log: boot });
if (gc && cfg.gocardless && cfg.pagamentiTipo) elaboratori.gocardless = elaboratoreGc({ pool, api: gc, tipo: cfg.pagamentiTipo, trigger: cfg.gocardless.trigger });
const eventi = creaEventi(pool, boot, notif, elaboratori, () => blocco.bloccato);

const app = await creaApp({ cfg, pool, blocco, eventi, stripe });
app.log.info({ config: riassuntoConfig(cfg) }, 'avvio');
if ((cfg.stripe || cfg.gocardless) && !cfg.pagamentiTipo) app.log.warn('PAGAMENTI_TIPO_DOCUMENTO non impostata: webhook di pagamento disattivati');
if (!clickup) app.log.warn('ClickUp non configurato: worker e confronto ClickUp disattivati');

const depsWorker: DepsWorker | undefined = clickup && cfg.clickup ? { pool, api: clickup, cfg: cfg.clickup, log: app.log, notif } : undefined;

async function controllo() {
  try {
    const problemi = await controlloContatori(pool, depsWorker ? { api: depsWorker.api, listId: depsWorker.cfg.listId } : undefined);
    const prima = blocco.bloccato;
    blocco.esito(problemi);
    if (blocco.bloccato) app.log.warn({ motivo: blocco.motivo }, 'modalità bloccata');
    else if (prima) app.log.info('controllo contatori superato: servizio sbloccato');
    for (const p of problemi) notif.anomalia('contatore', { dettaglio: p });
  } catch (e) {
    blocco.esito([`controllo non eseguibile: ${(e as Error).message}`]);
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
  ogni(cfg.worker.interniSec, 'worker interni', async () => !blocco.bloccato && giroWorker(depsWorker, FONTI_INTERNE));
  ogni(cfg.worker.esterniSec, 'worker esterni', async () => !blocco.bloccato && giroWorker(depsWorker, FONTI_ESTERNE));
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
