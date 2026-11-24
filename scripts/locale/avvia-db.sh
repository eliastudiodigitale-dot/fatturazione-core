#!/usr/bin/env bash
# Postgres LOCALE per provare il portale sul Mac (mai il VPS, mai i dati veri).
# Container Docker separato da quello dei test (che ricrea il DB a ogni esecuzione): nome fatturazione-locale-pg, porta 55433,
# dati in un volume Docker (restano tra un avvio e l'altro). Crea i ruoli e applica le migrazioni 001-005 una sola volta.
# Valori di prova locali (non sono segreti: il DB ascolta solo su 127.0.0.1).
#
# Per cancellare tutto e ricominciare:  docker rm -f fatturazione-locale-pg && docker volume rm fatturazione-locale-dati
set -euo pipefail
CONTAINER=fatturazione-locale-pg
VOLUME=fatturazione-locale-dati
PORTA=55433
cd "$(dirname "$0")/../.."

command -v docker >/dev/null || { echo "Docker non trovato: avvia Docker Desktop e riprova"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker non è in esecuzione: avvia Docker Desktop e riprova"; exit 1; }

STATO=$(docker ps -a --filter "name=^${CONTAINER}$" --format '{{.Status}}')
if [ -z "$STATO" ]; then
  echo "Creo il Postgres locale ($CONTAINER, porta $PORTA)…"
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=locale -p "127.0.0.1:${PORTA}:5432" -v "${VOLUME}:/var/lib/postgresql/data" postgres:16 >/dev/null
elif [[ "$STATO" != Up* ]]; then
  echo "Riavvio il Postgres locale…"
  docker start "$CONTAINER" >/dev/null
fi

for i in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && docker exec "$CONTAINER" psql -q -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && { echo "Postgres locale non pronto"; exit 1; }
  sleep 0.5
done

psql_in() { # utente db [variabili psql]… < sql da stdin
  local u=$1 d=$2; shift 2
  local v=(); for x in "$@"; do v+=(-v "$x"); done
  # ${v[@]+...}: con la bash 3.2 del Mac un array vuoto con "set -u" darebbe errore
  docker exec -i "$CONTAINER" psql -q -U "$u" -d "$d" -v ON_ERROR_STOP=1 ${v[@]+"${v[@]}"}
}

if docker exec "$CONTAINER" psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='fatturazione'" | grep -q 1; then
  echo "DB locale già pronto (porta $PORTA)."
  exit 0
fi

echo "Primo avvio: creo ruoli, DB e applico le migrazioni (come in produzione: 001 owner, 002 superutente, 003-005 owner)…"
echo "CREATE ROLE fatturazione LOGIN PASSWORD 'owner_locale'; CREATE DATABASE fatturazione OWNER fatturazione;" | psql_in postgres postgres
psql_in fatturazione fatturazione < migrations/001_schema.sql
psql_in postgres fatturazione pw=app_locale < migrations/002_permessi.sql
psql_in fatturazione fatturazione < migrations/003_lettura_contatori.sql
psql_in fatturazione fatturazione < migrations/004_data_riserva_ordinata.sql
psql_in fatturazione fatturazione < migrations/005_crm_ticket.sql
echo "DB locale pronto."
