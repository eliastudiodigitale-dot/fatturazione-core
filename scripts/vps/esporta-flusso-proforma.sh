#!/usr/bin/env bash
# Esporta il flusso n8n "auto_pro-forma (from clickup) +subtasks" COMPLETO (con i riferimenti alle credenziali,
# che sono solo id e nomi, mai i segreti) per generarne la versione collegata al servizio. SOLA LETTURA.
# Toglie i dati di prova (pinData) e maschera eventuali token scritti nei nodi.
# Dal Mac:
#   cd /Users/elia/offline/REPO-locali/fatturazione-core && ssh vps-se 'bash -s' < scripts/vps/esporta-flusso-proforma.sh > ~/n8n-auto-proforma.json
set -euo pipefail
kubectl -n platform exec deploy/n8n -- n8n export:workflow --id=qxTGplETNXsTvKOZ 2>/dev/null \
  | sed -n '/^[[{]/,$p' \
  | jq '(if type=="array" then .[0] else . end) | del(.pinData, .staticData)' \
  | sed -E -e 's/pk_[A-Za-z0-9_]{8,}/pk_***MASCHERATO***/g' \
           -e 's/(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/\1_\2_***MASCHERATO***/g' \
           -e 's/[0-9]{6,}:[A-Za-z0-9_-]{30,}/***TOKEN-TELEGRAM-MASCHERATO***/g'
