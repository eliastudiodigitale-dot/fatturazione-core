#!/usr/bin/env bash
# Seconda ricognizione, SOLA LETTURA: numeri già usati nella lista ClickUp "proforme e fatture",
# opzioni dei menu AREA e metodo-pag, campo "Chiave documento", come Traefik gestisce HTTPS, DNS.
# Non stampa segreti né nomi dei clienti: solo ID, numeri e conteggi.
# Dal Mac:
#   cd /Users/elia/offline/REPO-locali/fatturazione-core && ssh vps-se 'bash -s' < scripts/vps/ricognizione-2.sh 2>&1 | tee ~/ricognizione-2.txt
set -u
LISTA=901518874514
F_ANNO=9f151028-e075-474c-b81f-caea96e7bdcf
F_NRF=b6cc96f9-c1a3-4254-b04c-19ace0b93955
F_NRP=c728c9f3-10c2-4e05-8fcd-055a3d1a09a9
F_FF=5a271c02-0ddd-4d76-8f68-b8c007705558
F_FP=29fe2276-c5ee-4189-8c0c-f223a9b52c75
F_DDOC=f85f9bd7-a471-489e-a0ae-83072e96b645
F_DFAT=8a04a5bf-7819-4ef7-9f11-8dc287dd5945

echo "INIZIO ricognizione-2 $(date -Is)"
sez() { printf '\n===== %s =====\n' "$1"; }

sez "Traefik: come sono fatti gli ingress esistenti (api.gazzolaelia.it)"
kubectl -n platform get ingress api-ing api-ing-http -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}  annotazioni: {.metadata.annotations}{"\n"}  tls: {.spec.tls}{"\n"}{end}' 2>&1 | grep -v 'last-applied' | cut -c1-600
sez "Traefik: middleware e resolver dei certificati"
kubectl get middlewares.traefik.io -A 2>&1 | head -20
kubectl -n kube-system get deploy traefik -o jsonpath='{.spec.template.spec.containers[0].args}' 2>/dev/null | tr ',' '\n' | grep -iE 'certresolver|acme|entrypoints|redirect' | sed 's/"//g' | grep -viE 'email' | head -20
kubectl -n kube-system get helmchartconfig traefik -o jsonpath='{.spec.valuesContent}' 2>/dev/null | grep -iE 'certResolver|acme|storage|redirect|tls' | grep -viE 'email' | head -20

sez "DNS di gestione.gazzolaelia.it (atteso 185.229.239.205)"
getent hosts gestione.gazzolaelia.it || echo "NON RISOLVE: va creato il record DNS"
getent hosts api.gazzolaelia.it | head -1

sez "ClickUp: lista $LISTA"
T=$(kubectl -n archportal002 get secret archportal002-secrets -o jsonpath='{.data.CLICKUP_API_TOKEN}' | base64 -d)
cu() { curl -s --max-time 30 -H "Authorization: $T" "https://api.clickup.com/api/v2$1"; }
echo "-- campi (testo) e opzioni dei menu a tendina"
cu "/list/$LISTA/field" | jq -r '.fields[] | select(.type=="drop_down" or .type=="short_text" or .type=="text") | "CAMPO \(.id) \(.type) \(.name)" , (.type_config.options[]? | "    OPZIONE \(.id) \(.name)")'

D=$(mktemp -d); trap 'rm -rf "$D"; unset T' EXIT
for a in false true; do
  for p in $(seq 0 200); do
    cu "/list/$LISTA/task?include_closed=true&subtasks=true&archived=$a&page=$p" > "$D/p-$a-$p.json"
    n=$(jq '.tasks | length' "$D/p-$a-$p.json" 2>/dev/null || echo 0)
    last=$(jq -r '.last_page // true' "$D/p-$a-$p.json" 2>/dev/null || echo true)
    [ "$n" = 0 ] && break
    [ "$last" = true ] && break
  done
done
jq -s '[.[].tasks[]?]' "$D"/p-*.json > "$D/tutte.json"
echo "-- task lette: $(jq length "$D/tutte.json")  (archiviate comprese)"
echo "-- stati usati:"; jq -r '.[].status.status' "$D/tutte.json" | sort | uniq -c

jq -r --arg A "$F_ANNO" --arg NF "$F_NRF" --arg NP "$F_NRP" --arg FF "$F_FF" --arg FP "$F_FP" --arg DD "$F_DDOC" --arg DF "$F_DFAT" '
  def v($id): ([.custom_fields[]? | select(.id == $id) | .value] | first);
  def num: if . == null or . == "" then null else (tonumber? // null) end;
  def anno_da($x): if ($x|num) == null then null else (($x|num) / 1000 | strftime("%Y") | tonumber) end;
  .[] | . as $t
  | ((v($A) | num) // anno_da(v($DD)) // anno_da(v($DF))) as $anno
  | ( (if (v($NF)|num) != null then ["fattura", (v($NF)|num), ((v($FF)|tostring) == "true")] else empty end),
      (if (v($NP)|num) != null then ["proforma", (v($NP)|num), ((v($FP)|tostring) == "true")] else empty end) )
  | [ .[0], ($anno // "SENZA-ANNO"), .[1], (if .[2] then "spuntata" else "NON-spuntata" end), $t.status.status ] | @tsv
' "$D/tutte.json" > "$D/numeri.tsv"

echo "-- numeri per anno e tipo (solo checkbox spuntata): conteggio, minimo, massimo"
awk -F'\t' '$4=="spuntata"{k=$1" "$2; c[k]++; if(!(k in mn)||$3<mn[k])mn[k]=$3; if($3>mx[k])mx[k]=$3} END{for(k in c) printf "  %-22s n=%-4d min=%-4d max=%d\n", k, c[k], mn[k], mx[k]}' "$D/numeri.tsv" | sort
echo "-- numeri con checkbox NON spuntata (da controllare a mano):"
awk -F'\t' '$4!="spuntata"{print "  "$1" "$2" nr "$3" stato="$5}' "$D/numeri.tsv" | sort | head -40
echo "-- numeri SENZA anno né data (da controllare a mano):"
awk -F'\t' '$2=="SENZA-ANNO"{print "  "$1" nr "$3}' "$D/numeri.tsv" | head -40
echo "-- numeri DOPPI (stesso tipo, anno e numero su più task):"
awk -F'\t' '$4=="spuntata"{k=$1" "$2" nr "$3; c[k]++} END{for(k in c) if(c[k]>1) print "  "k" x"c[k]}' "$D/numeri.tsv" | sort
echo "-- buchi nella sequenza per anno/tipo (numeri mancanti tra 1 e il massimo):"
awk -F'\t' '$4=="spuntata" && $2!="SENZA-ANNO"{k=$1" "$2; s[k" "$3]=1; if($3>mx[k])mx[k]=$3} END{for(k in mx){m=""; for(i=1;i<=mx[k];i++) if(!((k" "i) in s)) m=m" "i; if(m!="") print "  "k":"m}}' "$D/numeri.tsv" | sort | cut -c1-300
echo; echo "FINE ricognizione-2"
