#!/usr/bin/env bash
# Ricognizione in SOLA LETTURA del VPS per fatturazione-core. Non modifica nulla e non stampa valori segreti.
# Uso dal Mac:  ssh vps-se 'bash -s' < scripts/vps/ricognizione.sh > ricognizione.txt
# Poi incolla ricognizione.txt nella sessione.
set -u

K=kubectl
if ! $K get ns >/dev/null 2>&1; then K="sudo -n k3s kubectl"; fi
if ! $K get ns >/dev/null 2>&1; then echo "ERRORE: kubectl non utilizzabile senza password (rilancia con: ssh -t vps-se, poi sudo -v, poi lo script)"; exit 1; fi

sez() { printf '\n===== %s =====\n' "$1"; }

sez "versioni"
$K version 2>/dev/null | head -3

sez "pod e label nel namespace platform"
$K -n platform get pods --show-labels -o wide 2>&1 | cut -c1-300

sez "ingress controller (kube-system)"
$K -n kube-system get pods --show-labels 2>&1 | grep -iE 'traefik|nginx|ingress|NAME' | cut -c1-300

sez "ingress esistenti (host e TLS)"
$K get ingress -A -o custom-columns='NS:.metadata.namespace,NOME:.metadata.name,CLASSE:.spec.ingressClassName,HOST:.spec.rules[*].host,TLS:.spec.tls[*].secretName' 2>&1

sez "cert-manager"
$K get clusterissuer 2>&1 | head; $K get certificate -A 2>&1 | head -20

sez "SSL di services-postgres"
PGPOD=$($K -n platform get pods -o name 2>/dev/null | grep -m1 services-postgres)
echo "pod: ${PGPOD:-NON TROVATO}"
[ -n "${PGPOD:-}" ] && $K -n platform exec "$PGPOD" -- psql -U services -d postgres -Atc "select 'ssl=' || current_setting('ssl')" 2>&1

sez "NetworkPolicy esistenti"
$K get networkpolicy -A 2>&1

sez "Secret con 'clickup' nel nome o nelle chiavi (solo NOMI, mai valori)"
TROVATO=""
while read -r ns nome; do
  chiavi=$($K -n "$ns" get secret "$nome" -o go-template='{{range $k,$v := .data}}{{$k}} {{end}}' 2>/dev/null)
  if echo "$nome $chiavi" | grep -qi clickup; then
    echo "$ns/$nome: $chiavi"
    for c in $chiavi; do echo "$c" | grep -qi clickup && [ -z "$TROVATO" ] && TROVATO="$ns $nome $c"; done
  fi
done < <($K get secrets -A --no-headers -o custom-columns=NS:.metadata.namespace,NOME:.metadata.name 2>/dev/null)

sez "ClickUp: workspace, spazi, cartelle, liste e campi custom (con il token trovato, mai stampato)"
if [ -z "$TROVATO" ]; then
  echo "nessun secret ClickUp trovato: cercare il token nelle credenziali di n8n (dall'interfaccia n8n)"
else
  set -- $TROVATO
  echo "uso: $1/$2 chiave $3"
  T=$($K -n "$1" get secret "$2" -o jsonpath="{.data.$3}" | base64 -d)
  cu() { curl -s --max-time 20 -H "Authorization: $T" "https://api.clickup.com/api/v2$1"; }
  if ! command -v jq >/dev/null; then echo "jq non installato: output grezzo"; cu /team | head -c 3000; else
    for team in $(cu /team | jq -r '.teams[].id'); do
      echo "WORKSPACE $team"
      for sp in $(cu "/team/$team/space?archived=false" | jq -r '.spaces[].id'); do
        echo "  SPAZIO $sp $(cu "/space/$sp" | jq -r .name)"
        cu "/space/$sp/list?archived=false" | jq -r '.lists[] | "    LISTA \(.id) \(.name)"'
        for fo in $(cu "/space/$sp/folder?archived=false" | jq -r '.folders[].id'); do
          cu "/folder/$fo" | jq -r '"    CARTELLA \(.id) \(.name)"'
          cu "/folder/$fo/list?archived=false" | jq -r '.lists[] | "      LISTA \(.id) \(.name)"'
        done
      done
    done
    echo
    echo "Campi custom delle liste che contengono fatt/prof/doc nel nome:"
    for team in $(cu /team | jq -r '.teams[].id'); do
      for sp in $(cu "/team/$team/space?archived=false" | jq -r '.spaces[].id'); do
        { cu "/space/$sp/list?archived=false" | jq -r '.lists[] | "\(.id) \(.name)"'
          for fo in $(cu "/space/$sp/folder?archived=false" | jq -r '.folders[].id'); do cu "/folder/$fo/list?archived=false" | jq -r '.lists[] | "\(.id) \(.name)"'; done
        } | grep -iE 'fatt|prof|doc' | while read -r lid lnome; do
          echo "  LISTA $lid $lnome"
          cu "/list/$lid/field" | jq -r '.fields[] | "    CAMPO \(.id) \(.type) \(.name)"'
        done
      done
    done
    echo
    echo "Limite richieste: $(curl -s -o /dev/null -D - --max-time 20 -H "Authorization: $T" https://api.clickup.com/api/v2/team | grep -i 'x-ratelimit-limit' | tr -d '\r')"
  fi
  unset T
fi
echo; echo "FINE ricognizione"
