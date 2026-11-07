#!/usr/bin/env bash
# Porta il contatore di (anno, tipo) a "ultimo numero già usato", col Job owner. Il contatore può solo SALIRE.
# Si usa: prima della prima emissione (numeri già usati a mano in ClickUp / nel cassetto fiscale) e dopo un ripristino.
# Dal Mac, lo lancia Elia:
#   scripts/rilascio/riallinea.sh 2026 fattura 37
set -euo pipefail
cd "$(dirname "$0")/../.."
ANNO="${1:-}"; TIPO="${2:-}"; MAX="${3:-}"
[[ "$ANNO" =~ ^20[0-9]{2}$ ]] || { echo "anno non valido"; exit 1; }
[[ "$TIPO" =~ ^(fattura|proforma)$ ]] || { echo "tipo: fattura o proforma"; exit 1; }
[[ "$MAX" =~ ^[0-9]{1,6}$ ]] || { echo "numero non valido"; exit 1; }
printf 'Il prossimo %s del %s avrà numero %s. Confermi? (scrivi SI) ' "$TIPO" "$ANNO" "$((MAX + 1))"; read -r R
[ "$R" = "SI" ] || { echo "annullato"; exit 1; }

F="riallinea_${ANNO}_${TIPO}.sql"
SQL=$(sed -e "s/:anno/$ANNO/g" -e "s/:'tipo'/'$TIPO'/g" -e "s/:max/$MAX/g" scripts/riallinea-contatore.sql | base64 | tr -d '\n')
JOB=$(sed "s/DA_IMPOSTARE.sql/$F/" k8s/migrazione-job.yaml | base64 | tr -d '\n')

ssh vps-se 'bash -s' <<EOF
set -euo pipefail
D=\$(mktemp -d); trap 'rm -rf "\$D"' EXIT
echo "$SQL" | base64 -d > "\$D/$F"
echo "$JOB" | base64 -d > "\$D/job.yaml"
kubectl -n platform create configmap fatturazione-migrazioni --from-file="\$D/$F" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n platform delete job fatturazione-migrazione --ignore-not-found
kubectl -n platform apply -f "\$D/job.yaml"
kubectl -n platform wait --for=condition=complete job/fatturazione-migrazione --timeout=120s || true
kubectl -n platform logs job/fatturazione-migrazione
kubectl -n platform get job fatturazione-migrazione -o jsonpath='{.status.succeeded}' | grep -q 1 && echo "ESITO: OK contatore $ANNO $TIPO >= $MAX" || { echo "ESITO: FALLITO"; exit 1; }
EOF
