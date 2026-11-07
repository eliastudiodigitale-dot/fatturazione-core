import type { Tipo } from './config.js';

export interface TaskInfo {
  id: string;
  chiave: string | null;
}

export interface NuovaTask {
  nome: string;
  descrizione: string;
  campi: { id: string; value: string | number }[];
}

/** Ciò che il servizio usa di ClickUp. Nei test si sostituisce con un finto. */
export interface ClickUpApi {
  cercaPerChiave(listId: string, chiave: string): Promise<string[]>;
  creaTask(listId: string, t: NuovaTask): Promise<string>;
  collegaProgetto(taskId: string, campoRelationshipId: string, taskProgettoId: string): Promise<void>;
  elencaTask(listId: string): Promise<TaskInfo[]>;
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
export function leggiChiave(s: string): { tipo: Tipo; anno: number; numero: number } | undefined {
  const m = /^(fattura|proforma)\|(\d{4})\|(\d+)$/.exec(s);
  if (!m) return undefined;
  return { tipo: m[1] as Tipo, anno: Number(m[2]), numero: Number(m[3]) };
}

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Client HTTP: richieste in coda una alla volta, distanziate per restare sotto `rpm`
 * (quota condivisa con n8n e dashboard), retry con backoff su 429, 5xx ed errori di rete.
 */
export function creaClickUp(o: { token: string; apiUrl: string; rpm: number; campoChiave: string; fetchFn?: typeof fetch }): ClickUpApi {
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

  type Raw = { id: string; custom_fields?: { id: string; value?: unknown }[] };
  const chiaveDi = (t: Raw): string | null => {
    const v = t.custom_fields?.find((c) => c.id === o.campoChiave)?.value;
    return typeof v === 'string' ? v : null;
  };

  async function pagine(listId: string, extra: string): Promise<Raw[]> {
    const out: Raw[] = [];
    for (const archived of ['false', 'true']) {
      for (let page = 0; page < 1000; page++) {
        const r = (await richiesta('GET', `/list/${encodeURIComponent(listId)}/task?include_closed=true&subtasks=true&archived=${archived}&page=${page}${extra}`)) as {
          tasks: Raw[];
          last_page?: boolean;
        };
        out.push(...r.tasks);
        if (r.last_page !== false || r.tasks.length === 0) break;
      }
    }
    return out;
  }

  return {
    async cercaPerChiave(listId, chiave) {
      const filtro = encodeURIComponent(JSON.stringify([{ field_id: o.campoChiave, operator: '=', value: chiave }]));
      const tasks = await pagine(listId, `&custom_fields=${filtro}`);
      return tasks.filter((t) => chiaveDi(t) === chiave).map((t) => t.id);
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
      return (await pagine(listId, '')).map((t) => ({ id: t.id, chiave: chiaveDi(t) }));
    },
  };
}
