#!/bin/sh
# UserTasks one-line installer (Docker) for Linux and macOS.
#
#   curl -fsSL https://usertasks.com/install.sh | sh
#   curl -fsSL https://usertasks.com/install.sh | sh -s -- --port 8080 --dir /opt/usertasks
#
# Options (or environment variables):
#   --version <x.y.z>    USERTASKS_VERSION   release to install (default: the latest)
#   --dir <folder>       USERTASKS_DIR       install folder (default: /opt/usertasks as root, else ~/usertasks)
#   --port <port>        USERTASKS_PORT      port on this machine (default 3000)
#   --url <address>      USERTASKS_APP_URL   the address people open (default http://localhost:<port>)
#   --preset <name>      USERTASKS_PRESET    standalone | postgres | supabase | custom
#   --project <name>     USERTASKS_PROJECT   Docker Compose project name (default usertasks)
#   --non-interactive    USERTASKS_NONINTERACTIVE=1   no questions: defaults and the options above
#   --install-docker                         install Docker Engine (Linux) without asking
#   --build                                  build the image locally if it can't be downloaded
#   --no-browser         USERTASKS_NO_BROWSER=1
#
# UserTasks for SharePoint Server (a licence-gated image; trial or purchased licence):
#   --edition sharepoint USERTASKS_EDITION   install the SharePoint edition
#   --licence <file>     USERTASKS_LICENCE_FILE   your .licence file (checked with usertasks.com)
#   --bundle <file>                          install from an offline bundle (air-gapped hosts)
#   --bundle-download                        make an offline bundle here instead of installing
#                                            (with --edition and --licence; --platform linux/amd64|linux/arm64, --out <file>)
#
# It checks the machine and Docker, downloads a pinned release, verifies its
# signature and checksum before running anything from it, then hands over to
# that release's `usertasks install`. Safe to run again: existing secrets and
# data are never overwritten. Docs: https://usertasks.com/install
#
# The whole script is a set of functions; nothing runs until the last line,
# so a download cut short does nothing.

# The UserTasks release signing key (ed25519). SHA256SUMS of every release is
# signed with it; deploy/install/release-key.pub.pem holds the same key
# (npm run release:bundle -- set-key updates both installers).
USERTASKS_RELEASE_PUBLIC_KEY='
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANqX67SGhI6zK+8mbj86CjQ+IOQFoQ8x8axnlt7S8fbU=
-----END PUBLIC KEY-----
'

