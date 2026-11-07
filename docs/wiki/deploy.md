# Deploy

- Rilascio manuale, lo esegue solo Elia (CLAUDE.md). Claude verifica test e build in locale sul commit di origin/main e descrive i passi di docs/deploy.manifest.md, senza lanciarli.
- Immagine `fatturazione-core:<versione>`: compilata sul Mac e importata in k3s con `k3s ctr images import`; nessun registry, tag fisso, `imagePullPolicy: Never` (#23).
- Rilascio: `scripts/rilascio/rilascia.sh <versione>`. Verifica dopo: `scripts/rilascio/verifica.sh`.
- Manifest in `k8s/`: `app.yaml` (Deployment, Service, ConfigMap con ID ClickUp), `networkpolicy.yaml`, `ingress.yaml` (solo `/webhooks/stripe` e `/webhooks/gocardless`, certresolver `le`), `migrazione-job.yaml` (ruolo owner), `backup-offsite-cronjob.yaml` (B2, #22), `pulizia-cronjob.yaml`, `backup-cronjob.yaml`, `secret-api.example.yaml` (solo nomi).
- Secret: creato con `scripts/vps/crea-secret.sh`; mai valori nel repo.
- Versione in produzione: 0.1.2. In repo pronta 0.1.3 (non rilasciata). `package.json` riporta 0.1.0 [DA VERIFICARE: allineare la versione].
- Stato del VPS: [../VPS.md](../VPS.md). Accessi proposti: [../accessi-da-creare.md](../accessi-da-creare.md).
- Rollback: [DA VERIFICARE]
