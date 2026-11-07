#!/usr/bin/env bash
# Rilascio manuale di fatturazione-core (lo lancia solo Elia, dal Mac). Senza registry (decisione #23).
#   scripts/rilascio/rilascia.sh 0.1.0
# 1. test e build in locale  2. docker build per l'architettura del VPS  3. import in k3s via SSH
# 4. apply dei manifest con il tag scelto  5. attesa del rollout e lettura di /readyz
set -euo pipefail
cd "$(dirname "$0")/../.."
TAG="${1:-}"
[[ "$TAG" =~ ^0\.[0-9]+\.[0-9]+$ ]] || { echo "uso: rilascia.sh 0.X.Y"; exit 1; }
ARCH="${ARCH:-amd64}"   # VPS x86_64 (ricognizione del 2026-11-07)

[ -z "$(git status --porcelain)" ] || { echo "ci sono modifiche non committate: STOP"; exit 1; }
echo "== test e build in locale"
npm ci --ignore-scripts >/dev/null
npm run -s typecheck
npm test
echo "== immagine fatturazione-core:$TAG (linux/$ARCH)"
docker build --platform "linux/$ARCH" -t "fatturazione-core:$TAG" .

echo "== invio dell'immagine al VPS (passphrase SSH)"
docker save "fatturazione-core:$TAG" | gzip | ssh vps-se "umask 077; cat > /tmp/fatturazione-core-$TAG.tar.gz"
echo "== import in k3s (passphrase SSH, poi la password di sudo di elia: sul VPS sudo la chiede sempre)"
ssh -t vps-se "sudo -v && gunzip -c /tmp/fatturazione-core-$TAG.tar.gz | sudo k3s ctr -n k8s.io images import - ; rm -f /tmp/fatturazione-core-$TAG.tar.gz"

echo "== apply dei manifest"
{ sed "s|image: fatturazione-core:.*|image: fatturazione-core:$TAG|" k8s/app.yaml; echo '---'; cat k8s/networkpolicy.yaml; echo '---'; cat k8s/ingress.yaml; } \
  | ssh vps-se 'kubectl apply -f - && kubectl -n platform rollout status deployment/fatturazione-core --timeout=180s && kubectl -n platform get --raw "/api/v1/namespaces/platform/services/fatturazione-core:http/proxy/readyz"; echo'
echo "== fatto. Se /readyz dice bloccato, guarda i log: scripts/rilascio/verifica.sh"
