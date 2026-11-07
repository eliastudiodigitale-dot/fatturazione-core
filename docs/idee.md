# Idee

Formato: AAAA-MM-GG | idea | stato (nuova, valutata, in coda, scartata) | nota

2026-11-07 | Ambiente di prova (stage) con DB e lista ClickUp di prova, separati dalla produzione | nuova | proposto da Claude, non deciso; utile per provare il flusso fattura dalla proforma senza toccare numeri reali
2026-11-07 | Dashboard alimentata da un sync del servizio (lettura, non copia dei dati fiscali) | nuova | Fase 3; collegata alla decisione #7 (DB non è archivio)
2026-11-07 | Ruolo DB di sola lettura per la diagnostica (anche per agenti), senza colonne PII | nuova | già descritto come proposta in docs/accessi-da-creare.md, voce 5
2026-11-07 | Fase 2: provider SDI da scegliere con ricerca dedicata | in coda | decisione #25 (ricerca in sessione separata); candidati già citati in docs/wiki/stack.md
2026-11-07 | Bollo da 2 euro sulle fatture oltre soglia, gestito dal servizio | nuova | da verificare la regola con il commercialista [DA VERIFICARE]
2026-11-07 | Raccolta di codice fiscale / P.IVA del cliente su Stripe (campi personalizzati) per le fatture | nuova | riduce le richieste manuali; dipende dal flusso di Stripe e dalla Fase 2
