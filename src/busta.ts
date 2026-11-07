import type { Tipo } from './config.js';
import type { Chiamante } from './auth.js';
import type { Payload } from './documenti.js';

export interface Cliente {
  nome?: string;
  ragione_sociale?: string;
  email?: string;
  pec?: string;
  telefono?: string;
  codice_fiscale?: string;
  partita_iva?: string;
  codice_destinatario?: string;
  indirizzo?: { via?: string; cap?: string; citta?: string; provincia?: string; paese?: string };
}

export interface Busta {
  fonte: 'clickup' | 'dashboard';
  ref: string;
  tipo: Tipo;
  business: string;
  cliente: Cliente;
  righe: { descrizione: string; importo: number }[];
  rata?: string;
  /** Rifacimento di una proforma annullata: la ref prende il suffisso `|v<versione>`. */
  versione?: number;
  /** Rifare dopo un annullo senza sapere la versione: il servizio usa la prima ref (base, |v2, |v3...) non annullata. */
  auto_versione?: boolean;
  /** Fattura emessa a partire da una proforma: ref della proforma. */
  rif_proforma?: string;
  note?: string;
  dati_fonte?: { clickup?: { task_progetto_id: string; list_id_documenti?: string; campo_relationship_id?: string; url_progetto?: string; nome_progetto?: string; cliente_task_id?: string } } & Record<string, unknown>;
}

const testo = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
const email = { type: 'string', maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' };

export const schemaCliente = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nome: testo(200),
    ragione_sociale: testo(200),
    email,
    pec: email,
    telefono: testo(40),
    codice_fiscale: { type: 'string', pattern: '^([A-Za-z0-9]{16}|[0-9]{11})$' },
    partita_iva: { type: 'string', pattern: '^([0-9]{11}|[A-Z]{2}[A-Za-z0-9]{2,13})$' },
    codice_destinatario: { type: 'string', pattern: '^[A-Za-z0-9]{6,7}$' },
    indirizzo: {
      type: 'object',
      additionalProperties: false,
      properties: {
        via: testo(200),
        cap: { type: 'string', pattern: '^[A-Za-z0-9 -]{3,10}$' },
        citta: testo(100),
        provincia: { type: 'string', pattern: '^[A-Za-z]{2}$' },
        paese: { type: 'string', pattern: '^[A-Z]{2}$' },
      },
    },
  },
} as const;

export const schemaBusta = {
  type: 'object',
  additionalProperties: false,
  required: ['fonte', 'ref', 'tipo', 'business', 'cliente', 'righe'],
  properties: {
    fonte: { type: 'string', enum: ['clickup', 'dashboard'] },
    ref: testo(200),
    tipo: { type: 'string', enum: ['fattura', 'proforma'] },
    business: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' }, // es. serrandasu.it
    rata: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' },
    versione: { type: 'integer', minimum: 2, maximum: 99 },
    auto_versione: { type: 'boolean' },
    rif_proforma: testo(200),
    note: testo(2000),
    cliente: schemaCliente,
    righe: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descrizione', 'importo'],
        properties: { descrizione: testo(1000), importo: { type: 'number', minimum: -10_000_000, maximum: 10_000_000 } },
      },
    },
    dati_fonte: {
      type: 'object',
      maxProperties: 5,
      properties: {
        clickup: {
          type: 'object',
          additionalProperties: false,
          required: ['task_progetto_id'],
          properties: {
            task_progetto_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
            list_id_documenti: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
            campo_relationship_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
            url_progetto: { type: 'string', maxLength: 500, pattern: '^https://' },
            nome_progetto: testo(200),
            cliente_task_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
          },
        },
      },
    },
  },
} as const;

/** Importo in euro con al massimo 2 decimali, restituito in centesimi interi; undefined se non valido. */
export function centesimi(n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  const c = Math.round(n * 100);
  return Math.abs(c - n * 100) < 1e-6 ? c : undefined;
}

export function refAttesa(b: Busta): string | undefined {
  const v = b.versione ? `|v${b.versione}` : '';
  if (b.fonte === 'clickup') {
    const tp = b.dati_fonte?.clickup?.task_progetto_id;
    return tp ? `${tp}|${b.tipo}|${b.rata ?? 'unica'}${v}` : undefined;
  }
  return undefined;
}

/** Controlli oltre lo schema: chi può usare quale fonte, forma della ref, importi (SPEC 4.2). */
export function controllaBusta(b: Busta, chiamante: Chiamante): string | undefined {
  if (b.fonte === 'clickup' && chiamante !== 'n8n' && chiamante !== 'owner') return 'fonte non consentita per questo token';
  if (b.fonte === 'dashboard' && chiamante !== 'dashboard' && chiamante !== 'owner') return 'fonte non consentita per questo token';
  if (b.fonte === 'clickup') {
    const atteso = refAttesa(b);
    if (!atteso) return 'dati_fonte.clickup.task_progetto_id obbligatorio';
    if (b.ref !== atteso) return `ref non coerente: attesa ${atteso}`;
  } else {
    const v = b.versione ? `\\|v${b.versione}` : '';
    if (!new RegExp(`^dashboard\\|[A-Za-z0-9_.:-]{1,100}\\|${b.tipo}${v}$`).test(b.ref)) return 'ref non coerente: attesa dashboard|<id>|<tipo>[|v<versione>]';
  }
  if (!b.cliente.nome && !b.cliente.ragione_sociale) return 'cliente: serve nome o ragione_sociale';
  let tot = 0;
  for (const r of b.righe) {
    const c = centesimi(r.importo);
    if (c === undefined) return 'importo non valido: massimo 2 decimali';
    tot += c;
  }
  if (tot <= 0) return 'totale del documento non positivo (le correzioni si fanno con nota di credito)';
  if (b.rif_proforma && b.tipo !== 'fattura') return 'rif_proforma ammesso solo su una fattura';
  if (b.auto_versione && b.versione) return 'usare auto_versione oppure versione, non entrambi';
  return undefined;
}

/** Dati che serviranno all'XML SDI (Fase 2): non bloccano oggi, ma il chiamante li vede subito. */
export function avvisiBusta(b: Busta): string[] {
  if (b.tipo !== 'fattura') return [];
  const a: string[] = [];
  const c = b.cliente;
  if (!c.codice_fiscale && !c.partita_iva) a.push('manca codice_fiscale o partita_iva (servirà per lo SDI)');
  if (!c.indirizzo?.via || !c.indirizzo.cap || !c.indirizzo.citta) a.push('indirizzo incompleto (servirà per lo SDI)');
  if (c.partita_iva && !c.codice_destinatario && !c.pec) a.push('azienda senza codice_destinatario né pec (verrà usato 0000000)');
  return a;
}

/** Payload minimo: solo ciò che serve a rigenerare la task in ClickUp. */
export function payloadDaBusta(b: Busta): Payload {
  const p: Payload = { cliente: b.cliente as Record<string, unknown>, righe: b.righe, rata: b.rata ?? 'unica' };
  if (b.versione) p.versione = b.versione;
  if (b.rif_proforma) p.rif_proforma = b.rif_proforma;
  if (b.note) p.note = b.note;
  if (b.dati_fonte) p.dati_fonte = b.dati_fonte;
  return p;
}

/** JSON con chiavi ordinate, per confrontare il payload ricevuto con quello già salvato (jsonb riordina le chiavi). */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(',')}}`;
}
