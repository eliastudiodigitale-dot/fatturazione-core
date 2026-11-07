import type { Config, Tipo } from './config.js';
import type { Documento } from './documenti.js';
import { cambiaStato } from './documenti.js';
import type { Eventi } from './eventi.js';
import { refGc, type GcApi } from './gocardless.js';
import { chiaveDocumento, chiaviIn, listeUniche } from './clickup.js';
import { conLockClickUp, rigeneraTask, type DepsWorker } from './worker.js';

export interface Rapporto {
  buchi: string[];
  divergenzeContatore: string[];
  taskDoppie: string[];
  /** Numeri presenti sia in task fatte a mano sia in task del servizio. */
  collisioni: string[];
  taskOrfane: string[];
  rigenerate: string[];
  allineati: string[];
  riservatiVecchi: string[];
  eventiInSospeso: number;
  gcRecuperati: string[];
  errori: string[];
}

export interface DepsRiconciliazione {
  pool: DepsWorker['pool'];
  notif: DepsWorker['notif'];
  log: DepsWorker['log'];
  riservatoMaxOre: number;
  clickup?: DepsWorker;
  gc?: { api: GcApi; trigger: NonNullable<Config['gocardless']>['trigger']; tipo: Tipo; eventi: Eventi };
}

/** Confronto DB <-> ClickUp (e GoCardless). Allinea solo gli stati; mai correzioni dei numeri. */
export async function riconcilia(deps: DepsRiconciliazione): Promise<Rapporto> {
  const R: Rapporto = { buchi: [], divergenzeContatore: [], taskDoppie: [], collisioni: [], taskOrfane: [], rigenerate: [], allineati: [], riservatiVecchi: [], eventiInSospeso: 0, gcRecuperati: [], errori: [] };
  const { pool } = deps;

  // 1. Buchi nella sequenza e contatore
  const cont = (await pool.query<{ anno: number; tipo: Tipo; ultimo: number }>('SELECT anno, tipo, ultimo FROM contatori')).rows;
  for (const c of cont) {
    // I buchi si cercano dal primo numero emesso dal servizio: quelli prima sono i numeri a mano (riallineamento),
    // che stanno in ClickUp e nel cassetto fiscale, non qui.
    const r = await pool.query<{ n: number }>(
      `SELECT g AS n FROM generate_series(
         (SELECT min(numero) FROM documenti WHERE anno = $1 AND tipo = $2), $3::int) g
       WHERE NOT EXISTS (SELECT 1 FROM documenti d WHERE d.anno = $1 AND d.tipo = $2 AND d.numero = g) LIMIT 50`,
      [c.anno, c.tipo, c.ultimo],
    );
    for (const { n } of r.rows) R.buchi.push(chiaveDocumento(c.tipo, c.anno, n));
    const m = await pool.query<{ m: number | null }>('SELECT max(numero) AS m FROM documenti WHERE anno = $1 AND tipo = $2', [c.anno, c.tipo]);
    if ((m.rows[0]?.m ?? 0) > c.ultimo) R.divergenzeContatore.push(`${c.tipo}|${c.anno}: contatore ${c.ultimo} < ${m.rows[0]?.m}`);
  }

  // 2. Riservati da troppo tempo, eventi non elaborati
  R.riservatiVecchi = (
    await pool.query<{ ref: string }>(`SELECT ref FROM documenti WHERE stato = 'riservato' AND data_riserva < now() - make_interval(hours => $1) ORDER BY id`, [deps.riservatoMaxOre])
  ).rows.map((r) => r.ref);
  R.eventiInSospeso = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM eventi_ricevuti WHERE NOT elaborato AND ricevuto_il < now() - interval '1 hour'`)).rows[0]?.n ?? 0);

  // 3. GoCardless: pagamenti confermati mai ricevuti (nessun ritento automatico dei webhook)
  if (deps.gc) {
    try {
      const stato = deps.gc.trigger;
      const pagamenti = await deps.gc.api.pagamentiPerStato(stato, new Date(Date.now() - 7 * 86400_000));
      for (const p of pagamenti) {
        const ref = refGc(p.id, deps.gc.tipo);
        const c = await pool.query('SELECT 1 FROM documenti WHERE ref = $1', [ref]);
        if (c.rowCount) continue;
        const raw = { id: `riconciliazione:${p.id}`, resource_type: 'payments', action: stato, links: { payment: p.id } };
        const id = await deps.gc.eventi.registra('gocardless', raw.id, raw);
        if (id) await deps.gc.eventi.elabora(id);
        R.gcRecuperati.push(p.id);
      }
    } catch (e) {
      R.errori.push(`gocardless: ${(e as Error).message}`);
    }
  }

  // 4. ClickUp
  if (deps.clickup) {
    const cu = deps.clickup;
    const esito = await conLockClickUp(pool, async () => {
      const perChiave = new Map<string, string[]>(); // task create dal servizio
      const aMano = new Map<string, string[]>(); // task storiche: numeri scritti a mano
      for (const lista of listeUniche(cu.cfg.listId)) {
        for (const t of await cu.api.elencaTask(lista)) {
          const ks = t.chiave ? chiaviIn(t.chiave) : [];
          if (ks.length) for (const n of ks) { const k = chiaveDocumento(n.tipo, n.anno, n.numero); perChiave.set(k, [...(perChiave.get(k) ?? []), t.id]); }
          else for (const n of t.numeri) { const k = chiaveDocumento(n.tipo, n.anno, n.numero); aMano.set(k, [...(aMano.get(k) ?? []), t.id]); }
        }
      }
      for (const [k, ids] of perChiave) if (ids.length > 1) R.taskDoppie.push(`${k}: ${ids.join(',')}`);
      for (const [k, ids] of aMano) {
        if (ids.length > 1) R.taskDoppie.push(`${k} (a mano): ${ids.join(',')}`);
        // Un numero usato a mano E dal servizio: doppione fiscale. Non si corregge da soli.
        if (perChiave.has(k)) R.collisioni.push(k);
      }

      const docs = (await pool.query<Documento>(`SELECT * FROM documenti WHERE stato IN ('riservato','creato','inviato_sdi','consegnato','annullato') ORDER BY id`)).rows;
      const noti = new Set<string>();
      for (const d of docs) {
        const k = chiaveDocumento(d.tipo, d.anno, d.numero);
        noti.add(k);
        const ids = perChiave.get(k) ?? [];
        // Documenti con lista propria (dati_fonte.clickup.list_id_documenti) non sono nelle liste di default: si salta il confronto.
        const listaPropria = Boolean((d.payload.dati_fonte as { clickup?: { list_id_documenti?: string } } | undefined)?.clickup?.list_id_documenti);
        if (listaPropria) continue;
        if (d.stato === 'riservato' && ids.length === 1) {
          // Task creata ma conferma persa
          await cambiaStato(pool, d.ref, 'creato', { clickupTaskId: ids[0], dettaglio: { riconciliazione: true } });
          R.allineati.push(d.ref);
        } else if (d.stato === 'creato' && ids.length === 0) {
          const id = await rigeneraTask(cu, d);
          if (id) R.rigenerate.push(d.ref);
        }
      }
      for (const k of perChiave.keys()) if (!noti.has(k)) R.taskOrfane.push(k);
    }).catch((e: Error) => {
      R.errori.push(`clickup: ${e.message}`);
    });
    if (esito === 'occupato') R.errori.push('clickup: worker in corso, confronto saltato');
  }

  const anomalie = R.buchi.length + R.divergenzeContatore.length + R.taskDoppie.length + R.collisioni.length + R.taskOrfane.length + R.riservatiVecchi.length + R.eventiInSospeso + R.errori.length;
  if (anomalie > 0 || R.rigenerate.length || R.gcRecuperati.length) {
    deps.notif.anomalia('riconciliazione', {
      buchi: R.buchi.length,
      divergenze_contatore: R.divergenzeContatore.length,
      task_doppie: R.taskDoppie.length,
      numeri_doppi_mano_servizio: R.collisioni.length,
      task_orfane: R.taskOrfane.length,
      riservati_vecchi: R.riservatiVecchi.length,
      eventi_in_sospeso: R.eventiInSospeso,
      rigenerate: R.rigenerate.length,
      gc_recuperati: R.gcRecuperati.length,
      errori: R.errori.join(' | ') || null,
    });
  }
  deps.log.info({ riconciliazione: { ...R, buchi: R.buchi.slice(0, 20), taskOrfane: R.taskOrfane.slice(0, 20) } }, 'riconciliazione completata');
  return R;
}
