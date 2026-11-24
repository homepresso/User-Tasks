# UserTasks one-line installer (Docker) for Windows: Docker Desktop with the WSL 2 backend.
#
#   irm https://usertasks.com/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Port 8080 -Dir C:\UserTasks
#
# Parameters (or environment variables):
#   -Version <x.y.z>    USERTASKS_VERSION   release to install (default: the latest)
#   -Dir <folder>       USERTASKS_DIR       install folder (default: %USERPROFILE%\usertasks)
#   -Port <port>        USERTASKS_PORT      port on this machine (default 3000)
#   -Url <address>      USERTASKS_APP_URL   the address people open (default http://localhost:<port>)
#   -Preset <name>      USERTASKS_PRESET    standalone | postgres | supabase | custom
#   -Project <name>     USERTASKS_PROJECT   Docker Compose project name (default usertasks)
#   -NonInteractive     USERTASKS_NONINTERACTIVE=1
#   -Build              build the image locally if it can't be downloaded
#   -NoBrowser          USERTASKS_NO_BROWSER=1
#
# UserTasks Enterprise (one licence-gated image with every paid extension: SharePoint
# Server, the Infrastructure add-on…; each unlocked by its own licence):
#   -Licence <file>     USERTASKS_LICENCE_FILE   your .licence file (checked with usertasks.com):
#                                                installs UserTasks Enterprise (any paid licence)
#   -Edition <name>     USERTASKS_EDITION        enterprise (the default with a licence), core (the
#                                                public image, even with a licence), sharepoint (the
#                                                older SharePoint edition name: served the Enterprise image)
#   -Bundle <file>      install from an offline bundle (air-gapped hosts): its .tar, or its
#                       parts (the .parts.json, or the folder holding them)
#   -BundleDownload     make an offline bundle here instead of installing (with -Licence;
#                       -Platform linux/amd64|linux/arm64, -Out <file>)
#   -BundleDownload -From <url>   download a prebuilt split bundle (<url> of its .parts.json)
#                       into -Out <folder>, resuming and checking every part
#
#   & ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Edition enterprise -Licence .\usertasks.licence
#
# It checks the machine and Docker, downloads a pinned release, verifies its
# signature and checksum before running anything from it, then hands over to
# that release's `usertasks install`. Safe to run again: existing secrets and
# data are never overwritten. Docs: https://usertasks.com/install
#
# Everything is inside functions; nothing runs until the last line, so a
# download cut short does nothing. Works in Windows PowerShell 5.1 and PowerShell 7.

# The UserTasks release signing key (ed25519); deploy/install/release-key.pub.pem
# holds the same key (npm run release:bundle -- set-key updates both installers).
$ReleasePublicKey = @'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANqX67SGhI6zK+8mbj86CjQ+IOQFoQ8x8axnlt7S8fbU=
-----END PUBLIC KEY-----
'@

