import type pg from 'pg';
import type { SlaConfig } from './config.js';
import { inTransazione } from './db.js';
import { Condizioni, businessEffettivi, limiteOffset, normalizzaEmail, normalizzaPiva, perIlike, type Ambito } from './sql.js';

export const PRIORITA = ['urgente', 'alta', 'normale', 'bassa'] as const;
export const STATI_TICKET = ['aperto', 'in_lavorazione', 'in_attesa_cliente', 'risolto', 'chiuso'] as const;
export type Priorita = (typeof PRIORITA)[number];
export type StatoTicket = (typeof STATI_TICKET)[number];
export const STATI_CHIUSI: StatoTicket[] = ['risolto', 'chiuso'];

/** La priorità scala i tempi dell'SLA: un urgente ha un quarto del tempo, un ticket a bassa priorità il doppio. */
const MOLTIPLICATORE: Record<Priorita, number> = { urgente: 0.25, alta: 0.5, normale: 1, bassa: 2 };

/** Valore di `ticket.piano_sla` quando il cliente non ha un piano a pagamento: nessuno SLA, best effort (#46). */
export const PIANO_NESSUNO = 'nessuno';

/**
 * Scadenze SLA in ore di calendario (non lavorative), dall'apertura del ticket (#46). Le regole sono quelle dell'attività (DB, modificabili dal portale):
 * - piano a pagamento dell'attività (es. 48h, 3g, 5g, 7g): termini fissi del piano, la priorità non li cambia;
 * - piano "nessuno": nessuna scadenza (best effort);
 * - nessun piano indicato: piano predefinito dell'attività se c'è, altrimenti SLA standard dell'attività (o quello di partenza) scalato dalla priorità.
 * `piano` restituito: il valore da salvare in ticket.piano_sla (null = SLA standard).
 */
export function scadenze(
  sla: SlaConfig,
  business: string,
  priorita: Priorita,
  apertoIl: Date,
  piano?: string | null,
): { primaRisposta: Date | null; risoluzione: Date | null; piano: string | null } {
  const b = sla.business[business];
  const scelto = piano ?? b?.pianoPredefinito ?? null;
  if (scelto === PIANO_NESSUNO) return { primaRisposta: null, risoluzione: null, piano: PIANO_NESSUNO };
  const quando = (h: number, m: number) => new Date(apertoIl.getTime() + Math.round(h * m * 3600_000));
  if (scelto) {
    const p = b?.piani[scelto];
    // Un piano esplicito che l'attività non ha è un errore; uno solo "ereditato" e poi tolto dalle impostazioni ricade sullo standard.
    if (!p && piano) throw new ErroreTicket(400, `piano SLA sconosciuto per ${business}: ${scelto}`);
    if (p) return { primaRisposta: quando(p.primaRispostaOre, 1), risoluzione: quando(p.risoluzioneOre, 1), piano: scelto };
  }
  const base = b?.standard ?? sla.predefinito;
  const m = MOLTIPLICATORE[priorita];
  return { primaRisposta: quando(base.primaRispostaOre, m), risoluzione: quando(base.risoluzioneOre, m), piano: null };
}

/** Piani ammessi per un'attività (compreso "nessuno"), per i menu e per validare le richieste. */
export const pianiAmmessi = (sla: SlaConfig, business: string): string[] => [PIANO_NESSUNO, ...Object.keys(sla.business[business]?.piani ?? {})];

export interface Ticket {
  id: string;
  ref: string;
  fonte: string;
  /** Dove vive il ticket: nel backend del business (remoto, richiamato via API) o in questo servizio (locale). */
  origine: 'locale' | 'remoto';
  id_remoto: string | null;
  piano_sla: string | null;
  business: string;
  oggetto: string;
  testo: string | null;
  priorita: Priorita;
  stato: StatoTicket;
  categoria: string | null;
  canale: string | null;
  cliente_nome: string | null;
  cliente_email: string | null;
  cliente_task_id: string | null;
  assegnato_a: string | null;
  aperto_il: Date;
  prima_risposta_il: Date | null;
  risolto_il: Date | null;
  scade_prima_risposta: Date | null;
  scade_risoluzione: Date | null;
  dati_fonte: Record<string, unknown>;
}

