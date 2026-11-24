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
# UserTasks Enterprise (one licence-gated image with every paid extension: SharePoint
# Server, the Infrastructure add-on…; each unlocked by its own licence):
#   --licence <file>     USERTASKS_LICENCE_FILE   your .licence file (checked with usertasks.com):
#                                            installs UserTasks Enterprise (any paid licence)
#   --edition <name>     USERTASKS_EDITION   enterprise (the default with a licence), core (the
#                                            public image, even with a licence), sharepoint (the
#                                            older SharePoint edition name: served the Enterprise image)
#   --bundle <file>                          install from an offline bundle (air-gapped hosts): its .tar,
#                                            or its parts (the .parts.json, or the folder holding them)
#   --bundle-download                        make an offline bundle here instead of installing
#                                            (with --licence; --platform linux/amd64|linux/arm64, --out <file>)
#   --bundle-download --from <url>           download a prebuilt split bundle (<url> of its .parts.json)
#                                            into --out <folder>, resuming and checking every part
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
  EDITION=${USERTASKS_EDITION:-}; LICENCE=${USERTASKS_LICENCE_FILE:-}; BUNDLE=""; BUNDLE_DOWNLOAD=0; PLATFORM=""; OUT=""; FROM=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --version) V=${2#v}; shift 2 ;; --dir) DIR=$2; shift 2 ;; --port) PORT=$2; shift 2 ;; --url) URL=$2; shift 2 ;;
      --preset) PRESET=$2; shift 2 ;; --project) PROJECT=$2; shift 2 ;;
      --non-interactive|-y) USERTASKS_NONINTERACTIVE=1; shift ;; --install-docker) INSTALL_DOCKER=1; shift ;;
      --build) BUILD=1; shift ;; --no-browser) USERTASKS_NO_BROWSER=1; shift ;;
      --edition) EDITION=$2; shift 2 ;; --licence|--license) LICENCE=$2; shift 2 ;; --bundle) BUNDLE=$2; shift 2 ;;
      --bundle-download) BUNDLE_DOWNLOAD=1; shift ;; --platform) PLATFORM=$2; shift 2 ;; --out) OUT=$2; shift 2 ;;
      --from) FROM=$2; shift 2 ;;
      -h|--help) sed -n '2,37p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || echo "See https://usertasks.com/install"; return 0 ;;
      *) ut_die "unknown option $1 (see --help)" ;;
    esac
  done
  export USERTASKS_NONINTERACTIVE="${USERTASKS_NONINTERACTIVE:-0}" USERTASKS_NO_BROWSER="${USERTASKS_NO_BROWSER:-0}"
  case "$EDITION" in ""|core|enterprise|sharepoint) : ;; *) ut_die "unknown edition: $EDITION (editions: enterprise, sharepoint, core)" ;; esac
  # A licence alone means UserTasks Enterprise; --edition core keeps the public image.
  IMPLICIT=0
  if [ -z "$EDITION" ] && [ -n "$LICENCE" ]; then EDITION=enterprise; IMPLICIT=1; fi
  CORE_CHOSEN=0; [ "$EDITION" = core ] && { EDITION=""; CORE_CHOSEN=1; }
  if [ -n "$LICENCE" ]; then
    [ -f "$LICENCE" ] || ut_die "licence file not found: $LICENCE"
    LICENCE="$(cd "$(dirname "$LICENCE")" && pwd)/$(basename "$LICENCE")"
  fi
  if [ -n "$BUNDLE" ]; then
    [ -e "$BUNDLE" ] || ut_die "bundle not found: $BUNDLE"
    BUNDLE="$(cd "$(dirname "$BUNDLE")" && pwd)/$(basename "$BUNDLE")"
  fi
  if [ -n "$FROM" ]; then
    # A prebuilt, split bundle: download and check its parts, nothing else (no Docker needed).
    [ "$BUNDLE_DOWNLOAD" = 1 ] || ut_die "--from goes with --bundle-download"
    ut_say ""; ut_say "${UT_B}UserTasks installer${UT_N}"
    DIR=${DIR:-$PWD/usertasks-bundle-work}; mkdir -p "$DIR/releases"; chmod 700 "$DIR"; DIR=$(cd "$DIR" && pwd)
    ut_trust_key
    ut_parts_download "$FROM" "${OUT:-$PWD}"
    return
  fi
  if [ "$BUNDLE_DOWNLOAD" = 1 ]; then
    if [ -z "$EDITION" ] || [ -z "$LICENCE" ]; then ut_die "--bundle-download needs --licence <file> (and optionally --edition enterprise)"; fi
  elif [ -n "$EDITION" ] && [ -z "$LICENCE" ] && [ -z "$BUNDLE" ]; then
    ut_die "--edition $EDITION needs your licence: --licence <file> (licences: https://usertasks.com/extensions; a 30-day SharePoint trial: https://usertasks.com/sharepoint/trial)"
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
  # Implicit Enterprise is left to the release's installer (a licence and no --edition), which
  # falls back to the public image when there is no Enterprise build to use.
  [ -n "$EDITION" ] && [ "$IMPLICIT" = 0 ] && [ -z "$BUNDLE_DIR" ] && set -- "$@" --edition "$EDITION"
  [ "$CORE_CHOSEN" = 1 ] && [ -z "$BUNDLE_DIR" ] && set -- "$@" --edition core
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

