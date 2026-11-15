#!/bin/sh
# End-to-end run of the one-line installer and the `usertasks` command against
# local releases (docs: /docs/self-hosting/install#one-line-installer):
#
#   sh scripts/install-e2e.sh --work <empty folder> [--port 3491] [--project ut-oneline-e2e]
#                             [--base-image ghcr.io/homepresso/usertasks:<version>] [--keep]
#                             [--profile-image <image with usertasks-admin install profile>]
#
# 1. Builds test images from --base-image (__tests__/fixtures/install-upgrade):
#    "new" (one more migration), "bad-start" (server exits), "bad-migrate" (a failing migration).
# 2. Makes signed releases with npm run release:bundle (a key made for the run) and
#    serves them in GitHub's layout on 127.0.0.1 (<port>+5).
# 3. curl | sh install → health → /setup with the printed setup code → status
#    → re-run (idempotent, .env unchanged) → backup → change data → restore
#    → upgrade to "new" (migration applied, image switched)
#    → upgrade to "bad-start" (rolled back) → upgrade to "bad-migrate" (nothing switched)
#    → tampered SHA256SUMS / bundle rejected
#    → uninstall (data kept) → reinstall (data still there) → uninstall --purge
#    → with --profile-image: an unreachable own PostgreSQL stops the install at the
#      profile check; a fresh install through `usertasks-admin install profile`.
# Needs Docker, Node.js (npx tsx), python3, curl, openssl.
# pass never fails, so `check set -euset -eu pass || fail` is an if-then-else here.
# shellcheck disable=SC2015
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=""; PORT=3491; PROJECT=ut-oneline-e2e; KEEP=0
BASE_IMAGE="ghcr.io/homepresso/usertasks:$(node -p "require('$ROOT/package.json').version")"
PROFILE_IMAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --work) WORK=$2; shift 2 ;; --port) PORT=$2; shift 2 ;; --project) PROJECT=$2; shift 2 ;;
    --base-image) BASE_IMAGE=$2; shift 2 ;; --keep) KEEP=1; shift ;;
    --profile-image) PROFILE_IMAGE=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$WORK" ] || { echo "--work <folder> is required" >&2; exit 2; }