export interface NuovoTicket {
  fonte: string;
  business: string;
  idEsterno: string;
  oggetto: string;
  testo?: string;
  priorita?: Priorita;
  categoria?: string;
  canale?: string;
  cliente?: { nome?: string; email?: string; partita_iva?: string };
  datiFonte?: Record<string, unknown>;
  apertoIl?: Date;
  /** Piano SLA esplicito; se manca vale quello del cliente (se ha un piano) o il predefinito dell'attività. */
  pianoSla?: string;
  /** Ticket che vive nel backend del business: `idEsterno` è il suo id lì. */
  origine?: 'locale' | 'remoto';
  stato?: StatoTicket;
  assegnatoA?: string;
  primaRispostaIl?: Date;
  risoltoIl?: Date;
}

/** Scheda cliente già in cache che corrisponde per email o partita IVA (la più recente se più di una). */
export async function trovaCliente(db: pg.Pool | pg.PoolClient, c: { email?: string | null; partita_iva?: string | null }): Promise<string | null> {
  const email = normalizzaEmail(c.email);
  const piva = normalizzaPiva(c.partita_iva);
  if (!email && !piva) return null;
  const r = await db.query<{ clickup_task_id: string }>(
    `SELECT clickup_task_id FROM crm_clienti
      WHERE NOT eliminato AND (($1::text IS NOT NULL AND lower(email) = $1) OR ($2::text IS NOT NULL AND partita_iva = $2))
      ORDER BY (CASE WHEN $2::text IS NOT NULL AND partita_iva = $2 THEN 0 ELSE 1 END), modificato_il DESC NULLS LAST LIMIT 1`,
    [email, piva],
  );
  return r.rows[0]?.clickup_task_id ?? null;
}

/**
 * Crea il ticket arrivato da una fonte. Idempotente: lo stesso `<fonte>|<id esterno>` restituisce il ticket già esistente
 * senza modificarlo (un rinvio del chiamante non crea doppioni).
 */
export async function creaTicket(pool: pg.Pool, sla: SlaConfig, n: NuovoTicket): Promise<{ ticket: Ticket; nuovo: boolean }> {
  const ref = `${n.fonte}|${n.idEsterno}`;
  return inTransazione(pool, async (c) => {
    const esistente = await c.query<Ticket>('SELECT * FROM ticket WHERE ref = $1', [ref]);
    if (esistente.rows[0]) return { ticket: esistente.rows[0], nuovo: false };
    const priorita = n.priorita ?? 'normale';
    const aperto = n.apertoIl ?? new Date();
    const clienteTask = await trovaCliente(c, { email: n.cliente?.email, partita_iva: n.cliente?.partita_iva });
    // Piano: esplicito, poi quello del cliente, poi il predefinito dell'attività (in scadenze).
    const pianoCliente = n.pianoSla ? undefined : clienteTask ? (await c.query<{ piano_sla: string | null }>('SELECT piano_sla FROM crm_clienti WHERE clickup_task_id = $1', [clienteTask])).rows[0]?.piano_sla : undefined;
    const pianoValido = (p?: string | null) => (p && pianiAmmessi(sla, n.business).includes(p) ? p : undefined);
    const sc = scadenze(sla, n.business, priorita, aperto, n.pianoSla ?? pianoValido(pianoCliente));
    const origine = n.origine ?? 'locale';
    const r = await c.query<Ticket>(
      `INSERT INTO ticket (ref, fonte, origine, id_remoto, piano_sla, business, oggetto, testo, priorita, stato, categoria, canale, cliente_nome, cliente_email, cliente_task_id,
                           assegnato_a, aperto_il, prima_risposta_il, risolto_il, scade_prima_risposta, scade_risoluzione, dati_fonte)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (ref) DO NOTHING RETURNING *`,
      [
        ref, n.fonte, origine, origine === 'remoto' ? n.idEsterno : null, sc.piano, n.business, n.oggetto, origine === 'remoto' ? null : (n.testo ?? null), priorita,
        n.stato ?? 'aperto', n.categoria ?? null, n.canale ?? null, n.cliente?.nome ?? null, n.cliente?.email?.toLowerCase() ?? null, clienteTask,
        n.assegnatoA ?? null, aperto, n.primaRispostaIl ?? null, n.risoltoIl ?? null, sc.primaRisposta, sc.risoluzione, JSON.stringify(n.datiFonte ?? {}),
      ],
    );
    const t = r.rows[0] ?? (await c.query<Ticket>('SELECT * FROM ticket WHERE ref = $1', [ref])).rows[0]!;
    if (r.rows[0]) await c.query(`INSERT INTO ticket_eventi (ticket_id, tipo, da, dettaglio) VALUES ($1, 'aperto', $2, $3)`, [t.id, n.fonte, JSON.stringify({ priorita, canale: n.canale ?? null })]);
    return { ticket: t, nuovo: Boolean(r.rows[0]) };
  });
}