ut_install() {
  set -eu
  RELEASE_BASE=${USERTASKS_RELEASE_BASE:-https://github.com/homepresso/User-Tasks/releases}
  VERIFY_IMAGE="node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
  EDITION_API=${USERTASKS_EDITION_API:-https://usertasks.com/api/public/extensions}
  V=${USERTASKS_VERSION:-}; DIR=${USERTASKS_DIR:-}; PORT=${USERTASKS_PORT:-}; URL=${USERTASKS_APP_URL:-}
  PRESET=${USERTASKS_PRESET:-}; PROJECT=${USERTASKS_PROJECT:-}; INSTALL_DOCKER=0; BUILD=0
  EDITION=${USERTASKS_EDITION:-}; LICENCE=${USERTASKS_LICENCE_FILE:-}; BUNDLE=""; BUNDLE_DOWNLOAD=0; PLATFORM=""; OUT=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --version) V=${2#v}; shift 2 ;; --dir) DIR=$2; shift 2 ;; --port) PORT=$2; shift 2 ;; --url) URL=$2; shift 2 ;;
      --preset) PRESET=$2; shift 2 ;; --project) PROJECT=$2; shift 2 ;;
      --non-interactive|-y) USERTASKS_NONINTERACTIVE=1; shift ;; --install-docker) INSTALL_DOCKER=1; shift ;;
      --build) BUILD=1; shift ;; --no-browser) USERTASKS_NO_BROWSER=1; shift ;;
      --edition) EDITION=$2; shift 2 ;; --licence|--license) LICENCE=$2; shift 2 ;; --bundle) BUNDLE=$2; shift 2 ;;
      --bundle-download) BUNDLE_DOWNLOAD=1; shift ;; --platform) PLATFORM=$2; shift 2 ;; --out) OUT=$2; shift 2 ;;
      -h|--help) sed -n '2,31p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || echo "See https://usertasks.com/install"; return 0 ;;
      *) ut_die "unknown option $1 (see --help)" ;;
    esac
  done
  export USERTASKS_NONINTERACTIVE="${USERTASKS_NONINTERACTIVE:-0}" USERTASKS_NO_BROWSER="${USERTASKS_NO_BROWSER:-0}"
  case "$EDITION" in ""|core) EDITION="" ;; sharepoint) : ;; *) ut_die "unknown edition: $EDITION (editions: sharepoint)" ;; esac
  if [ -n "$LICENCE" ]; then
    [ -f "$LICENCE" ] || ut_die "licence file not found: $LICENCE"
    LICENCE="$(cd "$(dirname "$LICENCE")" && pwd)/$(basename "$LICENCE")"
  fi
  if [ -n "$BUNDLE" ]; then
    [ -f "$BUNDLE" ] || ut_die "bundle not found: $BUNDLE"
    BUNDLE="$(cd "$(dirname "$BUNDLE")" && pwd)/$(basename "$BUNDLE")"
  fi
  if [ "$BUNDLE_DOWNLOAD" = 1 ]; then
    [ -n "$EDITION" ] && [ -n "$LICENCE" ] || ut_die "--bundle-download needs --edition sharepoint and --licence <file>"
  elif [ -n "$EDITION" ] && [ -z "$LICENCE" ] && [ -z "$BUNDLE" ]; then
    ut_die "--edition $EDITION needs your licence: --licence <file> (start a 30-day trial at https://usertasks.com/sharepoint/trial)"
  fi

  ut_say ""
  ut_say "${UT_B}UserTasks installer${UT_N}"
  ut_check_machine
  ut_check_docker
  if [ "$BUNDLE_DOWNLOAD" = 1 ]; then
    DIR=${DIR:-$PWD/usertasks-bundle-work}
  elif [ -z "$DIR" ]; then
    if [ "$(id -u)" = 0 ]; then DIR=/opt/usertasks; else DIR="$HOME/usertasks"; fi
    [ -f "$DIR/state.env" ] || DIR=$(ut_ask "Install folder" "$DIR")
  fi
  mkdir -p "$DIR/releases"; chmod 700 "$DIR"; DIR=$(cd "$DIR" && pwd)
  ut_check_disk
  ut_trust_key
  BUNDLE_DIR=""
  if [ -n "$BUNDLE" ]; then ut_open_bundle; V=$BUNDLE_V; fi
  if [ -z "$V" ] && [ -f "$DIR/state.env" ]; then V=$(sed -n 's/^USERTASKS_VERSION=//p' "$DIR/state.env" | tail -n 1); fi
  if [ -z "$V" ] && [ -n "$EDITION" ]; then
    # The newest UserTasks release that has an edition build (it follows a release within hours).
    if ut_get "$EDITION_API/$EDITION" "$DIR/releases/.edition.json" 2>/dev/null; then
      V=$(sed -n 's/.*"latest_core_version": *"\([^"]*\)".*/\1/p' "$DIR/releases/.edition.json" | head -n 1)
    fi
    rm -f "$DIR/releases/.edition.json"
  fi
  if [ -z "$V" ]; then
    ut_step "Looking up the latest release"
    ut_get "$RELEASE_BASE/latest/download/release.json" "$DIR/releases/.latest.json" || ut_die "could not reach $RELEASE_BASE (check the network or proxy settings)"
    V=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DIR/releases/.latest.json" | head -n 1); rm -f "$DIR/releases/.latest.json"
  fi
  printf '%s' "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' || ut_die "not a release version: '$V'"
  ut_fetch "$V" "${BUNDLE_DIR:+$BUNDLE_DIR/release}"

  if [ "$BUNDLE_DOWNLOAD" = 1 ]; then
    set -- bundle-download --work "$DIR" --version "$V" --edition "$EDITION" --licence "$LICENCE"
    [ -n "$PLATFORM" ] && set -- "$@" --platform "$PLATFORM"
    [ -n "$OUT" ] && set -- "$@" --out "$OUT"
    sh "$DIR/releases/$V/usertasks" "$@"
    return
  fi

  set -- install --dir "$DIR" --version "$V"
  [ -n "$BUNDLE_DIR" ] && set -- "$@" --bundle "$BUNDLE_DIR"
  [ -n "$EDITION" ] && [ -z "$BUNDLE_DIR" ] && set -- "$@" --edition "$EDITION"
  [ -n "$LICENCE" ] && set -- "$@" --licence "$LICENCE"
  [ -n "$PORT" ] && set -- "$@" --port "$PORT"
  [ -n "$URL" ] && set -- "$@" --url "$URL"
  [ -n "$PRESET" ] && set -- "$@" --preset "$PRESET"
  [ -n "$PROJECT" ] && set -- "$@" --project "$PROJECT"
  [ "$BUILD" = 1 ] && set -- "$@" --build
  [ -n "${USERTASKS_RELEASE_BASE:-}" ] && set -- "$@" --release-base "$USERTASKS_RELEASE_BASE"
  sh "$DIR/releases/$V/usertasks" "$@"
}

