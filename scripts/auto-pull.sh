#!/usr/bin/env bash
# Récupère origin/main toutes les 60 s ; abandonne proprement en cas de conflit.
# Version Linux / macOS de scripts/auto-pull.ps1, lancée par la tâche VS Code « Auto-pull origin/main ».
cd "$(dirname "$0")/.." || exit 1

while true; do
  git_dir="$(git rev-parse --git-dir 2>/dev/null)"
  # Rien à faire hors de main, ni pendant une fusion ou un rebase en cours.
  if [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] \
    && [ ! -d "$git_dir/rebase-merge" ] && [ ! -d "$git_dir/rebase-apply" ] && [ ! -f "$git_dir/MERGE_HEAD" ]; then
    git fetch --quiet origin 2>/dev/null
    behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
    if [ "$behind" -gt 0 ]; then
      if git pull --rebase --autostash --quiet origin main; then
        echo "[auto-pull] $(date +%H:%M:%S) : $behind commit(s) récupéré(s)"
      else
        git rebase --abort 2>/dev/null
        echo "[auto-pull] conflit : à résoudre à la main"
      fi
    fi
  fi
  sleep 60
done
