# usertasks-host-wrapper: the `usertasks` command of a one-line (Docker) install on Windows.
#
#   usertasks status                       version, containers, health, setup state
#   usertasks logs [-f] [--tail N] [svc]   container logs (docker compose logs)
#   usertasks backup [-Out <dir>]          database dump + files + .env, in backups\
#   usertasks restore <backup|latest> [-Yes]
#   usertasks upgrade [-To <version>] [-Yes] [-SkipBackup] [-AllowDowngrade] [-Build]
#                     [-Edition enterprise|sharepoint|core] [-Licence <file>] [-Bundle <offline bundle>]
#                     (a bundle: its .tar, or its parts: the .parts.json or the folder holding them)
#   usertasks bundle-download [-Edition enterprise] -Licence <file> [-Version <v>] [-Platform linux/amd64] [-Out <file.tar>]
#   usertasks config [-Preset <name>] [-Force]   re-run the service choices
#   usertasks setup-code                   a new first-run setup code for /setup
#   usertasks admin <args>                 usertasks-admin inside the app container
#   usertasks start | stop | restart
#   usertasks uninstall [-Purge] [-Yes]    stop and remove (data kept unless -Purge)
#   usertasks version | help
#   usertasks cli <args>                   the UserTasks CLI (npm @user-tasks/cli), if installed
#
# The same commands as the sh wrapper (deploy/install/usertasks). Windows PowerShell 5.1 and PowerShell 7.
# Docs: /docs/self-hosting/install and /docs/self-hosting/upgrade.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:WrapperMark = 'usertasks-host-wrapper'
$script:DefaultReleaseBase = 'https://github.com/homepresso/User-Tasks/releases'
$script:VerifyImage = 'node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a'
$script:PgClientImage = 'postgres:17-alpine'
$script:AssumeYes = $false

# ── output and prompts ──────────────────────────────────────────────────────

function Say([string]$m) { Write-Host $m }
function Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "  ok  $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Warning $m }
function Fail([string]$m) { Write-Host "usertasks: $m" -ForegroundColor Red; exit 1 }
function Test-Interactive { ($env:USERTASKS_NONINTERACTIVE -ne '1') -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected }
function Ask([string]$prompt, [string]$default) {
  if (-not (Test-Interactive)) { return $default }
  if ($default) { $a = Read-Host "$prompt [$default]" } else { $a = Read-Host $prompt }
  if ($a) { return $a } else { return $default }
}
function Ask-Secret([string]$prompt) {
  if (-not (Test-Interactive)) { return '' }
  $s = Read-Host $prompt -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
function Confirm-Step([string]$prompt, [bool]$default) {
  if ($script:AssumeYes) { return $true }
  if (-not (Test-Interactive)) { return $default }
  $d = 'y/N'; if ($default) { $d = 'Y/n' }
  $a = Read-Host "$prompt [$d]"
  if (-not $a) { return $default }
  return ($a -match '^[Yy]')
}

# ── helpers ─────────────────────────────────────────────────────────────────

function Get-RandomHex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}
function New-SetupCode {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $b = New-Object byte[] 12
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  $s = ($b | ForEach-Object { $alphabet[$_ % 32] }) -join ''
  return "$($s.Substring(0,4))-$($s.Substring(4,4))-$($s.Substring(8,4))"
}
function Test-PortBusy([int]$port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $port); $c.Close(); return $true } catch { return $false }
}
function Get-FreePort([int]$port) { while (Test-PortBusy $port) { $port++ }; return $port }
function Get-Stamp { (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') }
function Test-HttpOk([string]$url) {
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $url; return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) } catch { return $false }
}
function Compare-Version([string]$a, [string]$b) {
  $pa = ($a -replace '-.*$', '').Split('.'); $pb = ($b -replace '-.*$', '').Split('.')
  for ($i = 0; $i -lt 3; $i++) { if ([int]$pa[$i] -lt [int]$pb[$i]) { return -1 }; if ([int]$pa[$i] -gt [int]$pb[$i]) { return 1 } }
  $ra = $a.Contains('-'); $rb = $b.Contains('-')
  if ($ra -and -not $rb) { return -1 }; if ($rb -and -not $ra) { return 1 }
  return [string]::CompareOrdinal($a, $b) | ForEach-Object { [math]::Sign($_) }
}
function Test-Version([string]$v) { return ($v -match '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$') }

# ── env files (KEY=value; never executed) ───────────────────────────────────

function Get-EnvValue([string]$key, [string]$file) {
  if (-not (Test-Path $file)) { return '' }
  $v = ''
  foreach ($l in [IO.File]::ReadAllLines($file)) { if ($l.StartsWith("$key=")) { $v = $l.Substring($key.Length + 1) } }
  return $v.Trim('"')
}
function Set-EnvValue([string]$key, [string]$value, [string]$file) {
  $lines = New-Object System.Collections.Generic.List[string]
  $done = $false
  if (Test-Path $file) {
    foreach ($l in [IO.File]::ReadAllLines($file)) {
      if ($l.StartsWith("$key=")) { if (-not $done) { $lines.Add("$key=$value"); $done = $true } }
      else { $lines.Add($l) }
    }
  }
  if (-not $done) { $lines.Add("$key=$value") }
  $tmp = "$file.tmp"
  [IO.File]::WriteAllText($tmp, (($lines -join "`n") + "`n"))
  Move-Item -Force $tmp $file
}
function Protect-File([string]$file) {
  if ($env:OS -ne 'Windows_NT') { & chmod 600 $file; return }
  try { & icacls $file /inheritance:r /grant:r "$($env:USERNAME):(R,W)" *> $null } catch { }
}

# ── state ───────────────────────────────────────────────────────────────────

function Initialize-State([string]$dir) {
  $script:Dir = $dir
  $script:StateFile = Join-Path $dir 'state.env'
  $script:EnvFile = Join-Path $dir '.env'
  $script:Version = Get-EnvValue 'USERTASKS_VERSION' $script:StateFile
  $script:Image = Get-EnvValue 'USERTASKS_IMAGE' $script:StateFile
  $script:Project = Get-EnvValue 'USERTASKS_PROJECT' $script:StateFile
  $script:Preset = Get-EnvValue 'USERTASKS_PRESET' $script:StateFile
  $script:Profiles = Get-EnvValue 'USERTASKS_COMPOSE_PROFILES' $script:StateFile
  $script:Edition = Get-EnvValue 'USERTASKS_EDITION' $script:StateFile
  $script:EditionVersion = Get-EnvValue 'USERTASKS_EDITION_VERSION' $script:StateFile
  $rb = $env:USERTASKS_RELEASE_BASE
  if (-not $rb) { $rb = Get-EnvValue 'USERTASKS_RELEASE_BASE' $script:StateFile }
  if (-not $rb) { $rb = $script:DefaultReleaseBase }
  $script:ReleaseBase = $rb
  $script:Rel = Join-Path $dir "releases\$($script:Version)"
  $p = Get-EnvValue 'APP_PORT' $script:EnvFile; if (-not $p) { $p = '3000' }
  $script:Port = $p
  $u = Get-EnvValue 'APP_URL' $script:EnvFile; if (-not $u) { $u = "http://localhost:$p" }
  $script:AppUrl = $u
}
function Find-Dir {
  if ($env:USERTASKS_DIR) { $d = $env:USERTASKS_DIR } else { $d = Split-Path -Parent (Split-Path -Parent $PSCommandPath) }
  if (-not (Test-Path (Join-Path $d 'state.env'))) { Fail "no UserTasks install found (looked in $d; set USERTASKS_DIR)" }
  return $d
}
function Save-State {
  $lines = @(
    '# UserTasks install state (written by usertasks; not secret)',
    "USERTASKS_VERSION=$($script:Version)", "USERTASKS_IMAGE=$($script:Image)", "USERTASKS_PROJECT=$($script:Project)",
    "USERTASKS_PRESET=$($script:Preset)", "USERTASKS_COMPOSE_PROFILES=$($script:Profiles)"
  )
  if ($script:Edition) { $lines += "USERTASKS_EDITION=$($script:Edition)"; if ($script:EditionVersion) { $lines += "USERTASKS_EDITION_VERSION=$($script:EditionVersion)" } }
  if ($env:USERTASKS_RELEASE_BASE) { $lines += "USERTASKS_RELEASE_BASE=$($env:USERTASKS_RELEASE_BASE)" }
  if ($script:PrevVersion) { $lines += "USERTASKS_PREVIOUS_VERSION=$($script:PrevVersion)"; $lines += "USERTASKS_PREVIOUS_IMAGE=$($script:PrevImage)" }
  $lines += "USERTASKS_UPDATED=$(Get-Stamp)"
  [IO.File]::WriteAllText("$($script:StateFile).tmp", (($lines -join "`n") + "`n"))
  Move-Item -Force "$($script:StateFile).tmp" $script:StateFile
}
function Enter-Lock {
  $l = Join-Path $script:Dir '.lock'
  try { New-Item -ItemType Directory -Path $l -ErrorAction Stop | Out-Null } catch { Fail "another usertasks command is running (remove $l if not)" }
  $script:LockDir = $l
}
function Exit-Lock { if ($script:LockDir) { Remove-Item -Force -Recurse $script:LockDir -ErrorAction SilentlyContinue } }

# ── docker compose ──────────────────────────────────────────────────────────

function Invoke-ComposeFor([string]$rel, [string]$image, [string[]]$composeArgs) {
  $a = @('compose', '-p', $script:Project)
  foreach ($p in ($script:Profiles -split ',')) { if ($p) { $a += @('--profile', $p) } }
  $a += @('--project-directory', $rel, '-f', (Join-Path $rel 'docker-compose.yml'), '--env-file', $script:EnvFile)
  $env:USERTASKS_ENV_FILE = $script:EnvFile
  $env:USERTASKS_IMAGE = $image
  # Out-Host: the output is shown, not returned (a function returns every uncaptured line).
  & docker @a @composeArgs | Out-Host
  return $LASTEXITCODE
}
function Invoke-Compose([string[]]$composeArgs) { return (Invoke-ComposeFor $script:Rel $script:Image $composeArgs) }
function Test-UsesBundledPostgres { return (",$($script:Profiles)," -like '*,standalone,*') }
function Test-AppRunning {
  $env:USERTASKS_ENV_FILE = $script:EnvFile; $env:USERTASKS_IMAGE = $script:Image
  $a = @('compose', '-p', $script:Project, '--project-directory', $script:Rel, '-f', (Join-Path $script:Rel 'docker-compose.yml'), '--env-file', $script:EnvFile, 'ps', '-q', '--status', 'running', 'app')
  $id = & docker @a 2>$null
  return [bool]$id
}
function Invoke-Admin([string[]]$adminArgs) {
  if (Test-AppRunning) { return (Invoke-Compose (@('exec', '-T', 'app', 'node', 'admin.cjs') + $adminArgs)) }
  return (Invoke-Compose (@('run', '--rm', '--no-deps', '-T', 'app', 'node', 'admin.cjs') + $adminArgs))
}
function Get-AdminOutput([string[]]$adminArgs) {
  $env:USERTASKS_ENV_FILE = $script:EnvFile; $env:USERTASKS_IMAGE = $script:Image
  $a = @('compose', '-p', $script:Project, '--project-directory', $script:Rel, '-f', (Join-Path $script:Rel 'docker-compose.yml'), '--env-file', $script:EnvFile, 'exec', '-T', 'app', 'node', 'admin.cjs') + $adminArgs
  return ((& docker @a 2>$null) -join "`n")
}
function Wait-Healthy([int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) { if (Test-HttpOk "http://127.0.0.1:$($script:Port)/api/config/public") { return $true }; Start-Sleep -Seconds 3 }
  return $false
}
function Test-RunningImage([string]$image) {
  $env:USERTASKS_ENV_FILE = $script:EnvFile; $env:USERTASKS_IMAGE = $image
  $a = @('compose', '-p', $script:Project, '--project-directory', $script:Rel, '-f', (Join-Path $script:Rel 'docker-compose.yml'), '--env-file', $script:EnvFile, 'ps', '-q', 'app')
  $cid = (& docker @a 2>$null) | Select-Object -First 1
  if (-not $cid) { return $false }
  $want = & docker image inspect --format '{{.Id}}' $image 2>$null
  return ($want -and ((& docker inspect --format '{{.Image}}' $cid) -eq $want))
}
function Start-Stack([string]$image, [int]$timeout) {
  Step "Starting UserTasks (project $($script:Project))"
  if ((Invoke-ComposeFor $script:Rel $image @('up', '-d', '--wait', '--wait-timeout', "$timeout", '--no-build', '--pull', 'missing', '--remove-orphans')) -ne 0) {
    # A slow or busy machine can miss the container health check's window: keep waiting for the app itself.
    Warn "not healthy yet; waiting up to $timeout more seconds"
  }
  Step "Waiting for http://127.0.0.1:$($script:Port)"
  if (-not (Wait-Healthy $timeout)) { return $false }
  Ok "UserTasks answers on port $($script:Port)"
  return $true
}
function Build-FromSource([string]$version) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'building locally needs git' }
  $mem = [int64](& docker info --format '{{.MemTotal}}' 2>$null)
  if ($mem -lt 9500000000) { Warn "Docker has $([math]::Round($mem / 1GB)) GB of memory; the build needs about 10 GB."; if (-not (Confirm-Step 'Build anyway?' $false)) { Fail 'not building' } }
  $src = Join-Path $script:Dir "build\usertasks-$version"
  if (Test-Path $src) { Remove-Item -Recurse -Force $src }
  Step "Building UserTasks $version from source (10 to 20 minutes)"
  $repo = $env:USERTASKS_SOURCE_REPO; if (-not $repo) { $repo = 'https://github.com/homepresso/User-Tasks.git' }
  & git clone --depth 1 --branch "v$version" $repo $src | Out-Host; if ($LASTEXITCODE -ne 0) { Fail 'git clone failed' }
  $img = "usertasks:$version-local"
  & docker build -t $img $src | Out-Host; if ($LASTEXITCODE -ne 0) { Fail 'docker build failed' }
  Remove-Item -Recurse -Force $src
  return $img
}

