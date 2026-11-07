/** Finestra fissa di un minuto per chiave (fonte). In memoria: il servizio gira con una replica. */
export function creaRateLimit(perMinuto: number, ora: () => number = Date.now) {
  const finestre = new Map<string, { inizio: number; n: number }>();
  return (chiave: string): boolean => {
    const t = ora();
    const f = finestre.get(chiave);
    if (!f || t - f.inizio >= 60_000) {
      finestre.set(chiave, { inizio: t, n: 1 });
      return true;
    }
    f.n += 1;
    return f.n <= perMinuto;
  };
}
