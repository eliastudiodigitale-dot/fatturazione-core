# Decisioni attive

Solo decisioni in vigore. Se una cambia, si sovrascrive qui e la vecchia va in decisions-archivio.md con una riga.
Formato: #N | data | decisione | motivo | chi (utente o agente)

Fonte di tutte le voci: SPEC.md sez. 1 "Decisioni già prese", commit fb69474. Date = data della SPEC.

#1 | 2026-11-07 | Il numero lo assegna il VPS alla ricezione, con contatore atomico per (anno, tipo). ClickUp non assegna né legge numeri | sequenza ufficiale unica e atomica | utente (SPEC, fb69474)
#2 | 2026-11-07 | ClickUp è copia/vista; la sequenza ufficiale è nel DB `fatturazione` | evitare dipendenza da ClickUp per la numerazione | utente (SPEC, fb69474)
#3 | 2026-11-07 | Un solo ingresso per tutte le fonti (n8n, Stripe, GoCardless, dashboard), stessa busta JSON, cambia `dati_fonte` | semplicità e idempotenza uniforme | utente (SPEC, fb69474)
#4 | 2026-11-07 | Fail closed: nel dubbio non si emette e si avvisa; mai numeri "di fortuna" | integrità della numerazione fiscale | utente (SPEC, fb69474)
#5 | 2026-11-07 | La data documento è `data_riserva` (fissata dal VPS, Europe/Rome) | numero e data nello stesso ordine | utente (SPEC, fb69474)
#6 | 2026-11-07 | Eliminare una task in ClickUp non libera né annulla un numero; si annulla solo con l'azione `annulla` | numeri mai riusati per errore | utente (SPEC, fb69474)
#7 | 2026-11-07 | Il DB non è archivio legale: restano numeri, stati e metadati leggeri (conserva l'Agenzia delle Entrate) | DB piccolo | utente (SPEC, fb69474)
#8 | 2026-11-07 | Dati veri in ClickUp, DB piccolo: tetto 200 MB (500 MB assoluto), retention già impostata | contenere costi/spazio | utente (SPEC, fb69474)
#9 | 2026-11-07 | Proforme non fiscali: un `annullato` non pesa. Per le fatture un numero annullato va giustificato [DA VERIFICARE col commercialista come documentarlo] | adempimento fiscale | utente (SPEC, fb69474)
#10 | 2026-11-07 | Il servizio usa solo il ruolo `fatturazione_app`; le migrazioni girano come Job separato con il ruolo owner `fatturazione` | minimo privilegio | utente (SPEC sez. 3.2 e 8, fb69474)
#11 | 2026-11-07 | Stack del servizio: TypeScript/Node con Fastify e `pg` (chiude il punto aperto SPEC sez. 12 "stack") | coerente con la dashboard Next.js | utente (confermato da Elia)
#12 | 2026-11-07 | Runtime Node 24 (LTS, sul Mac installata insieme alla 20) | scelta di Elia | utente

Aperte (non decise, vedi SPEC sez. 12): trigger GoCardless, canale notifiche, destinazione copia backup, ruolo proprio per n8n.