# ut_open_bundle: unpack the offline bundle ($BUNDLE: a .tar, or its parts) into releases/.bundle.
# Sets BUNDLE_DIR and BUNDLE_V. Its release is then verified like a download
# (ut_fetch) and the edition image by the release's `usertasks install --bundle`.
ut_open_bundle() {
  ut_bundle_resolve "$BUNDLE" "$KEY" "$DIR/releases/.bundle-join"
  if [ "$BUNDLE_JOINED" = 0 ] && [ -f "$BUNDLE_FILE.sha256" ]; then
    [ "$(ut_sha256 "$BUNDLE_FILE")" = "$(cut -d' ' -f1 < "$BUNDLE_FILE.sha256")" ] || ut_die "$BUNDLE_FILE does not match $BUNDLE_FILE.sha256: the bundle is damaged or was changed"
    ut_ok "bundle checksum ($BUNDLE_FILE.sha256)"
  fi
  _bo="$DIR/releases/.bundle"; rm -rf "$_bo"; mkdir -p "$_bo"
  ut_step "Unpacking $(basename "$BUNDLE_FILE")"
  tar -xf "$BUNDLE_FILE" -C "$_bo" || ut_die "could not unpack $BUNDLE_FILE"
  [ "$BUNDLE_JOINED" = 0 ] || rm -rf "$DIR/releases/.bundle-join"
  BUNDLE_DIR=$(find "$_bo" -mindepth 2 -maxdepth 2 -name bundle.json -exec dirname {} \; | head -n 1)
  [ -n "$BUNDLE_DIR" ] || ut_die "$BUNDLE is not a UserTasks offline bundle"
  BUNDLE_V=$(sed -n 's/.*"core_version": *"\([^"]*\)".*/\1/p' "$BUNDLE_DIR/bundle.json" | head -n 1)
  [ -n "$BUNDLE_V" ] || ut_die "the bundle names no UserTasks version"
  ut_say "  release key fingerprint (the signer fingerprint in the release notes): $(ut_key_fingerprint)"
}

# ── split bundles (parts; the same as the usertasks wrapper) ───────────────
# A bundle over GitHub's 2 GiB release-asset limit comes in parts:
#   <name>.tar.part-001 … <name>.tar.part-NNN   consecutive pieces of <name>.tar
#   <name>.tar.parts.json                        size + sha256 of the whole and of each part, in order
#   <name>.tar.parts.json.sig                    ed25519 signature of the manifest by the release key
# --bundle takes the .tar, the .parts.json, one of the parts, or the folder
# holding them. The signature, then every part, then the joined file are
# checked before anything is unpacked. (By hand: cat <name>.tar.part-* > <name>.tar)

