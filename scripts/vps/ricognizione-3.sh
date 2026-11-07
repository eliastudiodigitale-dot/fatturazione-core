#!/usr/bin/env bash
# Terza ricognizione, SOLA LETTURA: campi delle liste progetti e contatti (nomi, tipi, opzioni),
# e workflow n8n che potrebbero già creare fatture/proforme (vanno spenti per non avere due numerazioni).
# Nessun dato di clienti: solo nomi dei campi, conteggi, nomi dei workflow.
# Dal Mac:
#   cd /Users/elia/offline/REPO-locali/fatturazione-core && ssh vps-se 'bash -s' < scripts/vps/ricognizione-3.sh 2>&1 | tee ~/ricognizione-3.txt
set -u
echo "INIZIO ricognizione-3 $(date -Is)"
T=$(kubectl -n archportal002 get secret archportal002-secrets -o jsonpath='{.data.CLICKUP_API_TOKEN}' | base64 -d)
trap 'unset T' EXIT
cu() { curl -s --max-time 30 -H "Authorization: $T" "https://api.clickup.com/api/v2$1"; }

for L in 901517931489 901521040352 901517949675; do
  printf '\n===== lista %s: %s =====\n' "$L" "$(cu "/list/$L" | jq -r '.name')"
  cu "/list/$L/field" | jq -r '.fields[] | "CAMPO \(.id) \(.type) \(.name)", (.type_config.options[]? | "    OPZIONE \(.orderindex) \(.name)")'
  echo "task aperte: $(cu "/list/$L/task?include_closed=false&page=0" | jq '.tasks | length') (prima pagina, max 100)"
done

printf '\n===== campi compilati nei progetti (quante task hanno ciascun campo, nessun valore) =====\n'
for L in 901517931489 901521040352; do
  cu "/list/$L/task?include_closed=false&page=0" | jq -r --arg L "$L" '[.tasks[].custom_fields[]? | select(.value != null and .value != "") | .name] | group_by(.) | map("  \($L) \(.[0]): \(length)") | .[]'
done

printf '\n===== workflow n8n con fatt/prof/clickup nel nome (sola lettura) =====\n'
kubectl -n platform exec deploy/n8n -- n8n list:workflow 2>/dev/null | grep -iE 'fatt|prof|clickup|invoice|documen' || echo "nessuno trovato (o CLI n8n non disponibile)"
printf '\n===== workflow n8n attivi =====\n'
kubectl -n platform exec deploy/n8n -- n8n list:workflow --active=true 2>/dev/null | head -60 || true
echo; echo "FINE ricognizione-3"
