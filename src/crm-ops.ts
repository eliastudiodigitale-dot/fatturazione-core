// CRM operativo (#46): schede cliente scritte su ClickUp (anagrafica unica, #42) e, nel portale, contatti, note, attività,
// trattative e viste salvate. Ogni funzione riceve l'ambito di chi chiede: un ruolo ristretto non tocca clienti di altre attività.
import type pg from 'pg';
import type { CrmConfig } from './config.js';
import type { ClickUpApi, NuovaTask, ValoreCampo } from './clickup.js';
import { ErroreClickUp } from './clickup.js';
import { salvaClienti, dettaglioCliente } from './crm.js';
import { nomiAttivita, valorePerCampo } from './sync.js';
import { DOC_DI_CLIENTE, TOT_DOC, Condizioni, businessEffettivi, limiteOffset, normalizzaEmail, normalizzaPiva, perIlike, type Ambito } from './sql.js';
import { trovaCliente } from './ticket.js';

export class ErroreCrm extends Error {
  constructor(
    readonly codice: 400 | 403 | 404 | 409 | 502,
    msg: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(msg);
  }
}

export interface DepsCrmOps {
  pool: pg.Pool;
  /** Presenti solo con ClickUp e la lista Clienti configurati. */
  api?: ClickUpApi;
  cfg?: CrmConfig;
}

const FASI = ['nuova', 'contattato', 'proposta', 'trattativa', 'vinta', 'persa'] as const;
export type Fase = (typeof FASI)[number];
export const FASI_OPPORTUNITA: readonly Fase[] = FASI;
export const TIPI_ATTIVITA = ['chiamata', 'email', 'riunione', 'promemoria'] as const;
export type TipoAttivita = (typeof TIPI_ATTIVITA)[number];

/** Cliente visibile nell'ambito, altrimenti 404 (un ruolo ristretto non deve sapere che esiste). */
export async function clienteVisibile(pool: pg.Pool, ambito: Ambito, id: string): Promise<{ clickup_task_id: string; nome: string; businesses: string[] }> {
  const r = await pool.query<{ clickup_task_id: string; nome: string; businesses: string[] }>('SELECT clickup_task_id, nome, businesses FROM crm_clienti WHERE clickup_task_id = $1 AND NOT eliminato', [id]);
  const c = r.rows[0];
  if (!c || (ambito.business !== null && !c.businesses.some((b) => ambito.business!.includes(b)))) throw new ErroreCrm(404, 'cliente non trovato');
  return c;
}

// ------------------------------------------------------------------ scheda cliente su ClickUp

export interface DatiCliente {
  nome?: string;
  email?: string | null;
  partita_iva?: string | null;
  codice_fiscale?: string | null;
  telefono?: string | null;
  businesses?: string[];
  stato?: string;
}

const clickupDisponibile = (d: DepsCrmOps): { api: ClickUpApi; cfg: CrmConfig; lista: string } => {
  if (!d.api || !d.cfg?.clientiListId) throw new ErroreCrm(409, 'la lista Clienti di ClickUp non è configurata: schede in sola lettura');
  return { api: d.api, cfg: d.cfg, lista: d.cfg.clientiListId };
};
const comeErrore = (e: unknown): never => {
  if (e instanceof ErroreClickUp) throw new ErroreCrm(502, `ClickUp ha risposto ${e.status || 'errore di rete'}: riprova tra poco`);
  throw e;
};

function dentroAmbito(ambito: Ambito, businesses: string[] | undefined) {
  if (ambito.business === null || !businesses) return;
  const fuori = businesses.filter((b) => !ambito.business!.includes(b));
  if (fuori.length) throw new ErroreCrm(403, `attività non consentita: ${fuori.join(', ')}`);
}

