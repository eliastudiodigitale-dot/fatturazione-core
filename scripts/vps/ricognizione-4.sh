#!/usr/bin/env bash
# Quarta ricognizione, SOLA LETTURA: esporta la logica dei due flussi n8n che oggi gestiscono proforme e fatture,
# per rifarla identica nel nuovo workflow (causale, righe dalle sottotask, importi, pulsante inviapf).
# Toglie: dati di prova (pinData), stato interno, ID credenziali, e maschera qualunque token o chiave nei parametri.
# Dal Mac:
#   cd /Users/elia/offline/REPO-locali/fatturazione-core && ssh vps-se 'bash -s' < scripts/vps/ricognizione-4.sh 2>&1 | tee ~/ricognizione-4.txt
set -u
echo "INIZIO ricognizione-4 $(date -Is)"
maschera() {
  sed -E \
    -e 's/pk_[A-Za-z0-9_]{8,}/pk_***MASCHERATO***/g' \
    -e 's/(Bearer|Token|token|apikey|api_key|apiKey|password|secret)([" :=]+)[A-Za-z0-9._~+\/=-]{12,}/\1\2***MASCHERATO***/g' \
    -e 's/(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/\1_\2_***MASCHERATO***/g' \
    -e 's/whsec_[A-Za-z0-9]{8,}/whsec_***MASCHERATO***/g' \
    -e 's/[0-9]{6,}:[A-Za-z0-9_-]{30,}/***TOKEN-TELEGRAM-MASCHERATO***/g'
}
for ID in qxTGplETNXsTvKOZ gzo8XaorcDTR4rhs; do
  printf '\n===== workflow %s =====\n' "$ID"
  kubectl -n platform exec deploy/n8n -- n8n export:workflow --id="$ID" 2>/dev/null \
    | sed -n '/^[[{]/,$p' \
    | jq '(if type=="array" then .[0] else . end)
          | {name, active,
             nodes: [.nodes[] | {name, type, typeVersion, disabled, parameters, credenziali: ((.credentials // {}) | keys)}],
             connections}' 2>/dev/null \
    | maschera \
    || echo "esportazione non riuscita per $ID"
done
echo; echo "FINE ricognizione-4"
