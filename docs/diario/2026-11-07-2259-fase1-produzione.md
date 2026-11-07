# 2026-11-07 22:59 · Fase 1 in produzione e Stripe organizzazione

Fatto: Fase 1 in produzione (0.1.2) con migrazioni 003/004 applicate da Elia; 0.1.3 pronta ma non rilasciata (supporto organizzazione Stripe).
Perché: i rilasci 0.1.0 e 0.1.1 sono falliti (config mancante, controllo anni passati): ogni rilascio passa da scripts/rilascio/verifica.sh. Stripe è un'organizzazione con un account per attività (#37); le imposte automatiche Stripe vanno spente perché scorporano l'IVA e il servizio le blocca.
Prossimo: Elia indica l'attività di acct_1QckZ6D55CvX97Iq, poi STRIPE_BUSINESS_PER_ACCOUNT in k8s/app.yaml, spegnimento imposte, rilascio 0.1.3 (solo Elia).