/** Crea la scheda in ClickUp e la mette subito nella copia locale. Se esiste già un cliente con la stessa email o P.IVA: 409 con la scheda trovata. */
export async function creaCliente(d: DepsCrmOps, ambito: Ambito, dati: DatiCliente & { nome: string }): Promise<{ clickup_task_id: string }> {
  const { api, cfg, lista } = clickupDisponibile(d);
  dentroAmbito(ambito, dati.businesses);
  if (ambito.business !== null && !(dati.businesses?.length)) throw new ErroreCrm(400, 'indica almeno un\'attività');
  const email = normalizzaEmail(dati.email);
  const piva = normalizzaPiva(dati.partita_iva);
  const doppio = await trovaCliente(d.pool, { email, partita_iva: piva });
  if (doppio) throw new ErroreCrm(409, 'esiste già un cliente con la stessa email o partita IVA', { clickup_task_id: doppio });
  try {
    const campiLista = await api.campiLista(lista);
    const campo = (id?: string) => (id ? campiLista.find((x) => x.id === id) : undefined);
    const c = cfg.campiClienti;
    const campi: NuovaTask['campi'] = [];
    const metti = (id: string | undefined, v: ValoreCampo | ValoreCampo[] | undefined | null) => {
      if (id && v !== undefined && v !== null && v !== '') campi.push({ id, value: v as ValoreCampo });
    };
    metti(c.email, email);
    metti(c.partitaIva, piva);
    metti(c.codiceFiscale, dati.codice_fiscale?.replace(/\s+/g, '').toUpperCase());
    metti(c.telefono, dati.telefono?.trim());
    if (c.business && dati.businesses?.length) metti(c.business, valorePerCampo(campo(c.business), dati.businesses.flatMap((b) => nomiAttivita(b, cfg.alias))));
    const id = await api.creaTask(lista, { nome: dati.nome.trim(), descrizione: 'Scheda creata dal portale.', campi });
    await salvaClienti(d.pool, [
      {
        clickup_task_id: id, nome: dati.nome.trim(), email, partita_iva: piva, codice_fiscale: dati.codice_fiscale?.replace(/\s+/g, '').toUpperCase() ?? null,
        telefono: dati.telefono?.trim() || null, businesses: dati.businesses ?? [], stato: null, tag: [], creato_il: new Date(), modificato_il: new Date(),
      },
    ]);
    return { clickup_task_id: id };
  } catch (e) {
    return comeErrore(e);
  }
}

/** Modifica la scheda in ClickUp (nome, stato, campi) e poi la copia locale. I campi non indicati restano come sono; stringa vuota o null = svuota. */
export async function aggiornaCliente(d: DepsCrmOps, ambito: Ambito, id: string, mod: DatiCliente): Promise<void> {
  const { api, cfg, lista } = clickupDisponibile(d);
  await clienteVisibile(d.pool, ambito, id);
  dentroAmbito(ambito, mod.businesses);
  if (mod.businesses && mod.businesses.length === 0 && ambito.business !== null) throw new ErroreCrm(400, 'indica almeno un\'attività');
  if (mod.email) {
    if (!normalizzaEmail(mod.email)) throw new ErroreCrm(400, 'email non valida');
  }
  try {
    const campiLista = await api.campiLista(lista);
    const campo = (cid?: string) => (cid ? campiLista.find((x) => x.id === cid) : undefined);
    const c = cfg.campiClienti;
    const set: [string | undefined, ValoreCampo | ValoreCampo[] | null | undefined][] = [];
    if (mod.email !== undefined) set.push([c.email, normalizzaEmail(mod.email)]);
    if (mod.partita_iva !== undefined) set.push([c.partitaIva, normalizzaPiva(mod.partita_iva)]);
    if (mod.codice_fiscale !== undefined) set.push([c.codiceFiscale, mod.codice_fiscale?.replace(/\s+/g, '').toUpperCase() || null]);
    if (mod.telefono !== undefined) set.push([c.telefono, mod.telefono?.trim() || null]);
    if (mod.businesses !== undefined && c.business) set.push([c.business, mod.businesses.length ? valorePerCampo(campo(c.business), mod.businesses.flatMap((b) => nomiAttivita(b, cfg.alias))) ?? null : null]);
    if (mod.nome !== undefined || mod.stato !== undefined) await api.aggiornaTask(id, { nome: mod.nome?.trim(), stato: mod.stato });
    for (const [cid, v] of set) if (cid) await api.impostaCampo(id, cid, v ?? null);
  } catch (e) {
    return comeErrore(e);
  }
  const sets: string[] = [];
  const val: unknown[] = [];
  const agg = (col: string, v: unknown) => {
    val.push(v);
    sets.push(`${col} = $${val.length}`);
  };
  if (mod.nome !== undefined) agg('nome', mod.nome.trim());
  if (mod.stato !== undefined) agg('stato', mod.stato);
  if (mod.email !== undefined) agg('email', normalizzaEmail(mod.email));
  if (mod.partita_iva !== undefined) agg('partita_iva', normalizzaPiva(mod.partita_iva));
  if (mod.codice_fiscale !== undefined) agg('codice_fiscale', mod.codice_fiscale?.replace(/\s+/g, '').toUpperCase() || null);
  if (mod.telefono !== undefined) agg('telefono', mod.telefono?.trim() || null);
  if (mod.businesses !== undefined) agg('businesses', mod.businesses);
  if (sets.length) await d.pool.query(`UPDATE crm_clienti SET ${sets.join(', ')}, modificato_il = now() WHERE clickup_task_id = $${val.length + 1}`, [...val, id]);
}

