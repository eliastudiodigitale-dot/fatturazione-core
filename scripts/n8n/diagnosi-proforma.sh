#!/usr/bin/env bash
# Perché il flusso n8n "auto_pro-forma (servizio fatturazione)" non genera la proforma? SOLA LETTURA.
# Controlla: il servizio è raggiungibile da n8n? il servizio ha ricevuto richieste (e con che esito)? n8n ha errori recenti?
# Non stampa mai token né valori dei Secret. Dal Mac:
#   /Users/elia/offline/REPO-locali/fatturazione-core/scripts/n8n/diagnosi-proforma.sh
set -euo pipefail
ssh vps-se 'bash -s' <<'REMOTO'
echo "== pod n8n e servizio"
kubectl get pods -A -l app=n8n -o wide 2>&1 | cut -c1-200
kubectl -n platform get pods -l app=fatturazione-core 2>&1 | cut -c1-200
NS=$(kubectl get pods -A -l app=n8n -o jsonpath='{.items[0].metadata.namespace}' 2>/dev/null)
POD=$(kubectl get pods -A -l app=n8n -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
echo
echo "== n8n raggiunge il servizio? (GET /readyz, senza token)"
kubectl -n "$NS" exec "$POD" -- wget -qO- -T 5 http://fatturazione-core.platform.svc.cluster.local:8080/readyz 2>&1 | cut -c1-200 || echo "NON RAGGIUNGIBILE (rete, NetworkPolicy o nome)"
echo
echo "== richieste ricevute dal servizio nelle ultime 24 ore (/v1/...)"
kubectl -n platform logs deploy/fatturazione-core --since=24h 2>&1 | grep '/v1/' | cut -c1-260 | tail -25 || true
echo "-- (se vuoto: il servizio non ha ricevuto nulla da n8n)"
echo
echo "== ultimi errori/avvisi del servizio"
kubectl -n platform logs deploy/fatturazione-core --since=24h 2>&1 | grep -iE '"level":(40|50)|warn|error|401|403|blocc' | cut -c1-260 | tail -15 || true
echo
echo "== errori recenti nei log di n8n"
kubectl -n "$NS" logs "$POD" --since=24h 2>&1 | grep -iE 'proforma|fatturazione|credential|ECONN|ENOTFOUND|timeout|error' | cut -c1-260 | tail -25 || true
REMOTO