# ── output ──────────────────────────────────────────────────────────────────

ut_colors() {
  if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then UT_B=$(printf '\033[1m'); UT_R=$(printf '\033[31m'); UT_G=$(printf '\033[32m'); UT_N=$(printf '\033[0m'); else UT_B=""; UT_R=""; UT_G=""; UT_N=""; fi
}
ut_say() { printf '%s\n' "$*"; }
ut_step() { printf '%s==>%s %s\n' "$UT_B" "$UT_N" "$*"; }
ut_ok() { printf '  %sok%s  %s\n' "$UT_G" "$UT_N" "$*"; }
ut_warn() { printf 'warning: %s\n' "$*" >&2; }
ut_die() { printf '%sinstall:%s %s\n' "$UT_R" "$UT_N" "$*" >&2; exit 1; }
ut_have() { command -v "$1" >/dev/null 2>&1; }

ut_interactive() {
  [ "${USERTASKS_NONINTERACTIVE:-0}" != 1 ] && [ -r /dev/tty ] && (: < /dev/tty) 2>/dev/null
}
ut_ask() {
  if ! ut_interactive; then printf '%s' "$2"; return; fi
  printf '%s [%s]: ' "$1" "$2" > /dev/tty
  IFS= read -r _a < /dev/tty || _a=""
  printf '%s' "${_a:-$2}"
}
ut_confirm() {
  ut_interactive || return 1
  printf '%s [y/N] ' "$1" > /dev/tty
  IFS= read -r _a < /dev/tty || _a=""
  case "$_a" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

ut_get() {
  if ut_have curl; then curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1"
  elif ut_have wget; then wget -q -O "$2" "$1"
  else ut_die "curl or wget is needed"; fi
}

# ── checks ──────────────────────────────────────────────────────────────────

ut_check_machine() {
  ut_step "Checking this machine"
  OS=$(uname -s); ARCH=$(uname -m)
  case "$OS" in
    Linux|Darwin) : ;;
    MINGW*|MSYS*|CYGWIN*) ut_die "on Windows use PowerShell: irm https://usertasks.com/install.ps1 | iex" ;;
    *) ut_die "unsupported system: $OS (Linux and macOS are supported; Windows: install.ps1)" ;;
  esac
  case "$ARCH" in
    x86_64|amd64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;;
    *) ut_die "unsupported processor: $ARCH (amd64 and arm64 images are published)" ;;
  esac
  ut_ok "$OS $ARCH"
  MEM_KB=0
  if [ "$OS" = Linux ] && [ -r /proc/meminfo ]; then MEM_KB=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
  elif [ "$OS" = Darwin ]; then MEM_KB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 )); fi
  if [ "$MEM_KB" -gt 0 ]; then
    if [ "$MEM_KB" -lt 3000000 ]; then ut_warn "this machine has $((MEM_KB / 1024)) MB of memory; UserTasks needs about 2 GB free for its containers (4 GB or more recommended)"
    else ut_ok "memory: $((MEM_KB / 1048576)) GB"; fi
  fi
}

