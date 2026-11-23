// Login della dashboard con Keycloak (OpenID Connect, code flow + PKCE, client riservato) senza dipendenze nuove.
// Segreti solo da variabili d'ambiente (KEYCLOAK_CLIENT_SECRET, DASHBOARD_SESSION_SECRET): mai nei log né nelle risposte.
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import type { DashboardConfig } from './config.js';
import type { Ambito } from './sql.js';

export type Ruolo = 'owner' | 'amministrazione' | 'assistenza';
const RUOLI: Ruolo[] = ['owner', 'amministrazione', 'assistenza'];

export interface Sessione {
  sub: string;
  nome: string;
  email: string | null;
  ruoli: Ruolo[];
  /** Attività visibili; null = tutte (solo owner). */
  business: string[] | null;
  /** Scadenza in secondi Unix. */
  exp: number;
}

export const DURATA_SESSIONE_S = 8 * 3600;
const DURATA_LOGIN_S = 600;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const daB64u = (s: string) => Buffer.from(s, 'base64url');

/** Valore firmato HMAC-SHA256: `<json base64url>.<firma>`. Il contenuto è leggibile ma non modificabile. */
export function firma(contenuto: object, segreto: string): string {
  const corpo = b64u(JSON.stringify(contenuto));
  return `${corpo}.${b64u(createHmac('sha256', segreto).update(corpo).digest())}`;
}
export function apri<T extends { exp: number }>(valore: string | undefined, segreto: string, oraMs = Date.now()): T | undefined {
  if (!valore) return undefined;
  const [corpo, f, resto] = valore.split('.');
  if (!corpo || !f || resto !== undefined) return undefined;
  const atteso = createHmac('sha256', segreto).update(corpo).digest();
  const dato = daB64u(f);
  if (dato.length !== atteso.length || !timingSafeEqual(dato, atteso)) return undefined;
  try {
    const x = JSON.parse(daB64u(corpo).toString('utf8')) as T;
    return typeof x.exp === 'number' && x.exp * 1000 > oraMs ? x : undefined;
  } catch {
    return undefined;
  }
}

export function leggiCookie(intestazione: string | undefined, nome: string): string | undefined {
  for (const parte of (intestazione ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return undefined;
}

export function impostaCookie(nome: string, valore: string, o: { maxAgeS: number; sicuro: boolean }): string {
  return `${nome}=${valore}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=${o.maxAgeS}${o.sicuro ? '; Secure' : ''}`;
}

/** Cosa può vedere una sessione: owner tutto; amministrazione vede importi, assistenza no; gli altri solo le proprie attività. */
/** Cosa può fare chi è entrato (#46): il portale è operativo, ma ogni ruolo scrive solo nelle sezioni che gli competono. */
export interface Permessi {
  /** Assegnare, cambiare stato, rispondere e aprire ticket. */
  ticketScrive: boolean;
  /** Note, attività, contatti. */
  crmScrive: boolean;
  /** Anagrafica cliente (scrive su ClickUp), piano SLA, trattative. */
  crmAnagrafica: boolean;
  /** Sezione Fatturazione (importi). */
  fatture: boolean;
  /** Lanciare la sincronizzazione con ClickUp e con i backend. */
  sync: boolean;
}
export function permessiDiSessione(s: Sessione): Permessi {
  const o = s.ruoli.includes('owner');
  const am = s.ruoli.includes('amministrazione');
  const as = s.ruoli.includes('assistenza');
  return { ticketScrive: o || as, crmScrive: o || am || as, crmAnagrafica: o || am, fatture: o || am, sync: o };
}

export function ambitoDiSessione(s: Sessione): Ambito {
  return { business: s.ruoli.includes('owner') ? null : (s.business ?? []), soldi: s.ruoli.includes('owner') || s.ruoli.includes('amministrazione') };
}

// ------------------------------------------------------------------ OpenID Connect

interface Scoperta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}
type Jwk = JsonWebKey & { kid?: string };

export class ErroreLogin extends Error {}

export interface Oidc {
  urlLogin(p: { stato: string; nonce: string; challenge: string; redirectUri: string }): Promise<string>;
  /** Scambia il codice e restituisce la sessione già verificata. */
  completaLogin(p: { code: string; verifier: string; nonce: string; redirectUri: string }): Promise<Sessione>;
  urlLogout(): Promise<string | undefined>;
}

const aggiungiPrefisso = (a: string[]) => a.map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(x));

