[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(?:\d{1,3}\.){3}\d{1,3}$')]
  [string]$ConnectAddress,

  [ValidateRange(1, 65535)]
  [int]$ListenPort = 18080,

  [ValidateRange(1, 65535)]
  [int]$ConnectPort = 8080,

  [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'

function Write-Diagnostic {
  param([Parameter(Mandatory = $true)][string]$Message)
  if ($LogPath) {
    [System.IO.File]::WriteAllText(
      $LogPath,
      $Message,
      [System.Text.UTF8Encoding]::new($false)
    )
  }
  Write-Host $Message
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $administrator = [Security.Principal.WindowsBuiltInRole]::Administrator

  if (-not $principal.IsInRole($administrator)) {
    throw 'Este script necesita una ventana de PowerShell con permisos de administrador.'
  }

  $ipHelper = Get-Service -Name iphlpsvc
  if ($ipHelper.Status -ne 'Running') {
    Start-Service -Name iphlpsvc
    $ipHelper.WaitForStatus('Running', [TimeSpan]::FromSeconds(10))
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

  $healthUrl = "http://127.0.0.1:$ListenPort/healthz"
  $verified = $false
  $lastHealthError = 'sin respuesta'

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 -Uri $healthUrl
      if ($health.ok -ne $true -or $health.service -ne 'esp32-4848s040-emulator') {
        throw 'La respuesta no pertenece al emulador esperado.'
      }
      $verified = $true
      break
    } catch {
      $lastHealthError = $_.Exception.Message
      Start-Sleep -Milliseconds 750
    }
  }

  if (-not $verified) {
    throw "El puente fue creado, pero $healthUrl no responde correctamente: $lastHealthError"
  }

  $message = @(
    "Puente WSL -> Windows verificado: $healthUrl",
    "Abra en Chrome: http://127.0.0.1:$ListenPort"
  ) -join [Environment]::NewLine
  Write-Diagnostic -Message $message
} catch {
  $message = "ERROR DEL PUENTE WSL: $($_.Exception.Message)"
  Write-Diagnostic -Message $message
  exit 1
}
