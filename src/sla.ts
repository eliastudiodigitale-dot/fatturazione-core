// Regole SLA nel DB (#46): diverse per ogni attività e modificabili dal portale (Impostazioni > SLA), perché cambiano nel tempo.
// Le lettura è in cache per pochi secondi; ogni salvataggio la svuota. Un solo servizio in esecuzione: nessun problema di coerenza tra repliche.
import type pg from 'pg';
import type { SlaBusiness, SlaConfig } from './config.js';
import { inTransazione } from './db.js';

export class ErroreSla extends Error {}

const SOLO_ORE = (v: unknown, max: number): number | undefined => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max ? (v as number) : undefined);

/** Legge le regole dal DB. Senza la riga '*' (DB non migrato o svuotato) si usano 24 h e 72 h. */
export async function leggiSla(pool: pg.Pool): Promise<SlaConfig> {
  const [b, p] = await Promise.all([
    pool.query<{ business: string; prima_risposta_ore: number | null; risoluzione_ore: number | null; piano_predefinito: string | null }>('SELECT business, prima_risposta_ore, risoluzione_ore, piano_predefinito FROM sla_business'),
    pool.query<{ business: string; piano: string; prima_risposta_ore: number; risoluzione_ore: number }>('SELECT business, piano, prima_risposta_ore, risoluzione_ore FROM sla_piani WHERE attivo ORDER BY business, piano'),
  ]);
  const sla: SlaConfig = { predefinito: { primaRispostaOre: 24, risoluzioneOre: 72 }, business: {} };
  for (const r of b.rows) {
    if (r.business === '*') {
      if (r.prima_risposta_ore && r.risoluzione_ore) sla.predefinito = { primaRispostaOre: r.prima_risposta_ore, risoluzioneOre: r.risoluzione_ore };
      continue;
    }
    const x: SlaBusiness = { piani: {} };
    if (r.prima_risposta_ore && r.risoluzione_ore) x.standard = { primaRispostaOre: r.prima_risposta_ore, risoluzioneOre: r.risoluzione_ore };
    if (r.piano_predefinito) x.pianoPredefinito = r.piano_predefinito;
    sla.business[r.business] = x;
  }
  for (const r of p.rows) (sla.business[r.business] ??= { piani: {} }).piani[r.piano] = { primaRispostaOre: r.prima_risposta_ore, risoluzioneOre: r.risoluzione_ore };
  return sla;
}

/** Cache di breve durata delle regole: i ticket in arrivo non rileggono il DB a ogni richiesta. */
export class SlaStore {
  private cache?: { sla: SlaConfig; scade: number };
  constructor(
    private readonly pool: pg.Pool,
    private readonly ttlMs = 5000,
  ) {}
  async get(): Promise<SlaConfig> {
    if (this.cache && this.cache.scade > Date.now()) return this.cache.sla;
    const sla = await leggiSla(this.pool);
    this.cache = { sla, scade: Date.now() + this.ttlMs };
    return sla;
  }
  invalida() {
    this.cache = undefined;
  }
}

// ------------------------------------------------------------------ salvataggio dal portale

export interface ImpostazioniSla {
  /** Valori di partenza per le attività senza regole proprie. */
  predefinito: { prima_risposta_ore: number; risoluzione_ore: number };
  business: {
    business: string;
    /** SLA standard dell'attività; null = vale il predefinito. */
    standard: { prima_risposta_ore: number; risoluzione_ore: number } | null;
    /** 'nessuno', il nome di uno dei suoi piani, o null (SLA standard). */
    piano_predefinito: string | null;
    piani: { piano: string; prima_risposta_ore: number; risoluzione_ore: number }[];
  }[];
}

const RE_BUSINESS = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RE_PIANO = /^[a-z0-9][a-z0-9_-]{0,15}$/;

