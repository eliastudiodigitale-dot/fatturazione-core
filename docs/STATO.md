# STATO

Aggiornato: 2026-11-08 (chiusura 16:30). File sovrascritto a ogni chiusura (max 80 righe).

## Fatto
- Specifica: SPEC.md (fb69474). Memoria di progetto installata e allineata.
- Fase 1: servizio TypeScript/Node 24 con Fastify e `pg` in `src/`, 81 test vitest su Postgres 16 di prova in Docker locale (`tests/`). Include API /v1, webhook Stripe e GoCardless, worker ClickUp, riconciliazione, modalità bloccata, notifiche Telegram.
- Migrazioni `migrations/001`-`004`, tutte applicate sul VPS da Elia (003 e 004 per #13 e #14).
- Contatori 2026 riallineati: fattura 8, proforma 15. Prossimi numeri: fattura 9, proforma 16.
- IN PRODUZIONE sul VPS (namespace `platform`): versione 0.1.4 (commit 65e884d), immagine `fatturazione-core:0.1.4`, readyz pronto. Ci sono stati un rilascio con rollback per errore e il ripristino con `kubectl set image` sul tag 0.1.4 [riportato da Elia]. Nel DB del servizio nessun documento ancora [DA VERIFICARE].
- Versione 0.1.4: i pagamenti Stripe senza invoice (payment_intent) prendono ragione sociale, indirizzo e P.IVA/CF dal Customer, con ripiego sui billing_details del pagamento (`clienteDaPagamento` in `src/stripe.ts`, test `tests/stripe-cliente.test.ts`). Build e test verificati su worktree pulito di origin/main. `package.json`, `package-lock.json` e `k8s/app.yaml` a 0.1.4.
- Versione 0.1.3 (supporto organizzazione Stripe) in produzione dal 2026-11-08. Rilasci 0.1.0 e 0.1.1 falliti, corretti in 0.1.2 (ba3e016).
- Ingress `gestione.gazzolaelia.it` espone solo `/webhooks/stripe` e `/webhooks/gocardless` (certresolver `le`, Traefik).
- Stripe, organizzazione (#37):
  - `STRIPE_BUSINESS_PER_ACCOUNT` in `k8s/app.yaml` e sul VPS: `acct_1QckZ6D55CvX97Iq`=reti.gazzolaelia.it (#39), `acct_1UZ3f2RcP2lkt5Lg`=serrandasu.it, `acct_1UZQkwDv9CxsNeAa`=heyciar.it.
  - Chiave di organizzazione nel Secret `fatturazione-api-secrets` (variabile `STRIPE_API_KEY`), in lettura sugli scope usati dal servizio (Charges, Customers, Invoices, PaymentIntents, Products, Subscriptions, Payment Links, Checkout Sessions).
  - Webhook: una sola destinazione di organizzazione verso `/webhooks/stripe`; `STRIPE_WEBHOOK_SECRET` riallineato.
  - Imposte automatiche SPENTE su tutti e tre gli account (verificato il 2026-11-08 con scripts/stripe/tasse-automatiche.sh: abbonamenti, payment link, checkout e fatture 30 giorni = 0, output incollato da Elia).
  - Catalogo heyciar.it creato con `scripts/stripe/heyciar-catalogo.mjs` (4436c65): 9 prodotti, 17 prezzi, id prodotto `heyciar_<chiave>`, `tax_behavior` inclusive, tax code txcd_10000000. Lanciato da Elia il 2026-11-08: 26 creazioni, ricontrollo "Tutto già a posto". Per questo Elia ha dato temporaneamente scrittura su Products e Prices alla chiave del servizio, poi riportata in lettura [riportato da Elia].
- Decisioni del 2026-11-08 (dettaglio in docs/decisions.md): #38 ragione sociale e attività (STUDIO DIGITALE di Elia Gazzola; alias chiuso); #39 reti.gazzolaelia.it = acct_1QckZ6; #40 prezzi senza IVA, inclusive, bollo compreso; #41 pacchetti ore heyciar; #42 anagrafica clienti unica in ClickUp.
- Backup offsite Backblaze B2 (#22): copia verificata con `rclone cryptcheck` (b6427ee). `scripts/rilascio/log-backup.sh` in sola lettura.
- Riconciliazione: doppioni storici solo nel rapporto, senza avviso giornaliero (a2a929a).
- n8n: flusso "auto_pro-forma (servizio fatturazione)" importato e acceso da Elia. Il vecchio "auto_pro-forma (from clickup) +subtasks" è spento. "auto_invia copia fattura" resta attivo.
- Script (`scripts/`):
  - `rilascio/`: migra, riallinea, rilascia, verifica, correggi-config, documenti, annulla, log-backup.
  - `vps/`: ricognizione 1-4, crea-secret, aggiorna-chiave (una sola chiave, il valore si digita), esporta-flusso-proforma.
  - `stripe/`: tasse-automatiche.sh (legge chiave e account, continua se un permesso è negato); heyciar-catalogo.mjs (prova di default, "crea" con conferma).
- k8s/: app, networkpolicy, ingress, migrazione-job, backup-offsite-cronjob, backup-cronjob, pulizia-cronjob, secret-api.example.
- Docs: docs/deploy.manifest.md (verificato), docs/VPS.md (ricognizione 2026-11-07), docs/accessi-da-creare.md (proposte, nulla creato), docs/heyciar-stripe.md (wiki Stripe per heyciar, copiata da Elia in SH-saas/progetto001-accessi/docs/stripe.md).

## In corso
- Nessun lavoro di codice aperto.
- Working tree: le modifiche di questa chiusura (STATO, idee, diario, wiki) non sono committate, come richiesto.
- CRM clienti (#42): deciso, da progettare in sessione dedicata.

## Prossimo passo
1. Push di 7b46de8 (lo esegue Elia, vedi Bloccanti). Commit dei docs di questa chiusura: [DA VERIFICARE chi e quando].
2. Al primo pagamento Stripe reale: webhook consegnato con 200 e documento creato nel DB.
3. Flusso n8n "fattura dalla proforma" (stessa task, campi nr-fattura e t-fattura, #31): da costruire.
4. Progetto CRM (#42) in sessione dedicata: lista Clienti in ClickUp, regola di match (P.IVA o email), chi crea la scheda, campi; poi ticket e SLA (SPEC sez. 10).
5. Applicare #40 ai prodotti Stripe di reti.gazzolaelia.it: [DA VERIFICARE].
6. Ambiente di prova (stage): proposto, non deciso (vedi docs/idee.md).

## Bloccanti e domande aperte
- Push: 1 commit locale non pushato, 7b46de8 (#42, tocca solo docs/decisions.md). Comando da dare a Elia, dal Mac:
  `cd /Users/elia/offline/REPO-locali/fatturazione-core && B=$(git branch --show-current); echo "commit da inviare:"; git log --oneline @{u}..HEAD; S=$(git diff --name-only @{u}..HEAD | grep -ciE '\.env|secret|\.key|\.pem|credential|token'); if [ "$S" = 0 ]; then git push origin "$B"; else echo "STOP: file sensibili, non pusho"; fi`
  Cosa fa: invia a origin/main il solo commit 7b46de8 (nessun commit in più del lavoro chiuso). Rischio: basso, il filtro sui nomi non blocca e il push non tocca il servizio in produzione.
- Da confermare: #30 (i numeri storici bloccano l'avvio; in produzione l'avvio è passato, stato [DA VERIFICARE con scripts/rilascio/verifica.sh]); permesso n8n di #34.
- Chiave Stripe di organizzazione: oggi in lettura. Lo scope di scrittura va dato solo per lo script, e meglio una chiave ristretta, se Stripe lo consente [DA VERIFICARE].
- Numeri doppi storici in ClickUp (fattura 2026 n.3 x3; proforma 9 e 10 x3): da controllare col commercialista. La riconciliazione li segnala.
- Incoerenze da sistemare (non toccate: sono codice/config):
  - `.env.example` non è allineato a `src/config.ts`: mancano 20 nomi letti (tra cui STRIPE_BUSINESS_PER_ACCOUNT, WORKER_ATTESA_CLICKUP_MIN, AVVIO_SENZA_CLICKUP e la maggior parte dei CLICKUP_CAMPO_*_ID); ci sono 2 nomi non letti da nessuno (CLICKUP_CAMPO_BUSINESS_ID, CLICKUP_CAMPO_NUMERO_ID).
  - `docs/VPS.md` riflette lo stato del 2026-11-07 (0.1.2): non riletto dopo 0.1.3 e 0.1.4.
  - Repo heyciar (altro repo): il catalogo sorgente dice ancora exclusive; lo script forza inclusive. Da correggere lì (vedi docs/idee.md).
- SPEC sez. 12 ancora aperti: ruolo DB proprio per n8n (oggi n8n usa il superutente `services`; proposta in docs/accessi-da-creare.md, voce 6); URL Keycloak (Fase 3); SSL di services-postgres (in uso PG_SSL=disable, #17 [DA VERIFICARE]).
- Rollback: nessuna procedura documentata per le migrazioni (docs/wiki/deploy.md) [DA VERIFICARE].
- Fase 2 (SDI): oggi la fattura elettronica si emette con programma esterno (#36). Ricerca sul provider in sessione separata (#25). Nota di credito in Fase 2 (#24).

## Link
- Decisioni: docs/decisions.md (archivio: docs/decisions-archivio.md)
- Idee: docs/idee.md
- VPS: docs/VPS.md · Deploy: docs/deploy.manifest.md · Accessi proposti: docs/accessi-da-creare.md
- Wiki: docs/wiki/indice.md · Specifica: SPEC.md
- Centro Fatturazione (procedura di avvio, risposte di Elia): https://claude.ai/artifact/VmK2tV8DGZbfUxNCE3o6NT
- Diario: docs/diario/2026-11-08-1630-heyciar-0.1.4.md
