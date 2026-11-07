-- Applicato sul VPS il 2026-11-07 (DB fatturazione, eseguito come ruolo owner 'fatturazione').
-- GIÀ APPLICATO: non rieseguire. Le nuove modifiche vanno in file 003_*.sql, 004_*.sql, ...
CREATE TABLE contatori (
  anno int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('fattura','proforma')),
  ultimo int NOT NULL DEFAULT 0,
  PRIMARY KEY (anno, tipo)
);

CREATE TABLE documenti (
  id bigserial PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  anno int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('fattura','proforma')),
  numero int NOT NULL,
  data_riserva timestamptz NOT NULL DEFAULT now(),
  stato text NOT NULL DEFAULT 'riservato'
    CHECK (stato IN ('riservato','creato','inviato_sdi','consegnato','annullato')),
  fonte text NOT NULL,
  business text,
  payload jsonb NOT NULL,
  clickup_task_id text,
  note_annullo text,
  UNIQUE (anno, tipo, numero)
);

CREATE TABLE storico (
  id bigserial PRIMARY KEY,
  documento_id bigint NOT NULL REFERENCES documenti(id),
  quando timestamptz NOT NULL DEFAULT now(),
  da_stato text,
  a_stato text NOT NULL,
  dettaglio jsonb
);

CREATE TABLE eventi_ricevuti (
  id bigserial PRIMARY KEY,
  fonte text NOT NULL,
  evento_id text NOT NULL,
  ricevuto_il timestamptz NOT NULL DEFAULT now(),
  elaborato boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL,
  UNIQUE (fonte, evento_id)
);

CREATE FUNCTION blocca_modifiche() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'operazione non consentita su %', TG_TABLE_NAME; END $f$;

CREATE TRIGGER storico_append_only BEFORE UPDATE OR DELETE ON storico
  FOR EACH ROW EXECUTE FUNCTION blocca_modifiche();
CREATE TRIGGER documenti_no_delete BEFORE DELETE ON documenti
  FOR EACH ROW EXECUTE FUNCTION blocca_modifiche();

CREATE FUNCTION riserva_numero(p_ref text, p_tipo text, p_fonte text, p_business text, p_payload jsonb)
RETURNS documenti LANGUAGE plpgsql AS $f$
DECLARE
  v_anno int := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
  v_doc documenti;
  v_num int;
BEGIN
  INSERT INTO contatori(anno, tipo) VALUES (v_anno, p_tipo) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM contatori WHERE anno = v_anno AND tipo = p_tipo FOR UPDATE;
  SELECT * INTO v_doc FROM documenti WHERE ref = p_ref;
  IF FOUND THEN RETURN v_doc; END IF;
  UPDATE contatori SET ultimo = ultimo + 1 WHERE anno = v_anno AND tipo = p_tipo RETURNING ultimo INTO v_num;
  INSERT INTO documenti(ref, anno, tipo, numero, fonte, business, payload)
    VALUES (p_ref, v_anno, p_tipo, v_num, p_fonte, p_business, p_payload) RETURNING * INTO v_doc;
  INSERT INTO storico(documento_id, a_stato) VALUES (v_doc.id, 'riservato');
  RETURN v_doc;
END $f$;
