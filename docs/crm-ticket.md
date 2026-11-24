# Portale operativo: ticket, CRM, fatturazione (decisioni #42, #45, #46, #47)

Stato: scritto e testato in locale su Node 24 (suite completa e prova della pagina in un DOM simulato), **non ancora rilasciato**. Migrazione 005 da applicare, Keycloak da configurare, backend dei business da collegare. Il portale non è mai stato provato contro ClickUp, Keycloak o un backend ticket veri [NON VERIFICATO].

## Provarlo in locale (Mac, Node 24, Docker)
```
cd /Users/elia/offline/REPO-locali/fatturazione-core && source ~/.nvm/nvm.sh && nvm use && npm run locale
```
Apre un Postgres 16 locale in Docker (`fatturazione-locale-pg`, porta 55433, dati in un volume), applica le migrazioni 001-005, inserisce dati di esempio la prima volta e avvia il servizio vero con un finto backend heyciar e un finto ClickUp. Poi apri **http://localhost:8081/dashboard** (nessun login: la sessione la mette lo script, solo su localhost). Altro ruolo: `npm run locale -- assistenza` (o `amministrazione`). Ctrl+C per fermare. Ripartire da zero: `docker rm -f fatturazione-locale-pg && docker volume rm fatturazione-locale-dati`. Il DB dei test è un altro container e non si tocca.

## Come funziona
Il portale (`/dashboard`) è il centro operativo: menu a sezioni, ognuna legge e scrive. Oggi sono quattro, altre si aggiungono.

