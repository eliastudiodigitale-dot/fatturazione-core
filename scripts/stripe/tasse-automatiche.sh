#!/usr/bin/env bash
# Stripe Tax si paga su ogni transazione con "imposte automatiche" accese. Nel forfettario non servono.
# Questo script trova (e, solo se richiesto, spegne) le imposte automatiche su abbonamenti e Payment Link.
#   scripts/stripe/tasse-automatiche.sh            -> ELENCA soltanto, non cambia nulla
#   scripts/stripe/tasse-automatiche.sh spegni     -> chiede conferma e spegne
# Chiave: una chiave RISTRETTA creata per l'occasione (Abbonamenti: Scrittura, Payment Link: Scrittura), da eliminare dopo.
# La chiave si digita (non si vede), non finisce negli argomenti dei comandi né nella history.
set -euo pipefail
MODO="${1:-elenca}"
command -v jq >/dev/null || { echo "serve jq"; exit 1; }
printf 'Chiave Stripe (rk_live_...): '; IFS= read -rs KEY; echo
[[ "$KEY" =~ ^(rk|sk)_(live|test)_ ]] || { echo "chiave non valida"; exit 1; }
api() { # metodo, percorso, [dati...]
  local m="$1" p="$2"; shift 2
  printf 'user = "%s:"\n' "$KEY" | curl -sS --config - -X "$m" "https://api.stripe.com/v1$p" "$@"
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
SUB=$(tutti "/subscriptions?status=all" | jq -c 'select(.automatic_tax.enabled == true and (.status | IN("active","trialing","past_due","unpaid","incomplete")))')
PL=$(tutti "/payment_links?active=true" | jq -c 'select(.automatic_tax.enabled == true)')
echo "== Abbonamenti con imposte automatiche accese: $(printf '%s' "$SUB" | grep -c . || true)"
printf '%s\n' "$SUB" | jq -r 'select(. != null) | "  \(.id)  stato=\(.status)  cliente=\(.customer)"' 2>/dev/null || true
echo "== Payment Link con imposte automatiche accese: $(printf '%s' "$PL" | grep -c . || true)"
printf '%s\n' "$PL" | jq -r 'select(. != null) | "  \(.id)  \(.url)"' 2>/dev/null || true
echo "Nota: i Checkout creati dal codice dei SaaS hanno l'opzione automatic_tax nel codice: va tolta lì (cerca \"automatic_tax\" nei repo dei SaaS)."

if [ "$MODO" != "spegni" ]; then echo; echo "Solo elenco: nulla è stato cambiato. Per spegnere: scripts/stripe/tasse-automatiche.sh spegni"; exit 0; fi
printf '\nSpengo le imposte automatiche su tutto l elenco sopra? (scrivi SI) '; read -r R
[ "$R" = "SI" ] || { echo "annullato"; exit 1; }
for id in $(printf '%s\n' "$SUB" | jq -r 'select(. != null) | .id'); do
  r=$(api POST "/subscriptions/$id" -d "automatic_tax[enabled]=false"); echo "  $id -> automatic_tax=$(echo "$r" | jq -r '.automatic_tax.enabled // .error.message')"
done
for id in $(printf '%s\n' "$PL" | jq -r 'select(. != null) | .id'); do
  r=$(api POST "/payment_links/$id" -d "automatic_tax[enabled]=false"); echo "  $id -> automatic_tax=$(echo "$r" | jq -r '.automatic_tax.enabled // .error.message')"
done
unset KEY
echo "Fatto. Ricordati di ELIMINARE la chiave ristretta usata (Stripe -> Sviluppatori -> Chiavi API)."
