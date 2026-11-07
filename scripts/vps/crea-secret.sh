#!/usr/bin/env bash
# Crea/aggiorna i Secret di fatturazione-core sul VPS. Lo lancia ELIA, in modo interattivo.
# I valori si digitano (non compaiono a schermo), non finiscono negli argomenti dei processi né nella history.
#
# Dal Mac:
#   scp scripts/vps/crea-secret.sh vps-se:/tmp/crea-secret.sh && ssh -t vps-se 'bash /tmp/crea-secret.sh api; rm -f /tmp/crea-secret.sh'
#   (oppure "offsite" al posto di "api" per il backup su Backblaze)
#
# api:     fatturazione-api-secrets  (token delle chiamate + chiavi Stripe/GoCardless/ClickUp/Telegram)
# offsite: fatturazione-offsite-secrets (Backblaze B2 + password di cifratura)
# Un campo lasciato vuoto non viene scritto (il servizio tiene spenta quella parte).
set -euo pipefail
umask 077

K=kubectl
if ! $K get ns >/dev/null 2>&1; then K="sudo k3s kubectl"; fi

TIPO="${1:-}"
case "$TIPO" in
  api) NOME=fatturazione-api-secrets ;;
  offsite) NOME=fatturazione-offsite-secrets ;;
  *) echo "uso: crea-secret.sh api|offsite"; exit 1 ;;
esac

if $K -n platform get secret "$NOME" >/dev/null 2>&1; then
  printf 'Il secret %s esiste già. Sovrascriverlo? (scrivi SI) ' "$NOME"; read -r R
  [ "$R" = "SI" ] || { echo "annullato"; exit 1; }
fi

F=$(mktemp)
trap 'rm -f "$F"' EXIT

chiedi() { # nome, descrizione
  local v
  printf '%s\n  %s: ' "$1" "$2"
  IFS= read -rs v; echo
  [ -n "$v" ] && printf '%s=%s\n' "$1" "$v" >> "$F"
  return 0
}

if [ "$TIPO" = api ]; then
  for n in N8N_TOKEN DASHBOARD_TOKEN OWNER_TOKEN; do printf '%s=%s\n' "$n" "$(openssl rand -hex 32)" >> "$F"; done
  echo "Token N8N/DASHBOARD/OWNER generati (64 caratteri casuali ciascuno)."
  echo "Ora incolla le chiavi dei servizi. Invio a vuoto = salta."
  chiedi STRIPE_WEBHOOK_SECRET "Stripe > Developers > Webhooks > endpoint > Signing secret (whsec_...)"
  chiedi STRIPE_API_KEY "Stripe > chiave RISTRETTA in sola lettura (rk_live_...)"
  chiedi GC_WEBHOOK_SECRET "GoCardless > Developers > Webhook endpoint > Secret"
  chiedi GC_API_TOKEN "GoCardless > Developers > Access token in sola lettura"
  chiedi CLICKUP_TOKEN "ClickUp > token personale del bot (pk_...)"
  chiedi TELEGRAM_BOT_TOKEN "Telegram > token dato da @BotFather"
else
  chiedi B2_ACCOUNT_ID "Backblaze > Application Key > keyID"
  chiedi B2_APP_KEY "Backblaze > Application Key > applicationKey"
  chiedi B2_BUCKET "Backblaze > nome del bucket (es. fatturazione-backup-elia)"
  chiedi CRYPT_PASSWORD "Password di cifratura 1 (salvala nel password manager: senza, i backup sono illeggibili)"
  chiedi CRYPT_SALT "Password di cifratura 2 (idem)"
fi

$K -n platform create secret generic "$NOME" --from-env-file="$F" --dry-run=client -o yaml | $K apply -f -
echo
echo "Fatto: $NOME. Chiavi scritte:"
cut -d= -f1 "$F" | sed 's/^/  - /'
