#!/usr/bin/env bash
input="$(cat)"
src="$(printf '%s' "$input" | jq -r '.source // ""' 2>/dev/null)"
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0
mkdir -p .claude/state
{
echo "## Contesto di avvio (hub)"
if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if git remote get-url origin >/dev/null 2>&1; then
    if GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=5" git fetch -q origin >/dev/null 2>&1; then
      if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
        echo "Rispetto a origin (aggiornato ora): avanti $(git rev-list --count '@{u}..HEAD'), indietro $(git rev-list --count 'HEAD..@{u}')"
      else
        echo "Branch senza upstream"
      fi
    else
      echo "Allineamento con origin: NON VERIFICATO (fetch non riuscito: chiave GitHub non caricata o rete assente)"
    fi
  fi
  echo "Ultimi commit:"
  git log --oneline -15 2>/dev/null
  changes="$(git status --short 2>/dev/null | head -15)"
  if [ -n "$changes" ]; then echo "Modifiche non committate:"; echo "$changes"; fi
fi
if [ "$src" = "startup" ] && [ -f .claude/state/open-session ]; then
  echo "ATTENZIONE: l'ultima sessione (aperta il $(cat .claude/state/open-session)) non risulta chiusa con /chiudi. Se non hai un'altra sessione aperta in questo repo, prima di iniziare invoca il subagent scrivano sul git log e su .claude/state/journal.log per recuperare STATO e decisioni."
fi
date '+%F %H:%M' > .claude/state/open-session
if [ -f docs/STATO.md ]; then echo "STATO.md modificato il $(stat -f %Sm -t %F docs/STATO.md)"; fi
if [ -f docs/VPS.md ]; then grep -m1 'Stato letto dal server il' docs/VPS.md; fi
if [ -f docs/deploy.manifest.md ]; then
  HUBD="${HUB_DIR:-$(cd .. 2>/dev/null && pwd)/_hub}"
  MAP="$HUBD/vps/VPS-MAP.md"
  age=99
  if [ -f "$MAP" ]; then
    age=$(( ( $(date +%s) - $(stat -f %m "$MAP") ) / 3600 ))
    echo "VPS (specchio in sola lettura, letto $age ore fa):"
    sed -n '/^## Avvisi/,/^## workloads/p' "$MAP" | sed '$d' | head -25
  else
    echo "VPS: nessuno specchio disponibile"
  fi
  if [ "$age" -ge 6 ] && [ -x "$HUBD/scripts/vps-sync.sh" ]; then
    mkdir -p "$HUBD/vps"
    find "$HUBD/vps/.lock" -maxdepth 0 -mmin +10 -exec rmdir {} \; 2>/dev/null
    if mkdir "$HUBD/vps/.lock" 2>/dev/null; then
      nohup bash -c '"$1" >/dev/null 2>&1; rmdir "$2"' _ "$HUBD/scripts/vps-sync.sh" "$HUBD/vps/.lock" >/dev/null 2>&1 &
      echo "Aggiornamento dello specchio VPS avviato in background."
    fi
  fi
fi
last="$(ls -1 docs/diario/*.md 2>/dev/null | sort | tail -3)"
if [ -n "$last" ]; then
  echo "Ultime note di diario:"
  for f in $last; do echo "--- $f"; head -n 12 "$f"; done
fi
} | head -c 6000
exit 0
