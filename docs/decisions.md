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
#9 | 2026-11-07 | Le fatture non si annullano mai: si corregge con nota di credito. Solo le proforme si annullano; la proforma rifatta prende il primo numero libero successivo (es. 16 annullata, la nuova può essere 17 o 22), numerazione sul totale delle proforme, numeri annullati mai riusati | regola di Elia, sostituisce la giustificazione dei numeri fattura annullati | utente
#10 | 2026-11-07 | Il servizio usa solo il ruolo `fatturazione_app`; le migrazioni girano come Job separato con il ruolo owner `fatturazione` | minimo privilegio | utente (SPEC sez. 3.2 e 8, fb69474)
#11 | 2026-11-07 | Stack del servizio: TypeScript/Node con Fastify e `pg` (chiude il punto aperto SPEC sez. 12 "stack") | coerente con la dashboard Next.js | utente (confermato da Elia)
#12 | 2026-11-07 | Runtime Node 24 (LTS, sul Mac installata insieme alla 20) | scelta di Elia | utente
#13 | 2026-11-07 | Migrazione 003 approvata: `fatturazione_app` può leggere (solo SELECT) `contatori`; la applica Elia col Job di migrazione | controllo all'avvio e riconciliazione devono leggere il contatore | utente (default proposto dall'agente)
#14 | 2026-11-07 | Migrazione 004 approvata: in `riserva_numero` data e anno si prendono con clock_timestamp() dopo il lock; la applica Elia | con 001 numero e data potevano invertirsi (viola #5), riprodotto dal test di concorrenza | utente (default proposto dall'agente)
#15 | 2026-11-07 | I pagamenti Stripe e GoCardless generano una `fattura` (PAGAMENTI_TIPO_DOCUMENTO=fattura) | il pagamento è già incassato | utente (default proposto dall'agente)
#16 | 2026-11-07 | Le task documento in ClickUp hanno un campo testo "chiave" = `<tipo>\|<anno>\|<numero>`; il worker cerca per chiave prima di creare | niente doppioni dopo timeout o crash | utente (default proposto dall'agente)
#17 | 2026-11-07 | `PG_SSL` obbligatoria: `verify-full` se services-postgres ha SSL, altrimenti `disable` con traffico confinato dalla NetworkPolicy | nessuna scelta silenziosa sul trasporto | utente (default proposto dall'agente)
#18 | 2026-11-07 | Ref dashboard = `dashboard\|<id>\|<tipo>`; invoice Stripe a importo zero non generano documenti; senza `metadata.business` non si emette (fail closed); l'annullo non modifica la task ClickUp, lo segnala la riconciliazione | regole mancanti nella SPEC | utente (default proposto dall'agente)
#19 | 2026-11-07 | Host pubblico del servizio: `gestione.gazzolaelia.it` (dominio `gazzolaelia.it`); niente sottodomini generici tipo `api.`/`webhook.`, già usati da altri servizi | evitare conflitti | utente
#20 | 2026-11-07 | n8n chiama l'API con token Bearer statico (`N8N_TOKEN`); OAuth/Keycloak eventualmente in Fase 3 | già implementato e testato, nessuna dipendenza da Keycloak | agente (delegato da Elia: "come vuoi")

Aperte (non decise, vedi SPEC sez. 12): trigger GoCardless, canale notifiche, destinazione copia backup, ruolo proprio per n8n.
