<#
  UserTasks on-premises gateway - install, register, upgrade and remove on Windows Server.

  Run in an elevated PowerShell on a server that can reach your systems (e.g. SharePoint)
  and the internet over HTTPS (directly or through your proxy). The folder holding this
  script must contain usertasks-gateway.mjs (from the gateway release zip).

    # first instance: install the service and register with the one-time token
    .\Install-UserTasksGateway.ps1 -CloudUrl https://acme.usertasks.com -Token utgwr_...

    # then edit C:\ProgramData\UserTasks Gateway\gateway.json (targets, relay) and start:
    Start-Service UserTasksGateway

    # upgrade (new release extracted next to this script): replaces the program, keeps the
    # configuration and the instance key; upgrade one instance at a time for no downtime
    .\Install-UserTasksGateway.ps1 -Upgrade

    # remove the service (add -Purge to also delete the configuration and the key)
    .\Install-UserTasksGateway.ps1 -Uninstall [-Purge]

  What it does: copies the gateway to C:\Program Files\UserTasks Gateway, installs Node.js 20
  there (checksum-verified) unless -NodePath is given, installs the Windows service
  "UserTasksGateway" (WinSW wrapper, checksum-pinned) running as -ServiceAccount (default
  NT SERVICE\UserTasksGateway, a virtual account; use a gMSA for Kerberos to the targets),
  restricts C:\ProgramData\UserTasks Gateway to SYSTEM, Administrators and that account, and
  registers the instance (the private key is generated here and never leaves this machine).
  Nothing listens on the network unless you enable the relay in gateway.json.
#>
[CmdletBinding()]
param(
  [string]$CloudUrl,
  [string]$Token,
  [switch]$Upgrade,
  [switch]$Uninstall,
  [switch]$Purge,
  [string]$ServiceAccount = 'NT SERVICE\UserTasksGateway',
  [System.Management.Automation.PSCredential]$ServiceCredential,
  [string]$NodePath,
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'UserTasks Gateway'),
  [string]$DataDir = (Join-Path $env:ProgramData 'UserTasks Gateway')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ServiceName = 'UserTasksGateway'
$NodeVersion = 'v20.18.1'
$WinSwUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$WinSwSha256 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'

function Assert-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script in an elevated PowerShell.' }
}

function Get-Verified([string]$Url, [string]$Path, [string]$Sha256) {
  Invoke-WebRequest -UseBasicParsing $Url -OutFile $Path
  $got = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $Sha256.ToLower()) { Remove-Item $Path -Force; throw "Checksum mismatch for $Url" }
}

