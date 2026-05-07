#!/usr/bin/env bash
# PostToolUse hook (Codex): run oxfmt/oxlint on edited TypeScript-family files.
set -euo pipefail

input="$(cat)"
project_dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# shellcheck source=.codex/hooks/lib.sh
source "$project_dir/.codex/hooks/lib.sh"
project_dir="$(codex_project_dir "$input")"
cd "$project_dir"

targets=()
while IFS= read -r file; do
  targets+=("$file")
done < <(codex_unique_existing_targets "$input" .ts .tsx .js .jsx .vue)

[ "${#targets[@]}" -eq 0 ] && exit 0

pnpm format "${targets[@]}" >/dev/null 2>&1 || true
pnpm lint:fix "${targets[@]}" >/dev/null 2>&1 || true

diag=""
if ! lint_out="$(pnpm lint "${targets[@]}" 2>&1 | head -80)"; then
  diag="${diag:+$diag$'\n'}$lint_out"
fi

if [ -n "$diag" ]; then
  jq -Rn --arg msg "$diag" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $msg
    }
  }'
fi
