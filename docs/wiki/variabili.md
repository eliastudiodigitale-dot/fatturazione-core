# Variabili d'ambiente (solo nomi)

Nomi letti da `src/config.ts` e `src/index.ts`. Mai valori qui. I segreti si leggono solo via codice dalle variabili d'ambiente e non si stampano mai.

Obbligatorie:
- PG_DB, APP_PG_USER, APP_PG_PASS (credenziali del ruolo `fatturazione_app`), PG_SSL (`disable`, `require` o `verify-full`, #17)
- N8N_TOKEN, DASHBOARD_TOKEN, OWNER_TOKEN (min 32 caratteri)

Opzionali (Postgres): PG_HOST (default `services-postgres`), PG_PORT, PG_CA_FILE

Servizio: PORT, BODY_LIMIT, RATE_LIMIT_PER_MIN, FORZA_BLOCCO, AVVIO_SENZA_CLICKUP (solo prove), PAGAMENTI_TIPO_DOCUMENTO (`fattura` o `proforma`, #15), RICONCILIAZIONE_ORA, RISERVATO_MAX_ORE, WORKER_INTERNI_SEC, WORKER_ESTERNI_SEC, WORKER_ATTESA_CLICKUP_MIN (default 45, #35), LOG_LEVEL

Stripe: STRIPE_API_KEY (chiave di organizzazione `sk_org_` oppure chiave ristretta), STRIPE_WEBHOOK_SECRET, STRIPE_LIVEMODE, STRIPE_BUSINESS_PER_ACCOUNT (formato `acct_...=attività`, separati da virgola, #37), STRIPE_BUSINESS_PREDEFINITO

GoCardless: GC_WEBHOOK_SECRET, GC_API_TOKEN, GC_TRIGGER_ACTION (`confirmed` o `paid_out`), GC_BUSINESS_PREDEFINITO, GC_API_URL

Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (senza entrambe le notifiche restano nei log)

ClickUp: CLICKUP_TOKEN, CLICKUP_API_URL, CLICKUP_RPM, CLICKUP_LIST_ID_FATTURA, CLICKUP_LIST_ID_PROFORMA, CLICKUP_CAMPO_CHIAVE_ID (obbligatorio se ClickUp è attivo), e gli altri `CLICKUP_CAMPO_*_ID` per anno, numeri, flag, totali, date, email, ragione, progetto, cliente, pagata, metodo, area, rata. ClickUp configurato a metà = errore di avvio.

CRM, ticket e dashboard (#45, dettagli in docs/crm-ticket.md): 
- fonti ticket: TICKET_FONTI (`fonte:attività`), un TICKET_TOKEN_<FONTE> per ognuna (min 32 caratteri, tutti diversi)
- backend ticket dei business (#46): TICKET_BACKEND_URL_<FONTE> (https, o http dentro il cluster) e TICKET_BACKEND_TOKEN_<FONTE> (token in uscita, min 32 caratteri); TICKET_SYNC_MIN (default 5)
- SLA: non sono variabili. Le regole (valori di partenza, SLA standard e piani per attività) stanno nel DB (`sla_business`, `sla_piani`) e si cambiano dal portale, Impostazioni > SLA (#46, #48)
- ClickUp CRM: CLICKUP_LIST_ID_CLIENTI (attiva la sync dei clienti), CLICKUP_CLIENTI_CAMPO_{EMAIL,PIVA,CF,TELEFONO,BUSINESS}_ID, CRM_BUSINESS_ALIAS, CRM_BUSINESS_PREDEFINITO, CRM_SYNC_CLIENTI_MIN, CRM_CREA_CLIENTI. I ticket non stanno in ClickUp (#47)
- dashboard (tutte o nessuna): KEYCLOAK_ISSUER, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET, DASHBOARD_SESSION_SECRET (min 32 caratteri), DASHBOARD_URL_BASE, KEYCLOAK_CLAIM_BUSINESS (default `business`)

Secret in k8s: `fatturazione-secrets` (ns `platform`) con PG_USER, PG_PASS, PG_DB (owner, solo migrazioni/backup/pulizia) e APP_PG_USER, APP_PG_PASS (servizio). Secret API da creare con `scripts/vps/crea-secret.sh`.

Incoerenza da sistemare [DA VERIFICARE]: `.env.example` non include 20 nomi letti da `src/config.ts` (tra cui STRIPE_BUSINESS_PER_ACCOUNT, WORKER_ATTESA_CLICKUP_MIN, AVVIO_SENZA_CLICKUP) e contiene CLICKUP_CAMPO_BUSINESS_ID e CLICKUP_CAMPO_NUMERO_ID, che nessun file legge.
