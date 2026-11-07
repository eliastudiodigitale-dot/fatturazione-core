#!/usr/bin/env bash
# Annulla una PROFORMA (es. di test) con il token owner. Il numero resta "annullato" e non torna mai libero.
# Le fatture non si annullano (decisione #9: nota di credito): il servizio rifiuta. Dal Mac:
#   scripts/rilascio/annulla.sh '<ref>' 'motivo'
# La ref si legge con scripts/rilascio/documenti.sh (es. 86c1abcde|proforma|unica).
set -euo pipefail
REF="${1:-}"; MOTIVO="${2:-}"
[ -n "$REF" ] && [ "${#MOTIVO}" -ge 5 ] || { echo "uso: annulla.sh '<ref>' 'motivo (almeno 5 caratteri)'"; exit 1; }
[[ "$REF" =~ \|proforma\| ]] || { echo "solo proforme: le fatture si correggono con nota di credito"; exit 1; }
printf 'Annullo %s con motivo "%s"? Il numero NON tornerà libero. (scrivi SI) ' "$REF" "$MOTIVO"; read -r R
[ "$R" = "SI" ] || { echo "annullato nulla"; exit 1; }
REF_URI=$(jq -rn --arg r "$REF" '$r|@uri')
CORPO=$(jq -cn --arg m "$MOTIVO" '{motivo: $m}')
ssh vps-se "REF_URI='$REF_URI' CORPO='$CORPO' bash -s" <<'EOF'
set -euo pipefail
T=$(kubectl -n platform get secret fatturazione-api-secrets -o jsonpath='{.data.OWNER_TOKEN}' | base64 -d)
kubectl -n platform port-forward svc/fatturazione-core 18080:8080 >/dev/null 2>&1 & PF=$!
trap 'kill $PF 2>/dev/null; unset T' EXIT
sleep 2
printf 'header = "Authorization: Bearer %s"\n' "$T" | curl -sS --config - -X POST -H 'Content-Type: application/json' \
  --data "$CORPO" "http://127.0.0.1:18080/v1/documenti/$REF_URI/annulla"; echo
EOF