| Sezione | Cosa si fa | Dove stanno i dati |
|---|---|---|
| **Cruscotto** | KPI, "da fare adesso" (ticket da prendere, SLA scaduti, attività scadute), confronto tra attività | copie locali + documenti |
| **Ticket** | elenco con filtri e viste salvate, apertura, assegnazione, stato, priorità, risposte e note interne, piano SLA, export CSV | nel **backend di ogni business**, richiamato via API (#47); i business senza backend: nel **DB Postgres** del servizio |
| **CRM** | Clienti (scheda completa), Trattative (pipeline), Da fare (attività e promemoria), Duplicati | clienti in **ClickUp** (#42); contatti, note, attività, trattative e viste nel DB del portale |
| **Impostazioni** (solo owner) | SLA per attività: valori di partenza, SLA standard, piani a pagamento | DB (`sla_business`, `sla_piani`) |
| **Fatturazione** | documenti in **sola lettura**, filtri (tipo, stato, origine, anno, date, importo, cliente, testo), somma sulla selezione, dettaglio con righe e storico, export CSV | DB del servizio (numerazione ufficiale, #1) |

Chi lavora lì è un utente Keycloak: ogni accesso lo rende assegnabile ai ticket e alle attività.

## Ticket (#47)
- Ogni business espone un'API per i ticket: contratto in [ticket-backend-api.md](ticket-backend-api.md). Il servizio la rilegge ogni `TICKET_SYNC_MIN` minuti (5) in una copia locale per filtri, KPI e SLA; i messaggi non si copiano, si leggono dal backend quando apri il ticket.
- Modifiche e risposte dal portale vanno **prima al backend, poi alla copia**: se il backend non risponde vedi l'errore e non cambia nulla.
- Un business senza backend (`TICKET_BACKEND_URL_<FONTE>` assente) tiene i ticket nel servizio: li apre il portale o la fonte con `POST /v1/ticket`, con conversazione nel DB.
- Le fonti possono anche avvisare subito con `POST /v1/ticket` (token della fonte): idempotente per `<fonte>|<id_esterno>`, il token fissa fonte e attività, ticket urgente = avviso Telegram. `POST /v1/ticket/<ref>/messaggi` registra un messaggio (cliente o staff); se il cliente scrive su un ticket chiuso risponde `da_riaprire: true` e arriva un avviso.
- Nessun ticket in ClickUp (#47): la lista ticket e la sua sincronizzazione sono state tolte dal codice. ClickUp resta solo per i **clienti**.

## SLA a piani, configurabili dal portale (#46, #48)
Ore di calendario, dall'apertura del ticket. Le regole sono **diverse per ogni attività** e stanno nel **DB** (tabelle `sla_business` e `sla_piani`): si cambiano da **Impostazioni > SLA** (solo `owner`), senza toccare file né riavviare. Per ogni attività:
- **SLA standard** (prima risposta e risoluzione, priorità normale; la priorità lo scala: urgente ×0,25, alta ×0,5, bassa ×2). Se non lo imposti vale il **valore di partenza** (24 h / 72 h).
- **Piani a pagamento**: nome libero (es. `48h`), prima risposta e risoluzione. Termini fissi, la priorità non li cambia.
- **Piano dei ticket senza piano indicato**: SLA standard, oppure `nessuno` (senza SLA, best effort), oppure uno dei piani.
Valori iniziali (migrazione 005), solo per **heyciar.it** (confermati da Elia): piani `48h` (il più alto), `3g`, `5g`, `7g`; chi non ha un piano è senza SLA. Per le altre attività nessun piano: valgono i valori di partenza finché non li imposti.
[DA CONFERMARE] Ho letto "entro 48h, 3, 5, 7 giorni" come termine di **risoluzione**, con la prima risposta a metà termine (24, 36, 60, 84 ore); si cambia nel tab.
- Il piano appartiene al **cliente** (si imposta nella scheda) e vale per le attività che lo prevedono; si può anche cambiare per un singolo ticket (le scadenze si ricalcolano dall'apertura).
- Quale piano prende un ticket: quello indicato dal backend o dalla fonte (`piano_sla`), poi quello del cliente, poi il predefinito dell'attività, poi lo SLA standard.
- **Cambiare le impostazioni vale per i ticket nuovi**: i ticket già aperti mantengono le scadenze calcolate. Un piano tolto non si cancella (resta `attivo = false`) e si può rimettere; non si può più assegnare.
- I ticket senza SLA non entrano nelle percentuali SLA dei KPI.

## CRM
- **Clienti**: l'anagrafica è la lista Clienti di ClickUp (#42). Dal portale si **crea** una scheda (se esiste già un cliente con la stessa email o P.IVA il portale apre quella esistente) e si **modifica** (nome, email, telefono, P.IVA, codice fiscale, attività): la scrittura va a ClickUp e poi alla copia. Errore di ClickUp = 502, nulla cambia. Lista ClickUp ancora non configurata = schede in sola lettura.
- **Scheda cliente**: anagrafica, piano di assistenza, contatti (uno principale), attività e promemoria, note (anche fissate), trattative, ticket, documenti e cronologia unica ordinata per data.
- **Trattative**: pipeline Nuova → Contattato → Proposta → Trattativa → Vinta/Persa, per cliente o prospect, con valore, scadenza prevista e responsabile; spostare una trattativa la chiude o la riapre.
- **Da fare**: attività (chiamata, email, riunione, promemoria) con scadenza e responsabile; filtri "scadute" e "solo le mie".
- **Duplicati**: schede con la stessa P.IVA o email, da unire a mano in ClickUp.
- Dati del portale (contatti, note, attività, trattative, viste) stanno nel DB: sono coperti dal backup notturno e dalla copia B2 (#22). Nessuna cancellazione fisica: gli elementi tolti restano marcati `eliminato`.
- Il collegamento fattura→cliente è nel DB, per P.IVA (senza IT) o email; il campo cliente sulla task documento di ClickUp (#42) **non** è scritto da questo lavoro.
- Facoltativo `CRM_CREA_CLIENTI=true`: al primo pagamento Stripe/GoCardless il servizio crea la scheda se manca.

## Fatturazione
Sola lettura: nessun pulsante scrive documenti o numeri. Gli importi sono la somma delle righe, prima del bollo. La somma sopra la tabella esclude gli annullati e vale su tutta la selezione, non solo sulla pagina. Solo `owner` e `amministrazione`: `assistenza` non vede la sezione.

## Viste salvate e CSV
Ogni elenco (ticket, clienti, fatturazione) salva i filtri come "vista" personale o condivisa. L'export CSV usa gli stessi filtri e l'ambito dell'utente (Excel italiano: separatore `;`, protezione dalle formule).

## Permessi e sicurezza
| Ruolo Keycloak | Attività | Importi | Ticket | CRM | Fatturazione |
|---|---|---|---|---|---|
| `owner` | tutte | sì | tutto | tutto | sì |
| `amministrazione` | assegnate (claim `business`) | sì | sola lettura | tutto | sì |
| `assistenza` | assegnate | **no** | gestisce | note, attività, contatti (non anagrafica né trattative) | no |
- Un ruolo ristretto non vede né tocca ciò che non è della sua attività: risposta 404/403, dati tagliati nel DB.
- Ogni scrittura richiede la sessione, l'intestazione `X-Richiesta: portale` e, se presente, un'origine uguale a `DASHBOARD_URL_BASE` (protezione dalle richieste fatte da altri siti). Nessun token in pagina: solo un cookie di sessione firmato (8 ore, HttpOnly, SameSite=Lax).
- La pagina non carica nulla dall'esterno; la CSP ammette solo il suo script. Ogni testo dei dati passa da `esc()`.
- Segreti (`KEYCLOAK_CLIENT_SECRET`, `DASHBOARD_SESSION_SECRET`, token dei backend) solo da variabili d'ambiente (Secret), mai nei log né nelle risposte.

## Keycloak (da configurare, Fase 3 della SPEC)
1. Client **confidential** con *Standard flow* e PKCE; redirect URI `https://gestione.gazzolaelia.it/dashboard/callback`; post-logout `…/dashboard/login`.
2. Ruoli `owner`, `amministrazione`, `assistenza` (realm o client). Realm come indicato da Elia (`business`).
3. Mapper del claim `business` (attributo utente multivalore → ID token; il nome si cambia con `KEYCLOAK_CLAIM_BUSINESS`). Chi non è owner e non ha attività non entra.
4. MFA obbligatorio sul realm (lo impone Keycloak).
5. Il servizio verifica l'ID token: firma RS256 con le chiavi del realm, emittente, destinatario, scadenza, nonce.

## API di lettura (token owner, dashboard o n8n; la dashboard usa gli stessi percorsi sotto `/dashboard/api`)
Filtri comuni: `business`, `fonte` (elenchi con virgola), periodo `giorni=30` oppure `da`/`a` (`AAAA-MM-GG`, ora di Roma, `a` inclusivo).
| Percorso | Cosa dà |
|---|---|
| `GET /v1/ticket` | `stato`, `priorita`, `assegnato`, `non_assegnati=true`, `piano` (`standard`, `nessuno`, `48h`…), `cliente`, `q`, `scaduti=true`, `ordine`, `limite` (200), `offset` |
| `GET /v1/ticket/<ref>` | dettaglio con cronologia e scheda cliente |
| `GET /v1/clienti`, `/v1/clienti/<id>` | elenco (`q`, `stato`, `con_ticket_aperti`, `senza_fatture`, `ordine`) e scheda |
| `GET /v1/kpi/panoramica`, `/kpi/serie`, `/kpi/business`, `/kpi/ticket`, `/kpi/clienti` | KPI |
| `GET /v1/filtri`, `GET /v1/sync/stato` | menu dei filtri; ultimi aggiornamenti (ClickUp e backend: nome `ticket:<fonte>`) |
Solo dal portale (sessione): `/dashboard/api/documenti`, `/documenti/<ref>`, `/documenti-riepilogo`, `/attivita`, `/opportunita`, `/clienti-duplicati`, `/viste`, `/utenti`, `/piani-sla`, `/export/<ticket|clienti|documenti>` e tutte le scritture.

## KPI (definizioni)
- **Backlog** (non risolti/chiusi), da prendere / in lavorazione / in attesa cliente, urgenti e alti aperti, età media.
- **SLA scaduti**: aperti oltre la scadenza di risposta o di risoluzione. **SLA %**: sui ticket **con SLA** (quelli "nessuno" sono esclusi).
- Prima risposta (media, mediana), tempo di risoluzione, arrivati/risolti nel periodo.
- Clienti: totali, nuovi, su più attività, attivi 12 mesi, con ticket aperti. Fatturato: righe delle fatture non annullate (prima del bollo), per attività, primi 10 clienti.

## Messa in produzione (la fa Elia; nulla è stato applicato; i comandi completi li preparo quando tutto è pronto)
Prima di ogni rilascio: commit, push (lo esegue Elia), test in locale su Node 24 sul commit di `origin/main`.
1. **Migrazione 005** col Job (`scripts/rilascio/migra.sh 005_crm_ticket.sql`): solo tabelle nuove e permessi; non tocca documenti e contatori.
2. **Backend dei business**: implementare [ticket-backend-api.md](ticket-backend-api.md) e creare i token; poi `scripts/vps/imposta-chiavi-crm.sh` (i valori si digitano, non si vedono).
3. **Rilascio 0.2.0** (versione da aggiornare in `package.json`, `package-lock.json`, `k8s/app.yaml`) con `scripts/rilascio/rilascia.sh`. Con la ConfigMap ancora vuota il servizio parte invariato.
4. **Lista ClickUp**: solo **Clienti** (campi email, P.IVA, CF, telefono, attività); ID in ConfigMap. Poi gli SLA di ogni attività da Impostazioni > SLA.
5. **Fonti e backend**: `TICKET_FONTI` e `TICKET_BACKEND_URL_<FONTE>` in ConfigMap (i token prima nel Secret, altrimenti l'avvio si ferma: voluto).
6. **Esposizione**: `k8s/ingress-crm.yaml` e/o NetworkPolicy verso i namespace dei backend [DA VERIFICARE].
7. **Keycloak** e variabili `KEYCLOAK_*`, `DASHBOARD_URL_BASE`; riavvio.
Verifica dopo ogni passo: `scripts/rilascio/verifica.sh`; `GET /v1/sync/stato`.

## Posta unificata (proposta, NON costruita)
Richiesta: un solo posto per leggere le email di più caselle. Valutazione:
- **Leggere le caselle (IMAP) dal servizio**: sconsigliato. Il servizio che ha i numeri fiscali avrebbe le password di tutte le caselle, e vanno gestiti riconnessioni, UIDVALIDITY e provider diversi.
- **Regola di inoltro verso una casella dedicata** (ipotesi di Elia): semplice, ma l'inoltro automatico è un punto d'attacco se una casella viene compromessa, e la casella dedicata deve comunque essere letta.
- **Ricezione per webhook** (proposta): i domini inoltrano a un indirizzo di ingresso gestito da un servizio di posta in ingresso che chiama un URL HTTPS del servizio con il messaggio. Nessuna password di caselle nel servizio, un solo segreto di firma. Da decidere: quale servizio (costo, dove sono i DNS), se i messaggi diventano ticket o restano una sezione "Posta", e per quali indirizzi. Da trattare in una sessione dedicata dopo questa.

## Limiti noti
- Mai provato contro ClickUp, Keycloak o backend ticket veri: formati reali (menu a tendina ClickUp, JWKS, API dei business) provati solo con finti costruiti sulla documentazione [NON VERIFICATO].
- La pagina è stata eseguita in un DOM simulato (jsdom) con tutti i passaggi principali; **l'aspetto grafico non è stato visto in un browser** (il browser headless non parte in questo ambiente): da guardare a mano in locale.
- SLA in ore di calendario, non lavorative.
- I ticket remoti non conservano il testo nel DB: se il backend è giù non si leggono i messaggi (la lista resta, dalla copia).
