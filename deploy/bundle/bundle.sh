#!/bin/sh
# UserTasks air-gapped bundle: verify, load and run it on a host with no
# internet (docs/setup-air-gapped.md). Needs a POSIX shell, sha256sum,
# OpenSSL 3, Docker (with the compose plugin) — no Node.js.
#
#   ./bundle.sh verify [--fingerprint aa:bb:…]   checksums + ed25519 signature
#   ./bundle.sh load [--registry host[:port]/path] [--push]
#                                               docker load every image; with
#                                               --registry also tag (and push)
#                                               them for Kubernetes / other hosts
#   ./bundle.sh up                              the on-premises Compose profile
#                                               (isolated network, OpenBao KMS)
#   ./bundle.sh smoke                           the release-gate checks against it
#   ./bundle.sh down [--volumes]
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"
COMPOSE_DIR="$HERE/compose"
ENV_FILE="$COMPOSE_DIR/.env"

die() { echo "bundle: $*" >&2; exit 1; }

fingerprint() {
  openssl pkey -pubin -in signing-key.pub.pem -outform DER | sha256sum | cut -c1-32 | sed 's/../&:/g; s/:$//'
}

cmd_verify() {
  expected=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --fingerprint) expected=$(echo "$2" | tr 'A-F' 'a-f'); shift 2 ;;
      *) die "verify: unknown option $1" ;;
    esac
  done
  [ -f SHA256SUMS ] && [ -f SHA256SUMS.sig ] && [ -f signing-key.pub.pem ] || die "SHA256SUMS, SHA256SUMS.sig or signing-key.pub.pem missing"
  if ! sha256sum -c SHA256SUMS >/dev/null 2>&1; then
    sha256sum -c SHA256SUMS 2>&1 | grep -v ': OK$' | head -n 20 >&2
    die "checksum mismatch: the bundle is damaged or was changed"
  fi
  # Every file in the bundle is listed (nothing added after signing).
  listed="${TMPDIR:-/tmp}/usertasks-bundle-listed.$$"
  sed 's/^[0-9a-f]*  //' SHA256SUMS | sort > "$listed"
  unlisted=$(find . -type f ! -path './SHA256SUMS' ! -path './SHA256SUMS.sig' ! -path './compose/.env' | sed 's|^\./||' | sort | comm -23 - "$listed")
  rm -f "$listed"
  [ -z "$unlisted" ] || die "files not covered by SHA256SUMS: $unlisted"
  openssl pkeyutl -verify -pubin -inkey signing-key.pub.pem -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig >/dev/null \
    || die "signature check failed: SHA256SUMS was not signed by signing-key.pub.pem"
  fp=$(fingerprint)
  echo "Checksums OK ($(wc -l < SHA256SUMS | tr -d ' ') files), signature OK."
  echo "Signer fingerprint: $fp"
  if [ -n "$expected" ]; then
    [ "$fp" = "$expected" ] || die "signer fingerprint $fp is not the expected $expected"
    echo "Fingerprint matches the expected one."
  else
    echo "Compare it with the fingerprint published with the release (or pass --fingerprint)."
  fi
}

# images/images.txt: "<file> <image reference> <app|dependency>" per line.
target_ref() {
  ref="$1"; registry="$2"
  first=${ref%%/*}
  case "$first" in
    *.*|*:*|localhost) [ "$first" != "$ref" ] && ref=${ref#*/} ;;
  esac
  echo "$registry/$ref"
}

cmd_load() {
  registry=""; push=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --registry) registry=${2%/}; shift 2 ;;
      --push) push=1; shift ;;
      *) die "load: unknown option $1" ;;
    esac
  done
  while read -r file ref role; do
    [ -n "$file" ] || continue
    echo "Loading $ref"
    docker load -q -i "images/$file" >/dev/null
    if [ -n "$registry" ]; then
      target=$(target_ref "$ref" "$registry")
      docker tag "$ref" "$target"
      echo "  tagged $target"
      if [ "$push" = 1 ]; then docker push -q "$target" >/dev/null && echo "  pushed $target"; fi
    fi
  done < images/images.txt
  echo "Images loaded. Helm: --set global.imageRegistry=${registry:-<your registry>} (chart in charts/)."
}

app_image() { awk '$3 == "app" { print $2; exit }' images/images.txt; }

compose() {
  docker compose -p usertasks-onprem --project-directory "$COMPOSE_DIR" \
    -f "$COMPOSE_DIR/docker-compose.yml" -f "$COMPOSE_DIR/deploy/compose/onprem.yml" -f "$COMPOSE_DIR/deploy/compose/kms.yml" \
    --env-file "$ENV_FILE" --profile standalone --profile kms-vault "$@"
}

rand() { openssl rand -hex "$1"; }