# ── releases ────────────────────────────────────────────────────────────────

function Test-Signature([string]$data, [string]$sig, [string]$key) {
  foreach ($o in @('openssl', "$env:ProgramFiles\Git\usr\bin\openssl.exe", "$env:ProgramFiles\Git\mingw64\bin\openssl.exe")) {
    $cmd = Get-Command $o -ErrorAction SilentlyContinue
    if ($cmd -and ((& $cmd.Source version 2>$null) -match '^OpenSSL ([3-9]|[1-9][0-9])\.')) {
      & $cmd.Source pkeyutl -verify -pubin -inkey $key -rawin -in $data -sigfile $sig *> $null
      return ($LASTEXITCODE -eq 0)
    }
  }
  $js = "const c=require('crypto'),f=require('fs');const [d,s,k]=process.argv.slice(-3);process.exit(c.verify(null,f.readFileSync(d),c.createPublicKey(f.readFileSync(k)),f.readFileSync(s))?0:1)"
  $vd = Join-Path $script:Dir ('.verify-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $vd | Out-Null
  try {
    [IO.File]::WriteAllText((Join-Path $vd 'verify.js'), $js)
    Copy-Item $data (Join-Path $vd 'd'); Copy-Item $sig (Join-Path $vd 's'); Copy-Item $key (Join-Path $vd 'k')
    if (Get-Command node -ErrorAction SilentlyContinue) { & node (Join-Path $vd 'verify.js') (Join-Path $vd 'd') (Join-Path $vd 's') (Join-Path $vd 'k') }
    else { & docker run --rm --network none -v "${vd}:/v:ro" $script:VerifyImage node /v/verify.js /v/d /v/s /v/k }
    return ($LASTEXITCODE -eq 0)
  } finally { Remove-Item -Recurse -Force $vd -ErrorAction SilentlyContinue }
}
function Get-LatestVersion {
  try { $v = (Invoke-RestMethod -UseBasicParsing "$($script:ReleaseBase)/latest/download/release.json").version } catch { Fail "could not read the latest release from $($script:ReleaseBase)" }
  if (-not (Test-Version $v)) { Fail 'the latest release has no valid version' }
  return $v
}
function Get-RelFile([string]$src, [string]$url, [string]$name, [string]$dest) {
  if ($src) { if (-not (Test-Path (Join-Path $src $name))) { throw "$name is not in $src" }; Copy-Item (Join-Path $src $name) $dest }
  else { Invoke-WebRequest -UseBasicParsing "$url/$name" -OutFile $dest }
}
# Get-Release <version> [folder]: download (or copy from [folder]: an offline bundle's release\), verify, unpack.
function Get-Release([string]$v, [string]$src = '') {
  $dest = Join-Path $script:Dir "releases\$v"
  if ((Test-Path (Join-Path $dest '.verified')) -and (Test-Path (Join-Path $dest 'manifest.json'))) { Ok "release $v already downloaded and verified"; return }
  $key = Join-Path $script:Dir 'release-key.pub.pem'
  if (-not (Test-Path $key)) { Fail "no release signing key in ${key}: re-run the installer" }
  $dl = Join-Path $script:Dir "releases\.download-$v"
  if (Test-Path $dl) { Remove-Item -Recurse -Force $dl }
  New-Item -ItemType Directory -Path $dl | Out-Null
  $url = "$($script:ReleaseBase)/download/v$v"; $bundle = "usertasks-$v.tar.gz"
  if ($src) { Step "Checking UserTasks $v from $src" } else { Step "Downloading UserTasks $v" }
  try {
    Get-RelFile $src $url 'SHA256SUMS' (Join-Path $dl 'SHA256SUMS')
    Get-RelFile $src $url 'SHA256SUMS.sig' (Join-Path $dl 'SHA256SUMS.sig')
  } catch { Fail "release v$v not found at $url" }
  if (-not (Test-Signature (Join-Path $dl 'SHA256SUMS') (Join-Path $dl 'SHA256SUMS.sig') $key)) { Fail "signature check FAILED for v${v}: SHA256SUMS was not signed by the UserTasks release key. Nothing was changed." }
  Ok 'signature of SHA256SUMS'
  $want = $null
  foreach ($l in Get-Content (Join-Path $dl 'SHA256SUMS')) { if ($l -match '^([0-9a-f]{64}) [ *](.+)$' -and $Matches[2] -eq $bundle) { $want = $Matches[1] } }
  if (-not $want) { Fail "SHA256SUMS does not list $bundle" }
  Get-RelFile $src $url $bundle (Join-Path $dl $bundle)
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $dl $bundle)).Hash.ToLowerInvariant() -ne $want) { Fail "checksum mismatch for ${bundle}: the download is damaged or was changed. Nothing was changed." }
  Ok "checksum of $bundle"
  $x = Join-Path $dl 'x'; New-Item -ItemType Directory -Path $x | Out-Null
  & tar -xzf (Join-Path $dl $bundle) -C $x; if ($LASTEXITCODE -ne 0) { Fail "could not unpack $bundle" }
  $top = Join-Path $x "usertasks-$v"
  if ((Get-Content -Raw (Join-Path $top 'manifest.json') | ConvertFrom-Json).version -ne $v) { Fail "$bundle is not version $v" }
  Copy-Item (Join-Path $dl 'SHA256SUMS'), (Join-Path $dl 'SHA256SUMS.sig') $top
  New-Item -ItemType File -Path (Join-Path $top '.verified') | Out-Null
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Move-Item $top $dest; Remove-Item -Recurse -Force $dl
}
function Get-ReleaseImage([string]$rel) {
  if ($env:USERTASKS_IMAGE_OVERRIDE) { return $env:USERTASKS_IMAGE_OVERRIDE }
  $m = Get-Content -Raw (Join-Path $rel 'manifest.json') | ConvertFrom-Json
  if ($m.imageDigest) { return "$($m.image)@$($m.imageDigest)" }
  return $m.image
}
function Ensure-Image([string]$image, [bool]$allowBuild, [string]$version) {
  & docker image inspect $image *> $null
  if ($LASTEXITCODE -eq 0) { return $image }
  Step "Pulling $image"
  & docker pull $image | Out-Host
  if ($LASTEXITCODE -eq 0) { return $image }
  if ($allowBuild -or (Confirm-Step 'The image could not be downloaded. Build it locally from source (needs ~10 GB of memory for Docker, 10-20 minutes)?' $false)) { return (Build-FromSource $version) }
  Fail "could not pull $image (re-run with -Build to build it locally)"
}

# ── editions: licence-gated images (-Edition enterprise) ────────────────────
# enterprise: one image with every paid extension, each unlocked by its own
# licence (a licence alone picks it); sharepoint: the older SharePoint edition,
# which usertasks.com now serves the Enterprise image under.
# The same flow as the sh wrapper: usertasks.com checks the licence and returns
# a 30-minute read-only credential for its registry front with the edition
# manifest (edition.json) signed by the release key; the image is pulled by the
# signed digest, checked against it and tagged <registry>/<repository>:<edition version>.

$script:EditionApi = $env:USERTASKS_EDITION_API
if (-not $script:EditionApi) { $script:EditionApi = 'https://usertasks.com/api/public/extensions' }
$script:Ed = $null; $script:EditionError = ''; $script:EditionErrorCode = ''