export class ErroreTicket extends Error {
  constructor(
    readonly codice: 400 | 404 | 409 | 502,
    msg: string,
  ) {
    super(msg);
  }
}

/**
 * Messaggio su un ticket esistente (dalla fonte o dal portale). Lo stato NON cambia qui (lo cambia chi gestisce il ticket).
 * Una risposta dello staff, non interna, registra la prima risposta (serve all'SLA con l'orario esatto).
 * Per i ticket remoti il testo non si copia: resta nel backend del business. Restituisce `daRiaprire`:
 * il cliente ha scritto su un ticket già risolto/chiuso, qualcuno deve riaprirlo.
 */
export async function aggiungiMessaggio(
  pool: pg.Pool,
  ref: string,
  m: { da: 'cliente' | 'staff'; testo?: string; chi: string; interno?: boolean },
): Promise<{ ticket: Ticket; daRiaprire: boolean }> {
  return inTransazione(pool, async (c) => {
    const r = await c.query<Ticket>('SELECT * FROM ticket WHERE ref = $1 FOR UPDATE', [ref]);
    const t = r.rows[0];
    if (!t) throw new ErroreTicket(404, 'ticket non trovato');
    if (t.origine === 'locale') await c.query('INSERT INTO ticket_messaggi (ticket_id, da, autore, interno, testo) VALUES ($1, $2, $3, $4, $5)', [t.id, m.da, m.chi, m.interno ?? false, m.testo ?? null]);
    const tipo = m.interno ? 'nota_interna' : m.da === 'staff' ? 'risposta_staff' : 'risposta_cliente';
    await c.query(`INSERT INTO ticket_eventi (ticket_id, tipo, da) VALUES ($1, $2, $3)`, [t.id, tipo, m.chi]);
    let aggiornato = t;
    if (m.da === 'staff' && !m.interno && !t.prima_risposta_il) {
      aggiornato = (await c.query<Ticket>('UPDATE ticket SET prima_risposta_il = now(), aggiornato_il = now() WHERE id = $1 RETURNING *', [t.id])).rows[0]!;
    } else await c.query('UPDATE ticket SET aggiornato_il = now() WHERE id = $1', [t.id]);
    return { ticket: aggiornato, daRiaprire: m.da === 'cliente' && !m.interno && STATI_CHIUSI.includes(t.stato) };
  });
}

export interface ModificaTicket {
  stato?: StatoTicket;
  priorita?: Priorita;
  /** Email o nome di chi lo prende in carico; stringa vuota = nessuno. */
  assegnato_a?: string;
  categoria?: string;
  piano_sla?: string;
}

/**
 * Modifica stato, priorità, assegnatario, categoria o piano SLA di un ticket e ne tiene la cronologia.
 * Risolvere/chiudere fissa `risolto_il` (la prima volta); riaprire lo azzera. Priorità o piano ricalcolano le scadenze dall'apertura.
 */
