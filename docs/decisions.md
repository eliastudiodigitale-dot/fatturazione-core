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
#21 | 2026-11-07 | Notifiche anomalie via bot Telegram dedicato (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID); senza configurazione restano solo nei log | gratis, immediato, una chiamata HTTPS | utente (proposta A dell'agente)
#22 | 2026-11-07 | Copia backup fuori VPS su Backblaze B2 con Object Lock, dump cifrati prima dell'invio (rclone crypt), CronJob dopo il backup notturno | dump < 20 MB, costo ~0, protegge anche da VPS compromesso | utente (proposta A dell'agente)
#23 | 2026-11-07 | Nessun registry: l'immagine si compila sul Mac e si importa in k3s (`k3s ctr images import`), tag fisso, imagePullPolicy Never | costo zero, nessuna credenziale in più | utente (proposta A dell'agente)
#24 | 2026-11-07 | Nota di credito: nuovo tipo con numerazione propria, con migrazione dello schema, in Fase 2 insieme all'XML SDI | correzione fatture (decisione #9) | utente
#25 | 2026-11-07 | Scelta del provider SDI: ricerca dedicata (/ricerca) in una sessione separata | Fase 2 | utente
#26 | 2026-11-07 | GoCardless: la fattura nasce al versamento (GC_TRIGGER_ACTION=paid_out) | risposta di Elia nel Centro Fatturazione | utente
#27 | 2026-11-07 | GoCardless serve una sola attività: GC_BUSINESS_PREDEFINITO=reti.gazzolaelia.it | risposta di Elia nel Centro Fatturazione | utente
#28 | 2026-11-07 | Stripe serve più attività (serrandasu.it, gazzolaelia.it, heyciar.it): l'attività si legge da metadata "business" su invoice/abbonamento o, se manca, sul prodotto; invoice con prodotti di attività diverse = bloccata | risposta di Elia + regola dell'agente | utente
#29 | 2026-11-07 | Token ClickUp: si riusa quello di archportal002-secrets (CLICKUP_API_TOKEN), copiato lato server; limite 100/min condiviso, il servizio ne usa 40 | risposta di Elia nel Centro Fatturazione | utente
#30 | 2026-11-07 | ClickUp: lista unica "proforme e fatture" (901518874514) con i campi esistenti; i numeri già usati a mano (Anno + nr-fattura/nr-proforma + checkbox) bloccano l'avvio finché il contatore non è riallineato | evitare numeri doppi con la numerazione manuale precedente | agente (da confermare)
#31 | 2026-11-07 | La fattura nasce dalla proforma: stessa task in "proforme e fatture" (nr-fattura e t-fattura sulla task della proforma), non una task nuova | flusso attuale di Elia | utente
#32 | 2026-11-07 | La proforma parte dal pulsante "inviapf" del progetto, come oggi | flusso attuale di Elia | utente
#33 | 2026-11-07 | Causale e righe del documento calcolate come nel flusso attuale (auto_pro-forma +subtasks), da replicare dopo ricognizione-4 | flusso attuale di Elia | utente
#34 | 2026-11-07 | Proforme dal flusso n8n: il numero si prende PRIMA dell'approvazione su Telegram (deve stare nel PDF); con NO, tempo scaduto o email mancante il flusso annulla la proforma (resta un salto, ammesso per le proforme). Per questo il token n8n può annullare solo proforme proprie (fonte clickup) ancora in stato riservato | scelta di Elia; permesso minimo per realizzarla | utente (permesso n8n: agente, da confermare)
#35 | 2026-11-07 | La task in "proforme e fatture" la crea il flusso n8n come oggi (nome F-progetto-anno, stato "pf inviata") con la Chiave documento, e conferma al servizio; il servizio la crea solo se dopo 45 minuti manca (WORKER_ATTESA_CLICKUP_MIN) | scelta di Elia | utente
#36 | 2026-11-07 | La fattura elettronica oggi si emette con un programma/app esterno: il numero da usare lì sarà quello del servizio | risposta di Elia (Fase 2: integrazione SDI) | utente
#37 | 2026-11-07 | Stripe è un'organizzazione con un account per attività e il servizio usa la chiave di organizzazione (sk_org_): l'attività della fattura è quella dell'account che ha incassato (STRIPE_BUSINESS_PER_ACCOUNT), ogni lettura su Stripe è fatta per conto di quell'account (Stripe-Context). Sostituisce i metadata sui prodotti della #28 | risposta di Elia | utente

Aperte (non decise, vedi SPEC sez. 12): trigger GoCardless, canale notifiche, destinazione copia backup, ruolo proprio per n8n.
