#!/usr/bin/env bash
# Stripe Tax si paga su ogni transazione con "imposte automatiche" accese. Nel forfettario non servono.
# Questo script trova (e, solo se richiesto, spegne) le imposte automatiche su abbonamenti e Payment Link.
#   scripts/stripe/tasse-automatiche.sh            -> ELENCA soltanto, non cambia nulla
#   scripts/stripe/tasse-automatiche.sh spegni     -> chiede conferma e spegne
# Chiave: una chiave RISTRETTA creata per l'occasione (Abbonamenti: Scrittura, Payment Link: Scrittura), da eliminare dopo,
# oppure la chiave di ORGANIZZAZIONE (sk_org_live_...): in quel caso si indicano gli account (acct_...) su cui agire,
# e ogni chiamata porta l'intestazione Stripe-Context con l'account.
# La chiave si digita (non si vede), non finisce negli argomenti dei comandi né nella history.
set -euo pipefail
MODO="${1:-elenca}"
command -v jq >/dev/null || { echo "serve jq"; exit 1; }
printf 'Chiave Stripe (rk_live_...): '; IFS= read -rs KEY; echo
ACCOUNTS=("")
if [[ "$KEY" =~ ^sk_org_(live|test)_ ]]; then
  echo "Chiave di organizzazione: indica gli account su cui agire."
  echo "  (Stripe -> in alto il nome dell'organizzazione -> Account: ogni account ha un ID acct_...)"
  printf 'ID account separati da spazio: '; read -r -a ACCOUNTS
  for a in "${ACCOUNTS[@]}"; do [[ "$a" =~ ^acct_[A-Za-z0-9]+$ ]] || { echo "ID account non valido: $a"; exit 1; }; done
  [ "${#ACCOUNTS[@]}" -gt 0 ] || { echo "nessun account"; exit 1; }
elif ! [[ "$KEY" =~ ^(rk|sk)_(live|test)_ ]]; then
  echo "chiave non valida (attese: rk_live_..., sk_live_... o sk_org_live_...)"; exit 1
fi
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
SUB=$(tutti "/subscriptions?status=all" | jq -c 'select(.automatic_tax.enabled == true and (.status | IN("active","trialing","past_due","unpaid","incomplete")))')
PL=$(tutti "/payment_links?active=true" | jq -c 'select(.automatic_tax.enabled == true)')
echo "== Abbonamenti con imposte automatiche accese: $(printf '%s' "$SUB" | grep -c . || true)"
printf '%s\n' "$SUB" | jq -r 'select(. != null) | "  \(.id)  stato=\(.status)  cliente=\(.customer)"' 2>/dev/null || true
echo "== Payment Link con imposte automatiche accese: $(printf '%s' "$PL" | grep -c . || true)"
printf '%s\n' "$PL" | jq -r 'select(. != null) | "  \(.id)  \(.url)"' 2>/dev/null || true
echo "Nota: i Checkout creati dal codice dei SaaS hanno l'opzione automatic_tax nel codice: va tolta lì (cerca \"automatic_tax\" nei repo dei SaaS)."

if [ "$MODO" != "spegni" ]; then continue; fi
printf '\nSpengo le imposte automatiche su tutto l elenco sopra? (scrivi SI) '; read -r R
[ "$R" = "SI" ] || { echo "saltato"; continue; }
for id in $(printf '%s\n' "$SUB" | jq -r 'select(. != null) | .id'); do
  r=$(api POST "/subscriptions/$id" -d "automatic_tax[enabled]=false"); echo "  $id -> automatic_tax=$(echo "$r" | jq -r '.automatic_tax.enabled // .error.message')"
done
for id in $(printf '%s\n' "$PL" | jq -r 'select(. != null) | .id'); do
  r=$(api POST "/payment_links/$id" -d "automatic_tax[enabled]=false"); echo "  $id -> automatic_tax=$(echo "$r" | jq -r '.automatic_tax.enabled // .error.message')"
done
done
if [ "$MODO" != "spegni" ]; then echo; echo "Solo elenco: nulla è stato cambiato. Per spegnere: scripts/stripe/tasse-automatiche.sh spegni"; fi
unset KEY
echo "Se hai creato una chiave apposta, ELIMINALA (Stripe -> Sviluppatori -> Chiavi API)."
