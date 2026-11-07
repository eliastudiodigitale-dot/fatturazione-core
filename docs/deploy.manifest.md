# Deploy manifest: fatturazione-core

Descrive ciò che il repo documenta al 2026-11-07. Il servizio **non è mai stato deployato**. Il rilascio è manuale e lo esegue solo Elia (CLAUDE.md, SPEC sez. 13). Voci non documentate: [DA VERIFICARE].

## App e componenti
| Componente | Cartella / file | A cosa serve |
|---|---|---|
| Servizio API + worker | `src/`, `Dockerfile` | Numerazione fatture/proforme, webhook Stripe/GoCardless, worker ClickUp, riconciliazione (un solo processo Node 24) |
| Deployment + Service + ConfigMap | `k8s/app.yaml` | Pod `fatturazione-core` nel namespace `platform`, porta 8080 |
| Secret API (modello, solo nomi) | `k8s/secret-api.example.yaml` | Nomi delle chiavi di `fatturazione-api-secrets`; il Secret vero lo crea Elia |
| NetworkPolicy | `k8s/networkpolicy.yaml` | Default deny; etichette dei pod [DA VERIFICARE] |
| Ingress | `k8s/ingress.yaml` | `gestione.gazzolaelia.it`, solo `/webhooks/stripe` e `/webhooks/gocardless`; certificato TLS [DA VERIFICARE] |
| Job di migrazione | `k8s/migrazione-job.yaml` | Applica UN file di `migrations/` col ruolo owner `fatturazione` (decisione #10) |
| Migrazioni | `migrations/` | 001 e 002 già applicate sul VPS; 003 e 004 approvate (#13, #14) e non ancora applicate |
| Backup e pulizia | `k8s/backup-cronjob.yaml`, `k8s/pulizia-cronjob.yaml` | Dichiarati applicati sul VPS da SPEC sez. 2, non letti dal server (VPS.md: sync MAI) [DA VERIFICARE]. Copia ricostruita, [NON VERIFICATO] byte per byte |
| Riallineamento contatore | `scripts/riallinea-contatore.sql` | Solo dopo un ripristino del DB (SPEC 7), manuale, ruolo owner |
| Ricognizione | `scripts/vps/ricognizione.sh` | Sola lettura, raccoglie i dati del VPS |
| Creazione Secret | `scripts/vps/crea-secret.sh api\|offsite` | Interattivo sul VPS: genera i 3 token, chiede le chiavi senza mostrarle |
| Backup fuori VPS | `k8s/backup-offsite-cronjob.yaml` | 04:10, copia cifrata (rclone crypt) su Backblaze B2 (decisione #22); NON applicato |
| Riallineamento contatore (Job) | `scripts/rilascio/riallinea.sh <anno> <tipo> <ultimo>` | Prima della prima emissione: porta il contatore oltre i numeri già usati a mano (ClickUp, cassetto fiscale) |
| Workflow n8n | `n8n/fatture-da-clickup.json` (generato da `n8n/genera-workflow.mjs`, logica in `n8n/prepara-busta.js`) | Ogni 2 minuti legge i progetti ClickUp con "Emetti documento", chiama `POST /v1/documenti`, commenta la task. Si importa a mano in n8n, credenziali "ClickUp (token)" e "fatturazione-core" |
| Ricognizione 3 | `scripts/vps/ricognizione-3.sh` | Sola lettura: campi di progetti e contatti, workflow n8n esistenti su fatture |
| Ricognizione 2 | `scripts/vps/ricognizione-2.sh` | Sola lettura: numeri già usati in ClickUp, opzioni AREA/metodo, Traefik/TLS, DNS |
| Script di rilascio | `scripts/rilascio/migra.sh`, `rilascia.sh`, `verifica.sh` | Dal Mac via SSH: migrazione, build+import+apply, stato. Mai provati sul VPS [DA VERIFICARE] |

## Metodo
- **Immagine:** è un'immagine Docker compilata sul Mac (`Dockerfile`: build in `node:24.22.2-alpine`, runtime `gcr.io/distroless/nodejs24-debian12:nonroot`, utente 65532).
- **Niente registry** (decisione #23): l'immagine si importa in k3s con `k3s ctr images import` e si usa con un tag fisso.
- `k8s/app.yaml` usa `image: fatturazione-core:<tag>` con `imagePullPolicy: Never` (allineato a #23); `scripts/rilascio/rilascia.sh <tag>` sostituisce il tag.
- **Manifest:** si applicano a mano con `kubectl apply`. Nel repo non ci sono kustomize, compose né CI.
- **Architettura del VPS:** x86_64 (ricognizione 2026-11-07), build con `--platform linux/amd64`.
- **Comando di import sul VPS:** `sudo k3s ctr -n k8s.io images import -` in una sessione SSH interattiva (sudo chiede la password). Mai provato [DA VERIFICARE].

## Prima del deploy, sul Mac
Sul commit di `origin/main`, con Node 24. **Oggi `origin/main` non basta** (verificato con git): contiene solo `k8s/backup-cronjob.yaml`, `k8s/pulizia-cronjob.yaml` e `migrations/001-002`. Mancano `src/`, `package.json`, `Dockerfile`, `k8s/app.yaml` e gli altri manifest, `migrations/003-004`. Prima vanno committate le modifiche locali e pushate le 3 commit locali (il push lo esegue solo Elia) [DA VERIFICARE]:
- `npm ci`
- `npm run typecheck && npm run typecheck:test`
- `npm test`: test di accettazione su Postgres di prova in Docker locale (container `fatturazione-test-pg`, porta 55432). Richiede Docker attivo.
- `npm run build`
- `docker build -t fatturazione-core:<tag> .`

## Stage
Non esiste nel repo. Gli unici ambienti di prova sono il Postgres locale dei test e `docker run` sul Mac.

## Prod
- **Deploy** (dai file del repo, non ancora eseguito):
  1. Elia crea il Secret `fatturazione-api-secrets` con `scripts/vps/crea-secret.sh api`.
  2. Migrazioni 003 e 004 col Job, una alla volta: `scripts/rilascio/migra.sh <file>`.
  3. Riallineamento del contatore ai numeri già usati: `scripts/rilascio/riallinea.sh <anno> fattura|proforma <ultimo>`. Senza, il servizio resta bloccato (vede i numeri storici in ClickUp).
  4. Import dell'immagine in k3s e apply dei manifest: `scripts/rilascio/rilascia.sh <tag>` (fa anche test e build in locale). L'import chiede la password di sudo (sul VPS sudo non è senza password).
  5. Backup fuori VPS: `scripts/vps/crea-secret.sh offsite`, poi `kubectl apply -f k8s/backup-offsite-cronjob.yaml`.
- **Verifica:**
  - `kubectl -n platform rollout status deployment/fatturazione-core`;
  - readiness `/readyz` (200 = pronto, 503 = DB non raggiungibile o modalità bloccata);
  - liveness `/healthz`;
  - porta 8080, Service ClusterIP `fatturazione-core`.
- **URL pubblico:** `https://gestione.gazzolaelia.it/webhooks/{stripe,gocardless}` (decisione #19), non ancora configurato.
- **Rollout:** strategia `Recreate`, 1 replica, quindi breve indisponibilità a ogni rilascio. I chiamanti riprovano: n8n e Stripe ritentano, mentre per GoCardless non c'è un ritento automatico documentato (SPEC 4.5): lo copre la riconciliazione.

## Rollback
- **Applicazione:** `kubectl -n platform rollout undo deployment/fatturazione-core`, oppure `set image` sul tag precedente, che deve essere ancora importato in k3s.
- **Migrazioni:** nessuna procedura di rollback documentata [DA VERIFICARE]. 003 è un GRANT (inverso: REVOKE SELECT). 004 sostituisce la funzione `riserva_numero`: per tornare indietro serve il corpo di 001 (blocco `CREATE FUNCTION riserva_numero` in `migrations/001_schema.sql`) riapplicato a mano come `CREATE OR REPLACE`, con `SECURITY DEFINER` di 002. Il file 001 intero non si può rieseguire (CREATE TABLE già esistenti) [DA VERIFICARE].

## Effetti collaterali e rischi
- **Migrazioni:** girano come owner sul DB di produzione e ogni file è in una transazione (`psql -1`). 001 e 002 sono rifiutate dal Job. 004 cambia la funzione che assegna i numeri fiscali.
- **Riavvio:** il servizio parte sempre in modalità bloccata e si sblocca solo se il controllo contatori passa. Se ClickUp è configurato e non è raggiungibile all'avvio resta bloccato: niente riserve, i webhook vengono accettati e messi in coda.
- **`FORZA_BLOCCO=true`** nella ConfigMap tiene il servizio bloccato. Si usa dopo un ripristino del DB.
- **Valori obbligatori nella ConfigMap:**
  - `PG_SSL` vale `DA_DEFINIRE`: finché non diventa `disable`, `require` o `verify-full` il pod non parte.
  - Gli ID ClickUp sono vuoti: il worker resta spento.
  - `GC_TRIGGER_ACTION` è vuoto: GoCardless resta spento.
  - `PG_CA_FILE` non è in `k8s/app.yaml`: serve solo con `PG_SSL=verify-full` e il file CA va montato [DA VERIFICARE].
- **Cancellazioni:** nessuna cancellazione prima della build. Le tabelle `documenti` e `storico` non si cancellano: un trigger lo impedisce (001). `contatori` non ha trigger: lo impediscono solo i permessi (l'app non ha DELETE) [DA VERIFICARE].

## Trigger automatici
Nessuno: niente CI né hook di deploy nel repo. I CronJob già presenti (backup 03:40, pulizia 03:20) girano da soli sul VPS.

## File che cambiano la produzione
- `migrations/*.sql`, soprattutto qualunque modifica a `riserva_numero`.
- `k8s/*.yaml`.
- `Dockerfile`, `package.json`, `package-lock.json`.
- `src/**`, in particolare `src/documenti.ts`, `src/stati.ts`, `src/stripe.ts`, `src/gocardless.ts` e `src/worker.ts`.
- `scripts/riallinea-contatore.sql`.

## Voci proposte per l'allowlist del server
Proposta da rivedere e installare una volta sola. Ogni voce è un comando fisso con argomenti validati, e nessuna stampa segreti.

| Voce | Cosa esegue | Argomenti ammessi |
|---|---|---|
| `fatturazione-core importa <tag>` | `k3s ctr images import -` (immagine da stdin) | `tag` = `^0\.[0-9]+\.[0-9]+$` |
| `fatturazione-core migra <file>` | Aggiorna la ConfigMap `fatturazione-migrazioni` dai file del repo e lancia il Job con `MIGRAZIONE=<file>` | `file` = `^0(0[3-9]\|[1-9][0-9])_[a-z0-9_]+\.sql$` (mai 001/002) |
| `fatturazione-core rilascia <tag>` | `kubectl -n platform set image deployment/fatturazione-core app=fatturazione-core:<tag>`, poi `rollout status --timeout=180s` | `tag` come sopra |
| `fatturazione-core verifica` | `rollout status`, `get pods -l app=fatturazione-core` e lettura di `/readyz` tramite il proxy del Service | nessuno |
| `fatturazione-core rollback` | `kubectl -n platform rollout undo deployment/fatturazione-core` e `rollout status` | nessuno |
| `fatturazione-core log` | `kubectl -n platform logs deployment/fatturazione-core` | `--since=` `^[0-9]{1,3}[mh]$` |
| `fatturazione-core ricognizione` | `scripts/vps/ricognizione.sh` (sola lettura) | nessuno |

## Fonti
SPEC.md; CLAUDE.md; docs/STATO.md; docs/decisions.md; docs/VPS.md; docs/accessi-da-creare.md; docs/wiki/deploy.md, comandi.md, architettura.md, stack.md; Dockerfile; .dockerignore; package.json; k8s/app.yaml, secret-api.example.yaml, networkpolicy.yaml, ingress.yaml, migrazione-job.yaml, backup-cronjob.yaml, pulizia-cronjob.yaml; migrations/001-004; scripts/riallinea-contatore.sql; scripts/vps/ricognizione.sh. Nessun README, CI, compose né `.clinerules/` nel repo.
