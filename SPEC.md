# fatturazione-core — SPEC

Servizio sul VPS che assegna in modo atomico e idempotente i numeri di proforme e fatture per tutte le attività (una sola P.IVA forfettaria), riceve i documenti da tutte le fonti con un unico ingresso e li copia in ClickUp. Stato: infrastruttura DB, backup e pulizia già creati; da scrivere il servizio.

Data della spec: 2026-11-07. Le voci marcate **[DA VERIFICARE]** non sono state controllate e vanno confermate prima di dipenderne.

---

## 1. Decisioni già prese (non rimetterle in discussione)

1. **Il numero lo assegna il VPS**, al momento in cui il documento arriva, con un contatore atomico per `(anno, tipo)`. ClickUp non assegna né legge mai numeri per decidere il successivo.
2. **ClickUp è una copia/vista**, non la fonte della sequenza. La sequenza ufficiale è nel DB `fatturazione`.
3. **Un solo ingresso** per tutte le fonti: n8n (documenti interni dai progetti ClickUp), Stripe, GoCardless, dashboard. Stessa busta JSON, cambia solo `dati_fonte`.
4. **Fail closed**: nel dubbio il servizio non emette e avvisa. Mai numeri "di fortuna".
5. **La data del documento è `data_riserva`** (fissata dal VPS alla riserva, fuso Europe/Rome), non il momento in cui la task compare in ClickUp. Numero e data devono restare nello stesso ordine.
6. **Eliminare una task in ClickUp non libera né annulla un numero.** Si annulla solo con l'azione esplicita `annulla`.
7. **Il DB non è l'archivio legale.** Le fatture inviate allo SDI sono conservate dall'Agenzia delle Entrate. Qui restano numeri, stati e metadati leggeri.
8. **Dati veri in ClickUp**, DB piccolo: tetto 200 MB (500 MB assoluto), retention già impostata (sez. 9).
9. Le proforme non sono documenti fiscali: un `annullato` non pesa. Per le fatture un numero annullato in mezzo alla sequenza va giustificato **[DA VERIFICARE col commercialista come documentarlo]**.

---

## 2. Infrastruttura esistente (verificata il 2026-11-07)