export async function aggiornaTicket(pool: pg.Pool, sla: SlaConfig, ref: string, mod: ModificaTicket, chi: string): Promise<Ticket> {
  return inTransazione(pool, async (c) => {
    const r = await c.query<Ticket>('SELECT * FROM ticket WHERE ref = $1 FOR UPDATE', [ref]);
    const t = r.rows[0];
    if (!t) throw new ErroreTicket(404, 'ticket non trovato');
    const set: string[] = [];
    const val: unknown[] = [];
    const campo = (nome: string, v: unknown) => {
      val.push(v);
      set.push(`${nome} = $${val.length}`);
    };
    const eventi: { tipo: string; dettaglio: Record<string, unknown> }[] = [];
    if (mod.stato !== undefined && mod.stato !== t.stato) {
      campo('stato', mod.stato);
      const chiuso = STATI_CHIUSI.includes(mod.stato);
      if (chiuso && !t.risolto_il) set.push('risolto_il = now()');
      if (!chiuso && t.risolto_il) set.push('risolto_il = NULL');
      eventi.push({ tipo: 'stato', dettaglio: { da: t.stato, a: mod.stato } });
    }
    if (mod.assegnato_a !== undefined) {
      const nuovo = mod.assegnato_a.trim() === '' ? null : mod.assegnato_a.trim();
      if (nuovo !== t.assegnato_a) {
        campo('assegnato_a', nuovo);
        eventi.push({ tipo: 'assegnato', dettaglio: { da: t.assegnato_a, a: nuovo } });
      }
    }
    if (mod.categoria !== undefined && (mod.categoria.trim() || null) !== t.categoria) campo('categoria', mod.categoria.trim() || null);
    const prioritaNuova = mod.priorita ?? t.priorita;
    // 'standard' = torna al piano predefinito dell'attività (colonna NULL).
    const pianoNuovo = mod.piano_sla === undefined ? t.piano_sla : mod.piano_sla === 'standard' ? null : mod.piano_sla;
    if (mod.priorita !== undefined && mod.priorita !== t.priorita) eventi.push({ tipo: 'priorita', dettaglio: { da: t.priorita, a: mod.priorita } });
    if (mod.piano_sla !== undefined && pianoNuovo !== t.piano_sla) eventi.push({ tipo: 'piano_sla', dettaglio: { da: t.piano_sla, a: pianoNuovo } });
    if (eventi.some((e) => e.tipo === 'priorita' || e.tipo === 'piano_sla')) {
      // Un piano ormai tolto dalle impostazioni non blocca il cambio di priorità: si ricade sullo SLA standard.
      const ancoraValido = pianoNuovo === null || pianiAmmessi(sla, t.business).includes(pianoNuovo);
      const sc = scadenze(sla, t.business, prioritaNuova, new Date(t.aperto_il), mod.piano_sla !== undefined || ancoraValido ? pianoNuovo : null);
      campo('priorita', prioritaNuova);
      campo('piano_sla', sc.piano);
      campo('scade_prima_risposta', sc.primaRisposta);
      campo('scade_risoluzione', sc.risoluzione);
    }
    if (set.length === 0) return t;
    const agg = await c.query<Ticket>(`UPDATE ticket SET ${set.join(', ')}, aggiornato_il = now() WHERE id = $${val.length + 1} RETURNING *`, [...val, t.id]);
    for (const e of eventi) await c.query('INSERT INTO ticket_eventi (ticket_id, tipo, da, dettaglio) VALUES ($1, $2, $3, $4)', [t.id, e.tipo, chi, JSON.stringify(e.dettaglio)]);
    return agg.rows[0]!;
  });
}

/** Conversazione di un ticket locale (le note interne le vede solo lo staff: il chiamante decide se mostrarle). */
export async function messaggiLocali(pool: pg.Pool, ticketId: string | number) {
  const r = await pool.query('SELECT quando, da, autore, interno, testo FROM ticket_messaggi WHERE ticket_id = $1 ORDER BY id ASC LIMIT 500', [ticketId]);
  return r.rows as { quando: Date; da: 'cliente' | 'staff'; autore: string | null; interno: boolean; testo: string | null }[];
}

/** Ticket per ref, senza limiti di ambito (il chiamante controlla l'ambito prima di modificare). */
export async function ticketPerRef(pool: pg.Pool, ref: string): Promise<Ticket | undefined> {
  return (await pool.query<Ticket>('SELECT * FROM ticket WHERE ref = $1', [ref])).rows[0];
}

export interface FiltroTicket {
  business?: string[];
  fonte?: string[];
  stato?: StatoTicket[];
  priorita?: Priorita[];
  assegnato?: string;
  /** Solo ticket non ancora presi in carico. */
  nonAssegnati?: boolean;
  piano?: string[];
  cliente?: string;
  q?: string;
  /** Solo ticket con SLA già scaduto (risposta o risoluzione). */
  scaduti?: boolean;
  /** Solo ticket la cui prossima scadenza SLA cade entro 4 ore (non ancora scaduta). */
  aRischio?: boolean;
  da?: string;
  a?: string;
  ordine?: 'recenti' | 'vecchi' | 'scadenza' | 'priorita';
  limite?: number;
  offset?: number;
}

export const APERTO = `stato NOT IN ('risolto','chiuso')`;
export const SLA_RISPOSTA_SCADUTA = `(prima_risposta_il IS NULL AND scade_prima_risposta < now() AND ${APERTO})`;
export const SLA_RISOLUZIONE_SCADUTA = `(risolto_il IS NULL AND scade_risoluzione < now() AND ${APERTO})`;
/** Prossima scadenza SLA entro 4 ore e non ancora superata: serve per "a rischio". */
export const SLA_A_RISCHIO = `(${APERTO} AND NOT (${SLA_RISPOSTA_SCADUTA} OR ${SLA_RISOLUZIONE_SCADUTA}) AND ((prima_risposta_il IS NULL AND scade_prima_risposta < now() + interval '4 hours') OR (risolto_il IS NULL AND scade_risoluzione < now() + interval '4 hours')))`;

