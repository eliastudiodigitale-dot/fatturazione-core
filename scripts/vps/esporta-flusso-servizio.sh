#!/usr/bin/env bash
# Esporta da n8n il flusso "auto_pro-forma (servizio fatturazione)" COSÌ COM'È ORA (comprese le tue modifiche),
# cercandolo per nome. SOLA LETTURA. Stessa maschera dei token dello script esporta-flusso-proforma.sh.
# Dal Mac:
#   cd /Users/elia/offline/REPO-locali/fatturazione-core && ssh vps-se 'bash -s' < scripts/vps/esporta-flusso-servizio.sh > /Users/elia/n8n-flusso-servizio-attuale.json
set -euo pipefail
ID=$(kubectl -n platform exec deploy/n8n -- n8n list:workflow 2>/dev/null | grep -F 'auto_pro-forma (servizio fatturazione)' | head -1 | cut -d'|' -f1)
[ -n "$ID" ] || { echo "flusso non trovato" >&2; exit 1; }
kubectl -n platform exec deploy/n8n -- n8n export:workflow --id="$ID" 2>/dev/null \
  | sed -n '/^[[{]/,$p' \
  | jq '(if type=="array" then .[0] else . end) | del(.pinData, .staticData)' \
  | sed -E -e 's/pk_[A-Za-z0-9_]{8,}/pk_***MASCHERATO***/g' \
           -e 's/(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/\1_\2_***MASCHERATO***/g' \
           -e 's/[0-9]{6,}:[A-Za-z0-9_-]{30,}/***TOKEN-TELEGRAM-MASCHERATO***/g'
