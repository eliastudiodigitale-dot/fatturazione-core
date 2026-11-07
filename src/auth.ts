import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';

export type Chiamante = 'n8n' | 'dashboard' | 'owner';

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

/** Confronto a tempo costante su digest di lunghezza fissa; prova sempre tutti i token. */
export function creaVerificaToken(tokens: Config['tokens']) {
  const attesi = (Object.entries(tokens) as [Chiamante, string][]).map(([k, v]) => [k, digest(v)] as const);
  return (header: string | undefined): Chiamante | undefined => {
    if (!header || !header.startsWith('Bearer ')) return undefined;
    const d = digest(header.slice(7).trim());
    let trovato: Chiamante | undefined;
    for (const [k, att] of attesi) if (timingSafeEqual(d, att)) trovato = k;
    return trovato;
  };
}

export function hmacUguale(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
