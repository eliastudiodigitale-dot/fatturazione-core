// Piccoli attrezzi per costruire query con filtri senza concatenare mai valori nel testo SQL.

/** Condizioni WHERE con parametri posizionali: ogni `?` nel frammento diventa il parametro appena aggiunto ($N). */
export class Condizioni {
  readonly params: unknown[] = [];
  private parti: string[] = [];

  aggiungi(frammento: string, valore: unknown): this {
    this.params.push(valore);
    this.parti.push(frammento.replaceAll('?', `$${this.params.length}`));
    return this;
  }
  /** Condizione fissa, senza parametri. */
  fissa(frammento: string): this {
    this.parti.push(frammento);
    return this;
  }
  /** Aggiunge un parametro fuori dal WHERE (LIMIT, OFFSET...) e restituisce il suo segnaposto. */
  parametro(valore: unknown): string {
    this.params.push(valore);
    return `$${this.params.length}`;
  }
  get where(): string {
    return this.parti.length ? `WHERE ${this.parti.join(' AND ')}` : '';
  }
}

/** Cosa può vedere chi chiede: elenco di attività (null = tutte) e se vede gli importi. */
export interface Ambito {
  business: string[] | null;
  soldi: boolean;
}
export const AMBITO_TOTALE: Ambito = { business: null, soldi: true };

/** Attività effettive: l'intersezione tra quelle consentite e quelle chieste. Un elenco vuoto non vede nulla. */
export function businessEffettivi(a: Ambito, richiesti?: string[]): string[] | null {
  const chiesti = richiesti?.filter(Boolean);
  if (!chiesti?.length) return a.business;
  if (a.business === null) return chiesti;
  return chiesti.filter((b) => a.business!.includes(b));
}

/** Testo da cercare con ILIKE: % e _ vanno trattati come caratteri normali. */
export function perIlike(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function limiteOffset(limite: number | undefined, offset: number | undefined, max = 200): { limite: number; offset: number } {
  const l = Number.isInteger(limite) && limite! > 0 ? Math.min(limite!, max) : 50;
  const o = Number.isInteger(offset) && offset! > 0 ? Math.min(offset!, 1_000_000) : 0;
  return { limite: l, offset: o };
}

/** Partita IVA come si confronta: maiuscola, senza spazi e senza prefisso IT. */
export function normalizzaPiva(s: string | null | undefined): string | null {
  const v = (s ?? '').replace(/\s+/g, '').toUpperCase().replace(/^IT(?=\d{11}$)/, '');
  return v === '' ? null : v;
}
export function normalizzaEmail(s: string | null | undefined): string | null {
  const v = (s ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/** Frammenti SQL per collegare un documento (alias d) a una scheda cliente (alias c) per partita IVA o email. */
export const PIVA_DOC = `NULLIF(regexp_replace(upper(d.payload->'cliente'->>'partita_iva'), '^IT(?=[0-9]{11}$)', ''), '')`;
export const EMAIL_DOC = `NULLIF(lower(d.payload->'cliente'->>'email'), '')`;
export const DOC_DI_CLIENTE = `((c.partita_iva IS NOT NULL AND ${PIVA_DOC} = c.partita_iva) OR (c.email IS NOT NULL AND ${EMAIL_DOC} = lower(c.email)))`;
/** Importo di un documento (alias d): somma delle righe, prima del bollo. */
export const TOT_DOC = `(SELECT COALESCE(sum((r->>'importo')::numeric), 0) FROM jsonb_array_elements(d.payload->'righe') r)`;