mkdir -p "$WORK"; WORK=$(cd "$WORK" && pwd)
SRV_PORT=$((PORT + 5)); BASE="http://127.0.0.1:$SRV_PORT/releases"
DIR="$WORK/install"; BIN="$WORK/bin"; WWW="$WORK/www"; LOG="$WORK/e2e.log"
UT="$DIR/bin/usertasks"
: > "$LOG"
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "PASS  $*"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL  $*"; }
check() { _d=$1; shift; if "$@" >> "$LOG" 2>&1; then pass "$_d"; else fail "$_d"; fi; }
tsx_() { (cd "$ROOT" && npx tsx scripts/release-bundle.ts "$@"); }
run() { echo "\$ $*" >> "$LOG"; "$@" >> "$LOG" 2>&1; }
psql_q() { docker exec "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=postgres)" psql -U usertasks -d usertasks -tAc "$1"; }
app_image_id() { docker inspect --format '{{.Image}}' "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=app)"; }
image_id() { docker image inspect --format '{{.Id}}' "$1"; }
healthy() { curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/api/config/public"; }

cleanup() {
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true
  if [ "$KEEP" = 0 ] && [ -f "$DIR/state.env" ]; then USERTASKS_BIN_DIR="$BIN" sh "$UT" uninstall --purge --yes >> "$LOG" 2>&1 || true; fi
}
trap cleanup EXIT

echo "== images"
docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || run docker pull "$BASE_IMAGE"
for v in new bad-start bad-migrate; do
  run docker build -q --build-arg BASE="$BASE_IMAGE" --target "$v" -t "usertasks-e2e:$v" "$ROOT/__tests__/fixtures/install-upgrade"
done
BASE_DIGEST=$(docker image inspect --format '{{index .RepoDigests 0}}' "$BASE_IMAGE" | sed 's/.*@//')

echo "== releases"
KEY="$WORK/release-key.pem"; [ -f "$KEY" ] || run tsx_ keygen --out "$KEY"
MIG="$WORK/migrations"; rm -rf "$MIG"; mkdir -p "$MIG"; cp "$ROOT"/supabase/migrations/*.sql "$MIG/"
mk_release() { # <version> <image> [digest] [extra migration]
  [ -n "${4:-}" ] && cp "$ROOT/__tests__/fixtures/install-upgrade/$4" "$MIG/"
  if [ -n "${3:-}" ]; then _dg="--image-digest $3"; else _dg=""; fi
  # shellcheck disable=SC2086
  run tsx_ create --local --version "$1" --image "$2" $_dg --signing-key "$KEY" --out "$WORK/rel" --migrations-dir "$MIG"
  mkdir -p "$WWW/releases/download/v$1"; cp "$WORK/rel/v$1"/* "$WWW/releases/download/v$1/"
}
latest() { rm -rf "$WWW/releases/latest"; mkdir -p "$WWW/releases/latest/download"; cp "$WWW/releases/download/v$1"/* "$WWW/releases/latest/download/"; }
BASE_VERSION=${BASE_IMAGE##*:}
mk_release "$BASE_VERSION" "${BASE_IMAGE%:*}:$BASE_VERSION" "$BASE_DIGEST"
mk_release 99.0.1 usertasks-e2e:new "" 20991231000000_install_upgrade_fixture.sql
mk_release 99.0.2 usertasks-e2e:bad-start
mk_release 99.0.3 usertasks-e2e:bad-migrate "" 20991231000100_install_upgrade_failing.sql
rm -f "$MIG/20991231000100_install_upgrade_failing.sql"
mk_release 99.0.4 usertasks-e2e:new
[ -n "$PROFILE_IMAGE" ] && mk_release 99.1.0 "$PROFILE_IMAGE"
latest "$BASE_VERSION"
(cd "$WWW" && exec python3 -m http.server "$SRV_PORT" --bind 127.0.0.1 >> "$LOG" 2>&1) & SRV_PID=$!
i=0; until curl -fsS -o /dev/null "$BASE/latest/download/release.json" || [ $i -ge 30 ]; do i=$((i + 1)); sleep 1; done

export USERTASKS_RELEASE_BASE="$BASE" USERTASKS_BIN_DIR="$BIN" USERTASKS_MAILPIT_PORT=$((PORT + 1)) USERTASKS_MINIO_CONSOLE_PORT=$((PORT + 2))
install() { curl -fsSL "$BASE/latest/download/install.sh" | sh -s -- --dir "$DIR" --port "$PORT" --project "$PROJECT" --non-interactive; }

echo "== install"
check "curl | sh install" install
check "healthy on $PORT" healthy
CODE=$(sed -n 's/^USERTASKS_SETUP_CODE=//p' "$DIR/.env")
grep -q "setup code $CODE" "$LOG" && pass "installer printed the setup code" || fail "installer printed the setup code"
ACTION=$(docker exec "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=app)" node -e "const m=require('./.next/server/server-reference-manifest.json').node;for(const[k,v]of Object.entries(m))if(v.exportedName==='completeFirstRunSetup'){console.log(k);break}")
setup_post() {
  _pw="E2e-$(openssl rand -hex 6)"
  curl -sS -X POST "http://127.0.0.1:$PORT/setup" -H "Next-Action: $ACTION" -H 'Accept: text/x-component' -H 'Content-Type: text/plain;charset=UTF-8' \
    -H "Origin: http://localhost:$PORT" -H "Host: localhost:$PORT" \
    --data "[{\"org\":\"E2E Org\",\"slug\":\"e2e-org\",\"fullName\":\"E2E Admin\",\"email\":\"admin@e2e.test\",\"password\":\"$_pw\",\"confirmPassword\":\"$_pw\",\"code\":\"$1\"}]"
}
setup_post WRON-GCOD-E234 | grep -q 'setup code isn' && pass "/setup rejects a wrong code" || fail "/setup rejects a wrong code"
setup_post "$CODE" >> "$LOG" 2>&1
sh "$UT" admin setup-code status 2>&1 | grep -q '^Setup is complete' && pass "/setup accepts the printed code (admin account created)" || fail "/setup accepts the printed code"
check "usertasks status" sh "$UT" status

ENV_SUM=$(cksum < "$DIR/.env")
check "installer re-run (idempotent)" install
[ "$(cksum < "$DIR/.env")" = "$ENV_SUM" ] && pass ".env unchanged by the re-run" || fail ".env unchanged by the re-run"

echo "== backup / restore"
check "usertasks backup" sh "$UT" backup --out "$WORK/backup1"
[ -s "$WORK/backup1/database.dump" ] && [ -s "$WORK/backup1/files.tar.gz" ] && [ -f "$WORK/backup1/env" ] && pass "backup has database, files and .env" || fail "backup contents"
psql_q "create table public.e2e_after_backup (id int)" >> "$LOG" 2>&1
[ "$(psql_q "select to_regclass('public.e2e_after_backup') is not null")" = t ] && pass "data changed after the backup" || fail "data changed after the backup"
check "usertasks restore" sh "$UT" restore "$WORK/backup1" --yes
[ "$(psql_q "select to_regclass('public.e2e_after_backup') is null")" = t ] && [ "$(psql_q "select count(*) from public.tenants")" -ge 1 ] && pass "restore brought the database back" || fail "restore brought the database back"
check "healthy after restore" healthy

echo "== upgrade"
latest 99.0.1
check "usertasks upgrade (latest = 99.0.1)" sh "$UT" upgrade --yes
[ "$(psql_q "select note from public.install_upgrade_fixture where id = 1")" = "applied by usertasks upgrade" ] && pass "new migration applied" || fail "new migration applied"
[ "$(app_image_id)" = "$(image_id usertasks-e2e:new)" ] && pass "app runs the new image" || fail "app runs the new image"
grep -q '^USERTASKS_VERSION=99.0.1$' "$DIR/state.env" && pass "state records 99.0.1" || fail "state records 99.0.1"
ls -d "$DIR"/backups/*-before-99.0.1 >/dev/null 2>&1 && pass "upgrade took a backup first" || fail "upgrade took a backup first"
sh "$UT" upgrade --yes 2>&1 | grep -q 'already installed' && pass "upgrade to the same version is a no-op" || fail "upgrade no-op"

if USERTASKS_UPGRADE_TIMEOUT=60 sh "$UT" upgrade --to 99.0.2 --yes --skip-backup >> "$LOG" 2>&1; then fail "bad-start upgrade reports failure"; else pass "bad-start upgrade reports failure"; fi
grep -q 'Rolled back: UserTasks 99.0.1 is running again' "$LOG" && pass "code rolled back automatically" || fail "code rolled back automatically"
[ "$(app_image_id)" = "$(image_id usertasks-e2e:new)" ] && healthy && pass "99.0.1 healthy after the rollback" || fail "99.0.1 healthy after the rollback"
grep -q '^USERTASKS_VERSION=99.0.1$' "$DIR/state.env" && pass "state still 99.0.1" || fail "state still 99.0.1"

if sh "$UT" upgrade --to 99.0.3 --yes --skip-backup >> "$LOG" 2>&1; then fail "failing migration stops the upgrade"; else pass "failing migration stops the upgrade"; fi
grep -q 'no code was switched' "$LOG" && [ "$(app_image_id)" = "$(image_id usertasks-e2e:new)" ] && healthy && pass "nothing switched after the failed migration" || fail "nothing switched after the failed migration"
sh "$UT" upgrade --to "$BASE_VERSION" --yes 2>&1 | grep -q 'older than' && pass "downgrade refused without --allow-downgrade" || fail "downgrade refused"

echo "== tampering"
cp "$WWW/releases/download/v99.0.4/SHA256SUMS" "$WORK/sums.bak"
printf '\n' >> "$WWW/releases/download/v99.0.4/SHA256SUMS"
if sh "$UT" upgrade --to 99.0.4 --yes --skip-backup > "$WORK/tamper1.log" 2>&1; then fail "tampered SHA256SUMS rejected"; else grep -q 'signature check FAILED' "$WORK/tamper1.log" && pass "tampered SHA256SUMS rejected" || fail "tampered SHA256SUMS rejected"; fi
cat "$WORK/tamper1.log" >> "$LOG"; cp "$WORK/sums.bak" "$WWW/releases/download/v99.0.4/SHA256SUMS"
printf 'extra' >> "$WWW/releases/download/v99.0.4/usertasks-99.0.4.tar.gz"
if sh "$UT" upgrade --to 99.0.4 --yes --skip-backup > "$WORK/tamper2.log" 2>&1; then fail "changed bundle rejected (checksum)"; else grep -q 'checksum mismatch' "$WORK/tamper2.log" && pass "changed bundle rejected (checksum)" || fail "changed bundle rejected (checksum)"; fi
cat "$WORK/tamper2.log" >> "$LOG"
[ ! -d "$DIR/releases/99.0.4" ] && grep -q '^USERTASKS_VERSION=99.0.1$' "$DIR/state.env" && healthy && pass "nothing changed by the rejected downloads" || fail "nothing changed by the rejected downloads"

echo "== uninstall"
check "usertasks uninstall (keep data)" sh "$UT" uninstall --yes
[ -z "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")" ] && pass "containers removed" || fail "containers removed"
docker volume inspect "${PROJECT}_pgdata" >/dev/null 2>&1 && pass "data volume kept" || fail "data volume kept"
latest 99.0.1
check "reinstall into the same folder" install
sh "$UT" admin setup-code status 2>&1 | grep -q '^Setup is complete' && pass "reinstall found the existing data" || fail "reinstall found the existing data"
check "usertasks uninstall --purge --yes" sh "$UT" uninstall --purge --yes
! docker volume inspect "${PROJECT}_pgdata" >/dev/null 2>&1 && [ ! -d "$DIR" ] && pass "purge removed volumes and the folder" || fail "purge removed volumes and the folder"

if [ -n "$PROFILE_IMAGE" ]; then
  echo "== install profile command (usertasks-admin install profile)"
  latest 99.1.0
  if curl -fsSL "$BASE/latest/download/install.sh" | USERTASKS_DATABASE_URL="postgresql://u:p@db.invalid:5432/x" sh -s -- --dir "$DIR" --port "$PORT" --project "$PROJECT" --non-interactive --preset postgres > "$WORK/profile-bad.log" 2>&1; then
    fail "unreachable database stops the install"
  else
    grep -q 'could not be reached' "$WORK/profile-bad.log" && [ -z "$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")" ] && pass "unreachable database stops the install before anything starts" || fail "unreachable database stops the install"
  fi
  cat "$WORK/profile-bad.log" >> "$LOG"; rm -rf "$DIR"
  check "install through the profile command" install
  grep -q 'settings written by usertasks-admin install profile' "$LOG" && pass "the profile command wrote the settings" || fail "the profile command wrote the settings"
  grep -q '^SCHEDULER_IN_PROCESS=false$' "$DIR/.env" && grep -q '^CACHE_REDIS_URL=redis://valkey:6379$' "$DIR/.env" && pass ".env from the profile matches the Compose stack" || fail ".env from the profile"
  check "healthy (profile install)" healthy
  sh "$UT" admin doctor >> "$LOG" 2>&1 && pass "usertasks admin doctor" || fail "usertasks admin doctor"
  check "uninstall --purge (profile install)" sh "$UT" uninstall --purge --yes
fi

echo ""
echo "install-e2e: $PASS passed, $FAIL failed (log: $LOG)"
[ "$FAIL" = 0 ]
