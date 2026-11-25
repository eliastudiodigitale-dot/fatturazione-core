// API operative del portale (#46): scrivono su ticket (backend dei business o DB), schede cliente (ClickUp), note, attività, trattative.
// Stanno sotto /dashboard/api, dietro la sessione Keycloak. Ogni scrittura controlla permessi del ruolo, ambito delle attività e CSRF.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import type { Notificatore } from './notifiche.js';
import { ErroreRichiesta, mezzanotteRoma, type ParteSync } from './api-crm.js';
import { ambitoDiSessione, permessiDiSessione, type Permessi, type Sessione } from './dashboard-auth.js';
import { elencoClienti } from './crm.js';
import {
  ErroreCrm, FASI_OPPORTUNITA, clienteVisibile, TIPI_ATTIVITA, aggiornaAttivita, aggiornaCliente, aggiornaContatto, aggiornaOpportunita, creaAttivita, creaCliente, creaContatto, creaNota, creaOpportunita,
  creaVista, duplicati, eliminaAttivita, eliminaContatto, eliminaNota, eliminaVista, elencoAttivita, elencoOpportunita, elencoViste, impostaPianoCliente, inCsv, modificaNota, schedaCliente,
  utentiAssegnabili, type DepsCrmOps, type Fase,
} from './crm-ops.js';
import { dettaglioDocumento, elencoDocumenti, riepilogoMensile, type FiltroDocumenti } from './fatture.js';
import { PRIORITA, STATI_TICKET, ErroreTicket, elencoTicket, pianiAmmessi, type Priorita, type StatoTicket } from './ticket.js';
import { conversazione, creaDaPortale, modifica, rispondi, type DepsOps } from './ticket-ops.js';
import type { Ambito } from './sql.js';
import { aggiornaRisposta, cerca, conteggiViste, creaRisposta, eliminaRisposta, elencoRisposte } from './portale.js';
import type { BackendTicket } from './ticket-backend.js';
import { ErroreSla, impostazioniSla, salvaImpostazioniSla, type ImpostazioniSla, type SlaStore } from './sla.js';

export interface DepsOperativo {
  pool: pg.Pool;
  cfg: Config;
  notif: Notificatore;
  sla: SlaStore;
  backends: Record<string, BackendTicket>;
  crm: DepsCrmOps;
  sincronizza?: (parte: ParteSync, completa: boolean) => Promise<Record<string, unknown> | 'occupato'>;
}

type Q = Record<string, string | undefined>;
const lista = (s?: string) => {
  const v = s?.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
  return v?.length ? v : undefined;
};
const numero = (s: string | undefined, nome: string): number | undefined => {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ErroreRichiesta(`${nome} non valido`);
  return n;
};
const idNum = (s: string): number => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new ErroreRichiesta('id non valido');
  return n;
};
const giorno = (s: string | undefined, nome: string, fine = false): string | undefined => {
  if (!s) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ErroreRichiesta(`${nome} non valida (AAAA-MM-GG)`);
  const d = mezzanotteRoma(s);
  return (fine ? new Date(mezzanotteRoma(new Date(d.getTime() + 36 * 3600_000).toISOString().slice(0, 10))) : d).toISOString();
};

const testo = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
const testoOVuoto = (max: number) => ({ type: 'string', maxLength: max });
const email = { type: 'string', maxLength: 254 };
const businessSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, required, properties });
const clienteDatiProps = {
  nome: testo(200),
  email: { anyOf: [email, { type: 'null' }] },
  partita_iva: { anyOf: [{ type: 'string', pattern: '^([0-9]{11}|[A-Za-z]{2}[A-Za-z0-9]{2,13})$' }, { type: 'string', maxLength: 0 }, { type: 'null' }] },
  codice_fiscale: { anyOf: [{ type: 'string', pattern: '^([A-Za-z0-9]{16}|[0-9]{11})$' }, { type: 'string', maxLength: 0 }, { type: 'null' }] },
  telefono: { anyOf: [testoOVuoto(40), { type: 'null' }] },
  businesses: { type: 'array', items: businessSchema, maxItems: 10 },
  stato: testo(60),
};

