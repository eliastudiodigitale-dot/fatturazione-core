import type { Tipo } from './config.js';
import type { Chiamante } from './auth.js';
import type { Payload } from './documenti.js';

export interface Busta {
  fonte: 'clickup' | 'dashboard';
  ref: string;
  tipo: Tipo;
  business?: string;
  cliente: Record<string, unknown>;
  righe: { descrizione: string; importo: number }[];
  rata?: string;
  dati_fonte?: { clickup?: { task_progetto_id: string; list_id_documenti?: string; campo_relationship_id?: string; url_progetto?: string } } & Record<string, unknown>;
}

const testo = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });

export const schemaBusta = {
  type: 'object',
  additionalProperties: false,
  required: ['fonte', 'ref', 'tipo', 'cliente', 'righe'],
  properties: {
    fonte: { type: 'string', enum: ['clickup', 'dashboard'] },
    ref: testo(200),
    tipo: { type: 'string', enum: ['fattura', 'proforma'] },
    business: testo(100),
    rata: testo(50),
    cliente: { type: 'object', minProperties: 1, maxProperties: 30 },
    righe: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descrizione', 'importo'],
        properties: { descrizione: testo(1000), importo: { type: 'number' } },
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
            task_progetto_id: testo(64),
            list_id_documenti: testo(64),
            campo_relationship_id: testo(64),
            url_progetto: testo(500),
          },
        },
      },
    },
  },
} as const;

/** Controlli oltre lo schema: chi può usare quale fonte e forma della ref (SPEC 4.2). */
export function controllaBusta(b: Busta, chiamante: Chiamante): string | undefined {
  if (b.fonte === 'clickup' && chiamante !== 'n8n' && chiamante !== 'owner') return 'fonte non consentita per questo token';
  if (b.fonte === 'dashboard' && chiamante !== 'dashboard' && chiamante !== 'owner') return 'fonte non consentita per questo token';
  if (b.ref.includes('\n')) return 'ref non valida';
  if (b.fonte === 'clickup') {
    const tp = b.dati_fonte?.clickup?.task_progetto_id;
    if (!tp) return 'dati_fonte.clickup.task_progetto_id obbligatorio';
    const atteso = `${tp}|${b.tipo}|${b.rata ?? 'unica'}`;
    if (b.ref !== atteso) return 'ref non coerente: atteso <task_progetto_id>|<tipo>|<rata>';
  } else {
    if (!/^dashboard\|[A-Za-z0-9_.:-]{1,100}\|(fattura|proforma)$/.test(b.ref) || !b.ref.endsWith(`|${b.tipo}`))
      return 'ref non coerente: atteso dashboard|<id>|<tipo>';
  }
  if (b.righe.some((r) => !Number.isFinite(r.importo))) return 'importo non valido';
  return undefined;
}

/** Payload minimo: solo ciò che serve a rigenerare la task in ClickUp. */
export function payloadDaBusta(b: Busta): Payload {
  return { cliente: b.cliente, righe: b.righe, rata: b.rata ?? 'unica', dati_fonte: b.dati_fonte };
}
