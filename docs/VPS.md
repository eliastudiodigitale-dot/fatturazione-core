# VPS: questo progetto

Stato letto dal server il: MAI (si riempie con lo script di sync)
Fonte di quanto sotto: SPEC.md sez. 2 (verificata il 2026-11-07 dall'autore della SPEC, commit fb69474). Nessun comando eseguito sul VPS.

## Cosa gira online
- App e container: il servizio `fatturazione-core` NON è ancora scritto né deployato. Esistono solo infrastruttura DB, backup e pulizia. [DA VERIFICARE]
- Cluster: k3s, namespace `platform`
- Postgres: `services-postgres` (Postgres 16.11), Service headless, porta 5432; DB `fatturazione`; ruoli `fatturazione` (owner, solo migrazioni/backup/pulizia) e `fatturazione_app` (servizio)
- Secret esistente: `fatturazione-secrets` (ns `platform`), chiavi: PG_USER, PG_PASS, PG_DB, APP_PG_USER, APP_PG_PASS
- CronJob: `fatturazione-backup` (03:40 Europe/Rome, pg_dump -Fc, retention 30 gg, PVC `fatturazione-backup` 500 Mi `local-path`), `fatturazione-pulizia` (03:20)
- Altri servizi nel namespace: n8n (`N8N_HOST=n8n.spaziocliente.it`), Keycloak (namespace e URL [DA VERIFICARE])
- Cartella sul server: [DA VERIFICARE]
- Dominio o URL del servizio: [DA VERIFICARE]
- Commit o tag deployato: nessuno (servizio non deployato) [DA VERIFICARE]

## Deploy e rollback
- Deploy: manuale, lo esegue solo Elia con la chiave `claude-deploy` (passphrase = approvazione). Manifest k8s previsti in `k8s/` (non ancora presenti). docs/deploy.manifest.md non esiste ancora.
- Rollback: [DA VERIFICARE]

Note: il backup è sullo stesso disco del VPS; copia fuori dal VPS ancora da fare. `local-path` non applica la quota del PVC. n8n usa il superutente `services` e può leggere `fatturazione` (buco noto).

Regola: mai segreti qui, solo i nomi delle variabili.