| Elemento | Valore |
|---|---|
| Cluster | k3s sul VPS, namespace `platform` |
| Postgres | `services-postgres` (Postgres 16.11, immagine `postgres:16`), Service headless `ClusterIP None`, porta 5432 |
| Database | `fatturazione` (nuovo, vuoto all'origine) |
| Ruolo owner | `fatturazione` — **solo** migrazioni, backup e pulizia, mai il servizio |
| Ruolo app | `fatturazione_app` — il servizio usa solo questo |
| Secret | `fatturazione-secrets` (ns `platform`): `PG_USER`, `PG_PASS`, `PG_DB` (owner), `APP_PG_USER`, `APP_PG_PASS` (app) |
| Superutente | `services` possiede tutti gli altri DB ed è usato da n8n. **n8n può quindi leggere anche `fatturazione`** (buco noto, non risolto) |
| Backup | CronJob `fatturazione-backup`, ogni notte 03:40 Europe/Rome, `pg_dump -Fc`, verifica con `pg_restore -l`, retention 30 giorni, tetto 200 MB in cartella, rifiuta dump > 20 MB. PVC `fatturazione-backup` 500 Mi su `local-path` |
| Pulizia | CronJob `fatturazione-pulizia`, 03:20: `raw` di `eventi_ricevuti` svuotato dopo 90 giorni, righe cancellate dopo 400, fallisce se il DB supera 200 MB. `documenti`, `storico`, `contatori` non si toccano mai |
| n8n | Deployment `n8n` in `platform`, usa il DB `n8n` di `services-postgres`, `N8N_HOST=n8n.spaziocliente.it` |
| Keycloak | Già in esecuzione sul VPS. Namespace e URL **[DA VERIFICARE]** |

Note operative:
- `local-path` **non applica la quota del PVC**: i limiti di spazio li fanno gli script.
- Il backup è sullo stesso disco del VPS: protegge da errori e corruzione del DB, non dalla perdita del disco. **Copia fuori dal VPS: ancora da fare** (destinazione da decidere).

---

## 3. Schema DB (già applicato)

Metterlo come migrazione versionata: `migrations/001_schema.sql` e `migrations/002_permessi.sql`. Le migrazioni si eseguono con il ruolo owner `fatturazione` (Job separato), non con quello dell'app.

### 3.1 `001_schema.sql`

```sql
CREATE TABLE contatori (
  anno int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('fattura','proforma')),
  ultimo int NOT NULL DEFAULT 0,
  PRIMARY KEY (anno, tipo)
);

CREATE TABLE documenti (
  id bigserial PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  anno int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('fattura','proforma')),
  numero int NOT NULL,
  data_riserva timestamptz NOT NULL DEFAULT now(),
  stato text NOT NULL DEFAULT 'riservato'
    CHECK (stato IN ('riservato','creato','inviato_sdi','consegnato','annullato')),
  fonte text NOT NULL,
  business text,
  payload jsonb NOT NULL,
  clickup_task_id text,
  note_annullo text,
  UNIQUE (anno, tipo, numero)
);

CREATE TABLE storico (
  id bigserial PRIMARY KEY,
  documento_id bigint NOT NULL REFERENCES documenti(id),
  quando timestamptz NOT NULL DEFAULT now(),
  da_stato text,
  a_stato text NOT NULL,
  dettaglio jsonb
);

CREATE TABLE eventi_ricevuti (
  id bigserial PRIMARY KEY,
  fonte text NOT NULL,
  evento_id text NOT NULL,
  ricevuto_il timestamptz NOT NULL DEFAULT now(),
  elaborato boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL,
  UNIQUE (fonte, evento_id)
);

CREATE FUNCTION blocca_modifiche() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'operazione non consentita su %', TG_TABLE_NAME; END $f$;

CREATE TRIGGER storico_append_only BEFORE UPDATE OR DELETE ON storico
  FOR EACH ROW EXECUTE FUNCTION blocca_modifiche();
CREATE TRIGGER documenti_no_delete BEFORE DELETE ON documenti
  FOR EACH ROW EXECUTE FUNCTION blocca_modifiche();

CREATE FUNCTION riserva_numero(p_ref text, p_tipo text, p_fonte text, p_business text, p_payload jsonb)
RETURNS documenti LANGUAGE plpgsql AS $f$
DECLARE
  v_anno int := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
  v_doc documenti;
  v_num int;
BEGIN
  INSERT INTO contatori(anno, tipo) VALUES (v_anno, p_tipo) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM contatori WHERE anno = v_anno AND tipo = p_tipo FOR UPDATE;
  SELECT * INTO v_doc FROM documenti WHERE ref = p_ref;
  IF FOUND THEN RETURN v_doc; END IF;
  UPDATE contatori SET ultimo = ultimo + 1 WHERE anno = v_anno AND tipo = p_tipo RETURNING ultimo INTO v_num;
  INSERT INTO documenti(ref, anno, tipo, numero, fonte, business, payload)
    VALUES (p_ref, v_anno, p_tipo, v_num, p_fonte, p_business, p_payload) RETURNING * INTO v_doc;
  INSERT INTO storico(documento_id, a_stato) VALUES (v_doc.id, 'riservato');
  RETURN v_doc;
END $f$;
```

Comportamento: la riga di `contatori` è bloccata `FOR UPDATE`, quindi le riserve per lo stesso `(anno, tipo)` si serializzano; la stessa `ref` restituisce sempre lo stesso documento (idempotenza). Chiamare con `SELECT * FROM riserva_numero(...)`.

### 3.2 `002_permessi.sql` (già eseguito, la password è nel secret)

```sql
CREATE ROLE fatturazione_app LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE ALL ON DATABASE fatturazione FROM PUBLIC;
GRANT CONNECT ON DATABASE fatturazione TO fatturazione_app;
-- nel DB fatturazione:
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO fatturazione, fatturazione_app;
-- come ruolo fatturazione:
GRANT SELECT, INSERT ON documenti TO fatturazione_app;
GRANT UPDATE (stato, clickup_task_id, note_annullo) ON documenti TO fatturazione_app;
GRANT SELECT, INSERT ON storico TO fatturazione_app;
GRANT SELECT, INSERT, UPDATE ON eventi_ricevuti TO fatturazione_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fatturazione_app;
ALTER FUNCTION riserva_numero(text,text,text,text,jsonb)
  SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION riserva_numero(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION riserva_numero(text,text,text,text,jsonb) TO fatturazione_app;
```

Conseguenze per il codice: l'app **non può** modificare `numero`, `ref`, `anno`, `tipo`, né toccare `contatori`; non può cancellare nulla; ogni cambio di stato deve scrivere anche una riga in `storico` **nella stessa transazione**. Test già eseguito: due chiamate con la stessa `ref` danno lo stesso numero, `UPDATE documenti SET numero` dà `permission denied`.

---

## 4. Contratto API (REST JSON, solo HTTPS)

### 4.1 Autenticazione

- Server-to-server con `Authorization: Bearer <token>`; un token per fonte (`n8n`, `dashboard`, `owner`), confronto a tempo costante, mai nei log.
- I webhook di Stripe e GoCardless **non** usano il Bearer: si verifica la firma sul **body grezzo** (non sul JSON riparsato).
- L'azione `annulla` richiede il token `owner`.
- Nuovo secret da creare (es. `fatturazione-api-secrets`): `N8N_TOKEN`, `DASHBOARD_TOKEN`, `OWNER_TOKEN`, `STRIPE_WEBHOOK_SECRET`, `GC_WEBHOOK_SECRET`, `CLICKUP_TOKEN`, `GC_API_TOKEN`, `STRIPE_API_KEY` (chiave **ristretta in sola lettura**).

### 4.2 Busta comune

```json
{
  "fonte": "clickup",
  "ref": "86abc123|fattura|unica",
  "tipo": "fattura",
  "business": "arch-design",
  "cliente": { "...": "..." },
  "righe": [ { "descrizione": "...", "importo": 0 } ],
  "dati_fonte": {
    "clickup": {
      "task_progetto_id": "86abc123",
      "list_id_documenti": "...",
      "campo_relationship_id": "...",
      "url_progetto": "..."
    }
  }
}
```

Regole per `ref` (chiave di idempotenza, **mai** l'ID della task documento perché cambia se la ricrei):

| Fonte | `ref` |
|---|---|
| ClickUp/n8n | `<task_progetto_id>\|<tipo>\|<rata>` — `rata` default `unica`; serve per acconto/saldo/2ª fattura sullo stesso progetto |
| Stripe | `stripe\|<invoice_id oppure payment_intent_id>\|<tipo>` |
| GoCardless | `gocardless\|<payment_id>\|<tipo>` |

Per Stripe e GoCardless il `ref` si basa sull'ID del pagamento/fattura, non sull'ID dell'evento, così un webhook ripetuto o un secondo evento sullo stesso pagamento non crea un secondo numero.

### 4.3 Endpoint

| Metodo e percorso | Auth | Funzione |
|---|---|---|
| `POST /v1/documenti` | Bearer (`n8n`/`dashboard`) | Valida la busta, chiama `riserva_numero`, restituisce `{ref, numero, anno, tipo, stato, data_riserva}`. Idempotente: stessa `ref` → stesso numero |
| `GET /v1/documenti/{ref}` | Bearer | Stato corrente |
| `GET /v1/documenti?stato=...&da=...` | Bearer | Elenco (solo campi leggeri) |
| `POST /v1/documenti/{ref}/stato` | Bearer | Cambio di stato consentito (sez. 5); scrive `storico` nella stessa transazione |
| `POST /v1/documenti/{ref}/annulla` | `owner` | Annulla con `motivo` obbligatorio. Rifiutato se già `inviato_sdi` o `consegnato` (si usa una nota di credito) |
| `POST /webhooks/stripe` | firma `Stripe-Signature` | Vedi 4.4 |
| `POST /webhooks/gocardless` | firma `Webhook-Signature` | Vedi 4.5 |
| `GET /healthz` | nessuna | Solo "vivo", nessun dato |
| `GET /readyz` | nessuna | Controllo DB e contatore (modalità bloccata → 503) |

Se serve distinguere "creato ora" da "già esistente", modificare la funzione con una migrazione; non confrontare timestamp lato app.

### 4.4 Stripe

- Eventi da gestire: `invoice.paid` (abbonamenti e pagamenti con invoice) e `payment_intent.succeeded` (pagamenti singoli). **Il primo pagamento di un abbonamento fa scattare entrambi**: processare solo uno. Regola: se il `payment_intent` ha un `invoice` collegato, ignorarlo e usare `invoice.paid` **[DA VERIFICARE il nome del campo con la versione API in uso]**.
- Gli eventi possono arrivare duplicati e fuori ordine: dedupe per `event.id` in `eventi_ricevuti`; non usare `created` per l'ordine.
- Live mode: Stripe ritenta fino a 3 giorni con backoff esponenziale; rispondere 2xx subito, elaborare in modo asincrono.
- Tolleranza temporale sulla firma: usare la libreria ufficiale (`constructEvent`).

### 4.5 GoCardless

- I webhook arrivano a **batch fino a 250 eventi** in un array `events`, con `resource_type` e `action` separati. Verificare `Webhook-Signature` (HMAC-SHA256 sul body grezzo); firma errata → risposta **498**; successo → **204**.
- **Nessun ritento automatico documentato**: serve un job di riconciliazione che interroga l'API per i pagamenti `confirmed` non ricevuti, oltre al ritento manuale.
- Prima di agire sull'evento, leggere lo stato corrente della risorsa dall'API (eventi duplicati e fuori ordine).
- **Quale azione genera il documento** (`payments/confirmed` oppure `payments/paid_out`) è una scelta fiscale **[DA DECIDERE col commercialista]**: renderla configurabile (`GC_TRIGGER_ACTION`).

### 4.6 Dedupe eventi

`INSERT INTO eventi_ricevuti(fonte, evento_id, raw) ... ON CONFLICT (fonte, evento_id) DO NOTHING`; se l'inserimento non ha inserito righe, rispondere 2xx senza rielaborare. Poi elaborare e marcare `elaborato = true`.

---

## 5. Macchina a stati

```
riservato → creato → inviato_sdi → consegnato
    ↓          ↓
 annullato  annullato   (mai da inviato_sdi / consegnato)
```

| Da | A | Chi / quando |
|---|---|---|
| riservato | creato | Worker ClickUp dopo aver creato la task (salva `clickup_task_id`) |
| riservato | annullato | `annulla` (owner) o timeout di abbandono |
| creato | inviato_sdi | Fase 2, dopo invio al provider SDI |
| creato | annullato | `annulla`, solo se non inviato |
| inviato_sdi | consegnato | Fase 2, ricevuta SDI |

- Le **proforme** si fermano a `creato` (non vanno allo SDI).
- Fase 2 richiede una migrazione per aggiungere lo stato `scartato` (scarto SDI → correzione e rinvio con lo stesso numero) **[DA VERIFICARE col commercialista tempi e regole di rinvio]**.
- Ogni transizione = una riga in `storico` nella stessa transazione. Una transizione non valida → 409.

Cosa succede quando qualcosa va storto:

| Caso | Comportamento |
|---|---|
| VPS giù al momento della richiesta | Il chiamante riprova (n8n lascia il campo custom a `true`; Stripe ritenta); nulla creato |
| Numero riservato ma creazione ClickUp fallita | Resta `riservato`; il retry riusa la stessa `ref` e quindi lo stesso numero |
| Task creata ma conferma persa | La riconciliazione allinea `riservato` con le task esistenti (match per numero) |
| Task eliminata in ClickUp | Mai nuovo numero: il worker la **rigenera dal `payload`** |
| Numero abbandonato e non c'è un numero successivo | Può tornare libero solo se mai inviato allo SDI **[DA VERIFICARE]** |
| Numero abbandonato con numeri successivi già emessi | `annullato` con motivo, mai riusato |

Prima della riserva il chiamante deve aver validato tutti i dati (cliente, importo, campi obbligatori, task progetto), così gli errori di dati non consumano numeri.

---

## 6. Worker ClickUp

- Crea la task documento nella lista corretta con il numero già definitivo e il campo **Relationship** verso la task progetto (da `dati_fonte.clickup`), così il legame progetto ↔ fattura resta per sempre.
- Cadenza: **documenti interni ogni 1–2 minuti**, **documenti esterni in batch ogni 30–60 minuti**. Il lotto è la fotografia dei documenti `riservato` con `data_riserva` precedente all'istante di avvio del giro: quelli che arrivano dopo restano nel turno successivo. Un solo worker alla volta, garantito da un advisory lock di Postgres (`pg_try_advisory_lock`); se il processo muore, il lock cade con la connessione e il giro dopo riprende i documenti ancora `riservato`. **Non esiste uno stato "in lavorazione"** nello schema: non aggiungerlo senza una migrazione esplicita.
- **Prima di creare cerca se esiste già una task con quel numero** (un timeout può aver funzionato) per evitare doppioni. Salva `clickup_task_id`.
- Rate limit ClickUp: 100 richieste/minuto per token sui piani Free/Unlimited/Business secondo alcune fonti, 1000/min secondo altre **[DA VERIFICARE sul tuo workspace]**. Il client deve avere throttling, retry con backoff e coda; la quota è condivisa con n8n e con la dashboard.
- Gli ID di liste e campi custom vanno in configurazione (variabili d'ambiente), non nel codice.

---

## 7. Riconciliazione giornaliera

Confronta DB ↔ ClickUp (e in fase 2 ↔ cassetto fiscale) e segnala: buchi nella sequenza, doppioni, task orfane (numero in `creato` ma task sparita), documenti `riservato` da troppo tempo, pagamenti GoCardless confermati e mai ricevuti, divergenze di contatore. Qualsiasi anomalia → notifica a Elia (canale **[DA DEFINIRE]**: email o Telegram). Mai correzioni automatiche dei numeri.

### Recupero dopo perdita del DB

1. Il servizio parte in **modalità bloccata**: `/readyz` risponde 503 e nessuna riserva è consentita.
2. Ripristino dell'ultimo dump.
3. Il contatore viene riallineato a `max(DB, ClickUp, cassetto fiscale)` per ogni `(anno, tipo)`.
4. Solo dopo il controllo si sblocca. Nel peggiore dei casi si perde l'ultima ora di riserve non ancora in ClickUp, e il confronto le individua.

Controllo all'avvio e dopo ogni ripristino: contatore ≥ massimo numero trovato in ClickUp.

---

## 8. Sicurezza

**Pod (Deployment, namespace `platform`)**
- Non-root (uid/gid non 0), `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities: drop: ["ALL"]`, requests/limits di CPU e memoria, nessun token di service account montato se non serve.
- Immagine minimale, versione fissata (mai `latest`), senza shell se possibile.

**Rete (NetworkPolicy, default deny)**
- Ingress: solo l'ingress controller per `/webhooks/*` e per l'API pubblica; n8n e dashboard dal namespace `platform`.
- Egress: DNS, `services-postgres:5432`, `api.clickup.com:443`, `api.stripe.com:443`, `api.gocardless.com:443` (e in fase 2 il provider SDI).

**MITM e trasporto**
- Solo HTTPS in ingresso (certificato valido, HSTS), nessun HTTP in chiaro.
- Verso Postgres: preferire TLS con verifica del certificato **[DA VERIFICARE se `services-postgres` ha SSL attivo]**; se non attivo, traffico confinato nel cluster con NetworkPolicy.
- Verso ClickUp/Stripe/GoCardless: solo HTTPS con verifica del certificato attiva.

**Dati e segreti**
- Segreti solo da Secret Kubernetes via variabili d'ambiente; in sviluppo solo in `.env`, mai committato né letto da agenti; mai in log, errori o risposte.
- Log senza PII (niente corpo del `payload`, nomi o email dei clienti); loggare ID, stato, esito.
- Limite di dimensione del body, rate limiting per fonte, input validato con schema, query solo parametrizzate.
- Webhook: verifica firma sul body grezzo **prima** di qualsiasi altra elaborazione; non rivelare nei messaggi di errore perché la firma è fallita.
- L'app usa **solo** `fatturazione_app`; le migrazioni girano come Job separato con il ruolo owner.
- Audit: ogni cambio di stato in `storico` (append-only).

---

## 9. Limiti di dati

- DB `fatturazione` ≤ 200 MB (oggi ~8 MB, che è la base di un Postgres vuoto). Dump ≤ 20 MB, cartella backup ≤ 200 MB, PVC 500 Mi.
- Payload minimo: salvare solo ciò che serve a rigenerare la task in ClickUp.
- `documenti`, `storico`, `contatori` non si cancellano mai (la numerazione deve restare integra).
- `eventi_ricevuti`: raw dopo 90 giorni svuotato, riga cancellata dopo 400 (già automatico).

---

## 10. Fasi

| Fase | Contenuto |
|---|---|
| **1 — Nucleo** | API (sez. 4), dedupe eventi, worker ClickUp, riconciliazione, health/ready, manifest k8s, test (sez. 11) |
| **2 — SDI** | Generazione XML FatturaPA e invio via provider API (Openapi o A-Cube; costi da confrontare), **DatiBollo** (bollo su fatture senza IVA sopra 77,47 €), stati `inviato_sdi`/`consegnato`/`scartato`, invio **in ordine di numero** (se la n è ancora `riservata` e la n+1 è pronta, attende fino a un timeout configurabile, es. 10 minuti, poi la n si completa o si annulla con motivazione), bozza → approvazione owner prima dell'invio |
| **3 — Dashboard** | Realm Keycloak dedicato (es. `business`), ruoli `owner` / `amministrazione` / `assistenza` con elenco business per utente, MFA obbligatorio, controlli lato server su ruolo e business, audit |
| **Dopo** | Servizio ticket centrale (API unica per i SaaS, messaggi in Postgres, riassunto su ClickUp), CRM su ClickUp con sync verso Brevo e ritorno delle disiscrizioni |

La copia del backup fuori dal VPS e la scelta della destinazione sono ancora da fare, in parallelo alla Fase 1.

---

## 11. Test di accettazione (Fase 1)

1. **Idempotenza:** 50 richieste parallele con la stessa `ref` → un solo numero.
2. **Concorrenza:** 50 richieste parallele con `ref` diverse → 50 numeri consecutivi, nessun buco, nessun doppione.
3. **Permessi:** con `fatturazione_app`, modificare `numero` o cancellare da `documenti`/`storico` fallisce.
4. **Webhook duplicati:** lo stesso evento Stripe/GoCardless ricevuto 3 volte → un solo documento.
5. **Firma errata:** Stripe → 400; GoCardless → 498; nessuna riga in `eventi_ricevuti`.
6. **ClickUp giù:** i documenti restano `riservato`, il worker riprende senza duplicare e senza consumare nuovi numeri.
7. **Pod ucciso a metà lotto:** nessun doppione, nessun buco; il lotto appeso rientra dopo il timeout.
8. **Task eliminata:** viene rigenerata con lo stesso numero.
9. **Ripristino:** restore di un dump in un DB di prova, servizio in modalità bloccata, riallineamento del contatore, sblocco.
10. **Limiti:** payload troppo grande rifiutato; rate limit attivo; nessun segreto o PII nei log.

---

## 12. Punti aperti

- [ ] Namespace e URL di Keycloak; nome del realm dedicato.
- [ ] Rate limit reale ClickUp del workspace (100 o 1000 richieste/minuto).
- [ ] ID di liste e campi custom ClickUp (documenti, Relationship, `business`, `rata`).
- [ ] GoCardless: `confirmed` oppure `paid_out` come evento che genera il documento (commercialista).
- [ ] Come documentare un numero di fattura annullato in mezzo alla sequenza (commercialista).
- [ ] Rinvio di una fattura scartata dallo SDI: tempi e regole (commercialista).
- [ ] Clienti dei SaaS: consumatori o aziende (codice destinatario, P.IVA), per l'XML.
- [ ] Destinazione della copia del backup fuori dal VPS.
- [ ] Canale delle notifiche di anomalia.
- [ ] Stack del servizio (consigliato TypeScript/Node con Fastify e `pg`, coerente con la dashboard Next.js) **[DA CONFERMARE]**.
- [ ] `services-postgres`: SSL attivo o no.
- [ ] n8n usa il superutente `services` e può leggere `fatturazione`: decidere se dargli un ruolo proprio.

---

## 13. Istruzioni per Claude Code (questo repo)

- Lavora per fasi e per passi piccoli; dopo ogni passo mostra l'output verificato prima di proseguire. Parti dalla **Fase 1**.
- Ogni comando da eseguire va accompagnato da cosa fa e dai rischi per l'utente; i comandi distruttivi vanno segnalati in MAIUSCOLO.
- I segreti stanno solo in `.env` (mai committato, mai letto); in produzione solo Secret Kubernetes. Il deploy in produzione usa la chiave `claude-deploy`: la passphrase richiesta a ogni rilascio è l'approvazione dell'utente, non aggirarla.
- Fai solo il compito assegnato: niente lavori fuori ambito (altre app, altri namespace, altri repo).
- Non toccare i repo HOTSPOT e finanze-famiglia, né i DB `n8n` e `joplindb`.
- Non decidere in autonomia i punti aperti della sez. 12: chiedi.
- Struttura suggerita del repo: `SPEC.md`, `CLAUDE.md` (regole sopra + stato corrente), `docs/` (stato e decisioni), `migrations/`, `src/`, `k8s/` (Deployment, Service, NetworkPolicy, Job di migrazione), `tests/`, `.env.example`.