ut_check_disk() {
  _free=$(df -Pk "$DIR" 2>/dev/null | awk 'NR == 2 { print $4 }')
  if [ -n "$_free" ] && [ "$_free" -lt 5000000 ]; then ut_warn "only $((_free / 1024)) MB free in $DIR; allow 5 GB for the images and data"
  elif [ -n "$_free" ]; then ut_ok "disk: $((_free / 1048576)) GB free in $DIR"; fi
}

ut_check_docker() {
  if ! ut_have docker; then
    ut_say ""
    ut_say "Docker is not installed. UserTasks runs in Docker containers."
    if [ "$OS" = Darwin ]; then
      ut_say "Install Docker Desktop for Mac: https://docs.docker.com/desktop/setup/install/mac-install/"
      ut_say "Start it once, then run this installer again."
      exit 1
    fi
    if [ "$INSTALL_DOCKER" = 1 ] || ut_confirm "Install Docker Engine now with Docker's official script (get.docker.com)? It needs sudo."; then
      ut_install_docker
    else
      ut_say "Install Docker Engine: https://docs.docker.com/engine/install/ (or re-run with --install-docker), then run this installer again."
      exit 1
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    _e=$(docker info 2>&1 || true)
    case "$_e" in
      *"permission denied"*) ut_die "your user can't use Docker. Add it to the docker group (sudo usermod -aG docker \$USER, then sign out and in) or run the installer with sudo." ;;
    esac
    if [ "$OS" = Darwin ]; then ut_die "Docker is not running: start Docker Desktop and run this again."
    else ut_die "the Docker daemon is not running: sudo systemctl start docker, then run this again."; fi
  fi
  _cv=$(docker compose version --short 2>/dev/null || true)
  [ -n "$_cv" ] || ut_die "the Docker Compose plugin is missing (docker compose). Install it: https://docs.docker.com/compose/install/linux/"
  _maj=$(printf '%s' "${_cv#v}" | cut -d. -f1); _min=$(printf '%s' "${_cv#v}" | cut -d. -f2)
  if [ "$_maj" -lt 2 ] || { [ "$_maj" = 2 ] && [ "$_min" -lt 20 ]; }; then ut_die "Docker Compose $_cv is too old; 2.20 or later is needed"; fi
  ut_ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), Compose $_cv"
  _dm=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
  if [ "$_dm" -gt 0 ] 2>/dev/null && [ "$_dm" -lt 2500000000 ]; then
    ut_warn "Docker has $((_dm / 1048576)) MB of memory; give it at least 3 GB (Docker Desktop: Settings → Resources → Memory)"
  fi
}

ut_install_docker() {
  _sudo=""; [ "$(id -u)" = 0 ] || _sudo=sudo
  [ -z "$_sudo" ] || ut_have sudo || ut_die "installing Docker needs root or sudo"
  if [ -r /etc/os-release ]; then
    _id=$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"')
    case "$_id" in
      ubuntu|debian|raspbian|fedora|centos|rhel|rocky|almalinux|sles|opensuse*) : ;;
      *) ut_die "no automatic Docker install for '$_id': see https://docs.docker.com/engine/install/" ;;
    esac
  fi
  ut_step "Installing Docker Engine (get.docker.com)"
  _s=$(mktemp); ut_get https://get.docker.com "$_s"
  $_sudo sh "$_s"; rm -f "$_s"
  $_sudo systemctl enable --now docker 2>/dev/null || true
  if [ -n "$_sudo" ] && ! docker info >/dev/null 2>&1; then
    $_sudo usermod -aG docker "$(id -un)" || true
    ut_die "Docker is installed. Sign out and back in (so your user joins the docker group), then run this installer again."
  fi
}