function Invoke-UserTasksInstall {
  [CmdletBinding()]
  param(
    [string]$Version = $env:USERTASKS_VERSION,
    [string]$Dir = $env:USERTASKS_DIR,
    [string]$Port = $env:USERTASKS_PORT,
    [string]$Url = $env:USERTASKS_APP_URL,
    [string]$Preset = $env:USERTASKS_PRESET,
    [string]$Project = $env:USERTASKS_PROJECT,
    [switch]$NonInteractive,
    [switch]$Build,
    [switch]$NoBrowser,
    [string]$Edition = $env:USERTASKS_EDITION,
    [Alias('License')][string]$Licence = $env:USERTASKS_LICENCE_FILE,
    [string]$Bundle,
    [switch]$BundleDownload,
    [string]$Platform,
    [string]$Out,
    [string]$From
  )
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  if ($NonInteractive) { $env:USERTASKS_NONINTERACTIVE = '1' }
  if ($NoBrowser) { $env:USERTASKS_NO_BROWSER = '1' }
  $releaseBase = $env:USERTASKS_RELEASE_BASE
  if (-not $releaseBase) { $releaseBase = 'https://github.com/homepresso/User-Tasks/releases' }
  $editionApi = $env:USERTASKS_EDITION_API
  if (-not $editionApi) { $editionApi = 'https://usertasks.com/api/public/extensions' }
  if ($Edition -and $Edition -notin @('core', 'enterprise', 'sharepoint')) { throw "unknown edition: $Edition (editions: enterprise, sharepoint, core)" }
  # A licence alone means UserTasks Enterprise (the release's installer falls back to the
  # public image when there is no Enterprise build); -Edition core keeps the public image.
  $implicit = $false
  if (-not $Edition -and $Licence) { $Edition = 'enterprise'; $implicit = $true }
  $coreChosen = ($Edition -eq 'core')
  if ($coreChosen) { $Edition = '' }
  if ($Licence) { if (-not (Test-Path $Licence)) { throw "licence file not found: $Licence" }; $Licence = (Resolve-Path $Licence).Path }
  if ($Bundle) { if (-not (Test-Path $Bundle)) { throw "bundle not found: $Bundle" }; $Bundle = (Resolve-Path $Bundle).Path }
  if ($From) {
    # A prebuilt, split bundle: download and check its parts, nothing else (no Docker needed).
    if (-not $BundleDownload) { throw '-From goes with -BundleDownload' }
    Write-Host ''
    Write-Host 'UserTasks installer' -ForegroundColor White
    if (-not $Dir) { $Dir = Join-Path (Get-Location).Path 'usertasks-bundle-work' }
    New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'releases') | Out-Null
    $Dir = (Resolve-Path $Dir).Path
    $key = Set-UtTrustKey $Dir
    if (-not $Out) { $Out = (Get-Location).Path }
    Save-UtParts $From $Out $key
    return
  }
  if ($BundleDownload) { if (-not $Edition -or -not $Licence) { throw '-BundleDownload needs -Licence <file> (and optionally -Edition enterprise)' } }
  elseif ($Edition -and -not $Licence -and -not $Bundle) { throw "-Edition $Edition needs your licence: -Licence <file> (licences: https://usertasks.com/extensions; a 30-day SharePoint trial: https://usertasks.com/sharepoint/trial)" }

  Write-Host ''
  Write-Host 'UserTasks installer' -ForegroundColor White
  Test-UtMachine
  Test-UtDocker
  if ($BundleDownload) { if (-not $Dir) { $Dir = Join-Path (Get-Location).Path 'usertasks-bundle-work' } }
  elseif (-not $Dir) {
    $Dir = Join-Path $HOME 'usertasks'
    if (-not (Test-Path (Join-Path $Dir 'state.env'))) { $Dir = Read-UtAnswer 'Install folder' $Dir }
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'releases') | Out-Null
  $Dir = (Resolve-Path $Dir).Path
  Test-UtDisk $Dir
  $key = Set-UtTrustKey $Dir
  $bundleDir = ''
  if ($Bundle) {
    $join = Join-Path $Dir 'releases\.bundle-join'
    $rb = Resolve-UtBundle $Bundle $key $join
    $bf = $rb.File
    if (-not $rb.Joined -and (Test-Path -LiteralPath "$bf.sha256")) {
      $want = ((Get-Content -Raw -LiteralPath "$bf.sha256").Trim() -split '\s+')[0]
      if ((Get-FileHash -Algorithm SHA256 -LiteralPath $bf).Hash.ToLowerInvariant() -ne $want) { throw "$bf does not match $bf.sha256: the bundle is damaged or was changed" }
      Write-UtOk "bundle checksum ($bf.sha256)"
    }
    $bo = Join-Path $Dir 'releases\.bundle'
    if (Test-Path $bo) { Remove-Item -Recurse -Force $bo }
    New-Item -ItemType Directory -Force -Path $bo | Out-Null
    Write-UtStep "Unpacking $(Split-Path -Leaf $bf)"
    & tar -xf $bf -C $bo
    if ($LASTEXITCODE -ne 0) { throw "could not unpack $bf (tar)" }
    if ($rb.Joined) { Remove-Item -Recurse -Force $join }
    $bj = Get-ChildItem -Path $bo -Filter 'bundle.json' -Recurse -Depth 1 | Select-Object -First 1
    if (-not $bj) { throw "$Bundle is not a UserTasks offline bundle" }
    $bundleDir = $bj.DirectoryName
    $Version = [string](Get-Content -Raw $bj.FullName | ConvertFrom-Json).core_version
  }
  if (-not $Version -and (Test-Path (Join-Path $Dir 'state.env'))) {
    $line = Get-Content (Join-Path $Dir 'state.env') | Where-Object { $_ -like 'USERTASKS_VERSION=*' } | Select-Object -Last 1
    if ($line) { $Version = $line.Substring(18) }
  }
  if (-not $Version -and $Edition) {
    # The newest UserTasks release that has an edition build (it follows a release within hours).
    try { $Version = [string](Invoke-RestMethod -UseBasicParsing "$editionApi/$Edition").latest_core_version } catch { $Version = '' }
  }
  if (-not $Version) {
    Write-UtStep 'Looking up the latest release'
    try { $Version = (Invoke-RestMethod -UseBasicParsing "$releaseBase/latest/download/release.json").version }
    catch { throw "could not reach $releaseBase (check the network or proxy settings): $($_.Exception.Message)" }
  }
  $Version = $Version.TrimStart('v')
  if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$') { throw "not a release version: '$Version'" }
  $src = ''; if ($bundleDir) { $src = Join-Path $bundleDir 'release' }
  Get-UtRelease -Base $releaseBase -Version $Version -Dir $Dir -Key $key -Source $src

  $wrapper = Join-Path $Dir "releases\$Version\usertasks.ps1"
  $shell = 'powershell.exe'
  if ($PSVersionTable.PSEdition -eq 'Core') { $shell = (Get-Process -Id $PID).Path }
  if ($BundleDownload) {
    $a = @('bundle-download', '-Work', $Dir, '-Version', $Version, '-Edition', $Edition, '-Licence', $Licence)
    if ($Platform) { $a += @('-Platform', $Platform) }
    if ($Out) { $a += @('-Out', $Out) }
    & $shell -NoProfile -ExecutionPolicy Bypass -File $wrapper @a
    if ($LASTEXITCODE -ne 0) { throw "the bundle was not made (exit code $LASTEXITCODE)" }
    return
  }

  $a = @('install', '-Dir', $Dir, '-Version', $Version)
  if ($bundleDir) { $a += @('-Bundle', $bundleDir) } elseif ($Edition -and -not $implicit) { $a += @('-Edition', $Edition) } elseif ($coreChosen) { $a += @('-Edition', 'core') }
  if ($Licence) { $a += @('-Licence', $Licence) }
  if ($Port) { $a += @('-Port', $Port) }
  if ($Url) { $a += @('-Url', $Url) }
  if ($Preset) { $a += @('-Preset', $Preset) }
  if ($Project) { $a += @('-Project', $Project) }
  if ($Build) { $a += '-Build' }
  & $shell -NoProfile -ExecutionPolicy Bypass -File $wrapper @a
  if ($LASTEXITCODE -ne 0) { throw "the install did not finish (exit code $LASTEXITCODE); it is safe to run the installer again" }
}