/** Piano di assistenza del cliente (#46): vale per i ticket che apre da adesso; 'nessuno' = senza SLA, null = predefinito dell'attività. */
export async function impostaPianoCliente(pool: pg.Pool, ambito: Ambito, id: string, piano: string | null): Promise<void> {
  await clienteVisibile(pool, ambito, id);
  await pool.query('UPDATE crm_clienti SET piano_sla = $2 WHERE clickup_task_id = $1', [id, piano]);
}

// ------------------------------------------------------------------ contatti

export interface DatiContatto {
  nome?: string;
  ruolo?: string | null;
  email?: string | null;
  telefono?: string | null;
  principale?: boolean;
}

export async function creaContatto(pool: pg.Pool, ambito: Ambito, cliente: string, c: DatiContatto & { nome: string }): Promise<number> {
  await clienteVisibile(pool, ambito, cliente);
  if (c.email && !normalizzaEmail(c.email)) throw new ErroreCrm(400, 'email non valida');
  if (c.principale) await pool.query('UPDATE crm_contatti SET principale = false WHERE cliente_task_id = $1', [cliente]);
  const r = await pool.query<{ id: string }>(
    'INSERT INTO crm_contatti (cliente_task_id, nome, ruolo, email, telefono, principale) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [cliente, c.nome.trim(), c.ruolo?.trim() || null, normalizzaEmail(c.email), c.telefono?.trim() || null, c.principale ?? false],
  );
  return Number(r.rows[0]!.id);
}

async function contattoDi(pool: pg.Pool, ambito: Ambito, id: number): Promise<{ cliente_task_id: string }> {
  const r = await pool.query<{ cliente_task_id: string }>('SELECT cliente_task_id FROM crm_contatti WHERE id = $1 AND NOT eliminato', [id]);
  if (!r.rows[0]) throw new ErroreCrm(404, 'contatto non trovato');
  await clienteVisibile(pool, ambito, r.rows[0].cliente_task_id);
  return r.rows[0];
}

export async function aggiornaContatto(pool: pg.Pool, ambito: Ambito, id: number, c: DatiContatto): Promise<void> {
  const { cliente_task_id } = await contattoDi(pool, ambito, id);
  if (c.email && !normalizzaEmail(c.email)) throw new ErroreCrm(400, 'email non valida');
  if (c.principale) await pool.query('UPDATE crm_contatti SET principale = false WHERE cliente_task_id = $1', [cliente_task_id]);
  await pool.query(
    `UPDATE crm_contatti SET nome = COALESCE($2, nome), ruolo = CASE WHEN $3::boolean THEN $4 ELSE ruolo END, email = CASE WHEN $5::boolean THEN $6 ELSE email END,
            telefono = CASE WHEN $7::boolean THEN $8 ELSE telefono END, principale = COALESCE($9, principale) WHERE id = $1`,
    [id, c.nome?.trim() ?? null, c.ruolo !== undefined, c.ruolo?.trim() || null, c.email !== undefined, normalizzaEmail(c.email), c.telefono !== undefined, c.telefono?.trim() || null, c.principale ?? null],
  );
}

export async function eliminaContatto(pool: pg.Pool, ambito: Ambito, id: number): Promise<void> {
  await contattoDi(pool, ambito, id);
  await pool.query('UPDATE crm_contatti SET eliminato = true WHERE id = $1', [id]);
}

