# 2026-11-24 17:29 · Portale, CRM, ticket e SLA

- Fatto: portale `/dashboard` nel servizio (login Keycloak, sezioni Cruscotto, Ticket, CRM, Fatturazione, Impostazioni > SLA); ticket nei backend dei business via API (#47); SLA nel DB per attività e piano (#46, #48); CRM su ClickUp con copia in cache (#42, #45).
- Commit: 8 locali, non pushati (da de38db7 a 4e5e12b). Test 197 su 197, build e typecheck OK.
- Perché: i ticket sono dati operativi di ogni business, non dell'anagrafica; gli SLA cambiano nel tempo e variano per attività.
- Non verificato: browser reale, ClickUp, Keycloak e backend ticket veri (vedi `docs/STATO.md`, Bloccanti).
- Prossimo: push (lo esegue Elia); `npm run locale` e controllo grafica; conferma SLA; API ticket nei backend; lista Clienti in ClickUp; rilascio 0.2.0.
- Migrazione 005 non applicata: serve conferma di Elia sullo schema prima del Job.
