#!/usr/bin/env bash
# Stop: type-check every workspace package touched this turn (recorded by
# track-edits.sh) with tsc, and run the Effect language service diagnostics on
# touched files that import Effect. Errors block the stop once (exit 2) so Claude
# fixes them; a repeated failure in the same turn only warns, to avoid loops.
set -uo pipefail

root=${CLAUDE_PROJECT_DIR:-$(pwd)}
input=${HOOK_INPUT:-$(cat)}
session=$(jq -r '.session_id // "default"' <<<"$input")
list=${HOOK_LIST:-${TMPDIR:-/tmp}/claude-typecheck/$session.list}

[[ -s $list ]] || exit 0

# Node only exists inside the flake dev shell; re-run this script there once.
# The dev shell resets TMPDIR, so hand the list path over explicitly.
if ! command -v node >/dev/null 2>&1; then
  HOOK_INPUT=$input HOOK_LIST=$list exec nix develop "$root" --option warn-dirty false -c "$0"
fi

cd "$root" || exit 0

package_of() {
  local dir
  dir=$(dirname "$1")
  while [[ $dir == "$root"/* ]]; do
    if [[ -f $dir/package.json ]]; then
      echo "$dir"
      return
    fi
    dir=$(dirname "$dir")
  done
}

mapfile -t files < <(sort -u "$list")
declare -A packages=()
effect_files=()
for file in "${files[@]}"; do
  [[ -f $file ]] || continue
  pkg=$(package_of "$file")
  [[ -n $pkg && -f $pkg/tsconfig.json ]] && packages[$pkg]=1
  grep -qE "from ['\"](effect|@effect/)" "$file" && effect_files+=("$file")
done

report=""
for pkg in "${!packages[@]}"; do
  tsc=$pkg/node_modules/.bin/tsc
  [[ -x $tsc ]] || tsc=$root/node_modules/.bin/tsc
  if [[ ! -x $tsc ]]; then
    echo '{"systemMessage": "typecheck hook skipped: dependencies are not installed (run pnpm install)"}'
    exit 0
  fi
  if grep -q '"references"' "$pkg/tsconfig.json"; then
    out=$("$tsc" -b "$pkg" --pretty false 2>&1)
  else
    out=$("$tsc" --noEmit -p "$pkg" --pretty false 2>&1)
  fi
  [[ $? -ne 0 ]] && report+="## tsc: ${pkg#"$root"/}"$'\n'"$out"$'\n\n'
done

els=$root/node_modules/.bin/effect-tsgo
if [[ -x $els ]]; then
  for file in "${effect_files[@]:0:20}"; do
    out=$("$els" diagnostics --file "$file" --format text --severity error,warning 2>&1)
    if ! grep -qE '^0 errors, 0 warnings' <<<"$out"; then
      report+="## Effect diagnostics: ${file#"$root"/}"$'\n'"$out"$'\n\n'
    fi
  done
fi

if [[ -z $report ]]; then
  rm -f "$list"
  exit 0
fi

report=$(head -n 80 <<<"$report")
if [[ $(jq -r '.stop_hook_active // false' <<<"$input") == true ]]; then
  jq -n --arg r "$report" '{systemMessage: ("Type check still failing for files edited this turn:\n" + $r)}'
  exit 0
fi
{
  echo "Type check failed for TypeScript files edited this turn. Fix the errors below before finishing."
  echo "Do not silence them with @ts-ignore, 'as any' or by loosening tsconfig; if an error is unrelated to your change or can't be fixed, say so explicitly."
  echo
  echo "$report"
} >&2
exit 2
