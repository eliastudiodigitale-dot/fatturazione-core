// Dashboard: login Keycloak (code flow + PKCE) con un Keycloak finto, sessione firmata, ambiti per ruolo e attività.
import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { Script } from 'node:vm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { paginaDashboard, _perTest } from '../src/dashboard-ui.js';
import { AUTH, admin, cfgTest, costruisci, poolApp, svuota } from './helpers.js';

const pool = poolApp();
afterAll(async () => {
  await pool.end();
  await admin.end();
});
beforeEach(svuota);

const ISSUER = 'https://kc.example.org/realms/business';
const URL_BASE = 'https://gestione.example.org';
const CLIENT_ID = 'gestione';
const CLIENT_SECRET = 'segreto-keycloak-di-prova';
const ENV_DASH = {
  KEYCLOAK_ISSUER: ISSUER,
  KEYCLOAK_CLIENT_ID: CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET: CLIENT_SECRET,
  DASHBOARD_SESSION_SECRET: 's'.repeat(40),
  DASHBOARD_URL_BASE: URL_BASE,
};

const coppia = generateKeyPairSync('rsa', { modulusLength: 2048 });
const altra = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkPubblica = { ...coppia.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };

const b64u = (x: object | Buffer) => Buffer.from(Buffer.isBuffer(x) ? x : JSON.stringify(x)).toString('base64url');
function jwt(claims: Record<string, unknown>, o: { chiave?: KeyObject; kid?: string; alg?: string } = {}): string {
  const h = b64u({ alg: o.alg ?? 'RS256', typ: 'JWT', kid: o.kid ?? 'k1' });
  const c = b64u(claims);
  const firma = createSign('sha256').update(`${h}.${c}`).sign(o.chiave ?? coppia.privateKey);
  return `${h}.${c}.${b64u(firma)}`;
}

/** Keycloak finto: discovery, JWKS e token endpoint. `prossimo` decide quali claims restituire al prossimo scambio del codice. */
function keycloakFinto() {
  const stato = {
    chiamateToken: [] as { auth: string; corpo: URLSearchParams }[],
    chiamateJwks: 0,
    risposta: undefined as undefined | ((corpo: URLSearchParams) => unknown),
    jwks: [jwkPubblica] as unknown[],
  };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json' } });
    if (u === `${ISSUER}/.well-known/openid-configuration`)
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
        end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
      });
    if (u.endsWith('/certs')) {
      stato.chiamateJwks++;
      return json({ keys: stato.jwks });
    }
    if (u.endsWith('/token')) {
      const corpo = new URLSearchParams(String(init?.body));
      stato.chiamateToken.push({ auth: String((init?.headers as Record<string, string>).Authorization), corpo });
      return stato.risposta ? json(stato.risposta(corpo)) : json({ errore: 'nessuna risposta preparata' }, 400);
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { stato, fetchFn };
}

const claimsBase = (extra: Record<string, unknown> = {}, nonce?: string) => {
  const adesso = Math.floor(Date.now() / 1000);
  return { iss: ISSUER, aud: CLIENT_ID, sub: 'utente-1', name: 'Elia Prova', email: 'elia@example.org', iat: adesso, exp: adesso + 300, nonce, realm_access: { roles: ['owner'] }, ...extra };
};

function cookieDa(res: { headers: Record<string, unknown> }, nome: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const lista = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return lista.find((c) => c.startsWith(`${nome}=`));
}
const soloValore = (setCookie: string) => setCookie.split(';')[0]!;

async function costruisciDash(ora?: () => number) {
  const kc = keycloakFinto();
  const cfg = cfgTest(ENV_DASH);
  const t = await costruisci({ pool, cfg, dashboard: { fetchFn: kc.fetchFn, ora } });
  return { ...t, kc };
}
type App = Awaited<ReturnType<typeof costruisciDash>>['app'];

