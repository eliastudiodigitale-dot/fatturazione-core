#!/usr/bin/env bash
# Stripe Tax si paga su ogni transazione con "imposte automatiche" accese. Nel forfettario non servono.
# Questo script trova (e, solo se richiesto, spegne) le imposte automatiche su abbonamenti e Payment Link.
#   scripts/stripe/tasse-automatiche.sh            -> ELENCA soltanto, non cambia nulla
#   scripts/stripe/tasse-automatiche.sh spegni     -> chiede conferma e spegne
# Elenco: basta la chiave del servizio (organizzazione, sola lettura); ogni chiamata porta Stripe-Context con l'account.
# Spegnimento: serve una chiave temporanea con scrittura su Abbonamenti e Payment Link (CHIAVE_A_MANO=1), da eliminare dopo.
# La chiave: per default quella del servizio, letta dal Secret sul VPS (serve la passphrase SSH); con CHIAVE_A_MANO=1 si digita.
# Non viene mai mostrata e non finisce negli argomenti dei comandi né nella history.
set -euo pipefail
MODO="${1:-elenca}"
command -v jq >/dev/null || { echo "serve jq"; exit 1; }
if [ "${CHIAVE_A_MANO:-}" = 1 ]; then
  printf 'Chiave Stripe (rk_live_...): '; IFS= read -rs KEY; echo
else
  # Predefinito: la chiave del servizio, letta dal Secret sul VPS. Resta in una variabile, non viene mai mostrata.
  echo "Leggo la chiave Stripe del servizio dal VPS (non viene mostrata). Per digitarla a mano: CHIAVE_A_MANO=1"
  KEY=$(ssh vps-se "kubectl -n platform get secret fatturazione-api-secrets -o jsonpath='{.data.STRIPE_API_KEY}' | base64 -d")
  [ -n "$KEY" ] || { echo "chiave non trovata nel Secret"; exit 1; }
fi
ACCOUNTS=("")
if [[ "$KEY" =~ ^sk_org_(live|test)_ ]]; then
  # Account: quelli della configurazione del servizio (STRIPE_BUSINESS_PER_ACCOUNT in k8s/app.yaml)
  CONF="$(dirname "$0")/../../k8s/app.yaml"
  GREZZI=($(grep -E '^\s*STRIPE_BUSINESS_PER_ACCOUNT:' "$CONF" 2>/dev/null | grep -oE 'acct_[A-Za-z0-9]+' || true))
  if [ "${#GREZZI[@]}" -gt 0 ]; then
    echo "Account dalla configurazione del servizio: ${GREZZI[*]}"
  else
    echo "Chiave di organizzazione: indica gli account su cui agire."
    printf 'ID account separati da spazio (anche nella forma attività=acct_...): '; read -r -a GREZZI
  fi
  ACCOUNTS=()
  for a in "${GREZZI[@]}"; do
    a="${a##*=}"  # "serrandasu.it=acct_..." -> "acct_..."
    [[ "$a" =~ ^acct_[A-Za-z0-9]+$ ]] || { echo "ID account non valido: $a (atteso acct_...)"; exit 1; }
    ACCOUNTS+=("$a")
  done
  [ "${#ACCOUNTS[@]}" -gt 0 ] || { echo "nessun account"; exit 1; }
elif ! [[ "$KEY" =~ ^(rk|sk)_(live|test)_ ]]; then
  echo "chiave non valida (attese: rk_live_..., sk_live_... o sk_org_live_...)"; exit 1
