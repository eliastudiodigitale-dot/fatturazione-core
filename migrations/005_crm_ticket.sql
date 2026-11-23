-- 005: CRM e ticketing multi-business (decisione #45). NON ANCORA APPLICATA sul VPS: la applica Elia col Job di migrazione.
-- Eseguire come ruolo owner `fatturazione` sul DB `fatturazione` (come 001, 003, 004).
--
-- Principio (#45, #46): i CLIENTI restano in ClickUp (anagrafica unica, #42): qui c'è una copia locale riletta a intervalli.
-- I TICKET vivono nel backend di ogni business (heyciar, serrandasu.it, reti.gazzolaelia.it), richiamato via API:
-- qui c'è la copia per filtri, KPI e SLA (origine = 'remoto'); per i business senza backend il ticket vive qui (origine = 'locale').
-- Il portale (dashboard) è operativo: assegna, cambia stato, risponde, annota, pianifica. Note, attività, contatti e
-- opportunità del CRM sono dati del portale (non esistono in ClickUp) e stanno qui.
-- Dati leggeri (#7, #8): niente allegati; i messaggi dei ticket remoti non si copiano (si leggono dall'API quando servono).
-- Nessuna cancellazione di clienti: quelli spariti da ClickUp restano con eliminato = true, per non perdere lo storico.

-- Clienti: copia della lista "Clienti" di ClickUp (anagrafica unica di tutti i business, #42).
CREATE TABLE crm_clienti (
  clickup_task_id text PRIMARY KEY,
  nome            text NOT NULL,
  email           text,                         -- sempre minuscola
  partita_iva     text,
  codice_fiscale  text,
  telefono        text,
  businesses      text[] NOT NULL DEFAULT '{}', -- attività per cui il cliente compra (può essere più di una)
  stato           text,                         -- stato della scheda in ClickUp (per nome)
  tag             text[] NOT NULL DEFAULT '{}',
  piano_sla       text,                         -- piano di assistenza a pagamento ('48h','3g','5g','7g') o 'nessuno'; NULL = predefinito dell'attività (#46). Lo imposta il portale
  creato_il       timestamptz,
  modificato_il   timestamptz,
  sync_il         timestamptz NOT NULL DEFAULT now(),
  eliminato       boolean NOT NULL DEFAULT false
);
CREATE INDEX crm_clienti_email ON crm_clienti (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX crm_clienti_piva ON crm_clienti (partita_iva) WHERE partita_iva IS NOT NULL;
CREATE INDEX crm_clienti_businesses ON crm_clienti USING gin (businesses);

-- Ticket. `ref` è la chiave di idempotenza: <fonte>|<id esterno> per i ticket che arrivano dalle fonti,
-- clickup|<id task> per quelli aperti direttamente in ClickUp.
CREATE TABLE ticket (
  id                   bigserial PRIMARY KEY,
  ref                  text NOT NULL UNIQUE,
  fonte                text NOT NULL,           -- heyciar, serrandasu, reti, dashboard (aperto dal portale), clickup (storico), ...
  origine              text NOT NULL DEFAULT 'locale' CHECK (origine IN ('locale','remoto')),  -- dove vive il ticket
  id_remoto            text,                    -- id del ticket nel backend del business (origine = remoto)
  piano_sla            text,                    -- piano SLA applicato (#46): 48h, 3g, 5g, 7g; 'nessuno' = senza SLA (best effort); NULL = SLA standard dell'attività
  business             text NOT NULL,
  oggetto              text NOT NULL CHECK (length(oggetto) BETWEEN 1 AND 300),
  testo                text CHECK (length(testo) <= 8000),  -- solo ticket locali; per i remoti si legge dall'API
  priorita             text NOT NULL DEFAULT 'normale' CHECK (priorita IN ('urgente','alta','normale','bassa')),
  stato                text NOT NULL DEFAULT 'aperto' CHECK (stato IN ('aperto','in_lavorazione','in_attesa_cliente','risolto','chiuso')),
  categoria            text,
  canale               text,                    -- app, bot, sito, email, ...
  cliente_nome         text,
  cliente_email        text,
  cliente_task_id      text,                    -- scheda in crm_clienti (nessuna FK: la cache può cambiare)
  assegnato_a          text,
  aperto_il            timestamptz NOT NULL DEFAULT now(),
  prima_risposta_il    timestamptz,
  risolto_il           timestamptz,
  scade_prima_risposta timestamptz,
  scade_risoluzione    timestamptz,
  clickup_task_id      text UNIQUE,
  sync_il              timestamptz,
  aggiornato_il        timestamptz NOT NULL DEFAULT now(),
  dati_fonte           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(dati_fonte) <= 4096)
);
CREATE INDEX ticket_business_stato ON ticket (business, stato);
CREATE INDEX ticket_aperto_il ON ticket (aperto_il);
CREATE INDEX ticket_cliente ON ticket (cliente_task_id) WHERE cliente_task_id IS NOT NULL;
CREATE INDEX ticket_da_inviare ON ticket (id) WHERE clickup_task_id IS NULL AND origine = 'locale';
CREATE INDEX ticket_assegnato ON ticket (lower(assegnato_a)) WHERE assegnato_a IS NOT NULL;

-- Cronologia leggera del ticket (apertura, cambi di stato, risposte): niente testi.
CREATE TABLE ticket_eventi (
  id        bigserial PRIMARY KEY,
  ticket_id bigint NOT NULL REFERENCES ticket(id),
  quando    timestamptz NOT NULL DEFAULT now(),
  tipo      text NOT NULL,                      -- aperto, stato, assegnato, priorita, risposta_cliente, risposta_staff, sync
  da        text,                               -- fonte o utente
  dettaglio jsonb
);
CREATE INDEX ticket_eventi_ticket ON ticket_eventi (ticket_id, id);

-- Conversazione dei ticket LOCALI (per i remoti i messaggi restano nel backend del business). `interno` = nota visibile solo allo staff.
CREATE TABLE ticket_messaggi (
  id        bigserial PRIMARY KEY,
  ticket_id bigint NOT NULL REFERENCES ticket(id),
  quando    timestamptz NOT NULL DEFAULT now(),
  da        text NOT NULL CHECK (da IN ('cliente','staff')),
  autore    text,
  interno   boolean NOT NULL DEFAULT false,
  testo     text CHECK (length(testo) <= 8000),
  inviato_il timestamptz
);
CREATE INDEX ticket_messaggi_ticket ON ticket_messaggi (ticket_id, id);
CREATE INDEX ticket_messaggi_da_inviare ON ticket_messaggi (id) WHERE inviato_il IS NULL AND NOT interno;

-- Chi ha fatto accesso al portale: serve per proporre gli assegnatari dei ticket e delle attività.
CREATE TABLE utenti_dashboard (
  sub            text PRIMARY KEY,
  nome           text NOT NULL,
  email          text,
  ruoli          text[] NOT NULL DEFAULT '{}',
  business       text[],                         -- NULL = tutte
  ultimo_accesso timestamptz NOT NULL DEFAULT now()
);

-- CRM operativo (dati del portale). Il cliente è sempre la scheda ClickUp (clickup_task_id), senza FK: la cache può cambiare.
CREATE TABLE crm_contatti (
  id              bigserial PRIMARY KEY,
  cliente_task_id text NOT NULL,
  nome            text NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  ruolo           text,
  email           text,
  telefono        text,
  principale      boolean NOT NULL DEFAULT false,
  creato_il       timestamptz NOT NULL DEFAULT now(),
  eliminato       boolean NOT NULL DEFAULT false
);
CREATE INDEX crm_contatti_cliente ON crm_contatti (cliente_task_id) WHERE NOT eliminato;

CREATE TABLE crm_note (
  id              bigserial PRIMARY KEY,
  cliente_task_id text NOT NULL,
  autore          text NOT NULL,
  testo           text NOT NULL CHECK (length(testo) BETWEEN 1 AND 4000),
  fissata         boolean NOT NULL DEFAULT false,
  creato_il       timestamptz NOT NULL DEFAULT now(),
  eliminato       boolean NOT NULL DEFAULT false
);
CREATE INDEX crm_note_cliente ON crm_note (cliente_task_id, id DESC) WHERE NOT eliminato;

-- Attività e promemoria (chiamata, email, riunione, promemoria): il "da fare" del CRM.
CREATE TABLE crm_attivita (
  id              bigserial PRIMARY KEY,
  cliente_task_id text,
  ticket_ref      text,
  business        text,
  tipo            text NOT NULL DEFAULT 'promemoria' CHECK (tipo IN ('chiamata','email','riunione','promemoria')),
  titolo          text NOT NULL CHECK (length(titolo) BETWEEN 1 AND 300),
  scadenza        timestamptz,
  assegnato_a     text,
  creato_da       text NOT NULL,
  creato_il       timestamptz NOT NULL DEFAULT now(),
  completata_il   timestamptz,
  eliminato       boolean NOT NULL DEFAULT false
);
CREATE INDEX crm_attivita_cliente ON crm_attivita (cliente_task_id) WHERE NOT eliminato;
CREATE INDEX crm_attivita_aperte ON crm_attivita (scadenza) WHERE completata_il IS NULL AND NOT eliminato;

-- Trattative (pipeline): una per cliente/prospect e attività.
CREATE TABLE crm_opportunita (
  id              bigserial PRIMARY KEY,
  cliente_task_id text,
  prospect        text,                          -- nome se il cliente non esiste ancora in ClickUp
  business        text NOT NULL,
  titolo          text NOT NULL CHECK (length(titolo) BETWEEN 1 AND 300),
  fase            text NOT NULL DEFAULT 'nuova' CHECK (fase IN ('nuova','contattato','proposta','trattativa','vinta','persa')),
  valore          numeric(12,2) CHECK (valore >= 0),
  chiusura_prevista date,
  assegnato_a     text,
  motivo_perdita  text,
  creato_da       text NOT NULL,
  creato_il       timestamptz NOT NULL DEFAULT now(),
  aggiornato_il   timestamptz NOT NULL DEFAULT now(),
  chiusa_il       timestamptz
);
CREATE INDEX crm_opportunita_fase ON crm_opportunita (business, fase);

-- Viste salvate (filtri con un nome) per sezione e utente; `condivisa` = visibile a tutti quelli con la stessa sezione.
CREATE TABLE crm_viste (
  id        bigserial PRIMARY KEY,
  sezione   text NOT NULL CHECK (sezione IN ('ticket','clienti','fatture','opportunita')),
  nome      text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  filtro    jsonb NOT NULL CHECK (pg_column_size(filtro) <= 2048),
  utente    text NOT NULL,
  condivisa boolean NOT NULL DEFAULT false,
  creato_il timestamptz NOT NULL DEFAULT now(),
  eliminato boolean NOT NULL DEFAULT false
);

-- Stato delle sincronizzazioni con ClickUp (per la dashboard: "dati aggiornati alle ...").
CREATE TABLE crm_sync (
  nome         text PRIMARY KEY,                -- clienti, ticket
  ultimo_inizio timestamptz,
  ultimo_ok    timestamptz,
  ultimo_errore text,
  dettaglio    jsonb
);

-- Permessi per il ruolo dell'app: mai DELETE, mai DDL.
GRANT SELECT, INSERT, UPDATE ON crm_clienti TO fatturazione_app;
GRANT SELECT, INSERT, UPDATE ON ticket TO fatturazione_app;
GRANT SELECT, INSERT ON ticket_eventi TO fatturazione_app;
GRANT SELECT, INSERT, UPDATE ON ticket_messaggi TO fatturazione_app;
GRANT SELECT, INSERT, UPDATE ON crm_sync TO fatturazione_app;
GRANT SELECT, INSERT, UPDATE ON utenti_dashboard, crm_contatti, crm_note, crm_attivita, crm_opportunita, crm_viste TO fatturazione_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fatturazione_app;