# ut_parts_list <parts.json>: "<name> <size> <sha256>" of the whole, then one line per part.
ut_parts_list() {
  tr -d '\r\n' < "$1" | awk '
    function f(s, k,   m) {
      if (match(s, "\"" k "\"[ \t]*:[ \t]*\"[^\"]*\"")) { m = substr(s, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", m); sub(/"$/, "", m); return m }
      if (match(s, "\"" k "\"[ \t]*:[ \t]*[0-9]+")) { m = substr(s, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*/, "", m); return m }
      return "-"
    }
    { i = index($0, "\"parts\""); if (!i) exit 1
      head = substr($0, 1, i - 1); print f(head, "name") " " f(head, "size") " " f(head, "sha256")
      n = split(substr($0, i), o, "}")
      for (k = 1; k <= n; k++) if (o[k] ~ /"name"/) print f(o[k], "name") " " f(o[k], "size") " " f(o[k], "sha256") }'
}

# ut_parts_read <parts.json> <list file>: checks the manifest's shape; writes "<n> <name> <size> <sha256>"
# per part to <list file>. Sets PARTS_NAME, PARTS_SIZE, PARTS_SHA, PARTS_N.
ut_parts_read() {
  _pr_m=$(basename "$1")
  ut_parts_list "$1" > "$2" 2>/dev/null || ut_die "$_pr_m is not a bundle parts manifest"
  read -r PARTS_NAME PARTS_SIZE PARTS_SHA < "$2" || ut_die "$_pr_m is empty"
  if ! printf '%s' "$PARTS_NAME" | grep -Eq '^[A-Za-z0-9._-]+\.tar$' || ! printf '%s' "$PARTS_SIZE" | grep -Eq '^[0-9]+$' \
    || ! printf '%s' "$PARTS_SHA" | grep -Eq '^[0-9a-f]{64}$'; then ut_die "$_pr_m is not a bundle parts manifest"; fi
  PARTS_N=$(($(wc -l < "$2") - 1))
  [ "$PARTS_N" -ge 1 ] || ut_die "$_pr_m lists no parts"
  tail -n +2 "$2" > "$2.tmp"; : > "$2"; _pr_i=0; _pr_sum=0
  while read -r _pr_n _pr_s _pr_h; do
    _pr_i=$((_pr_i + 1))
    if [ "$_pr_n" != "$(printf '%s.part-%03d' "$PARTS_NAME" "$_pr_i")" ] || ! printf '%s' "$_pr_s" | grep -Eq '^[0-9]+$' \
      || ! printf '%s' "$_pr_h" | grep -Eq '^[0-9a-f]{64}$'; then ut_die "$_pr_m lists an unexpected part (entry $_pr_i)"; fi
    _pr_sum=$((_pr_sum + _pr_s)); printf '%s %s %s %s\n' "$_pr_i" "$_pr_n" "$_pr_s" "$_pr_h" >> "$2"
  done < "$2.tmp"
  rm -f "$2.tmp"
  [ "$_pr_sum" = "$PARTS_SIZE" ] || ut_die "the parts in $_pr_m do not add up to the bundle size"
}

# ut_parts_part_ok <file> <size> <sha256>: 0 intact, 1 missing, 2 wrong size, 3 checksum mismatch.
ut_parts_part_ok() {
  [ -f "$1" ] || return 1
  [ "$(wc -c < "$1" | tr -d ' ')" = "$2" ] || return 2
  [ "$(ut_sha256 "$1")" = "$3" ] || return 3
}

