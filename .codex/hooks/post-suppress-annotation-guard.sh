#!/usr/bin/env bash
# PostToolUse hook (Codex): forbid TypeScript/JavaScript suppressions in source.
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

pattern='@(ts-ignore|ts-expect-error|ts-nocheck)|eslint-disable|oxlint-disable|biome-ignore|prettier-ignore'
aggregated=""

for file in "${targets[@]}"; do
  if matches="$(grep -nE "$pattern" "$file" 2>/dev/null)"; then
    msg="[POLICY VIOLATION] Suppression annotation(s) detected in ${file}:
${matches}

This project PROHIBITS TypeScript/JavaScript suppression comments in source code.
You MUST:
1. Remove the suppression annotation(s) you just wrote.
2. Fix the underlying code issue that the annotation was suppressing.
3. If the warning is unavoidable due to platform constraints, leave the warning as-is and document the reason outside a suppression comment.

Do NOT add @ts-ignore, @ts-expect-error, @ts-nocheck, eslint-disable, oxlint-disable, biome-ignore, or prettier-ignore to project source code."
    aggregated="${aggregated:+$aggregated$'\n\n'}$msg"
  fi
done

if [ -n "$aggregated" ]; then
  jq -Rn --arg msg "$aggregated" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $msg
    }
  }'
fi
