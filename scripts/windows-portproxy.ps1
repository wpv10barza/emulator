[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(?:\d{1,3}\.){3}\d{1,3}$')]
  [string]$ConnectAddress,

  [ValidateRange(1, 65535)]
  [int]$ListenPort = 18080,

  [ValidateRange(1, 65535)]
  [int]$ConnectPort = 8080
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$administrator = [Security.Principal.WindowsBuiltInRole]::Administrator

if (-not $principal.IsInRole($administrator)) {
  throw 'Este script necesita una ventana de PowerShell con permisos de administrador.'
}

& netsh.exe interface portproxy delete v4tov4 "listenaddress=127.0.0.1" "listenport=$ListenPort" 2>$null | Out-Null
Start-Sleep -Milliseconds 250

$listener = Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' }

if ($listener) {
  $owners = $listener | ForEach-Object {
    $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($process) { "$($process.ProcessName) (PID $($_.OwningProcess))" } else { "PID $($_.OwningProcess)" }
  } | Sort-Object -Unique
  throw "El puerto local $ListenPort ya esta ocupado por: $($owners -join ', '). Use otro --listen-port."
}

& netsh.exe interface portproxy add v4tov4 "listenaddress=127.0.0.1" "listenport=$ListenPort" "connectaddress=$ConnectAddress" "connectport=$ConnectPort" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "netsh no pudo crear el puente 127.0.0.1:$ListenPort -> ${ConnectAddress}:$ConnectPort."
}

$ipHelper = Get-Service -Name iphlpsvc
if ($ipHelper.Status -ne 'Running') {
  Start-Service -Name iphlpsvc
}

Start-Sleep -Milliseconds 750
$healthUrl = "http://127.0.0.1:$ListenPort/healthz"
try {
  $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 -Uri $healthUrl
  if ($health.ok -ne $true -or $health.service -ne 'esp32-4848s040-emulator') {
    throw 'La respuesta no pertenece al emulador esperado.'
  }
} catch {
  throw "El puente fue creado, pero $healthUrl no responde correctamente: $($_.Exception.Message)"
}

Write-Host "Puente WSL -> Windows verificado: $healthUrl" -ForegroundColor Green
Write-Host "Abra en Chrome: http://127.0.0.1:$ListenPort" -ForegroundColor Cyan