export function registraOperativo(app: FastifyInstance, d: DepsOperativo, richiediSessione: preHandlerAsyncHookHandler, urlBase: string) {
  const { pool, cfg } = d;
  const ops: DepsOps = { pool, cfg, sla: d.sla, backends: d.backends, notif: d.notif };
  const P = '/dashboard/api';

  // Protezione dalle richieste fatte da altri siti con il cookie dell'utente: le scritture devono avere un'intestazione che un altro sito
  // non può aggiungere (non c'è CORS) e, se il browser manda l'origine, deve essere quella del portale.
  const csrf = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers['x-richiesta'] !== 'portale') return reply.code(403).send({ errore: 'richiesta non valida' });
    const origin = req.headers.origin;
    if (origin && origin !== urlBase) return reply.code(403).send({ errore: 'origine non consentita' });
  };
  const lettura = [richiediSessione];
  const scrittura = [richiediSessione, csrf];

  const ctx = (req: FastifyRequest): { s: Sessione; ambito: Ambito; p: Permessi; chi: string } => {
    const s = req.sessione!;
    return { s, ambito: ambitoDiSessione(s), p: permessiDiSessione(s), chi: s.email ?? s.nome };
  };
  const consenti = (ok: boolean, cosa: string) => {
    if (!ok) throw new ErroreCrm(403, `il tuo ruolo non può ${cosa}`);
  };
  const attivitaConsentita = (ambito: Ambito, b: string) => {
    if (ambito.business !== null && !ambito.business.includes(b)) throw new ErroreCrm(403, 'attività non consentita');
  };
  /** Il ticket esiste ed è di un'attività visibile a chi chiede, altrimenti 404. */
  const ticketVisibile = async (ambito: Ambito, ref: string) => {
    const r = await pool.query<{ business: string }>('SELECT business FROM ticket WHERE ref = $1', [ref]);
    const t = r.rows[0];
    if (!t || (ambito.business !== null && !ambito.business.includes(t.business))) throw new ErroreTicket(404, 'ticket non trovato');
  };

  // ------------------------------------------------------------ me e utenti
  app.get(`${P}/utenti`, { preHandler: lettura }, async (req) => ({ utenti: await utentiAssegnabili(pool, ctx(req).ambito) }));
  /** Attività che il portale conosce anche se non hanno ancora dati: fonti ticket, alias ClickUp, regole SLA. */
  const attivitaConfigurate = async () => {
    const sla = await d.sla.get();
    return [...new Set([...Object.values(cfg.ticket.fonti).map((f) => f.business), ...Object.values(cfg.crm?.alias ?? {}), ...Object.keys(sla.business)])].sort();
  };
  /** Piani ammessi per attività (con "nessuno"), per i menu dei ticket e dei clienti. */
  app.get(`${P}/piani-sla`, { preHandler: lettura }, async () => {
    const sla = await d.sla.get();
    return {
      per_business: Object.fromEntries(Object.keys(sla.business).map((b) => [b, pianiAmmessi(sla, b)])),
      predefiniti: Object.fromEntries(Object.entries(sla.business).filter(([, v]) => v.pianoPredefinito).map(([b, v]) => [b, v.pianoPredefinito])),
      business: await attivitaConfigurate(),
    };
  });

  // ------------------------------------------------------------ impostazioni SLA (solo owner)
  const schemaOre = (max: number) => ({ type: 'integer', minimum: 1, maximum: max });
  const schemaCoppia = obj({ prima_risposta_ore: schemaOre(720), risoluzione_ore: schemaOre(2160) }, ['prima_risposta_ore', 'risoluzione_ore']);
  app.get(`${P}/impostazioni/sla`, { preHandler: lettura }, async (req) => {
    consenti(ctx(req).p.impostazioni, 'vedere le impostazioni');
    return impostazioniSla(pool, await attivitaConfigurate());
  });
  app.put<{ Body: ImpostazioniSla }>(
    `${P}/impostazioni/sla`,
    {
      preHandler: scrittura,
      schema: {
        body: obj(
          {
            predefinito: schemaCoppia,
            business: {
              type: 'array',
              maxItems: 50,
              items: obj(
                {
                  business: businessSchema,
                  standard: { anyOf: [schemaCoppia, { type: 'null' }] },
                  piano_predefinito: { anyOf: [{ type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,15}$' }, { type: 'null' }] },
                  piani: { type: 'array', maxItems: 20, items: obj({ piano: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,15}$' }, prima_risposta_ore: schemaOre(720), risoluzione_ore: schemaOre(2160) }, ['piano', 'prima_risposta_ore', 'risoluzione_ore']) },
                },
                ['business', 'standard', 'piano_predefinito', 'piani'],
              ),
            },
          },
          ['predefinito', 'business'],
        ),
      },
    },
    async (req) => {
      const { p, chi } = ctx(req);
      consenti(p.impostazioni, 'cambiare le impostazioni');
      try {
        await salvaImpostazioniSla(pool, d.sla, req.body, chi);
      } catch (e) {
        if (e instanceof ErroreSla) throw new ErroreRichiesta(e.message);
        throw e;
      }
      req.log.info({ chi }, 'impostazioni SLA aggiornate');
      return impostazioniSla(pool, await attivitaConfigurate());
    },
  );

  // ------------------------------------------------------------ ticket
  app.post<{ Body: { business: string; oggetto: string; testo?: string; priorita?: Priorita; categoria?: string; cliente?: { nome?: string; email?: string; partita_iva?: string }; piano_sla?: string } }>(
    `${P}/ticket`,
    {
      preHandler: scrittura,
      schema: {
        body: obj(
          {
            business: businessSchema, oggetto: testo(300), testo: testo(8000), priorita: { type: 'string', enum: PRIORITA }, categoria: testo(80), piano_sla: testo(16),
            cliente: obj({ nome: testo(200), email, partita_iva: { type: 'string', pattern: '^([0-9]{11}|[A-Za-z]{2}[A-Za-z0-9]{2,13})$' } }),
          },
          ['business', 'oggetto'],
        ),
      },
    },
    async (req, reply) => {
      const { ambito, p, chi } = ctx(req);
      consenti(p.ticketScrive, 'aprire ticket');
      attivitaConsentita(ambito, req.body.business);
      if (req.body.piano_sla && !pianiAmmessi(await d.sla.get(), req.body.business).includes(req.body.piano_sla)) throw new ErroreRichiesta('piano SLA sconosciuto per questa attività');
      const t = await creaDaPortale(ops, req.body, chi);
      return reply.code(201).send({ ref: t.ref, stato: t.stato, scade_prima_risposta: t.scade_prima_risposta, scade_risoluzione: t.scade_risoluzione });
    },
  );

  app.patch<{ Params: { ref: string }; Body: { stato?: StatoTicket; priorita?: Priorita; assegnato_a?: string; categoria?: string; piano_sla?: string } }>(
    `${P}/ticket/:ref`,
    {
      preHandler: scrittura,
      schema: {
        body: obj({ stato: { type: 'string', enum: STATI_TICKET }, priorita: { type: 'string', enum: PRIORITA }, assegnato_a: testoOVuoto(200), categoria: testoOVuoto(80), piano_sla: testo(16) }),
      },
    },
    async (req) => {
      const { ambito, p, chi } = ctx(req);
      consenti(p.ticketScrive, 'modificare i ticket');
      await ticketVisibile(ambito, req.params.ref);
      const t = await modifica(ops, req.params.ref, req.body, chi);
      return { ref: t.ref, stato: t.stato, priorita: t.priorita, assegnato_a: t.assegnato_a, categoria: t.categoria, piano_sla: t.piano_sla, scade_prima_risposta: t.scade_prima_risposta, scade_risoluzione: t.scade_risoluzione };
    },
  );

  app.get<{ Params: { ref: string } }>(`${P}/ticket/:ref/conversazione`, { preHandler: lettura }, async (req) => {
    await ticketVisibile(ctx(req).ambito, req.params.ref);
    return conversazione(ops, req.params.ref);
  });

  app.post<{ Params: { ref: string }; Body: { testo: string; interno?: boolean } }>(
    `${P}/ticket/:ref/messaggi`,
    { preHandler: scrittura, schema: { body: obj({ testo: testo(8000), interno: { type: 'boolean' } }, ['testo']) } },
    async (req) => {
      const { ambito, p, chi } = ctx(req);
      consenti(p.ticketScrive, 'rispondere ai ticket');
      await ticketVisibile(ambito, req.params.ref);
      const t = await rispondi(ops, req.params.ref, { testo: req.body.testo, interno: req.body.interno ?? false }, chi);
      return { ref: t.ref, prima_risposta_il: t.prima_risposta_il };
    },
  );

  // ------------------------------------------------------------ clienti (anagrafica su ClickUp) e CRM
  app.get<{ Params: { id: string } }>(`${P}/clienti/:id/scheda`, { preHandler: lettura }, async (req, reply) => {
    const s = await schedaCliente(pool, ctx(req).ambito, req.params.id);
    if (!s) return reply.code(404).send({ errore: 'cliente non trovato' });
    return s;
  });

  app.post<{ Body: { nome: string; email?: string; partita_iva?: string; codice_fiscale?: string; telefono?: string; businesses?: string[] } }>(
    `${P}/clienti`,
    { preHandler: scrittura, schema: { body: obj(clienteDatiProps, ['nome']) } },
    async (req, reply) => {
      const { ambito, p } = ctx(req);
      consenti(p.crmAnagrafica, 'creare clienti');
      const r = await creaCliente(d.crm, ambito, req.body);
      return reply.code(201).send(r);
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    `${P}/clienti/:id`,
    { preHandler: scrittura, schema: { body: obj(clienteDatiProps) } },
    async (req) => {
      const { ambito, p } = ctx(req);
      consenti(p.crmAnagrafica, 'modificare i clienti');
      await aggiornaCliente(d.crm, ambito, req.params.id, req.body as never);
      return { ok: true };
    },
  );

  app.put<{ Params: { id: string }; Body: { piano_sla: string | null } }>(
    `${P}/clienti/:id/piano-sla`,
    { preHandler: scrittura, schema: { body: obj({ piano_sla: { anyOf: [testo(16), { type: 'null' }] } }, ['piano_sla']) } },
    async (req) => {
      const { ambito, p } = ctx(req);
      consenti(p.crmAnagrafica, 'cambiare il piano di assistenza');
      const piano = req.body.piano_sla;
      if (piano !== null) {
        // Il piano vale per le attività del cliente che lo prevedono: deve esistere in almeno una di esse.
        const cl = await clienteVisibile(pool, ambito, req.params.id);
        const sla = await d.sla.get();
        if (!cl.businesses.some((b) => pianiAmmessi(sla, b).includes(piano))) throw new ErroreRichiesta('nessuna attività del cliente ha questo piano SLA');
      }
      await impostaPianoCliente(pool, ambito, req.params.id, piano);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { nome: string; ruolo?: string; email?: string; telefono?: string; principale?: boolean } }>(
    `${P}/clienti/:id/contatti`,
    { preHandler: scrittura, schema: { body: obj({ nome: testo(200), ruolo: testo(100), email, telefono: testo(40), principale: { type: 'boolean' } }, ['nome']) } },
    async (req, reply) => {
      const { ambito, p } = ctx(req);
      consenti(p.crmScrive, 'modificare i contatti');
      return reply.code(201).send({ id: await creaContatto(pool, ambito, req.params.id, req.body) });
    },
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    `${P}/contatti/:id`,
    { preHandler: scrittura, schema: { body: obj({ nome: testo(200), ruolo: testoOVuoto(100), email: testoOVuoto(254), telefono: testoOVuoto(40), principale: { type: 'boolean' } }) } },
    async (req) => {
      const { ambito, p } = ctx(req);
      consenti(p.crmScrive, 'modificare i contatti');
      await aggiornaContatto(pool, ambito, idNum(req.params.id), req.body as never);
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(`${P}/contatti/:id`, { preHandler: scrittura }, async (req) => {
    const { ambito, p } = ctx(req);
    consenti(p.crmScrive, 'modificare i contatti');
    await eliminaContatto(pool, ambito, idNum(req.params.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { testo: string } }>(
    `${P}/clienti/:id/note`,
    { preHandler: scrittura, schema: { body: obj({ testo: testo(4000) }, ['testo']) } },
    async (req, reply) => {
      const { ambito, p, chi } = ctx(req);
      consenti(p.crmScrive, 'scrivere note');
      return reply.code(201).send({ id: await creaNota(pool, ambito, req.params.id, req.body.testo, chi) });
    },
  );
  app.patch<{ Params: { id: string }; Body: { fissata?: boolean; testo?: string } }>(
    `${P}/note/:id`,
    { preHandler: scrittura, schema: { body: obj({ fissata: { type: 'boolean' }, testo: testo(4000) }) } },
    async (req) => {
      const { ambito, p } = ctx(req);
      consenti(p.crmScrive, 'modificare le note');
      await modificaNota(pool, ambito, idNum(req.params.id), req.body);
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(`${P}/note/:id`, { preHandler: scrittura }, async (req) => {
    const { ambito, p } = ctx(req);
    consenti(p.crmScrive, 'modificare le note');
    await eliminaNota(pool, ambito, idNum(req.params.id));
    return { ok: true };
  });

  app.get(`${P}/clienti-duplicati`, { preHandler: lettura }, async (req) => ({ duplicati: await duplicati(pool, ctx(req).ambito) }));

  // ------------------------------------------------------------ attività
  app.get<{ Querystring: Q }>(`${P}/attivita`, { preHandler: lettura }, async (req) => {
    const q = req.query;
    const stato = q.stato;
    if (stato && !['aperte', 'completate', 'tutte'].includes(stato)) throw new ErroreRichiesta('stato non valido');
    return elencoAttivita(pool, ctx(req).ambito, {
      stato: stato as never, scadute: q.scadute === 'true', assegnato: q.assegnato || undefined, cliente: q.cliente || undefined, business: lista(q.business), limite: numero(q.limite, 'limite'), offset: numero(q.offset, 'offset'),
    });
  });
  app.post<{ Body: { titolo: string; tipo?: (typeof TIPI_ATTIVITA)[number]; scadenza?: string; assegnato_a?: string; cliente?: string; ticket_ref?: string; business?: string } }>(
    `${P}/attivita`,
    {
      preHandler: scrittura,
      schema: { body: obj({ titolo: testo(300), tipo: { type: 'string', enum: TIPI_ATTIVITA }, scadenza: { type: 'string', format: 'date-time' }, assegnato_a: testo(200), cliente: testo(40), ticket_ref: testo(200), business: businessSchema }, ['titolo']) },
    },
    async (req, reply) => {
      const { ambito, p, chi } = ctx(req);
      consenti(p.crmScrive, 'creare attività');
      return reply.code(201).send({ id: await creaAttivita(pool, ambito, req.body, chi) });
    },
  );
  app.patch<{ Params: { id: string }; Body: { completata?: boolean; titolo?: string; scadenza?: string | null; assegnato_a?: string | null } }>(
    `${P}/attivita/:id`,
    {
      preHandler: scrittura,
      schema: { body: obj({ completata: { type: 'boolean' }, titolo: testo(300), scadenza: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] }, assegnato_a: { anyOf: [testoOVuoto(200), { type: 'null' }] } }) },
    },
    async (req) => {
      const { ambito, p } = ctx(req);
      consenti(p.crmScrive, 'modificare le attività');
      await aggiornaAttivita(pool, ambito, idNum(req.params.id), req.body);
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(`${P}/attivita/:id`, { preHandler: scrittura }, async (req) => {
    const { ambito, p } = ctx(req);
    consenti(p.crmScrive, 'modificare le attività');
    await eliminaAttivita(pool, ambito, idNum(req.params.id));
    return { ok: true };
  });

  // ------------------------------------------------------------ trattative
  app.get<{ Querystring: Q }>(`${P}/opportunita`, { preHandler: lettura }, async (req) => {
    const q = req.query;
    const fase = lista(q.fase);
    for (const f of fase ?? []) if (!(FASI_OPPORTUNITA as readonly string[]).includes(f)) throw new ErroreRichiesta(`fase non valida: ${f}`);
    return elencoOpportunita(pool, ctx(req).ambito, { business: lista(q.business), fase: fase as Fase[] | undefined, assegnato: q.assegnato || undefined, cliente: q.cliente || undefined, q: q.q?.trim() || undefined, aperte: q.aperte === 'true', ferme: numero(q.ferme_giorni, 'ferme_giorni') });
  });
  const propsOpp = {
    titolo: testo(300), business: businessSchema, cliente: { anyOf: [testo(40), { type: 'null' }] }, prospect: { anyOf: [testo(200), { type: 'null' }] }, fase: { type: 'string', enum: FASI_OPPORTUNITA },
    valore: { anyOf: [{ type: 'number', minimum: 0, maximum: 10_000_000 }, { type: 'null' }] }, chiusura_prevista: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
    assegnato_a: { anyOf: [testoOVuoto(200), { type: 'null' }] }, motivo_perdita: { anyOf: [testoOVuoto(300), { type: 'null' }] },
  };
  app.post<{ Body: { titolo: string; business: string } & Record<string, unknown> }>(
    `${P}/opportunita`,
    { preHandler: scrittura, schema: { body: obj(propsOpp, ['titolo', 'business']) } },
    async (req, reply) => {
      const { ambito, p, chi } = ctx(req);
      consenti(p.crmAnagrafica, 'creare trattative');
      return reply.code(201).send({ id: await creaOpportunita(pool, ambito, req.body as never, chi) });
    },
  );
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(`${P}/opportunita/:id`, { preHandler: scrittura, schema: { body: obj(propsOpp) } }, async (req) => {
    const { ambito, p } = ctx(req);
    consenti(p.crmAnagrafica, 'modificare le trattative');
    await aggiornaOpportunita(pool, ambito, idNum(req.params.id), req.body as never);
    return { ok: true };
  });

  // ------------------------------------------------------------ viste dei ticket con i numeri, ricerca globale, risposte rapide
  app.get<{ Querystring: Q }>(`${P}/ticket-viste`, { preHandler: lettura }, async (req) => {
    const { s, ambito } = ctx(req);
    return conteggiViste(pool, ambito, s.email ?? s.nome, lista(req.query.business));
  });

  app.get<{ Querystring: Q }>(`${P}/cerca`, { preHandler: lettura, schema: { querystring: obj({ q: { type: 'string', maxLength: 100 }, business: { type: 'string', maxLength: 200 } }) } }, async (req) => {
    return cerca(pool, ctx(req).ambito, req.query.q ?? '', lista(req.query.business));
  });

  app.get(`${P}/risposte-rapide`, { preHandler: lettura }, async (req) => ({ risposte: await elencoRisposte(pool, ctx(req).ambito) }));
  const propsRisposta = { nome: testo(80), testo: testo(4000), business: { anyOf: [businessSchema, { type: 'null' }] } };
  app.post<{ Body: { nome: string; testo: string; business?: string | null } }>(
    `${P}/risposte-rapide`,
    { preHandler: scrittura, schema: { body: obj(propsRisposta, ['nome', 'testo']) } },
    async (req, reply) => {
      const { p, chi } = ctx(req);
      consenti(p.impostazioni, 'gestire le risposte rapide');
      return reply.code(201).send({ id: await creaRisposta(pool, req.body, chi) });
    },
  );
  app.patch<{ Params: { id: string }; Body: { nome?: string; testo?: string; business?: string | null } }>(
    `${P}/risposte-rapide/:id`,
    { preHandler: scrittura, schema: { body: obj(propsRisposta) } },
    async (req) => {
      consenti(ctx(req).p.impostazioni, 'gestire le risposte rapide');
      await aggiornaRisposta(pool, idNum(req.params.id), req.body);
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(`${P}/risposte-rapide/:id`, { preHandler: scrittura }, async (req) => {
    consenti(ctx(req).p.impostazioni, 'gestire le risposte rapide');
    await eliminaRisposta(pool, idNum(req.params.id));
    return { ok: true };
  });

  // ------------------------------------------------------------ viste salvate
  app.get<{ Querystring: { sezione?: string } }>(`${P}/viste`, { preHandler: lettura }, async (req) => {
    const sezione = req.query.sezione ?? '';
    if (!['ticket', 'clienti', 'fatture', 'opportunita'].includes(sezione)) throw new ErroreRichiesta('sezione non valida');
    return { viste: await elencoViste(pool, sezione, ctx(req).s.sub) };
  });
  app.post<{ Body: { sezione: string; nome: string; filtro: Record<string, unknown>; condivisa?: boolean } }>(
    `${P}/viste`,
    { preHandler: scrittura, schema: { body: obj({ sezione: { type: 'string', enum: ['ticket', 'clienti', 'fatture', 'opportunita'] }, nome: testo(60), filtro: { type: 'object', maxProperties: 20 }, condivisa: { type: 'boolean' } }, ['sezione', 'nome', 'filtro']) } },
    async (req, reply) => {
      const { s, p } = ctx(req);
      if (req.body.sezione === 'fatture') consenti(p.fatture, 'salvare viste di fatturazione');
      return reply.code(201).send({ id: await creaVista(pool, { ...req.body, condivisa: req.body.condivisa ?? false }, s.sub) });
    },
  );
  app.delete<{ Params: { id: string } }>(`${P}/viste/:id`, { preHandler: scrittura }, async (req) => {
    const { s } = ctx(req);
    await eliminaVista(pool, idNum(req.params.id), s.sub, s.ruoli.includes('owner'));
    return { ok: true };
  });

  // ------------------------------------------------------------ fatturazione (sola lettura)
  const filtroDocumenti = (q: Q): FiltroDocumenti => {
    const ordine = q.ordine as FiltroDocumenti['ordine'] | undefined;
    if (ordine && !['recenti', 'vecchi', 'importo', 'numero'].includes(ordine)) throw new ErroreRichiesta('ordine non valido');
    const anno = numero(q.anno, 'anno');
    return {
      tipo: lista(q.tipo), stato: lista(q.stato), fonte: lista(q.fonte), business: lista(q.business), anno, q: q.q?.trim() || undefined, cliente: q.cliente || undefined,
      da: giorno(q.da, 'da'), a: giorno(q.a, 'a', true), importoMin: numero(q.importo_min, 'importo_min'), importoMax: numero(q.importo_max, 'importo_max'), ordine,
      limite: numero(q.limite, 'limite'), offset: numero(q.offset, 'offset'),
    };
  };
  app.get<{ Querystring: Q }>(`${P}/documenti`, { preHandler: lettura }, async (req) => elencoDocumenti(pool, ctx(req).ambito, filtroDocumenti(req.query)));
  app.get<{ Params: { ref: string } }>(`${P}/documenti/:ref`, { preHandler: lettura }, async (req, reply) => {
    const x = await dettaglioDocumento(pool, ctx(req).ambito, req.params.ref);
    if (!x) return reply.code(404).send({ errore: 'documento non trovato' });
    return x;
  });
  app.get<{ Querystring: Q }>(`${P}/documenti-riepilogo`, { preHandler: lettura }, async (req) => ({
    mesi: await riepilogoMensile(pool, ctx(req).ambito, { business: lista(req.query.business), anno: numero(req.query.anno, 'anno') }),
  }));

  // ------------------------------------------------------------ esportazione CSV (con gli stessi filtri della lista)
  app.get<{ Params: { cosa: string }; Querystring: Q }>(`${P}/export/:cosa`, { preHandler: lettura }, async (req, reply) => {
    const { ambito } = ctx(req);
    const q = req.query;
    let csv: string;
    if (req.params.cosa === 'documenti') {
      const r = await elencoDocumenti(pool, ambito, filtroDocumenti(q), true);
      csv = inCsv(r.documenti, [
        { chiave: 'ref', titolo: 'Rif' }, { chiave: 'tipo', titolo: 'Tipo' }, { chiave: 'anno', titolo: 'Anno' }, { chiave: 'numero', titolo: 'Numero' }, { chiave: 'data_riserva', titolo: 'Data' },
        { chiave: 'stato', titolo: 'Stato' }, { chiave: 'business', titolo: 'Attività' }, { chiave: 'cliente_nome', titolo: 'Cliente' }, { chiave: 'partita_iva', titolo: 'P.IVA' }, { chiave: 'totale', titolo: 'Importo' },
      ]);
    } else if (req.params.cosa === 'ticket') {
      const righe: Record<string, unknown>[] = [];
      for (let o = 0; o < 5000; o += 200) {
        const r = await elencoTicket(pool, ambito, {
          business: lista(q.business), fonte: lista(q.fonte), stato: lista(q.stato) as StatoTicket[] | undefined, priorita: lista(q.priorita) as Priorita[] | undefined, assegnato: q.assegnato || undefined,
          nonAssegnati: q.non_assegnati === 'true', piano: lista(q.piano), q: q.q?.trim() || undefined, scaduti: q.scaduti === 'true', limite: 200, offset: o,
        });
        righe.push(...r.ticket);
        if (r.ticket.length < 200) break;
      }
      csv = inCsv(righe, [
        { chiave: 'ref', titolo: 'Rif' }, { chiave: 'business', titolo: 'Attività' }, { chiave: 'oggetto', titolo: 'Oggetto' }, { chiave: 'stato', titolo: 'Stato' }, { chiave: 'priorita', titolo: 'Priorità' },
        { chiave: 'piano_sla', titolo: 'Piano SLA' }, { chiave: 'assegnato_a', titolo: 'Assegnato a' }, { chiave: 'cliente_nome', titolo: 'Cliente' }, { chiave: 'aperto_il', titolo: 'Aperto il' },
        { chiave: 'prima_risposta_il', titolo: 'Prima risposta' }, { chiave: 'risolto_il', titolo: 'Risolto il' },
      ]);
    } else if (req.params.cosa === 'clienti') {
      const righe: Record<string, unknown>[] = [];
      for (let o = 0; o < 5000; o += 200) {
        const r = await elencoClienti(pool, ambito, { business: lista(q.business), q: q.q?.trim() || undefined, stato: q.stato || undefined, limite: 200, offset: o });
        righe.push(...r.clienti);
        if (r.clienti.length < 200) break;
      }
      csv = inCsv(righe, [
        { chiave: 'nome', titolo: 'Nome' }, { chiave: 'email', titolo: 'Email' }, { chiave: 'partita_iva', titolo: 'P.IVA' }, { chiave: 'telefono', titolo: 'Telefono' }, { chiave: 'businesses', titolo: 'Attività' },
        { chiave: 'stato', titolo: 'Stato' }, { chiave: 'ticket_aperti', titolo: 'Ticket aperti' }, ...(ambito.soldi ? [{ chiave: 'fatturato_12m', titolo: 'Fatturato 12 mesi' }] : []),
      ]);
    } else return reply.code(404).send({ errore: 'esportazione sconosciuta' });
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${req.params.cosa}-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(csv);
  });

  // ------------------------------------------------------------ sincronizzazione a richiesta
  app.post<{ Body: { parte?: ParteSync; completa?: boolean } }>(
    `${P}/sync`,
    { preHandler: scrittura, schema: { body: obj({ parte: { type: 'string', enum: ['clienti', 'ticket', 'tutto'] }, completa: { type: 'boolean' } }) } },
    async (req, reply) => {
      consenti(ctx(req).p.sync, 'lanciare la sincronizzazione');
      if (!d.sincronizza) return reply.code(404).send({ errore: 'nessuna sincronizzazione configurata' });
      const r = await d.sincronizza(req.body?.parte ?? 'tutto', req.body?.completa ?? false);
      if (r === 'occupato') return reply.code(409).send({ errore: 'una sincronizzazione è già in corso' });
      return r;
    },
  );
}
