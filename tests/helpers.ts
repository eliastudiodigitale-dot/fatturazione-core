import { Writable } from 'node:stream';
import pg from 'pg';
import { caricaConfig, type Config, type CrmConfig } from '../src/config.js';
import { ErroreBackend, type BackendTicket, type MessaggioRemoto, type ModificaRemota, type TicketRemoto } from '../src/ticket-backend.js';
import { creaPool } from '../src/db.js';
import { Blocco } from '../src/blocco.js';
import { creaApp, opzioniLogger } from '../src/app.js';
import { creaEventi, type Elaboratore } from '../src/eventi.js';
import type { Notificatore } from '../src/notifiche.js';
import { ErroreClickUp, leggiChiave, type CampoLista, type ClickUpApi, type NuovaTask, type TaskCrm, type TaskInfo } from '../src/clickup.js';
import type { StripeApi } from '../src/stripe.js';
import { ENV_TEST, PORTA } from './setup/env.js';

export const cfgTest = (extra: Record<string, string> = {}): Config => caricaConfig({ ...ENV_TEST, ...extra });

export const admin = new pg.Pool({ host: '127.0.0.1', port: PORTA, user: 'postgres', password: 'test', database: 'fatturazione', max: 2 });

/** Regole SLA di partenza dei test: 24/72 ore ovunque, heyciar.it 48/72 più i piani 48h, 3g, 5g, 7g (nessun piano predefinito). */
export async function impostaSlaTest() {
  await admin.query('TRUNCATE sla_piani, sla_business');
  await admin.query(`INSERT INTO sla_business (business, prima_risposta_ore, risoluzione_ore, piano_predefinito) VALUES ('*', 24, 72, NULL), ('heyciar.it', 48, 72, NULL)`);
  await admin.query(`INSERT INTO sla_piani (business, piano, prima_risposta_ore, risoluzione_ore) VALUES ('heyciar.it','48h',24,48), ('heyciar.it','3g',36,72), ('heyciar.it','5g',60,120), ('heyciar.it','7g',84,168)`);
}

export async function svuota() {
  await admin.query(
    'TRUNCATE storico, documenti, eventi_ricevuti, contatori, ticket_messaggi, ticket_eventi, ticket, crm_clienti, crm_sync, crm_contatti, crm_note, crm_attivita, crm_opportunita, crm_viste, utenti_dashboard, risposte_rapide RESTART IDENTITY CASCADE',
  );
  await impostaSlaTest();
}

export function poolApp() {
  return creaPool(cfgTest().pg);
}

export function notificheFinte(): Notificatore & { lista: { codice: string; dettagli: unknown }[] } {
  const lista: { codice: string; dettagli: unknown }[] = [];
  return { lista, anomalia: (codice, dettagli) => void lista.push({ codice, dettagli }) };
}

export function logCatturato() {
  const righe: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      righe.push(chunk.toString());
      cb();
    },
  });
  return { righe, logger: { ...opzioniLogger, level: 'info', stream } };
}

const logMuto = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, child() { return logMuto; }, level: 'silent', silent() {} } as never;
export { logMuto };

export async function costruisci(o: {
  cfg?: Config;
  pool: pg.Pool;
  elaboratori?: Record<string, Elaboratore>;
  stripe?: StripeApi;
  sbloccato?: boolean;
  logger?: unknown;
  dashboard?: { fetchFn?: typeof fetch; ora?: () => number };
  operativo?: { backends?: Record<string, BackendTicket>; crm?: { api?: ClickUpApi; cfg?: CrmConfig } };
}) {
  const cfg = o.cfg ?? cfgTest();
  const blocco = new Blocco(cfg.forzaBlocco);
  if (o.sbloccato !== false) blocco.esito([]);
  const notif = notificheFinte();
  const eventi = creaEventi(o.pool, logMuto, notif, o.elaboratori ?? {}, () => blocco.bloccato);
  const app = await creaApp({ cfg, pool: o.pool, blocco, eventi, stripe: o.stripe, logger: (o.logger as never) ?? false, notif, dashboard: o.dashboard, operativo: o.operativo });
  return { app, blocco, eventi, notif, cfg };
}