# ut_parts_join <parts.json> <release key> <work folder>: verify and join. Sets BUNDLE_FILE (the joined .tar).
ut_parts_join() {
  _pj_d=$(dirname "$1"); _pj_m=$(basename "$1")
  [ -f "$1" ] || ut_die "parts manifest not found: $1"
  [ -f "$1.sig" ] || ut_die "$_pj_m.sig is missing: copy it next to $_pj_m (the parts can't be checked without it)"
  ut_verify_sig "$1" "$1.sig" "$2" || ut_die "signature check FAILED: $_pj_m was not signed by the UserTasks release key. Nothing was installed."
  ut_ok "signature of $_pj_m"
  mkdir -p "$3"; _pj_l="$3/.parts.list"
  ut_parts_read "$1" "$_pj_l"
  ut_step "Checking the $PARTS_N parts of $PARTS_NAME"
  while read -r _pj_i _pj_n _pj_s _pj_h; do
    _pj_rc=0; ut_parts_part_ok "$_pj_d/$_pj_n" "$_pj_s" "$_pj_h" || _pj_rc=$?
    case "$_pj_rc" in
      1) ut_die "part $_pj_i of $PARTS_N ($_pj_n) is missing: copy it next to $_pj_m (or download it again)" ;;
      2) ut_die "part $_pj_i of $PARTS_N ($_pj_n) is incomplete or damaged (wrong size): download it again" ;;
      3) ut_die "part $_pj_i of $PARTS_N ($_pj_n) is damaged (checksum mismatch): download it again" ;;
    esac
  done < "$_pj_l"
  ut_ok "$PARTS_N parts (sizes and checksums)"
  BUNDLE_FILE="$3/$PARTS_NAME"; : > "$BUNDLE_FILE"
  while read -r _pj_i _pj_n _pj_s _pj_h; do
    cat "$_pj_d/$_pj_n" >> "$BUNDLE_FILE" || ut_die "could not join the parts into $BUNDLE_FILE (disk full?)"
  done < "$_pj_l"
  rm -f "$_pj_l"
  [ "$(ut_sha256 "$BUNDLE_FILE")" = "$PARTS_SHA" ] || { rm -f "$BUNDLE_FILE"; ut_die "the joined bundle does not match $_pj_m (checksum mismatch): download the parts again"; }
  ut_ok "joined $PARTS_NAME (checksum)"
}

# ut_bundle_resolve <path> <release key> <work folder>: a bundle .tar, or its parts (a .parts.json,
# one of the parts, or the folder holding them), as one .tar. Sets BUNDLE_FILE; BUNDLE_JOINED=1 when joined.
ut_bundle_resolve() {
  BUNDLE_FILE=$1; BUNDLE_JOINED=0; _br_m=""
  case "$1" in
    *.parts.json) _br_m=$1 ;;
    *.part-[0-9][0-9][0-9]) _br_m="${1%.part-[0-9][0-9][0-9]}.parts.json" ;;
    *) if [ -d "$1" ]; then
         _br_n=$(find "$1" -maxdepth 1 -type f -name '*.parts.json' | wc -l | tr -d ' ')
         if [ "$_br_n" -gt 1 ]; then ut_die "$1 holds more than one bundle: name its .parts.json"
         elif [ "$_br_n" = 1 ]; then _br_m=$(find "$1" -maxdepth 1 -type f -name '*.parts.json')
         else
           [ "$(find "$1" -maxdepth 1 -type f -name '*.tar' | wc -l | tr -d ' ')" = 1 ] || ut_die "$1 has no offline bundle (a .tar, or the .part-NNN files with their .parts.json)"
           BUNDLE_FILE=$(find "$1" -maxdepth 1 -type f -name '*.tar')
         fi
       fi ;;
  esac
  if [ -n "$_br_m" ]; then ut_parts_join "$_br_m" "$2" "$3"; BUNDLE_JOINED=1; fi
  [ -f "$BUNDLE_FILE" ] || ut_die "bundle not found: $1"
}

