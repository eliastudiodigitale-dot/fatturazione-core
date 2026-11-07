#!/usr/bin/env bash
cat >/dev/null
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0
mkdir -p .claude/state
{
  printf '%s | ' "$(date '+%F %T')"
  printf '%s ' "$(git rev-parse --short HEAD 2>/dev/null)"
  git diff --shortstat 2>/dev/null
  echo
} >> .claude/state/journal.log
if [ "$(wc -l < .claude/state/journal.log)" -gt 400 ]; then
  tail -n 300 .claude/state/journal.log > .claude/state/journal.tmp && mv .claude/state/journal.tmp .claude/state/journal.log
fi
exit 0