# ── trust and verification ──────────────────────────────────────────────────

ut_trust_key() {
  KEY="$DIR/release-key.pub.pem"
  if [ -n "${USERTASKS_RELEASE_KEY_FILE:-}" ]; then
    cp "$USERTASKS_RELEASE_KEY_FILE" "$KEY.tmp"
  else
    printf '%s\n' "$USERTASKS_RELEASE_PUBLIC_KEY" | sed -n '/BEGIN PUBLIC KEY/,/END PUBLIC KEY/p' > "$KEY.tmp"
  fi
  if [ "$(grep -cv -- '-----' "$KEY.tmp")" = 0 ]; then
    rm -f "$KEY.tmp"
    ut_die "this copy of the installer has no release signing key, so it can't verify downloads. Use the installer from https://usertasks.com/install.sh (or set USERTASKS_RELEASE_KEY_FILE to the published key)."
  fi
  if [ -f "$KEY" ] && ! cmp -s "$KEY" "$KEY.tmp"; then
    rm -f "$KEY.tmp"
    ut_die "$KEY differs from this installer's release key. If the key was rotated, read the release notes, then remove that file and run again."
  fi
  mv "$KEY.tmp" "$KEY"
}

ut_sha256() {
  if ut_have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif ut_have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else openssl dgst -sha256 -r "$1" | cut -d' ' -f1; fi
}

ut_verify_sig() { # <data> <sig> <key>
  for _o in openssl /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
    if ut_have "$_o" && "$_o" version 2>/dev/null | grep -Eq '^OpenSSL ([3-9]|[1-9][0-9])\.'; then
      "$_o" pkeyutl -verify -pubin -inkey "$3" -rawin -in "$1" -sigfile "$2" >/dev/null 2>&1; return
    fi
  done
  _js='const c=require("crypto"),f=require("fs");const [d,s,k]=process.argv.slice(-3);process.exit(c.verify(null,f.readFileSync(d),c.createPublicKey(f.readFileSync(k)),f.readFileSync(s))?0:1)'
  if ut_have node && node -e 'process.exit(+process.versions.node.split(".")[0] >= 16 ? 0 : 1)' 2>/dev/null; then node -e "$_js" "$1" "$2" "$3"; return; fi
  _vd=$(mktemp -d "$DIR/releases/.verify.XXXXXX"); cp "$1" "$_vd/d"; cp "$2" "$_vd/s"; cp "$3" "$_vd/k"
  _rc=0; docker run --rm --network none -v "$_vd:/v:ro" "$VERIFY_IMAGE" node -e "$_js" /v/d /v/s /v/k || _rc=$?
  rm -rf "$_vd"; return $_rc
}

