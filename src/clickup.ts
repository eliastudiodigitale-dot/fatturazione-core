import type { CampiClickUp, Tipo } from './config.js';

export interface NumeroDoc {
  tipo: Tipo;
  anno: number;
  numero: number;
}

export interface TaskInfo {
  id: string;
  /** Chiave scritta dal servizio: una o più `<tipo>|<anno>|<numero>` separate da spazio (proforma e poi fattura sulla stessa task). */
  chiave: string | null;
  /** Numeri che la task occupa: dalla chiave, oppure dai campi storici (Anno + nr-fattura/nr-proforma + checkbox). */
  numeri: NumeroDoc[];
}

export type ValoreCampo = string | number | boolean;
export interface NuovaTask {
  nome: string;
  descrizione: string;
  campi: { id: string; value: ValoreCampo; value_options?: { time: boolean } }[];
}

export interface CampoLista {
  id: string;
  name: string;
  type: string;
  options: { id: string; name: string }[];
}

/** Ciò che il servizio usa di ClickUp. Nei test si sostituisce con un finto. */
export interface ClickUpApi {
  cercaPerChiave(listId: string, chiave: string): Promise<string[]>;
  creaTask(listId: string, t: NuovaTask): Promise<string>;
  collegaProgetto(taskId: string, campoRelationshipId: string, taskProgettoId: string): Promise<void>;
  elencaTask(listId: string): Promise<TaskInfo[]>;
  /** Campi della lista con le opzioni dei menu a tendina (per scrivere AREA e metodo di pagamento per nome). */
  campiLista(listId: string): Promise<CampoLista[]>;
}

export class ErroreClickUp extends Error {
  constructor(
    readonly status: number,
    msg: string,
  ) {
    super(msg);
  }
}

/** Chiave univoca del documento scritta in un campo custom della task: `<tipo>|<anno>|<numero>`. */
export function chiaveDocumento(tipo: Tipo, anno: number, numero: number): string {
  return `${tipo}|${anno}|${numero}`;
}
export function leggiChiave(s: string): NumeroDoc | undefined {
  const m = /^(fattura|proforma)\|(\d{4})\|(\d+)$/.exec(s);
  if (!m) return undefined;
  return { tipo: m[1] as Tipo, anno: Number(m[2]), numero: Number(m[3]) };
}

/** Tutte le chiavi valide in un campo (separate da spazi, virgole o punto e virgola). */
export function chiaviIn(s: string): NumeroDoc[] {
  return s.split(/[\s,;]+/).map(leggiChiave).filter((x): x is NumeroDoc => Boolean(x));
}
export function contieneChiave(campo: string | null, chiave: string): boolean {
  return Boolean(campo && campo.split(/[\s,;]+/).includes(chiave));
}

/** Elenco senza ripetizioni delle liste da leggere (fatture e proforme possono stare nella stessa lista). */
export function listeUniche(listId: Record<Tipo, string>): string[] {
  return [...new Set([listId.fattura, listId.proforma])];
}

type RawCampo = { id: string; value?: unknown };
type RawTask = { id: string; custom_fields?: RawCampo[] };

const vero = (v: unknown) => v === true || v === 'true';
const intero = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Legge chiave e numeri occupati da una task (anche creata a mano prima del servizio). */
export function infoTask(t: RawTask, campi: CampiClickUp): TaskInfo {
  const val = (id?: string) => (id ? t.custom_fields?.find((c) => c.id === id)?.value : undefined);
  const ch = val(campi.chiave);
  const chiave = typeof ch === 'string' && ch !== '' ? ch : null;
  const daChiave = chiave ? chiaviIn(chiave) : [];
  if (daChiave.length) return { id: t.id, chiave, numeri: daChiave };
  const numeri: NumeroDoc[] = [];
  // Anno dal campo Anno; se manca, dalla data del documento o della fattura (le task storiche non sempre lo hanno).
  const annoDa = (v: unknown) => {
    const ms = intero(v);
    return ms ? Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric' }).format(new Date(ms))) : undefined;
  };
  const anno = intero(val(campi.anno)) ?? annoDa(val(campi.dataDocumento)) ?? annoDa(val(campi.dataFattura));
  if (anno) {
    for (const tipo of ['fattura', 'proforma'] as const) {
      const n = intero(val(campi.numero[tipo]));
      // Con il checkbox configurato serve che sia spuntato; senza checkbox basta il numero.
      const flagOk = campi.flag[tipo] ? vero(val(campi.flag[tipo])) : true;
      if (n && flagOk) numeri.push({ tipo, anno, numero: n });
    }
  }
  return { id: t.id, chiave, numeri };
}

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Client HTTP: richieste in coda una alla volta, distanziate per restare sotto `rpm`
 * (quota condivisa con n8n e con le altre app che usano lo stesso token), retry con backoff su 429, 5xx ed errori di rete.
 */
