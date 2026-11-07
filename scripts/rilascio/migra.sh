#!/usr/bin/env bash
# Applica UNA migrazione sul VPS col Job owner (decisione #10). Dal Mac, lo lancia Elia:
#   scripts/rilascio/migra.sh 003_lettura_contatori.sql
# Una sola connessione SSH: file e manifest viaggiano dentro lo script remoto.
set -euo pipefail
cd "$(dirname "$0")/../.."
F="${1:-}"
[[ "$F" =~ ^0(0[3-9]|[1-9][0-9])_[a-z0-9_]+\.sql$ ]] || { echo "file non ammesso (001/002 già applicati): $F"; exit 1; }
[ -f "migrations/$F" ] || { echo "non esiste: migrations/$F"; exit 1; }

SQL=$(base64 < "migrations/$F" | tr -d '\n')
JOB=$(sed "s/DA_IMPOSTARE.sql/$F/" k8s/migrazione-job.yaml | base64 | tr -d '\n')

ssh vps-se 'bash -s' <<EOF
set -euo pipefail
K=kubectl; \$K get ns >/dev/null 2>&1 || K="sudo -n k3s kubectl"
D=\$(mktemp -d); trap 'rm -rf "\$D"' EXIT
echo "$SQL" | base64 -d > "\$D/$F"
echo "$JOB" | base64 -d > "\$D/job.yaml"
\$K -n platform create configmap fatturazione-migrazioni --from-file="\$D/$F" --dry-run=client -o yaml | \$K apply -f -
\$K -n platform delete job fatturazione-migrazione --ignore-not-found
\$K -n platform apply -f "\$D/job.yaml"
\$K -n platform wait --for=condition=complete job/fatturazione-migrazione --timeout=120s || true
\$K -n platform logs job/fatturazione-migrazione
\$K -n platform get job fatturazione-migrazione -o jsonpath='{.status.succeeded}' | grep -q 1 && echo "ESITO: OK $F" || { echo "ESITO: FALLITA $F"; exit 1; }
EOF
