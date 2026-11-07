#!/usr/bin/env bash
# Stato di fatturazione-core sul VPS, in sola lettura. Dal Mac:  scripts/rilascio/verifica.sh
# Mostra pod, readiness, riepilogo (con il token dashboard letto sul VPS, mai stampato) e le ultime anomalie.
set -euo pipefail
ssh vps-se 'bash -s' <<'EOF'
K=kubectl; $K get ns >/dev/null 2>&1 || K="sudo -n k3s kubectl"
echo "== pod"; $K -n platform get pods -l app=fatturazione-core -o wide
echo "== readyz"; $K -n platform get --raw "/api/v1/namespaces/platform/services/fatturazione-core:http/proxy/readyz" || true; echo
echo "== ultime anomalie (24h)"; $K -n platform logs deployment/fatturazione-core --since=24h 2>/dev/null | grep ANOMALIA | tail -20 || true
echo "== errori (24h)"; $K -n platform logs deployment/fatturazione-core --since=24h 2>/dev/null | grep '"level":50' | tail -10 || true
EOF
