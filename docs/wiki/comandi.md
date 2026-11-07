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
- Stripe: `scripts/stripe/tasse-automatiche.sh` (elenca le imposte automatiche; spegne solo se richiesto)

Flusso di lavoro in `.claude/commands/`: /allinea, /chiudi, /decidi, /deploy-manifest, /ricerca.
