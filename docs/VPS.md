# VPS: questo progetto

Stato letto dal server il: 2026-11-07 (scripts/vps/ricognizione.sh, sola lettura, lanciata da Elia)
NOTA: la sezione "Cosa gira online" non è aggiornata al 2026-11-08 (0.1.3 e Stripe, dichiarati da Elia, non riletti dal server): vale come stato del 2026-11-07. Il Secret API `fatturazione-api-secrets` non è elencato qui.
NOTA 2: 0.1.4 in produzione dal 2026-11-08 (dichiarato da Elia, immagine `fatturazione-core:0.1.4`, readyz pronto dopo rollback e `kubectl set image`): non riletto dal server. Dove sotto compare 0.1.2 è lo stato del 2026-11-07.

## Ricognizione del 2026-11-07
- Host `ubuntu`, x86_64, k3s v1.34.3. Utente `elia`: kubectl senza sudo sì; sudo chiede la password (import immagini con `ssh -t`).
- `services-postgres`: label `app=services-postgres`, **ssl=off** → `PG_SSL=disable` (decisione #17).
- Ingress: Traefik (kube-system, label `app.kubernetes.io/name=traefik`), coppie di ingress `*-http` / websecure, nessun cert-manager. Come vengono emessi i certificati: [DA VERIFICARE] con ricognizione-2.
- n8n: label `app=n8n`. Keycloak: pod `keycloak` nel namespace `platform`; ingress `auth.gazzolaelia.it` (probabile URL di Keycloak) [DA VERIFICARE].
- Sottodomini già usati su gazzolaelia.it, tra gli altri: api, auth, cms, admin, design, logs, status, finanze, portal, reti, stats, visual. `gestione` è libero; record DNS [DA VERIFICARE].
- NetworkPolicy: nessuna nel namespace `platform` (solo hotspot-*).
- ClickUp: workspace 90151964706; lista documenti `901518874514` "proforme e fatture" (spazio P.Iva › Documenti), unica per fatture e proforme, numerata a mano. Token in `archportal002/archportal002-secrets` (CLICKUP_API_TOKEN) e `platform/wisp-api-clickup-secrets`. Limite 100 richieste/min.
- Altri servizi utili in `platform`: gotenberg (PDF), directus, seaweedfs.
Fonte di quanto sotto: SPEC.md sez. 2 (verificata il 2026-11-07 dall'autore della SPEC, commit fb69474). Nessun comando eseguito sul VPS.

## Cosa gira online
- App e container: `fatturazione-core` in produzione nel namespace `platform`, versione 0.1.2 al 2026-11-07 (immagine importata in k3s); 0.1.3 rilasciata da Elia il 2026-11-08 (dichiarato) [DA VERIFICARE], pod 1/1 Running, readyz pronto (verifica di Elia del 2026-11-07). Migrazioni 003 e 004 applicate, contatori 2026 riallineati (fattura 8, proforma 15). CronJob backup-offsite applicato.
- Cluster: k3s, namespace `platform`
- Postgres: `services-postgres` (Postgres 16.11), Service headless, porta 5432; DB `fatturazione`; ruoli `fatturazione` (owner, solo migrazioni/backup/pulizia) e `fatturazione_app` (servizio)
- Secret esistente: `fatturazione-secrets` (ns `platform`), chiavi: PG_USER, PG_PASS, PG_DB, APP_PG_USER, APP_PG_PASS
- CronJob: `fatturazione-backup` (03:40 Europe/Rome, pg_dump -Fc, retention 30 gg, PVC `fatturazione-backup` 500 Mi `local-path`), `fatturazione-pulizia` (03:20)
- Altri servizi nel namespace: n8n (`N8N_HOST=n8n.spaziocliente.it`), Keycloak (namespace e URL [DA VERIFICARE])
- Accesso: IP 185.229.239.205, alias SSH `vps-se` (sul Mac di Elia), utente `elia`, chiave con passphrase. Utenti dedicati agli agenti: da costruire (docs/accessi-da-creare.md)
- Ricognizione in sola lettura: `ssh vps-se 'bash -s' < scripts/vps/ricognizione.sh 2>&1 | tee ~/ricognizione.txt`
- Cartella sul server: [DA VERIFICARE]
- Dominio o URL del servizio: `gestione.gazzolaelia.it` (decisione #19), solo `/webhooks/stripe` e `/webhooks/gocardless` pubblici; certificato Traefik resolver `le`, HTTPS verificato (HTTP 404 a una GET) il 2026-11-07
- Commit o tag deployato: immagine `fatturazione-core:0.1.2` al 2026-11-07, compilata dal Mac da commit locali non ancora su origin/main. 0.1.3 rilasciata da Elia il 2026-11-08 (dichiarato) [DA VERIFICARE].

## Deploy e rollback
- Deploy: manuale, lo esegue solo Elia con la chiave `claude-deploy` (passphrase = approvazione). Manifest in `k8s/`, passi in docs/deploy.manifest.md, script in `scripts/rilascio/`. Nessun registry: immagine importata in k3s (decisione #23).
- Rollback: [DA VERIFICARE]

Note: il backup è sullo stesso disco del VPS; copia fuori dal VPS ancora da fare. `local-path` non applica la quota del PVC. n8n usa il superutente `services` e può leggere `fatturazione` (buco noto).

Regola: mai segreti qui, solo i nomi delle variabili.
