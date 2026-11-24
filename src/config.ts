// Configurazione solo da variabili d'ambiente. I valori dei segreti non vengono mai loggati.

export type Tipo = 'fattura' | 'proforma';
export type PgSsl = 'disable' | 'require' | 'verify-full';
export type GcTrigger = 'confirmed' | 'paid_out';

export interface Config {
  port: number;
  bodyLimit: number;
  rateLimitPerMin: number;
  forzaBlocco: boolean;
  /** Solo per prove: permette di sbloccare senza confrontare i numeri con ClickUp. In produzione resta false. */
  avvioSenzaClickup: boolean;
  pg: { host: string; port: number; database: string; user: string; password: string; ssl: PgSsl; caFile?: string };
  tokens: { n8n: string; dashboard: string; owner: string };
  pagamentiTipo?: Tipo;
  stripe?: { webhookSecret: string; apiKey: string; livemode: boolean; businessPredefinito?: string; businessPerAccount: Record<string, string>; chiaveOrganizzazione: boolean };
  gocardless?: { webhookSecret: string; apiToken: string; trigger: GcTrigger; apiUrl: string; businessPredefinito?: string };
  telegram?: { token: string; chatId: string };
  clickup?: {
    token: string;
    apiUrl: string;
    rpm: number;
    listId: Record<Tipo, string>;
    campi: CampiClickUp;
  };
  worker: { interniSec: number; esterniSec: number; attesaClickupMin: number };
  /** Ticket in arrivo dalle fonti (un token per fonte, legato a un'attività). Senza fonti non si accettano ticket esterni. */
  ticket: { fonti: Record<string, FonteTicket>; /** Ogni quanti minuti si rileggono i ticket dai backend dei business. */ syncMin: number };
  /** Sincronizzazione CRM e ticket con ClickUp (decisione #45): attiva solo con ClickUp configurato e almeno una lista. */
  crm?: CrmConfig;
  /** Dashboard con login Keycloak: attiva solo con tutte le variabili impostate. */
  dashboard?: DashboardConfig;
  riconciliazione: { oraRoma: number; riservatoMaxOre: number };
}

export interface FonteTicket {
  /** Token che la fonte usa per chiamare questo servizio. */
  token: string;
  business: string;
  /** Backend ticket del business (#46): se c'è, i ticket vivono lì e il portale li richiama via API (contratto in docs/ticket-backend-api.md). */
  backend?: { url: string; token: string };
}
/**
 * Regole SLA lette dal DB (tabelle sla_business e sla_piani), modificabili dal portale (Impostazioni > SLA).
 * Le ore sono di calendario, dall'apertura del ticket.
 */
export interface SlaConfig {
  /** Valori di partenza (riga '*') per le attività senza regole proprie: priorità normale, le altre priorità le scalano. */
  predefinito: { primaRispostaOre: number; risoluzioneOre: number };
  business: Record<string, SlaBusiness>;
}
export interface SlaBusiness {
  /** SLA standard dell'attività (priorità normale); assente = vale `predefinito`. */
  standard?: { primaRispostaOre: number; risoluzioneOre: number };
  /** Piano di partenza dei ticket di questa attività ("nessuno" = senza SLA); assente = SLA standard. */
  pianoPredefinito?: string;
  /** Piani a pagamento attivi (es. 48h, 3g): termini fissi, la priorità non li cambia. */
  piani: Record<string, { primaRispostaOre: number; risoluzioneOre: number }>;
}
export interface CampiClienti {
  email?: string;
  partitaIva?: string;
  codiceFiscale?: string;
  telefono?: string;
  business?: string;
}
export interface CrmConfig {
  clientiListId?: string;
  campiClienti: CampiClienti;
  syncClientiMin: number;
  /** Se true il servizio crea in ClickUp la scheda dei clienti pagati via Stripe/GoCardless che mancano (#42). Default spento. */
  creaClienti: boolean;
  businessPredefinito?: string;
  /** Nomi usati in ClickUp → nome attività del servizio (es. "reti" → "reti.gazzolaelia.it"). */
  alias: Record<string, string>;
}
export interface DashboardConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  urlBase: string;
  claimBusiness: string;
}

