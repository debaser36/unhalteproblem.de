#!/usr/bin/env bash
# Stop: type-check every workspace package touched this turn (recorded by
# track-edits.sh) with tsc, and run the Effect language service diagnostics on
# touched files that import Effect. Errors block the stop once (exit 2) so Claude
# fixes them; a repeated failure in the same turn only warns, to avoid loops.
#
# Edits may land in any git worktree of this repository, inside or outside the
# project folder. Each file is checked in its own worktree, with that worktree's
# node_modules.
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

common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)

# The top level of the worktree of this repository that contains a file, or
# nothing if the file belongs to another repository (or to none).
worktree_of() {
  local top
  if [[ -z $common ]]; then
    [[ $1 == "$root"/* ]] && echo "$root"
    return
  fi
  top=$(git -C "$(dirname "$1")" rev-parse --show-toplevel 2>/dev/null) || return
  [[ $(git -C "$top" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) == "$common" ]] && echo "$top"
}

package_of() {
  local dir
  dir=$(dirname "$1")
  while [[ $dir == "$2"/* ]]; do
    if [[ -f $dir/package.json ]]; then
      echo "$dir"
      return
    fi
    dir=$(dirname "$dir")
  done
}

# Paths in messages are relative to the project folder where possible.
label() {
  echo "${1#"$root"/}"
}

mapfile -t files < <(sort -u "$list")
declare -A packages=() effect_files=()
for file in "${files[@]}"; do
  [[ -f $file ]] || continue
  wt=$(worktree_of "$file")
  [[ -n $wt && $file != "$wt"/repos/* ]] || continue
  pkg=$(package_of "$file" "$wt")
  [[ -n $pkg && -f $pkg/tsconfig.json ]] && packages[$pkg]=$wt
  grep -qE "from ['\"](effect|@effect/)" "$file" && effect_files[$file]=$wt
done

report=""
skipped=()
for pkg in "${!packages[@]}"; do
  wt=${packages[$pkg]}
  tsc=$pkg/node_modules/.bin/tsc
  [[ -x $tsc ]] || tsc=$wt/node_modules/.bin/tsc
  if [[ ! -x $tsc ]]; then
    skipped+=("$(label "$pkg")")
    continue
  fi
  if grep -q '"references"' "$pkg/tsconfig.json"; then
    out=$("$tsc" -b "$pkg" --pretty false 2>&1)
  else
    out=$("$tsc" --noEmit -p "$pkg" --pretty false 2>&1)
  fi
  [[ $? -ne 0 ]] && report+="## tsc: $(label "$pkg")"$'\n'"$out"$'\n\n'
done

checked=0
for file in "${!effect_files[@]}"; do
  els=${effect_files[$file]}/node_modules/.bin/effect-tsgo
  [[ -x $els ]] || continue
  ((checked++ < 20)) || break
  out=$("$els" diagnostics --file "$file" --format text --severity error,warning 2>&1)
  if ! grep -qE '^0 errors, 0 warnings' <<<"$out"; then
    report+="## Effect diagnostics: $(label "$file")"$'\n'"$out"$'\n\n'
  fi
done

note=""
if ((${#skipped[@]} > 0)); then
  note="typecheck hook skipped ${skipped[*]}: dependencies are not installed there (run pnpm install in that worktree)"
fi

if [[ -z $report ]]; then
  rm -f "$list"
  [[ -n $note ]] && jq -n --arg m "$note" '{systemMessage: $m}'
  exit 0
fi

report=$(head -n 40 <<<"$report")
if [[ $(jq -r '.stop_hook_active // false' <<<"$input") == true ]]; then
  jq -n --arg r "$report" --arg n "$note" '{systemMessage: ("Type check still failing for files edited this turn:\n" + $r + (if $n == "" then "" else "\n" + $n end))}'
  exit 0
fi
{
  echo "Type check failed for TypeScript files edited this turn. Fix the errors below before finishing."
  echo "Do not silence them with @ts-ignore, 'as any' or by loosening tsconfig; if an error is unrelated to your change or can't be fixed, say so explicitly."
  echo
  echo "$report"
  [[ -n $note ]] && echo "$note"
} >&2
exit 2