/** Esegue tutto il giro di login e restituisce il cookie di sessione (o la risposta del callback se fallisce). */
async function accedi(app: App, kc: ReturnType<typeof keycloakFinto>, claims: (nonce: string) => Record<string, unknown>, o: { chiave?: KeyObject; alg?: string; state?: string } = {}) {
  const login = await app.inject({ method: 'GET', url: '/dashboard/login' });
  expect(login.statusCode).toBe(302);
  const dest = new URL(String(login.headers.location));
  const nonce = dest.searchParams.get('nonce')!;
  kc.stato.risposta = () => ({ id_token: jwt(claims(nonce), { chiave: o.chiave, alg: o.alg }) });
  const cookieLogin = soloValore(cookieDa(login, 'dash_oidc')!);
  const cb = await app.inject({ method: 'GET', url: `/dashboard/callback?code=codice1&state=${encodeURIComponent(o.state ?? dest.searchParams.get('state')!)}`, headers: { cookie: cookieLogin } });
  const sess = cookieDa(cb, 'dash_sess');
  return { login, dest, cb, sessione: sess ? soloValore(sess) : undefined, cookieSessioneCompleto: sess };
}

async function datiDiProva() {
  await admin.query(`INSERT INTO ticket (ref, fonte, business, oggetto, stato, aperto_il, scade_prima_risposta, scade_risoluzione, cliente_task_id) VALUES
    ('heyciar|1','heyciar','heyciar.it','Ticket heyciar','aperto', now(), now()+interval '1 day', now()+interval '3 day','c1'),
    ('serrandasu|1','serrandasu','serrandasu.it','Ticket serranda','aperto', now(), now()+interval '1 day', now()+interval '3 day', null),
    ('reti|1','reti','reti.gazzolaelia.it','Ticket reti','aperto', now(), now()+interval '1 day', now()+interval '3 day', null)`);
  await admin.query(`INSERT INTO crm_clienti (clickup_task_id, nome, email, businesses) VALUES ('c1','Rossi','info@rossi.it','{heyciar.it}'), ('c3','Verdi','v@verdi.it','{reti.gazzolaelia.it}')`);
  await admin.query(
    `INSERT INTO documenti (ref, anno, tipo, numero, fonte, business, payload) VALUES ('d1', 2026, 'fattura', 1, 'clickup', 'heyciar.it', '{"cliente":{"email":"info@rossi.it"},"righe":[{"descrizione":"x","importo":120}]}')`,
  );
}