/**
 * ID dei campi custom della lista documenti. Solo `chiave` è obbligatorio; gli altri, se presenti,
 * vengono compilati dal worker e (anno/numeri/flag) letti per riconoscere i numeri già usati a mano.
 */
export interface CampiClickUp {
  chiave: string;
  anno?: string;
  numero: Partial<Record<Tipo, string>>;
  flag: Partial<Record<Tipo, string>>;
  totale: Partial<Record<Tipo, string>>;
  dataDocumento?: string;
  dataFattura?: string;
  email?: string;
  ragione?: string;
  progetto?: string;
  cliente?: string;
  pagata?: string;
  dataIncasso?: string;
  area?: string;
  metodo?: string;
  rata?: string;
}

type Env = Record<string, string | undefined>;

function req(env: Env, k: string): string {
  const v = env[k];
  if (v === undefined || v === '') throw new Error(`variabile mancante: ${k}`);
  return v;
}
function opt(env: Env, k: string): string | undefined {
  const v = env[k];
  return v === undefined || v === '' ? undefined : v;
}
function int(env: Env, k: string, def: number, min: number, max: number): number {
  const raw = opt(env, k);
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`valore non valido: ${k}`);
  return n;
}
function token(env: Env, k: string): string {
  const v = req(env, k);
  if (v.length < 32) throw new Error(`token troppo corto (min 32 caratteri): ${k}`);
  return v;
}
function oneOf<T extends string>(env: Env, k: string, ammessi: readonly T[]): T | undefined {
  const v = opt(env, k);
  if (v === undefined) return undefined;
  if (!(ammessi as readonly string[]).includes(v)) throw new Error(`valore non valido: ${k}`);
  return v as T;
}