function Write-UtStep([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-UtOk([string]$m) { Write-Host "  ok  $m" -ForegroundColor Green }
function Test-UtInteractive { ($env:USERTASKS_NONINTERACTIVE -ne '1') -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected }
function Read-UtAnswer([string]$prompt, [string]$default) {
  if (-not (Test-UtInteractive)) { return $default }
  $a = Read-Host "$prompt [$default]"
  if ($a) { return $a } else { return $default }
}

function Test-UtMachine {
  Write-UtStep 'Checking this machine'
  $isWin = ($env:OS -eq 'Windows_NT')
  if (-not $isWin) { Write-Warning 'This is the Windows installer. On Linux and macOS use: curl -fsSL https://usertasks.com/install.sh | sh' }
  $arch = $env:PROCESSOR_ARCHITECTURE
  if (-not $arch) { $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() }
  switch -regex ($arch) { 'AMD64|X64' { $arch = 'amd64' } 'ARM64|Arm64' { $arch = 'arm64' } default { throw "unsupported processor: $arch (amd64 and arm64 images are published)" } }
  $osName = "Windows"; if (-not $isWin) { $osName = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription }
  Write-UtOk "$osName $arch"
  if ($isWin) {
    try {
      $gb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
      if ($gb -lt 4) { Write-Warning "this machine has $gb GB of memory; Docker Desktop and UserTasks need 4 GB or more" } else { Write-UtOk "memory: $gb GB" }
    } catch { }
  }
}

function Test-UtDisk([string]$dir) {
  try {
    $root = [System.IO.Path]::GetPathRoot($dir)
    $free = (New-Object System.IO.DriveInfo $root).AvailableFreeSpace
    if ($free -lt 5GB) { Write-Warning "only $([math]::Round($free / 1GB, 1)) GB free on $root; allow 5 GB for the images and data" }
    else { Write-UtOk "disk: $([math]::Round($free / 1GB)) GB free on $root" }
  } catch { }
}

function Test-UtDocker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host 'Docker is not installed. UserTasks runs in Docker containers.'
    Write-Host 'Install Docker Desktop for Windows (WSL 2 backend): https://docs.docker.com/desktop/setup/install/windows-install/'
    Write-Host 'Or, from an administrator PowerShell: winget install -e --id Docker.DockerDesktop'
    Write-Host 'Start Docker Desktop once, then run this installer again.'
    throw 'Docker is required'
  }
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running: start Docker Desktop (wait until it says "Engine running") and run this again.' }
  $cv = (& docker compose version --short 2>$null)
  if (-not $cv) { throw 'the Docker Compose plugin is missing (docker compose): update Docker Desktop' }
  $parts = $cv.TrimStart('v').Split('.')
  if ([int]$parts[0] -lt 2 -or ([int]$parts[0] -eq 2 -and [int]$parts[1] -lt 20)) { throw "Docker Compose $cv is too old; 2.20 or later is needed" }
  $os = (& docker info --format '{{.OSType}}' 2>$null)
  if ($os -eq 'windows') { throw 'Docker Desktop is in Windows-containers mode: right-click its tray icon and choose "Switch to Linux containers".' }
  Write-UtOk "Docker $(& docker version --format '{{.Server.Version}}' 2>$null), Compose $cv"
  $mem = [int64](& docker info --format '{{.MemTotal}}' 2>$null)
  if ($mem -gt 0 -and $mem -lt 2500000000) { Write-Warning "Docker has $([math]::Round($mem / 1MB)) MB of memory; give it at least 3 GB (memory= in %UserProfile%\.wslconfig)" }
}

