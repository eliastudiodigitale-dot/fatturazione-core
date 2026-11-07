# Variabili d'ambiente (solo nomi)

Nel repo non c'è `.env.example` né codice: i nomi vengono da SPEC.md. Mai valori qui.

Secret esistente `fatturazione-secrets` (ns `platform`): PG_USER, PG_PASS, PG_DB (owner, solo migrazioni/backup/pulizia), APP_PG_USER, APP_PG_PASS (usati dal servizio).

Secret da creare (es. `fatturazione-api-secrets`): N8N_TOKEN, DASHBOARD_TOKEN, OWNER_TOKEN, STRIPE_WEBHOOK_SECRET, GC_WEBHOOK_SECRET, CLICKUP_TOKEN, GC_API_TOKEN, STRIPE_API_KEY (ristretta in sola lettura).

Configurazione: GC_TRIGGER_ACTION (confirmed o paid_out, da decidere col commercialista); ID di liste e campi custom ClickUp (nomi variabili [DA DEFINIRE]).

In sviluppo i segreti stanno solo in `.env`, mai committato né letto da agenti.