// ------------------------------------------------------------------ note

export async function creaNota(pool: pg.Pool, ambito: Ambito, cliente: string, testo: string, autore: string): Promise<number> {
  await clienteVisibile(pool, ambito, cliente);
  const r = await pool.query<{ id: string }>('INSERT INTO crm_note (cliente_task_id, autore, testo) VALUES ($1,$2,$3) RETURNING id', [cliente, autore, testo.trim()]);
  return Number(r.rows[0]!.id);
}

async function notaDi(pool: pg.Pool, ambito: Ambito, id: number) {
  const r = await pool.query<{ cliente_task_id: string }>('SELECT cliente_task_id FROM crm_note WHERE id = $1 AND NOT eliminato', [id]);
  if (!r.rows[0]) throw new ErroreCrm(404, 'nota non trovata');
  await clienteVisibile(pool, ambito, r.rows[0].cliente_task_id);
}
export async function modificaNota(pool: pg.Pool, ambito: Ambito, id: number, m: { fissata?: boolean; testo?: string }): Promise<void> {
  await notaDi(pool, ambito, id);
  await pool.query('UPDATE crm_note SET fissata = COALESCE($2, fissata), testo = COALESCE($3, testo) WHERE id = $1', [id, m.fissata ?? null, m.testo?.trim() ?? null]);
}
export async function eliminaNota(pool: pg.Pool, ambito: Ambito, id: number): Promise<void> {
  await notaDi(pool, ambito, id);
  await pool.query('UPDATE crm_note SET eliminato = true WHERE id = $1', [id]);
}

// ------------------------------------------------------------------ attività e promemoria

export interface NuovaAttivita {
  titolo: string;
  tipo?: TipoAttivita;
  scadenza?: string;
  assegnato_a?: string;
  cliente?: string;
  ticket_ref?: string;
  business?: string;
}

export async function creaAttivita(pool: pg.Pool, ambito: Ambito, a: NuovaAttivita, chi: string): Promise<number> {
  let business = a.business ?? null;
  if (a.cliente) {
    const c = await clienteVisibile(pool, ambito, a.cliente);
    business ??= c.businesses[0] ?? null;
  } else if (ambito.business !== null && (!business || !ambito.business.includes(business))) throw new ErroreCrm(403, 'attività non consentita');
  const r = await pool.query<{ id: string }>(
    'INSERT INTO crm_attivita (cliente_task_id, ticket_ref, business, tipo, titolo, scadenza, assegnato_a, creato_da) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [a.cliente ?? null, a.ticket_ref ?? null, business, a.tipo ?? 'promemoria', a.titolo.trim(), a.scadenza ?? null, a.assegnato_a?.trim() || null, chi],
  );
  return Number(r.rows[0]!.id);
}

async function attivitaDi(pool: pg.Pool, ambito: Ambito, id: number) {
  const r = await pool.query<{ cliente_task_id: string | null; business: string | null }>('SELECT cliente_task_id, business FROM crm_attivita WHERE id = $1 AND NOT eliminato', [id]);
  const a = r.rows[0];
  if (!a) throw new ErroreCrm(404, 'attività non trovata');
  if (a.cliente_task_id) await clienteVisibile(pool, ambito, a.cliente_task_id);
  else if (ambito.business !== null && (!a.business || !ambito.business.includes(a.business))) throw new ErroreCrm(404, 'attività non trovata');
}

export async function aggiornaAttivita(pool: pg.Pool, ambito: Ambito, id: number, m: { completata?: boolean; titolo?: string; scadenza?: string | null; assegnato_a?: string | null }): Promise<void> {
  await attivitaDi(pool, ambito, id);
  await pool.query(
    `UPDATE crm_attivita SET completata_il = CASE WHEN $2::boolean IS NULL THEN completata_il WHEN $2 THEN COALESCE(completata_il, now()) ELSE NULL END,
            titolo = COALESCE($3, titolo), scadenza = CASE WHEN $4::boolean THEN $5 ELSE scadenza END, assegnato_a = CASE WHEN $6::boolean THEN $7 ELSE assegnato_a END WHERE id = $1`,
    [id, m.completata ?? null, m.titolo?.trim() ?? null, m.scadenza !== undefined, m.scadenza ?? null, m.assegnato_a !== undefined, m.assegnato_a?.trim() || null],
  );
}
export async function eliminaAttivita(pool: pg.Pool, ambito: Ambito, id: number): Promise<void> {
  await attivitaDi(pool, ambito, id);
  await pool.query('UPDATE crm_attivita SET eliminato = true WHERE id = $1', [id]);
}