function Install-Node {
  if ($NodePath) { return $NodePath }
  $node = Join-Path $InstallDir 'node\node.exe'
  if (Test-Path $node) { return $node }
  $zip = Join-Path $env:TEMP "node-$NodeVersion.zip"
  $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt").Content -split "`n"
  $line = $sums | Where-Object { $_ -match "node-$NodeVersion-win-x64.zip$" }
  if (-not $line) { throw 'Could not read the Node.js checksums' }
  Get-Verified "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" $zip (($line -split '\s+')[0])
  Expand-Archive $zip -DestinationPath $InstallDir -Force
  Move-Item (Join-Path $InstallDir "node-$NodeVersion-win-x64") (Join-Path $InstallDir 'node')
  Remove-Item $zip -Force
  return $node
}

function Set-DataAcl {
  # After the service exists (the virtual account NT SERVICE\UserTasksGateway is created with it).
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $account = if ($ServiceCredential) { $ServiceCredential.UserName } elseif ($ServiceAccount -in @('LocalSystem', 'NT AUTHORITY\SYSTEM')) { 'SYSTEM' } else { $ServiceAccount }
  & icacls $DataDir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' "${account}:(OI)(CI)M" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not restrict $DataDir to SYSTEM, Administrators and $account" }
}

function Write-ServiceXml([string]$Node) {
  $exe = Join-Path $InstallDir 'usertasks-gateway.mjs'
  $xml = @"
<service>
  <id>$ServiceName</id>
  <name>UserTasks Gateway</name>
  <description>Carries UserTasks connector requests to systems on this network (outbound HTTPS only).</description>
  <executable>$Node</executable>
  <arguments>"$exe" run --config "$DataDir\gateway.json"</arguments>
  <workingdirectory>$InstallDir</workingdirectory>
  <env name="UTGW_STATE_DIR" value="$DataDir" />
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>90 sec</stoptimeout>
  <logpath>$DataDir\logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
</service>
"@
  Set-Content -Path (Join-Path $InstallDir "$ServiceName.xml") -Value $xml -Encoding UTF8
}

function Write-DefaultConfig {
  $cfg = Join-Path $DataDir 'gateway.json'
  if (Test-Path $cfg) { return }
  $json = [ordered]@{
    cloudUrl = $CloudUrl
    instanceName = $env:COMPUTERNAME
    stateDir = $DataDir
    targets = @(@{ id = 'sharepoint'; url = 'https://sharepoint.contoso.com'; auth = @{ type = 'windows'; mode = 'negotiate'; username = 'CONTOSO\svc-usertasks'; passwordFile = (Join-Path $DataDir 'sharepoint.pwd') } })
  } | ConvertTo-Json -Depth 6
  Set-Content -Path $cfg -Value $json -Encoding UTF8
  Write-Host "Wrote $cfg - edit the targets (and the relay) before starting the service."
}

Assert-Admin
$wrapper = Join-Path $InstallDir "$ServiceName.exe"

if ($Uninstall) {
  if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service $ServiceName -ErrorAction SilentlyContinue
    & $wrapper uninstall | Out-Null
  }
  Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  if ($Purge) { Remove-Item $DataDir -Recurse -Force -ErrorAction SilentlyContinue }
  $msg = 'UserTasks Gateway removed.'
  if ($Purge) { $msg += ' Revoke the instance in UserTasks (Settings > On-premises gateways).' }
  Write-Host $msg
  return
}

$program = Join-Path $PSScriptRoot 'usertasks-gateway.mjs'
if (-not (Test-Path $program)) { throw "usertasks-gateway.mjs not found next to this script" }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$running = Get-Service $ServiceName -ErrorAction SilentlyContinue
if ($running -and $Upgrade) { Stop-Service $ServiceName }
Copy-Item $program (Join-Path $InstallDir 'usertasks-gateway.mjs') -Force
if (Test-Path "$program.map") { Copy-Item "$program.map" (Join-Path $InstallDir 'usertasks-gateway.mjs.map') -Force }
$node = Install-Node
if (-not (Test-Path $wrapper)) { Get-Verified $WinSwUrl $wrapper $WinSwSha256 }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Write-ServiceXml $node

if ($Upgrade) {
  if (-not $running) { throw 'The service is not installed; run without -Upgrade.' }
  & $wrapper refresh | Out-Null
  Set-DataAcl
  Start-Service $ServiceName
  Write-Host "Upgraded to $(& $node (Join-Path $InstallDir 'usertasks-gateway.mjs') version)."
  return
}

if (-not $CloudUrl) { throw '-CloudUrl is required (your UserTasks address, https://...)' }
Write-DefaultConfig
if (-not $running) {
  & $wrapper install | Out-Null
  if ($ServiceCredential) {
    & sc.exe config $ServiceName obj= $ServiceCredential.UserName password= $ServiceCredential.GetNetworkCredential().Password | Out-Null
  } else {
    & sc.exe config $ServiceName obj= $ServiceAccount | Out-Null
  }
}
Set-DataAcl
if ($Token) {
  & $node (Join-Path $InstallDir 'usertasks-gateway.mjs') register --config (Join-Path $DataDir 'gateway.json') --token $Token
  if ($LASTEXITCODE -ne 0) { throw 'Registration failed (see above). Check the token (valid 24 hours, single use) and HTTPS access to the UserTasks address.' }
  Set-DataAcl
  Write-Host 'Registered. Start the service when gateway.json lists your targets: Start-Service UserTasksGateway'
}
