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
  ticket: { fonti: Record<string, FonteTicket>; sla: SlaConfig; /** Ogni quanti minuti si rileggono i ticket dai backend dei business. */ syncMin: number };
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
export interface SlaConfig {
  /** Ore per la prima risposta e per la risoluzione di un ticket a priorità normale; le altre priorità le scalano. */
  primaRispostaOre: number;
  risoluzioneOre: number;
  perBusiness: Record<string, { primaRispostaOre: number; risoluzioneOre: number }>;
  /** Piani di assistenza a pagamento (#46): nome → ore per prima risposta e risoluzione. Termini fissi, non scalati dalla priorità. */
  piani: Record<string, { primaRispostaOre: number; risoluzioneOre: number }>;
  /** Piano di partenza per attività quando il ticket non ne indica uno ("nessuno" = senza SLA, best effort). */
  pianoPredefinito: Record<string, string>;
}
export interface CampiClienti {
  email?: string;
  partitaIva?: string;
  codiceFiscale?: string;
  telefono?: string;
  business?: string;
}
export interface CampiTicket {
  /** Campo testo con la chiave del ticket (ref): lega la task ClickUp al ticket nel DB. */
  ref?: string;
  business?: string;
  fonte?: string;
  categoria?: string;
  /** Relazione verso la scheda in Clienti. */
  cliente?: string;
  email?: string;
}
export interface CrmConfig {
  clientiListId?: string;
  ticketListId?: string;
  campiClienti: CampiClienti;
  campiTicket: CampiTicket;
  syncClientiMin: number;
  syncTicketMin: number;
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
    ticket: { fonti: {}, sla: slaDaEnv(env), syncMin: int(env, 'TICKET_SYNC_MIN', 5, 1, 1440) },
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
  // CRM e ticket in ClickUp (#45): servono il token ClickUp e almeno una lista. Gli ID dei campi sono tutti facoltativi.
  const listaClienti = opt(env, 'CLICKUP_LIST_ID_CLIENTI');
  const listaTicket = opt(env, 'CLICKUP_LIST_ID_TICKET');
  if (cfg.clickup && (listaClienti || listaTicket)) {
    cfg.crm = {
      clientiListId: listaClienti,
      ticketListId: listaTicket,
      campiClienti: {
        email: opt(env, 'CLICKUP_CLIENTI_CAMPO_EMAIL_ID'),
        partitaIva: opt(env, 'CLICKUP_CLIENTI_CAMPO_PIVA_ID'),
        codiceFiscale: opt(env, 'CLICKUP_CLIENTI_CAMPO_CF_ID'),
        telefono: opt(env, 'CLICKUP_CLIENTI_CAMPO_TELEFONO_ID'),
        business: opt(env, 'CLICKUP_CLIENTI_CAMPO_BUSINESS_ID'),
      },
      campiTicket: {
        ref: opt(env, 'CLICKUP_TICKET_CAMPO_REF_ID'),
        business: opt(env, 'CLICKUP_TICKET_CAMPO_BUSINESS_ID'),
        fonte: opt(env, 'CLICKUP_TICKET_CAMPO_FONTE_ID'),
        categoria: opt(env, 'CLICKUP_TICKET_CAMPO_CATEGORIA_ID'),
        cliente: opt(env, 'CLICKUP_TICKET_CAMPO_CLIENTE_ID'),
        email: opt(env, 'CLICKUP_TICKET_CAMPO_EMAIL_ID'),
      },
      syncClientiMin: int(env, 'CRM_SYNC_CLIENTI_MIN', 60, 5, 1440),
      syncTicketMin: int(env, 'CRM_SYNC_TICKET_MIN', 10, 2, 1440),
      creaClienti: opt(env, 'CRM_CREA_CLIENTI') === 'true',
      businessPredefinito: opt(env, 'CRM_BUSINESS_PREDEFINITO'),
      alias: aliasDaEnv(env),
    };
    // Senza il campo ref non si può legare un ticket alla sua task: meglio fermarsi che creare task doppie.
    if (listaTicket && !cfg.crm.campiTicket.ref) throw new Error('CLICKUP_LIST_ID_TICKET richiede CLICKUP_TICKET_CAMPO_REF_ID');
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

const PIANI_PREDEFINITI = '48h=24/48,3g=36/72,5g=60/120,7g=84/168';

/**
 * TICKET_SLA_ORE="heyciar.it=48/72,serrandasu.it=24/72" (prima risposta/risoluzione); predefiniti 24/72 ore a priorità normale.
 * TICKET_SLA_PIANI="48h=24/48,3g=36/72,..." piani a pagamento (#46); TICKET_PIANO_PREDEFINITO="heyciar.it=nessuno".
 */
function slaDaEnv(env: Env): SlaConfig {
  const sla: SlaConfig = {
    primaRispostaOre: int(env, 'TICKET_SLA_PRIMA_RISPOSTA_ORE', 24, 1, 720),
    risoluzioneOre: int(env, 'TICKET_SLA_RISOLUZIONE_ORE', 72, 1, 2160),
    perBusiness: {},
    piani: {},
    pianoPredefinito: {},
  };
  for (const coppia of (opt(env, 'TICKET_SLA_PIANI') ?? PIANI_PREDEFINITI).split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9_-]{0,15})=(\d{1,3})\/(\d{1,4})$/.exec(coppia);
    if (!m || m[1] === 'nessuno') throw new Error('valore non valido: TICKET_SLA_PIANI (formato piano=ore_prima_risposta/ore_risoluzione)');
    sla.piani[m[1]!] = { primaRispostaOre: Number(m[2]), risoluzioneOre: Number(m[3]) };
  }
  for (const coppia of (opt(env, 'TICKET_PIANO_PREDEFINITO') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9._-]{0,63})=([a-z0-9_-]{1,16})$/.exec(coppia);
    if (!m || (m[2] !== 'nessuno' && !sla.piani[m[2]!])) throw new Error('valore non valido: TICKET_PIANO_PREDEFINITO (formato attività=piano, il piano deve esistere in TICKET_SLA_PIANI)');
    sla.pianoPredefinito[m[1]!] = m[2]!;
  }
  for (const coppia of (opt(env, 'TICKET_SLA_ORE') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9._-]{0,63})=(\d{1,3})\/(\d{1,4})$/.exec(coppia);
    if (!m) throw new Error('valore non valido: TICKET_SLA_ORE (formato attività=ore_prima_risposta/ore_risoluzione)');
    sla.perBusiness[m[1]!] = { primaRispostaOre: Number(m[2]), risoluzioneOre: Number(m[3]) };
  }
  return sla;
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
    crm: c.crm ? { clienti: Boolean(c.crm.clientiListId), ticket: Boolean(c.crm.ticketListId), creaClienti: c.crm.creaClienti } : false,
    dashboard: Boolean(c.dashboard),
    clickup: Boolean(c.clickup),
    telegram: Boolean(c.telegram),
    pagamentiTipo: c.pagamentiTipo ?? null,
  };
}
