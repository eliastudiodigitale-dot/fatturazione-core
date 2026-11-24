// Configurazione di fonti ticket, CRM e dashboard: ciò che manca o è incoerente blocca l'avvio, niente "quasi attivo" in silenzio.
import { describe, expect, it } from 'vitest';
import { caricaConfig, riassuntoConfig } from '../src/config.js';
import { ENV_TEST } from './setup/env.js';

const cfg = (extra: Record<string, string | undefined> = {}) => caricaConfig({ ...ENV_TEST, ...extra });
const DASH = {
  KEYCLOAK_ISSUER: 'https://kc.example.org/realms/business',
  KEYCLOAK_CLIENT_ID: 'gestione',
  KEYCLOAK_CLIENT_SECRET: 'segreto-di-prova',
  DASHBOARD_SESSION_SECRET: 's'.repeat(40),
  DASHBOARD_URL_BASE: 'https://gestione.example.org/',
};

describe('fonti ticket', () => {
  it('ogni fonte ha il suo token e la sua attività', () => {
    const c = cfg();
    expect(Object.keys(c.ticket.fonti)).toEqual(['heyciar', 'serrandasu', 'reti']);
    expect(c.ticket.fonti.reti!.business).toBe('reti.gazzolaelia.it');
  });
  it('senza TICKET_FONTI nessuna fonte esterna', () => {
    expect(cfg({ TICKET_FONTI: undefined }).ticket.fonti).toEqual({});
  });
  it('token mancante, corto o uguale a un altro: errore di avvio', () => {
    expect(() => cfg({ TICKET_TOKEN_RETI: undefined })).toThrow('TICKET_TOKEN_RETI');
    expect(() => cfg({ TICKET_TOKEN_RETI: 'corto' })).toThrow('troppo corto');
    expect(() => cfg({ TICKET_TOKEN_RETI: ENV_TEST.TICKET_TOKEN_HEYCIAR })).toThrow('duplicato');
    expect(() => cfg({ TICKET_TOKEN_RETI: ENV_TEST.OWNER_TOKEN })).toThrow('duplicato');
  });
  it('formato errato o fonte riservata: errore', () => {
    expect(() => cfg({ TICKET_FONTI: 'heyciar' })).toThrow('TICKET_FONTI');
    expect(() => cfg({ TICKET_FONTI: 'stripe:heyciar.it', TICKET_TOKEN_STRIPE: 'x'.repeat(40) })).toThrow('TICKET_FONTI');
    expect(() => cfg({ TICKET_FONTI: 'Heyciar:heyciar.it' })).toThrow('TICKET_FONTI');
  });
});

describe('CRM con ClickUp', () => {
  it('attivo con ClickUp e almeno una lista; alias e tempi letti', () => {
    const c = cfg().crm!;
    expect(c).toMatchObject({ clientiListId: 'lista-clienti', syncClientiMin: 60, creaClienti: false });
    expect(c.alias).toEqual({ reti: 'reti.gazzolaelia.it', heyciar: 'heyciar.it' });
    expect(cfg({ CRM_CREA_CLIENTI: 'true', CRM_SYNC_CLIENTI_MIN: '5' }).crm).toMatchObject({ creaClienti: true, syncClientiMin: 5 });
  });
  it('spento senza lista Clienti (anche con ClickUp configurato)', () => {
    expect(cfg({ CLICKUP_LIST_ID_CLIENTI: undefined }).crm).toBeUndefined();
  });
  it('intervalli fuori misura e alias malformati: errore', () => {
    expect(() => cfg({ CRM_SYNC_CLIENTI_MIN: '1' })).toThrow('CRM_SYNC_CLIENTI_MIN');
    expect(() => cfg({ CRM_BUSINESS_ALIAS: 'reti' })).toThrow('CRM_BUSINESS_ALIAS');
  });
});

describe('dashboard', () => {
  it('spenta se nessuna variabile è impostata', () => {
    expect(cfg().dashboard).toBeUndefined();
  });
  it('attiva con tutte le variabili; gli URL perdono la barra finale', () => {
    const d = cfg(DASH).dashboard!;
    expect(d).toMatchObject({ issuer: 'https://kc.example.org/realms/business', urlBase: 'https://gestione.example.org', clientId: 'gestione', claimBusiness: 'business' });
    expect(cfg({ ...DASH, KEYCLOAK_CLAIM_BUSINESS: 'attivita' }).dashboard!.claimBusiness).toBe('attivita');
  });
  it('a metà: errore che elenca i nomi (mai i valori)', () => {
    let msg = '';
    try {
      cfg({ ...DASH, KEYCLOAK_CLIENT_SECRET: undefined });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('KEYCLOAK_CLIENT_SECRET');
    expect(msg).not.toContain('segreto-di-prova');
    expect(msg).not.toContain('s'.repeat(40));
  });
  it('segreto di sessione corto o URL non https: errore (http solo su localhost)', () => {
    expect(() => cfg({ ...DASH, DASHBOARD_SESSION_SECRET: 'corto' })).toThrow('troppo corto');
    expect(() => cfg({ ...DASH, DASHBOARD_URL_BASE: 'http://gestione.example.org' })).toThrow('https');
    expect(cfg({ ...DASH, DASHBOARD_URL_BASE: 'http://localhost:8080', KEYCLOAK_ISSUER: 'http://localhost:8180/realms/x' }).dashboard).toBeDefined();
  });
  it('il riassunto per i log non contiene segreti', () => {
    const testo = JSON.stringify(riassuntoConfig(cfg({ ...DASH, CRM_CREA_CLIENTI: 'true' })));
    for (const v of [DASH.KEYCLOAK_CLIENT_SECRET, DASH.DASHBOARD_SESSION_SECRET, ENV_TEST.TICKET_TOKEN_HEYCIAR!, ENV_TEST.OWNER_TOKEN!]) expect(testo).not.toContain(v);
    expect(JSON.parse(testo)).toMatchObject({ dashboard: true, fonteTicket: ['heyciar', 'serrandasu', 'reti'], crm: { clienti: true, creaClienti: true } });
  });
});
