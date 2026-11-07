import type { FastifyBaseLogger } from 'fastify';

/**
 * Canale delle anomalie (decisione #21): sempre nei log con tag ANOMALIA e, se configurato, su Telegram.
 * Mai PII nei dettagli: solo ID, conteggi, stati. La stessa anomalia non si ripete prima di `finestraMs`.
 */
export interface Notificatore {
  anomalia(codice: string, dettagli: Record<string, string | number | boolean | null>): void;
}

export function creaNotificatore(
  log: FastifyBaseLogger,
  o: { telegram?: { token: string; chatId: string }; fetchFn?: typeof fetch; finestraMs?: number } = {},
): Notificatore {
  const finestra = o.finestraMs ?? 6 * 3600_000;
  const f = o.fetchFn ?? fetch;
  const ultime = new Map<string, number>();
  return {
    anomalia(codice, dettagli) {
      const k = `${codice}|${JSON.stringify(dettagli)}`;
      const t = Date.now();
      const prima = ultime.get(k);
      if (prima !== undefined && t - prima < finestra) return;
      ultime.set(k, t);
      log.warn({ anomalia: codice, ...dettagli }, `ANOMALIA ${codice}`);
      if (!o.telegram) return;
      const righe = Object.entries(dettagli)
        .filter(([, v]) => v !== null && v !== '')
        .map(([kk, v]) => `${kk}: ${v}`);
      const text = [`⚠️ fatturazione-core: ${codice}`, ...righe].join('\n').slice(0, 3500);
      // L'URL contiene il token: non va mai nei log, nemmeno negli errori.
      f(`https://api.telegram.org/bot${o.telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: o.telegram.chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      })
        .then((r) => {
          if (!r.ok) log.error({ status: r.status }, 'invio Telegram rifiutato');
        })
        .catch(() => log.error('Telegram non raggiungibile'));
    },
  };
}

/** Compatibilità: solo log. */
export const notificatoreLog = (log: FastifyBaseLogger, finestraMs?: number) => creaNotificatore(log, { finestraMs });
