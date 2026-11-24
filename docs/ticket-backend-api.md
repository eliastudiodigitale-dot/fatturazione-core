# API che ogni backend di business deve esporre per i ticket (decisione #47)

Il portale (fatturazione-core) non ha i ticket in casa: li richiama dal backend di ogni business. Questo è il contratto che quel backend deve rispettare. Vale per heyciar (SaaS), per il bot di serrandasu.it e per il ticketing di reti.gazzolaelia.it. Un business che non ha ancora un backend non deve fare nulla: i suoi ticket stanno nel servizio fatturazione-core.

Non verificato contro nessun backend reale: è la specifica da implementare lato business. Se il backend esiste già con altri nomi, si adatta il client in `src/ticket-backend.ts` (un solo file), non il backend.

## Autenticazione e rete
- URL base in `TICKET_BACKEND_URL_<FONTE>` (https; `http` solo dentro il cluster, es. `http://servizio.namespace.svc.cluster.local:porta/api/ticket`). Senza barra finale.
- Il servizio chiama con `Authorization: Bearer <token>`; il token (min 32 caratteri) è in `TICKET_BACKEND_TOKEN_<FONTE>` nel Secret. Il backend lo deve riconoscere e rifiutare il resto con 401.
- Risposte JSON, timeout del chiamante 10 secondi. Gli errori non devono contenere segreti.

## Il verso opposto (il business avvisa il servizio)
Quando nasce un ticket il backend può avvisare subito `POST /v1/ticket` (token della fonte, `TICKET_TOKEN_<FONTE>`) con `id_esterno` = id del ticket nel backend. È facoltativo: in ogni caso il servizio rilegge tutto ogni `TICKET_SYNC_MIN` minuti (5 di default). L'avviso rende solo il ticket visibile prima e fa partire subito l'allarme per i ticket urgenti.

## Chiamate che il backend espone

### `GET /tickets?aggiornati_dopo=<ISO>&pagina=<n>&limite=<n>`
Ticket creati o modificati dopo la data (tutti se manca). Paginazione a numero di pagina da 1, `limite` fino a 200.
```json
{ "tickets": [ {
    "id": "123",
    "oggetto": "Non riesco ad accedere",
    "stato": "aperto | in_lavorazione | in_attesa_cliente | risolto | chiuso",
    "priorita": "urgente | alta | normale | bassa",
    "categoria": "accesso", "canale": "app",
    "cliente": { "nome": "Rossi Srl", "email": "info@rossi.it", "partita_iva": "12345678901" },
    "assegnato_a": "anna@example.org",
    "aperto_il": "2026-11-23T10:00:00Z",
    "prima_risposta_il": "2026-11-23T11:00:00Z",
    "risolto_il": null,
    "piano_sla": "48h"
  } ],
  "prossima_pagina": true }
```
- Obbligatori: `id` (lettere, numeri e `._:/-`, max 120), `oggetto`, `aperto_il`. Il resto è facoltativo; valori sconosciuti di stato e priorità diventano `aperto` e `normale`.
- `prima_risposta_il` e `risolto_il` sono gli orari veri: il portale li usa per l'SLA (non li inventa).
- `piano_sla` (facoltativo): se il backend conosce il piano del cliente lo indica (`nessuno` o il nome di un piano che l'attività ha in Impostazioni > SLA, per heyciar `48h`, `3g`, `5g`, `7g`); un nome sconosciuto viene ignorato. Se manca vale il piano del cliente nel portale, poi il predefinito dell'attività.

### `GET /tickets/{id}/messaggi`
```json
{ "messaggi": [ { "quando": "2026-11-23T10:00:00Z", "da": "cliente | staff", "autore": "Rossi", "testo": "…", "interno": false } ] }
```
I messaggi non si copiano nel portale: si leggono da qui ogni volta che si apre un ticket.

### `POST /tickets/{id}/messaggi`
`{ "testo": "…", "autore": "elia@example.org", "interno": false }` → 200/201/204. Con `interno: true` è una nota riservata allo staff, che il backend non deve mostrare al cliente. Una risposta non interna va consegnata al cliente nel modo che il business usa (app, email, chat).

### `PATCH /tickets/{id}`
Uno o più campi tra `stato`, `priorita`, `assegnato_a` (stringa o `null`), `categoria` (stringa o `null`) → 200/204. Il backend deve applicare la modifica o rispondere con un errore: il portale aggiorna la sua copia solo se il backend risponde bene.

### `POST /tickets`
Apertura dal portale (per un cliente che ha scritto per telefono o email):
`{ "oggetto": "…", "testo": "…", "priorita": "normale", "categoria": "…", "cliente": { "nome": "…", "email": "…" }, "creato_da": "elia@example.org" }` → `{ "id": "124" }`.

## Cosa fa il portale con queste chiamate
- Copia in `ticket` (origine `remoto`) i campi del primo elenco; calcola le scadenze SLA dal piano (#46).
- Cambi di stato, assegnazione, priorità, categoria e risposte vanno prima al backend, poi alla copia. Backend giù: errore 502 mostrato a video, niente cambia.
- Se il backend non risponde durante la lettura periodica, parte un avviso Telegram (`ticket_backend_non_risponde`) e si riprova al giro dopo.
