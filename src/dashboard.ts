import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Config, DashboardConfig } from './config.js';
import type { Notificatore } from './notifiche.js';
import type { BackendTicket } from './ticket-backend.js';
import type { SlaStore } from './sla.js';
import { registraUtente, type DepsCrmOps } from './crm-ops.js';
import { registraOperativo, type DepsOperativo } from './dashboard-api.js';
import { creaRateLimit } from './ratelimit.js';
import { registraLetture } from './api-crm.js';
import { DURATA_SESSIONE_S, ambitoDiSessione, permessiDiSessione, apri, creaOidc, firma, impostaCookie, leggiCookie, nuovoTentativo, uguali, type Oidc, type Sessione } from './dashboard-auth.js';
import { paginaDashboard } from './dashboard-ui.js';

export interface DepsDashboard {
  pool: pg.Pool;
  cfg: DashboardConfig;
  /** Configurazione completa (SLA, fonti ticket) e ciò che rende il portale operativo. */
  appCfg: Config;
  notif: Notificatore;
  sla: SlaStore;
  backends: Record<string, BackendTicket>;
  crm: DepsCrmOps;
  sincronizza?: DepsOperativo['sincronizza'];
  /** Prove: finto Keycloak e orologio. */
  fetchFn?: typeof fetch;
  ora?: () => number;
}

declare module 'fastify' {
  interface FastifyRequest {
    sessione?: Sessione;
  }
}

const COOKIE_SESSIONE = 'dash_sess';
const COOKIE_LOGIN = 'dash_oidc';

const pagina = (titolo: string, corpo: string) =>
  `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titolo}</title>` +
  `<body style="font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">${corpo}</body></html>`;

/**
 * Dashboard: pagina HTML e API di lettura dietro il login Keycloak. Il browser non vede mai token: ha solo un cookie di sessione
 * firmato (HttpOnly, SameSite=Lax). Le API sono le stesse di /v1 ma con l'ambito della sessione (attività e importi consentiti).
 */
export async function registraDashboard(app: FastifyInstance, d: DepsDashboard): Promise<void> {
  const { cfg } = d;
  const ora = d.ora ?? Date.now;
  const oidc: Oidc = creaOidc(cfg, { fetchFn: d.fetchFn, ora });
  const sicuro = cfg.urlBase.startsWith('https://');
  const redirectUri = `${cfg.urlBase}/dashboard/callback`;
  const limite = creaRateLimit(300);
  const limiteLogin = creaRateLimit(20);

  const sessioneDa = (req: FastifyRequest) => apri<Sessione>(leggiCookie(req.headers.cookie, COOKIE_SESSIONE), cfg.sessionSecret, ora());

  const richiediSessione = async (req: FastifyRequest, reply: FastifyReply) => {
    const s = sessioneDa(req);
    if (!s) return reply.code(401).send({ errore: 'sessione scaduta o assente' });
    if (!limite(s.sub)) return reply.code(429).send({ errore: 'troppe richieste' });
    req.sessione = s;
  };

  app.get('/dashboard', async (req, reply) => {
    if (!sessioneDa(req)) return reply.redirect('/dashboard/login');
    const nonce = randomBytes(16).toString('base64');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    // Script e stile inline ammessi solo con il nonce di questa risposta; il browser può chiamare solo questo stesso host.
    reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    return paginaDashboard(nonce);
  });

  app.get('/dashboard/login', async (req, reply) => {
    if (!limiteLogin(req.ip)) return reply.code(429).type('text/html').send(pagina('Troppi tentativi', '<p>Troppi tentativi, riprova tra un minuto.</p>'));
    const t = nuovoTentativo();
    let url: string;
    try {
      url = await oidc.urlLogin({ stato: t.stato, nonce: t.nonce, challenge: t.challenge, redirectUri });
    } catch (e) {
      req.log.error({ err: (e as Error).message }, 'login dashboard: Keycloak non raggiungibile');
      return reply.code(502).type('text/html').send(pagina('Accesso non disponibile', '<p>Il servizio di accesso non risponde. Riprova più tardi.</p>'));
    }
    reply.header('Set-Cookie', impostaCookie(COOKIE_LOGIN, firma({ s: t.stato, n: t.nonce, v: t.verifier, exp: t.exp }, cfg.sessionSecret), { maxAgeS: 600, sicuro }));
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/dashboard/callback', async (req, reply) => {
    const negato = (codice: number, msg: string) => reply.code(codice).type('text/html').header('Set-Cookie', impostaCookie(COOKIE_LOGIN, '', { maxAgeS: 0, sicuro })).send(pagina('Accesso negato', `<p>${msg}</p><p><a href="/dashboard/login">Riprova</a></p>`));
    if (req.query.error) return negato(403, 'Accesso non concesso.');
    const tentativo = apri<{ s: string; n: string; v: string; exp: number }>(leggiCookie(req.headers.cookie, COOKIE_LOGIN), cfg.sessionSecret, ora());
    const { code, state } = req.query;
    if (!tentativo || !code || !state || !uguali(state, tentativo.s)) return negato(400, 'Richiesta di accesso non valida o scaduta.');
    try {
      const s = await oidc.completaLogin({ code, verifier: tentativo.v, nonce: tentativo.n, redirectUri });
      // Chi entra diventa assegnabile (ticket e attività). Un errore qui non deve impedire l'accesso.
      await registraUtente(d.pool, s).catch((e: Error) => req.log.warn({ err: e.message }, 'registrazione utente dashboard non riuscita'));
      reply.header('Set-Cookie', [impostaCookie(COOKIE_LOGIN, '', { maxAgeS: 0, sicuro }), impostaCookie(COOKIE_SESSIONE, firma(s, cfg.sessionSecret), { maxAgeS: DURATA_SESSIONE_S, sicuro })]);
      req.log.info({ sub: s.sub, ruoli: s.ruoli }, 'login dashboard');
      return reply.redirect('/dashboard');
    } catch (e) {
      // Il motivo preciso va nei log, non al browser.
      req.log.warn({ err: (e as Error).message }, 'login dashboard rifiutato');
      return negato(403, 'Accesso non consentito per questo utente.');
    }
  });

  app.post('/dashboard/logout', async (req, reply) => {
    reply.header('Set-Cookie', impostaCookie(COOKIE_SESSIONE, '', { maxAgeS: 0, sicuro }));
    const url = await oidc.urlLogout().catch(() => undefined);
    return reply.redirect(url ?? '/dashboard/login');
  });

  app.get('/dashboard/api/me', { preHandler: [richiediSessione] }, async (req) => {
    const s = req.sessione!;
    const a = ambitoDiSessione(s);
    return { nome: s.nome, email: s.email, ruoli: s.ruoli, business: a.business, soldi: a.soldi, permessi: permessiDiSessione(s) };
  });

  registraLetture(app, { pool: d.pool }, '/dashboard/api', [richiediSessione], (req) => ambitoDiSessione(req.sessione!));
  registraOperativo(app, { pool: d.pool, cfg: d.appCfg, notif: d.notif, sla: d.sla, backends: d.backends, crm: d.crm, sincronizza: d.sincronizza }, richiediSessione, cfg.urlBase);
}
