---
description: Descrive come si deploya questo progetto in docs/deploy.manifest.md, letto dagli agenti
---
Compila docs/deploy.manifest.md con ciò che questo repo sa del proprio deploy. Descrivi, non inventare. Non eseguire nulla sul VPS, non leggere file .env, non modificare codice o configurazioni.

1. Leggi docs/, README, script e workflow di deploy, infra/ o k8s/, Dockerfile, compose, .clinerules/ e ogni documento di deploy del repo.
2. Scrivi docs/deploy.manifest.md con queste sezioni. Ogni campo non documentato resta [DA VERIFICARE], mai supposto:
   - App e componenti: nome, cartella, a cosa servono.
   - Metodo: script, kustomize, compose, systemd, ci-immagine o altro, e come funziona davvero.
   - Prima del deploy, sul Mac: test e build già presenti nel repo.
   - Stage: esiste? come si deploya e come si verifica.
   - Prod: come si deploya e come si verifica (URL, porta, rollout).
   - Rollback: comando preciso per tornare indietro.
   - Effetti collaterali e rischi: cancellazioni prima della build, migrazioni DB, riavvii.
   - Trigger automatici: quale evento su quale branch fa partire un deploy.
   - File che cambiano la produzione: percorsi in cui una modifica è un rischio.
   - Voci proposte per l'allowlist del server: i comandi fissi che il server dovrebbe accettare per questa app (stage, prod, verifica, rollback) con gli argomenti ammessi. È una proposta che Elia rivede e installa una volta.
   - Fonti: i file letti.
3. Invoca il subagent verificatore, poi fai un commit locale del solo manifest con messaggio "docs: manifest di deploy". Nessun push.
4. Rispondi in max 5 righe: metodo trovato, voci [DA VERIFICARE], numero di voci proposte per l'allowlist.
