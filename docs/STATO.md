# STATO

Aggiornato: 2026-11-08. File sovrascritto a ogni chiusura (max 80 righe).

## Fatto
- Specifica: SPEC.md (fb69474). Memoria di progetto installata e allineata.
- Fase 1 scritta e testata: servizio TypeScript/Node 24 con Fastify e `pg` in `src/`, 77 test vitest su Postgres 16 di prova in Docker locale (`tests/`). Include API /v1, webhook Stripe e GoCardless, worker ClickUp, riconciliazione, modalità bloccata, notifiche Telegram.
- Migrazioni `migrations/001`-`004`, tutte applicate sul VPS da Elia (003 e 004 per #13 e #14).
- Contatori 2026 riallineati: fattura 8, proforma 15. Prossimi numeri: fattura 9, proforma 16 (invariati).
- IN PRODUZIONE sul VPS (namespace `platform`): versione 0.1.3, rilasciata da Elia. Pod 1/1, /readyz pronto, controllo contatori superato, webhook HTTPS risponde 404 a GET con certificato valido (output di correggi-config.sh incollato da Elia il 2026-11-08). Nel DB del servizio nessun documento ancora [DA VERIFICARE].
- Ingress `gestione.gazzolaelia.it` espone solo `/webhooks/stripe` e `/webhooks/gocardless` (certresolver `le`, Traefik).
- Stripe, organizzazione (#37):
  - `STRIPE_BUSINESS_PER_ACCOUNT` compilato in `k8s/app.yaml` e applicato sul VPS con `scripts/rilascio/correggi-config.sh`: `acct_1QckZ6D55CvX97Iq`=reti.gazzolaelia.it (#39), `acct_1UZ3f2RcP2lkt5Lg`=serrandasu.it, `acct_1UZQkwDv9CxsNeAa`=heyciar.it.
  - Una sola chiave di organizzazione nel Secret `fatturazione-api-secrets` (variabile `STRIPE_API_KEY`), in sola lettura sugli scope: Charges, Customers, Invoices, PaymentIntents, Products, Subscriptions, Payment Links, Checkout Sessions. Sostituita con `scripts/vps/aggiorna-chiave.sh`. La chiave temporanea è stata eliminata da Elia [DA VERIFICARE].
  - Webhook: era duplicato (due destinazioni di organizzazione identiche verso `/webhooks/stripe`). Ne è rimasta una; `STRIPE_WEBHOOK_SECRET` riallineato con `aggiorna-chiave.sh`.
  - Imposte automatiche Stripe SPENTE su tutti e tre gli account (verificato: abbonamenti, Payment Link, Checkout e fatture degli ultimi 30 giorni = 0). Chiuso.
- Prezzi Stripe senza IVA e senza Stripe Tax (#40): decisione registrata. Applicazione ai prodotti esistenti: [DA VERIFICARE].
- Ragione sociale e attività (#38): STUDIO DIGITALE di Elia Gazzola; gazzolaelia.it hub, visual.gazzolaelia.it (3D, mai incassi Stripe), reti.gazzolaelia.it (IT e reti, SaaS hotspot in sviluppo); serrandasu.it e heyciar.it autonomi. Alias chiuso.
- Backup offsite Backblaze B2 (#22): Secret offsite ricreato da Elia (errore 401 risolto), copia verificata con `rclone cryptcheck` (b6427ee). `scripts/rilascio/log-backup.sh` in sola lettura.
- Riconciliazione: doppioni storici solo nel rapporto, senza avviso giornaliero (a2a929a).
- Rilasci 0.1.0 e 0.1.1 falliti (config mancante, controllo anni passati), corretti in 0.1.2 (ba3e016).
- n8n: flusso "auto_pro-forma (servizio fatturazione)" generato da `n8n/adatta-proforma.mjs`, importato e acceso da Elia. Il vecchio "auto_pro-forma (from clickup) +subtasks" è spento. "auto_invia copia fattura" resta attivo.
- Script (`scripts/`):
  - `rilascio/`: migra, riallinea, rilascia, verifica, correggi-config, documenti, annulla, log-backup.
  - `vps/`: ricognizione 1-4, crea-secret, aggiorna-chiave (una sola chiave, il valore si digita), esporta-flusso-proforma.
  - `stripe/tasse-automatiche.sh`: legge la chiave dal Secret sul VPS e gli account da `k8s/app.yaml` (`CHIAVE_A_MANO=1` per digitarla). Continua se un permesso è negato e lo segnala come "non verificato".
- k8s/: app, networkpolicy, ingress, migrazione-job, backup-offsite-cronjob, backup-cronjob, pulizia-cronjob, secret-api.example.
- Docs: docs/deploy.manifest.md (verificato), docs/VPS.md (ricognizione 2026-11-07), docs/accessi-da-creare.md (proposte, nulla creato).

## In corso
- Nessun lavoro aperto nel repo. Working tree con le sole modifiche di questa chiusura (docs e wiki), non ancora committate.
- heyciar.it: catalogo Stripe (9 prodotti, 17 prezzi) da creare con uno script idempotente in una sessione separata. Non avviato, vedi docs/idee.md.

## Prossimo passo
1. Push dei 3 commit locali (lo esegue Elia, vedi sotto).
2. Al primo pagamento Stripe reale: controllare che la consegna del webhook sia 200 e che il documento compaia nel DB.
3. Flusso n8n "fattura dalla proforma" (stessa task, campi nr-fattura e t-fattura, #31): da costruire.
4. Applicare #40 ai prezzi Stripe di reti.gazzolaelia.it e correggere il catalogo heyciar.it (inclusive, non esclusive) prima di crearlo. Da decidere se e quando.
5. Ambiente di prova (stage): proposto, non deciso (vedi docs/idee.md).

## Bloccanti e domande aperte
- Push: 3 commit locali (e93e290, 637150a, d48cdb9). Comando da dare a Elia, dal Mac:
  `cd /Users/elia/offline/REPO-locali/fatturazione-core && B=$(git branch --show-current); echo "commit da inviare:"; git log --oneline @{u}..HEAD; S=$(git diff --name-only @{u}..HEAD | grep -ciE '\.env|secret|\.key|\.pem|credential|token'); if [ "$S" = 0 ]; then git push origin "$B"; else echo "STOP: file sensibili, non pusho"; fi`
  Fa il push dei tre commit del lavoro appena chiuso; nessun commit in più. I file toccati sono docs/decisions.md e k8s/app.yaml, e il filtro sui nomi non li blocca. Il push non tocca il servizio in produzione.
- Da confermare: #30 (i numeri storici bloccano l'avvio; in produzione l'avvio è passato, stato [DA VERIFICARE con scripts/rilascio/verifica.sh]); permesso n8n di #34.
- Numeri doppi storici in ClickUp (fattura 2026 n.3 x3; proforma 9 e 10 x3): da controllare col commercialista. La riconciliazione li segnala.
- Imposte automatiche: lo script di spegnimento richiede scrittura sugli abbonamenti e sui Payment Link, mentre la chiave in uso è in sola lettura. Se servisse rieseguirlo, serve una chiave diversa e temporanea [DA VERIFICARE].
- Incoerenze da sistemare (non toccate: sono codice/config):
  - `package.json` riporta version 0.1.0; produzione 0.1.3, `k8s/app.yaml` usa 0.1.3.
  - `.env.example` non è allineato a `src/config.ts`: mancano 20 nomi letti (tra cui STRIPE_BUSINESS_PER_ACCOUNT, WORKER_ATTESA_CLICKUP_MIN, AVVIO_SENZA_CLICKUP e la maggior parte dei CLICKUP_CAMPO_*_ID); ci sono 2 nomi non letti da nessuno (CLICKUP_CAMPO_BUSINESS_ID, CLICKUP_CAMPO_NUMERO_ID).
  - Il commento in testa a `scripts/stripe/tasse-automatiche.sh` parla ancora di chiave ristretta "creata per l'occasione": la chiave in uso è quella di organizzazione.
- SPEC sez. 12 ancora aperti: ruolo DB proprio per n8n (oggi n8n usa il superutente `services`; proposta in docs/accessi-da-creare.md, voce 6); URL Keycloak (Fase 3); SSL di services-postgres (in uso PG_SSL=disable, #17 [DA VERIFICARE]).
- Fase 2 (SDI): oggi la fattura elettronica si emette con programma esterno (#36). Ricerca sul provider in sessione separata (#25). Nota di credito in Fase 2 (#24).

## Link
- Decisioni: docs/decisions.md (archivio: docs/decisions-archivio.md)
- Idee: docs/idee.md
- VPS: docs/VPS.md · Deploy: docs/deploy.manifest.md · Accessi proposti: docs/accessi-da-creare.md
- Wiki: docs/wiki/indice.md · Specifica: SPEC.md
- Centro Fatturazione (procedura di avvio, risposte di Elia): https://claude.ai/artifact/VmK2tV8DGZbfUxNCE3o6NT
- Diario: docs/diario/2026-11-08-1400-stripe-chiusura.md