describe('accesso', () => {
  it('senza sessione: la pagina rimanda al login, le API rispondono 401', async () => {
    const { app } = await costruisciDash();
    const p = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(p.statusCode).toBe(302);
    expect(p.headers.location).toBe('/dashboard/login');
    for (const url of ['/dashboard/api/me', '/dashboard/api/ticket', '/dashboard/api/kpi/panoramica', '/dashboard/api/clienti', '/dashboard/api/filtri']) expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    // i token delle API /v1 non aprono la dashboard
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/me', headers: AUTH.owner })).statusCode).toBe(401);
    await app.close();
  });

  it('non configurata: nessuna rotta della dashboard', async () => {
    const { app } = await costruisci({ pool });
    expect((await app.inject({ method: 'GET', url: '/dashboard' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/me' })).statusCode).toBe(404);
    await app.close();
  });

  it('il login manda a Keycloak con PKCE S256, state e nonce, e imposta un cookie HttpOnly Secure', async () => {
    const { app } = await costruisciDash();
    const r = await app.inject({ method: 'GET', url: '/dashboard/login' });
    const u = new URL(String(r.headers.location));
    expect(u.origin + u.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: `${URL_BASE}/dashboard/callback`, code_challenge_method: 'S256', scope: 'openid profile email' });
    expect(u.searchParams.get('state')!.length).toBeGreaterThan(10);
    expect(u.searchParams.get('nonce')!.length).toBeGreaterThan(10);
    const c = cookieDa(r, 'dash_oidc')!;
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Path=\/dashboard/);
    // il verifier PKCE non è nell'URL
    expect(String(r.headers.location)).not.toContain('code_verifier');
    await app.close();
  });

  it('owner: accesso completo; il codice viene scambiato con client secret e verifier PKCE coerente', async () => {
    const { app, kc } = await costruisciDash();
    await datiDiProva();
    const a = await accedi(app, kc, (nonce) => claimsBase({}, nonce));
    expect(a.cb.statusCode).toBe(302);
    expect(a.cb.headers.location).toBe('/dashboard');
    expect(a.cookieSessioneCompleto).toMatch(/HttpOnly/);
    expect(a.cookieSessioneCompleto).toMatch(/Secure/);

    const t = kc.stato.chiamateToken[0]!;
    expect(t.auth).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`);
    expect(t.corpo.get('grant_type')).toBe('authorization_code');
    expect(t.corpo.get('code')).toBe('codice1');
    expect(t.corpo.get('redirect_uri')).toBe(`${URL_BASE}/dashboard/callback`);
    expect(createHash('sha256').update(t.corpo.get('code_verifier')!).digest('base64url')).toBe(a.dest.searchParams.get('code_challenge'));

    const h = { cookie: a.sessione! };
    const me = (await app.inject({ method: 'GET', url: '/dashboard/api/me', headers: h })).json();
    expect(me).toEqual({
      nome: 'Elia Prova', email: 'elia@example.org', ruoli: ['owner'], business: null, soldi: true,
      permessi: { ticketScrive: true, crmScrive: true, crmAnagrafica: true, fatture: true, sync: true },
    });
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/ticket', headers: h })).json().totale).toBe(3);
    const kpi = (await app.inject({ method: 'GET', url: '/dashboard/api/kpi/panoramica?giorni=30', headers: h })).json();
    expect(kpi.fatturato.fatturato).toBe(120); // la fattura di prova (120 €, non annullata, data di oggi) rientra nel periodo
    expect(kpi.ticket.backlog).toBe(3);

    const pagina = await app.inject({ method: 'GET', url: '/dashboard', headers: h });
    expect(pagina.statusCode).toBe(200);
    expect(pagina.headers['content-type']).toContain('text/html');
    const csp = String(pagina.headers['content-security-policy']);
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(pagina.body).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    await app.close();
  });

  it('assistenza con una sola attività: vede solo quella e nessun importo', async () => {
    const { app, kc } = await costruisciDash();
    await datiDiProva();
    const a = await accedi(app, kc, (nonce) => claimsBase({ realm_access: { roles: ['assistenza'] }, business: ['heyciar.it'] }, nonce));
    const h = { cookie: a.sessione! };
    const get = async (url: string) => app.inject({ method: 'GET', url, headers: h });
    expect((await get('/dashboard/api/me')).json()).toMatchObject({ ruoli: ['assistenza'], business: ['heyciar.it'], soldi: false });
    expect((await get('/dashboard/api/ticket')).json().ticket.map((t: { ref: string }) => t.ref)).toEqual(['heyciar|1']);
    // non può allargare l'ambito chiedendo un'altra attività
    expect((await get('/dashboard/api/ticket?business=serrandasu.it')).json().totale).toBe(0);
    expect((await get('/dashboard/api/ticket/serrandasu%7C1')).statusCode).toBe(404);
    const k = (await get('/dashboard/api/kpi/panoramica?giorni=30')).json();
    expect(k.fatturato).toBeNull();
    expect(k.clienti.attivi_12m).toBeNull();
    expect(k.ticket.backlog).toBe(1);
    expect((await get('/dashboard/api/clienti')).json().clienti.map((c: { nome: string }) => c.nome)).toEqual(['Rossi']);
    expect((await get('/dashboard/api/clienti')).json().clienti[0]).toMatchObject({ fatture: null, fatturato_12m: null });
    expect((await get('/dashboard/api/clienti/c3')).statusCode).toBe(404); // cliente di un'altra attività
    expect((await get('/dashboard/api/clienti/c1')).json().documenti).toBeNull();
    expect((await get('/dashboard/api/filtri')).json().business).toEqual(['heyciar.it']);
    await app.close();
  });

  it('amministrazione con attività in un solo claim testuale: vede gli importi, solo delle sue attività', async () => {
    const { app, kc } = await costruisciDash();
    await datiDiProva();
    const a = await accedi(app, kc, (nonce) => claimsBase({ resource_access: { [CLIENT_ID]: { roles: ['amministrazione'] } }, realm_access: undefined, business: 'heyciar.it, serrandasu.it' }, nonce));
    const h = { cookie: a.sessione! };
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/me', headers: h })).json()).toMatchObject({ ruoli: ['amministrazione'], business: ['heyciar.it', 'serrandasu.it'], soldi: true });
    const k = (await app.inject({ method: 'GET', url: '/dashboard/api/kpi/panoramica?giorni=30', headers: h })).json();
    expect(k.fatturato).not.toBeNull();
    expect(k.ticket.backlog).toBe(2);
    expect(k.per_business.map((x: { business: string }) => x.business)).not.toContain('reti.gazzolaelia.it');
    await app.close();
  });
});

describe('accesso negato', () => {
  const casi: [string, (n: string) => Record<string, unknown>, { chiave?: KeyObject; alg?: string }?][] = [
    ['firma di un\'altra chiave', (n) => claimsBase({}, n), { chiave: altra.privateKey }],
    ['nonce diverso', () => claimsBase({}, 'nonce-sbagliato')],
    ['audience diversa', (n) => claimsBase({ aud: 'altra-app' }, n)],
    ['emittente diverso', (n) => claimsBase({ iss: 'https://finto.example.org/realms/x' }, n)],
    ['token scaduto', (n) => claimsBase({ exp: Math.floor(Date.now() / 1000) - 3600 }, n)],
    ['emesso nel futuro', (n) => claimsBase({ iat: Math.floor(Date.now() / 1000) + 3600 }, n)],
    ['nessun ruolo della dashboard', (n) => claimsBase({ realm_access: { roles: ['offline_access'] } }, n)],
    ['assistenza senza attività', (n) => claimsBase({ realm_access: { roles: ['assistenza'] } }, n)],
    ['senza soggetto', (n) => claimsBase({ sub: undefined }, n)],
  ];
  for (const [nome, claims, o] of casi)
    it(`rifiuta: ${nome}`, async () => {
      const { app, kc } = await costruisciDash();
      const a = await accedi(app, kc, claims, o);
      expect(a.cb.statusCode).toBe(403);
      expect(a.sessione).toBeUndefined();
      expect(a.cb.body).not.toContain('kc.example.org'); // i motivi restano nei log, non al browser
      await app.close();
    });

  it('rifiuta algoritmi diversi da RS256 (HS256, none)', async () => {
    const { app, kc } = await costruisciDash();
    for (const alg of ['HS256', 'none']) {
      const a = await accedi(app, kc, (n) => claimsBase({}, n), { alg });
      expect(a.cb.statusCode).toBe(403);
      expect(a.sessione).toBeUndefined();
    }
    await app.close();
  });

  it('state sbagliato, cookie di login assente, errore da Keycloak: nessuna sessione', async () => {
    const { app, kc } = await costruisciDash();
    const sbagliato = await accedi(app, kc, (n) => claimsBase({}, n), { state: 'state-sbagliato' });
    expect(sbagliato.cb.statusCode).toBe(400);
    expect(sbagliato.sessione).toBeUndefined();
    expect(kc.stato.chiamateToken).toHaveLength(0); // senza state valido il codice non viene nemmeno scambiato
    const senzaCookie = await app.inject({ method: 'GET', url: '/dashboard/callback?code=x&state=y' });
    expect(senzaCookie.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/dashboard/callback?error=access_denied' })).statusCode).toBe(403);
    await app.close();
  });

  it('chiave di firma ruotata: si riscarica il JWKS (al massimo una volta al minuto)', async () => {
    const { app, kc } = await costruisciDash();
    kc.stato.jwks = [{ ...jwkPubblica, kid: 'vecchia' }];
    const a = await accedi(app, kc, (n) => claimsBase({}, n));
    expect(a.cb.statusCode).toBe(403); // il token è firmato con k1, il JWKS ha solo "vecchia"
    kc.stato.jwks = [jwkPubblica];
    const b = await accedi(app, kc, (n) => claimsBase({}, n));
    expect(b.cb.statusCode).toBe(403); // entro un minuto non riscarica: protezione da raffiche di chiavi sconosciute
    expect(kc.stato.chiamateJwks).toBe(1);
    await app.close();
  });
});

describe('sessione', () => {
  it('un cookie modificato o firmato con un altro segreto non vale', async () => {
    const { app, kc } = await costruisciDash();
    const a = await accedi(app, kc, (n) => claimsBase({ realm_access: { roles: ['assistenza'] }, business: ['heyciar.it'] }, n));
    const valore = a.sessione!.split('=')[1]!;
    const [corpo, firma] = valore.split('.') as [string, string];
    // promozione a owner senza ricalcolare la firma
    const falso = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, 'base64url').toString()), ruoli: ['owner'], business: null })).toString('base64url');
    for (const v of [`${falso}.${firma}`, `${corpo}.${firma.slice(0, -2)}xx`, corpo, `${corpo}.${firma}.extra`, 'abc'])
      expect((await app.inject({ method: 'GET', url: '/dashboard/api/me', headers: { cookie: `dash_sess=${v}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/me', headers: { cookie: a.sessione! } })).statusCode).toBe(200);
    await app.close();
  });

  it('scade dopo 8 ore', async () => {
    let spostamento = 0;
    const { app, kc } = await costruisciDash(() => Date.now() + spostamento);
    const a = await accedi(app, kc, (n) => claimsBase({}, n));
    const h = { cookie: a.sessione! };
    spostamento = 7 * 3600_000;
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/me', headers: h })).statusCode).toBe(200);
    spostamento = 9 * 3600_000;
    expect((await app.inject({ method: 'GET', url: '/dashboard/api/me', headers: h })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/dashboard', headers: h })).statusCode).toBe(302);
    await app.close();
  });

  it('uscita: azzera il cookie e rimanda al logout di Keycloak', async () => {
    const { app, kc } = await costruisciDash();
    const a = await accedi(app, kc, (n) => claimsBase({}, n));
    const r = await app.inject({ method: 'POST', url: '/dashboard/logout', headers: { cookie: a.sessione! } });
    expect(r.statusCode).toBe(302);
    expect(String(r.headers.location)).toContain(`${ISSUER}/protocol/openid-connect/logout`);
    expect(cookieDa(r, 'dash_sess')).toMatch(/Max-Age=0/);
    await app.close();
  });

  it('un segreto o un token non compare mai nelle risposte né nel cookie di sessione', async () => {
    const { app, kc } = await costruisciDash();
    const a = await accedi(app, kc, (n) => claimsBase({}, n));
    const tutto = JSON.stringify([a.cb.headers, a.cb.body, a.cookieSessioneCompleto, a.login.headers]);
    for (const segreto of [CLIENT_SECRET, ENV_DASH.DASHBOARD_SESSION_SECRET, 'id_token']) expect(tutto).not.toContain(segreto);
    await app.close();
  });
});

describe('pagina', () => {
  it('il JavaScript della pagina è sintatticamente valido e non carica nulla da fuori', () => {
    expect(() => new Script(_perTest.SCRIPT)).not.toThrow();
    const html = paginaDashboard('NONCE');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).toContain('nonce="NONCE"');
    // ogni testo dai dati passa da esc(): niente innerHTML con valori grezzi di ticket/clienti nella cronologia
    expect(_perTest.SCRIPT).toContain('function esc(');
  });
});
