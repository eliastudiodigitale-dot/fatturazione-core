import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import type { Config, Tipo } from './config.js';
import { creaVerificaToken, type Chiamante } from './auth.js';
import { creaRateLimit } from './ratelimit.js';
import type { Blocco } from './blocco.js';
import { controllaBusta, payloadDaBusta, schemaBusta, type Busta } from './busta.js';
import { cambiaStato, elenco, ErroreStato, perRef, riserva, vistaLeggera } from './documenti.js';
import type { Stato } from './stati.js';
import type { Eventi } from './eventi.js';
import type { StripeApi } from './stripe.js';
import { firmaGcValida } from './gocardless.js';

export interface DepsApp {
  cfg: Config;
  pool: pg.Pool;
  blocco: Blocco;
  eventi: Eventi;
  stripe?: StripeApi;
  logger?: FastifyServerOptions['logger'];
}

declare module 'fastify' {
  interface FastifyRequest {
    chiamante?: Chiamante;
  }
}

export const opzioniLogger = {
  level: process.env.LOG_LEVEL ?? 'info',
  // Mai segreti né PII: niente header di autorizzazione/firma, niente body.
  redact: { paths: ['req.headers.authorization', 'req.headers["stripe-signature"]', 'req.headers["webhook-signature"]'], remove: true },
};

const STATI_API: Stato[] = ['creato', 'inviato_sdi', 'consegnato'];

