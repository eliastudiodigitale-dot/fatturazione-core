import type pg from 'pg';
import type { Config, Tipo } from './config.js';
import { listeUniche, type ClickUpApi } from './clickup.js';

/**
 * Modalità bloccata (SPEC 7): finché è attiva /readyz risponde 503 e nessuna riserva è consentita.
 * Si parte sempre bloccati; si sblocca solo se il controllo dei contatori passa e FORZA_BLOCCO non è attivo.
 */
export class Blocco {
  bloccato = true;
  motivo = 'avvio';
  constructor(private readonly forza: boolean) {
    if (forza) this.motivo = 'FORZA_BLOCCO';
  }
  esito(problemi: string[]) {
    if (this.forza) {
      this.bloccato = true;
      this.motivo = 'FORZA_BLOCCO';
    } else if (problemi.length > 0) {
      this.bloccato = true;
      this.motivo = problemi.join('; ');
    } else {
      this.bloccato = false;
      this.motivo = '';
    }
  }
}

/**
 * Contatore >= massimo numero in documenti e >= massimo numero trovato in ClickUp, per ogni (anno, tipo).
 * Richiede SELECT su contatori (migrazione 003). Mai correzioni automatiche: si segnala e basta.
 */
export async function controlloContatori(
  pool: pg.Pool,
  clickup?: { api: ClickUpApi; listId: Record<Tipo, string> },
): Promise<string[]> {
  const problemi: string[] = [];
  const cont = new Map<string, number>();
  for (const r of (await pool.query<{ anno: number; tipo: Tipo; ultimo: number }>('SELECT anno, tipo, ultimo FROM contatori')).rows)
    cont.set(`${r.anno}|${r.tipo}`, r.ultimo);

  const massimi = new Map<string, number>();
  const su = (k: string, n: number) => massimi.set(k, Math.max(massimi.get(k) ?? 0, n));
  for (const r of (await pool.query<{ anno: number; tipo: Tipo; m: number }>('SELECT anno, tipo, max(numero) AS m FROM documenti GROUP BY 1, 2')).rows)
    su(`${r.anno}|${r.tipo}`, r.m);
  if (clickup) {
    // Anche le task create a mano prima del servizio (numeri nei campi Anno / nr-fattura / nr-proforma):
    // se il contatore è indietro rispetto a loro, il servizio resta bloccato invece di riemettere numeri già usati.
    for (const lista of listeUniche(clickup.listId)) {
      for (const t of await clickup.api.elencaTask(lista)) for (const c of t.numeri) su(`${c.anno}|${c.tipo}`, c.numero);
    }
  }
  for (const [k, m] of massimi) {
    const u = cont.get(k) ?? 0;
    if (u < m) problemi.push(`contatore ${k} = ${u} < massimo trovato ${m}`);
  }
  return problemi;
}