export function caricaConfig(env: Env = process.env): Config {
  // PG_SSL è obbligatoria: lo stato SSL di services-postgres è un punto aperto e non si sceglie in silenzio.
  const ssl = oneOf(env, 'PG_SSL', ['disable', 'require', 'verify-full'] as const);
  if (!ssl) throw new Error('variabile mancante: PG_SSL');

  const cfg: Config = {
    port: int(env, 'PORT', 8080, 1, 65535),
    bodyLimit: int(env, 'BODY_LIMIT', 65536, 1024, 1048576),
    rateLimitPerMin: int(env, 'RATE_LIMIT_PER_MIN', 120, 1, 100000),
    forzaBlocco: opt(env, 'FORZA_BLOCCO') === 'true',
    avvioSenzaClickup: opt(env, 'AVVIO_SENZA_CLICKUP') === 'true',
    pg: {
      host: opt(env, 'PG_HOST') ?? 'services-postgres',
      port: int(env, 'PG_PORT', 5432, 1, 65535),
      database: req(env, 'PG_DB'),
      user: req(env, 'APP_PG_USER'),
      password: req(env, 'APP_PG_PASS'),
      ssl,
      caFile: opt(env, 'PG_CA_FILE'),
    },
    tokens: { n8n: token(env, 'N8N_TOKEN'), dashboard: token(env, 'DASHBOARD_TOKEN'), owner: token(env, 'OWNER_TOKEN') },
    pagamentiTipo: oneOf(env, 'PAGAMENTI_TIPO_DOCUMENTO', ['fattura', 'proforma'] as const),
    worker: {
      interniSec: int(env, 'WORKER_INTERNI_SEC', 90, 30, 3600),
      esterniSec: int(env, 'WORKER_ESTERNI_SEC', 2700, 60, 86400),
      // I documenti da n8n hanno la task creata dal workflow (dopo l'approvazione su Telegram): il servizio aspetta.
      attesaClickupMin: int(env, 'WORKER_ATTESA_CLICKUP_MIN', 45, 0, 1440),
    },
    ticket: { fonti: {}, syncMin: int(env, 'TICKET_SYNC_MIN', 5, 1, 1440) },
    riconciliazione: {
      oraRoma: int(env, 'RICONCILIAZIONE_ORA', 6, 0, 23),
      riservatoMaxOre: int(env, 'RISERVATO_MAX_ORE', 24, 1, 720),
    },
  };

  // Fonti ticket: TICKET_FONTI="heyciar:heyciar.it,serrandasu:serrandasu.it" e un token per fonte in TICKET_TOKEN_<FONTE>.
  const giaUsati = new Set<string>([cfg.tokens.n8n, cfg.tokens.dashboard, cfg.tokens.owner]);
  for (const coppia of (opt(env, 'TICKET_FONTI') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9_-]{1,31}):([a-z0-9][a-z0-9._-]{0,63})$/.exec(coppia);
    if (!m || FONTI_RISERVATE.includes(m[1]!)) throw new Error('valore non valido: TICKET_FONTI (formato fonte:attività, separati da virgola)');
    const nomeVar = `TICKET_TOKEN_${m[1]!.toUpperCase().replace(/-/g, '_')}`;
    const tk = token(env, nomeVar);
    if (giaUsati.has(tk)) throw new Error(`token duplicato: ${nomeVar} deve essere diverso da tutti gli altri`);
    giaUsati.add(tk);
    const fonte: FonteTicket = { token: tk, business: m[2]! };
    // Backend del business (#46): URL e token in uscita, entrambi o nessuno.
    const suffisso = m[1]!.toUpperCase().replace(/-/g, '_');
    const urlB = opt(env, `TICKET_BACKEND_URL_${suffisso}`);
    if (urlB) fonte.backend = { url: urlBackend(urlB, `TICKET_BACKEND_URL_${suffisso}`), token: token(env, `TICKET_BACKEND_TOKEN_${suffisso}`) };
    cfg.ticket.fonti[m[1]!] = fonte;
  }

  const sws = opt(env, 'STRIPE_WEBHOOK_SECRET');
  const sk = opt(env, 'STRIPE_API_KEY');
  // STRIPE_LIVEMODE (default true): in produzione gli eventi di test vengono ignorati, e viceversa.
  const lm = oneOf(env, 'STRIPE_LIVEMODE', ['true', 'false'] as const) ?? 'true';
  // Organizzazione Stripe con un account per attività: STRIPE_BUSINESS_PER_ACCOUNT="acct_A=serrandasu.it,acct_B=heyciar.it"
  const perAccount: Record<string, string> = {};
  for (const coppia of (opt(env, 'STRIPE_BUSINESS_PER_ACCOUNT') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(acct_[A-Za-z0-9]+)=([a-z0-9][a-z0-9._-]{0,63})$/.exec(coppia);
    if (!m) throw new Error('valore non valido: STRIPE_BUSINESS_PER_ACCOUNT (formato acct_...=attività, separati da virgola)');
    perAccount[m[1]!] = m[2]!;
  }
  if (sws && sk)
    cfg.stripe = {
      webhookSecret: sws,
      apiKey: sk,
      livemode: lm === 'true',
      businessPredefinito: opt(env, 'STRIPE_BUSINESS_PREDEFINITO'),
      businessPerAccount: perAccount,
      chiaveOrganizzazione: sk.startsWith('sk_org_'),
    };

  const tt = opt(env, 'TELEGRAM_BOT_TOKEN');
  const tc = opt(env, 'TELEGRAM_CHAT_ID');
  if (tt && tc) cfg.telegram = { token: tt, chatId: tc };

  const gws = opt(env, 'GC_WEBHOOK_SECRET');
  const gtok = opt(env, 'GC_API_TOKEN');
  const gtr = oneOf(env, 'GC_TRIGGER_ACTION', ['confirmed', 'paid_out'] as const);
  if (gws && gtok && gtr) {
    cfg.gocardless = {
      webhookSecret: gws,
      apiToken: gtok,
      trigger: gtr,
      apiUrl: opt(env, 'GC_API_URL') ?? 'https://api.gocardless.com',
      businessPredefinito: opt(env, 'GC_BUSINESS_PREDEFINITO'),
    };
  }

  const ct = opt(env, 'CLICKUP_TOKEN');
  const lf = opt(env, 'CLICKUP_LIST_ID_FATTURA');
  const lp = opt(env, 'CLICKUP_LIST_ID_PROFORMA');
  const cc = opt(env, 'CLICKUP_CAMPO_CHIAVE_ID');
  // Configurazione ClickUp a metà = errore di avvio, non "ClickUp spento" in silenzio.
  const parzialeCu = [ct, lf, lp, cc].filter(Boolean).length;
  if (parzialeCu > 0 && parzialeCu < 4) throw new Error('ClickUp configurato a metà: servono CLICKUP_TOKEN, CLICKUP_LIST_ID_FATTURA, CLICKUP_LIST_ID_PROFORMA e CLICKUP_CAMPO_CHIAVE_ID');
  if (ct && lf && lp && cc) {
    cfg.clickup = {
      token: ct,
      apiUrl: opt(env, 'CLICKUP_API_URL') ?? 'https://api.clickup.com/api/v2',
      rpm: int(env, 'CLICKUP_RPM', 100, 1, 10000),
      listId: { fattura: lf, proforma: lp },
      campi: {
        chiave: cc,
        anno: opt(env, 'CLICKUP_CAMPO_ANNO_ID'),
        numero: { fattura: opt(env, 'CLICKUP_CAMPO_NUMERO_FATTURA_ID'), proforma: opt(env, 'CLICKUP_CAMPO_NUMERO_PROFORMA_ID') },
        flag: { fattura: opt(env, 'CLICKUP_CAMPO_FLAG_FATTURA_ID'), proforma: opt(env, 'CLICKUP_CAMPO_FLAG_PROFORMA_ID') },
        totale: { fattura: opt(env, 'CLICKUP_CAMPO_TOTALE_FATTURA_ID'), proforma: opt(env, 'CLICKUP_CAMPO_TOTALE_PROFORMA_ID') },
        dataDocumento: opt(env, 'CLICKUP_CAMPO_DATA_DOCUMENTO_ID'),
        dataFattura: opt(env, 'CLICKUP_CAMPO_DATA_FATTURA_ID'),
        email: opt(env, 'CLICKUP_CAMPO_EMAIL_ID'),
        ragione: opt(env, 'CLICKUP_CAMPO_RAGIONE_ID'),
        progetto: opt(env, 'CLICKUP_CAMPO_PROGETTO_ID'),
        cliente: opt(env, 'CLICKUP_CAMPO_CLIENTE_ID'),
        pagata: opt(env, 'CLICKUP_CAMPO_PAGATA_ID'),
        dataIncasso: opt(env, 'CLICKUP_CAMPO_DATA_INCASSO_ID'),
        area: opt(env, 'CLICKUP_CAMPO_AREA_ID'),
        metodo: opt(env, 'CLICKUP_CAMPO_METODO_ID'),
        rata: opt(env, 'CLICKUP_CAMPO_RATA_ID'),
      },
    };
  }
  // CRM su ClickUp (#42, #45): clienti in ClickUp. Servono il token ClickUp e la lista Clienti; gli ID dei campi sono facoltativi.
  // I ticket NON stanno in ClickUp (#47): vivono nei backend dei business o nel DB del servizio.
  const listaClienti = opt(env, 'CLICKUP_LIST_ID_CLIENTI');
  if (cfg.clickup && listaClienti) {
    cfg.crm = {
      clientiListId: listaClienti,
      campiClienti: {
        email: opt(env, 'CLICKUP_CLIENTI_CAMPO_EMAIL_ID'),
        partitaIva: opt(env, 'CLICKUP_CLIENTI_CAMPO_PIVA_ID'),
        codiceFiscale: opt(env, 'CLICKUP_CLIENTI_CAMPO_CF_ID'),
        telefono: opt(env, 'CLICKUP_CLIENTI_CAMPO_TELEFONO_ID'),
        business: opt(env, 'CLICKUP_CLIENTI_CAMPO_BUSINESS_ID'),
      },
      syncClientiMin: int(env, 'CRM_SYNC_CLIENTI_MIN', 60, 5, 1440),
      creaClienti: opt(env, 'CRM_CREA_CLIENTI') === 'true',
      businessPredefinito: opt(env, 'CRM_BUSINESS_PREDEFINITO'),
      alias: aliasDaEnv(env),
    };
  }

  // Dashboard: tutte le variabili o nessuna. I segreti arrivano solo dall'ambiente e non vengono mai mostrati.
  const varDash = ['KEYCLOAK_ISSUER', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET', 'DASHBOARD_SESSION_SECRET', 'DASHBOARD_URL_BASE'];
  const presenti = varDash.filter((k) => opt(env, k)).length;
  if (presenti > 0 && presenti < varDash.length) throw new Error(`dashboard configurata a metà: servono ${varDash.join(', ')}`);
  if (presenti === varDash.length) {
    const sessione = req(env, 'DASHBOARD_SESSION_SECRET');
    if (sessione.length < 32) throw new Error('segreto troppo corto (min 32 caratteri): DASHBOARD_SESSION_SECRET');
    const urlHttps = (k: string) => {
      const v = req(env, k).replace(/\/+$/, '');
      const https = /^https:\/\/[^\s/]+(\/\S*)?$/.test(v);
      const locale = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(v);
      if (!https && !locale) throw new Error(`valore non valido: ${k} (serve un URL https)`);
      return v;
    };
    cfg.dashboard = {
      issuer: urlHttps('KEYCLOAK_ISSUER'),
      clientId: req(env, 'KEYCLOAK_CLIENT_ID'),
      clientSecret: req(env, 'KEYCLOAK_CLIENT_SECRET'),
      sessionSecret: sessione,
      urlBase: urlHttps('DASHBOARD_URL_BASE'),
      claimBusiness: opt(env, 'KEYCLOAK_CLAIM_BUSINESS') ?? 'business',
    };
  }
  return cfg;
}

/** CRM_BUSINESS_ALIAS="reti=reti.gazzolaelia.it,visual=visual.gazzolaelia.it": come si chiamano le attività in ClickUp. */
function aliasDaEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const coppia of (opt(env, 'CRM_BUSINESS_ALIAS') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([^=]{1,64})=([a-z0-9][a-z0-9._-]{0,63})$/.exec(coppia);
    if (!m) throw new Error('valore non valido: CRM_BUSINESS_ALIAS (formato nome=attività, separati da virgola)');
    out[m[1]!.trim().toLowerCase()] = m[2]!;
  }
  return out;
}

