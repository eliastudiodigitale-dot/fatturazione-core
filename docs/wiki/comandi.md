# Comandi

Dal repo (Node 24, `engines` in package.json):

- `npm run build` — compila in `dist/` (tsc)
- `npm run typecheck` — controllo tipi senza emissione
- `npm run typecheck:test` — controllo tipi dei test
- `npm test` — vitest (77 test; richiedono Postgres 16 di prova in Docker locale, vedi `tests/setup/globalSetup.ts`)
- `npm run dev` — avvio con tsx in watch su `src/index.ts`
- `npm start` — avvio da `dist/index.js`

Script operativi (lanciati dal Mac da Elia; la lista completa è nei file):

- Rilascio: `scripts/rilascio/rilascia.sh <versione>`, `migra.sh`, `riallinea.sh`, `correggi-config.sh`
- Verifica in sola lettura: `scripts/rilascio/verifica.sh` (pod, readiness, riepilogo, anomalie), `scripts/rilascio/documenti.sh` (numeri e stati, nessun dato cliente)
- Annullo proforma di test: `scripts/rilascio/annulla.sh` (token owner, solo proforme)
- VPS in sola lettura: `scripts/vps/ricognizione*.sh`; `scripts/vps/crea-secret.sh` crea/aggiorna i Secret, lanciato da Elia in modo interattivo (i valori non compaiono a schermo)
- Sostituzione di una sola chiave nel Secret e riavvio: `scripts/vps/aggiorna-chiave.sh <NOME_VARIABILE>` (lanciato da Elia; il valore si digita)
- Copia offsite: `scripts/rilascio/log-backup.sh` (sola lettura: Job, log ed eventi della copia su B2)
- Stripe: `scripts/stripe/tasse-automatiche.sh` (elenca le imposte automatiche; spegne solo se richiesto). Legge la chiave dal Secret sul VPS e gli account da `k8s/app.yaml`; `CHIAVE_A_MANO=1` per digitarla. Continua se un permesso è negato e lo segnala come "non verificato".

Flusso di lavoro in `.claude/commands/`: /allinea, /chiudi, /decidi, /deploy-manifest, /ricerca.
