-- GIÀ APPLICATO il 2026-11-07: non rieseguire. La password arriva dal secret (variabile psql 'pw', mai nel file).
-- Eseguire come superutente su 'postgres' per CREATE ROLE/REVOKE sul DB; il resto nel DB 'fatturazione'
-- (GRANT sulle tabelle come ruolo owner: SET ROLE fatturazione).
CREATE ROLE fatturazione_app LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE ALL ON DATABASE fatturazione FROM PUBLIC;
GRANT CONNECT ON DATABASE fatturazione TO fatturazione_app;
-- nel DB fatturazione:
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO fatturazione, fatturazione_app;
-- come ruolo fatturazione:
GRANT SELECT, INSERT ON documenti TO fatturazione_app;
GRANT UPDATE (stato, clickup_task_id, note_annullo) ON documenti TO fatturazione_app;
GRANT SELECT, INSERT ON storico TO fatturazione_app;
GRANT SELECT, INSERT, UPDATE ON eventi_ricevuti TO fatturazione_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fatturazione_app;
ALTER FUNCTION riserva_numero(text,text,text,text,jsonb)
  SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION riserva_numero(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION riserva_numero(text,text,text,text,jsonb) TO fatturazione_app;
