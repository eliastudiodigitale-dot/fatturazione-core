import type { FastifyBaseLogger } from 'fastify';

/**
 * Canale delle anomalie. Il canale vero (email o Telegram) è un punto aperto (SPEC sez. 12):
 * per ora le anomalie finiscono solo nei log con il tag ANOMALIA. Mai PII nei dettagli.
 */
export interface Notificatore {
  anomalia(codice: string, dettagli: Record<string, string | number | boolean | null>): void;
}

export function notificatoreLog(log: FastifyBaseLogger, finestraMs = 6 * 3600_000): Notificatore {
  const ultime = new Map<string, number>();
  return {
    anomalia(codice, dettagli) {
      const k = `${codice}|${JSON.stringify(dettagli)}`;
      const t = Date.now();
      const prima = ultime.get(k);
      if (prima !== undefined && t - prima < finestraMs) return; // niente spam per la stessa anomalia
      ultime.set(k, t);
      log.warn({ anomalia: codice, ...dettagli }, `ANOMALIA ${codice}`);
    },
  };
}