export interface FiltroAttivita {
  stato?: 'aperte' | 'completate' | 'tutte';
  scadute?: boolean;
  assegnato?: string;
  cliente?: string;
  business?: string[];
  limite?: number;
  offset?: number;
}

export async function elencoAttivita(pool: pg.Pool, ambito: Ambito, f: FiltroAttivita) {
  const cond = new Condizioni();
  cond.fissa('NOT a.eliminato');
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) cond.aggiungi('(a.business = ANY(?) OR c.businesses && ?::text[])', b);
  if ((f.stato ?? 'aperte') === 'aperte') cond.fissa('a.completata_il IS NULL');
  if (f.stato === 'completate') cond.fissa('a.completata_il IS NOT NULL');
  if (f.scadute) cond.fissa('a.completata_il IS NULL AND a.scadenza < now()');
  if (f.assegnato) cond.aggiungi('a.assegnato_a ILIKE ?', perIlike(f.assegnato));
  if (f.cliente) cond.aggiungi('a.cliente_task_id = ?', f.cliente);
  const { limite, offset } = limiteOffset(f.limite, f.offset);
  const r = await pool.query(
    `SELECT a.id, a.cliente_task_id, c.nome AS cliente_nome, a.ticket_ref, a.business, a.tipo, a.titolo, a.scadenza, a.assegnato_a, a.creato_da, a.creato_il, a.completata_il,
            (a.completata_il IS NULL AND a.scadenza < now()) AS scaduta, count(*) OVER()::int AS totale
       FROM crm_attivita a LEFT JOIN crm_clienti c ON c.clickup_task_id = a.cliente_task_id
       ${cond.where} ORDER BY (a.completata_il IS NOT NULL), a.scadenza ASC NULLS LAST, a.id DESC LIMIT ${cond.parametro(limite)} OFFSET ${cond.parametro(offset)}`,
    cond.params,
  );
  const righe = r.rows as (Record<string, unknown> & { totale: number })[];
  return { totale: righe[0]?.totale ?? 0, attivita: righe.map(({ totale: _t, ...resto }) => resto) };
}

// ------------------------------------------------------------------ trattative (pipeline)

export interface DatiOpportunita {
  titolo?: string;
  business?: string;
  cliente?: string | null;
  prospect?: string | null;
  fase?: Fase;
  valore?: number | null;
  chiusura_prevista?: string | null;
  assegnato_a?: string | null;
  motivo_perdita?: string | null;
}

export async function creaOpportunita(pool: pg.Pool, ambito: Ambito, o: DatiOpportunita & { titolo: string; business: string }, chi: string): Promise<number> {
  if (ambito.business !== null && !ambito.business.includes(o.business)) throw new ErroreCrm(403, 'attività non consentita');
  if (o.cliente) await clienteVisibile(pool, ambito, o.cliente);
  if (!o.cliente && !o.prospect?.trim()) throw new ErroreCrm(400, 'indica un cliente o il nome del prospect');
  const fase = o.fase ?? 'nuova';
  const r = await pool.query<{ id: string }>(
    `INSERT INTO crm_opportunita (cliente_task_id, prospect, business, titolo, fase, valore, chiusura_prevista, assegnato_a, motivo_perdita, creato_da, chiusa_il)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $5 IN ('vinta','persa') THEN now() END) RETURNING id`,
    [o.cliente ?? null, o.prospect?.trim() || null, o.business, o.titolo.trim(), fase, o.valore ?? null, o.chiusura_prevista ?? null, o.assegnato_a?.trim() || null, o.motivo_perdita ?? null, chi],
  );
  return Number(r.rows[0]!.id);
}

