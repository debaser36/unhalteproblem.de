#!/usr/bin/env bash
# PostToolUse (Edit|Write): remember edited TypeScript files so typecheck.sh can
# check them once when the turn ends instead of after every single edit.
set -euo pipefail

input=$(cat)
session=$(jq -r '.session_id // "default"' <<<"$input")
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' <<<"$input")
root=${CLAUDE_PROJECT_DIR:-$(pwd)}

[[ -n $file ]] || exit 0
case $file in
  *.ts | *.tsx | *.mts | *.cts) ;;
  *) exit 0 ;;
esac
case $file in
  "$root"/repos/* | */node_modules/* | */dist/*) exit 0 ;;
esac

state_dir=${TMPDIR:-/tmp}/claude-typecheck
mkdir -p "$state_dir"
printf '%s\n' "$file" >>"$state_dir/$session.list"