/** Controlla le impostazioni prima di scriverle: un errore qui non cambia nulla. */
export function validaImpostazioniSla(x: ImpostazioniSla): void {
  const ore = (v: unknown, max: number, dove: string) => {
    if (SOLO_ORE(v, max) === undefined) throw new ErroreSla(`${dove}: ore non valide (da 1 a ${max})`);
  };
  ore(x.predefinito?.prima_risposta_ore, 720, 'valori di partenza, prima risposta');
  ore(x.predefinito?.risoluzione_ore, 2160, 'valori di partenza, risoluzione');
  if (x.predefinito.prima_risposta_ore > x.predefinito.risoluzione_ore) throw new ErroreSla('valori di partenza: la prima risposta non può superare la risoluzione');
  const viste = new Set<string>();
  for (const b of x.business) {
    if (!RE_BUSINESS.test(b.business)) throw new ErroreSla(`attività non valida: ${b.business}`);
    if (viste.has(b.business)) throw new ErroreSla(`attività ripetuta: ${b.business}`);
    viste.add(b.business);
    if (b.standard) {
      ore(b.standard.prima_risposta_ore, 720, `${b.business}, SLA standard, prima risposta`);
      ore(b.standard.risoluzione_ore, 2160, `${b.business}, SLA standard, risoluzione`);
      if (b.standard.prima_risposta_ore > b.standard.risoluzione_ore) throw new ErroreSla(`${b.business}: la prima risposta non può superare la risoluzione`);
    }
    const nomi = new Set<string>();
    for (const p of b.piani) {
      if (!RE_PIANO.test(p.piano) || p.piano === 'nessuno' || p.piano === 'standard') throw new ErroreSla(`${b.business}: nome piano non valido (${p.piano}); minuscole, cifre, - e _, max 16`);
      if (nomi.has(p.piano)) throw new ErroreSla(`${b.business}: piano ripetuto (${p.piano})`);
      nomi.add(p.piano);
      ore(p.prima_risposta_ore, 720, `${b.business}, piano ${p.piano}, prima risposta`);
      ore(p.risoluzione_ore, 2160, `${b.business}, piano ${p.piano}, risoluzione`);
      if (p.prima_risposta_ore > p.risoluzione_ore) throw new ErroreSla(`${b.business}, piano ${p.piano}: la prima risposta non può superare la risoluzione`);
    }
    if (b.piano_predefinito && b.piano_predefinito !== 'nessuno' && !nomi.has(b.piano_predefinito)) throw new ErroreSla(`${b.business}: il piano di partenza "${b.piano_predefinito}" non esiste tra i suoi piani`);
  }
}

/**
 * Salva le impostazioni (tutto o niente). I piani tolti restano nel DB con attivo = false (mai cancellati): i ticket già aperti
 * mantengono le scadenze calcolate; cambiare i piani NON ricalcola i ticket già aperti (si cambia il piano del singolo ticket per farlo).
 */
export async function salvaImpostazioniSla(pool: pg.Pool, store: SlaStore, x: ImpostazioniSla, chi: string): Promise<void> {
  validaImpostazioniSla(x);
  await inTransazione(pool, async (c) => {
    await c.query(
      `INSERT INTO sla_business (business, prima_risposta_ore, risoluzione_ore, piano_predefinito, aggiornato_da) VALUES ('*', $1, $2, NULL, $3)
       ON CONFLICT (business) DO UPDATE SET prima_risposta_ore = EXCLUDED.prima_risposta_ore, risoluzione_ore = EXCLUDED.risoluzione_ore, aggiornato_il = now(), aggiornato_da = EXCLUDED.aggiornato_da`,
      [x.predefinito.prima_risposta_ore, x.predefinito.risoluzione_ore, chi],
    );
    for (const b of x.business) {
      await c.query(
        `INSERT INTO sla_business (business, prima_risposta_ore, risoluzione_ore, piano_predefinito, aggiornato_da) VALUES ($1, $2, $3, NULL, $4)
         ON CONFLICT (business) DO UPDATE SET prima_risposta_ore = EXCLUDED.prima_risposta_ore, risoluzione_ore = EXCLUDED.risoluzione_ore, aggiornato_il = now(), aggiornato_da = EXCLUDED.aggiornato_da`,
        [b.business, b.standard?.prima_risposta_ore ?? null, b.standard?.risoluzione_ore ?? null, chi],
      );
      for (const p of b.piani) {
        await c.query(
          `INSERT INTO sla_piani (business, piano, prima_risposta_ore, risoluzione_ore, attivo) VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (business, piano) DO UPDATE SET prima_risposta_ore = EXCLUDED.prima_risposta_ore, risoluzione_ore = EXCLUDED.risoluzione_ore, attivo = true`,
          [b.business, p.piano, p.prima_risposta_ore, p.risoluzione_ore],
        );
      }
      await c.query('UPDATE sla_piani SET attivo = false WHERE business = $1 AND attivo AND NOT (piano = ANY($2::text[]))', [b.business, b.piani.map((p) => p.piano)]);
      // Il piano di partenza si scrive dopo i piani: deve riferirsi a uno attivo.
      await c.query('UPDATE sla_business SET piano_predefinito = $2 WHERE business = $1', [b.business, b.piano_predefinito]);
    }
  });
  store.invalida();
}

/** Impostazioni complete per la pagina: includono le attività note (con o senza regole) così si possono configurare tutte. */
export async function impostazioniSla(pool: pg.Pool, noti: string[]): Promise<ImpostazioniSla> {
  const sla = await leggiSla(pool);
  const nomi = [...new Set([...noti, ...Object.keys(sla.business)])].sort();
  return {
    predefinito: { prima_risposta_ore: sla.predefinito.primaRispostaOre, risoluzione_ore: sla.predefinito.risoluzioneOre },
    business: nomi.map((n) => {
      const b = sla.business[n];
      return {
        business: n,
        standard: b?.standard ? { prima_risposta_ore: b.standard.primaRispostaOre, risoluzione_ore: b.standard.risoluzioneOre } : null,
        piano_predefinito: b?.pianoPredefinito ?? null,
        piani: Object.entries(b?.piani ?? {}).map(([piano, v]) => ({ piano, prima_risposta_ore: v.primaRispostaOre, risoluzione_ore: v.risoluzioneOre })),
      };
    }),
  };
}