export async function aggiornaOpportunita(pool: pg.Pool, ambito: Ambito, id: number, m: DatiOpportunita): Promise<void> {
  const r = await pool.query<{ business: string; fase: Fase }>('SELECT business, fase FROM crm_opportunita WHERE id = $1', [id]);
  const o = r.rows[0];
  if (!o || (ambito.business !== null && !ambito.business.includes(o.business))) throw new ErroreCrm(404, 'trattativa non trovata');
  if (m.business && ambito.business !== null && !ambito.business.includes(m.business)) throw new ErroreCrm(403, 'attività non consentita');
  if (m.cliente) await clienteVisibile(pool, ambito, m.cliente);
  const chiusa = m.fase === 'vinta' || m.fase === 'persa';
  await pool.query(
    `UPDATE crm_opportunita SET titolo = COALESCE($2, titolo), business = COALESCE($3, business), fase = COALESCE($4, fase),
            valore = CASE WHEN $5::boolean THEN $6 ELSE valore END, chiusura_prevista = CASE WHEN $7::boolean THEN $8 ELSE chiusura_prevista END,
            assegnato_a = CASE WHEN $9::boolean THEN $10 ELSE assegnato_a END, motivo_perdita = CASE WHEN $11::boolean THEN $12 ELSE motivo_perdita END,
            cliente_task_id = CASE WHEN $13::boolean THEN $14 ELSE cliente_task_id END,
            chiusa_il = CASE WHEN $4 IN ('vinta','persa') THEN COALESCE(chiusa_il, now()) WHEN $4 IS NOT NULL THEN NULL ELSE chiusa_il END, aggiornato_il = now()
      WHERE id = $1`,
    [
      id, m.titolo?.trim() ?? null, m.business ?? null, m.fase ?? null, m.valore !== undefined, m.valore ?? null, m.chiusura_prevista !== undefined, m.chiusura_prevista ?? null,
      m.assegnato_a !== undefined, m.assegnato_a?.trim() || null, m.motivo_perdita !== undefined || (m.fase !== undefined && !chiusa), m.motivo_perdita ?? null,
      m.cliente !== undefined, m.cliente ?? null,
    ],
  );
}

export interface FiltroOpportunita {
  business?: string[];
  fase?: Fase[];
  assegnato?: string;
  cliente?: string;
  q?: string;
  aperte?: boolean;
  /** Solo trattative aperte non toccate da almeno questi giorni. */
  ferme?: number;
}

/** Elenco e riepilogo per fase (numero e valore). Gli importi li vede solo chi ha `soldi`. */
export async function elencoOpportunita(pool: pg.Pool, ambito: Ambito, f: FiltroOpportunita) {
  const cond = new Condizioni();
  const b = businessEffettivi(ambito, f.business);
  if (b !== null) cond.aggiungi('o.business = ANY(?)', b);
  if (f.fase?.length) cond.aggiungi('o.fase = ANY(?)', f.fase);
  if (f.aperte) cond.fissa(`o.fase NOT IN ('vinta','persa')`);
  if (f.ferme) cond.fissa(`o.fase NOT IN ('vinta','persa') AND o.aggiornato_il < now() - interval '${Math.min(Math.max(Math.floor(f.ferme), 1), 3650)} days'`);
  if (f.assegnato) cond.aggiungi('o.assegnato_a ILIKE ?', perIlike(f.assegnato));
  if (f.cliente) cond.aggiungi('o.cliente_task_id = ?', f.cliente);
  if (f.q) cond.aggiungi('(o.titolo ILIKE ? OR o.prospect ILIKE ? OR c.nome ILIKE ?)', perIlike(f.q));
  const valore = ambito.soldi ? 'o.valore' : 'NULL::numeric';
  const r = await pool.query(
    `SELECT o.id, o.cliente_task_id, COALESCE(c.nome, o.prospect) AS cliente_nome, o.prospect, o.business, o.titolo, o.fase, ${valore} AS valore, o.chiusura_prevista, o.assegnato_a,
            o.motivo_perdita, o.creato_il, o.aggiornato_il, o.chiusa_il
       FROM crm_opportunita o LEFT JOIN crm_clienti c ON c.clickup_task_id = o.cliente_task_id
       ${cond.where} ORDER BY array_position(ARRAY['nuova','contattato','proposta','trattativa','vinta','persa'], o.fase), o.chiusura_prevista ASC NULLS LAST, o.id DESC LIMIT 500`,
    cond.params,
  );
  const per_fase = FASI.map((fase) => {
    const righe = (r.rows as { fase: Fase; valore: string | null }[]).filter((x) => x.fase === fase);
    return { fase, n: righe.length, valore: ambito.soldi ? righe.reduce((s, x) => s + Number(x.valore ?? 0), 0) : null };
  });
  return { opportunita: r.rows, per_fase };
}

