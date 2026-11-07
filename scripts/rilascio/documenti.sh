#!/usr/bin/env bash
# Mostra cosa c'è nel servizio: ultimi numeri, conteggi per stato, ultimi 20 documenti (solo numeri, stati, attività:
# nessun dato dei clienti). SOLA LETTURA. Dal Mac:
#   scripts/rilascio/documenti.sh
set -euo pipefail
ssh vps-se 'bash -s' <<'EOF'
set -euo pipefail
T=$(kubectl -n platform get secret fatturazione-api-secrets -o jsonpath='{.data.DASHBOARD_TOKEN}' | base64 -d)
kubectl -n platform port-forward svc/fatturazione-core 18080:8080 >/dev/null 2>&1 & PF=$!
trap 'kill $PF 2>/dev/null; unset T' EXIT
sleep 2
printf 'header = "Authorization: Bearer %s"\n' "$T" | curl -sS --config - http://127.0.0.1:18080/v1/riepilogo \
  | jq -r '
    "servizio bloccato: \(.servizio.bloccato)",
    "== ultimi numeri", (.ultimi[] | "  \(.tipo) \(.anno): \(.ultimo)"),
    "== per stato", (.conteggi[] | "  \(.tipo) \(.anno) \(.stato): \(.n)"),
    "== ultimi documenti", (.recenti[] | "  \(.tipo) \(.numero)/\(.anno)  \(.stato)  fonte=\(.fonte)  attività=\(.business)  ref=\(.ref)")'
EOF
