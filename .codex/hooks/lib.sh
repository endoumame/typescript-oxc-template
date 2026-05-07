#!/usr/bin/env bash

codex_project_dir() {
  local input="$1"
  local project_dir

  project_dir="$(jq -r '.cwd // empty' <<< "$input" 2>/dev/null || true)"
  if [ -z "$project_dir" ]; then
    project_dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  fi

  printf '%s\n' "$project_dir"
}

codex_collect_paths() {
  local input="$1"
  local patch_body

  jq -r '
    [
      .tool_input.file_path?,
      .tool_input.path?,
      .tool_input.target_file?,
      .tool_input.paths?[]?,
      .tool_input.files?[]?
    ]
    | map(select(. != null and . != ""))
    | .[]
  ' <<< "$input" 2>/dev/null || true

  patch_body="$(jq -r '
    def patch_from_command:
      (
        .tool_input.command?
        // (.tool_input.arguments? | strings | fromjson? | .command?)
        // empty
      )
      | if type == "array" then .[1] // empty
        elif type == "string" then .
        else empty
        end;

    patch_from_command // .tool_input.input // .tool_input.patch // empty
  ' <<< "$input" 2>/dev/null || true)"

  if [ -n "$patch_body" ]; then
    printf '%s\n' "$patch_body" | sed -nE 's/^\*\*\* (Update|Add|Move|Delete) File: (.+)$/\2/p'
    printf '%s\n' "$patch_body" | sed -nE 's/^--- a\/(.+)$/\1/p; s/^\+\+\+ b\/(.+)$/\1/p'
  fi
}

codex_unique_existing_targets() {
  local input="$1"
  shift
  local allowed_extensions=("$@")
  local seen=""
  local path ext allowed

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
      node_modules/*|*/node_modules/*|dist/*|*/dist/*|.wrangler/*|*/.wrangler/*|coverage/*|*/coverage/*) continue ;;
    esac
    [ -f "$path" ] || continue

    allowed="false"
    for ext in "${allowed_extensions[@]}"; do
      case "$path" in
        *"$ext") allowed="true" ;;
      esac
    done
    [ "$allowed" = "true" ] || continue

    case "\n$seen\n" in
      *"\n$path\n"*) continue ;;
    esac
    seen="$seen\n$path"
    printf '%s\n' "$path"
  done < <(codex_collect_paths "$input")
}
