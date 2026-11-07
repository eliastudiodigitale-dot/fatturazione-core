-- Recupero dopo perdita/ripristino del DB (SPEC 7, passo 3). MANUALE, ruolo owner 'fatturazione'.
-- Il valore :max è il massimo tra DB, ClickUp e cassetto fiscale per (anno, tipo), verificato a mano.
-- Il contatore può solo SALIRE: se :max è minore del valore attuale non cambia nulla.
-- Uso: psql -v ON_ERROR_STOP=1 -v anno=2026 -v tipo=fattura -v max=123 -f scripts/riallinea-contatore.sql
BEGIN;
INSERT INTO contatori(anno, tipo) VALUES (:anno, :'tipo') ON CONFLICT DO NOTHING;
UPDATE contatori SET ultimo = GREATEST(ultimo, :max) WHERE anno = :anno AND tipo = :'tipo'
  RETURNING anno, tipo, ultimo;
COMMIT;
-- Poi: togliere FORZA_BLOCCO dal Deployment e riavviare; il servizio si sblocca solo se il controllo passa.