export const AUTH_FONTE = {
  heyciar: { authorization: `Bearer ${ENV_TEST.TICKET_TOKEN_HEYCIAR}` },
  serrandasu: { authorization: `Bearer ${ENV_TEST.TICKET_TOKEN_SERRANDASU}` },
  reti: { authorization: `Bearer ${ENV_TEST.TICKET_TOKEN_RETI}` },
};

export const AUTH = {
  n8n: { authorization: `Bearer ${ENV_TEST.N8N_TOKEN}` },
  dashboard: { authorization: `Bearer ${ENV_TEST.DASHBOARD_TOKEN}` },
  owner: { authorization: `Bearer ${ENV_TEST.OWNER_TOKEN}` },
};

export function bustaClickup(progetto: string, o: { tipo?: 'fattura' | 'proforma'; rata?: string } = {}) {
  const tipo = o.tipo ?? 'fattura';
  return {
    fonte: 'clickup',
    ref: `${progetto}|${tipo}|${o.rata ?? 'unica'}`,
    tipo,
    business: 'arch-design',
    ...(o.rata ? { rata: o.rata } : {}),
    cliente: { nome: 'Mario Rossi', email: 'mario.rossi@example.com' },
    righe: [{ descrizione: 'Progetto', importo: 1000 }],
    dati_fonte: { clickup: { task_progetto_id: progetto, campo_relationship_id: 'campo-rel' } },
  };
}

/** ClickUp finto in memoria, con guasti simulabili. */
export class ClickUpFinto implements ClickUpApi {
  task = new Map<string, { lista: string; chiave: string | null; t?: NuovaTask; collegati: string[]; numeri?: { tipo: 'fattura' | 'proforma'; anno: number; numero: number }[] }>();
  giu = false;
  /** Lancia dopo aver creato la task (simula pod ucciso / conferma persa). */
  crashDopoCreazione = false;
  /** Liste che ClickUp rifiuta con 400 (ID sbagliato). */
  rifiutaLista = new Set<string>();
  chiamate = 0;
  private seq = 0;
  private check() {
    this.chiamate++;
    if (this.giu) throw new Error('ClickUp giù');
  }
  async cercaPerChiave(listId: string, chiave: string) {
    this.check();
    if (this.rifiutaLista.has(listId)) throw new ErroreClickUp(400, 'lista non valida');
    return [...this.task].filter(([, v]) => v.lista === listId && v.chiave === chiave).map(([k]) => k);
  }
  async creaTask(listId: string, t: NuovaTask) {
    this.check();
    if (this.rifiutaLista.has(listId)) throw new ErroreClickUp(400, 'lista non valida');
    const id = `t${++this.seq}`;
    const chiave = String(t.campi.find((c) => c.id === 'campo-chiave')?.value ?? '');
    this.task.set(id, { lista: listId, chiave, t, collegati: [] });
    if (this.crashDopoCreazione) {
      this.crashDopoCreazione = false;
      throw new Error('processo interrotto');
    }
    return id;
  }
  async collegaProgetto(taskId: string, _campo: string, progetto: string) {
    this.check();
    this.task.get(taskId)?.collegati.push(progetto);
  }
  /** Task storica creata a mano (senza chiave), con i numeri nei campi Anno / nr-*. */
  aggiungiAMano(listId: string, numeri: { tipo: 'fattura' | 'proforma'; anno: number; numero: number }[]) {
    const id = `m${++this.seq}`;
    this.task.set(id, { lista: listId, chiave: null, collegati: [], numeri });
    return id;
  }
  opzioni: CampoLista[] = [];
  async campiLista(): Promise<CampoLista[]> {
    this.check();
    return this.opzioni;
  }
  /** Task CRM scritte a mano dal test (clienti, ticket aperti da un operatore in ClickUp). */
  crm = new Map<string, TaskCrm[]>();
  /** Modifiche "fatte in ClickUp" su task create dal servizio (stato, assegnati, priorità...). */
  modifiche = new Map<string, Partial<TaskCrm>>();
  ultimoFiltroData: Date | undefined;
  aggiungiCrm(listId: string, t: Partial<TaskCrm> & { id: string; nome: string }): TaskCrm {
    const completa: TaskCrm = { stato: { nome: 'to do', tipo: 'open' }, priorita: null, creata: new Date(), modificata: new Date(), chiusa: null, assegnati: [], tag: [], campi: {}, ...t };
    this.crm.set(listId, [...(this.crm.get(listId) ?? []), completa]);
    return completa;
  }
  async elencaTaskCrm(listId: string, o: { modificateDopo?: Date } = {}): Promise<TaskCrm[]> {
    this.check();
    this.ultimoFiltroData = o.modificateDopo;
    // Le task create dal servizio in quella lista tornano come task CRM (come farebbe ClickUp).
    const create = [...this.task]
      .filter(([, v]) => v.lista === listId && v.t)
      .map(([id, v]): TaskCrm => ({
        id,
        nome: v.t!.nome,
        stato: { nome: 'to do', tipo: 'open' },
        priorita: null,
        creata: new Date(),
        modificata: new Date(),
        chiusa: null,
        assegnati: [],
        tag: [],
        campi: Object.fromEntries(v.t!.campi.map((c) => [c.id, Array.isArray(c.value) ? (c.value as unknown[]).map(String) : String(c.value)])),
        ...this.modifiche.get(id),
      }));
    const tutte = [...(this.crm.get(listId) ?? []), ...create];
    return tutte.filter((t) => !o.modificateDopo || (t.modificata ?? new Date(0)) > o.modificateDopo);
  }
  /** Scritture fatte dal portale sulle schede cliente. */
  aggiornamenti: { taskId: string; mod: { nome?: string; stato?: string } }[] = [];
  campiImpostati: { taskId: string; campoId: string; valore: unknown }[] = [];
  async aggiornaTask(taskId: string, mod: { nome?: string; stato?: string }): Promise<void> {
    this.check();
    this.aggiornamenti.push({ taskId, mod });
  }
  async impostaCampo(taskId: string, campoId: string, valore: unknown): Promise<void> {
    this.check();
    this.campiImpostati.push({ taskId, campoId, valore });
  }
  async elencaTask(listId: string): Promise<TaskInfo[]> {
    this.check();
    return [...this.task]
      .filter(([, v]) => v.lista === listId)
      .map(([id, v]) => {
        const k = v.chiave ? leggiChiave(v.chiave) : undefined;
        return { id, chiave: v.chiave, numeri: k ? [k] : (v.numeri ?? []) };
      });
  }
}

