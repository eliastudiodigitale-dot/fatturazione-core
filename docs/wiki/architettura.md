# Architettura (da SPEC.md e codice in src/)

Servizio sul VPS che assegna in modo atomico e idempotente i numeri di proforme e fatture (una sola P.IVA forfettaria), riceve documenti da più fonti con un unico ingresso e li copia in ClickUp.

- Numerazione: `riserva_numero(ref, tipo, fonte, business, payload)` con lock `FOR UPDATE` su `contatori(anno, tipo)`; stessa `ref` = stesso documento (SPEC sez. 3.1). Migrazione 004: data e anno presi con `clock_timestamp()` dopo il lock, così numero e data restano nello stesso ordine (decisioni #5, #14).
- Tabelle: `contatori`, `documenti` (mai cancellabile), `storico` (append-only), `eventi_ricevuti` (dedupe webhook).
- Migrazioni in `migrations/`: 001 schema, 002 permessi, 003 SELECT di `fatturazione_app` su `contatori`, 004 data_riserva ordinata. Applicate sul VPS da Elia con il Job di migrazione (owner `fatturazione`).
- Permessi: l'app (`fatturazione_app`) non cambia `numero`/`ref`/`anno`/`tipo` e non cancella; ogni cambio di stato scrive `storico` nella stessa transazione.
- API (Fastify):
  - `POST /v1/documenti` (riserva, idempotente), `GET /v1/documenti/:ref`, `GET /v1/documenti/:ref/storico`
  - `POST /v1/documenti/:ref/stato`, `POST /v1/documenti/:ref/annulla` (token owner; le fatture non si annullano, #9)
  - `GET /v1/riepilogo`, `GET /healthz`, `GET /readyz` (503 in modalità bloccata)
  - `POST /webhooks/stripe`, `POST /webhooks/gocardless` (firma sul body grezzo)
- Auth: Bearer per fonte (token n8n, dashboard, owner), confronto a tempo costante; rate limit (`RATE_LIMIT_PER_MIN`).
- Stripe: chiave di organizzazione (`sk_org_`) con un account per attività; le letture usano `Stripe-Context` (decisione #37). Invoice con prodotti di attività diverse = bloccata.
- Stripe senza invoice (pagamento diretto, 0.1.4): cliente (ragione sociale, indirizzo, P.IVA/CF) dal Customer Stripe, con ripiego sui billing_details del pagamento (`clienteDaPagamento` in `src/stripe.ts`).
- GoCardless: trigger `paid_out` (#26), una sola attività (#27).
- Clienti (#42, da progettare): anagrafica unica in ClickUp, lista Clienti; il campo `CLICKUP_CAMPO_CLIENTE_ID` è previsto nel codice ma non configurato.
- Stati: riservato → creato → inviato_sdi → consegnato; annullato da riservato/creato (SPEC sez. 5).
- Worker ClickUp: advisory lock Postgres, cerca per campo `chiave` prima di creare (#16); per i documenti da n8n aspetta 45 minuti che il workflow crei la task (#35).
- Riconciliazione giornaliera (ore 6 Roma, `RICONCILIAZIONE_ORA`); modalità bloccata dopo perdita del DB o numeri storici non riallineati (#30). I doppioni storici restano nel rapporto, senza avviso giornaliero (a2a929a).
- Notifiche anomalie su Telegram (#21).
- Fasi: 1 nucleo (fatto, in produzione 0.1.4), 2 SDI (nota di credito inclusa, #24), 3 dashboard e Keycloak (SPEC sez. 10).