$script:EditionsList = 'enterprise, sharepoint'
function Test-Edition([string]$e) { return ($e -eq 'enterprise' -or $e -eq 'sharepoint') }
function Get-EditionName([string]$e) { if ($e -eq 'enterprise') { return 'UserTasks Enterprise' }; if ($e -eq 'sharepoint') { return 'UserTasks for SharePoint Server' }; return "the $e edition" }
# The paid extensions whose licence opens an edition (the installed licence is exported for the first that has one).
function Get-EditionExtensions([string]$e) { if ($e -eq 'enterprise') { return @('sharepoint', 'infrastructure', 'processing') }; return @($e) }
# A refusal an implicit Enterprise install may fall back from (never a licence refusal).
function Test-EditionFallback([string]$code) { return ($code -in @('', 'edition_not_found', 'editions_unavailable', 'upstream_error', 'offline')) }
function Get-EditionLatestCore([string]$e) {
  try { $r = Invoke-RestMethod -UseBasicParsing "$($script:EditionApi)/$e"; if (Test-Version ([string]$r.latest_core_version)) { return [string]$r.latest_core_version } } catch { }
  return ''
}
# The licence to send, kept as licences\<edition>.licence: an explicit file, else the
# licence installed in UserTasks (usertasks-admin licence export), else the kept copy.
function Get-EditionLicence([string]$e, [string]$file) {
  $dir = Join-Path $script:Dir 'licences'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $keep = Join-Path $dir "$e.licence"
  if ($file) {
    if (-not (Test-Path $file)) { Fail "licence file not found: $file" }
    Copy-Item -Force $file $keep; Protect-File $keep
  } elseif ($script:Image -and $script:Project -and (Test-Path $script:StateFile)) {
    foreach ($x in (Get-EditionExtensions $e)) {
      $out = Get-AdminOutput @('licence', 'export', '--ext', $x)
      if ($out -match '"licence_id"') { [IO.File]::WriteAllText($keep, $out + "`n"); Protect-File $keep; break }
    }
  }
  $sp = Join-Path $dir 'sharepoint.licence'
  if (-not (Test-Path $keep) -and $e -eq 'enterprise' -and (Test-Path $sp)) { Copy-Item -Force $sp $keep; Protect-File $keep }
  if (-not (Test-Path $keep)) { Fail "$(Get-EditionName $e) needs a licence: pass -Licence <file> (your trial or purchased .licence file; licences: https://usertasks.com/extensions, a SharePoint trial: https://usertasks.com/sharepoint/trial)" }
  return $keep
}
function Test-EditionImage([string]$image, [string]$manifest) {
  $id = (& docker image inspect --format '{{.Id}}' $image 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $id -or -not ([string]$id).StartsWith('sha256:')) { return $false }
  return ((Get-Content -Raw $manifest).Contains('"' + $id + '"'))
}
function Test-EditionManifest([string]$dir, [string]$key, [string]$e) {
  if (-not (Test-Signature (Join-Path $dir 'edition.json') (Join-Path $dir 'edition.json.sig') $key)) { $script:EditionError = 'signature check FAILED: edition.json was not signed by the UserTasks release key'; return $null }
  $m = Get-Content -Raw (Join-Path $dir 'edition.json') | ConvertFrom-Json
  if ($m.kind -ne 'usertasks.edition' -or $m.edition -ne $e) { $script:EditionError = "edition.json is not a $(Get-EditionName $e) manifest"; return $null }
  Ok 'signature of the edition manifest'
  return $m
}
# Request-Edition: the licence check and the download details; $false with $script:EditionError when refused.
function Request-Edition([string]$e, [string]$licence, [string]$version, [string]$purpose, [string]$work, [string]$key) {
  $script:EditionError = ''; $script:EditionErrorCode = ''
  if (Test-Path $work) { Remove-Item -Recurse -Force $work }
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $body = @{ licence = [Convert]::ToBase64String([IO.File]::ReadAllBytes($licence)); version = $version; purpose = $purpose } | ConvertTo-Json -Compress
  Step "Checking the licence with usertasks.com ($(Get-EditionName $e))"
  try {
    $r = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$($script:EditionApi)/$e/pull-token" -ContentType 'application/json' -Body $body -UserAgent 'usertasks-installer/ps1'
  } catch {
    $msg = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { try { $j = $_.ErrorDetails.Message | ConvertFrom-Json; $msg = [string]$j.error; $script:EditionErrorCode = [string]$j.code } catch { } }
    if (-not $_.Exception.Response) { $script:EditionErrorCode = 'offline'; $msg = "could not reach $($script:EditionApi) (check the network or proxy settings; offline hosts: usertasks bundle-download on a connected machine)" }
    if (-not $msg) { $msg = "the download was refused ($($_.Exception.Message))" }
    $script:EditionError = $msg
    return $false
  }
  if ([string]$r.registry -notmatch '^[a-z0-9.-]+(:[0-9]+)?$' -or [string]$r.repository -notmatch '^[a-z0-9][a-z0-9/._-]*$' -or [string]$r.index_digest -notmatch '^sha256:[0-9a-f]{64}$' -or -not (Test-Version ([string]$r.core_version)) -or -not $r.password) {
    $script:EditionError = 'usertasks.com sent an answer this installer does not understand'; return $false
  }
  [IO.File]::WriteAllBytes((Join-Path $work 'edition.json'), [Convert]::FromBase64String([string]$r.edition_manifest))
  [IO.File]::WriteAllBytes((Join-Path $work 'edition.json.sig'), [Convert]::FromBase64String([string]$r.edition_signature))
  $m = Test-EditionManifest $work $key $e
  if (-not $m) { return $false }
  if ($m.edition_version -ne $r.edition_version -or $m.index_digest -ne $r.index_digest -or $m.core_version -ne $r.core_version) { $script:EditionError = 'the download details do not match the signed edition manifest'; return $false }
  if ($version -ne 'latest' -and $version -ne $r.core_version -and $version -ne $r.edition_version) { $script:EditionError = "asked for $version but got the edition for $($r.core_version)"; return $false }
  $script:Ed = @{ edition = $e; registry = [string]$r.registry; repository = [string]$r.repository; username = [string]$r.username; password = [string]$r.password
    version = [string]$r.edition_version; core = [string]$r.core_version; digest = [string]$r.index_digest; work = $work; at = (Get-Date) }
  $trial = ''; if ($r.trial -eq $true) { $trial = ' (trial)' }
  Ok "licence accepted$trial, valid until $($r.licence_expires_at); edition $($r.edition_version)"
  return $true
}
# Invoke-EditionPull [platform]: pull by the signed digest, check, tag. Returns the tag, or '' with $script:EditionError.
function Invoke-EditionPull([string]$platform) {
  $ed = $script:Ed
  $ref = "$($ed.registry)/$($ed.repository)@$($ed.digest)"; $tag = "$($ed.registry)/$($ed.repository):$($ed.version)"
  $manifest = Join-Path $ed.work 'edition.json'
  if (-not $platform -and (Test-EditionImage $tag $manifest)) { Ok "image $tag is present and matches the signed manifest"; return $tag }
  Step "Pulling $(Get-EditionName $ed.edition) $($ed.version)"
  $ed.password | & docker login $ed.registry -u $ed.username --password-stdin *> $null
  if ($LASTEXITCODE -ne 0) { $script:EditionError = "docker login to $($ed.registry) failed (the download credential may have expired: run the command again)"; return '' }
  if ($platform) { & docker pull --platform $platform $ref | Out-Host } else { & docker pull $ref | Out-Host }
  $rc = $LASTEXITCODE
  & docker logout $ed.registry *> $null
  $ed.password = ''
  if ($rc -ne 0) { $script:EditionError = "could not pull the $(Get-EditionName $ed.edition) image from $($ed.registry)"; return '' }
  if (-not (Test-EditionImage $ref $manifest)) { $script:EditionError = 'the pulled image is not the one the signed edition manifest names: not used'; return '' }
  & docker tag $ref $tag | Out-Null
  Ok "image verified against the signed manifest ($($ed.digest))"
  return $tag
}
function Save-EditionManifest {
  $keep = Join-Path $script:Dir "editions\$($script:Ed.version)"
  if ($script:Ed.work -ne $keep) {
    if (Test-Path $keep) { Remove-Item -Recurse -Force $keep }
    New-Item -ItemType Directory -Force -Path (Join-Path $script:Dir 'editions') | Out-Null
    Move-Item $script:Ed.work $keep; $script:Ed.work = $keep
  }
}
# Get-EditionImage: request (unless a fresh one is at hand) + pull for this install. Returns the tag or fails.
function Get-EditionImage([string]$e, [string]$licence, [string]$version, [string]$purpose, [string]$failSuffix) {
  $fresh = $script:Ed -and $script:Ed.edition -eq $e -and (((Get-Date) - $script:Ed.at).TotalSeconds -lt 1500)
  if (-not $fresh) {
    if (-not (Request-Edition $e $licence $version $purpose (Join-Path $script:Dir 'editions\.request') (Join-Path $script:Dir 'release-key.pub.pem'))) { Fail "$($script:EditionError)$failSuffix" }
  }
  Save-EditionManifest
  $img = Invoke-EditionPull ''
  if (-not $img) { Fail "$($script:EditionError)$failSuffix" }
  return $img
}
function Install-EditionLicence([string]$file) {
  if (-not $file -or -not (Test-Path $file)) { return }
  $env:USERTASKS_ENV_FILE = $script:EnvFile; $env:USERTASKS_IMAGE = $script:Image
  $a = @('compose', '-p', $script:Project, '--project-directory', $script:Rel, '-f', (Join-Path $script:Rel 'docker-compose.yml'), '--env-file', $script:EnvFile, 'exec', '-T', 'app', 'node', 'admin.cjs', 'licence', 'install', '/dev/stdin')
  Get-Content -Raw $file | & docker @a *> $null
  if ($LASTEXITCODE -eq 0) { Ok 'licence installed in UserTasks (Settings -> Licence)' } else { Warn 'could not install the licence automatically: add it in Settings -> Licence' }
}

# ── offline bundles (the same format as the sh wrapper) ─────────────────────

# ── split bundles (parts; the same format as the sh wrapper) ────────────
# A bundle over GitHub's 2 GiB release-asset limit comes in parts: <name>.tar.part-001 …,
# <name>.tar.parts.json (size + sha256 of the whole and of each part, in order) and
# <name>.tar.parts.json.sig (its ed25519 signature by the release key). The signature,
# then every part, then the joined file are checked before anything is unpacked.

function Read-Parts([string]$manifest) {
  $leaf = Split-Path -Leaf $manifest
  try { $m = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json } catch { Fail "$leaf is not a bundle parts manifest" }
  if ([string]$m.name -cnotmatch '^[A-Za-z0-9._-]+\.tar$' -or [string]$m.size -cnotmatch '^\d+$' -or [string]$m.sha256 -cnotmatch '^[0-9a-f]{64}$') { Fail "$leaf is not a bundle parts manifest" }
  $parts = @($m.parts)
  if ($parts.Count -lt 1) { Fail "$leaf lists no parts" }
  $sum = [int64]0; $i = 0
  foreach ($p in $parts) {
    $i++
    if ([string]$p.name -cne ('{0}.part-{1:D3}' -f $m.name, $i) -or [string]$p.size -cnotmatch '^\d+$' -or [string]$p.sha256 -cnotmatch '^[0-9a-f]{64}$') { Fail "$leaf lists an unexpected part (entry $i)" }
    $sum += [int64]$p.size
  }
  if ($sum -ne [int64]$m.size) { Fail "the parts in $leaf do not add up to the bundle size" }
  return $m
}

# Test-Part: 0 intact, 1 missing, 2 wrong size, 3 checksum mismatch.
function Test-Part([string]$file, $size, [string]$sha) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return 1 }
  if ((Get-Item -LiteralPath $file).Length -ne [int64]$size) { return 2 }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() -ne $sha) { return 3 }
  return 0
}

# Join-Parts: verify the signature and every part, join them (streamed) into $work, check the whole. Returns the .tar.
function Join-Parts([string]$manifest, [string]$key, [string]$work) {
  $dir = Split-Path -Parent $manifest; $leaf = Split-Path -Leaf $manifest
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { Fail "parts manifest not found: $manifest" }
  if (-not (Test-Path -LiteralPath "$manifest.sig" -PathType Leaf)) { Fail "$leaf.sig is missing: copy it next to $leaf (the parts can't be checked without it)" }
  if (-not (Test-Signature $manifest "$manifest.sig" $key)) { Fail "signature check FAILED: $leaf was not signed by the UserTasks release key. Nothing was installed." }
  Ok "signature of $leaf"
  $m = Read-Parts $manifest; $n = @($m.parts).Count
  Step "Checking the $n parts of $($m.name)"
  $i = 0
  foreach ($p in $m.parts) {
    $i++
    switch (Test-Part (Join-Path $dir $p.name) $p.size $p.sha256) {
      1 { Fail "part $i of $n ($($p.name)) is missing: copy it next to $leaf (or download it again)" }
      2 { Fail "part $i of $n ($($p.name)) is incomplete or damaged (wrong size): download it again" }
      3 { Fail "part $i of $n ($($p.name)) is damaged (checksum mismatch): download it again" }
    }
  }
  Ok "$n parts (sizes and checksums)"
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $out = Join-Path $work $m.name
  $os = [IO.File]::Create($out)
  try {
    foreach ($p in $m.parts) {
      $is = [IO.File]::OpenRead((Join-Path $dir $p.name))
      try { $is.CopyTo($os, 1048576) } finally { $is.Dispose() }
    }
  } finally { $os.Dispose() }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant() -ne $m.sha256) { Remove-Item -Force -LiteralPath $out; Fail "the joined bundle does not match ${leaf} (checksum mismatch): download the parts again" }
  Ok "joined $($m.name) (checksum)"
  return $out
}

# Resolve-Bundle: a bundle .tar, or its parts (the .parts.json, one of the parts, or the folder holding them).
function Resolve-Bundle([string]$path, [string]$key, [string]$work) {
  $m = ''
  if ($path -like '*.parts.json') { $m = $path }
  elseif ($path -match '\.part-\d{3}$') { $m = ($path -replace '\.part-\d{3}$', '') + '.parts.json' }
  elseif (Test-Path -LiteralPath $path -PathType Container) {
    $ms = @(Get-ChildItem -LiteralPath $path -File | Where-Object { $_.Name -like '*.parts.json' })
    if ($ms.Count -gt 1) { Fail "$path holds more than one bundle: name its .parts.json" }
    if ($ms.Count -eq 1) { $m = $ms[0].FullName }
    else {
      $ts = @(Get-ChildItem -LiteralPath $path -File | Where-Object { $_.Name -like '*.tar' })
      if ($ts.Count -ne 1) { Fail "$path has no offline bundle (a .tar, or the .part-NNN files with their .parts.json)" }
      $path = $ts[0].FullName
    }
  }
  if ($m) { return @{ File = (Join-Parts $m $key $work); Joined = $true } }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "bundle not found: $path" }
  return @{ File = $path; Joined = $false }
}