export function creaOidc(cfg: DashboardConfig, o: { fetchFn?: typeof fetch; ora?: () => number } = {}): Oidc {
  const f = o.fetchFn ?? fetch;
  const ora = o.ora ?? Date.now;
  let scoperta: { v: Scoperta; fino: number } | undefined;
  let chiavi: { v: Jwk[]; fino: number; ultimoAggiornamento: number } | undefined;

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    const r = await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new ErroreLogin(`Keycloak ha risposto ${r.status}`);
    return (await r.json()) as T;
  }

  async function scopri(): Promise<Scoperta> {
    if (scoperta && scoperta.fino > ora()) return scoperta.v;
    const v = await json<Scoperta>(`${cfg.issuer}/.well-known/openid-configuration`);
    if (v.issuer !== cfg.issuer) throw new ErroreLogin('issuer di Keycloak diverso da KEYCLOAK_ISSUER');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) if (typeof v[k] !== 'string' || !v[k].startsWith('https://') && !v[k].startsWith('http://localhost')) throw new ErroreLogin('configurazione Keycloak incompleta');
    scoperta = { v, fino: ora() + 3600_000 };
    return v;
  }

  async function chiaveDi(kid: string | undefined): Promise<Jwk> {
    const trova = (ks: Jwk[]) => ks.find((k) => k.kty === 'RSA' && (!kid || k.kid === kid) && (!('use' in k) || (k as { use?: string }).use !== 'enc'));
    if (chiavi && chiavi.fino > ora()) {
      const k = trova(chiavi.v);
      if (k) return k;
      // Chiave ruotata: si riscarica, ma al massimo una volta al minuto.
      if (ora() - chiavi.ultimoAggiornamento < 60_000) throw new ErroreLogin('chiave di firma sconosciuta');
    }
    const s = await scopri();
    const r = await json<{ keys: Jwk[] }>(s.jwks_uri);
    chiavi = { v: r.keys, fino: ora() + 600_000, ultimoAggiornamento: ora() };
    const k = trova(r.keys);
    if (!k) throw new ErroreLogin('chiave di firma sconosciuta');
    return k;
  }

  /** Verifica firma RS256, emittente, destinatario, scadenza e nonce di un ID token. */
  async function verificaIdToken(token: string, nonce: string): Promise<Record<string, unknown>> {
    const parti = token.split('.');
    if (parti.length !== 3) throw new ErroreLogin('token non valido');
    const [h, c, sig] = parti as [string, string, string];
    let intestazione: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      intestazione = JSON.parse(daB64u(h).toString('utf8'));
      claims = JSON.parse(daB64u(c).toString('utf8'));
    } catch {
      throw new ErroreLogin('token non valido');
    }
    if (intestazione.alg !== 'RS256') throw new ErroreLogin('algoritmo non ammesso');
    const jwk = await chiaveDi(intestazione.kid);
    const chiave = createPublicKey({ key: jwk, format: 'jwk' });
    if (!verify('sha256', Buffer.from(`${h}.${c}`), chiave, daB64u(sig))) throw new ErroreLogin('firma non valida');
    const adesso = Math.floor(ora() / 1000);
    if (claims.iss !== cfg.issuer) throw new ErroreLogin('emittente non valido');
    const aud = Array.isArray(claims.aud) ? (claims.aud as unknown[]) : [claims.aud];
    if (!aud.includes(cfg.clientId)) throw new ErroreLogin('destinatario non valido');
    if (aud.length > 1 && claims.azp !== cfg.clientId) throw new ErroreLogin('azp non valido');
    if (typeof claims.exp !== 'number' || claims.exp + 60 < adesso) throw new ErroreLogin('token scaduto');
    if (typeof claims.iat === 'number' && claims.iat > adesso + 300) throw new ErroreLogin('token emesso nel futuro');
    if (claims.nonce !== nonce) throw new ErroreLogin('nonce non valido');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new ErroreLogin('token senza soggetto');
    return claims;
  }

  function sessioneDaClaims(claims: Record<string, unknown>): Sessione {
    const realm = (claims.realm_access as { roles?: unknown } | undefined)?.roles;
    const client = (claims.resource_access as Record<string, { roles?: unknown }> | undefined)?.[cfg.clientId]?.roles;
    const tutti = [...(Array.isArray(realm) ? realm : []), ...(Array.isArray(client) ? client : [])].map(String);
    const ruoli = RUOLI.filter((r) => tutti.includes(r));
    if (ruoli.length === 0) throw new ErroreLogin('nessun ruolo della dashboard assegnato');
    const grezzo = claims[cfg.claimBusiness];
    const business = aggiungiPrefisso(Array.isArray(grezzo) ? grezzo.map(String) : typeof grezzo === 'string' ? grezzo.split(',') : []);
    if (!ruoli.includes('owner') && business.length === 0) throw new ErroreLogin('nessuna attività assegnata');
    return {
      sub: String(claims.sub),
      nome: String(claims.name ?? claims.preferred_username ?? claims.email ?? 'utente').slice(0, 120),
      email: typeof claims.email === 'string' ? claims.email.slice(0, 254) : null,
      ruoli,
      business: ruoli.includes('owner') ? null : business,
      exp: Math.floor(ora() / 1000) + DURATA_SESSIONE_S,
    };
  }

  return {
    async urlLogin(p) {
      const s = await scopri();
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: p.redirectUri,
        scope: 'openid profile email',
        state: p.stato,
        nonce: p.nonce,
        code_challenge: p.challenge,
        code_challenge_method: 'S256',
      });
      return `${s.authorization_endpoint}?${q}`;
    },
    async completaLogin(p) {
      const s = await scopri();
      const corpo = new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier });
      const base = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64');
      const r = await json<{ id_token?: string }>(s.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${base}` },
        body: corpo,
      });
      if (!r.id_token) throw new ErroreLogin('Keycloak non ha restituito un ID token');
      return sessioneDaClaims(await verificaIdToken(r.id_token, p.nonce));
    },
    async urlLogout() {
      const s = await scopri();
      if (!s.end_session_endpoint) return undefined;
      return `${s.end_session_endpoint}?${new URLSearchParams({ client_id: cfg.clientId, post_logout_redirect_uri: `${cfg.urlBase}/dashboard/login` })}`;
    },
  };
}

/** Valori casuali per un tentativo di login: state, nonce e PKCE (verifier e challenge S256). */
export function nuovoTentativo() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    stato: randomBytes(16).toString('base64url'),
    nonce: randomBytes(16).toString('base64url'),
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    exp: Math.floor(Date.now() / 1000) + DURATA_LOGIN_S,
  };
}

export const uguali = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};
