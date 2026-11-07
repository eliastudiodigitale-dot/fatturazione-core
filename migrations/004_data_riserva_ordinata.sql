-- NON APPLICATO. Richiede approvazione di Elia (modifica della funzione di numerazione).
-- Problema trovato dal test di concorrenza (SPEC 11.2): in 001 data_riserva = now() = inizio della
-- transazione, mentre il numero viene assegnato DOPO l'attesa del lock su contatori. Con richieste
-- concorrenti la fattura n+1 può avere data_riserva precedente alla n (violata decisione #5); a cavallo
-- di mezzanotte/capodanno la data documento risulterebbe invertita.
-- Correzione: data e anno presi con clock_timestamp() DOPO aver ottenuto il lock; se nel frattempo è
-- cambiato l'anno (Europe/Rome) si riprova sul contatore dell'anno nuovo.
-- Interfaccia, owner e GRANT invariati (CREATE OR REPLACE li conserva). Eseguire come owner 'fatturazione'.
CREATE OR REPLACE FUNCTION riserva_numero(p_ref text, p_tipo text, p_fonte text, p_business text, p_payload jsonb)
RETURNS documenti LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
DECLARE
  v_anno int;
  v_ora timestamptz;
  v_doc documenti;
  v_num int;
BEGIN
  LOOP
    v_anno := EXTRACT(YEAR FROM (clock_timestamp() AT TIME ZONE 'Europe/Rome'))::int;
    INSERT INTO contatori(anno, tipo) VALUES (v_anno, p_tipo) ON CONFLICT DO NOTHING;
    PERFORM 1 FROM contatori WHERE anno = v_anno AND tipo = p_tipo FOR UPDATE;
    SELECT * INTO v_doc FROM documenti WHERE ref = p_ref;
    IF FOUND THEN RETURN v_doc; END IF;
    v_ora := clock_timestamp();
    EXIT WHEN EXTRACT(YEAR FROM (v_ora AT TIME ZONE 'Europe/Rome'))::int = v_anno;
  END LOOP;
  UPDATE contatori SET ultimo = ultimo + 1 WHERE anno = v_anno AND tipo = p_tipo RETURNING ultimo INTO v_num;
  INSERT INTO documenti(ref, anno, tipo, numero, data_riserva, fonte, business, payload)
    VALUES (p_ref, v_anno, p_tipo, v_num, v_ora, p_fonte, p_business, p_payload) RETURNING * INTO v_doc;
  INSERT INTO storico(documento_id, a_stato) VALUES (v_doc.id, 'riservato');
  RETURN v_doc;
END $f$;
