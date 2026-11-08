#!/usr/bin/env bash
# Perché è fallita la copia del backup fuori VPS? SOLA LETTURA: ultimi Job del CronJob offsite, i loro log e gli eventi.
# I log di rclone non contengono chiavi (le password arrivano da variabili d'ambiente). Dal Mac:
#   scripts/rilascio/log-backup.sh
set -euo pipefail
ssh vps-se 'bash -s' <<'EOF'
echo "== Job della copia offsite"
kubectl -n platform get jobs -l batch.kubernetes.io/cronjob-name=fatturazione-backup-offsite 2>/dev/null \
  || kubectl -n platform get jobs | grep -E 'NAME|offsite'
echo "== dump presenti nel backup locale (ultimi 3)"
kubectl -n platform get jobs -o name | grep 'fatturazione-backup-[0-9]' | tail -1 | xargs -r -I{} kubectl -n platform logs {} --tail=5 2>/dev/null || true
for p in $(kubectl -n platform get pods -o name | grep fatturazione-backup-offsite | tail -2); do
  echo "== log di $p"
  kubectl -n platform logs "$p" --tail=40 2>&1 | cut -c1-300
  echo "-- stato"
  kubectl -n platform get "$p" -o jsonpath='{.status.containerStatuses[0].state}{"\n"}' 2>/dev/null
done
echo "== eventi recenti"
kubectl -n platform get events --sort-by=.lastTimestamp 2>/dev/null | grep -i offsite | tail -10
EOF
