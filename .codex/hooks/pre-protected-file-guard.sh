#!/usr/bin/env bash
# PreToolUse hook (Codex): block edits to protected config files.
# Protected files should not be modified to work around linter/formatter issues.
set -euo pipefail

input="$(cat)"
project_dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# shellcheck source=.codex/hooks/lib.sh
source "$project_dir/.codex/hooks/lib.sh"

protected=(
  lefthook.yml
  tsconfig.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  .oxfmtrc.json
  oxlint.config.ts
  .oxfmtignore
  .prettierignore
  .secretlintrc.json
  .textlintrc
  .textlintignore
  .env
)

while IFS= read -r file; do
  [ -n "$file" ] || continue
  for protected_file in "${protected[@]}"; do
    case "$file" in
      "$protected_file"|*/"$protected_file")
        echo "BLOCKED: $file is a protected config file. Fix the code, not the linter/formatter config." >&2
        exit 2
        ;;
    esac
  done
done < <(codex_collect_paths "$input")
