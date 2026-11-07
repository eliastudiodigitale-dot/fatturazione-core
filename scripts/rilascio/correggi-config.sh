#!/usr/bin/env bash
# Applica SOLO configurazione e ingress (stessa immagine già importata) e riavvia il servizio. Dal Mac, lo lancia Elia:
#   scripts/rilascio/correggi-config.sh
# Mostra prima l'errore attuale del pod, poi applica, aspetta il riavvio e controlla /readyz e il certificato HTTPS.
set -euo pipefail
cd "$(dirname "$0")/../.."
{ cat k8s/app.yaml; echo '---'; cat k8s/ingress.yaml; } | ssh vps-se 'bash -c "
echo \"== errore attuale (ultime righe del log)\"
kubectl -n platform logs deploy/fatturazione-core --tail=8 2>&1 | cut -c1-300 || true
echo \"== applico configurazione e ingress\"
kubectl apply -f -
kubectl -n platform rollout restart deploy/fatturazione-core
kubectl -n platform rollout status deploy/fatturazione-core --timeout=180s || true
echo \"== stato\"
kubectl -n platform get pods -l app=fatturazione-core
echo \"== readyz\"
kubectl -n platform get --raw /api/v1/namespaces/platform/services/fatturazione-core:http/proxy/readyz; echo
echo \"== prime righe del log\"
kubectl -n platform logs deploy/fatturazione-core --tail=15 2>&1 | grep -E \"avvio|bloccat|sbloccato|ANOMALIA|errore|Error\" | cut -c1-300 || true
echo \"== certificato HTTPS dei webhook (atteso: Let s Encrypt, poi HTTP 404 a una GET)\"
curl -sS -o /dev/null -w \"HTTP %{http_code}\n\" https://gestione.gazzolaelia.it/webhooks/stripe || echo \"certificato non ancora pronto: riprova tra 2 minuti\"
"'