export async function creaApp(deps: DepsApp): Promise<FastifyInstance> {
  const { cfg, pool, blocco, eventi } = deps;
  const app = Fastify({
    logger: deps.logger ?? opzioniLogger,
    bodyLimit: cfg.bodyLimit,
    trustProxy: true,
    disableRequestLogging: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });
  const verifica = creaVerificaToken(cfg.tokens);
  const limite = creaRateLimit(cfg.rateLimitPerMin);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown; code?: string }, req, reply) => {
    if (err instanceof ErroreStato) return reply.code(err.codice).send({ errore: err.message });
    if (err.validation) return reply.code(400).send({ errore: 'richiesta non valida', dettaglio: err.message });
    const sc = err.statusCode ?? 500;
    if (sc === 413) return reply.code(413).send({ errore: 'body troppo grande' });
    if (sc < 500) return reply.code(sc).send({ errore: 'richiesta non valida' });
    req.log.error({ err: { message: err.message, code: err.code } }, 'errore interno');
    return reply.code(500).send({ errore: 'errore interno' });
  });

  const nonBloccato = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (blocco.bloccato) return reply.code(503).send({ errore: 'servizio in modalità bloccata' });
  };
  const autentica = (ammessi: Chiamante[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    const chi = verifica(req.headers.authorization);
    if (!chi) return reply.code(401).send({ errore: 'non autorizzato' });
    if (!limite(chi)) return reply.code(429).send({ errore: 'troppe richieste' });
    if (!ammessi.includes(chi)) return reply.code(403).send({ errore: 'non consentito' });
    req.chiamante = chi;
  };
  const tutti: Chiamante[] = ['n8n', 'dashboard', 'owner'];

  // --- salute
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
    } catch {
      return reply.code(503).send({ pronto: false });
    }
    if (blocco.bloccato) return reply.code(503).send({ pronto: false, bloccato: true });
    return { pronto: true };
  });

  // --- API documenti
  app.post<{ Body: Busta }>(
    '/v1/documenti',
    { schema: { body: schemaBusta }, preHandler: [autentica(tutti), nonBloccato] },
    async (req, reply) => {
      const b = req.body;
      const errore = controllaBusta(b, req.chiamante!);
      if (errore) return reply.code(400).send({ errore });
      const d = await riserva(pool, { ref: b.ref, tipo: b.tipo, fonte: b.fonte, business: b.business ?? null, payload: payloadDaBusta(b) });
      if (d.tipo !== b.tipo) return reply.code(409).send({ errore: 'ref già usata con un altro tipo' });
      req.log.info({ ref: d.ref, numero: d.numero, anno: d.anno, tipo: d.tipo }, 'riserva');
      return vistaLeggera(d);
    },
  );

  app.get<{ Params: { ref: string } }>('/v1/documenti/:ref', { preHandler: autentica(tutti) }, async (req, reply) => {
    const d = await perRef(pool, req.params.ref);
    if (!d) return reply.code(404).send({ errore: 'documento non trovato' });
    return { ...vistaLeggera(d), fonte: d.fonte, business: d.business, clickup_task_id: d.clickup_task_id };
  });

  app.get<{ Querystring: { stato?: Stato; da?: string; tipo?: Tipo; anno?: string; limite?: string } }>(
    '/v1/documenti',
    {
      preHandler: autentica(tutti),
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stato: { type: 'string', enum: ['riservato', 'creato', 'inviato_sdi', 'consegnato', 'annullato'] },
            da: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}' , maxLength: 40 },
            tipo: { type: 'string', enum: ['fattura', 'proforma'] },
            anno: { type: 'string', pattern: '^\\d{4}$' },
            limite: { type: 'string', pattern: '^\\d{1,4}$' },
          },
        },
      },
    },
    async (req, reply) => {
      const q = req.query;
      if (q.da && Number.isNaN(Date.parse(q.da))) return reply.code(400).send({ errore: 'data non valida' });
      const righe = await elenco(pool, { stato: q.stato, da: q.da, tipo: q.tipo, anno: q.anno ? Number(q.anno) : undefined, limite: Math.min(Number(q.limite ?? 500), 1000) });
      return { documenti: righe };
    },
  );

  app.post<{ Params: { ref: string }; Body: { a_stato: Stato; clickup_task_id?: string; dettaglio?: Record<string, unknown> } }>(
    '/v1/documenti/:ref/stato',
    {
      preHandler: autentica(tutti),
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['a_stato'],
          properties: {
            a_stato: { type: 'string', enum: STATI_API },
            clickup_task_id: { type: 'string', minLength: 1, maxLength: 64 },
            dettaglio: { type: 'object', maxProperties: 20 },
          },
        },
      },
    },
    async (req) => {
      const d = await cambiaStato(pool, req.params.ref, req.body.a_stato, {
        clickupTaskId: req.body.clickup_task_id,
        dettaglio: { ...(req.body.dettaglio ?? {}), da: req.chiamante },
      });
      req.log.info({ ref: d.ref, stato: d.stato }, 'cambio stato');
      return vistaLeggera(d);
    },
  );

  app.post<{ Params: { ref: string }; Body: { motivo: string } }>(
    '/v1/documenti/:ref/annulla',
    {
      preHandler: autentica(['owner']),
      schema: { body: { type: 'object', additionalProperties: false, required: ['motivo'], properties: { motivo: { type: 'string', minLength: 5, maxLength: 1000 } } } },
    },
    async (req) => {
      const d = await cambiaStato(pool, req.params.ref, 'annullato', { noteAnnullo: req.body.motivo, dettaglio: { da: 'owner' } });
      req.log.info({ ref: d.ref, stato: d.stato }, 'annullo');
      return vistaLeggera(d);
    },
  );

  // --- webhook: body grezzo, firma verificata prima di tutto il resto
  await app.register(async (wh) => {
    wh.removeAllContentTypeParsers();
    wh.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    wh.post('/webhooks/stripe', async (req, reply) => {
      if (!deps.stripe || !cfg.pagamentiTipo) return reply.code(404).send();
      if (!limite('webhook:stripe')) return reply.code(429).send();
      const firma = req.headers['stripe-signature'];
      let ev: Awaited<ReturnType<StripeApi['verifica']>>;
      try {
        if (typeof firma !== 'string') throw new Error('firma');
        ev = await deps.stripe.verifica(req.body as Buffer, firma);
      } catch {
        return reply.code(400).send({ errore: 'firma non valida' });
      }
      const id = await eventi.registra('stripe', ev.id, ev);
      reply.code(200).send({ ricevuto: true });
      if (id) setImmediate(() => void eventi.elabora(id).catch((e: Error) => req.log.error({ err: e.message }, 'elaborazione stripe')));
      return reply;
    });

    wh.post('/webhooks/gocardless', async (req, reply) => {
      if (!cfg.gocardless || !cfg.pagamentiTipo) return reply.code(404).send();
      if (!limite('webhook:gocardless')) return reply.code(429).send();
      const body = req.body as Buffer;
      const firma = req.headers['webhook-signature'];
      if (!firmaGcValida(body, typeof firma === 'string' ? firma : undefined, cfg.gocardless.webhookSecret)) return reply.code(498).send();
      let lista: { id?: unknown }[];
      try {
        const parsed = JSON.parse(body.toString('utf8')) as { events?: unknown };
        if (!Array.isArray(parsed.events) || parsed.events.length > 250) throw new Error('events');
        lista = parsed.events as { id?: unknown }[];
      } catch {
        return reply.code(400).send();
      }
      const nuovi: string[] = [];
      for (const ev of lista) {
        if (typeof ev.id !== 'string') continue;
        const id = await eventi.registra('gocardless', ev.id, ev);
        if (id) nuovi.push(id);
      }
      reply.code(204).send();
      setImmediate(async () => {
        for (const id of nuovi) await eventi.elabora(id).catch((e: Error) => req.log.error({ err: e.message }, 'elaborazione gocardless'));
      });
      return reply;
    });
  });

  return app;
}
