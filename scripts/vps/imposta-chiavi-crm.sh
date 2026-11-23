#!/usr/bin/env bash
# Aggiunge nel Secret fatturazione-api-secrets le chiavi di ticketing e dashboard (decisione #45) e riavvia il servizio.
# Lo lancia ELIA. Ogni valore si digita (non si vede) e non finisce negli argomenti dei comandi né sullo schermo.
# Le altre chiavi del Secret restano uguali. Se premi solo Invio:
#   - DASHBOARD_SESSION_SECRET: il valore viene generato a caso sul server (non serve conoscerlo);
#   - KEYCLOAK_CLIENT_SECRET e i TICKET_TOKEN_*: la chiave viene saltata e resta com'è.
# I TICKET_TOKEN_* vanno copiati ANCHE nella configurazione della fonte che li usa (backend heyciar, bot serrandasu, sito reti).
# Per generarne uno senza vederlo, sul Mac:   openssl rand -hex 32 | pbcopy     (poi incolli qui e nella fonte)
#
# Dal Mac (un solo comando):
#   cd /Users/elia/offline/REPO-locali/fatturazione-core && scp scripts/vps/imposta-chiavi-crm.sh vps-se:/tmp/imposta-chiavi-crm.sh && ssh -t vps-se 'bash /tmp/imposta-chiavi-crm.sh; rm -f /tmp/imposta-chiavi-crm.sh'
set -euo pipefail
umask 077
# TICKET_TOKEN_*: le fonti usano questi per chiamare il servizio. TICKET_BACKEND_TOKEN_*: il servizio li usa per chiamare il backend di ogni business
# (vanno prima creati lato backend del business, che li deve riconoscere).
CHIAVI=(TICKET_TOKEN_HEYCIAR TICKET_TOKEN_SERRANDASU TICKET_TOKEN_RETI TICKET_BACKEND_TOKEN_HEYCIAR TICKET_BACKEND_TOKEN_SERRANDASU TICKET_BACKEND_TOKEN_RETI KEYCLOAK_CLIENT_SECRET DASHBOARD_SESSION_SECRET)
F=$(mktemp); trap 'rm -f "$F"; unset V' EXIT
PARTI=""
for NOME in "${CHIAVI[@]}"; do
  printf 'Valore per %s (non si vede, Invio = salta%s): ' "$NOME" "$([ "$NOME" = DASHBOARD_SESSION_SECRET ] && echo ' e genera a caso')"; IFS= read -rs V; echo
  if [ -z "$V" ]; then
    if [ "$NOME" = DASHBOARD_SESSION_SECRET ]; then V=$(openssl rand -hex 32); else echo "  saltata: $NOME"; continue; fi
  fi
  case "$NOME" in
    TICKET_TOKEN_*|TICKET_BACKEND_TOKEN_*|DASHBOARD_SESSION_SECRET) [ "${#V}" -ge 32 ] || { echo "$NOME: servono almeno 32 caratteri, annullato"; exit 1; } ;;
  esac
  [ -n "$PARTI" ] && PARTI="$PARTI,"
  PARTI="$PARTI\"$NOME\":\"$(printf '%s' "$V" | base64 | tr -d '\n')\""
  echo "  impostata: $NOME"
done
[ -n "$PARTI" ] || { echo "nessuna chiave impostata: nulla da fare"; exit 0; }
printf '{"data":{%s}}' "$PARTI" > "$F"
kubectl -n platform patch secret fatturazione-api-secrets --type merge --patch-file "$F"
echo "Chiavi salvate nel Secret. Il servizio NON è stato riavviato: lo riavvia il rilascio (o, se è già la versione con CRM, kubectl -n platform rollout restart deployment/fatturazione-core)."
