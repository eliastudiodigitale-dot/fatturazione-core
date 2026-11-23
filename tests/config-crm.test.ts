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
  it('SLA: predefiniti 24/72 ore, per attività con TICKET_SLA_ORE, formato controllato', () => {
    const c = cfg({ TICKET_SLA_ORE: 'heyciar.it=48/72,reti.gazzolaelia.it=8/24' });
    expect(c.ticket.sla).toMatchObject({ primaRispostaOre: 24, risoluzioneOre: 72, perBusiness: { 'heyciar.it': { primaRispostaOre: 48, risoluzioneOre: 72 }, 'reti.gazzolaelia.it': { primaRispostaOre: 8, risoluzioneOre: 24 } } });
    expect(() => cfg({ TICKET_SLA_ORE: 'heyciar.it=48' })).toThrow('TICKET_SLA_ORE');
    expect(cfg({ TICKET_SLA_PRIMA_RISPOSTA_ORE: '4', TICKET_SLA_RISOLUZIONE_ORE: '12' }).ticket.sla).toMatchObject({ primaRispostaOre: 4, risoluzioneOre: 12 });
  });
});

describe('CRM con ClickUp', () => {
  it('attivo con ClickUp e almeno una lista; alias e tempi letti', () => {
    const c = cfg().crm!;
    expect(c).toMatchObject({ clientiListId: 'lista-clienti', ticketListId: 'lista-ticket', syncClientiMin: 60, syncTicketMin: 10, creaClienti: false });
    expect(c.alias).toEqual({ reti: 'reti.gazzolaelia.it', heyciar: 'heyciar.it' });
    expect(cfg({ CRM_CREA_CLIENTI: 'true', CRM_SYNC_TICKET_MIN: '5' }).crm).toMatchObject({ creaClienti: true, syncTicketMin: 5 });
  });
  it('spento senza liste (anche con ClickUp configurato)', () => {
    expect(cfg({ CLICKUP_LIST_ID_CLIENTI: undefined, CLICKUP_LIST_ID_TICKET: undefined }).crm).toBeUndefined();
  });
  it('la lista ticket richiede il campo ref: senza si rischiano task doppie', () => {
    expect(() => cfg({ CLICKUP_TICKET_CAMPO_REF_ID: undefined })).toThrow('CLICKUP_TICKET_CAMPO_REF_ID');
  });
  it('intervalli fuori misura e alias malformati: errore', () => {
    expect(() => cfg({ CRM_SYNC_TICKET_MIN: '1' })).toThrow('CRM_SYNC_TICKET_MIN');
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
    expect(JSON.parse(testo)).toMatchObject({ dashboard: true, fonteTicket: ['heyciar', 'serrandasu', 'reti'], crm: { clienti: true, ticket: true, creaClienti: true } });
  });
});