// ------------------------------------------------------------------ viste salvate

export async function elencoViste(pool: pg.Pool, sezione: string, utente: string) {
  const r = await pool.query('SELECT id, nome, filtro, condivisa, (utente = $2) AS mia FROM crm_viste WHERE sezione = $1 AND NOT eliminato AND (utente = $2 OR condivisa) ORDER BY nome', [sezione, utente]);
  return r.rows;
}
export async function creaVista(pool: pg.Pool, v: { sezione: string; nome: string; filtro: Record<string, unknown>; condivisa: boolean }, utente: string): Promise<number> {
  const r = await pool.query<{ id: string }>('INSERT INTO crm_viste (sezione, nome, filtro, utente, condivisa) VALUES ($1,$2,$3,$4,$5) RETURNING id', [v.sezione, v.nome.trim(), JSON.stringify(v.filtro), utente, v.condivisa]);
  return Number(r.rows[0]!.id);
}
export async function eliminaVista(pool: pg.Pool, id: number, utente: string, owner: boolean): Promise<void> {
  const r = await pool.query('UPDATE crm_viste SET eliminato = true WHERE id = $1 AND NOT eliminato AND (utente = $2 OR $3::boolean)', [id, utente, owner]);
  if (!r.rowCount) throw new ErroreCrm(404, 'vista non trovata');
}

// ------------------------------------------------------------------ scheda completa, duplicati, utenti

/** Scheda cliente per il portale: anagrafica, contatti, note, attività, trattative e cronologia unica (documenti, ticket, note, attività, trattative). */
export async function schedaCliente(pool: pg.Pool, ambito: Ambito, id: string) {
  const base = await dettaglioCliente(pool, ambito, id);
  if (!base) return undefined;
  const b = ambito.business;
  const [contatti, note, attivita, opp, piano, cronologia] = await Promise.all([
    pool.query('SELECT id, nome, ruolo, email, telefono, principale FROM crm_contatti WHERE cliente_task_id = $1 AND NOT eliminato ORDER BY principale DESC, nome', [id]),
    pool.query('SELECT id, autore, testo, fissata, creato_il FROM crm_note WHERE cliente_task_id = $1 AND NOT eliminato ORDER BY fissata DESC, id DESC LIMIT 100', [id]),
    pool.query('SELECT id, tipo, titolo, scadenza, assegnato_a, completata_il, (completata_il IS NULL AND scadenza < now()) AS scaduta FROM crm_attivita WHERE cliente_task_id = $1 AND NOT eliminato ORDER BY (completata_il IS NOT NULL), scadenza ASC NULLS LAST LIMIT 100', [id]),
    pool.query(`SELECT id, business, titolo, fase, ${ambito.soldi ? 'valore' : 'NULL::numeric AS valore'}, chiusura_prevista, assegnato_a FROM crm_opportunita WHERE cliente_task_id = $1 AND ($2::text[] IS NULL OR business = ANY($2::text[])) ORDER BY id DESC LIMIT 50`, [id, b]),
    pool.query('SELECT piano_sla FROM crm_clienti WHERE clickup_task_id = $1', [id]),
    pool.query(
      `SELECT quando, tipo, titolo, dettaglio FROM (
         SELECT t.aperto_il AS quando, 'ticket' AS tipo, t.oggetto AS titolo, jsonb_build_object('ref', t.ref, 'stato', t.stato, 'business', t.business) AS dettaglio
           FROM ticket t WHERE t.cliente_task_id = $1 AND ($2::text[] IS NULL OR t.business = ANY($2::text[]))
         UNION ALL SELECT n.creato_il, 'nota', left(n.testo, 200), jsonb_build_object('id', n.id, 'autore', n.autore) FROM crm_note n WHERE n.cliente_task_id = $1 AND NOT n.eliminato
         UNION ALL SELECT COALESCE(a.completata_il, a.creato_il), 'attivita', a.titolo, jsonb_build_object('id', a.id, 'tipo', a.tipo, 'completata', a.completata_il IS NOT NULL) FROM crm_attivita a WHERE a.cliente_task_id = $1 AND NOT a.eliminato
         UNION ALL SELECT o.creato_il, 'trattativa', o.titolo, jsonb_build_object('id', o.id, 'fase', o.fase) FROM crm_opportunita o WHERE o.cliente_task_id = $1 AND ($2::text[] IS NULL OR o.business = ANY($2::text[]))
         ${ambito.soldi ? `UNION ALL SELECT d.data_riserva, 'documento', d.tipo || ' ' || d.numero || '/' || d.anno, jsonb_build_object('ref', d.ref, 'stato', d.stato, 'totale', ${TOT_DOC}, 'business', d.business)
           FROM documenti d JOIN crm_clienti c ON c.clickup_task_id = $1 WHERE ${DOC_DI_CLIENTE} AND ($2::text[] IS NULL OR d.business = ANY($2::text[]))` : ''}
       ) x ORDER BY quando DESC LIMIT 200`,
      [id, b],
    ),
  ]);
  return { ...base, piano_sla: (piano.rows[0] as { piano_sla: string | null } | undefined)?.piano_sla ?? null, contatti: contatti.rows, note: note.rows, attivita: attivita.rows, trattative: opp.rows, cronologia: cronologia.rows };
}

