import { Writable } from 'node:stream';
import pg from 'pg';
import { caricaConfig, type Config } from '../src/config.js';
import { creaPool } from '../src/db.js';
import { Blocco } from '../src/blocco.js';
import { creaApp, opzioniLogger } from '../src/app.js';
import { creaEventi, type Elaboratore } from '../src/eventi.js';
import type { Notificatore } from '../src/notifiche.js';
import type { ClickUpApi, NuovaTask, TaskInfo } from '../src/clickup.js';
import type { StripeApi } from '../src/stripe.js';
import { ENV_TEST, PORTA } from './setup/env.js';

export const cfgTest = (extra: Record<string, string> = {}): Config => caricaConfig({ ...ENV_TEST, ...extra });

export const admin = new pg.Pool({ host: '127.0.0.1', port: PORTA, user: 'postgres', password: 'test', database: 'fatturazione', max: 2 });

export async function svuota() {
  await admin.query('TRUNCATE storico, documenti, eventi_ricevuti, contatori RESTART IDENTITY CASCADE');
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

export async function costruisci(o: { cfg?: Config; pool: pg.Pool; elaboratori?: Record<string, Elaboratore>; stripe?: StripeApi; sbloccato?: boolean; logger?: unknown }) {
  const cfg = o.cfg ?? cfgTest();
  const blocco = new Blocco(cfg.forzaBlocco);
  if (o.sbloccato !== false) blocco.esito([]);
  const notif = notificheFinte();
  const eventi = creaEventi(o.pool, logMuto, notif, o.elaboratori ?? {}, () => blocco.bloccato);
  const app = await creaApp({ cfg, pool: o.pool, blocco, eventi, stripe: o.stripe, logger: (o.logger as never) ?? false });
  return { app, blocco, eventi, notif, cfg };
}

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
  task = new Map<string, { lista: string; chiave: string | null; t?: NuovaTask; collegati: string[] }>();
  giu = false;
  /** Lancia dopo aver creato la task (simula pod ucciso / conferma persa). */
  crashDopoCreazione = false;
  chiamate = 0;
  private seq = 0;
  private check() {
    this.chiamate++;
    if (this.giu) throw new Error('ClickUp giù');
  }
  async cercaPerChiave(listId: string, chiave: string) {
    this.check();
    return [...this.task].filter(([, v]) => v.lista === listId && v.chiave === chiave).map(([k]) => k);
  }
  async creaTask(listId: string, t: NuovaTask) {
    this.check();
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
  async elencaTask(listId: string): Promise<TaskInfo[]> {
    this.check();
    return [...this.task].filter(([, v]) => v.lista === listId).map(([id, v]) => ({ id, chiave: v.chiave }));
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