# Open-Bundle: a bundle (its .tar, or its parts), unpacked into releases\.bundle and checked. Returns its folder.
function Open-Bundle([string]$file) {
  if (-not (Test-Path $file)) { Fail "bundle not found: $file" }
  $join = Join-Path $script:Dir 'releases\.bundle-join'
  $rb = Resolve-Bundle $file (Join-Path $script:Dir 'release-key.pub.pem') $join
  $bo = Join-Path $script:Dir 'releases\.bundle'
  if (Test-Path $bo) { Remove-Item -Recurse -Force $bo }
  New-Item -ItemType Directory -Force -Path $bo | Out-Null
  Step "Unpacking $(Split-Path -Leaf $rb.File)"
  & tar -xf $rb.File -C $bo; if ($LASTEXITCODE -ne 0) { Fail "could not unpack $($rb.File)" }
  if ($rb.Joined) { Remove-Item -Recurse -Force $join }
  $bj = Get-ChildItem -Path $bo -Filter 'bundle.json' -Recurse -Depth 1 | Select-Object -First 1
  if (-not $bj) { Fail "$file is not a UserTasks offline bundle (no bundle.json)" }
  $dir = $bj.DirectoryName
  Test-Bundle $dir
  return $dir
}
function Test-Bundle([string]$dir) {
  $sums = Join-Path $dir 'SHA256SUMS.bundle'
  if (-not (Test-Path $sums)) { Fail 'the bundle has no SHA256SUMS.bundle' }
  foreach ($l in Get-Content $sums) {
    if ($l -notmatch '^([0-9a-f]{64})  (.+)$') { continue }
    $want = $Matches[1]; $f = $Matches[2]
    if ($f.StartsWith('/') -or $f.Contains('..')) { Fail "SHA256SUMS.bundle lists an unexpected path: $f" }
    $p = Join-Path $dir $f
    if (-not (Test-Path $p)) { Fail "the bundle is missing $f" }
    if ((Get-FileHash -Algorithm SHA256 $p).Hash.ToLowerInvariant() -ne $want) { Fail "checksum mismatch for ${f}: the bundle is damaged or was changed" }
  }
  Ok 'bundle checksums'
  $b = Get-Content -Raw (Join-Path $dir 'bundle.json') | ConvertFrom-Json
  if (-not (Test-Edition ([string]$b.edition))) { Fail "the bundle is for an unknown edition: $($b.edition)" }
  if (-not (Test-Version ([string]$b.core_version))) { Fail 'the bundle has no valid UserTasks version' }
  $script:Bundle = $b
}
# Import-Bundle: edition manifest signature, docker load, image check. Returns the image.
function Import-Bundle([string]$dir) {
  $b = $script:Bundle
  $m = Test-EditionManifest $dir (Join-Path $script:Dir 'release-key.pub.pem') ([string]$b.edition)
  if (-not $m) { Fail "$($script:EditionError). Nothing was installed." }
  if ($m.edition_version -ne $b.edition_version -or $m.core_version -ne $b.core_version) { Fail 'bundle.json does not match the signed edition manifest' }
  if (-not ([string]$b.image).EndsWith(":$($b.edition_version)")) { Fail "bundle.json names an unexpected image: $($b.image)" }
  Step 'Loading the images (docker load)'
  & docker load -i (Join-Path $dir 'images.tar') | Out-Null; if ($LASTEXITCODE -ne 0) { Fail 'docker load failed' }
  if (-not (Test-EditionImage ([string]$b.image) (Join-Path $dir 'edition.json'))) { Fail "the loaded image $($b.image) is not the one the signed edition manifest names. Nothing was started." }
  Ok "image $($b.image) verified against the signed manifest"
  $keep = Join-Path $script:Dir "editions\$($b.edition_version)"
  New-Item -ItemType Directory -Force -Path $keep | Out-Null
  Copy-Item -Force (Join-Path $dir 'edition.json'), (Join-Path $dir 'edition.json.sig') $keep
  return [string]$b.image
}
function Invoke-BundleDownload([string[]]$rest) {
  $e = ''; $lic = ''; $ver = ''; $plat = ''; $out = ''; $deps = $true
  for ($i = 0; $i -lt $rest.Count; $i++) {
    switch ($rest[$i]) {
      { $_ -in '-Edition', '--edition' } { $e = $rest[++$i] } { $_ -in '-Licence', '--licence', '-License', '--license' } { $lic = $rest[++$i] }
      { $_ -in '-Version', '--version' } { $ver = $rest[++$i].TrimStart('v') } { $_ -in '-Platform', '--platform' } { $plat = $rest[++$i] }
      { $_ -in '-Out', '--out' } { $out = $rest[++$i] } { $_ -in '-NoDeps', '--no-deps' } { $deps = $false } { $_ -in '-Work', '--work' } { $i++ }
      default { Fail "bundle-download: unknown option $($rest[$i])" }
    }
  }
  if (-not $e) { $e = 'enterprise' }
  if (-not (Test-Edition $e)) { Fail "bundle-download: unknown edition $e (editions: $($script:EditionsList))" }
  if ($lic) { if (-not (Test-Path $lic)) { Fail "licence file not found: $lic" }; $lic = (Resolve-Path $lic).Path }
  elseif (Test-Path (Join-Path $script:Dir 'state.env')) { $lic = Get-EditionLicence $e '' }
  else { Fail 'bundle-download: -Licence <file> is required' }
  if (-not $plat) { $plat = 'linux/amd64'; if ((& docker version --format '{{.Server.Arch}}' 2>$null) -match 'arm64|aarch64') { $plat = 'linux/arm64' } }
  if ($plat -notin 'linux/amd64', 'linux/arm64') { Fail '-Platform must be linux/amd64 or linux/arm64' }
  if (-not $ver) { $ver = Get-EditionLatestCore $e }
  if (-not (Test-Version $ver)) { Fail "could not find the newest $(Get-EditionName $e) build: pass -Version <x.y.z>" }
  $key = Join-Path $script:Dir 'release-key.pub.pem'
  if (-not (Test-Path $key)) { Fail "no release signing key in $key (use the installer: install.ps1 -BundleDownload ...)" }
  if (-not (Request-Edition $e $lic $ver 'bundle' (Join-Path $script:Dir 'editions\.bundle-request') $key)) { Fail $script:EditionError }
  $ed = $script:Ed
  $name = "usertasks-edition-$e-$($ed.version)-$($plat -replace '/', '-')"
  if (-not $out) { $out = Join-Path (Get-Location).Path "$name.tar" }
  $stage = Join-Path $script:Dir 'editions\.bundle-stage'
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  $s = Join-Path $stage $name; New-Item -ItemType Directory -Force -Path (Join-Path $s 'release') | Out-Null
  $url = "$($script:ReleaseBase)/download/v$($ed.core)"
  Step "Downloading UserTasks $($ed.core) (release files)"
  try {
    Invoke-WebRequest -UseBasicParsing "$url/SHA256SUMS" -OutFile (Join-Path $s 'release\SHA256SUMS')
    Invoke-WebRequest -UseBasicParsing "$url/SHA256SUMS.sig" -OutFile (Join-Path $s 'release\SHA256SUMS.sig')
  } catch { Fail "release v$($ed.core) not found at $url" }
  if (-not (Test-Signature (Join-Path $s 'release\SHA256SUMS') (Join-Path $s 'release\SHA256SUMS.sig') $key)) { Fail "signature check FAILED for release v$($ed.core)" }
  foreach ($f in @("usertasks-$($ed.core).tar.gz", 'install.sh', 'install.ps1')) {
    $want = $null
    foreach ($l in Get-Content (Join-Path $s 'release\SHA256SUMS')) { if ($l -match '^([0-9a-f]{64}) [ *](.+)$' -and $Matches[2] -eq $f) { $want = $Matches[1] } }
    if (-not $want) { Fail "SHA256SUMS does not list $f" }
    Invoke-WebRequest -UseBasicParsing "$url/$f" -OutFile (Join-Path $s "release\$f")
    if ((Get-FileHash -Algorithm SHA256 (Join-Path $s "release\$f")).Hash.ToLowerInvariant() -ne $want) { Fail "checksum mismatch for $f" }
  }
  Ok "release $($ed.core) (signature + checksums)"
  $img = Invoke-EditionPull $plat
  if (-not $img) { Fail $script:EditionError }
  $imgs = @($img)
  if ($deps) {
    $x = Join-Path $stage 'x'; New-Item -ItemType Directory -Force -Path $x | Out-Null
    & tar -xzf (Join-Path $s "release\usertasks-$($ed.core).tar.gz") -C $x
    $rel = Join-Path $x "usertasks-$($ed.core)"
    $env:USERTASKS_IMAGE = $img
    foreach ($i in (& docker compose -f (Join-Path $rel 'docker-compose.yml') --env-file (Join-Path $rel 'env.template') --profile standalone config --images 2>$null | Sort-Object -Unique)) {
      if (-not $i -or $i -eq $img) { continue }
      Step "Pulling $i ($plat)"; & docker pull --platform $plat $i | Out-Null
      if ($LASTEXITCODE -ne 0) { Fail "could not pull $i" }
      $imgs += $i
    }
    Remove-Item -Recurse -Force $x
  }
  Copy-Item (Join-Path $ed.work 'edition.json'), (Join-Path $ed.work 'edition.json.sig') $s
  Step "Saving the images ($($imgs.Count))"
  $raw = Join-Path $stage 'images.raw.tar'
  & docker save -o $raw @imgs; if ($LASTEXITCODE -ne 0) { Fail 'docker save failed' }
  # gzip, streamed: docker load reads it by its content (images.tar keeps its name for older installers).
  $is = [IO.File]::OpenRead($raw); $os = [IO.File]::Create((Join-Path $s 'images.tar'))
  try { $gz = New-Object IO.Compression.GZipStream($os, [IO.Compression.CompressionMode]::Compress); try { $is.CopyTo($gz, 1048576) } finally { $gz.Dispose() } }
  finally { $os.Dispose(); $is.Dispose() }
  Remove-Item -Force $raw
  $bundle = [ordered]@{ format = 1; kind = 'usertasks.bundle'; edition = $e; edition_version = $ed.version; core_version = $ed.core; platform = $plat; image = $img; images = ($imgs -join ' '); created_at = (Get-Stamp) }
  [IO.File]::WriteAllText((Join-Path $s 'bundle.json'), (($bundle | ConvertTo-Json) + "`n"))
  $lines = foreach ($f in @('bundle.json', 'edition.json', 'edition.json.sig', 'images.tar', 'release/SHA256SUMS', 'release/SHA256SUMS.sig', "release/usertasks-$($ed.core).tar.gz", 'release/install.sh', 'release/install.ps1')) {
    "$((Get-FileHash -Algorithm SHA256 (Join-Path $s $f)).Hash.ToLowerInvariant())  $f"
  }
  [IO.File]::WriteAllText((Join-Path $s 'SHA256SUMS.bundle'), (($lines -join "`n") + "`n"))
  Step "Writing $out"
  & tar -cf $out -C $stage $name; if ($LASTEXITCODE -ne 0) { Fail 'could not write the bundle (tar)' }
  Remove-Item -Recurse -Force $stage, $ed.work
  $sum = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$out.sha256", "$sum`n")
  Say ''; Write-Host "Offline bundle ready: $out" -ForegroundColor Green
  Say "  sha256:   $sum  (also in $(Split-Path -Leaf $out).sha256: compare it on the offline host)"
  Say "  contents: $(Get-EditionName $e) $($ed.version) ($plat), UserTasks $($ed.core) release, $($imgs.Count) images"
  Say 'On the offline host (Docker Desktop installed), with the bundle and your licence file:'
  Say "  tar -xf $(Split-Path -Leaf $out) $name/release/install.ps1"
  Say "  & .\$name\release\install.ps1 -Bundle .\$(Split-Path -Leaf $out) -Licence <your .licence file>"
  Say 'Upgrades: usertasks upgrade -Bundle <newer bundle>'
}

# ── service choices (the install profile) ───────────────────────────────────

function Test-ProfileCli([string]$image) {
  $h = (& docker run --rm --network none --entrypoint node $image admin.cjs --help 2>$null) -join "`n"
  return ($h -match 'usertasks-admin install presets')
}
function Read-Profile {
  $choice = $env:USERTASKS_PRESET_CHOICE
  if (-not $choice) {
    if (Test-Interactive) {
      Say ''
      Say 'Which services should UserTasks use?'
      Say '  1) Everything in containers (recommended): PostgreSQL, file storage (MinIO), email test inbox, worker'
      Say '  2) Your own PostgreSQL server; the rest in containers'
      Say '  3) A Supabase project (database, sign-in, files) with the app in a container'
      Say '  4) Custom: choose each service'
    }
    $cur = '1'; switch ($script:Preset) { 'postgres' { $cur = '2' } 'supabase' { $cur = '3' } 'custom' { $cur = '4' } }
    $choice = Ask 'Choose 1-4' $cur
  }
  switch ($choice) { { $_ -in '1', 'standalone' } { $p = 'standalone' } { $_ -in '2', 'postgres' } { $p = 'postgres' } { $_ -in '3', 'supabase' } { $p = 'supabase' } { $_ -in '4', 'custom' } { $p = 'custom' } default { Fail "unknown choice $choice" } }
  $script:Preset = $p; $script:Profiles = 'standalone'
  $a = @{ Db = 'bundled'; DbUrl = ''; Storage = 'minio'; Email = 'mailpit'; S3Endpoint = ''; S3Region = 'us-east-1'; S3Key = ''; S3Secret = ''
    SmtpHost = ''; SmtpPort = '587'; SmtpUser = ''; SmtpPass = ''; From = 'UserTasks <noreply@usertasks.local>'; SbUrl = ''; SbAnon = ''; SbService = '' }
  if ($p -eq 'postgres' -or ($p -eq 'custom' -and (Ask 'Database: 1) PostgreSQL in a container  2) your own PostgreSQL' '1') -eq '2')) {
    $a.Db = 'own'; $a.DbUrl = $env:USERTASKS_DATABASE_URL
    if (-not $a.DbUrl) { $a.DbUrl = Ask-Secret 'PostgreSQL connection string (postgresql://user:password@host:5432/db)' }
    if ($a.DbUrl -notmatch '^postgres(ql)?://') { Fail 'expected a postgresql:// connection string' }
  }
  if ($p -eq 'supabase') {
    $script:Profiles = ''; $a.Db = 'supabase'; $a.Storage = 'supabase'; $a.Email = 'console'
    $a.SbUrl = $env:USERTASKS_SUPABASE_URL; if (-not $a.SbUrl) { $a.SbUrl = Ask 'Supabase project URL (https://<ref>.supabase.co)' '' }
    $a.SbAnon = $env:USERTASKS_SUPABASE_ANON_KEY; if (-not $a.SbAnon) { $a.SbAnon = Ask-Secret 'Supabase anon (publishable) key' }
    $a.SbService = $env:USERTASKS_SUPABASE_SERVICE_ROLE_KEY; if (-not $a.SbService) { $a.SbService = Ask-Secret 'Supabase service role (secret) key' }
    $a.DbUrl = $env:USERTASKS_DATABASE_URL; if (-not $a.DbUrl) { $a.DbUrl = Ask-Secret 'Database connection string (used for migrations and backups)' }
    if (-not ($a.SbUrl -and $a.SbAnon -and $a.SbService -and $a.DbUrl)) { Fail 'the Supabase URL, keys and database connection string are required' }
    if (Test-Interactive) { Say 'Email: set up Resend, SMTP or Microsoft 365 later in Settings > Infrastructure (until then emails go to the log).' }
  }
  if ($p -eq 'custom') {
    if ((Ask 'Files: 1) MinIO in a container  2) your S3-compatible bucket' '1') -eq '2') {
      $a.Storage = 's3'; $a.S3Endpoint = Ask 'S3 endpoint (blank for AWS S3)' ''; $a.S3Region = Ask 'S3 region' 'us-east-1'
      $a.S3Key = Ask 'S3 access key id' ''; $a.S3Secret = Ask-Secret 'S3 secret access key'
    }
    if ((Ask 'Email: 1) test inbox in a container (Mailpit)  2) your SMTP relay' '1') -eq '2') {
      $a.Email = 'smtp'; $a.SmtpHost = Ask 'SMTP host' ''; $a.SmtpPort = Ask 'SMTP port' '587'; $a.From = Ask 'From address' 'UserTasks <tasks@example.com>'
      $a.SmtpUser = Ask 'SMTP user (blank for none)' ''
      if ($a.SmtpUser) { $a.SmtpPass = Ask-Secret 'SMTP password' }
    }
    if (Test-Interactive) { Say 'Sign-in: built-in accounts. Add SSO (Entra ID, AD FS, OIDC, SAML) later in Settings > Infrastructure.' }
  }
  $script:Answers = $a
}

