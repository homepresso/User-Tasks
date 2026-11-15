# End-to-end run of install.ps1 and usertasks.ps1 (PowerShell 7 or Windows PowerShell 5.1)
# against the local releases scripts/install-e2e.sh made (its --work folder keeps www/):
#
#   pwsh scripts/install-e2e.ps1 -Work <install-e2e.sh work folder> [-Port 3491] [-Project ut-oneline-ps]
#
# `irm … | iex` install → health → setup code printed → re-run → status → backup
# → upgrade to 99.0.1 → forced failure (99.0.2, rolled back) → failing migration
# (99.0.3, nothing switched) → uninstall (data kept) → uninstall -Purge.
# Needs Docker and python3 (the release server).
param(
  [Parameter(Mandatory = $true)][string]$Work,
  [int]$Port = 3491,
  [string]$Project = 'ut-oneline-ps'
)
$ErrorActionPreference = 'Stop'
$Work = (Resolve-Path $Work).Path
$Dir = Join-Path $Work 'ps-install'
$SrvPort = $Port + 5
$Base = "http://127.0.0.1:$SrvPort/releases"
$Log = Join-Path $Work 'e2e-ps.log'
# This PowerShell (pwsh or powershell.exe) runs the installer and the wrapper.
$Shell = (Get-Process -Id $PID).Path
Set-Content -Path $Log -Value ''
$script:Passed = 0; $script:Failed = 0
function Check([string]$m, [bool]$ok) { if ($ok) { $script:Passed++; Write-Host "PASS  $m" } else { $script:Failed++; Write-Host "FAIL  $m" } }
function Test-Healthy { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$Port/api/config/public").StatusCode -eq 200 } catch { $false } }
function Invoke-Ut([string[]]$a) {
  $out = & $Shell -NoProfile -File (Join-Path $Dir 'bin/usertasks.ps1') @a 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  Add-Content -Path $Log -Value ($out -join "`n")
  return @{ Code = $code; Out = ($out -join "`n") }
}
function Set-Latest([string]$v) {
  $l = Join-Path $Work 'www/releases/latest/download'
  if (Test-Path $l) { Remove-Item -Recurse -Force $l }
  New-Item -ItemType Directory -Force -Path $l | Out-Null
  Copy-Item (Join-Path $Work "www/releases/download/v$v/*") $l
}
function Get-AppImageId {
  $cid = & docker ps -q --filter "label=com.docker.compose.project=$Project" --filter 'label=com.docker.compose.service=app'
  if (-not $cid) { return '' }
  return (& docker inspect --format '{{.Image}}' $cid)
}
function Invoke-Installer {
  $cmd = "`$env:USERTASKS_DIR='$Dir'; `$env:USERTASKS_PORT='$Port'; `$env:USERTASKS_PROJECT='$Project'; `$env:USERTASKS_NONINTERACTIVE='1'; `$env:USERTASKS_NO_BROWSER='1'; irm $Base/latest/download/install.ps1 | iex"
  $out = & $Shell -NoProfile -Command $cmd 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  Add-Content -Path $Log -Value ($out -join "`n")
  return @{ Code = $code; Out = ($out -join "`n") }
}

$baseVersion = (Get-ChildItem (Join-Path $Work 'www/releases/download') -Directory | Where-Object { $_.Name -notlike 'v99.*' } | Select-Object -First 1).Name.TrimStart('v')
Set-Latest $baseVersion
$srv = Start-Process -PassThru -FilePath python3 -ArgumentList @('-m', 'http.server', "$SrvPort", '--bind', '127.0.0.1') -WorkingDirectory (Join-Path $Work 'www') -RedirectStandardError (Join-Path $Work 'ps-srv.log')
Start-Sleep -Seconds 2
$env:USERTASKS_RELEASE_BASE = $Base
$env:USERTASKS_MAILPIT_PORT = "$($Port + 1)"; $env:USERTASKS_MINIO_CONSOLE_PORT = "$($Port + 2)"
try {
  Write-Host '== install (irm | iex)'
  $r = Invoke-Installer
  Check 'irm | iex install' ($r.Code -eq 0 -and $r.Out -match 'is running')
  Check 'healthy' (Test-Healthy)
  $code = (Get-Content (Join-Path $Dir '.env') | Where-Object { $_ -like 'USERTASKS_SETUP_CODE=*' }).Substring(21)
  Check 'installer printed the setup code' ($r.Out -match [regex]::Escape("setup code $code"))
  Check 'setup code has the server format' ($code -match '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$')
  $before = (Get-FileHash (Join-Path $Dir '.env')).Hash
  $r = Invoke-Installer
  Check 'installer re-run (idempotent)' ($r.Code -eq 0 -and $r.Out -match 'Existing install found')
  Check '.env unchanged by the re-run' ((Get-FileHash (Join-Path $Dir '.env')).Hash -eq $before)
  $r = Invoke-Ut @('status')
  Check 'usertasks status' ($r.Code -eq 0 -and $r.Out -match 'healthy')

  Write-Host '== backup'
  $r = Invoke-Ut @('backup', '-Out', (Join-Path $Work 'ps-backup'))
  Check 'usertasks backup' ($r.Code -eq 0 -and (Test-Path (Join-Path $Work 'ps-backup/database.dump')) -and (Test-Path (Join-Path $Work 'ps-backup/files.tar.gz')))
  Check 'database dump is a pg_dump custom archive' ([Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes((Join-Path $Work 'ps-backup/database.dump'))[0..4]) -eq 'PGDMP')
  $r = Invoke-Ut @('restore', (Join-Path $Work 'ps-backup'), '-Yes')
  Check 'usertasks restore' ($r.Code -eq 0 -and (Test-Healthy))

  Write-Host '== upgrade'
  Set-Latest '99.0.1'
  $r = Invoke-Ut @('upgrade', '-Yes')
  $newId = & docker image inspect --format '{{.Id}}' usertasks-e2e:new
  Check 'usertasks upgrade (latest = 99.0.1)' ($r.Code -eq 0 -and $r.Out -match 'Upgraded UserTasks')
  Check 'app runs the new image' ((Get-AppImageId) -eq $newId)
  $env:USERTASKS_UPGRADE_TIMEOUT = '60'
  $r = Invoke-Ut @('upgrade', '-To', '99.0.2', '-Yes', '-SkipBackup')
  Remove-Item Env:USERTASKS_UPGRADE_TIMEOUT
  Check 'bad-start upgrade fails and rolls back' ($r.Code -ne 0 -and $r.Out -match 'Rolled back: UserTasks 99.0.1 is running again')
  Check '99.0.1 healthy after the rollback' ((Get-AppImageId) -eq $newId -and (Test-Healthy))
  $r = Invoke-Ut @('upgrade', '-To', '99.0.3', '-Yes', '-SkipBackup')
  Check 'failing migration: nothing switched' ($r.Code -ne 0 -and $r.Out -match 'no code was switched' -and (Get-AppImageId) -eq $newId)

  Write-Host '== uninstall'
  $r = Invoke-Ut @('uninstall', '-Yes')
  Check 'uninstall keeps the data' ($r.Code -eq 0 -and -not (& docker ps -q --filter "label=com.docker.compose.project=$Project") -and ((& docker volume ls -q) -contains "${Project}_pgdata"))
  $r = Invoke-Ut @('uninstall', '-Purge', '-Yes')
  Check 'uninstall -Purge removes everything' ($r.Code -eq 0 -and -not ((& docker volume ls -q) -contains "${Project}_pgdata") -and -not (Test-Path $Dir))
} finally {
  Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue
  if (Test-Path (Join-Path $Dir 'state.env')) { Invoke-Ut @('uninstall', '-Purge', '-Yes') | Out-Null }
}
Write-Host ''
Write-Host "install-e2e.ps1: $($script:Passed) passed, $($script:Failed) failed (log: $Log)"
if ($script:Failed -gt 0) { exit 1 }
