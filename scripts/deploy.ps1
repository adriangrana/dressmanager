param(
  [string]$Destination = 'C:\www\tul-en-foco',
  [int]$Port = 3101
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$WwwRoot = [IO.Path]::GetFullPath('C:\www').TrimEnd('\')
$DeployRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
$ServiceName = 'tul-en-foco'

if (-not (Test-Path -LiteralPath $WwwRoot -PathType Container)) { throw "No existe $WwwRoot." }
if (-not $DeployRoot.StartsWith($WwwRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "El destino debe estar dentro de $WwwRoot."
}
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Puerto no válido.' }
if (-not (Get-Command runara -ErrorAction SilentlyContinue)) { throw 'Runara no está instalado.' }

Push-Location $ProjectRoot
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación.' }

  $Info = (& runara info $ServiceName 2>&1 | Out-String)
  $Registered = $Info -match '(?m)^Name: tul-en-foco\s*$'
  if ($Registered) {
    & runara stop $ServiceName
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener el servicio anterior.' }
  }

  New-Item -ItemType Directory -Path $DeployRoot -Force | Out-Null
  foreach ($Folder in @('dist', 'server')) {
    $Target = Join-Path $DeployRoot $Folder
    $CheckedTarget = [IO.Path]::GetFullPath($Target)
    if (-not $CheckedTarget.StartsWith($DeployRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "Ruta de actualización no válida: $Target"
    }
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $ProjectRoot $Folder) -Destination $Target -Recurse -Force
  }

  $PublicTarget = Join-Path $DeployRoot 'public'
  New-Item -ItemType Directory -Path $PublicTarget -Force | Out-Null
  $ImagesTarget = Join-Path $PublicTarget 'images'
  if (Test-Path -LiteralPath $ImagesTarget) { Remove-Item -LiteralPath $ImagesTarget -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'public\images') -Destination $ImagesTarget -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'public\favicon.svg') -Destination $PublicTarget -Force

  $UploadsTarget = Join-Path $PublicTarget 'uploads'
  if (-not (Test-Path -LiteralPath $UploadsTarget)) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'public\uploads') -Destination $UploadsTarget -Recurse -Force
  }

  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package.json') -Destination $DeployRoot -Force
  Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package-lock.json') -Destination $DeployRoot -Force

  $EnvTarget = Join-Path $DeployRoot '.env'
  if (-not (Test-Path -LiteralPath $EnvTarget)) {
    $SourceEnv = Join-Path $ProjectRoot '.env'
    if (-not (Test-Path -LiteralPath $SourceEnv)) { throw 'Falta .env en el proyecto.' }
    Copy-Item -LiteralPath $SourceEnv -Destination $EnvTarget
  }
  $EnvLines = @(Get-Content -LiteralPath $EnvTarget | Where-Object { $_ -notmatch '^(NODE_ENV|PORT|HOST)=' })
  $EnvLines += @('NODE_ENV=production', "PORT=$Port", 'HOST=127.0.0.1')
  Set-Content -LiteralPath $EnvTarget -Value $EnvLines -Encoding UTF8

  $DataTarget = Join-Path $DeployRoot 'data'
  New-Item -ItemType Directory -Path $DataTarget -Force | Out-Null
  $DatabaseTarget = Join-Path $DataTarget 'dressmanager.sqlite'
  if (-not (Test-Path -LiteralPath $DatabaseTarget)) {
    $SourceDatabase = Join-Path $ProjectRoot 'data\dressmanager.sqlite'
    if (Test-Path -LiteralPath $SourceDatabase) {
      & node (Join-Path $ProjectRoot 'scripts\backup-sqlite.mjs') $SourceDatabase $DatabaseTarget
      if ($LASTEXITCODE -ne 0) { throw 'Falló la copia segura de la base de datos.' }
    }
  }

  Push-Location $DeployRoot
  try {
    & npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de dependencias de producción.' }
  } finally { Pop-Location }

  if ($Registered) {
    & runara restart $ServiceName
  } else {
    & runara run 'node server/index.js' --name $ServiceName --cwd $DeployRoot --autostart
  }
  if ($LASTEXITCODE -ne 0) { throw 'Runara no pudo iniciar la aplicación.' }

  $HealthUrl = "http://127.0.0.1:$Port/api/health"
  $Healthy = $false
  for ($Attempt = 0; $Attempt -lt 15; $Attempt++) {
    try {
      $Response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
      if ($Response.StatusCode -eq 200) { $Healthy = $true; break }
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $Healthy) { throw "Runara inició el proceso, pero $HealthUrl no respondió correctamente." }
  Write-Output "Desplegado en $DeployRoot"
  Write-Output "Vista pública: http://127.0.0.1:$Port/"
  Write-Output "Administración: http://127.0.0.1:$Port/admin"
} finally {
  Pop-Location
}
