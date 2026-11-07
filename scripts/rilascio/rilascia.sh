#!/usr/bin/env bash
# Rilascio manuale di fatturazione-core (lo lancia solo Elia, dal Mac). Senza registry (decisione #23).
#   scripts/rilascio/rilascia.sh 0.1.0
# 1. test e build in locale  2. docker build per l'architettura del VPS  3. import in k3s via SSH
# 4. apply dei manifest con il tag scelto  5. attesa del rollout e lettura di /readyz
set -euo pipefail
cd "$(dirname "$0")/../.."
TAG="${1:-}"
[[ "$TAG" =~ ^0\.[0-9]+\.[0-9]+$ ]] || { echo "uso: rilascia.sh 0.X.Y"; exit 1; }
ARCH="${ARCH:-amd64}"   # [DA VERIFICARE] con la ricognizione (uname -m)

[ -z "$(git status --porcelain)" ] || { echo "ci sono modifiche non committate: STOP"; exit 1; }
echo "== test e build in locale"
npm ci --ignore-scripts >/dev/null
npm run -s typecheck
npm test
echo "== immagine fatturazione-core:$TAG (linux/$ARCH)"
docker build --platform "linux/$ARCH" -t "fatturazione-core:$TAG" .

echo "== import in k3s (chiede la passphrase SSH)"
docker save "fatturazione-core:$TAG" | gzip | ssh vps-se 'gunzip | sudo -n k3s ctr -n k8s.io images import -'

echo "== apply dei manifest"
{ sed "s|image: fatturazione-core:.*|image: fatturazione-core:$TAG|" k8s/app.yaml; echo '---'; cat k8s/networkpolicy.yaml; echo '---'; cat k8s/ingress.yaml; } \
  | ssh vps-se 'K=kubectl; $K get ns >/dev/null 2>&1 || K="sudo -n k3s kubectl"; $K apply -f - && $K -n platform rollout status deployment/fatturazione-core --timeout=180s && $K -n platform get --raw "/api/v1/namespaces/platform/services/fatturazione-core:http/proxy/readyz"; echo'
echo "== fatto. Se /readyz dice bloccato, guarda i log: scripts/rilascio/verifica.sh"
