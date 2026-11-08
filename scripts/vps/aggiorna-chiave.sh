#!/usr/bin/env bash
# Sostituisce UNA sola chiave nel Secret fatturazione-api-secrets (le altre, compresi i token di n8n, restano uguali)
# e riavvia il servizio. Lo lancia ELIA. Il valore si digita (non si vede) e non finisce negli argomenti dei comandi.
# Dal Mac:
#   scp scripts/vps/aggiorna-chiave.sh vps-se:/tmp/aggiorna-chiave.sh && ssh -t vps-se 'bash /tmp/aggiorna-chiave.sh STRIPE_API_KEY; rm -f /tmp/aggiorna-chiave.sh'
set -euo pipefail
umask 077
NOME="${1:-}"
case "$NOME" in
  STRIPE_API_KEY|STRIPE_WEBHOOK_SECRET|GC_API_TOKEN|GC_WEBHOOK_SECRET|CLICKUP_TOKEN|TELEGRAM_BOT_TOKEN) ;;
  *) echo "uso: aggiorna-chiave.sh STRIPE_API_KEY|STRIPE_WEBHOOK_SECRET|GC_API_TOKEN|GC_WEBHOOK_SECRET|CLICKUP_TOKEN|TELEGRAM_BOT_TOKEN"; exit 1 ;;
esac
printf 'Nuovo valore per %s (non si vede): ' "$NOME"; IFS= read -rs V; echo
[ -n "$V" ] || { echo "vuoto: annullato"; exit 1; }
if [ "$NOME" = STRIPE_API_KEY ] && ! [[ "$V" =~ ^(rk|sk)_(org_)?live_ ]]; then echo "non sembra una chiave Stripe live: annullato"; exit 1; fi
F=$(mktemp); trap 'rm -f "$F"; unset V' EXIT
printf '{"data":{"%s":"%s"}}' "$NOME" "$(printf '%s' "$V" | base64 | tr -d '\n')" > "$F"
kubectl -n platform patch secret fatturazione-api-secrets --type merge --patch-file "$F"
kubectl -n platform rollout restart deployment/fatturazione-core
kubectl -n platform rollout status deployment/fatturazione-core --timeout=180s
kubectl -n platform get --raw /api/v1/namespaces/platform/services/fatturazione-core:http/proxy/readyz; echo
echo "Fatto: $NOME sostituita, servizio riavviato."
