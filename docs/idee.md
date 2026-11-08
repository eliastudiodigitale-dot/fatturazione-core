# Idee

Formato: AAAA-MM-GG | idea | stato (nuova, valutata, in coda, scartata) | nota

2026-11-07 | Ambiente di prova (stage) con DB e lista ClickUp di prova, separati dalla produzione | nuova | proposto da Claude, non deciso; utile per provare il flusso fattura dalla proforma senza toccare numeri reali
2026-11-07 | Dashboard alimentata da un sync del servizio (lettura, non copia dei dati fiscali) | nuova | Fase 3; collegata alla decisione #7 (DB non è archivio)
2026-11-07 | Ruolo DB di sola lettura per la diagnostica (anche per agenti), senza colonne PII | nuova | già descritto come proposta in docs/accessi-da-creare.md, voce 5
2026-11-07 | Fase 2: provider SDI da scegliere con ricerca dedicata | in coda | decisione #25 (ricerca in sessione separata); candidati già citati in docs/wiki/stack.md
2026-11-07 | Bollo da 2 euro sulle fatture oltre soglia, gestito dal servizio | nuova | da verificare la regola con il commercialista [DA VERIFICARE]
2026-11-07 | Raccolta di codice fiscale / P.IVA del cliente su Stripe (campi personalizzati) per le fatture | nuova | riduce le richieste manuali; dipende dal flusso di Stripe e dalla Fase 2
2026-11-08 | SaaS hotspot portal (reti.gazzolaelia.it): quando avrà dominio e marchio propri, un account Stripe suo nell'organizzazione e una riga in STRIPE_BUSINESS_PER_ACCOUNT | nuova | proposta dell'agente, non deciso; oggi il SaaS incassa su acct_1QckZ6 (#39)
2026-11-08 | Catalogo Stripe di heyciar.it (9 prodotti, 17 prezzi) con uno script idempotente per lookup_key che legge il JSON del catalogo | fatta | script in 4436c65 (scripts/stripe/heyciar-catalogo.mjs), creato su Stripe il 2026-11-08 (26 creazioni). Non è servita una chiave temporanea: la scrittura è stata data alla chiave del servizio e riportata in lettura. Il catalogo sorgente nel repo heyciar resta "exclusive": da correggere (vedi riga successiva)
2026-11-08 | Progettare il CRM (#42): lista Clienti in ClickUp, regola di match (P.IVA o email), chi crea la scheda (servizio o n8n), campi; poi ticket e SLA (SPEC sez. 10 "Dopo") | nuova | decisione #42 già presa (anagrafica unica anche per serrandasu.it e heyciar.it); da fare in sessione dedicata
2026-11-08 | Nel backend heyciar (altro repo): togliere STRIPE_PRICE_SEAT e STRIPE_PRICE_DOCUMENTS e usare lookup_key; correggere il catalogo sorgente a inclusive e "IVA non applicata, regime forfettario"; tetti SLA 3g/48h nel backend | nuova | repo SH-saas/progetto001-accessi; non toccato da questa sessione