# The install profile (docs/install-profile.md) for the answers; secrets come from .env.
function Write-ProfileJson {
  $a = $script:Answers; $e = $script:EnvFile
  switch ($a.Db) {
    'bundled' { $db = [ordered]@{ provider = 'postgres'; hosting = 'bundled'; host = 'postgres'; port = 5432; database = 'usertasks'; user = 'usertasks'; password = (Get-EnvValue 'POSTGRES_PASSWORD' $e); sslmode = 'disable' } }
    'own' { $db = [ordered]@{ provider = 'postgres'; hosting = 'own'; url = $a.DbUrl } }
    'supabase' { $db = [ordered]@{ provider = 'supabase'; url = $a.DbUrl } }
  }
  switch ($a.Storage) {
    'minio' { $st = [ordered]@{ provider = 's3'; options = [ordered]@{ endpoint = 'http://minio:9000'; region = 'us-east-1'; access_key_id = 'usertasks'; secret_access_key = (Get-EnvValue 'S3_SECRET_ACCESS_KEY' $e); force_path_style = 'true' } } }
    's3' { $fps = 'false'; if ($a.S3Endpoint) { $fps = 'true' }; $st = [ordered]@{ provider = 's3'; options = [ordered]@{ endpoint = $a.S3Endpoint; region = $a.S3Region; access_key_id = $a.S3Key; secret_access_key = $a.S3Secret; force_path_style = $fps } } }
    'supabase' { $st = [ordered]@{ provider = 'supabase' } }
  }
  switch ($a.Email) {
    'mailpit' { $em = [ordered]@{ provider = 'smtp'; smtpPreset = 'mailpit'; options = [ordered]@{ smtp_host = 'mailpit'; smtp_port = '1025'; from = $a.From } } }
    'smtp' { $o = [ordered]@{ smtp_host = $a.SmtpHost; smtp_port = $a.SmtpPort; from = $a.From }; if ($a.SmtpUser) { $o.smtp_user = $a.SmtpUser; $o.smtp_password = $a.SmtpPass }; $em = [ordered]@{ provider = 'smtp'; options = $o } }
    'console' { $em = [ordered]@{ provider = 'console' } }
  }
  $doc = [ordered]@{ version = 1; placement = 'env'; app = [ordered]@{ url = (Get-EnvValue 'APP_URL' $e); port = [int](Get-EnvValue 'APP_PORT' $e) }; database = $db; storage = $st; email = $em }
  if ($a.Db -eq 'supabase') {
    $doc.auth = @{ provider = 'supabase' }; $doc.realtime = @{ provider = 'supabase' }; $doc.cache = @{ provider = 'postgres' }
    $doc.scheduler = [ordered]@{ provider = 'worker'; options = @{ in_process = 'true' } }
    $doc.supabase = [ordered]@{ url = $a.SbUrl; anonKey = $a.SbAnon; serviceRoleKey = $a.SbService }
  } else {
    $doc.auth = @{ provider = 'builtin' }; $doc.realtime = @{ provider = 'sse' }
    $doc.scheduler = [ordered]@{ provider = 'worker'; options = @{ in_process = 'false' } }
    $doc.cache = [ordered]@{ provider = 'redis'; options = [ordered]@{ redis_url = 'redis://valkey:6379'; redis_password = (Get-EnvValue 'CACHE_REDIS_PASSWORD' $e) } }
  }
  $f = Join-Path $script:Dir 'profile.json'
  [IO.File]::WriteAllText($f, ($doc | ConvertTo-Json -Depth 6))
  Protect-File $f
}
function Get-FallbackEnv {
  $a = $script:Answers; $u = [ordered]@{}
  if ($a.Db -eq 'own') { foreach ($k in 'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'REALTIME_DATABASE_URL', 'SCHEDULER_DATABASE_URL') { $u[$k] = $a.DbUrl } }
  if ($a.Db -eq 'supabase') {
    foreach ($k in 'DB_PROVIDER', 'AUTH_PROVIDER', 'STORAGE_PROVIDER', 'REALTIME_PROVIDER') { $u[$k] = 'supabase' }
    $u['NEXT_PUBLIC_SUPABASE_URL'] = $a.SbUrl; $u['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = $a.SbAnon; $u['SUPABASE_SERVICE_ROLE_KEY'] = $a.SbService
    $u['MIGRATION_DATABASE_URL'] = $a.DbUrl; $u['SCHEDULER_DATABASE_URL'] = $a.DbUrl; $u['SCHEDULER_IN_PROCESS'] = 'true'; $u['CACHE_PROVIDER'] = 'postgres'
  }
  if ($a.Storage -eq 's3') {
    $u['S3_ENDPOINT'] = $a.S3Endpoint; $u['S3_REGION'] = $a.S3Region; $u['S3_ACCESS_KEY_ID'] = $a.S3Key; $u['S3_SECRET_ACCESS_KEY'] = $a.S3Secret
    if ($a.S3Endpoint) { $u['S3_FORCE_PATH_STYLE'] = 'true' } else { $u['S3_FORCE_PATH_STYLE'] = 'false' }
  }
  if ($a.Email -eq 'smtp') {
    $u['SMTP_HOST'] = $a.SmtpHost; $u['SMTP_PORT'] = $a.SmtpPort; $u['EMAIL_FROM'] = $a.From; $u['SMTP_STARTTLS'] = 'auto'
    if ($a.SmtpUser) { $u['SMTP_USER'] = $a.SmtpUser; $u['SMTP_PASSWORD'] = $a.SmtpPass }
  }
  if ($a.Email -eq 'console') { $u['EMAIL_PROVIDER'] = 'console' }
  return $u
}
function Get-ExternalAreas {
  $a = $script:Answers; $l = @()
  if ($a.Db -ne 'bundled') { $l += 'database' }
  if ($a.Storage -eq 's3') { $l += 'storage' }
  if ($a.Email -eq 'smtp') { $l += 'email' }
  if ($a.Db -eq 'supabase') { $l += 'supabase' }
  return ($l -join ',')
}
function Invoke-ProfileCli([string]$image, [string[]]$cliArgs) {
  $a = @('run', '--rm', '-v', "$($script:Dir):/work", '--entrypoint', 'node', $image, 'admin.cjs', 'install', 'profile') + $cliArgs
  $out = & docker @a 2>&1
  $script:ProfileOut = ($out | ForEach-Object { "$_" }) -join "`n"
  return ($LASTEXITCODE -eq 0)
}
# Your own PostgreSQL or file storage moves services off the standard stack:
# the Infrastructure add-on (a paid extension) needs its licence first. The
# bundled stack and a Supabase project need none; neither does a re-run with
# the services an install already uses.
function Get-InfraLicenceArgs {
  $keep = Join-Path $script:Dir 'licences\infrastructure.licence'
  if ($script:InfraLicenceSrc) {
    if (-not (Test-Path $script:InfraLicenceSrc)) { Fail "licence file not found: $($script:InfraLicenceSrc)" }
    New-Item -ItemType Directory -Force -Path (Split-Path $keep) | Out-Null
    Copy-Item -Force $script:InfraLicenceSrc $keep
  }
  if (Test-Path $keep) { return @('--licence=/work/licences/infrastructure.licence') }
  return @()
}
function Apply-Profile([string]$image) {
  $updates = [ordered]@{}
  if (Test-ProfileCli $image) {
    Write-ProfileJson
    $licArgs = @(Get-InfraLicenceArgs)
    $envName = Split-Path -Leaf $script:EnvFile
    Step 'Checking the service choices (usertasks-admin install profile)'
    if (-not (Invoke-ProfileCli $image (@('validate', '--from', '/work/profile.json', '--merge', "/work/$envName") + $licArgs))) { Say $script:ProfileOut; Fail 'the service choices are not valid (see above; your own services need -Licence <Infrastructure licence file>); nothing was started' }
    $areas = Get-ExternalAreas
    if ($areas) {
      if (-not (Invoke-ProfileCli $image @('check', '--from', '/work/profile.json', '--area', $areas))) { Say $script:ProfileOut; Fail 'a service could not be reached (see above). Fix it and run the installer again.' }
      Ok "reached: $areas"
    }
    if (-not (Invoke-ProfileCli $image (@('write', '--from', '/work/profile.json', '--format', 'env', '--merge', "/work/$envName", '--out', '/work/.env.profile') + $licArgs))) { Say $script:ProfileOut; Fail 'could not write the settings from the service choices' }
    $pf = Join-Path $script:Dir '.env.profile'
    foreach ($l in [IO.File]::ReadAllLines($pf)) { if ($l -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $updates[$Matches[1]] = $Matches[2] } }
    Remove-Item -Force $pf
    Ok 'settings written by usertasks-admin install profile'
  } else { $updates = Get-FallbackEnv }
  foreach ($k in $updates.Keys) { Set-EnvValue $k $updates[$k] $script:EnvFile }
}

# ── .env ────────────────────────────────────────────────────────────────────

function Write-EnvFile([string]$rel, [string]$port, [string]$url) {
  if (Test-Path $script:EnvFile) { Ok '.env exists: keeping its secrets'; Add-MissingEnv $rel; return }
  Step 'Generating secrets (.env)'
  $pg = Get-RandomHex 18
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($l in [IO.File]::ReadAllLines((Join-Path $rel 'env.template'))) {
    $l = $l.Replace('<POSTGRES_PASSWORD>', $pg)
    if ($l -eq 'POSTGRES_PASSWORD=<generate>') { $l = "POSTGRES_PASSWORD=$pg" }
    $i = $l.IndexOf('<generate>')
    if ($i -ge 0) { $l = $l.Substring(0, $i) + (Get-RandomHex 32) }
    $out.Add($l)
  }
  [IO.File]::WriteAllText($script:EnvFile, (($out -join "`n") + "`n"))
  Protect-File $script:EnvFile
  Set-EnvValue 'APP_URL' $url $script:EnvFile; Set-EnvValue 'NEXT_PUBLIC_APP_URL' $url $script:EnvFile; Set-EnvValue 'APP_PORT' $port $script:EnvFile
  Set-EnvValue 'USERTASKS_SETUP_CODE' (New-SetupCode) $script:EnvFile
  $mp = 8025; if ($env:USERTASKS_MAILPIT_PORT) { $mp = [int]$env:USERTASKS_MAILPIT_PORT }
  $mc = 9001; if ($env:USERTASKS_MINIO_CONSOLE_PORT) { $mc = [int]$env:USERTASKS_MINIO_CONSOLE_PORT }
  Set-EnvValue 'MAILPIT_PORT' "$(Get-FreePort $mp)" $script:EnvFile
  Set-EnvValue 'MINIO_CONSOLE_PORT' "$(Get-FreePort $mc)" $script:EnvFile
  Ok "secrets written to $($script:EnvFile) (only your user can read it)"
}
function Add-MissingEnv([string]$rel) {
  foreach ($l in [IO.File]::ReadAllLines((Join-Path $rel 'env.template'))) {
    if ($l -match '^([A-Z0-9_]+)=<generate>$') {
      $k = $Matches[1]
      if (-not (Select-String -Quiet -Pattern "^$k=" -Path $script:EnvFile)) { Set-EnvValue $k (Get-RandomHex 32) $script:EnvFile; Ok "added a new secret: $k" }
    }
  }
}

# ── PATH ────────────────────────────────────────────────────────────────────

function Install-Wrapper([string]$rel) {
  $bin = Join-Path $script:Dir 'bin'
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  foreach ($f in 'usertasks.ps1', 'usertasks') { if (Test-Path (Join-Path $rel $f)) { Copy-Item -Force (Join-Path $rel $f) (Join-Path $bin "$f.new"); Move-Item -Force (Join-Path $bin "$f.new") (Join-Path $bin $f) } }
  $cmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0usertasks.ps1`" %*`r`n"
  [IO.File]::WriteAllText((Join-Path $bin 'usertasks.cmd'), $cmd)
  [IO.File]::WriteAllText((Join-Path $bin 'usertasks-server.cmd'), $cmd)
}
function Add-ToPath {
  $bin = Join-Path $script:Dir 'bin'
  if ($env:OS -ne 'Windows_NT') { return }
  $user = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $user) { $user = '' }
  if (($user -split ';') -notcontains $bin) {
    [Environment]::SetEnvironmentVariable('Path', ($user.TrimEnd(';') + ";$bin").TrimStart(';'), 'User')
    Ok "added $bin to your PATH (open a new terminal to use usertasks)"
  }
  $other = Get-Command usertasks -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -and -not $_.Source.StartsWith($bin) }
  if ($other) { Say "  (another 'usertasks' is on your PATH, probably the UserTasks CLI: this install's command is also usertasks-server)" }
}

# ── commands ────────────────────────────────────────────────────────────────

function Invoke-Install([string[]]$rest) {
  $dir = ''; $v = ''; $port = ''; $url = ''; $build = $false; $edition = ''; $licence = ''; $bundle = ''
  for ($i = 0; $i -lt $rest.Count; $i++) {
    switch ($rest[$i]) {
      '-Dir' { $dir = $rest[++$i] } '-Version' { $v = $rest[++$i] } '-Port' { $port = $rest[++$i] } '-Url' { $url = $rest[++$i] }
      '-Project' { $env:USERTASKS_PROJECT = $rest[++$i] } '-Preset' { $env:USERTASKS_PRESET_CHOICE = $rest[++$i] } '-Build' { $build = $true }
      '-Edition' { $edition = $rest[++$i] } { $_ -in '-Licence', '-License' } { $licence = $rest[++$i]; $script:InfraLicenceSrc = $licence } '-Bundle' { $bundle = $rest[++$i] }
      default { Fail "install: unknown option $($rest[$i])" }
    }
  }
  if (-not $dir -or -not $v) { Fail 'install: -Dir and -Version are required' }
  # A licence and no -Edition: the Enterprise image (every paid extension; the licence unlocks its own).
  $implicit = $false
  if (-not $edition -and $licence -and -not $bundle) { $edition = 'enterprise'; $implicit = $true }
  if ($edition -eq 'core') { $edition = '' }
  if ($edition -and -not (Test-Edition $edition)) { Fail "unknown edition: $edition (editions: $($script:EditionsList))" }
  $script:Dir = $dir; $script:StateFile = Join-Path $dir 'state.env'; $script:EnvFile = Join-Path $dir '.env'
  Enter-Lock
  try {
    $existing = Test-Path $script:StateFile
    if ($existing) {
      Initialize-State $dir
      if ($script:Version -ne $v) { Say "UserTasks $($script:Version) is installed in $dir. To move to $v run: usertasks upgrade -To $v" }
      Say 'Existing install found: re-checking it (secrets and data are kept).'
      if ($edition -and $edition -ne $script:Edition -and -not $bundle) { if (-not $implicit) { Say "To switch this install to $(Get-EditionName $edition), keeping its data: usertasks upgrade -Edition $edition" }; $edition = '' }
    } else {
      $script:Project = $env:USERTASKS_PROJECT; if (-not $script:Project) { $script:Project = 'usertasks' }
      if ($script:Project -notmatch '^[a-z0-9][a-z0-9_-]*$') { Fail 'project name: lowercase letters, digits, - and _' }
      $script:Version = $v; $script:Rel = Join-Path $dir "releases\$v"; $script:Profiles = 'standalone'; $script:Edition = ''; $script:EditionVersion = ''
    }
    $prevImage = $script:Image
    if ($edition) { $script:Edition = $edition }
    $licFile = ''
    if ($bundle) {
      Test-Bundle $bundle
      if ($script:Bundle.core_version -ne $script:Version) { Fail "the bundle is for UserTasks $($script:Bundle.core_version), not $($script:Version)" }
      $script:Image = Import-Bundle $bundle
      $script:Edition = [string]$script:Bundle.edition; $script:EditionVersion = [string]$script:Bundle.edition_version
      if ($licence) { $licFile = Get-EditionLicence $script:Edition $licence }
    } elseif ($script:Edition) {
      $kept = Join-Path $dir "editions\$($script:EditionVersion)\edition.json"
      if ($existing -and $prevImage -and -not $licence -and $script:EditionVersion -and (Test-Path $kept) -and (Test-EditionImage $prevImage $kept)) { $script:Image = $prevImage }
      else {
        $licFile = Get-EditionLicence $script:Edition $licence
        if ($implicit -and -not (Request-Edition $script:Edition $licFile $script:Version 'install' (Join-Path $dir 'editions\.request') (Join-Path $dir 'release-key.pub.pem'))) {
          if (-not (Test-EditionFallback $script:EditionErrorCode)) { Fail "$($script:EditionError). Nothing was installed." }
          # Picked only because a licence was given: no Enterprise build to use is not a reason to stop.
          Warn "UserTasks Enterprise could not be downloaded ($($script:EditionError)): installing the public image. Switch later, data kept: usertasks upgrade -Edition enterprise"
          $script:Edition = ''; $script:EditionVersion = ''; $script:Image = Get-ReleaseImage $script:Rel
        } else {
          $script:Image = Get-EditionImage $script:Edition $licFile $script:Version 'install' '. Nothing was installed.'
          $script:EditionVersion = $script:Ed.version
        }
      }
    } else {
      $script:Image = Get-ReleaseImage $script:Rel
    }
    if (-not (Test-Path $script:EnvFile)) {
      if (-not $port) { $port = '3000' }
      if (Test-PortBusy ([int]$port)) {
        $free = Get-FreePort ([int]$port)
        if (-not (Test-Interactive)) { Fail "port $port is in use: re-run with -Port <free port> (for example $free)" }
        $port = Ask "Port $port is in use. Port for UserTasks" "$free"
      }
      if (-not $url) { $url = "http://localhost:$port" }
      $script:Port = $port; $script:AppUrl = $url
    }
    $script:Image = Ensure-Image $script:Image $build $script:Version
    Ok "image $($script:Image)"
    if (-not (Test-Path $script:EnvFile)) {
      Read-Profile
      # Written to .env.new and moved into place only once the choices check out.
      $final = $script:EnvFile; $script:EnvFile = Join-Path $dir '.env.new'
      if (Test-Path $script:EnvFile) { Remove-Item -Force $script:EnvFile }
      Write-EnvFile $script:Rel $port $url
      Apply-Profile $script:Image
      Move-Item -Force $script:EnvFile $final; $script:EnvFile = $final
    } else { Add-MissingEnv $script:Rel }
    Save-State
    Initialize-State $dir
    if (-not (Start-Stack $script:Image 600)) { Invoke-Compose @('logs', '--tail', '80', 'app') | Out-Null; Fail 'UserTasks did not become healthy. Logs: usertasks logs. Re-run the installer when fixed (it is safe to re-run).' }
    Install-Wrapper $script:Rel
    Add-ToPath
    if ($licFile) { Install-EditionLicence $licFile }
    Show-Finish
    if ($env:USERTASKS_NO_BROWSER -ne '1' -and (Test-Interactive) -and $env:OS -eq 'Windows_NT') { Start-Process "$($script:AppUrl)/setup" }
  } finally { Exit-Lock }
}
function Show-Finish {
  Say ''
  Write-Host "UserTasks $($script:Version) is running." -ForegroundColor Green
  Say "  Address:  $($script:AppUrl)"
  if ((Get-AdminOutput @('setup-code', 'status')) -match 'Setup is complete') { Say "  Sign in:  $($script:AppUrl)/login" }
  else { Say "  Setup:    open $($script:AppUrl)/setup and enter the setup code $(Get-EnvValue 'USERTASKS_SETUP_CODE' $script:EnvFile)" }
  if (Test-UsesBundledPostgres) { Say "  Email:    test inbox at http://localhost:$(Get-EnvValue 'MAILPIT_PORT' $script:EnvFile)" }
  Say "  Files:    $($script:Dir) (.env holds the secrets: back it up)"
  Say '  Manage:   usertasks status | logs | backup | upgrade | config | uninstall'
  Say ''
}
function Invoke-Status {
  Say "UserTasks $($script:Version)  ($($script:Preset), project $($script:Project))"
  Say "  image:   $($script:Image)"; Say "  address: $($script:AppUrl)"; Say "  folder:  $($script:Dir)"
  Invoke-Compose @('ps', '--format', 'table {{.Service}}\t{{.Status}}') | Out-Null
  if (Test-HttpOk "http://127.0.0.1:$($script:Port)/api/config/public") { Ok "healthy (http://127.0.0.1:$($script:Port))" } else { Warn "not answering on port $($script:Port)" }
  if (Test-AppRunning) { Say ((Get-AdminOutput @('setup-code', 'status')) -split "`n" | Select-Object -First 1) }
}
function Get-DbUrl { $u = Get-EnvValue 'MIGRATION_DATABASE_URL' $script:EnvFile; if (-not $u) { $u = Get-EnvValue 'DATABASE_URL' $script:EnvFile }; return $u }
function Test-BundledDb { if (-not (Test-UsesBundledPostgres)) { return $false }; $u = Get-DbUrl; return ((-not $u) -or $u -like '*@postgres:*') }
function Get-FileVolume {
  if ((Test-UsesBundledPostgres) -and (Get-EnvValue 'STORAGE_PROVIDER' $script:EnvFile) -eq 's3' -and (Get-EnvValue 'S3_ENDPOINT' $script:EnvFile) -eq 'http://minio:9000') { return "$($script:Project)_miniodata" }
  return ''
}
function Invoke-VolumeTar([string]$volume, [string]$dir, [string]$file, [string]$mode) {
  if ($mode -eq 'create') { & docker run --rm --network none -u 0 --entrypoint sh -v "${volume}:/data:ro" -v "${dir}:/backup" $script:Image -c "tar -czf /backup/$file -C /data ." }
  else { & docker run --rm --network none -u 0 --entrypoint sh -v "${volume}:/data" -v "${dir}:/backup:ro" $script:Image -c "find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf /backup/$file -C /data" }
  if ($LASTEXITCODE -ne 0) { Fail "files ($mode) failed" }
}
function Invoke-BackupTo([string]$dir) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $dir = (Resolve-Path $dir).Path
  Step "Backing up to $dir"
  if (Test-BundledDb) {
    if ((Invoke-Compose @('exec', '-T', 'postgres', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/usertasks-backup.dump')) -ne 0) { Fail 'database dump failed (is the postgres container running? usertasks start)' }
    Invoke-Compose @('cp', 'postgres:/tmp/usertasks-backup.dump', (Join-Path $dir 'database.dump')) | Out-Null
    Invoke-Compose @('exec', '-T', 'postgres', 'rm', '-f', '/tmp/usertasks-backup.dump') | Out-Null
  } elseif (Get-DbUrl) {
    & docker run --rm --network "$($script:Project)_default" -v "${dir}:/backup" $script:PgClientImage pg_dump -Fc -f /backup/database.dump (Get-DbUrl)
    if ($LASTEXITCODE -ne 0) { Fail 'database dump failed' }
  } else { Fail 'no database connection string in .env (MIGRATION_DATABASE_URL): back up the database with your provider''s tools' }
  Ok 'database'
  $vol = Get-FileVolume
  if ($vol) { Invoke-VolumeTar $vol $dir 'files.tar.gz' 'create'; Ok "files (volume $vol)" } else { Say "  --  files live in your storage provider ($(Get-EnvValue 'STORAGE_PROVIDER' $script:EnvFile)): back them up there" }
  Copy-Item $script:EnvFile (Join-Path $dir 'env'); Protect-File (Join-Path $dir 'env')
  Copy-Item $script:StateFile (Join-Path $dir 'state.env')
  if (Test-Path (Join-Path $script:Dir 'profile.json')) { Copy-Item (Join-Path $script:Dir 'profile.json') $dir }
  ([ordered]@{ version = $script:Version; image = $script:Image; project = $script:Project; createdAt = (Get-Stamp) } | ConvertTo-Json) | Set-Content -Encoding ascii (Join-Path $dir 'backup.json')
  Ok '.env and install state (keep this folder safe: it holds ENCRYPTION_KEY)'
  $script:BackupDir = $dir
}
function Invoke-Backup([string[]]$rest) {
  $out = ''
  for ($i = 0; $i -lt $rest.Count; $i++) { if ($rest[$i] -in '-Out', '--out') { $out = $rest[++$i] } else { Fail "backup: unknown option $($rest[$i])" } }
  if (-not $out) { $out = Join-Path $script:Dir "backups\$(Get-Stamp)-$($script:Version)" }
  Enter-Lock; try { Invoke-BackupTo $out } finally { Exit-Lock }
  Say "Backup complete: $($script:BackupDir)"; Say "Restore it with: usertasks restore $($script:BackupDir)"
}
function Invoke-Restore([string[]]$rest) {
  $b = ''
  foreach ($r in $rest) { if ($r -in '-Yes', '--yes', '-y') { $script:AssumeYes = $true } else { $b = $r } }
  if (-not $b) { Fail 'usage: usertasks restore <backup folder | latest> [-Yes]' }
  if ($b -eq 'latest') { $b = (Get-ChildItem -Directory (Join-Path $script:Dir 'backups') | Sort-Object Name | Select-Object -Last 1).FullName }
  if (-not $b -or -not (Test-Path (Join-Path $b 'database.dump'))) { Fail "$b has no database.dump" }
  $b = (Resolve-Path $b).Path
  Say "Restore $b into this install ($($script:Version), project $($script:Project)). Everything in the database since that backup is lost; files are replaced too."
  if (-not (Confirm-Step 'Restore now?' $false)) { Fail 'not restored' }
  Enter-Lock
  try {
    Invoke-BackupTo (Join-Path $script:Dir "backups\$(Get-Stamp)-before-restore")
    Step 'Stopping the app'
    Invoke-Compose @('stop', 'app', 'worker') | Out-Null
    if (Test-BundledDb) {
      Invoke-Compose @('cp', (Join-Path $b 'database.dump'), 'postgres:/tmp/usertasks-restore.dump') | Out-Null
      if ((Invoke-Compose @('exec', '-T', 'postgres', 'sh', '-c', 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\"" >/dev/null && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error /tmp/usertasks-restore.dump; rc=$?; rm -f /tmp/usertasks-restore.dump; exit $rc')) -ne 0) { Fail 'database restore failed' }
    } else {
      & docker run --rm --network "$($script:Project)_default" -v "${b}:/backup:ro" $script:PgClientImage pg_restore --clean --if-exists --no-owner -d (Get-DbUrl) /backup/database.dump
      if ($LASTEXITCODE -ne 0) { Fail 'database restore failed' }
    }
    Ok 'database restored'
    $vol = Get-FileVolume
    if ($vol -and (Test-Path (Join-Path $b 'files.tar.gz'))) { Invoke-Compose @('stop', 'minio') | Out-Null; Invoke-VolumeTar $vol $b 'files.tar.gz' 'extract'; Ok 'files restored' }
    if ((Test-Path (Join-Path $b 'env')) -and ((Get-FileHash (Join-Path $b 'env')).Hash -ne (Get-FileHash $script:EnvFile).Hash)) {
      Copy-Item $script:EnvFile (Join-Path $script:Dir "backups\env.before-restore-$(Get-Stamp)"); Copy-Item -Force (Join-Path $b 'env') $script:EnvFile; Ok '.env restored'
    }
    if (-not (Start-Stack $script:Image 600)) { Fail 'UserTasks did not become healthy after the restore: usertasks logs' }
    Say "Restored from $b."
  } finally { Exit-Lock }
}
function Invoke-Migrations([string]$rel, [string]$image) {
  Step 'Applying database migrations (usertasks-admin db migrate)'
  if (Test-UsesBundledPostgres) { if ((Invoke-ComposeFor $rel $image @('run', '--rm', 'migrate')) -ne 0) { return $false } }
  else { if ((Invoke-ComposeFor $rel $image @('run', '--rm', '--no-deps', '-T', 'app', 'node', 'admin.cjs', 'db', 'migrate')) -ne 0) { return $false } }
  $h = (& docker run --rm --network none --entrypoint node $image admin.cjs --help 2>$null) -join "`n"
  if ($h -notmatch 'usertasks-admin ext migrate') { Say '  --  this release has no extension migrations (usertasks-admin ext): skipped'; return $true }
  Step 'Applying extension migrations (usertasks-admin ext migrate)'
  return ((Invoke-ComposeFor $rel $image @('run', '--rm', '--no-deps', '-T', 'app', 'node', 'admin.cjs', 'ext', 'migrate')) -eq 0)
}
function Invoke-Upgrade([string[]]$rest) {
  $to = ''; $skipBackup = $false; $downgrade = $false; $build = $false; $force = $false; $edition = $null; $licence = ''; $bundle = ''
  for ($i = 0; $i -lt $rest.Count; $i++) {
    switch ($rest[$i]) {
      { $_ -in '-To', '--to' } { $to = $rest[++$i] } { $_ -in '-Yes', '--yes', '-y' } { $script:AssumeYes = $true }
      { $_ -in '-SkipBackup', '--skip-backup' } { $skipBackup = $true } { $_ -in '-AllowDowngrade', '--allow-downgrade' } { $downgrade = $true }
      { $_ -in '-Build', '--build' } { $build = $true } { $_ -in '-Force', '--force' } { $force = $true }
      { $_ -in '-Edition', '--edition' } { $edition = $rest[++$i] } { $_ -in '-Licence', '--licence', '-License', '--license' } { $licence = $rest[++$i] }
      { $_ -in '-Bundle', '--bundle' } { $bundle = $rest[++$i] }
      default { Fail "upgrade: unknown option $($rest[$i])" }
    }
  }
  Enter-Lock
  try {
    $from = $script:Version; $fromImg = $script:Image; $fromRel = $script:Rel; $fromEdition = $script:Edition
    $ed = $fromEdition; if ($null -ne $edition) { $ed = $edition }; if ($ed -eq 'core') { $ed = '' }
    if ($ed -and -not (Test-Edition $ed)) { Fail "unknown edition: $ed (editions: $($script:EditionsList), or core for the public image)" }
    $bundleDir = ''
    if ($bundle) {
      $bundleDir = Open-Bundle (Resolve-Path $bundle).Path
      if ($to -and $to.TrimStart('v') -ne $script:Bundle.core_version) { Fail "the bundle is for UserTasks $($script:Bundle.core_version), not $to" }
      $to = [string]$script:Bundle.core_version; $ed = [string]$script:Bundle.edition
    }
    $switching = ($ed -ne $fromEdition)
    if (-not $to) {
      Step 'Looking up the latest release'
      if ($ed) { $to = Get-EditionLatestCore $ed }
      if (-not $to) { $to = Get-LatestVersion }
    }
    $to = $to.TrimStart('v'); if (-not (Test-Version $to)) { Fail "not a version: $to" }
    $c = Compare-Version $to $from
    if ($c -eq 0 -and -not $force -and -not $switching) { Say "UserTasks $from is already installed (latest: $to)."; return }
    if ($c -lt 0 -and -not $downgrade) {
      if ($ed -and $switching) { Fail "the newest $(Get-EditionName $ed) build is for UserTasks $to, older than the installed $from. It usually follows a release within a few hours: try again later." }
      Fail "$to is older than the installed $from (pass -AllowDowngrade to go back on purpose)"
    }
    $what = "UserTasks $from -> $to"
    if ($switching) { if ($ed) { $what += ", switching to $(Get-EditionName $ed)" } else { $what += ', switching to the public image (paid extensions removed; their data is kept)' } }
    Say "Upgrade $what (project $($script:Project)). Release notes: $($script:ReleaseBase)/tag/v$to"
    if (-not (Confirm-Step 'Continue?' $true)) { Fail 'not upgraded' }
    $done = New-Object System.Collections.Generic.List[string]
    # Editions: the licence check comes first, so a refusal changes nothing.
    $licFile = ''
    if ($ed -and -not $bundle) {
      $licFile = Get-EditionLicence $ed $licence
      $purpose = 'upgrade'; if ($switching) { $purpose = 'switch' }
      if (-not (Request-Edition $ed $licFile $to $purpose (Join-Path $script:Dir 'editions\.request') (Join-Path $script:Dir 'release-key.pub.pem'))) {
        Say ''
        if ($script:EditionErrorCode -in 'licence_expired', 'licence_revoked', 'licence_not_yet_valid') { Write-Host 'Upgrade refused: the licence is not active.' -ForegroundColor Red } else { Write-Host 'Upgrade refused.' -ForegroundColor Red }
        Say $script:EditionError
        Say "UserTasks $from keeps running, unchanged. Renewed? Install the new licence (Settings -> Licence, or -Licence <file>) and run usertasks upgrade again."
        exit 1
      }
      $done.Add("licence checked with usertasks.com: $(Get-EditionName $ed) $($script:Ed.version)")
    } elseif ($ed -and $licence) { $licFile = Get-EditionLicence $ed $licence }
    $script:BackupDir = ''
    if ($skipBackup) { Warn 'no backup (-SkipBackup)' } else { Invoke-BackupTo (Join-Path $script:Dir "backups\$(Get-Stamp)-$from-before-$to"); $done.Add("backup: $($script:BackupDir)") }
    if ($bundleDir) { Get-Release $to (Join-Path $bundleDir 'release'); $done.Add("release $to from the offline bundle (signature + checksum)") }
    else { Get-Release $to; $done.Add("downloaded and verified release $to (signature + checksum)") }
    $newRel = Join-Path $script:Dir "releases\$to"
    $newEdVersion = ''
    if ($bundleDir) {
      $newImg = Import-Bundle $bundleDir; $newEdVersion = [string]$script:Bundle.edition_version
      $done.Add("images loaded from the bundle; $(Get-EditionName $ed) $newEdVersion verified against its signed manifest")
    } elseif ($ed) {
      $newImg = Get-EditionImage $ed $licFile $to 'upgrade' "; nothing changed (UserTasks $from keeps running)."
      $newEdVersion = $script:Ed.version
      $done.Add("image $newImg (verified against the signed edition manifest)")
    } else {
      $newImg = Get-ReleaseImage $newRel
      & docker image inspect $newImg *> $null
      if ($LASTEXITCODE -ne 0) {
        Step "Pulling $newImg"; & docker pull $newImg | Out-Host
        if ($LASTEXITCODE -ne 0) { if (-not $build) { Fail "could not pull $newImg; nothing changed (UserTasks $from keeps running). Re-run with -Build to build it locally." }; $newImg = Build-FromSource $to }
      }
      $done.Add("image $newImg")
    }
    Add-MissingEnv $newRel
    if (-not (Invoke-Migrations $newRel $newImg)) {
      Say ''; Write-Host "The migrations failed. UserTasks $from is still running, unchanged: no code was switched." -ForegroundColor Red
      Say 'Each migration file runs in its own transaction, so nothing is half-applied. Fix the cause above and run usertasks upgrade again.'
      if ($script:BackupDir) { Say "Backup taken before the upgrade: $($script:BackupDir)" }
      exit 1
    }
    $done.Add('applied database and extension migrations')
    Step "Switching to $to"
    $script:Rel = $newRel; $script:Image = $newImg
    $timeout = 300; if ($env:USERTASKS_UPGRADE_TIMEOUT) { $timeout = [int]$env:USERTASKS_UPGRADE_TIMEOUT }
    if ((Start-Stack $newImg $timeout) -and (Test-RunningImage $newImg)) {
      $script:PrevVersion = $from; $script:PrevImage = $fromImg; $script:Version = $to
      $script:Edition = $ed; $script:EditionVersion = $newEdVersion
      Save-State; Install-Wrapper $newRel
      $done.Add("switched the app and worker to $to; health check passed")
      if ($licence -and $licFile) { Install-EditionLicence $licFile }
      Say ''; Write-Host "Upgraded UserTasks $from -> $to. What was done:" -ForegroundColor Green
      foreach ($d in $done) { Say "  - $d" }
      Say 'Check it: sign in, open a task, run a test workflow (docs: /docs/self-hosting/upgrade#check-it-worked).'
      return
    }
    Say ''; Write-Host "The new version did not become healthy. Rolling the code back to $from." -ForegroundColor Red
    $script:Rel = $fromRel; $script:Image = $fromImg
    if (Start-Stack $fromImg 300) {
      Save-State
      Say "Rolled back: UserTasks $from is running again (image $fromImg)."
      Say "The migrations of $to stay applied: they are additive, so $from runs on the newer schema."
      if ($script:BackupDir) { Say "If you need the database exactly as before: usertasks restore $($script:BackupDir)" }
    } else { Write-Host "The rollback did not become healthy either. Check usertasks logs; restore with: usertasks restore $($script:BackupDir)" -ForegroundColor Red }
    exit 1
  } finally { Exit-Lock }
}
function Invoke-Config([string[]]$rest) {
  if ($rest.Count -gt 0 -and $rest[0] -in 'export', 'apply', 'diff', 'new') { Invoke-Cli (@('config') + $rest) }
  $force = $false
  for ($i = 0; $i -lt $rest.Count; $i++) { switch ($rest[$i]) { { $_ -in '-Preset', '--preset' } { $env:USERTASKS_PRESET_CHOICE = $rest[++$i] } { $_ -in '-Force', '--force' } { $force = $true } { $_ -in '-Yes', '--yes' } { $script:AssumeYes = $true } default { Fail "config: unknown option $($rest[$i])" } } }
  Enter-Lock
  try {
    $oldPreset = $script:Preset; $oldDb = Get-DbUrl
    Read-Profile
    $setupDone = ((Get-AdminOutput @('setup-code', 'status')) -match 'Setup is complete')
    $newDb = $script:Answers.DbUrl
    if ($setupDone -and -not $force -and ($script:Preset -ne $oldPreset -or ($newDb -and $newDb -ne $oldDb))) {
      Say 'This install already has data. Changing the database or file storage here does not move it.'
      Say 'Move one service at a time with: usertasks admin switch <area> --to <provider> (docs: /docs/self-hosting/switching-providers)'
      Say 'Or pass -Force to point at the new services without moving data.'
      exit 1
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $script:Dir 'backups') | Out-Null
    $bk = Join-Path $script:Dir "backups\env.$(Get-Stamp)"; Copy-Item $script:EnvFile $bk
    Apply-Profile $script:Image
    Save-State; Initialize-State $script:Dir
    if (-not (Start-Stack $script:Image 600)) { Fail "UserTasks did not become healthy with the new choices. The previous .env is $bk" }
    Say "Service choices updated (previous .env: $bk)."
  } finally { Exit-Lock }
}
function Invoke-Uninstall([string[]]$rest) {
  $purge = $false
  foreach ($r in $rest) { switch ($r) { { $_ -in '-Purge', '--purge' } { $purge = $true } { $_ -in '-Yes', '--yes', '-y' } { $script:AssumeYes = $true } default { Fail "uninstall: unknown option $r" } } }
  if ($purge) {
    Write-Host "This deletes UserTasks and ALL its data: the database and file volumes of project $($script:Project), $($script:Dir) (secrets, backups)." -ForegroundColor Red
    if (-not $script:AssumeYes) {
      if (-not (Test-Interactive)) { Fail 'uninstall -Purge needs -Yes when not interactive' }
      if ((Ask "Type the project name ($($script:Project)) to confirm" '') -ne $script:Project) { Fail 'not removed' }
    }
    Invoke-Compose @('down', '--volumes', '--remove-orphans') | Out-Null
  } else {
    if (-not (Confirm-Step 'Stop and remove the UserTasks containers? Data, .env and backups are kept.' $true)) { Fail 'not removed' }
    Invoke-Compose @('down', '--remove-orphans') | Out-Null
  }
  $bin = Join-Path $script:Dir 'bin'
  if ($env:OS -eq 'Windows_NT') {
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($user) { [Environment]::SetEnvironmentVariable('Path', (($user -split ';' | Where-Object { $_ -and $_ -ne $bin }) -join ';'), 'User') }
  }
  if ($purge) { Set-Location $HOME; Remove-Item -Recurse -Force $script:Dir; Say 'UserTasks and its data were removed.' }
  else {
    Set-EnvValue 'USERTASKS_UNINSTALLED' (Get-Stamp) $script:StateFile
    Say "UserTasks was stopped and removed. Data volumes (project $($script:Project)), $($script:EnvFile) and $($script:Dir)\backups are kept."
    Say "Install again into $($script:Dir) to pick them up, or remove everything with: $bin\usertasks.cmd uninstall -Purge"
  }
}
function Invoke-Cli([string[]]$rest) {
  $bin = Join-Path $script:Dir 'bin'
  $cli = Get-Command usertasks -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -and -not $_.Source.StartsWith($bin) -and -not ((Get-Content -Raw $_.Source -ErrorAction SilentlyContinue) -match $script:WrapperMark) } | Select-Object -First 1
  if (-not $cli) { Fail "'$($rest[0])' is not a server command (usertasks help). For the UserTasks CLI: npm install -g @user-tasks/cli" }
  & $cli.Source @rest
  exit $LASTEXITCODE
}

# ── main ────────────────────────────────────────────────────────────────────

$cmd = 'help'; $rest = @()
if ($args.Count -gt 0) { $cmd = [string]$args[0]; if ($args.Count -gt 1) { $rest = [string[]]$args[1..($args.Count - 1)] } }
$serverCommands = 'status', 'logs', 'backup', 'restore', 'upgrade', 'config', 'uninstall', 'setup-code', 'admin', 'start', 'stop', 'restart', 'version', '--version'
if ($cmd -in 'help', '-h', '--help', '-?') { Get-Content $PSCommandPath | Select-Object -Skip 1 -First 18 | ForEach-Object { $_ -replace '^# ?', '' }; exit 0 }
if ($cmd -eq 'install') { $script:Dir = ''; Invoke-Install $rest; exit 0 }
if ($cmd -eq 'bundle-download') {
  # Works without an install (install.ps1 -BundleDownload passes -Work <folder>).
  $work = ''; for ($i = 0; $i -lt $rest.Count - 1; $i++) { if ($rest[$i] -in '-Work', '--work') { $work = $rest[$i + 1] } }
  if ($work) {
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $script:Dir = (Resolve-Path $work).Path; $script:StateFile = Join-Path $script:Dir 'state.env'
    $script:ReleaseBase = $env:USERTASKS_RELEASE_BASE; if (-not $script:ReleaseBase) { $script:ReleaseBase = $script:DefaultReleaseBase }
  } else { $script:Dir = Find-Dir; Initialize-State $script:Dir }
  Invoke-BundleDownload $rest; exit 0
}
$script:Dir = Find-Dir
Initialize-State $script:Dir
if ($cmd -eq 'cli') { Invoke-Cli $rest }
if ($serverCommands -notcontains $cmd) { Invoke-Cli (@($cmd) + $rest) }
switch ($cmd) {
  'status' { Invoke-Status }
  'logs' { exit (Invoke-Compose (@('logs') + $rest)) }
  'backup' { Invoke-Backup $rest }
  'restore' { Invoke-Restore $rest }
  'upgrade' { Invoke-Upgrade $rest }
  'config' { Invoke-Config $rest }
  'uninstall' { Invoke-Uninstall $rest }
  'setup-code' { exit (Invoke-Admin (@('setup-code') + $rest)) }
  'admin' { exit (Invoke-Admin $rest) }
  'start' { if (-not (Start-Stack $script:Image 600)) { exit 1 } }
  'stop' { exit (Invoke-Compose @('stop')) }
  'restart' { Invoke-Compose @('restart') | Out-Null; if (Wait-Healthy 180) { Ok 'healthy' } }
  { $_ -in 'version', '--version' } { $e = ''; if ($script:Edition) { $e = ", $(Get-EditionName $script:Edition) $($script:EditionVersion)" }; Say "UserTasks $($script:Version) ($($script:Image))$e" }
}
exit 0