/** Schede che sembrano lo stesso cliente (stessa partita IVA o stessa email): da unire a mano in ClickUp. */
export async function duplicati(pool: pg.Pool, ambito: Ambito) {
  const r = await pool.query(
    `SELECT motivo, valore, jsonb_agg(jsonb_build_object('id', clickup_task_id, 'nome', nome, 'businesses', businesses) ORDER BY nome) AS schede FROM (
       SELECT 'partita_iva' AS motivo, partita_iva AS valore, clickup_task_id, nome, businesses FROM crm_clienti WHERE NOT eliminato AND partita_iva IS NOT NULL AND ($1::text[] IS NULL OR businesses && $1::text[])
       UNION ALL SELECT 'email', lower(email), clickup_task_id, nome, businesses FROM crm_clienti WHERE NOT eliminato AND email IS NOT NULL AND ($1::text[] IS NULL OR businesses && $1::text[])
     ) x GROUP BY motivo, valore HAVING count(*) > 1 ORDER BY motivo, valore LIMIT 100`,
    [ambito.business],
  );
  return r.rows;
}

/** Chi ha fatto accesso al portale: i possibili assegnatari. Un ruolo ristretto vede solo chi lavora sulle sue stesse attività. */
export async function utentiAssegnabili(pool: pg.Pool, ambito: Ambito) {
  const r = await pool.query(
    `SELECT sub, nome, email, ruoli FROM utenti_dashboard WHERE ($1::text[] IS NULL OR business IS NULL OR business && $1::text[]) ORDER BY lower(nome) LIMIT 100`,
    [ambito.business],
  );
  return r.rows;
}

export async function registraUtente(pool: pg.Pool, s: { sub: string; nome: string; email: string | null; ruoli: string[]; business: string[] | null }): Promise<void> {
  await pool.query(
    `INSERT INTO utenti_dashboard (sub, nome, email, ruoli, business, ultimo_accesso) VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (sub) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email, ruoli = EXCLUDED.ruoli, business = EXCLUDED.business, ultimo_accesso = now()`,
    [s.sub, s.nome, s.email, s.ruoli, s.business],
  );
}

// ------------------------------------------------------------------ esportazione CSV

/** CSV per Excel italiano: separatore ";", BOM, virgolette doppie e protezione dalle formule (=, +, -, @ in testa a un testo). */
export function inCsv(righe: Record<string, unknown>[], colonne: { chiave: string; titolo: string }[]): string {
  const cella = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `﻿${[colonne.map((c) => cella(c.titolo)).join(';'), ...righe.map((r) => colonne.map((c) => cella(r[c.chiave])).join(';'))].join('\r\n')}\r\n`;
}
