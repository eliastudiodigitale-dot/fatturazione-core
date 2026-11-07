# STATO

Aggiornato: 2026-11-07. File sovrascritto a ogni chiusura (max 80 righe).

## Fatto
- SPEC iniziale del servizio (fb69474)
- Standard hub di memoria installato (95d07df)
- Infrastruttura sul VPS già creata secondo la SPEC: DB `fatturazione`, ruoli, schema, backup notturno, pulizia (non verificabile dal repo, vedi docs/VPS.md)
- Memoria di progetto allineata (/allinea), commit locale "docs: allinea memoria di progetto", non pushato

## In corso
- Nulla. Il repo contiene solo documentazione, nessun codice.

## Prossimo passo
- Fase 1 della SPEC (sez. 10): conferma stack, poi struttura repo (`migrations/`, `src/`, `k8s/`, `tests/`, `.env.example`), API e worker ClickUp.

## Bloccanti e domande aperte
- Punti aperti SPEC sez. 12: stack [DA CONFERMARE], trigger GoCardless, annullo fatture, canale notifiche, copia backup fuori VPS, ruolo proprio per n8n, ID liste/campi ClickUp, URL Keycloak, SSL di services-postgres.

## Link
- Decisioni: docs/decisions.md
- VPS: docs/VPS.md
- Wiki: docs/wiki/indice.md
- Specifica: SPEC.md