const COLONNE = `id, ref, fonte, origine, piano_sla, business, oggetto, priorita, stato, categoria, canale, cliente_nome, cliente_email, cliente_task_id, assegnato_a,
  aperto_il, prima_risposta_il, risolto_il, scade_prima_risposta, scade_risoluzione,
  ${SLA_RISPOSTA_SCADUTA} AS sla_risposta_scaduta, ${SLA_RISOLUZIONE_SCADUTA} AS sla_risoluzione_scaduta, ${SLA_A_RISCHIO} AS sla_a_rischio`;

const ORDINI: Record<NonNullable<FiltroTicket['ordine']>, string> = {
  recenti: 'aperto_il DESC, id DESC',
  vecchi: 'aperto_il ASC, id ASC',
  scadenza: `(CASE WHEN ${APERTO} THEN LEAST(CASE WHEN prima_risposta_il IS NULL THEN scade_prima_risposta END, scade_risoluzione) END) ASC NULLS LAST, aperto_il ASC`,
  priorita: `array_position(ARRAY['urgente','alta','normale','bassa'], priorita), aperto_il ASC`,
};

export function condizioniTicket(ambito: Ambito, f: FiltroTicket): Condizioni | undefined {
  const cond = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) cond.aggiungi('business = ANY(?)', b);
  if (f.fonte?.length) cond.aggiungi('fonte = ANY(?)', f.fonte);
  if (f.stato?.length) cond.aggiungi('stato = ANY(?)', f.stato);
  if (f.priorita?.length) cond.aggiungi('priorita = ANY(?)', f.priorita);
  if (f.assegnato) cond.aggiungi('assegnato_a ILIKE ?', perIlike(f.assegnato));
  if (f.nonAssegnati) cond.fissa('assegnato_a IS NULL');
  if (f.piano?.length) cond.aggiungi(`COALESCE(piano_sla, 'standard') = ANY(?)`, f.piano);
  if (f.cliente) cond.aggiungi('cliente_task_id = ?', f.cliente);
  if (f.q) cond.aggiungi(`(oggetto ILIKE ? OR cliente_nome ILIKE ? OR cliente_email ILIKE ? OR ref ILIKE ?)`, perIlike(f.q));
  if (f.scaduti) cond.fissa(`(${SLA_RISPOSTA_SCADUTA} OR ${SLA_RISOLUZIONE_SCADUTA})`);
  if (f.aRischio) cond.fissa(SLA_A_RISCHIO);
  if (f.da) cond.aggiungi('aperto_il >= ?::timestamptz', f.da);
  if (f.a) cond.aggiungi('aperto_il < ?::timestamptz', f.a);
  return cond;
}

export async function elencoTicket(pool: pg.Pool, ambito: Ambito, f: FiltroTicket) {
  const cond = condizioniTicket(ambito, f)!;
  const { limite, offset } = limiteOffset(f.limite, f.offset);
  const ordine = ORDINI[f.ordine ?? 'recenti'];
  const r = await pool.query(
    `SELECT ${COLONNE}, count(*) OVER()::int AS totale FROM ticket ${cond.where} ORDER BY ${ordine} LIMIT ${cond.parametro(limite)} OFFSET ${cond.parametro(offset)}`,
    cond.params,
  );
  const righe = r.rows as (Record<string, unknown> & { totale: number })[];
  return { totale: righe[0]?.totale ?? 0, ticket: righe.map(({ totale: _t, ...resto }) => resto) };
}

export async function dettaglioTicket(pool: pg.Pool, ambito: Ambito, ref: string) {
  const cond = condizioniTicket(ambito, {})!;
  cond.aggiungi('ref = ?', ref);
  const r = await pool.query(`SELECT ${COLONNE}, dati_fonte FROM ticket ${cond.where}`, cond.params);
  const t = r.rows[0] as { id: string; cliente_task_id: string | null } | undefined;
  if (!t) return undefined;
  const [eventi, cliente] = await Promise.all([
    pool.query('SELECT quando, tipo, da, dettaglio FROM ticket_eventi WHERE ticket_id = $1 ORDER BY id DESC LIMIT 100', [t.id]),
    t.cliente_task_id
      ? pool.query('SELECT clickup_task_id, nome, email, partita_iva, businesses FROM crm_clienti WHERE clickup_task_id = $1', [t.cliente_task_id])
      : Promise.resolve({ rows: [] }),
  ]);
  return { ...t, eventi: eventi.rows, cliente: cliente.rows[0] ?? null };
}