export function creaClickUp(o: { token: string; apiUrl: string; rpm: number; campi: CampiClickUp; fetchFn?: typeof fetch }): ClickUpApi {
  const f = o.fetchFn ?? fetch;
  const intervallo = Math.ceil(60_000 / o.rpm);
  let coda: Promise<unknown> = Promise.resolve();
  let ultima = 0;

  async function una(metodo: string, path: string, body?: unknown): Promise<unknown> {
    for (let tentativo = 0; ; tentativo++) {
      const attesa = ultima + intervallo - Date.now();
      if (attesa > 0) await attendi(attesa);
      ultima = Date.now();
      let res: Response | undefined;
      try {
        res = await f(`${o.apiUrl}${path}`, {
          method: metodo,
          headers: { Authorization: o.token, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        res = undefined;
      }
      if (res && res.ok) return res.status === 204 ? null : res.json();
      const ritentabile = !res || res.status === 429 || res.status >= 500;
      if (!ritentabile || tentativo >= 4) throw new ErroreClickUp(res?.status ?? 0, `ClickUp ${metodo} ${path.split('?')[0]} -> ${res?.status ?? 'rete'}`);
      let ms = 1000 * 2 ** tentativo;
      const reset = res?.headers.get('x-ratelimit-reset');
      if (res?.status === 429 && reset) ms = Math.max(ms, Number(reset) * 1000 - Date.now());
      await attendi(Math.min(ms, 60_000));
    }
  }
  function richiesta(metodo: string, path: string, body?: unknown): Promise<unknown> {
    const p = coda.then(() => una(metodo, path, body));
    coda = p.catch(() => undefined);
    return p;
  }

  async function pagine(listId: string, extra: string): Promise<RawTask[]> {
    const out: RawTask[] = [];
    for (const archived of ['false', 'true']) {
      for (let page = 0; page < 1000; page++) {
        const r = (await richiesta('GET', `/list/${encodeURIComponent(listId)}/task?include_closed=true&subtasks=true&archived=${archived}&page=${page}${extra}`)) as {
          tasks: RawTask[];
          last_page?: boolean;
        };
        out.push(...r.tasks);
        if (r.last_page !== false || r.tasks.length === 0) break;
      }
    }
    return out;
  }

  const cacheCampi = new Map<string, CampoLista[]>();

  return {
    async cercaPerChiave(listId, chiave) {
      // Il campo può contenere più chiavi (proforma + fattura): si cerca tra le task con il campo compilato.
      const filtro = encodeURIComponent(JSON.stringify([{ field_id: o.campi.chiave, operator: 'IS NOT NULL' }]));
      const tasks = await pagine(listId, `&custom_fields=${filtro}`);
      return tasks.filter((t) => contieneChiave(infoTask(t, o.campi).chiave, chiave)).map((t) => t.id);
    },
    async creaTask(listId, t) {
      const r = (await richiesta('POST', `/list/${encodeURIComponent(listId)}/task`, {
        name: t.nome,
        markdown_description: t.descrizione,
        custom_fields: t.campi,
      })) as { id: string };
      return r.id;
    },
    async collegaProgetto(taskId, campo, progetto) {
      await richiesta('POST', `/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(campo)}`, { value: { add: [progetto], rem: [] } });
    },
    async elencaTask(listId) {
      return (await pagine(listId, '')).map((t) => infoTask(t, o.campi));
    },
    async campiLista(listId) {
      const c = cacheCampi.get(listId);
      if (c) return c;
      const r = (await richiesta('GET', `/list/${encodeURIComponent(listId)}/field`)) as {
        fields: { id: string; name: string; type: string; type_config?: { options?: { id: string; name: string }[] } }[];
      };
      const campi = r.fields.map((x) => ({ id: x.id, name: x.name, type: x.type, options: (x.type_config?.options ?? []).map((op) => ({ id: op.id, name: op.name })) }));
      cacheCampi.set(listId, campi);
      return campi;
    },
  };
}