# ut_fetch <version> [folder]: download (or copy from [folder]: an offline
# bundle's release/), verify, unpack into releases/<version>.
ut_fetch() {
  _v=$1; _src=${2:-}; _dest="$DIR/releases/$_v"
  if [ -f "$_dest/.verified" ] && [ -f "$_dest/usertasks" ]; then ut_ok "release $_v already downloaded and verified"; return; fi
  _dl="$DIR/releases/.download-$_v"; rm -rf "$_dl"; mkdir -p "$_dl"
  _url="$RELEASE_BASE/download/v$_v"; _b="usertasks-$_v.tar.gz"
  if [ -n "$_src" ]; then ut_step "Checking UserTasks $_v from the bundle"; else ut_step "Downloading UserTasks $_v"; fi
  ut_rel_get "$_src" "$_url" SHA256SUMS "$_dl/SHA256SUMS" || ut_die "release $_v not found (${_src:-$_url})"
  ut_rel_get "$_src" "$_url" SHA256SUMS.sig "$_dl/SHA256SUMS.sig" || ut_die "release $_v has no signature file"
  ut_verify_sig "$_dl/SHA256SUMS" "$_dl/SHA256SUMS.sig" "$KEY" || ut_die "signature check FAILED: SHA256SUMS of $_v was not signed by the UserTasks release key. Nothing was installed."
  ut_ok "signature"
  _want=$(awk -v f="$_b" '$2 == f || $2 == "*" f { print $1 }' "$_dl/SHA256SUMS")
  [ -n "$_want" ] || ut_die "SHA256SUMS does not list $_b"
  ut_rel_get "$_src" "$_url" "$_b" "$_dl/$_b" || ut_die "could not download $_b"
  [ "$(ut_sha256 "$_dl/$_b")" = "$_want" ] || ut_die "checksum mismatch for $_b: the download is damaged or was changed. Nothing was installed."
  ut_ok "checksum"
  mkdir -p "$_dl/x"; tar -xzf "$_dl/$_b" -C "$_dl/x"
  [ -f "$_dl/x/usertasks-$_v/manifest.json" ] || ut_die "$_b has no manifest.json"
  grep -q "\"version\": *\"$_v\"" "$_dl/x/usertasks-$_v/manifest.json" || ut_die "$_b is not version $_v"
  cp "$_dl/SHA256SUMS" "$_dl/SHA256SUMS.sig" "$_dl/x/usertasks-$_v/"
  : > "$_dl/x/usertasks-$_v/.verified"
  rm -rf "$_dest"; mv "$_dl/x/usertasks-$_v" "$_dest"; rm -rf "$_dl"
}

ut_rel_get() { # <local folder or ""> <release url> <file> <dest>
  if [ -n "$1" ]; then [ -f "$1/$3" ] && cp "$1/$3" "$4"; else ut_get "$2/$3" "$4"; fi
}

# ut_open_bundle: unpack the offline bundle ($BUNDLE) into releases/.bundle.
# Sets BUNDLE_DIR and BUNDLE_V. Its release is then verified like a download
# (ut_fetch) and the edition image by the release's `usertasks install --bundle`.
ut_open_bundle() {
  if [ -f "$BUNDLE.sha256" ]; then
    [ "$(ut_sha256 "$BUNDLE")" = "$(cut -d' ' -f1 < "$BUNDLE.sha256")" ] || ut_die "$BUNDLE does not match $BUNDLE.sha256: the bundle is damaged or was changed"
    ut_ok "bundle checksum ($BUNDLE.sha256)"
  fi
  _bo="$DIR/releases/.bundle"; rm -rf "$_bo"; mkdir -p "$_bo"
  ut_step "Unpacking $(basename "$BUNDLE")"
  tar -xf "$BUNDLE" -C "$_bo" || ut_die "could not unpack $BUNDLE"
  BUNDLE_DIR=$(find "$_bo" -mindepth 2 -maxdepth 2 -name bundle.json -exec dirname {} \; | head -n 1)
  [ -n "$BUNDLE_DIR" ] || ut_die "$BUNDLE is not a UserTasks offline bundle"
  BUNDLE_V=$(sed -n 's/.*"core_version": *"\([^"]*\)".*/\1/p' "$BUNDLE_DIR/bundle.json" | head -n 1)
  [ -n "$BUNDLE_V" ] || ut_die "the bundle names no UserTasks version"
  ut_say "  release key fingerprint (the signer fingerprint in the release notes): $(ut_key_fingerprint)"
}

ut_key_fingerprint() {
  _o=openssl; for _c in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do [ -x "$_c" ] && _o=$_c; done
  if ut_have "$_o"; then "$_o" pkey -pubin -in "$KEY" -outform DER 2>/dev/null | { if ut_have sha256sum; then sha256sum; else shasum -a 256; fi; } | cut -d' ' -f1 | sed 's/../&:/g; s/:$//' | cut -c1-47
  else printf 'unavailable (no openssl)'; fi
}

ut_colors
ut_install "$@"