export async function aspetta(cond: () => Promise<boolean>, ms = 5000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condizione non raggiunta');
}

/** Backend ticket di un business, finto: tiene i ticket in memoria e registra le chiamate ricevute dal portale. */
export class BackendFinto implements BackendTicket {
  ticket: TicketRemoto[] = [];
  msg = new Map<string, MessaggioRemoto[]>();
  chiamate: { op: string; id?: string; dati?: unknown }[] = [];
  giu = false;
  ultimoDopo: Date | undefined;
  private seq = 0;
  private errore(): never {
    // Stessa classe usata dal client reale, importata qui per non dipendere dall'ordine dei moduli.
    throw new ErroreBackend(0, 'backend ticket non raggiungibile (finto)');
  }
  async elenca(dopo?: Date) {
    if (this.giu) this.errore();
    this.ultimoDopo = dopo;
    this.chiamate.push({ op: 'elenca' });
    return this.ticket;
  }
  async messaggi(id: string) {
    if (this.giu) this.errore();
    return this.msg.get(id) ?? [];
  }
  async rispondi(id: string, m: { testo: string; autore: string; interno: boolean }) {
    if (this.giu) this.errore();
    this.chiamate.push({ op: 'rispondi', id, dati: m });
    // Come un backend vero: il messaggio si rilegge nella conversazione.
    (this.msg.get(id) ?? this.msg.set(id, []).get(id)!).push({ quando: new Date(), da: 'staff', autore: m.autore, testo: m.testo, interno: m.interno });
  }
  async aggiorna(id: string, mod: ModificaRemota) {
    if (this.giu) this.errore();
    this.chiamate.push({ op: 'aggiorna', id, dati: mod });
  }
  async crea(n: unknown) {
    if (this.giu) this.errore();
    const id = `r${++this.seq}`;
    this.chiamate.push({ op: 'crea', id, dati: n });
    return { id };
  }
}
