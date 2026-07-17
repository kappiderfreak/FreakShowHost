param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,
  [string]$Repository = 'kappiderfreak/FreakShow',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'release-output'),
  [switch]$WriteRepositoryManifest
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/')
$output = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\', '/')
if (-not $output.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory muss innerhalb des FreakShow-Projektordners liegen.'
}

$versionSource = Get-Content -LiteralPath (Join-Path $root 'VERSION.txt') -Raw
$versionSource = $versionSource.Trim()
if ($versionSource -ne $Version) {
  throw "VERSION.txt ($versionSource) stimmt nicht mit -Version $Version ueberein."
}
$versionInfo = Get-Content -LiteralPath (Join-Path $root 'VersionInfo.cs') -Raw
if ($versionInfo -notmatch ('Current\s*=\s*"' + [regex]::Escape($Version) + '"')) {
  throw "VersionInfo.cs enthaelt nicht die Version $Version."
}
$updaterVersionInfo = Get-Content -LiteralPath (Join-Path $root 'UpdaterVersionInfo.cs') -Raw
if ($updaterVersionInfo -notmatch ('AssemblyInformationalVersion\("' + [regex]::Escape($Version) + '"\)')) {
  throw "UpdaterVersionInfo.cs enthaelt nicht die Version $Version."
}

& (Join-Path $root 'Build.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen.' }

if (Test-Path -LiteralPath $output) {
  $resolved = (Resolve-Path -LiteralPath $output).Path
  if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Unsicherer Ausgabeordner.'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

$stage = Join-Path $output 'FreakShow'
$stageApp = Join-Path $stage 'app'
New-Item -ItemType Directory -Path $stageApp -Force | Out-Null

$rootFiles = @(
  'FreakShow.exe',
  'FreakShow.exe.config',
  'FreakShowUpdater.exe',
  'FreakShowUpdater.exe.config',
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'WebView2Loader.dll',
  'OverlayIcon.ico',
  'LICENSE',
  'README-FIRST.txt',
  'README.txt',
  'VERSION.txt'
)
foreach ($name in $rootFiles) {
  $source = Join-Path $root $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Release-Datei fehlt: $name" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stage $name) -Force
}
Get-ChildItem -LiteralPath (Join-Path $root 'app') -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stageApp $_.Name) -Force
}

$zipName = "FreakShow-update-$Version.zip"
$zipPath = Join-Path $output $zipName
Compress-Archive -LiteralPath $stage -DestinationPath $zipPath -CompressionLevel Optimal
$sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

$fullContainer = Join-Path $output 'full-stage'
$fullStage = Join-Path $fullContainer 'FreakShow'
New-Item -ItemType Directory -Path $fullStage -Force | Out-Null
Get-ChildItem -LiteralPath $stage -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $fullStage -Recurse -Force
}
$fullContent = Join-Path $fullStage 'Content'
New-Item -ItemType Directory -Path $fullContent -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'Content\OverlayIcon.png') -Destination (Join-Path $fullContent 'OverlayIcon.png') -Force
Copy-Item -LiteralPath (Join-Path $root 'Content\README-MEDIA.txt') -Destination (Join-Path $fullContent 'README-MEDIA.txt') -Force
$fullZipName = "FreakShow-$Version-windows-x64.zip"
$fullZipPath = Join-Path $output $fullZipName
Compress-Archive -LiteralPath $fullStage -DestinationPath $fullZipPath -CompressionLevel Optimal
$fullSha256 = (Get-FileHash -LiteralPath $fullZipPath -Algorithm SHA256).Hash.ToLowerInvariant()

$packageUrl = "https://github.com/$Repository/releases/download/v$Version/$zipName"
$releaseUrl = "https://github.com/$Repository/releases/tag/v$Version"
$manifest = [ordered]@{
  version = $Version
  minimumVersion = '1.0.1'
  packageUrl = $packageUrl
  sha256 = $sha256
  releaseUrl = $releaseUrl
}
$manifestJson = $manifest | ConvertTo-Json
$manifestPath = Join-Path $output 'update-manifest.json'
$manifestJson | Set-Content -LiteralPath $manifestPath -Encoding UTF8
@(
  "$fullSha256  $fullZipName"
  "$sha256  $zipName"
) | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ASCII

Remove-Item -LiteralPath $stage -Recurse -Force
Remove-Item -LiteralPath $fullContainer -Recurse -Force

if ($WriteRepositoryManifest) {
  $manifestJson | Set-Content -LiteralPath (Join-Path $root 'update-manifest.json') -Encoding UTF8
}

Write-Host "Vollpaket:    $fullZipPath"
Write-Host "SHA-256:      $fullSha256"
Write-Host "Update-Paket: $zipPath"
Write-Host "SHA-256:      $sha256"
Write-Host "Manifest:     $manifestPath"
if ($WriteRepositoryManifest) { Write-Host 'Repository-Manifest wurde aktualisiert.' }
