# 2026-11-08 14:00 · Stripe organizzazione chiuso, 0.1.3 in produzione

Fatto: 0.1.3 rilasciata da Elia; STRIPE_BUSINESS_PER_ACCOUNT applicato (3 account); chiave sk_org in sola lettura nel Secret; webhook duplicato eliminato; imposte automatiche spente su tutti e tre gli account; backup B2 verificato; decisioni #38-#40.
Perché: #37 richiedeva l'attività per account; #39 lega reti.gazzolaelia.it all'account che incassa i canoni; #40 fissa prezzi senza IVA e bollo incluso, perché il forfettario non addebita IVA.
Prossimo: push dei 3 commit (e93e290, 637150a, d48cdb9); al primo pagamento reale controllare webhook 200 e documento; poi flusso n8n "fattura dalla proforma".
