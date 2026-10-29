#!/usr/bin/env bash
# Fresh-history public export of this repository.
#
#   scripts/public-export.sh --out <dir> --author "Name <email>" [options]
#
# Steps: `git archive <ref>` into <dir> → drop the paths in .public-exclude
# (read from the exported ref) → scan with gitleaks (and an optional
# denylist of private strings) and stop on any finding → `git init` with a
# single commit "UserTasks <version> — initial public release" → print the
# next steps. It never adds a remote or pushes.
#
# Options:
#   --ref <ref>          what to export (default: main)
#   --out <dir>          target directory; must not exist or be empty (required)
#   --author "N <e>"     author and committer of the commit (required; or
#                        PUBLIC_EXPORT_AUTHOR)
#   --version <v>        version in the commit message (default: package.json
#                        "version" at <ref>)
#   --branch <name>      branch name in the new repository (default: main)
#   --denylist <file>    case-insensitive fixed strings, one per line, that
#                        must not appear anywhere in the export (default:
#                        PUBLIC_EXPORT_DENYLIST, else
#                        ~/.config/usertasks/public-denylist when it exists).
#                        Keep this file outside the repository: it lists the
#                        private values themselves.
#   --gitleaks-image <i> Docker image used when no local gitleaks binary is
#                        found (default: zricethezav/gitleaks:v8.21.2)
#   --skip-scan          skip gitleaks (never for a real release)
set -euo pipefail

REF=main
OUT=
AUTHOR=${PUBLIC_EXPORT_AUTHOR:-}
VERSION=
BRANCH=main
DENYLIST=${PUBLIC_EXPORT_DENYLIST:-}
GITLEAKS_IMAGE=zricethezav/gitleaks:v8.21.2
SKIP_SCAN=false

die() { echo "public-export: $*" >&2; exit 1; }
usage() { sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF=${2:?}; shift 2 ;;
    --out) OUT=${2:?}; shift 2 ;;
    --author) AUTHOR=${2:?}; shift 2 ;;
    --version) VERSION=${2:?}; shift 2 ;;
    --branch) BRANCH=${2:?}; shift 2 ;;
    --denylist) DENYLIST=${2:?}; shift 2 ;;
    --gitleaks-image) GITLEAKS_IMAGE=${2:?}; shift 2 ;;
    --skip-scan) SKIP_SCAN=true; shift ;;
    -h|--help) usage 0 ;;
    *) echo "public-export: unknown option $1" >&2; usage 2 ;;
  esac
done

[[ -n "$OUT" ]] || die "--out is required"
[[ -n "$AUTHOR" ]] || die "--author \"Name <email>\" is required (it becomes the public author of the initial commit)"
author_re='^(.*[^[:space:]])[[:space:]]*<([^<>[:space:]]+@[^<>[:space:]]+)>$'
[[ "$AUTHOR" =~ $author_re ]] || die "--author must look like \"Name <email>\""
AUTHOR_NAME=${BASH_REMATCH[1]}
AUTHOR_EMAIL=${BASH_REMATCH[2]}

SRC=$(git rev-parse --show-toplevel 2>/dev/null) || die "run this from inside the source repository"
COMMIT=$(git -C "$SRC" rev-parse --verify --quiet "${REF}^{commit}") || die "unknown ref: $REF"

if [[ -z "$DENYLIST" && -f "$HOME/.config/usertasks/public-denylist" ]]; then
  DENYLIST="$HOME/.config/usertasks/public-denylist"
fi
[[ -z "$DENYLIST" || -f "$DENYLIST" ]] || die "denylist not found: $DENYLIST"

if [[ -e "$OUT" ]]; then
  [[ -d "$OUT" && -z "$(ls -A "$OUT")" ]] || die "$OUT exists and is not empty"
fi
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd -P)
case "$OUT/" in "$(cd "$SRC" && pwd -P)/"*) die "--out must be outside the source repository" ;; esac

