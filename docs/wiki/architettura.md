# Architettura (da SPEC.md)

Servizio sul VPS che assegna in modo atomico e idempotente i numeri di proforme e fatture (una sola P.IVA forfettaria), riceve documenti da più fonti con un unico ingresso e li copia in ClickUp.

- Numerazione: funzione SQL `riserva_numero(ref, tipo, fonte, business, payload)`, lock `FOR UPDATE` su `contatori(anno, tipo)`; stessa `ref` = stesso documento (SPEC sez. 3.1)
- Tabelle: `contatori`, `documenti` (mai cancellabile), `storico` (append-only), `eventi_ricevuti` (dedupe webhook)
- Permessi: l'app (`fatturazione_app`) non può cambiare `numero`/`ref`/`anno`/`tipo` né cancellare; ogni cambio di stato scrive `storico` nella stessa transazione
- API REST JSON: `POST /v1/documenti`, `GET /v1/documenti[/{ref}]`, `POST /v1/documenti/{ref}/stato`, `POST /v1/documenti/{ref}/annulla` (token owner), `POST /webhooks/stripe`, `POST /webhooks/gocardless`, `/healthz`, `/readyz` (SPEC sez. 4)
- Auth: Bearer per fonte; webhook con firma sul body grezzo
- Stati: riservato → creato → inviato_sdi → consegnato; annullato da riservato/creato (sez. 5)
- Worker ClickUp con advisory lock Postgres; riconciliazione giornaliera; modalità bloccata dopo perdita DB (sez. 6-7)
- Fasi: 1 nucleo, 2 SDI, 3 dashboard (sez. 10)
- Migrazioni previste: `migrations/001_schema.sql`, `002_permessi.sql` (lo schema è già applicato sul VPS, ma i file non sono ancora nel repo)
