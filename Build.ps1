$ErrorActionPreference = 'Stop'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$psAssembly = 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Management.Automation\v4.0_3.0.0.0__31bf3856ad364e35\System.Management.Automation.dll'
$root = $PSScriptRoot

if (-not (Test-Path -LiteralPath $csc)) { throw "C#-Compiler fehlt: $csc" }
if (-not (Test-Path -LiteralPath $psAssembly)) { throw "PowerShell-Assembly fehlt: $psAssembly" }

$hostArgs = @(
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-',
  ('/out:' + (Join-Path $root 'FreakShow.exe')),
  ('/win32icon:' + (Join-Path $root 'OverlayIcon.ico')),
  ('/resource:' + (Join-Path $root 'EmbeddedBridge.ps1') + ',EmbeddedBridge.ps1'),
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll',
  ('/reference:' + $psAssembly),
  ('/reference:' + (Join-Path $root 'Microsoft.Web.WebView2.Core.dll')),
  ('/reference:' + (Join-Path $root 'Microsoft.Web.WebView2.WinForms.dll')),
  (Join-Path $root 'VersionInfo.cs'),
  (Join-Path $root 'UpdateService.cs'),
  (Join-Path $root 'Host.cs')
)

& $csc $hostArgs
if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen (csc exit $LASTEXITCODE)." }
Copy-Item -LiteralPath (Join-Path $root 'App.config') -Destination (Join-Path $root 'FreakShow.exe.config') -Force

$updaterArgs = @(
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-',
  ('/out:' + (Join-Path $root 'FreakShowUpdater.exe')),
  ('/win32icon:' + (Join-Path $root 'OverlayIcon.ico')),
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Windows.Forms.dll',
  '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  (Join-Path $root 'UpdaterVersionInfo.cs'),
  (Join-Path $root 'Updater.cs')
)

& $csc $updaterArgs
if ($LASTEXITCODE -ne 0) { throw "Updater-Build fehlgeschlagen (csc exit $LASTEXITCODE)." }
Copy-Item -LiteralPath (Join-Path $root 'App.config') -Destination (Join-Path $root 'FreakShowUpdater.exe.config') -Force
Write-Host 'Build OK: FreakShow.exe + FreakShowUpdater.exe'