if [[ -z "$VERSION" ]]; then
  VERSION=$(git -C "$SRC" show "$COMMIT:package.json" | sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' | head -1)
  [[ -n "$VERSION" ]] || die "could not read the version from package.json; pass --version"
fi

echo "==> Exporting $REF ($COMMIT) into $OUT"
git -C "$SRC" archive --format=tar "$COMMIT" | tar -x -C "$OUT"

# ── Exclusions ───────────────────────────────────────────────────────────────
# Patterns are matched as git glob pathspecs against the files tracked at
# <ref> (so `**` works on any bash, including macOS's 3.2); `!pattern` keeps
# a path that an earlier pattern would drop.
if git -C "$SRC" cat-file -e "$COMMIT:.public-exclude" 2>/dev/null; then
  echo "==> Applying .public-exclude"
  pathspecs=()
  positive=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ -z "${line// }" || "$line" == \#* ]] && continue
    if [[ "$line" == \!* ]]; then pathspecs+=(":(exclude,glob)${line#!}"); else pathspecs+=(":(glob)$line"); positive=$((positive + 1)); fi
  done < <(git -C "$SRC" show "$COMMIT:.public-exclude")
  # Exclude-only pathspecs would match everything: no positive pattern, nothing to drop.
  [[ $positive -gt 0 ]] || pathspecs=(":(glob).public-export-nothing-to-drop")
  index=$(mktemp -u "${TMPDIR:-/tmp}/public-export-index.XXXXXX")
  removed=0
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    echo "    - $path"
    rm -f -- "$OUT/$path"
    removed=$((removed + 1))
  done < <(GIT_INDEX_FILE="$index" git -C "$SRC" read-tree "$COMMIT" \
            && GIT_INDEX_FILE="$index" git -C "$SRC" ls-files --cached -- "${pathspecs[@]}"; rm -f "$index")
  # Drop directories the removals emptied.
  find "$OUT" -mindepth 1 -type d -empty -delete
  echo "    $removed file(s) removed"
fi

# ── Scans ────────────────────────────────────────────────────────────────────
run_gitleaks() { # <mode: dir|git> ; scans $OUT
  local mode=$1 cfg=()
  [[ -f "$OUT/.gitleaks.toml" ]] && cfg=(--config "$OUT/.gitleaks.toml")
  if command -v gitleaks >/dev/null 2>&1; then
    gitleaks "$mode" "$OUT" "${cfg[@]+"${cfg[@]}"}" --no-banner --redact -v
  elif command -v docker >/dev/null 2>&1; then
    [[ ${#cfg[@]} -gt 0 ]] && cfg=(--config /src/.gitleaks.toml)
    docker run --rm -v "$OUT:/src:ro" "$GITLEAKS_IMAGE" "$mode" /src "${cfg[@]+"${cfg[@]}"}" --no-banner --redact -v
  else
    die "gitleaks is required (install it, or Docker for $GITLEAKS_IMAGE), or pass --skip-scan"
  fi
}

if $SKIP_SCAN; then
  echo "==> WARNING: gitleaks scan skipped (--skip-scan)"
else
  echo "==> gitleaks (working tree)"
  run_gitleaks dir || die "gitleaks reported findings in $OUT; fix them at $REF (or allowlist a verified false positive in .gitleaks.toml) and export again"
fi

if [[ -n "$DENYLIST" ]]; then
  echo "==> Denylist ($DENYLIST)"
  terms=$(mktemp)
  trap 'rm -f "$terms"' EXIT
  grep -vE '^[[:space:]]*(#|$)' "$DENYLIST" > "$terms" || true
  if [[ -s "$terms" ]]; then
    if hits=$(grep -rIilF -f "$terms" "$OUT"); then
      echo "$hits" | sed "s|^$OUT/|    ! |" >&2
      die "denylisted strings found in the files above"
    fi
    echo "    $(wc -l < "$terms" | tr -d ' ') terms, no matches"
  fi
else
  echo "==> WARNING: no denylist (pass --denylist or create ~/.config/usertasks/public-denylist)"
fi

# Coding-assistant notes and settings never go public, whatever .public-exclude says.
assistant=$(find "$OUT" -not -path "$OUT/.git/*" \( -name CLAUDE.md -o -name CLAUDE.local.md -o -name AGENTS.md -o -name .claude -o -name .cursor -o -name .cursorrules -o -name .windsurfrules -o -name copilot-instructions.md \) | sed "s|^$OUT/||")
[[ -z "$assistant" ]] || die "coding-assistant files in the export (add them to .public-exclude): $assistant"

# GitHub rejects files over 100 MB and warns above 50 MB.
big=$(find "$OUT" -type f -size +50M -not -path "$OUT/.git/*" | sed "s|^$OUT/||")
[[ -z "$big" ]] || die "files over 50 MB (GitHub limit is 100 MB): $big"

# ── Fresh repository ─────────────────────────────────────────────────────────
echo "==> Creating the repository"
git -C "$OUT" init -q -b "$BRANCH"
git -C "$OUT" add -A
MESSAGE="UserTasks ${VERSION} — initial public release"
GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
  git -C "$OUT" -c commit.gpgsign=false -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" \
  commit -q -m "$MESSAGE"

if ! $SKIP_SCAN; then
  echo "==> gitleaks (history of the new repository)"
  run_gitleaks git || die "gitleaks reported findings in the new commit"
fi

FILES=$(git -C "$OUT" ls-files | wc -l | tr -d ' ')
cat <<EOF

Done: $OUT
  commit  $(git -C "$OUT" rev-parse --short HEAD)  "$MESSAGE"
  author  $AUTHOR_NAME <$AUTHOR_EMAIL>
  source  $REF @ $COMMIT
  files   $FILES

Next steps (nothing has been pushed):
  1. Create the empty public repository on GitHub (no README, licence or .gitignore).
  2. If the repository URL is not set at $REF yet:
       cd "$OUT" && node scripts/set-repository-url.mjs https://github.com/<owner>/<repo> \\
         && git add -A && git commit --amend --no-edit
  3. git -C "$OUT" remote add origin git@github.com:<owner>/<repo>.git
  4. git -C "$OUT" push -u origin $BRANCH
  5. Finish docs/launch-checklist.md (private vulnerability reporting, NPM_TOKEN,
     NEXT_PUBLIC_REPOSITORY_URL on the hosted deployment, npm publish).
EOF
