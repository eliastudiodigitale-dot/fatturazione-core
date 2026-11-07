# STATO

Aggiornato: 2026-11-07. File sovrascritto a ogni chiusura (max 80 righe).

## Fatto
- Specifica: SPEC.md (fb69474). Memoria di progetto installata (95d07df) e allineata.
- Fase 1 scritta e testata: servizio TypeScript/Node 24 con Fastify e `pg` in `src/`, 77 test vitest su Postgres 16 di prova in Docker locale (`tests/`). Include API /v1 (riserva idempotente, stato, annulla, riepilogo, storico), webhook Stripe e GoCardless, worker ClickUp, riconciliazione, modalità bloccata, notifiche Telegram.
- Migrazioni `migrations/001`-`004`. 003 (SELECT di `fatturazione_app` su `contatori`) e 004 (data_riserva presa con clock_timestamp dopo il lock: bug trovato dai test) applicate sul VPS da Elia (#13, #14).
- Contatori 2026 riallineati: fattura 8, proforma 15. Prossimi numeri: fattura 9, proforma 16.
- Servizio IN PRODUZIONE sul VPS (namespace `platform`): versione 0.1.2, pod 1/1 Running, /readyz ok. Ingress `gestione.gazzolaelia.it` espone solo `/webhooks/stripe` e `/webhooks/gocardless` (certresolver `le`, Traefik). Nel DB del servizio nessun documento ancora.
- Rilasci 0.1.0 (crash: manca CLICKUP_CAMPO_CHIAVE_ID) e 0.1.1 (bloccato dal controllo sugli anni passati) corretti in 0.1.2 (ba3e016).
- n8n: flusso "auto_pro-forma (servizio fatturazione)" generato da `n8n/adatta-proforma.mjs` (il JSON generato `n8n/auto-proforma-servizio.json` è gitignored), importato e acceso da Elia. Il vecchio "auto_pro-forma (from clickup) +subtasks" è spento. "auto_invia copia fattura" resta attivo.
- Script: `scripts/rilascio/` (migra, riallinea, rilascia, verifica, correggi-config, documenti, annulla), `scripts/vps/` (ricognizione 1-4, crea-secret, esporta-flusso-proforma), `scripts/stripe/tasse-automatiche.sh`.
- k8s/: app, networkpolicy, ingress, migrazione-job, backup-offsite-cronjob (Backblaze B2, rclone crypt; il Secret offsite l'ha creato Elia), secret-api.example.
- Docs: docs/deploy.manifest.md (verificato), docs/VPS.md (ricognizione 2026-11-07), docs/accessi-da-creare.md (proposte, nulla creato).
- Commit: 19 locali non pushati (ultimo 61928bc). Working tree pulito.

## In corso
- Versione 0.1.3 pronta nel repo, NON rilasciata: supporto organizzazione Stripe (chiave `sk_org_`, `STRIPE_BUSINESS_PER_ACCOUNT` da compilare in `k8s/app.yaml`; image tag già 0.1.3). Decisione #37.
- Imposte automatiche Stripe da spegnere: costano per transazione e, con txcd_10000000 e registrazione Italia, scorporano l'IVA (il servizio blocca quelle fatture). `scripts/stripe/tasse-automatiche.sh` elenca e, solo se richiesto, spegne. Stato attuale: [DA VERIFICARE].
- Flusso n8n "fattura dalla proforma" (stessa task, campi nr-fattura e t-fattura): da costruire. Il servizio supporta già chiavi multiple sulla stessa task (#31).

## Prossimo passo
1. Elia indica l'attività di ogni account Stripe: `acct_1QckZ6D55CvX97Iq` (gazzolaelia.it, heyciar.it o entrambe); `acct_1UZ3f2RcP2lkt5Lg` = serrandasu.it. Poi compilare `STRIPE_BUSINESS_PER_ACCOUNT` in `k8s/app.yaml`.
2. Verificare che l'endpoint webhook Stripe sia a livello di organizzazione.
3. Spegnere le imposte automatiche Stripe: prima elenco, poi spegnimento (`scripts/stripe/tasse-automatiche.sh`).
4. Rilascio 0.1.3: lo esegue solo Elia (`scripts/rilascio/rilascia.sh 0.1.3`). Claude verifica test e build sul commit di origin/main e descrive i passi di docs/deploy.manifest.md, senza lanciarli.
5. Costruire il flusso "fattura dalla proforma".
6. Ambiente di prova (stage): proposto, non deciso (vedi docs/idee.md).

## Bloccanti e domande aperte
- Push: 19 commit locali. Il filtro di sicurezza del comando di push si ferma su `.env.example`, `k8s/secret-api.example.yaml` e `scripts/vps/crea-secret.sh` (solo nomi, nessun valore). Decide Elia.
- Attività degli account Stripe (punto 1): bloccante per 0.1.3.
- Da confermare: alias "STUDIO DIGITALE di Elia Gazzola" = gazzolaelia.it; #30 (i numeri storici bloccano l'avvio); permesso n8n di #34; chiave Stripe di organizzazione con piena scrittura (meglio ristretta, se Stripe lo consente).
- Numeri doppi storici in ClickUp (fattura 2026 n.3 x3; proforma 9 e 10 x3): da controllare col commercialista. La riconciliazione li segnala. Stato dello sblocco dell'avvio: [DA VERIFICARE con scripts/rilascio/verifica.sh].
- Incoerenze da sistemare (non toccate: sono codice/config):
  - `package.json` riporta version 0.1.0, mentre la produzione è 0.1.2 e `k8s/app.yaml` usa 0.1.3.
  - `.env.example` non è allineato a `src/config.ts`: mancano 20 nomi letti (tra cui STRIPE_BUSINESS_PER_ACCOUNT, WORKER_ATTESA_CLICKUP_MIN, AVVIO_SENZA_CLICKUP e la maggior parte dei CLICKUP_CAMPO_*_ID); ci sono 2 nomi non letti da nessuno (CLICKUP_CAMPO_BUSINESS_ID, CLICKUP_CAMPO_NUMERO_ID).
- SPEC sez. 12 ancora aperti: ruolo DB proprio per n8n (oggi n8n usa il superutente `services`; proposta in docs/accessi-da-creare.md, voce 6); URL Keycloak (Fase 3); SSL di services-postgres (in uso PG_SSL=disable, #17 [DA VERIFICARE]).
- Fase 2 (SDI): oggi la fattura elettronica si emette con programma esterno (#36). Ricerca sul provider in sessione separata (#25).

## Link
- Decisioni: docs/decisions.md (archivio: docs/decisions-archivio.md)
- Idee: docs/idee.md
- VPS: docs/VPS.md · Deploy: docs/deploy.manifest.md · Accessi proposti: docs/accessi-da-creare.md
- Wiki: docs/wiki/indice.md · Specifica: SPEC.md
- Centro Fatturazione (procedura di avvio, risposte di Elia): https://claude.ai/artifact/VmK2tV8DGZbfUxNCE3o6NT
- Diario: docs/diario/2026-11-07-2259-fase1-produzione.md