# ut_parts_download <.parts.json address> <folder>: download a split bundle (the manifest, its
# signature and every part) into <folder> to carry to an offline host. Resumes: parts already
# there and intact are kept, a part cut short is continued. Every part is checked.
ut_parts_download() {
  case "$1" in https://*.parts.json|http://*.parts.json|file://*.parts.json) : ;; *) ut_die "--from needs the address of a bundle's .parts.json file" ;; esac
  _pd_base=${1%/*}; _pd_m=${1##*/}
  mkdir -p "$2"; _pd_o=$(cd "$2" && pwd)
  ut_step "Downloading $_pd_m"
  ut_get "$1" "$_pd_o/$_pd_m" || ut_die "could not download $1"
  ut_get "$1.sig" "$_pd_o/$_pd_m.sig" || ut_die "could not download $1.sig (the parts can't be checked without it)"
  ut_verify_sig "$_pd_o/$_pd_m" "$_pd_o/$_pd_m.sig" "$KEY" || ut_die "signature check FAILED: $_pd_m was not signed by the UserTasks release key"
  ut_ok "signature of $_pd_m"
  _pd_l="$DIR/releases/.parts.list"; ut_parts_read "$_pd_o/$_pd_m" "$_pd_l"
  while read -r _pd_i _pd_n _pd_s _pd_h; do
    _pd_f="$_pd_o/$_pd_n"; _pd_rc=0; ut_parts_part_ok "$_pd_f" "$_pd_s" "$_pd_h" || _pd_rc=$?
    if [ "$_pd_rc" = 0 ]; then ut_ok "part $_pd_i of $PARTS_N already here ($_pd_n)"; continue; fi
    # A complete part that fails its check (or an over-long one) is downloaded again from the start.
    if [ -f "$_pd_f" ] && [ "$(wc -c < "$_pd_f" | tr -d ' ')" -ge "$_pd_s" ]; then rm -f "$_pd_f"; fi
    ut_step "Downloading part $_pd_i of $PARTS_N ($_pd_n, $((_pd_s / 1048576)) MB)"
    ut_get_resume "$_pd_base/$_pd_n" "$_pd_f" || ut_die "the download of part $_pd_i of $PARTS_N stopped: run the same command again to resume it"
    _pd_rc=0; ut_parts_part_ok "$_pd_f" "$_pd_s" "$_pd_h" || _pd_rc=$?
    if [ "$_pd_rc" != 0 ]; then rm -f "$_pd_f"; ut_die "part $_pd_i of $PARTS_N ($_pd_n) arrived damaged (checksum mismatch): run the same command again to download it again"; fi
    ut_ok "part $_pd_i of $PARTS_N ($_pd_n, checksum)"
  done < "$_pd_l"
  rm -f "$_pd_l"
  ut_say ""
  ut_say "${UT_G}${UT_B}Offline bundle ready:${UT_N} $_pd_o ($PARTS_N parts of $PARTS_NAME, $((PARTS_SIZE / 1048576)) MB in all; signature and checksums verified)"
  ut_say "Carry these to the offline host, in one folder: $_pd_m, $_pd_m.sig and the $PARTS_N .part-NNN files,"
  ut_say "with this installer (https://usertasks.com/install.sh) and your licence file. There:"
  ut_say "  sh install.sh --bundle <folder> --licence <your .licence file>"
  ut_say "(it checks the signature and every part, then joins them). Upgrades: usertasks upgrade --bundle <folder>"
}

ut_get_resume() { # <url> <file>: continues a partial <file>
  if ut_have curl; then
    if [ -t 2 ]; then curl -fL --retry 3 --connect-timeout 20 -C - -# -o "$2" "$1"; else curl -fsSL --retry 3 --connect-timeout 20 -C - -o "$2" "$1"; fi
  elif ut_have wget; then wget -q -c -O "$2" "$1"
  else ut_die "curl or wget is needed"; fi
}

ut_key_fingerprint() {
  _o=openssl; for _c in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do [ -x "$_c" ] && _o=$_c; done
  if ut_have "$_o"; then "$_o" pkey -pubin -in "$KEY" -outform DER 2>/dev/null | { if ut_have sha256sum; then sha256sum; else shasum -a 256; fi; } | cut -d' ' -f1 | sed 's/../&:/g; s/:$//' | cut -c1-47
  else printf 'unavailable (no openssl)'; fi
}

ut_colors
ut_install "$@"