const FONTI_RISERVATE = ['clickup', 'manuale', 'dashboard', 'stripe', 'gocardless', 'n8n', 'owner'];

/** URL del backend ticket: https, oppure http solo dentro il cluster (*.svc.cluster.local) o su localhost. Senza barra finale. */
function urlBackend(v: string, nome: string): string {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`valore non valido: ${nome}`);
  }
  const interno = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.svc.cluster.local') || u.hostname.endsWith('.svc');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && interno)) throw new Error(`${nome} deve essere https (http solo dentro il cluster)`);
  if (u.username || u.password) throw new Error(`${nome}: niente credenziali nell'URL`);
  return v.replace(/\/+$/, '');
}

/** Elenco di ciò che è attivo, senza valori: va bene per i log. */
export function riassuntoConfig(c: Config): Record<string, unknown> {
  return {
    pgHost: c.pg.host,
    pgSsl: c.pg.ssl,
    forzaBlocco: c.forzaBlocco,
    stripe: Boolean(c.stripe),
    gocardless: c.gocardless ? c.gocardless.trigger : false,
    stripeLivemode: c.stripe?.livemode ?? null,
    fonteTicket: Object.keys(c.ticket.fonti),
    backendTicket: Object.entries(c.ticket.fonti).filter(([, f]) => f.backend).map(([k]) => k),
    crm: c.crm ? { clienti: Boolean(c.crm.clientiListId), creaClienti: c.crm.creaClienti } : false,
    dashboard: Boolean(c.dashboard),
    clickup: Boolean(c.clickup),
    telegram: Boolean(c.telegram),
    pagamentiTipo: c.pagamentiTipo ?? null,
  };
}