function Set-UtTrustKey([string]$dir) {
  $key = Join-Path $dir 'release-key.pub.pem'
  if ($env:USERTASKS_RELEASE_KEY_FILE) { $pem = (Get-Content -Raw $env:USERTASKS_RELEASE_KEY_FILE) }
  else { $pem = $ReleasePublicKey }
  $pem = ($pem -replace "`r", '').Trim() + "`n"
  $body = ($pem -split "`n" | Where-Object { $_ -and ($_ -notmatch '^-----') })
  if (-not $body) { throw 'this copy of the installer has no release signing key, so it cannot verify downloads. Use https://usertasks.com/install.ps1 (or set USERTASKS_RELEASE_KEY_FILE to the published key).' }
  if (Test-Path $key) {
    $old = ((Get-Content -Raw $key) -replace "`r", '').Trim() + "`n"
    if ($old -ne $pem) { throw "$key differs from this installer's release key. If the key was rotated, read the release notes, then remove that file and run again." }
  }
  [IO.File]::WriteAllText($key, $pem)
  return $key
}

# Ed25519 over the raw file: OpenSSL 3 (PATH or Git for Windows), else Node.js, else a pinned node image in Docker.
function Test-UtSignature([string]$data, [string]$sig, [string]$key) {
  $candidates = @('openssl', "$env:ProgramFiles\Git\usr\bin\openssl.exe", "$env:ProgramFiles\Git\mingw64\bin\openssl.exe")
  foreach ($o in $candidates) {
    $cmd = Get-Command $o -ErrorAction SilentlyContinue
    if ($cmd -and ((& $cmd.Source version 2>$null) -match '^OpenSSL ([3-9]|[1-9][0-9])\.')) {
      & $cmd.Source pkeyutl -verify -pubin -inkey $key -rawin -in $data -sigfile $sig *> $null
      return ($LASTEXITCODE -eq 0)
    }
  }
  $js = "const c=require('crypto'),f=require('fs');const [d,s,k]=process.argv.slice(-3);process.exit(c.verify(null,f.readFileSync(d),c.createPublicKey(f.readFileSync(k)),f.readFileSync(s))?0:1)"
  $vd = Join-Path (Split-Path $data) ('.verify-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $vd | Out-Null
  try {
    [IO.File]::WriteAllText((Join-Path $vd 'verify.js'), $js)
    Copy-Item $data (Join-Path $vd 'd'); Copy-Item $sig (Join-Path $vd 's'); Copy-Item $key (Join-Path $vd 'k')
    if (Get-Command node -ErrorAction SilentlyContinue) {
      & node (Join-Path $vd 'verify.js') (Join-Path $vd 'd') (Join-Path $vd 's') (Join-Path $vd 'k')
    } else {
      & docker run --rm --network none -v "${vd}:/v:ro" 'node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a' node /v/verify.js /v/d /v/s /v/k
    }
    return ($LASTEXITCODE -eq 0)
  } finally { Remove-Item -Recurse -Force $vd -ErrorAction SilentlyContinue }
}

function Get-UtRelFile([string]$src, [string]$url, [string]$name, [string]$dest) {
  if ($src) { if (-not (Test-Path (Join-Path $src $name))) { throw "$name is not in $src" }; Copy-Item (Join-Path $src $name) $dest }
  else { Invoke-WebRequest -UseBasicParsing "$url/$name" -OutFile $dest }
}

# Get-UtRelease: download (or copy from -Source: an offline bundle's release\), verify, unpack.
function Get-UtRelease([string]$Base, [string]$Version, [string]$Dir, [string]$Key, [string]$Source = '') {
  $dest = Join-Path $Dir "releases\$Version"
  if ((Test-Path (Join-Path $dest '.verified')) -and (Test-Path (Join-Path $dest 'usertasks.ps1'))) { Write-UtOk "release $Version already downloaded and verified"; return }
  $dl = Join-Path $Dir "releases\.download-$Version"
  if (Test-Path $dl) { Remove-Item -Recurse -Force $dl }
  New-Item -ItemType Directory -Path $dl | Out-Null
  $url = "$Base/download/v$Version"; $bundle = "usertasks-$Version.tar.gz"
  if ($Source) { Write-UtStep "Checking UserTasks $Version from the bundle" } else { Write-UtStep "Downloading UserTasks $Version" }
  try {
    Get-UtRelFile $Source $url 'SHA256SUMS' (Join-Path $dl 'SHA256SUMS')
    Get-UtRelFile $Source $url 'SHA256SUMS.sig' (Join-Path $dl 'SHA256SUMS.sig')
  } catch { throw "release $Version not found at ${url}: $($_.Exception.Message)" }
  if (-not (Test-UtSignature (Join-Path $dl 'SHA256SUMS') (Join-Path $dl 'SHA256SUMS.sig') $Key)) {
    throw "signature check FAILED: SHA256SUMS of $Version was not signed by the UserTasks release key. Nothing was installed."
  }
  Write-UtOk 'signature'
  $want = $null
  foreach ($l in Get-Content (Join-Path $dl 'SHA256SUMS')) { if ($l -match '^([0-9a-f]{64}) [ *](.+)$' -and $Matches[2] -eq $bundle) { $want = $Matches[1] } }
  if (-not $want) { throw "SHA256SUMS does not list $bundle" }
  Get-UtRelFile $Source $url $bundle (Join-Path $dl $bundle)
  $have = (Get-FileHash -Algorithm SHA256 (Join-Path $dl $bundle)).Hash.ToLowerInvariant()
  if ($have -ne $want) { throw "checksum mismatch for ${bundle}: the download is damaged or was changed. Nothing was installed." }
  Write-UtOk 'checksum'
  $x = Join-Path $dl 'x'; New-Item -ItemType Directory -Path $x | Out-Null
  & tar -xzf (Join-Path $dl $bundle) -C $x
  if ($LASTEXITCODE -ne 0) { throw "could not unpack $bundle (tar)" }
  $top = Join-Path $x "usertasks-$Version"
  $manifest = Get-Content -Raw (Join-Path $top 'manifest.json') | ConvertFrom-Json
  if ($manifest.version -ne $Version) { throw "$bundle is version $($manifest.version), not $Version" }
  Copy-Item (Join-Path $dl 'SHA256SUMS'), (Join-Path $dl 'SHA256SUMS.sig') $top
  New-Item -ItemType File -Path (Join-Path $top '.verified') | Out-Null
  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  Move-Item $top $dest
  Remove-Item -Recurse -Force $dl
}

# ── split bundles (parts; the same format as install.sh) ───────────────────
# A bundle over GitHub's 2 GiB release-asset limit comes in parts: <name>.tar.part-001 …,
# <name>.tar.parts.json (size + sha256 of the whole and of each part, in order) and
# <name>.tar.parts.json.sig (its ed25519 signature by the release key). The signature,
# then every part, then the joined file are checked before anything is unpacked.

function Read-UtParts([string]$manifest) {
  $leaf = Split-Path -Leaf $manifest
  try { $m = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json } catch { throw "$leaf is not a bundle parts manifest" }
  if ([string]$m.name -cnotmatch '^[A-Za-z0-9._-]+\.tar$' -or [string]$m.size -cnotmatch '^\d+$' -or [string]$m.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw "$leaf is not a bundle parts manifest" }
  $parts = @($m.parts)
  if ($parts.Count -lt 1) { throw "$leaf lists no parts" }
  $sum = [int64]0; $i = 0
  foreach ($p in $parts) {
    $i++
    if ([string]$p.name -cne ('{0}.part-{1:D3}' -f $m.name, $i) -or [string]$p.size -cnotmatch '^\d+$' -or [string]$p.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw "$leaf lists an unexpected part (entry $i)" }
    $sum += [int64]$p.size
  }
  if ($sum -ne [int64]$m.size) { throw "the parts in $leaf do not add up to the bundle size" }
  return $m
}

# Test-UtPart: 0 intact, 1 missing, 2 wrong size, 3 checksum mismatch.
function Test-UtPart([string]$file, $size, [string]$sha) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return 1 }
  if ((Get-Item -LiteralPath $file).Length -ne [int64]$size) { return 2 }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() -ne $sha) { return 3 }
  return 0
}

