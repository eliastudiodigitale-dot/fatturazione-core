# Stack

Dal repo (`package.json`, `Dockerfile`, `tsconfig.json`, `vitest.config.ts`):

- Runtime: Node 24 (`engines` >=24 <25), TypeScript 5.9, ESM (`"type": "module"`).
- Servizio: Fastify 5, `pg` 8 (driver Postgres), `stripe` 23 (verifica firme e letture per organizzazione). Decisione #11 (stack), #12 (Node 24).
- Test: vitest 5 con Postgres 16 di prova in Docker locale. Build: tsc. Avvio dev: tsx.
- Database: Postgres 16 (`services-postgres`, immagine `postgres:16`), DB `fatturazione`. Ruoli: owner per migrazioni, `fatturazione_app` per il servizio (#10).
- Runtime di produzione: k3s sul VPS, namespace `platform`, immagine importata senza registry (#23).
- Servizi esterni: ClickUp (copia dei documenti, limite 100/min condiviso, il servizio ne usa 40), Stripe (organizzazione, un account per attività, #37), GoCardless (trigger `paid_out`, #26), Telegram (notifiche, #21), Backblaze B2 (copia offsite cifrata, #22), n8n (flussi di proforma e fatture, token Bearer, #20).
- Fase 2: provider SDI da scegliere (ricerca dedicata, #25). Oggi la fattura elettronica si emette con programma esterno (#36).
- Fase 3: dashboard Next.js e Keycloak [DA VERIFICARE: URL].
