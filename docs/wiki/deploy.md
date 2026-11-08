# Deploy

- Rilascio manuale, lo esegue solo Elia (CLAUDE.md). Claude verifica test e build in locale sul commit di origin/main e descrive i passi di docs/deploy.manifest.md, senza lanciarli.
- Immagine `fatturazione-core:<versione>`: compilata sul Mac e importata in k3s con `k3s ctr images import`; nessun registry, tag fisso, `imagePullPolicy: Never` (#23).
- Rilascio: `scripts/rilascio/rilascia.sh <versione>`. Verifica dopo: `scripts/rilascio/verifica.sh`.
- Manifest in `k8s/`: `app.yaml` (Deployment, Service, ConfigMap con ID ClickUp), `networkpolicy.yaml`, `ingress.yaml` (solo `/webhooks/stripe` e `/webhooks/gocardless`, certresolver `le`), `migrazione-job.yaml` (ruolo owner), `backup-offsite-cronjob.yaml` (B2, #22), `pulizia-cronjob.yaml`, `backup-cronjob.yaml`, `secret-api.example.yaml` (solo nomi).
- Secret: creato con `scripts/vps/crea-secret.sh`; mai valori nel repo.
- Versione in produzione: 0.1.4 (2026-11-08, pagamenti Stripe senza invoice: cliente dal Customer, commit 65e884d). Prima 0.1.3 (supporto organizzazione Stripe). `package.json`, `package-lock.json` e `k8s/app.yaml` riportano 0.1.4.
- Dopo un rollback per errore, la versione va riportata a mano con `kubectl -n platform set image deployment/fatturazione-core` sul tag voluto e poi verificata con `verifica.sh` (accaduto il 2026-11-08 con 0.1.4).
- Stato del VPS: [../VPS.md](../VPS.md). Accessi proposti: [../accessi-da-creare.md](../accessi-da-creare.md).
- Rollback: [DA VERIFICARE]