write_env() {
  [ -f "$ENV_FILE" ] && { echo "compose/.env exists; keeping it."; return; }
  pg=$(rand 18)
  umask 077
  sed -e "s/<POSTGRES_PASSWORD>/$pg/g" -e "s/^POSTGRES_PASSWORD=<generate>$/POSTGRES_PASSWORD=$pg/" \
      -e "s|^APP_URL=.*|APP_URL=http://localhost:3400|" -e "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=http://localhost:3400|" \
      "$COMPOSE_DIR/deploy/compose/standalone.env.example" |
  # Every other <generate> gets its own random value.
  while IFS= read -r line; do
    case "$line" in
      *"<generate>"*) printf "%s%s\n" "${line%%<generate>*}" "$(rand 32)" ;;
      *) printf "%s\n" "$line" ;;
    esac
  done > "$ENV_FILE.tmp"
  {
    echo "USERTASKS_IMAGE=$(app_image)"
    echo "KMS_PROVIDER=vault_transit"
    echo "VAULT_ADDR=http://openbao:8200"
    echo "VAULT_TOKEN=$(rand 24)"
    echo "VAULT_TRANSIT_KEY=usertasks"
  } >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "Wrote compose/.env (fresh secrets)."
}

admin() { compose exec -T app node admin.cjs "$@"; }

cmd_up() {
  write_env
  export USERTASKS_ENV_FILE="$ENV_FILE"
  compose up -d --wait --no-build
  if ! admin kms status --json | grep -q '"activeKeyId": [0-9]'; then
    echo "KMS (OpenBao Transit): creating the first data key, restarting the app on it."
    admin kms rotate --activate-in 0 --yes
    compose restart app worker
    compose up -d --wait --no-build
    admin kms rewrap --yes
  fi
  echo "UserTasks is up on an isolated network (nothing is published on the host)."
  echo "First workspace: ./bundle.sh admin bootstrap --email you@corp.example --org \"Your org\" (password from BOOTSTRAP_PASSWORD)"
}

cmd_smoke() {
  export USERTASKS_ENV_FILE="$ENV_FILE"
  run=$(date +%s)
  email="smoke-$run@usertasks.test"
  password=$(rand 12)
  out=$(compose exec -T -e BOOTSTRAP_PASSWORD="$password" app node admin.cjs bootstrap --email "$email" --org "Smoke $run" --if-missing --api-key "smoke $run")
  key=$(echo "$out" | grep -o 'ut_[0-9a-f]\{64\}' | head -n 1)
  slug=$(echo "$out" | sed -n 's/.*slug: \([a-z0-9-]*\).*/\1/p' | head -n 1)
  [ -n "$key" ] || die "bootstrap printed no API key: $out"
  action=$(compose exec -T app node -e "const m=require('./.next/server/server-reference-manifest.json').node;for(const[k,v]of Object.entries(m))if(v.exportedName==='signInAction'&&v.filename==='app/actions/auth.ts'){console.log(k);break}")
  status=0
  compose --profile smoke run --rm -e SMOKE_URL=http://app:3000 -e SMOKE_API_KEY="$key" -e SMOKE_EMAIL="$email" \
    -e SMOKE_PASSWORD="$password" -e SMOKE_ORG="$slug" -e SMOKE_SIGNIN_ACTION="$action" -e SMOKE_MAIL=mailpit smoke || status=1
  # The scheduler's first tick (up to 3 minutes), then every provider's checks.
  i=0
  until admin doctor 2>/dev/null | grep -q '\[ok *\] last tick' || [ $i -ge 18 ]; do i=$((i + 1)); sleep 10; done
  admin doctor || status=1
  admin kms status | grep -q 'ACTIVE' || { echo "FAIL  no active KMS data key"; status=1; }
  if compose exec -T app wget -q -T 5 -O /dev/null https://registry.npmjs.org/ 2>/dev/null; then
    echo "FAIL  the app container reached the internet"; status=1
  else
    echo "ok    no outbound internet from the app container"
  fi
  [ $status = 0 ] && echo "Air-gapped bundle smoke: PASSED" || echo "Air-gapped bundle smoke: FAILED"
  return $status
}

cmd="${1:-help}"; [ $# -gt 0 ] && shift
case "$cmd" in
  verify) cmd_verify "$@" ;;
  load) cmd_load "$@" ;;
  up) cmd_up ;;
  smoke) cmd_smoke ;;
  down) export USERTASKS_ENV_FILE="$ENV_FILE"; compose --profile smoke down --remove-orphans "$@" ;;
  admin) export USERTASKS_ENV_FILE="$ENV_FILE"; admin "$@" ;;
  fingerprint) fingerprint ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; [ "$cmd" = help ] ;;
esac
