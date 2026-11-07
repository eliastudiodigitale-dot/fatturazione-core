# Deploy

- Rilascio manuale, lo esegue solo Elia (CLAUDE.md). Claude verifica test e build in locale sul commit di origin/main e descrive i passi di docs/deploy.manifest.md, senza lanciarli.
- docs/deploy.manifest.md: non esiste ancora (si crea con /deploy-manifest). README e .cursor/skills/deploy.md: assenti.
- Chiave di deploy: `claude-deploy`, la passphrase a ogni rilascio è l'approvazione dell'utente (SPEC sez. 13).
- Previsti in `k8s/`: Deployment, Service, NetworkPolicy, Job di migrazione (non ancora presenti). Requisiti di sicurezza del pod: SPEC sez. 8.
- Stato del VPS: [../VPS.md](../VPS.md)
- Rollback: [DA VERIFICARE]