# Join-UtParts: verify the signature and every part, join them (streamed) into $work, check the whole. Returns the .tar.
function Join-UtParts([string]$manifest, [string]$key, [string]$work) {
  $dir = Split-Path -Parent $manifest; $leaf = Split-Path -Leaf $manifest
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "parts manifest not found: $manifest" }
  if (-not (Test-Path -LiteralPath "$manifest.sig" -PathType Leaf)) { throw "$leaf.sig is missing: copy it next to $leaf (the parts can't be checked without it)" }
  if (-not (Test-UtSignature $manifest "$manifest.sig" $key)) { throw "signature check FAILED: $leaf was not signed by the UserTasks release key. Nothing was installed." }
  Write-UtOk "signature of $leaf"
  $m = Read-UtParts $manifest; $n = @($m.parts).Count
  Write-UtStep "Checking the $n parts of $($m.name)"
  $i = 0
  foreach ($p in $m.parts) {
    $i++
    switch (Test-UtPart (Join-Path $dir $p.name) $p.size $p.sha256) {
      1 { throw "part $i of $n ($($p.name)) is missing: copy it next to $leaf (or download it again)" }
      2 { throw "part $i of $n ($($p.name)) is incomplete or damaged (wrong size): download it again" }
      3 { throw "part $i of $n ($($p.name)) is damaged (checksum mismatch): download it again" }
    }
  }
  Write-UtOk "$n parts (sizes and checksums)"
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  $out = Join-Path $work $m.name
  $os = [IO.File]::Create($out)
  try {
    foreach ($p in $m.parts) {
      $is = [IO.File]::OpenRead((Join-Path $dir $p.name))
      try { $is.CopyTo($os, 1048576) } finally { $is.Dispose() }
    }
  } finally { $os.Dispose() }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant() -ne $m.sha256) { Remove-Item -Force -LiteralPath $out; throw "the joined bundle does not match ${leaf} (checksum mismatch): download the parts again" }
  Write-UtOk "joined $($m.name) (checksum)"
  return $out
}

