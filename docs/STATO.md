# STATO

Aggiornato: 2026-11-24 (chiusura 17:29). File sovrascritto a ogni chiusura (max 80 righe).

## Fatto
- Specifica: SPEC.md (fb69474). Memoria di progetto installata.
- Fase 1 in produzione: servizio TypeScript/Node 24 (Fastify, `pg`) in `src/`; versione 0.1.4 (65e884d), immagine `fatturazione-core:0.1.4`, namespace `platform`, readyz pronto [riportato da Elia nelle chiusure precedenti]. Rilasci 0.1.0 e 0.1.1 falliti, corretti in 0.1.2 (ba3e016).
- Migrazioni `migrations/001`-`004` applicate sul VPS da Elia. Contatori 2026: fattura 8, proforma 15; prossimi numeri fattura 9, proforma 16.
- Stripe, organizzazione (#37): chiave di organizzazione nel Secret, mappa account in `STRIPE_BUSINESS_PER_ACCOUNT` (reti.gazzolaelia.it #39, serrandasu.it, heyciar.it), webhook unico verso `/webhooks/stripe`, imposte automatiche spente su tutti e tre gli account (verificato 2026-11-08). Catalogo heyciar.it creato (4436c65, 9 prodotti, 17 prezzi, inclusive #40).
- Backup offsite Backblaze B2 (#22) verificato con `rclone cryptcheck` (b6427ee). Riconciliazione: doppioni storici solo nel rapporto (a2a929a).
- n8n: flusso "auto_pro-forma (servizio fatturazione)" importato e acceso da Elia; il vecchio "auto_pro-forma (from clickup) +subtasks" è spento; "auto_invia copia fattura" attivo. Flusso proforme con bozza e OK su Telegram (#44) nel repo (de38db7), test OK; esecuzione reale in n8n [DA VERIFICARE].
- Portale `/dashboard`, nel servizio, NON ancora rilasciato sul VPS (sessione 2026-11-23/24, commit 187707f, f8dab7d, 2d6692e, 92734e2, b3032cf, 4e5e12b; solo nel repo, da pushare):
  - login Keycloak, ruoli owner / amministrazione / assistenza; menu Cruscotto, Ticket, CRM (Clienti, Trattative, Da fare, Duplicati), Fatturazione (sola lettura, filtri, somma, dettaglio, CSV), Impostazioni > SLA (solo owner).
  - protezione CSRF (intestazione X-Richiesta + origine); pagina senza risorse esterne (niente stili inline, barre impostate da script).
- Ticket (#47): vivono nel backend di ogni business e il servizio li richiama via API (contratto `docs/ticket-backend-api.md`, client `src/ticket-backend.ts`, operazioni `src/ticket-ops.ts`; prima il backend, poi la copia locale; sync ogni TICKET_SYNC_MIN=5 min). Senza backend stanno nel DB del servizio. Lista ticket di ClickUp rimossa dal codice.
- SLA (#46, #48): regole nel DB (migrazione 005: `sla_business`, `sla_piani`; `src/sla.ts`), configurabili dal portale per attività. Piani heyciar 48h / 3g / 5g / 7g; heyciar senza piano = nessuno SLA; altre attività 24/72 di partenza. Il piano è del cliente (`crm_clienti.piano_sla`) e del ticket. Modifiche valgono per i ticket nuovi.
- CRM (#42, #45): `src/crm-ops.ts`. Scheda cliente creata/modificata su ClickUp, poi copia in cache; contatti, note, attività, trattative, duplicati, viste; dati del portale nel DB.
- Avvio locale: `npm run locale` (Postgres Docker separato, porta 55433; finti backend e ClickUp; http://localhost:8081/dashboard senza Keycloak, solo localhost). `npm run locale:db` solo il database. `.nvmrc` = 24.
- Verifiche del 2026-11-24 [riportato dalla sessione]: Node 24.22, tsc, typecheck:test, build OK, 197 test su 197. Pagina del portale provata in jsdom (29 passaggi, ruoli owner e assistenza) con harness fuori dal repo.

## In corso
- Nessun lavoro di codice aperto.
- Non committato: solo i file di `docs/` di questa chiusura. Restano modificati `.DS_Store` e non tracciato `n8n/.DS_Store` (file del Finder, non toccati).
- Portale: aspetto grafico NON visto in browser reale (Brave headless non parte nell'ambiente). Mai provato contro ClickUp, Keycloak o backend ticket veri [NON VERIFICATO].

## Prossimo passo
1. Push degli 8 commit (lo esegue Elia, vedi Bloccanti). Poi `npm run locale` e controllo della grafica nel browser.
2. Confermare la lettura dei piani SLA: termine = risoluzione; prima risposta a metà termine [ASSUNZIONE DA CONFERMARE].
3. Implementare l'API ticket (`docs/ticket-backend-api.md`) nei backend di heyciar, serrandasu.it e reti.gazzolaelia.it.
4. Creare la lista ClickUp Clienti (campi: email, P.IVA, CF, telefono, attività), mettere gli ID in ConfigMap; creare ruoli e claim business su Keycloak.
5. Rilascio 0.2.0 (package.json, package-lock e k8s/app.yaml ancora a 0.1.4): migrazione 005 col Job; script `scripts/vps/imposta-chiavi-crm.sh` e `k8s/ingress-crm.yaml` già in repo, da verificare che la lista chiavi includa tutti i `TICKET_BACKEND_TOKEN_*` [DA VERIFICARE]. I comandi completi li prepara Claude a rilascio pronto; li esegue Elia.
6. Ancora aperti: test reale del flusso n8n proforme (bozza #44); flusso "fattura dalla proforma" (#31); numeri doppi storici in ClickUp.

## Bloccanti e domande aperte
- Push: 8 commit locali non pushati, da de38db7 a 4e5e12b (verificato con `git log @{u}..HEAD`). Sono tutti i commit del lavoro chiuso, incluso il lavoro n8n delle sessioni precedenti (de38db7). Commit già su origin/main: 7b46de8 e 34cb219 (la riga precedente su 7b46de8 non è più valida).
  Comando per Elia, dal Mac:
  `cd /Users/elia/offline/REPO-locali/fatturazione-core && B=$(git branch --show-current); echo "commit da inviare:"; git log --oneline @{u}..HEAD; S=$(git diff --name-only @{u}..HEAD | grep -ciE '\.env|secret|\.key|\.pem|credential|token'); if [ "$S" = 0 ]; then git push origin "$B"; else echo "STOP: file sensibili, non pusho"; fi`
  Cosa fa: invia a origin/main gli 8 commit sopra. Rischio: medio, il push pubblica anche il portale e la migrazione 005 (non applicata sul VPS; il push non tocca il servizio in produzione).
  Attenzione: il filtro sui nomi fa STOP per `k8s/secret-api.example.yaml` (nome con "secret", file di esempio senza valori [DA VERIFICARE da Elia]). Il comando non pusha finché il filtro segnala; la scelta di aggirarlo è di Elia.
- Migrazione 005 (CRM, ticket, SLA): riscritta, NON applicata sul VPS. Schema DB: serve conferma esplicita di Elia prima di applicarla col Job. I grant nel file danno SELECT/INSERT/UPDATE a `fatturazione_app` su tabelle nuove [DA VERIFICARE prima dell'applicazione].
- Piani SLA: confermare la prima risposta (metà termine) e i valori per le altre attività (li imposta Elia).
- Da confermare: #30 (i numeri storici bloccano l'avvio; in produzione l'avvio è passato, stato [DA VERIFICARE con `scripts/rilascio/verifica.sh`]); permesso n8n di annullare (#44, resta per i casi dopo la riserva).
- Chiave Stripe di organizzazione: oggi in lettura. Scrittura solo per lo script, meglio una chiave ristretta se Stripe lo consente [DA VERIFICARE].
- Numeri doppi storici in ClickUp (fattura 2026 n.3 x3; proforma 9 e 10 x3): da controllare col commercialista. La riconciliazione li segnala.
- Keycloak: URL e ruoli/claim business da creare [DA VERIFICARE]. Login mai provato con Keycloak reale.
- Incoerenze da sistemare (non toccate, sono codice o config):
  - `.env.example` da riallineare a `src/config.ts` (era disallineato di 20 nomi al 2026-11-08; dopo 92734e2 da ricontrollare) [DA VERIFICARE].
  - `docs/VPS.md` riflette lo stato del 2026-11-07 (0.1.2): non riletto dopo 0.1.3 e 0.1.4.
  - `docs/wiki/stack.md` e decisione #11 parlavano di dashboard Next.js; il repo non ha Next.js, il portale è nel servizio. Da allineare [DA VERIFICARE con Elia].
  - Repo heyciar (altro repo): catalogo sorgente ancora "exclusive", lo script forza inclusive; SLA e STRIPE_PRICE_* da togliere lì (vedi docs/idee.md).
- SPEC sez. 12 ancora aperti: ruolo DB proprio per n8n (oggi n8n usa il superutente `services`; proposta in `docs/accessi-da-creare.md`, voce 6); SSL di services-postgres (in uso PG_SSL=disable, #17 [DA VERIFICARE]).
- Rollback: nessuna procedura documentata per le migrazioni (`docs/wiki/deploy.md`) [DA VERIFICARE].
- Fase 2 (SDI): oggi la fattura elettronica si emette con programma esterno (#36). Ricerca sul provider in sessione separata (#25). Nota di credito in Fase 2 (#24).

## Link
- Decisioni: `docs/decisions.md` (archivio: `docs/decisions-archivio.md`)
- Idee: `docs/idee.md`
- VPS: `docs/VPS.md` · Deploy: `docs/deploy.manifest.md` · Accessi proposti: `docs/accessi-da-creare.md`
- CRM e ticket: `docs/crm-ticket.md` · Contratto ticket: `docs/ticket-backend-api.md` · Stripe heyciar: `docs/heyciar-stripe.md`
- Wiki: `docs/wiki/indice.md` · Specifica: `SPEC.md`
- Diario: `docs/diario/2026-11-24-1729-portale-crm-ticket.md`