fi
conta() { [ "$1" = NON-VERIFICATO ] && echo "NON VERIFICATO (manca il permesso di lettura)" || { printf '%s' "$1" | grep -c . || true; }; }
CTX=""
api() { # metodo, percorso, [dati...]
  local m="$1" p="$2"; shift 2
  # Stripe-Version: obbligatoria con le chiavi di organizzazione; la stessa versione della libreria del servizio.
  { printf 'user = "%s:"\n' "$KEY"; printf 'header = "Stripe-Version: 2026-10-28.endive"\n'; [ -n "$CTX" ] && printf 'header = "Stripe-Context: %s"\n' "$CTX"; } \
    | curl -sS --config - -X "$m" "https://api.stripe.com/v1$p" "$@"
}
tutti() { # percorso base con parametri -> stampa gli oggetti uno per riga
  local base="$1" dopo="" r
  while :; do
    r=$(api GET "$base&limit=100${dopo:+&starting_after=$dopo}")
    if [ "$(echo "$r" | jq -r '.error.message // empty')" != "" ]; then echo "ERRORE Stripe: $(echo "$r" | jq -r .error.message)" >&2; exit 1; fi
    echo "$r" | jq -c '.data[]'
    [ "$(echo "$r" | jq -r .has_more)" = true ] || break
    dopo=$(echo "$r" | jq -r '.data[-1].id')
  done
}
for CTX in "${ACCOUNTS[@]}"; do
[ -n "$CTX" ] && echo && echo "######## account $CTX"
SUB=$(tutti "/subscriptions?status=all" | jq -c 'select(.automatic_tax.enabled == true and (.status | IN("active","trialing","past_due","unpaid","incomplete")))') \
  || { echo "  (abbonamenti non leggibili con questa chiave su questo account: salto)"; SUB="NON-VERIFICATO"; }
PL=$(tutti "/payment_links?active=true" | jq -c 'select(.automatic_tax.enabled == true)') \
  || { echo "  (Payment Link non leggibili con questa chiave su questo account: salto)"; PL="NON-VERIFICATO"; }
echo "== Abbonamenti con imposte automatiche accese: $(conta "$SUB")"
printf '%s\n' "$SUB" | jq -r 'select(. != null) | "  \(.id)  stato=\(.status)  cliente=\(.customer)"' 2>/dev/null || true
echo "== Payment Link con imposte automatiche accese: $(conta "$PL")"
printf '%s\n' "$PL" | jq -r 'select(. != null) | "  \(.id)  \(.url)"' 2>/dev/null || true
DAL=$(( $(date +%s) - 30*86400 ))
CS=$(tutti "/checkout/sessions?created%5Bgte%5D=$DAL" | jq -c 'select(.automatic_tax.enabled == true)') \
  || { echo "  (Checkout non leggibili con questa chiave: salto)"; CS="NON-VERIFICATO"; }
INV=$(tutti "/invoices?created%5Bgte%5D=$DAL" | jq -c 'select(.automatic_tax.enabled == true)') \
  || { echo "  (fatture Stripe non leggibili con questa chiave: salto)"; INV="NON-VERIFICATO"; }
echo "== Ultimi 30 giorni, Checkout con imposte automatiche: $(conta "$CS")  (vengono dal codice dei SaaS: l'opzione automatic_tax va tolta lì)"
printf '%s\n' "$CS" | jq -r 'select(. != null) | "  \(.id)  \(.created | todate)  \(.success_url // "" | split("?")[0])"' 2>/dev/null | head -10 || true
echo "== Ultimi 30 giorni, fatture Stripe con imposte automatiche: $(conta "$INV")"
printf '%s\n' "$INV" | jq -r 'select(. != null) | "  \(.id)  \(.created | todate)  abbonamento=\(.subscription // .parent.subscription_details.subscription // "-")"' 2>/dev/null | head -10 || true

if [ "$MODO" != "spegni" ]; then continue; fi
printf '\nSpengo le imposte automatiche su tutto l elenco sopra? (scrivi SI) '; read -r R
[ "$R" = "SI" ] || { echo "saltato"; continue; }
[ "$SUB" = NON-VERIFICATO ] && SUB=""; [ "$PL" = NON-VERIFICATO ] && PL=""
for id in $(printf '%s\n' "$SUB" | jq -r 'select(. != null) | .id'); do
  r=$(api POST "/subscriptions/$id" -d "automatic_tax[enabled]=false"); echo "  $id -> automatic_tax=$(echo "$r" | jq -r '.automatic_tax.enabled // .error.message')"
done
for id in $(printf '%s\n' "$PL" | jq -r 'select(. != null) | .id'); do
  r=$(api POST "/payment_links/$id" -d "automatic_tax[enabled]=false"); echo "  $id -> automatic_tax=$(echo "$r" | jq -r '.automatic_tax.enabled // .error.message')"
done
done
if [ "$MODO" != "spegni" ]; then echo; echo "Solo elenco: nulla è stato cambiato. Per spegnere: scripts/stripe/tasse-automatiche.sh spegni"; fi
unset KEY
[ "${CHIAVE_A_MANO:-}" = 1 ] && echo "Se hai creato una chiave apposta, ELIMINALA (Stripe -> Sviluppatori -> Chiavi API)."
exit 0
