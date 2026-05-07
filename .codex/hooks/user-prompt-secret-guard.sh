#!/usr/bin/env bash
# UserPromptSubmit hook (Codex): block prompts containing API keys or tokens.
set -euo pipefail

input="$(cat)"
prompt="$(jq -r '.prompt // .user_prompt // empty' <<< "$input" 2>/dev/null || true)"

if echo "$prompt" | grep -qiE '(sk-[a-zA-Z0-9]{20,}|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----)'; then
  echo '{"decision":"block","reason":"⚠️ API キーやトークンが含まれています。1Password などのシークレット管理ツールで共有してください。"}'
fi
