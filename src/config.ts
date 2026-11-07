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
  stripe?: { webhookSecret: string; apiKey: string; livemode: boolean; businessPredefinito?: string };
  gocardless?: { webhookSecret: string; apiToken: string; trigger: GcTrigger; apiUrl: string; businessPredefinito?: string };
  telegram?: { token: string; chatId: string };
  clickup?: {
    token: string;
    apiUrl: string;
    rpm: number;
    listId: Record<Tipo, string>;
    campi: CampiClickUp;
  };
  worker: { interniSec: number; esterniSec: number };
  riconciliazione: { oraRoma: number; riservatoMaxOre: number };
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
    },
    riconciliazione: {
      oraRoma: int(env, 'RICONCILIAZIONE_ORA', 6, 0, 23),
      riservatoMaxOre: int(env, 'RISERVATO_MAX_ORE', 24, 1, 720),
    },
  };

  const sws = opt(env, 'STRIPE_WEBHOOK_SECRET');
  const sk = opt(env, 'STRIPE_API_KEY');
  // STRIPE_LIVEMODE (default true): in produzione gli eventi di test vengono ignorati, e viceversa.
  const lm = oneOf(env, 'STRIPE_LIVEMODE', ['true', 'false'] as const) ?? 'true';
  if (sws && sk) cfg.stripe = { webhookSecret: sws, apiKey: sk, livemode: lm === 'true', businessPredefinito: opt(env, 'STRIPE_BUSINESS_PREDEFINITO') };

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
        pagata: opt(env, 'CLICKUP_CAMPO_PAGATA_ID'),
        dataIncasso: opt(env, 'CLICKUP_CAMPO_DATA_INCASSO_ID'),
        area: opt(env, 'CLICKUP_CAMPO_AREA_ID'),
        metodo: opt(env, 'CLICKUP_CAMPO_METODO_ID'),
        rata: opt(env, 'CLICKUP_CAMPO_RATA_ID'),
      },
    };
  }
  return cfg;
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
    clickup: Boolean(c.clickup),
    telegram: Boolean(c.telegram),
    pagamentiTipo: c.pagamentiTipo ?? null,
  };
}