# Resolve-UtBundle: a bundle .tar, or its parts (the .parts.json, one of the parts, or the folder holding them).
function Resolve-UtBundle([string]$path, [string]$key, [string]$work) {
  $m = ''
  if ($path -like '*.parts.json') { $m = $path }
  elseif ($path -match '\.part-\d{3}$') { $m = ($path -replace '\.part-\d{3}$', '') + '.parts.json' }
  elseif (Test-Path -LiteralPath $path -PathType Container) {
    $ms = @(Get-ChildItem -LiteralPath $path -File | Where-Object { $_.Name -like '*.parts.json' })
    if ($ms.Count -gt 1) { throw "$path holds more than one bundle: name its .parts.json" }
    if ($ms.Count -eq 1) { $m = $ms[0].FullName }
    else {
      $ts = @(Get-ChildItem -LiteralPath $path -File | Where-Object { $_.Name -like '*.tar' })
      if ($ts.Count -ne 1) { throw "$path has no offline bundle (a .tar, or the .part-NNN files with their .parts.json)" }
      $path = $ts[0].FullName
    }
  }
  if ($m) { return @{ File = (Join-UtParts $m $key $work); Joined = $true } }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "bundle not found: $path" }
  return @{ File = $path; Joined = $false }
}

# Save-UtParts: download a prebuilt split bundle into $out (resumes; every part checked).
function Save-UtParts([string]$url, [string]$out, [string]$key) {
  if ($url -notmatch '^(https?|file)://.+\.parts\.json$') { throw "-From needs the address of a bundle's .parts.json file" }
  $base = $url.Substring(0, $url.LastIndexOf('/')); $leaf = $url.Substring($url.LastIndexOf('/') + 1)
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $out = (Resolve-Path $out).Path
  $mf = Join-Path $out $leaf
  Write-UtStep "Downloading $leaf"
  try { Invoke-WebRequest -UseBasicParsing $url -OutFile $mf; Invoke-WebRequest -UseBasicParsing "$url.sig" -OutFile "$mf.sig" }
  catch { throw "could not download $url or its .sig: $($_.Exception.Message)" }
  if (-not (Test-UtSignature $mf "$mf.sig" $key)) { throw "signature check FAILED: $leaf was not signed by the UserTasks release key" }
  Write-UtOk "signature of $leaf"
  $m = Read-UtParts $mf; $n = @($m.parts).Count; $i = 0
  foreach ($p in $m.parts) {
    $i++; $f = Join-Path $out $p.name
    if ((Test-UtPart $f $p.size $p.sha256) -eq 0) { Write-UtOk "part $i of $n already here ($($p.name))"; continue }
    # A complete part that fails its check (or an over-long one) is downloaded again from the start.
    if ((Test-Path -LiteralPath $f) -and (Get-Item -LiteralPath $f).Length -ge [int64]$p.size) { Remove-Item -Force -LiteralPath $f }
    Write-UtStep "Downloading part $i of $n ($($p.name), $([math]::Round([int64]$p.size / 1MB)) MB)"
    Get-UtResume "$base/$($p.name)" $f "the download of part $i of $n stopped: run the same command again to resume it"
    if ((Test-UtPart $f $p.size $p.sha256) -ne 0) { Remove-Item -Force -LiteralPath $f; throw "part $i of $n ($($p.name)) arrived damaged (checksum mismatch): run the same command again to download it again" }
    Write-UtOk "part $i of $n ($($p.name), checksum)"
  }
  Write-Host ''
  Write-Host "Offline bundle ready: $out ($n parts of $($m.name), $([math]::Round([int64]$m.size / 1MB)) MB in all; signature and checksums verified)" -ForegroundColor Green
  Write-Host "Carry these to the offline host, in one folder: $leaf, $leaf.sig and the $n .part-NNN files,"
  Write-Host 'with this installer (https://usertasks.com/install.ps1) and your licence file. There:'
  Write-Host '  & .\install.ps1 -Bundle <folder> -Licence <your .licence file>'
  Write-Host '(it checks the signature and every part, then joins them). Upgrades: usertasks upgrade -Bundle <folder>'
}

# Get-UtResume: download $url to $file, continuing a partial $file (curl.exe, else an HTTP range request).
function Get-UtResume([string]$url, [string]$file, [string]$failure) {
  $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($curl) {
    & $curl.Source -fL --retry 3 --connect-timeout 20 -C - -o $file $url
    if ($LASTEXITCODE -ne 0) { throw $failure }
    return
  }
  $have = [int64]0
  if (Test-Path -LiteralPath $file) { $have = (Get-Item -LiteralPath $file).Length }
  try {
    $req = [Net.WebRequest]::Create($url)
    if ($have -gt 0 -and $req -is [Net.HttpWebRequest]) { $req.AddRange($have) }
    $res = $req.GetResponse()
    $mode = [IO.FileMode]::Create
    if ($have -gt 0 -and $res -is [Net.HttpWebResponse] -and [int]$res.StatusCode -eq 206) { $mode = [IO.FileMode]::Append }
    $fs = New-Object IO.FileStream($file, $mode)
    try { $res.GetResponseStream().CopyTo($fs, 1048576) } finally { $fs.Dispose(); $res.Close() }
  } catch { throw "$failure ($($_.Exception.Message))" }
}

Invoke-UserTasksInstall @args
