param(
  [int]$Port = 18081,
  [string]$SettingsPath = (Join-Path $PSScriptRoot 'data\config\emote-rain-settings.json'),
  [string]$PositionPreviewPath = (Join-Path $PSScriptRoot 'data\state\overlay-position-preview.json'),
  [string]$ExternalLinksPath = (Join-Path $PSScriptRoot 'data\config\external-overlay-links.json'),
  [string]$VideoOverlaysPath = (Join-Path $PSScriptRoot 'data\config\video-overlay-settings.json'),
  [string]$VideoPausePath = (Join-Path $PSScriptRoot 'data\state\video-pause.json'),
  [string]$EmoteRainUsersPath = (Join-Path $PSScriptRoot 'data\config\emote-rain-users.json'),
  [string]$OverlayLayersPath = (Join-Path $PSScriptRoot 'data\config\overlay-layers.json'),
  [string]$ImageOverlaysPath = (Join-Path $PSScriptRoot 'data\config\image-overlays.json'),
  [string]$ExcludedAppsPath = (Join-Path $PSScriptRoot 'data\config\excluded-apps.json'),
  [string]$OverlayOutputPath = (Join-Path $PSScriptRoot 'data\state\overlay-output.json'),
  [string]$CheatsheetPath = (Join-Path $PSScriptRoot 'data\config\cheatsheet.json'),
  [string]$OverlayMonitorPath = (Join-Path $PSScriptRoot 'data\config\overlay-monitor.json'),
  [string]$PauseHotkeyPath = (Join-Path $PSScriptRoot 'data\config\pause-hotkey.json'),
  [string]$UiStatePath = (Join-Path $PSScriptRoot 'data\config\ui-state.json'),
  [string]$AllowedIpsPath = (Join-Path $PSScriptRoot 'data\config\allowed-ips.json'),
  [string]$WebSocketConfigPath = (Join-Path $PSScriptRoot 'data\config\websocket-config.json'),
  [string]$AppRoot = (Join-Path $PSScriptRoot 'app'),
  [string]$ContentRoot = (Join-Path $PSScriptRoot 'Content'),
  [int]$WsProxyPort = 18082,
  [string]$OverlayExePath = (Join-Path $PSScriptRoot 'HtmlWindowsOverlayModern.exe'),
  [string]$SettingsPagePath = (Join-Path $PSScriptRoot 'Content\websocket-diagnose.html'),
  [switch]$EmbeddedHost
)

$ErrorActionPreference = 'Stop'
# Control-Token pro Installation: beim ersten Start zufaellig erzeugt und in
# data\config\control-token.json gespeichert (gitignored), danach von dort geladen.
# Frueher stand er hier fest im Code. Die Bridge setzt ihn beim Ausliefern der
# Steuerseite ein (Platzhalter __BRIDGE_CONTROL_TOKEN__), sodass im Quellcode kein
# fester Token mehr steht. Pfad aus $AllowedIpsPath abgeleitet -> selber data\config-Ordner.
$ControlTokenPath = Join-Path (Split-Path -Parent $AllowedIpsPath) 'control-token.json'
$ControlToken = $null
try {
  if (Test-Path -LiteralPath $ControlTokenPath) {
    $tokenObj = (Get-Content -LiteralPath $ControlTokenPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
    if ($tokenObj -and ($tokenObj.token -is [string]) -and $tokenObj.token.Length -ge 16) {
      $ControlToken = [string]$tokenObj.token
    }
  }
} catch {
  $ControlToken = $null
}
if (-not $ControlToken) {
  $ControlToken = 'kappi-overlay-control-' + [guid]::NewGuid().ToString()
  try {
    $tokenDir = Split-Path -Parent $ControlTokenPath
    if ($tokenDir -and -not (Test-Path -LiteralPath $tokenDir)) {
      New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null
    }
    ([pscustomobject]@{ token = $ControlToken } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $ControlTokenPath -Encoding UTF8 -NoNewline
  } catch {
  }
}

function Get-NowMilliseconds {
  return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Clamp-Int {
  param(
    [object]$Value,
    [int]$Fallback,
    [int]$Min,
    [int]$Max
  )

  $parsed = 0
  if (-not [int]::TryParse([string]$Value, [ref]$parsed)) {
    $parsed = $Fallback
  }

  if ($parsed -lt $Min) { return $Min }
  if ($parsed -gt $Max) { return $Max }
  return $parsed
}

function New-SettingsJson {
  param(
    [object]$InputObject
  )

  $enabled = $true
  if ($null -ne $InputObject -and $null -ne $InputObject.enabled) {
    $enabled = [System.Convert]::ToBoolean($InputObject.enabled)
  }

  $sizeLevel = 6
  $speedLevel = 5
  if ($null -ne $InputObject) {
    $sizeLevel = Clamp-Int -Value $InputObject.sizeLevel -Fallback 6 -Min 1 -Max 10
    $speedLevel = Clamp-Int -Value $InputObject.speedLevel -Fallback 5 -Min 1 -Max 10
  }

  $settings = [ordered]@{
    enabled = $enabled
    sizeLevel = $sizeLevel
    speedLevel = $speedLevel
    version = 3
    updatedAt = Get-NowMilliseconds
  }

  return ($settings | ConvertTo-Json -Compress)
}

function Normalize-SettingsObject {
  param(
    [object]$InputObject,
    [object]$ExistingObject
  )

  $enabled = $true
  if ($null -ne $ExistingObject -and $null -ne $ExistingObject.enabled) {
    $enabled = [System.Convert]::ToBoolean($ExistingObject.enabled)
  }
  if ($null -ne $InputObject -and $null -ne $InputObject.enabled) {
    $enabled = [System.Convert]::ToBoolean($InputObject.enabled)
  }

  $sizeLevel = 6
  $speedLevel = 5
  if ($null -ne $ExistingObject) {
    $sizeLevel = Clamp-Int -Value $ExistingObject.sizeLevel -Fallback 6 -Min 1 -Max 10
    $speedLevel = Clamp-Int -Value $ExistingObject.speedLevel -Fallback 5 -Min 1 -Max 10
  }
  if ($null -ne $InputObject) {
    $sizeLevel = Clamp-Int -Value $InputObject.sizeLevel -Fallback $sizeLevel -Min 1 -Max 10
    $speedLevel = Clamp-Int -Value $InputObject.speedLevel -Fallback $speedLevel -Min 1 -Max 10
  }

  return [ordered]@{
    enabled = $enabled
    sizeLevel = $sizeLevel
    speedLevel = $speedLevel
    version = 3
    updatedAt = Get-NowMilliseconds
  }
}

function ConvertTo-SettingsJson {
  param([object]$InputObject)
  return ($InputObject | ConvertTo-Json -Compress)
}

function Ensure-SettingsFile {
  $dir = Split-Path -Parent $SettingsPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }

  if (-not (Test-Path -LiteralPath $SettingsPath)) {
    Set-Content -LiteralPath $SettingsPath -Value (New-SettingsJson $null) -Encoding UTF8
  }
}

function Read-SettingsJson {
  Ensure-SettingsFile
  try {
    $raw = Get-Content -LiteralPath $SettingsPath -Raw -ErrorAction Stop
    [void]($raw | ConvertFrom-Json -ErrorAction Stop)
    return $raw.Trim()
  } catch {
    $json = New-SettingsJson $null
    Set-Content -LiteralPath $SettingsPath -Value $json -Encoding UTF8
    return $json
  }
}

function Write-SettingsJson {
  param([object]$Incoming)

  Ensure-SettingsFile
  $existing = $null
  try {
    $existing = (Get-Content -LiteralPath $SettingsPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
  } catch {}

  $settings = Normalize-SettingsObject -InputObject $Incoming -ExistingObject $existing
  $json = ConvertTo-SettingsJson $settings
  $tempPath = "$SettingsPath.tmp"
  Set-Content -LiteralPath $tempPath -Value $json -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $SettingsPath -Force
  return $json
}

function New-PositionPreviewObject {
  param([object]$InputObject)

  $now = Get-NowMilliseconds
  $visible = $false
  if ($null -ne $InputObject -and $null -ne $InputObject.visible) {
    $visible = [System.Convert]::ToBoolean($InputObject.visible)
  }

  $monitorWidth = 1920
  $monitorHeight = 1080
  if ($null -ne $InputObject) {
    $monitorWidth = Clamp-Int -Value $InputObject.monitorWidth -Fallback 1920 -Min 100 -Max 10000
    $monitorHeight = Clamp-Int -Value $InputObject.monitorHeight -Fallback 1080 -Min 100 -Max 10000
  }

  $areaInput = $null
  if ($null -ne $InputObject -and $null -ne $InputObject.area) {
    $areaInput = $InputObject.area
  }

  $preset = 'custom'
  if ($null -ne $areaInput -and -not [string]::IsNullOrWhiteSpace([string]$areaInput.preset)) {
    $preset = [string]$areaInput.preset
  }

  $x = if ($preset -eq 'full') { 0 } else { Clamp-Int -Value $areaInput.x -Fallback 0 -Min 0 -Max $monitorWidth }
  $y = if ($preset -eq 'full') { 0 } else { Clamp-Int -Value $areaInput.y -Fallback 0 -Min 0 -Max $monitorHeight }
  $width = if ($preset -eq 'full') { $monitorWidth } else { Clamp-Int -Value $areaInput.width -Fallback $monitorWidth -Min 20 -Max $monitorWidth }
  $height = if ($preset -eq 'full') { $monitorHeight } else { Clamp-Int -Value $areaInput.height -Fallback $monitorHeight -Min 20 -Max $monitorHeight }

  if (($x + $width) -gt $monitorWidth) { $x = [Math]::Max(0, $monitorWidth - $width) }
  if (($y + $height) -gt $monitorHeight) { $y = [Math]::Max(0, $monitorHeight - $height) }

  $expiresAt = $now + 8000
  if ($null -ne $InputObject -and $null -ne $InputObject.expiresAt) {
    $parsedExpiresAt = [int64]0
    if ([int64]::TryParse([string]$InputObject.expiresAt, [ref]$parsedExpiresAt)) {
      $expiresAt = [Math]::Max($now, [Math]::Min($parsedExpiresAt, $now + 60000))
    }
  }

  $items = @()
  if ($null -ne $InputObject -and $null -ne $InputObject.items) {
    foreach ($item in @($InputObject.items)) {
      $normalizedItem = New-PositionPreviewObject $item
      if ($normalizedItem.visible) {
        $items += [ordered]@{
          visible = $true
          name = $normalizedItem.name
          type = $normalizedItem.type
          url = $normalizedItem.url
          monitorWidth = $normalizedItem.monitorWidth
          monitorHeight = $normalizedItem.monitorHeight
          area = $normalizedItem.area
          updatedAt = $normalizedItem.updatedAt
          expiresAt = $normalizedItem.expiresAt
        }
      }
    }
  }

  return [ordered]@{
    ok = $true
    visible = $visible -or ($items.Count -gt 0)
    name = if ($null -ne $InputObject -and $null -ne $InputObject.name) { [string]$InputObject.name } else { 'Overlay-Position' }
    type = if ($null -ne $InputObject -and $null -ne $InputObject.type) { [string]$InputObject.type } else { 'overlay' }
    url = if ($null -ne $InputObject -and $null -ne $InputObject.url) { [string]$InputObject.url } else { '' }
    monitorWidth = $monitorWidth
    monitorHeight = $monitorHeight
    area = [ordered]@{
      preset = $preset
      x = $x
      y = $y
      width = $width
      height = $height
    }
    items = $items
    updatedAt = $now
    expiresAt = $expiresAt
  }
}

function Ensure-PositionPreviewFile {
  $dir = Split-Path -Parent $PositionPreviewPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }

  if (-not (Test-Path -LiteralPath $PositionPreviewPath)) {
    $json = (New-PositionPreviewObject ([pscustomobject]@{ visible = $false })) | ConvertTo-Json -Depth 6 -Compress
    Set-Content -LiteralPath $PositionPreviewPath -Value $json -Encoding UTF8
  }
}

function Ensure-ExternalLinksFile {
  $dir = Split-Path -Parent $ExternalLinksPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  if (-not (Test-Path -LiteralPath $ExternalLinksPath)) {
    Set-Content -LiteralPath $ExternalLinksPath -Value '{"ok":true,"monitorWidth":1920,"monitorHeight":1080,"links":[],"updatedAt":0}' -Encoding UTF8
  }
}

function Read-ExternalLinksJson {
  Ensure-ExternalLinksFile
  try {
    $raw = Get-Content -LiteralPath $ExternalLinksPath -Raw -ErrorAction Stop
    [void]($raw | ConvertFrom-Json -ErrorAction Stop)
    return $raw
  } catch {
    return '{"ok":true,"monitorWidth":1920,"monitorHeight":1080,"links":[],"updatedAt":0}'
  }
}

function Write-ExternalLinksJson {
  param([object]$Incoming)

  Ensure-ExternalLinksFile
  $source = if ($null -ne $Incoming -and $null -ne $Incoming.links) { @($Incoming.links) } else { @($Incoming) }
  $links = @()
  foreach ($item in $source) {
    if ($null -eq $item -or [string]::IsNullOrWhiteSpace([string]$item.url)) { continue }
    $area = $item.area
    $enabled = if ($null -ne $item.enabled) { [bool]$item.enabled } else { $true }
    $persistent = if ($null -ne $item.persistent) { [bool]$item.persistent } else { $true }
    $links += [ordered]@{
      id = [string]$item.id
      name = [string]$item.name
      url = [string]$item.url
      profile = if ([string]::IsNullOrWhiteSpace([string]$item.profile)) { 'auto' } else { [string]$item.profile }
      persistent = $persistent
      monitorParams = [bool]$item.monitorParams
      enabled = $enabled
      area = [ordered]@{
        preset = if ([string]::IsNullOrWhiteSpace([string]$area.preset)) { 'full' } else { [string]$area.preset }
        x = Clamp-Int -Value $area.x -Fallback 0 -Min 0 -Max 20000
        y = Clamp-Int -Value $area.y -Fallback 0 -Min 0 -Max 20000
        width = Clamp-Int -Value $area.width -Fallback 1920 -Min 20 -Max 20000
        height = Clamp-Int -Value $area.height -Fallback 1080 -Min 20 -Max 20000
      }
    }
  }

  $result = [ordered]@{
    ok = $true
    monitorWidth = Clamp-Int -Value $Incoming.monitorWidth -Fallback 1920 -Min 100 -Max 20000
    monitorHeight = Clamp-Int -Value $Incoming.monitorHeight -Fallback 1080 -Min 100 -Max 20000
    links = $links
    updatedAt = Get-NowMilliseconds
  }
  $json = $result | ConvertTo-Json -Depth 7 -Compress
  Set-Content -LiteralPath $ExternalLinksPath -Value $json -Encoding UTF8
  return $json
}

function ConvertTo-SafeDouble {
  param(
    [object]$Value,
    [double]$Fallback,
    [double]$Min,
    [double]$Max
  )

  $parsed = 0.0
  $style = [System.Globalization.NumberStyles]::Float
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  if (-not [double]::TryParse(([string]$Value).Replace(',', '.'), $style, $culture, [ref]$parsed)) {
    $parsed = $Fallback
  }
  if ($parsed -lt $Min) { return $Min }
  if ($parsed -gt $Max) { return $Max }
  return $parsed
}

function Ensure-VideoOverlaysFile {
  $dir = Split-Path -Parent $VideoOverlaysPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  if (-not (Test-Path -LiteralPath $VideoOverlaysPath)) {
    Set-Content -LiteralPath $VideoOverlaysPath -Value '{"ok":true,"items":[],"updatedAt":0}' -Encoding UTF8
  }
}

function Read-SavedVideoOverlays {
  Ensure-VideoOverlaysFile
  try {
    $raw = Get-Content -LiteralPath $VideoOverlaysPath -Raw -ErrorAction Stop
    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    return @($parsed.items)
  } catch {
    return @()
  }
}

function Get-JavaScriptVideoOverlays {
  $contentRoot = $ContentRoot
  $items = @()
  foreach ($file in @(Get-ChildItem -LiteralPath $contentRoot -File -Filter '*.js' -ErrorAction SilentlyContinue)) {
    try {
      $raw = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop
      $pathMatch = [regex]::Match($raw, 'videoPath\s*:\s*[''"](?<value>[^''"]+)[''"]', 'IgnoreCase')
      if (-not $pathMatch.Success) { continue }

      $rewardMatch = [regex]::Match($raw, 'rewardTitle\s*:\s*[''"](?<value>[^''"]+)[''"]', 'IgnoreCase')
      $triggerMatch = [regex]::Match($raw, 'wsdata\.data\.(?<value>[A-Za-z0-9_$]+)\s*===\s*true', 'IgnoreCase')
      $volumeMatch = [regex]::Match($raw, 'volume\s*:\s*(?<value>[0-9]+(?:[\.,][0-9]+)?)', 'IgnoreCase')
      $videoPath = $pathMatch.Groups['value'].Value
      $trigger = if ($triggerMatch.Success) { $triggerMatch.Groups['value'].Value } elseif ($rewardMatch.Success) { $rewardMatch.Groups['value'].Value } else { $file.BaseName }
      $name = if ($rewardMatch.Success) { $rewardMatch.Groups['value'].Value } else { $file.BaseName }
      $sourceVolume = if ($volumeMatch.Success) { ConvertTo-SafeDouble -Value $volumeMatch.Groups['value'].Value -Fallback 1 -Min 0 -Max 1 } else { 1 }

      $items += [ordered]@{
        id = 'script:' + $file.Name.ToLowerInvariant()
        name = $name
        trigger = $trigger
        videoPath = $videoPath
        startSeconds = 0
        durationSeconds = 0
        volume = [int][Math]::Round($sourceVolume * 100)
        removeBackground = $false
        keyColor = '#00ff00'
        tolerance = 20
        enabled = $true
        managed = $false
        sourceFile = $file.Name
      }
    } catch {}
  }
  return $items
}

function Normalize-VideoOverlayItem {
  param([object]$Item)
  if ($null -eq $Item -or [string]::IsNullOrWhiteSpace([string]$Item.videoPath)) { return $null }

  $enabled = if ($null -ne $Item.enabled) { [System.Convert]::ToBoolean($Item.enabled) } else { $true }
  $removeBackground = if ($null -ne $Item.removeBackground) { [System.Convert]::ToBoolean($Item.removeBackground) } else { $false }
  $managed = if ($null -ne $Item.managed) { [System.Convert]::ToBoolean($Item.managed) } else { [string]::IsNullOrWhiteSpace([string]$Item.sourceFile) }
  $id = [string]$Item.id
  if ([string]::IsNullOrWhiteSpace($id)) { $id = 'video-' + [Guid]::NewGuid().ToString('N') }
  $name = [string]$Item.name
  if ([string]::IsNullOrWhiteSpace($name)) { $name = [System.IO.Path]::GetFileNameWithoutExtension([string]$Item.videoPath) }
  $trigger = [string]$Item.trigger
  if ([string]::IsNullOrWhiteSpace($trigger)) { $trigger = $name }
  $triggerType = if ($null -ne $Item.triggerType -and ([string]$Item.triggerType).Trim().ToLowerInvariant() -eq 'reward') { 'reward' } else { 'custom' }
  $keyColor = [string]$Item.keyColor
  if ($keyColor -notmatch '^#[0-9a-fA-F]{6}$') { $keyColor = '#00ff00' }
  $sideBars = if ($null -ne $Item.sideBars) { [System.Convert]::ToBoolean($Item.sideBars) } else { $true }
  $align = if ($null -ne $Item.align) { ([string]$Item.align).Trim().ToLowerInvariant() } else { 'center' }
  if (@('center','left','right','top','bottom') -notcontains $align) { $align = 'center' }
  $group = if ($null -ne $Item.group) { ([string]$Item.group).Trim() } else { '' }
  $groupTrigger = if ($null -ne $Item.groupTrigger) { ([string]$Item.groupTrigger).Trim() } else { '' }
  $markColor = if ($null -ne $Item.markColor) { ([string]$Item.markColor).Trim().ToLowerInvariant() } else { '' }
  if ($markColor -notmatch '^#[0-9a-f]{6}$') { $markColor = '' }

  return [ordered]@{
    id = $id
    name = $name
    trigger = $trigger
    triggerType = $triggerType
    videoPath = [string]$Item.videoPath
    startSeconds = ConvertTo-SafeDouble -Value $Item.startSeconds -Fallback 0 -Min 0 -Max 86400
    durationSeconds = ConvertTo-SafeDouble -Value $Item.durationSeconds -Fallback 0 -Min 0 -Max 86400
    volume = Clamp-Int -Value $Item.volume -Fallback 100 -Min 0 -Max 100
    removeBackground = $removeBackground
    keyColor = $keyColor.ToLowerInvariant()
    tolerance = Clamp-Int -Value $Item.tolerance -Fallback 20 -Min 0 -Max 100
    sideBars = $sideBars
    align = $align
    group = $group
    groupTrigger = $groupTrigger
    markColor = $markColor
    enabled = $enabled
    managed = $managed
    sourceFile = [string]$Item.sourceFile
  }
}

function Read-VideoPaused {
  try {
    if (Test-Path -LiteralPath $VideoPausePath) {
      $obj = (Get-Content -LiteralPath $VideoPausePath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      return [bool]$obj.paused
    }
  } catch {}
  return $false
}

function Write-VideoPaused {
  param([bool]$Paused)
  try {
    Set-Content -LiteralPath $VideoPausePath -Value (([ordered]@{ paused = $Paused } | ConvertTo-Json -Compress)) -Encoding UTF8
  } catch {}
  return ([ordered]@{ ok = $true; paused = $Paused } | ConvertTo-Json -Compress)
}

# --- Overlay-Ebenen-Priorität (Reihenfolge oben -> unten) ---
$OverlayLayerKeys = @('endgame', 'images', 'overlays', 'emote', 'video')
$OverlayLayerDefault = @('endgame', 'images', 'overlays', 'emote', 'video')  # oben -> unten (Endgame-Speckzettel standardmaessig oben)

# --- Instanz-Waechter: es darf immer nur EINE Overlay-Instanz Ton ausgeben. ---
# Jede geladene index.html registriert sich hier mit einer eindeutigen ID.
# Aeltere Instanzen sehen beim Abfragen, dass sie nicht mehr aktuell sind, und
# schalten sich selbst stumm (egal wo sie laufen: doppelte EXE, Browser, etc.).
$script:OverlayInstanceId = ''

function Normalize-OverlayLayerOrder {
  param([object]$Order)
  $list = [System.Collections.ArrayList]::new()
  if ($null -ne $Order) {
    foreach ($k in $Order) {
      $ks = ([string]$k).Trim().ToLowerInvariant()
      if (($OverlayLayerKeys -contains $ks) -and (-not $list.Contains($ks))) { [void]$list.Add($ks) }
    }
  }
  # Fehlende Ebenen an ihrer STANDARD-Position (OverlayLayerKeys-Reihenfolge) einfuegen,
  # nicht hinten anhaengen -> neu ergaenztes Endgame landet oben, nicht unter den Videos.
  for ($j = 0; $j -lt $OverlayLayerKeys.Count; $j++) {
    $key = $OverlayLayerKeys[$j]
    if ($list.Contains($key)) { continue }
    $insertAt = $list.Count
    for ($d = $j + 1; $d -lt $OverlayLayerKeys.Count; $d++) {
      $idx = $list.IndexOf($OverlayLayerKeys[$d])
      if ($idx -ge 0) { $insertAt = $idx; break }
    }
    [void]$list.Insert($insertAt, $key)
  }
  return @($list)
}

function Read-OverlayLayersJson {
  $order = $OverlayLayerDefault
  try {
    if (Test-Path -LiteralPath $OverlayLayersPath) {
      $obj = (Get-Content -LiteralPath $OverlayLayersPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $obj -and $null -ne $obj.order) { $order = Normalize-OverlayLayerOrder $obj.order }
    }
  } catch {}
  $parts = @(); foreach ($k in $order) { $parts += ('"' + $k + '"') }
  return ('{"ok":true,"order":[' + ($parts -join ',') + ']}')
}

function Write-OverlayLayersJson {
  param([object]$Incoming)
  $order = if ($null -ne $Incoming -and $null -ne $Incoming.order) { Normalize-OverlayLayerOrder $Incoming.order } else { $OverlayLayerDefault }
  $parts = @(); foreach ($k in $order) { $parts += ('"' + $k + '"') }
  $json = '{"order":[' + ($parts -join ',') + ']}'
  try { Set-Content -LiteralPath $OverlayLayersPath -Value $json -Encoding UTF8 } catch {}
  return ('{"ok":true,"order":[' + ($parts -join ',') + ']}')
}

# --- Gemeinsamer JSON-Helfer (von Bild-/Hintergrund-/Layer-Funktionen genutzt) ---
function Escape-JsonString {
  param([string]$s)
  if ($null -eq $s) { return '' }
  return (($s -replace '\\', '\\') -replace '"', '\"' -replace "`r", '' -replace "`n", ' ')
}

# Wie Escape-JsonString, aber Zeilenumbrueche/Tabs bleiben als \n / \t erhalten
# (fuer mehrzeilige Felder wie den Speckzettel-Text).
function Escape-JsonMultiline {
  param([string]$s)
  if ($null -eq $s) { return '' }
  $s = $s -replace '\\', '\\'
  $s = $s -replace '"', '\"'
  $s = $s -replace "`r`n", '\n'
  $s = $s -replace "`r", '\n'
  $s = $s -replace "`n", '\n'
  $s = $s -replace "`t", '\t'
  return $s
}

# --- Bild-/GIF-Overlays (positionierte Bilder auf dem Monitor) ---
function Build-ImageOverlayJson {
  param([object]$Item)
  if ($null -eq $Item) { return $null }
  $path = [string]$Item.path
  if ([string]::IsNullOrWhiteSpace($path)) { return $null }
  $id = [string]$Item.id; if ([string]::IsNullOrWhiteSpace($id)) { $id = 'img-' + [Guid]::NewGuid().ToString('N') }
  $name = [string]$Item.name; if ([string]::IsNullOrWhiteSpace($name)) { $name = [System.IO.Path]::GetFileNameWithoutExtension($path) }
  # Position/Größe in Prozent des Bildschirms (0-100) -> auflösungsunabhängig
  $x = [math]::Round((ConvertTo-SafeDouble -Value $Item.x -Fallback 35 -Min 0 -Max 100), 2)
  $y = [math]::Round((ConvertTo-SafeDouble -Value $Item.y -Fallback 35 -Min 0 -Max 100), 2)
  $w = [math]::Round((ConvertTo-SafeDouble -Value $Item.width -Fallback 30 -Min 1 -Max 100), 2)
  $h = [math]::Round((ConvertTo-SafeDouble -Value $Item.height -Fallback 30 -Min 1 -Max 100), 2)
  $enabled = if ($null -ne $Item.enabled) { if ([bool]$Item.enabled) { 'true' } else { 'false' } } else { 'true' }
  # WICHTIG: Farbe/Transparenz/Trigger MUESSEN durchgereicht werden, sonst erreichen sie
  # das Overlay nie (frueher gestrippt -> "eigene Farben funktionieren nicht").
  $opacity   = [math]::Round((ConvertTo-SafeDouble -Value $Item.opacity -Fallback 100 -Min 0 -Max 100), 0)
  $colorOn   = if ($null -ne $Item.colorOn -and [bool]$Item.colorOn) { 'true' } else { 'false' }
  $color     = if ($null -ne $Item.color) { [string]$Item.color } else { '' }
  $triggerOn = if ($null -ne $Item.triggerOn -and [bool]$Item.triggerOn) { 'true' } else { 'false' }
  $trigger   = if ($null -ne $Item.trigger) { [string]$Item.trigger } else { '' }
  return ('{"id":"' + (Escape-JsonString $id) + '","name":"' + (Escape-JsonString $name) + '","path":"' + (Escape-JsonString $path) + '","x":' + $x + ',"y":' + $y + ',"width":' + $w + ',"height":' + $h + ',"enabled":' + $enabled + ',"opacity":' + $opacity + ',"colorOn":' + $colorOn + ',"color":"' + (Escape-JsonString $color) + '","triggerOn":' + $triggerOn + ',"trigger":"' + (Escape-JsonString $trigger) + '"}')
}

function Read-ImageOverlaysJson {
  $parts = @()
  try {
    if (Test-Path -LiteralPath $ImageOverlaysPath) {
      $obj = (Get-Content -LiteralPath $ImageOverlaysPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      $list = @()
      if ($null -ne $obj) { if ($null -ne $obj.images) { $list = @($obj.images) } elseif ($obj -is [array]) { $list = @($obj) } }
      foreach ($it in $list) { $o = Build-ImageOverlayJson $it; if ($o) { $parts += $o } }
    }
  } catch {}
  return ('{"ok":true,"images":[' + ($parts -join ',') + ']}')
}

# Listet Hintergrundbilder aus Content/backgrounds/<Gruppe>/ (bzw. backgrounds/ ohne Gruppe).
# Pro-Gruppe-Galerie: nur der Ordner der aktuell gewaehlten Gruppe wird gezeigt.
function Read-BackgroundsJson {
  param([string]$Group)
  $parts = @()
  try {
    $contentRoot = [System.IO.Path]::GetFullPath(($ContentRoot))
    $bgDir = Join-Path $contentRoot 'backgrounds'
    $grp = Get-SafeGroupFolderName $Group
    $relPrefix = 'backgrounds/'
    if ($grp) { $bgDir = Join-Path $bgDir $grp; $relPrefix = 'backgrounds/' + $grp + '/' }
    if (-not (Test-Path -LiteralPath $bgDir)) { New-Item -ItemType Directory -Path $bgDir -Force | Out-Null }
    $exts = @('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.apng', '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg')
    foreach ($f in @(Get-ChildItem -LiteralPath $bgDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
      if ($exts -notcontains $f.Extension.ToLowerInvariant()) { continue }
      $name = Escape-JsonString ([System.IO.Path]::GetFileNameWithoutExtension($f.Name))
      $rel = Escape-JsonString ($relPrefix + $f.Name)
      $parts += ('{"name":"' + $name + '","path":"' + $rel + '"}')
    }
  } catch {}
  return ('{"ok":true,"images":[' + ($parts -join ',') + ']}')
}

# --- App-Ausnahmen: Overlay abschalten, solange eine dieser Apps im VORDERGRUND ist ---
try {
  Add-Type -Namespace KappiFg -Name Win -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int lpdwProcessId);
'@ -ErrorAction Stop
} catch {}

# --- Lokaler WebSocket-Relay-Proxy ---
# HTTPS-Overlays (z. B. ChatRD von github.io) duerfen aus Browser-Sicht KEINE
# unverschluesselte ws://-Verbindung zu einer LAN-IP aufbauen (Mixed Content),
# nur zu 127.0.0.1. Da Streamer.bot auf einem ANDEREN PC laufen kann, leitet
# dieser Proxy 127.0.0.1:<Port> transparent (rohes TCP, kein Frame-Parsing noetig)
# zum echten Streamer.bot weiter. Das Ziel wird PRO Verbindung frisch aus
# websocket-config.json gelesen, folgt also der Einstellung ohne Neustart.
try {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading;
namespace KappiProxy {
  public class TcpRelay {
    private readonly int _listenPort;
    private readonly string _configPath;
    private readonly string _fallbackHost;
    private readonly int _fallbackPort;
    private TcpListener _listener;
    private volatile bool _running;

    public TcpRelay(int listenPort, string configPath, string fallbackHost, int fallbackPort) {
      _listenPort = listenPort;
      _configPath = configPath;
      _fallbackHost = fallbackHost;
      _fallbackPort = fallbackPort;
    }

    public void Start() {
      _listener = new TcpListener(IPAddress.Loopback, _listenPort);
      _listener.Start();
      _running = true;
      Thread t = new Thread(AcceptLoop);
      t.IsBackground = true;
      t.Name = "KappiWsRelayAccept";
      t.Start();
    }

    private void AcceptLoop() {
      while (_running) {
        TcpClient client = null;
        try { client = _listener.AcceptTcpClient(); }
        catch { if (!_running) break; else continue; }
        TcpClient c = client;
        Thread ht = new Thread(delegate() { Handle(c); });
        ht.IsBackground = true;
        ht.Start();
      }
    }

    private void ReadTarget(out string host, out int port) {
      host = _fallbackHost;
      port = _fallbackPort;
      try {
        string raw = File.ReadAllText(_configPath);
        Match mh = Regex.Match(raw, "\"host\"\\s*:\\s*\"([^\"]+)\"");
        Match mp = Regex.Match(raw, "\"port\"\\s*:\\s*(\\d+)");
        if (mh.Success && mh.Groups[1].Value.Length > 0) host = mh.Groups[1].Value;
        int p;
        if (mp.Success && int.TryParse(mp.Groups[1].Value, out p) && p > 0 && p <= 65535) port = p;
      } catch { }
    }

    private void Handle(TcpClient client) {
      TcpClient server = null;
      try {
        string host; int port;
        ReadTarget(out host, out port);
        client.NoDelay = true;
        server = new TcpClient();
        server.NoDelay = true;
        server.Connect(host, port);
        NetworkStream cs = client.GetStream();
        NetworkStream ss = server.GetStream();
        Thread up = new Thread(delegate() { Pump(cs, ss); });
        up.IsBackground = true;
        up.Start();
        Pump(ss, cs);
        try { up.Join(1000); } catch { }
      } catch { }
      finally {
        try { if (server != null) server.Close(); } catch { }
        try { client.Close(); } catch { }
      }
    }

    private void Pump(NetworkStream from, NetworkStream to) {
      byte[] buf = new byte[16384];
      try {
        int n;
        while ((n = from.Read(buf, 0, buf.Length)) > 0) {
          to.Write(buf, 0, n);
          to.Flush();
        }
      } catch { }
      try { to.Close(); } catch { }
      try { from.Close(); } catch { }
    }
  }
}
'@ -ErrorAction Stop
} catch {}

function Start-WsRelayProxy {
  try {
    $relay = New-Object KappiProxy.TcpRelay -ArgumentList $WsProxyPort, $WebSocketConfigPath, '127.0.0.1', 8081
    $relay.Start()
    $script:WsRelay = $relay
    Write-Host "WS-Relay-Proxy laeuft auf 127.0.0.1:$WsProxyPort -> Streamer.bot (Ziel aus websocket-config.json)"
  } catch {
    Write-Host "WS-Relay-Proxy konnte nicht starten: $($_.Exception.Message)"
  }
}

function Get-ForegroundProcessName {
  try {
    $h = [KappiFg.Win]::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero) { return '' }
    $procId = 0
    [KappiFg.Win]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
    if ($procId -le 0) { return '' }
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) { return ($p.ProcessName.ToLowerInvariant() + '.exe') }
  } catch {}
  return ''
}

function Read-ExcludedApps {
  try {
    if (Test-Path -LiteralPath $ExcludedAppsPath) {
      $o = (Get-Content -LiteralPath $ExcludedAppsPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $o -and $null -ne $o.apps) {
        return @(@($o.apps) | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Where-Object { $_ })
      }
    }
  } catch {}
  return @()
}

# Overlay-Ausgabe an/aus. AUS blendet das Overlay nur AUS (Suspend), die EXE + ihr Port
# bleiben – anders als früher, wo Stop die EXE killte und der Watchdog die Bridge mitriss.
function Read-OverlayOutputEnabled {
  try {
    if (Test-Path -LiteralPath $OverlayOutputPath) {
      $o = (Get-Content -LiteralPath $OverlayOutputPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $o -and $null -ne $o.enabled) { return [bool]$o.enabled }
    }
  } catch {}
  return $true  # Standard: Ausgabe an
}
function Write-OverlayOutputEnabled([bool]$Enabled) {
  try {
    $dir = Split-Path -Parent $OverlayOutputPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Set-Content -LiteralPath $OverlayOutputPath -Value ('{"enabled":' + $(if ($Enabled) { 'true' } else { 'false' }) + '}') -Encoding UTF8
  } catch {}
}

# --- Globaler Pause-Hotkey: Konfig fuer die EXE ablegen (vk = Windows-Tastencode + Modifier) ---
function Read-PauseHotkeyJson {
  try {
    if (Test-Path -LiteralPath $PauseHotkeyPath) {
      $raw = Get-Content -LiteralPath $PauseHotkeyPath -Raw -ErrorAction Stop
      if (-not [string]::IsNullOrWhiteSpace($raw)) { return $raw }
    }
  } catch {}
  return '{"vk":0,"ctrl":false,"alt":false,"shift":false,"display":""}'
}
function Write-PauseHotkeyJson {
  param([object]$Incoming)
  $vk = 0; $ctrl = $false; $alt = $false; $shift = $false; $display = ''
  if ($null -ne $Incoming) {
    if ($null -ne $Incoming.vk) { try { $vk = [int]$Incoming.vk } catch { $vk = 0 } }
    if ($null -ne $Incoming.ctrl) { $ctrl = [bool]$Incoming.ctrl }
    if ($null -ne $Incoming.alt) { $alt = [bool]$Incoming.alt }
    if ($null -ne $Incoming.shift) { $shift = [bool]$Incoming.shift }
    if ($null -ne $Incoming.display) { $display = [string]$Incoming.display }
  }
  if ($vk -lt 0 -or $vk -gt 255) { $vk = 0 }
  $json = '{"vk":' + $vk + ',"ctrl":' + $(if ($ctrl) { 'true' } else { 'false' }) + ',"alt":' + $(if ($alt) { 'true' } else { 'false' }) + ',"shift":' + $(if ($shift) { 'true' } else { 'false' }) + ',"display":"' + (Escape-JsonString $display) + '"}'
  try {
    $dir = Split-Path -Parent $PauseHotkeyPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Set-Content -LiteralPath $PauseHotkeyPath -Value $json -Encoding UTF8
  } catch {}
  return ('{"ok":true,"saved":' + $json + '}')
}

# --- Serverseitiger UI-Zustand: ERSETZT den bisherigen localStorage der Einstellungsseite ---
# Ein einziges JSON-Objekt {schluessel:wert(string)}. Dadurch sind alle Einstellungen
# browserunabhaengig (jeder Browser + das Overlay lesen denselben Stand von der Platte).
function Read-UiStateJson {
  try {
    if (Test-Path -LiteralPath $UiStatePath) {
      $raw = Get-Content -LiteralPath $UiStatePath -Raw -ErrorAction Stop
      if (-not [string]::IsNullOrWhiteSpace($raw)) { return $raw }
    }
  } catch {}
  return '{}'
}
function Write-UiStateJson {
  param([string]$Body)
  # $Body ist bereits als JSON validiert (der Aufrufer hat ConvertFrom-Json geprueft).
  if ([string]::IsNullOrWhiteSpace($Body)) { $Body = '{}' }
  try {
    $dir = Split-Path -Parent $UiStatePath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Set-Content -LiteralPath $UiStatePath -Value $Body -Encoding UTF8
  } catch { return '{"ok":false,"error":"write failed"}' }
  return '{"ok":true}'
}
# Delta-Merge: {"set":{k:v,...},"del":[k,...]} in die bestehende Datei EINFUEGEN, statt sie zu
# ersetzen. So ueberschreibt ein alter Tab nur SEINE geaenderten Schluessel, nicht die der anderen
# (Grundlage der Live-Sync zwischen mehreren Tabs/PCs). Die Bridge arbeitet sequentiell -> rennfrei.
function Merge-UiStateJson {
  param([string]$Body)
  $cur = @{}
  try {
    if (Test-Path -LiteralPath $UiStatePath) {
      $raw = Get-Content -LiteralPath $UiStatePath -Raw -ErrorAction Stop
      if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $obj = $raw | ConvertFrom-Json -ErrorAction Stop
        if ($obj) { foreach ($p in $obj.PSObject.Properties) { $cur[$p.Name] = [string]$p.Value } }
      }
    }
  } catch {}
  try {
    $delta = if ([string]::IsNullOrWhiteSpace($Body)) { $null } else { $Body | ConvertFrom-Json -ErrorAction Stop }
  } catch { return '{"ok":false,"error":"bad json"}' }
  if ($null -ne $delta) {
    if ($null -ne $delta.set) { foreach ($p in $delta.set.PSObject.Properties) { $cur[$p.Name] = [string]$p.Value } }
    if ($null -ne $delta.del) { foreach ($k in @($delta.del)) { $kk = [string]$k; if ($cur.ContainsKey($kk)) { $cur.Remove($kk) } } }
  }
  $parts = @()
  foreach ($k in $cur.Keys) { $parts += ('"' + (Escape-JsonString ([string]$k)) + '":"' + (Escape-JsonString ([string]$cur[$k])) + '"') }
  $json = '{' + ($parts -join ',') + '}'
  try {
    $dir = Split-Path -Parent $UiStatePath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Set-Content -LiteralPath $UiStatePath -Value $json -Encoding UTF8
  } catch { return '{"ok":false,"error":"write failed"}' }
  return '{"ok":true}'
}

function Build-ExcludedAppsJson {
  $apps = Read-ExcludedApps
  $fg = Get-ForegroundProcessName
  $suspend = $false
  foreach ($a in $apps) { if ($a -eq $fg) { $suspend = $true; break } }
  if (-not (Read-OverlayOutputEnabled)) { $suspend = $true }  # Overlay-Ausgabe aus -> Overlay ausblenden
  $parts = @(); foreach ($a in $apps) { $parts += ('"' + (Escape-JsonString $a) + '"') }
  return ('{"ok":true,"apps":[' + ($parts -join ',') + '],"foreground":"' + (Escape-JsonString $fg) + '","suspend":' + $(if ($suspend) { 'true' } else { 'false' }) + '}')
}

function Write-ExcludedApps {
  param([object]$Incoming)
  $clean = @()
  if ($null -ne $Incoming -and $null -ne $Incoming.apps) {
    foreach ($a in @($Incoming.apps)) {
      $n = ([string]$a).Trim().ToLowerInvariant()
      $n = ($n -replace '[^a-z0-9_.\- ]', '')
      if ($n -and ($n -notmatch '\.exe$')) { $n = $n + '.exe' }
      if ($n -and ($clean -notcontains $n)) { $clean += $n }
    }
  }
  $partsFile = @(); foreach ($a in $clean) { $partsFile += ('"' + (Escape-JsonString $a) + '"') }
  $json = '{"apps":[' + ($partsFile -join ',') + ']}'
  try { Set-Content -LiteralPath $ExcludedAppsPath -Value $json -Encoding UTF8 } catch {}
  return (Build-ExcludedAppsJson)
}

# ---- Endgame-Speckzettel (Cheat-Sheet): Text-Overlay auf dem Monitor ----
function Build-CheatItemJson {
  param([object]$o)
  # Baut EINEN Text als sicheres JSON-Objekt (fuer die Liste). Fehlende Felder -> Standard.
  $id        = ''
  $enabled   = $false
  $text      = ''
  $mode      = 'color'
  $frameColor= '#101826'
  $bgImage   = ''
  $bgOpacity = 85
  $textColor = '#e8f0ff'
  $textOpacity = 100
  $font      = 'Segoe UI, sans-serif'
  $fontSize  = 18
  # Position/Breite in PROZENT des Monitors (frei positionierbar per Ziehen).
  $x         = 66
  $y         = 6
  $width     = 24
  $updatedAt = (Get-NowMilliseconds)
  $trigger   = ''
  $triggerOn = $false
  if ($null -ne $o) {
    if ($null -ne $o.id)          { $id = [string]$o.id }
    if ($null -ne $o.enabled)     { $enabled = [bool]$o.enabled }
    if ($null -ne $o.text)        { $text = [string]$o.text }
    if ($null -ne $o.mode)        { $m = ([string]$o.mode).ToLowerInvariant(); if ($m -eq 'image') { $mode = 'image' } else { $mode = 'color' } }
    if ($null -ne $o.frameColor)  { $frameColor = [string]$o.frameColor }
    if ($null -ne $o.bgImage)     { $bgImage = [string]$o.bgImage }
    if ($null -ne $o.bgOpacity)   { try { $bgOpacity = [int][double]$o.bgOpacity } catch {} }
    if ($null -ne $o.textColor)   { $textColor = [string]$o.textColor }
    if ($null -ne $o.textOpacity) { try { $textOpacity = [int][double]$o.textOpacity } catch {} }
    if ($null -ne $o.font)        { $font = [string]$o.font }
    if ($null -ne $o.fontSize)    { try { $fontSize = [int][double]$o.fontSize } catch {} }
    if ($null -ne $o.x)           { try { $x = [double]$o.x } catch {} }
    if ($null -ne $o.y)           { try { $y = [double]$o.y } catch {} }
    if ($null -ne $o.width)       { try { $width = [double]$o.width } catch {} }
    if ($null -ne $o.updatedAt)   { try { $updatedAt = [long][double]$o.updatedAt } catch {} }
    if ($null -ne $o.trigger)     { $trigger = [string]$o.trigger }
    if ($null -ne $o.triggerOn)   { $triggerOn = [bool]$o.triggerOn }
  }
  if ($bgOpacity -lt 0) { $bgOpacity = 0 }; if ($bgOpacity -gt 100) { $bgOpacity = 100 }
  if ($textOpacity -lt 0) { $textOpacity = 0 }; if ($textOpacity -gt 100) { $textOpacity = 100 }
  if ($fontSize -lt 8) { $fontSize = 8 }; if ($fontSize -gt 96) { $fontSize = 96 }
  if ($x -lt 0) { $x = 0 }; if ($x -gt 100) { $x = 100 }
  if ($y -lt 0) { $y = 0 }; if ($y -gt 100) { $y = 100 }
  if ($width -lt 5) { $width = 5 }; if ($width -gt 90) { $width = 90 }
  $x = [math]::Round($x, 2); $y = [math]::Round($y, 2); $width = [math]::Round($width, 2)
  if ([string]::IsNullOrWhiteSpace($id)) { $id = 'legacy' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('{"id":"' + (Escape-JsonString $id) + '"')
  [void]$sb.Append(',"enabled":' + $(if ($enabled) { 'true' } else { 'false' }))
  [void]$sb.Append(',"text":"' + (Escape-JsonMultiline $text) + '"')
  [void]$sb.Append(',"mode":"' + (Escape-JsonString $mode) + '"')
  [void]$sb.Append(',"frameColor":"' + (Escape-JsonString $frameColor) + '"')
  [void]$sb.Append(',"bgImage":"' + (Escape-JsonString $bgImage) + '"')
  [void]$sb.Append(',"bgOpacity":' + $bgOpacity)
  [void]$sb.Append(',"textColor":"' + (Escape-JsonString $textColor) + '"')
  [void]$sb.Append(',"textOpacity":' + $textOpacity)
  [void]$sb.Append(',"font":"' + (Escape-JsonString $font) + '"')
  [void]$sb.Append(',"fontSize":' + $fontSize)
  [void]$sb.Append(',"x":' + $x)
  [void]$sb.Append(',"y":' + $y)
  [void]$sb.Append(',"width":' + $width)
  [void]$sb.Append(',"trigger":"' + (Escape-JsonString $trigger) + '"')
  [void]$sb.Append(',"triggerOn":' + $(if ($triggerOn) { 'true' } else { 'false' }))
  [void]$sb.Append(',"updatedAt":' + $updatedAt)
  [void]$sb.Append('}')
  return $sb.ToString()
}

# Baut die LISTE aller Texte: { ok, items:[...] }. Nimmt { items:[...] } (neu) ODER ein
# Einzelobjekt (alte Form) -> dann 1-Element-Liste (Abwaertskompatibilitaet).
function Build-CheatsheetJson {
  param([object]$Incoming)
  $parts = @()
  if ($null -ne $Incoming -and $null -ne $Incoming.items) {
    $itemIndex = 0
    foreach ($it in @($Incoming.items)) {
      if ($null -eq $it) { continue }
      $itemIndex++
      if ([string]::IsNullOrWhiteSpace([string]$it.id)) { $it | Add-Member -NotePropertyName id -NotePropertyValue ('legacy-' + $itemIndex) -Force }
      $parts += (Build-CheatItemJson $it)
    }
  } elseif ($null -ne $Incoming -and ($null -ne $Incoming.text -or $null -ne $Incoming.enabled -or $null -ne $Incoming.trigger)) {
    if ([string]::IsNullOrWhiteSpace([string]$Incoming.id)) { $Incoming | Add-Member -NotePropertyName id -NotePropertyValue 'legacy' -Force }
    $parts += (Build-CheatItemJson $Incoming)
  }
  return ('{"ok":true,"items":[' + ($parts -join ',') + ']}')
}

function Read-CheatsheetJson {
  try {
    if (Test-Path -LiteralPath $CheatsheetPath) {
      $o = (Get-Content -LiteralPath $CheatsheetPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      return (Build-CheatsheetJson $o)
    }
  } catch {}
  return (Build-CheatsheetJson $null)
}

function Write-CheatsheetJson {
  param([object]$Incoming)
  $json = Build-CheatsheetJson $Incoming
  try { Set-Content -LiteralPath $CheatsheetPath -Value $json -Encoding UTF8 } catch {}
  return $json
}

function Get-RunningProcessesJson {
  $parts = @()
  try {
    $procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.ProcessName } |
      Select-Object -ExpandProperty ProcessName -Unique | Sort-Object
    foreach ($p in $procs) { $parts += ('"' + (Escape-JsonString (([string]$p).ToLowerInvariant())) + '.exe"') }
  } catch {}
  return ('{"ok":true,"processes":[' + ($parts -join ',') + ']}')
}

# ---- Autostart mit Windows: ein Registry-Run-Eintrag (nur fuer den aktuellen
# Benutzer, HKCU) startet Start-Overlay.bat beim Anmelden. An/Aus per Panel-Schalter. ----
$AutostartRunKey    = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$AutostartValueName = 'FreakShowOverlay'
function Test-AutostartEnabled {
  try {
    $v = Get-ItemProperty -LiteralPath $AutostartRunKey -Name $AutostartValueName -ErrorAction Stop
    return ($null -ne $v.$AutostartValueName)
  } catch { return $false }
}
function Set-AutostartState {
  param([bool]$Enabled)
  try {
    if ($Enabled) {
      if (-not (Test-Path -LiteralPath $AutostartRunKey)) { New-Item -Path $AutostartRunKey -Force | Out-Null }
      # Im neuen Host zeigt der Run-Eintrag direkt auf dieselbe EXE. Die Bridge
      # laeuft dort als eingebettete Runspace und benoetigt keinen Script-Starter.
      if ($EmbeddedHost) {
        $contentRoot = $ContentRoot
        $cmd = '"' + $OverlayExePath + '" --content-root "' + $contentRoot + '"'
      } else {
        $cmd = 'wscript.exe "' + (Join-Path $PSScriptRoot 'Start-Overlay.vbs') + '"'
      }
      Set-ItemProperty -LiteralPath $AutostartRunKey -Name $AutostartValueName -Value $cmd -Force
    } else {
      Remove-ItemProperty -LiteralPath $AutostartRunKey -Name $AutostartValueName -ErrorAction SilentlyContinue
    }
    return $true
  } catch { return $false }
}
function Build-AutostartJson {
  $on = if (Test-AutostartEnabled) { 'true' } else { 'false' }
  return ('{"ok":true,"enabled":' + $on + '}')
}

# Beim Herunterfahren uebrig gebliebene Overlay-/WebView2-Prozesse beenden (kein Waisenkind).
function Stop-KappiOverlayProcesses {
  # Der eingebettete Host verwaltet seinen Lebenszyklus selbst. In diesem Modus
  # niemals fremde WebView2- oder alte Overlay-Prozesse pauschal beenden.
  if ($EmbeddedHost) { return }
  try { Get-Process -Name 'HtmlWindowsOverlayModern','HtmlWindowsOverlay' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
  # WebView2-Reste NUR dieses Overlays (am eigenen User-Data-Ordner erkannt) - keine fremden Apps.
  try {
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*WebView2UserData*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Write-ImageOverlaysJson {
  param([object]$Incoming)
  $parts = @()
  if ($null -ne $Incoming -and $null -ne $Incoming.images) {
    foreach ($it in @($Incoming.images)) { $o = Build-ImageOverlayJson $it; if ($o) { $parts += $o } }
  }
  $json = '{"images":[' + ($parts -join ',') + ']}'
  try { Set-Content -LiteralPath $ImageOverlaysPath -Value $json -Encoding UTF8 } catch {}
  return ('{"ok":true,"images":[' + ($parts -join ',') + ']}')
}

# ---- Monitor-Auswahl: welcher physische Bildschirm nutzt das Overlay-Fenster ----
# Get-MonitorsJson listet die Monitore (Index/Position/Größe/Primär); die gewählte
# Nummer landet in overlay-monitor.json. Der Helfer OverlayMonitor.ps1 liest die Datei
# und schiebt das Overlay-Fenster auf diesen Monitor. JSON wird per String gebaut
# (kein ConvertTo-Json), damit ein Ein-Monitor-Array nicht zu einem Objekt kollabiert.
function Get-MonitorsJson {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue | Out-Null
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $parts = @()
    for ($i = 0; $i -lt $screens.Count; $i++) {
      $s = $screens[$i]; $b = $s.Bounds
      $prim = if ($s.Primary) { 'true' } else { 'false' }
      $parts += ('{"index":' + $i + ',"primary":' + $prim + ',"x":' + [int]$b.X + ',"y":' + [int]$b.Y + ',"width":' + [int]$b.Width + ',"height":' + [int]$b.Height + '}')
    }
    return ('{"ok":true,"monitors":[' + ($parts -join ',') + ']}')
  } catch {
    return '{"ok":false,"monitors":[]}'
  }
}
function Read-OverlayMonitorJson {
  try {
    if (Test-Path -LiteralPath $OverlayMonitorPath) {
      $obj = (Get-Content -LiteralPath $OverlayMonitorPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      $idx = 0; if ($null -ne $obj -and $null -ne $obj.index) { try { $idx = [int]$obj.index } catch { $idx = 0 } }
      if ($idx -lt 0) { $idx = 0 }
      return ('{"ok":true,"index":' + $idx + '}')
    }
  } catch {}
  return '{"ok":true,"index":0}'
}
function Write-OverlayMonitorJson {
  param([object]$Incoming)
  $idx = 0
  if ($null -ne $Incoming -and $null -ne $Incoming.index) { try { $idx = [int]$Incoming.index } catch { $idx = 0 } }
  if ($idx -lt 0) { $idx = 0 }
  try { Set-Content -LiteralPath $OverlayMonitorPath -Value ('{"index":' + $idx + '}') -Encoding UTF8 } catch {}
  return ('{"ok":true,"index":' + $idx + '}')
}

# Geteilte Streamer.bot-Verbindungsdaten (Host/Port). Damit die Einstellungsseite
# (externer Browser) und das Overlay (WebView2) DENSELBEN Wert nutzen - der
# localStorage der beiden Umgebungen ist getrennt, diese Datei ist es nicht.
function Read-WebSocketConfigJson {
  try {
    if (Test-Path -LiteralPath $WebSocketConfigPath) {
      $obj = (Get-Content -LiteralPath $WebSocketConfigPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $obj) {
        $cfgHost = ''
        if ($null -ne $obj.host) { $cfgHost = ([string]$obj.host).Trim() }
        $cfgPort = 0
        if ($null -ne $obj.port) { try { $cfgPort = [int]$obj.port } catch { $cfgPort = 0 } }
        if ($cfgHost -ne '' -and $cfgPort -gt 0 -and $cfgPort -le 65535) {
          $hostEsc = $cfgHost.Replace('\', '\\').Replace('"', '\"')
          return ('{"ok":true,"configured":true,"host":"' + $hostEsc + '","port":' + $cfgPort + '}')
        }
      }
    }
  } catch {}
  return '{"ok":true,"configured":false}'
}
function Write-WebSocketConfigJson {
  param([object]$Incoming)
  $cfgHost = ''
  if ($null -ne $Incoming -and $null -ne $Incoming.host) { $cfgHost = ([string]$Incoming.host).Trim() }
  $cfgPort = 0
  if ($null -ne $Incoming -and $null -ne $Incoming.port) { try { $cfgPort = [int]$Incoming.port } catch { $cfgPort = 0 } }
  if ($cfgHost -eq '' -or $cfgPort -le 0 -or $cfgPort -gt 65535) {
    return '{"ok":false,"error":"invalid host or port"}'
  }
  $hostEsc = $cfgHost.Replace('\', '\\').Replace('"', '\"')
  $json = '{"host":"' + $hostEsc + '","port":' + $cfgPort + ',"updatedAt":' + (Get-NowMilliseconds) + '}'
  try {
    $dir = Split-Path -Parent $WebSocketConfigPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tempPath = "$WebSocketConfigPath.tmp"
    Set-Content -LiteralPath $tempPath -Value $json -Encoding UTF8
    Move-Item -LiteralPath $tempPath -Destination $WebSocketConfigPath -Force
  } catch {}
  return ('{"ok":true,"configured":true,"host":"' + $hostEsc + '","port":' + $cfgPort + '}')
}

function Ensure-EmoteRainUsersFile {
  $dir = Split-Path -Parent $EmoteRainUsersPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (-not (Test-Path -LiteralPath $EmoteRainUsersPath)) {
    Set-Content -LiteralPath $EmoteRainUsersPath -Value '{"ok":true,"users":[],"greetHours":0,"updatedAt":0}' -Encoding UTF8
  }
}
function Read-EmoteRainUsersJson {
  Ensure-EmoteRainUsersFile
  try { return (Get-Content -LiteralPath $EmoteRainUsersPath -Raw -ErrorAction Stop) } catch { return '{"ok":true,"users":[],"updatedAt":0}' }
}
function Write-EmoteRainUsersJson {
  param([object]$Incoming)
  Ensure-EmoteRainUsersFile
  $users = @()
  if ($null -ne $Incoming -and $null -ne $Incoming.users) { $users = @($Incoming.users) }
  # Begruessungs-Pause (Stunden, 0-24). 0 = bei jeder Nachricht.
  $greetHours = 0
  if ($null -ne $Incoming -and $null -ne $Incoming.greetHours) {
    $greetHours = [int](ConvertTo-SafeDouble -Value $Incoming.greetHours -Fallback 0 -Min 0 -Max 24)
  }
  # Beim Start (Stream/Overlay) die Begruessungs-Merkliste einmal leeren?
  $greetResetOnStart = $false
  if ($null -ne $Incoming -and $null -ne $Incoming.greetResetOnStart) {
    $greetResetOnStart = [bool]$Incoming.greetResetOnStart
  }
  # WICHTIG: users manuell als Array bauen - ConvertTo-Json entpackt sonst
  # Ein-Element-Listen zu einem Objekt (Overlay erwartet aber ein Array).
  $parts = @()
  foreach ($u in $users) { $parts += ($u | ConvertTo-Json -Depth 6 -Compress) }
  $usersJson = '[' + ($parts -join ',') + ']'
  $resetJson = if ($greetResetOnStart) { 'true' } else { 'false' }
  $json = '{"ok":true,"users":' + $usersJson + ',"greetHours":' + $greetHours + ',"greetResetOnStart":' + $resetJson + ',"updatedAt":' + (Get-NowMilliseconds) + '}'
  $tmp = "$EmoteRainUsersPath.tmp"
  Set-Content -LiteralPath $tmp -Value $json -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $EmoteRainUsersPath -Force
  return $json
}

function Get-VideoOverlaysJson {
  $saved = @(Read-SavedVideoOverlays)
  $scanned = @(Get-JavaScriptVideoOverlays)
  $savedBySource = @{}
  $savedById = @{}
  foreach ($item in $saved) {
    if (-not [string]::IsNullOrWhiteSpace([string]$item.sourceFile)) { $savedBySource[[string]$item.sourceFile.ToLowerInvariant()] = $item }
    if (-not [string]::IsNullOrWhiteSpace([string]$item.id)) { $savedById[[string]$item.id] = $item }
  }

  $result = @()
  $seen = @{}
  foreach ($scan in $scanned) {
    $candidate = $scan
    $sourceKey = [string]$scan.sourceFile.ToLowerInvariant()
    if ($savedBySource.ContainsKey($sourceKey)) { $candidate = $savedBySource[$sourceKey] }
    elseif ($savedById.ContainsKey([string]$scan.id)) { $candidate = $savedById[[string]$scan.id] }
    $normalized = Normalize-VideoOverlayItem $candidate
    if ($null -ne $normalized) {
      $result += $normalized
      $seen[[string]$normalized.id] = $true
    }
  }
  foreach ($item in $saved) {
    if ($seen.ContainsKey([string]$item.id)) { continue }
    $normalized = Normalize-VideoOverlayItem $item
    if ($null -ne $normalized) { $result += $normalized }
  }

  return ([ordered]@{ ok = $true; items = $result; paused = (Read-VideoPaused); updatedAt = Get-NowMilliseconds } | ConvertTo-Json -Depth 6 -Compress)
}

# Spiegelt Name/Trigger/Pfad/Lautstaerke eines Effekts in seine per-Ordner-.json
# UND in die Effekt-.js (rewardTitle/videoPath/volume). Nur geaenderte Effekte,
# mit Struktur-Check, damit keine .js beschaedigt wird.
function Sync-EffectFilesFromItems {
  param([object[]]$Items, [hashtable]$Previous)
  $contentRoot = [System.IO.Path]::GetFullPath(($ContentRoot))
  foreach ($it in $Items) {
    try {
      $src = [string]$it.sourceFile
      if ([string]::IsNullOrWhiteSpace($src)) { continue }

      # Nur synchronisieren, wenn sich fuer diesen Effekt etwas geaendert hat.
      $old = if ($Previous -and $Previous.ContainsKey([string]$it.id)) { $Previous[[string]$it.id] } else { $null }
      $changed = ($null -eq $old) -or
                 ([string]$old.trigger  -ne [string]$it.trigger)  -or
                 ([string]$old.videoPath -ne [string]$it.videoPath) -or
                 ([string]$old.name     -ne [string]$it.name)     -or
                 ([string]$old.volume   -ne [string]$it.volume)
      if (-not $changed) { continue }

      $srcAbs = [System.IO.Path]::GetFullPath((Join-Path $contentRoot $src))
      $dir = Split-Path -Parent $srcAbs
      if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }

      # 1) per-Ordner-.json aktualisieren (nur bei Aenderung)
      $leaf = Split-Path $dir -Leaf
      $jsonPath = Join-Path $dir ($leaf + '.json')
      $newJson = ($it | ConvertTo-Json -Depth 6 -Compress)
      $existingJson = if (Test-Path -LiteralPath $jsonPath) { (Get-Content -LiteralPath $jsonPath -Raw) } else { '' }
      if ($existingJson.Trim() -ne $newJson) { Set-Content -LiteralPath $jsonPath -Value $newJson -Encoding UTF8 }

      # 2) Effekt-.js angleichen: rewardTitle = Trigger, videoPath, volume
      if (Test-Path -LiteralPath $srcAbs -PathType Leaf) {
        $raw = Get-Content -LiteralPath $srcAbs -Raw
        if ($raw -match 'rewardTitle' -and $raw -match 'videoPath') {
          $trig  = ([string]$it.trigger).Replace("'", '')
          $vpath = ([string]$it.videoPath).Replace("'", '')
          $vol   = ([double]$it.volume / 100).ToString('0.0#', [System.Globalization.CultureInfo]::InvariantCulture)
          $new = $raw
          $new = [regex]::Replace($new, "rewardTitle\s*:\s*(['`"])[^'`"]*\1", "rewardTitle: '$trig'")
          $new = [regex]::Replace($new, "videoPath\s*:\s*(['`"])[^'`"]*\1", "videoPath: '$vpath'")
          $new = [regex]::Replace($new, "volume\s*:\s*[0-9]+(?:\.[0-9]+)?", "volume: $vol")
          # Struktur muss erhalten bleiben, sonst nicht schreiben.
          if ($new -ne $raw -and $new -match 'rewardTitle' -and $new -match 'playVideo' -and $new -match 'General\.Custom') {
            Set-Content -LiteralPath $srcAbs -Value $new -Encoding UTF8
          }
        }
      }
    } catch {}
  }
}

function Write-VideoOverlaysJson {
  param([object]$Incoming)
  Ensure-VideoOverlaysFile
  # Alt-Zustand vor dem Ueberschreiben merken (nur geaenderte Effekte spiegeln).
  $prev = @{}
  try { foreach ($p in @(Read-SavedVideoOverlays)) { if (-not [string]::IsNullOrWhiteSpace([string]$p.id)) { $prev[[string]$p.id] = $p } } } catch {}
  $source = if ($null -ne $Incoming -and $null -ne $Incoming.items) { @($Incoming.items) } else { @($Incoming) }
  $items = @()
  foreach ($item in $source) {
    $normalized = Normalize-VideoOverlayItem $item
    if ($null -ne $normalized) { $items += $normalized }
  }
  $json = ([ordered]@{ ok = $true; items = $items; updatedAt = Get-NowMilliseconds } | ConvertTo-Json -Depth 6 -Compress)
  $tempPath = "$VideoOverlaysPath.tmp"
  Set-Content -LiteralPath $tempPath -Value $json -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $VideoOverlaysPath -Force
  try { Sync-EffectFilesFromItems -Items $items -Previous $prev } catch {}
  return $json
}

function Get-SafeFolderName {
  param([string]$Name)
  $n = [string]$Name
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $n = $n.Replace([string]$c, '_') }
  $n = $n.Trim().Trim('.')
  if ([string]::IsNullOrWhiteSpace($n)) { $n = 'Overlay' }
  if ($n.Length -gt 80) { $n = $n.Substring(0, 80) }
  return $n
}

# Passt in index.html den <script src="...">-Pfad einer verschobenen Trigger-Datei an.
# Case-insensitiv (index.html nutzt teils Kleinschreibung). Legt einmalig ein Backup an.
function Update-OverlayIndexScript {
  param([string]$ContentRoot, [string]$JsBaseName, [string]$NewRelPath)
  # WICHTIG: index.html liegt seit dem app/-Umzug NICHT mehr im Content-Ordner, sondern in
  # $AppRoot (wird von der Bridge unter /content/index.html ausgeliefert). Der alte
  # ContentRoot-Pfad zeigte ins Leere -> die Funktion tat still gar nichts, und nach einem
  # "Aufraeumen"-Lauf zeigten die 82 Modul-<script>-Tags auf tote Pfade (Trigger tot).
  $indexPath = Join-Path $AppRoot 'index.html'
  if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { return }
  if ([string]::IsNullOrWhiteSpace($JsBaseName)) { return }
  try {
    $raw = Get-Content -LiteralPath $indexPath -Raw
    $escBase = [regex]::Escape($JsBaseName)
    $pattern = "(<script[^>]*src\s*=\s*['`"])(?:[^'`"]*/)?$escBase(['`"])"
    $replacement = "`${1}$NewRelPath`$2"
    $new = [regex]::Replace($raw, $pattern, $replacement, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($new -ne $raw) { Set-Content -LiteralPath $indexPath -Value $new -Encoding UTF8 }
  } catch {}
}

# Legt anhand der Gruppen Ordner (Content/Gruppe/Overlay/) an, verschiebt die Videos hinein,
# schreibt pro Overlay eine JSON und aktualisiert den videoPath in den zugehörigen .js-Dateien.
# Bei $dryRun wird nur der Plan zurückgegeben, nichts geändert.
function Invoke-GroupOrganizer {
  param([object]$Incoming)

  $dryRun = if ($null -ne $Incoming -and $null -ne $Incoming.dryRun) { [System.Convert]::ToBoolean($Incoming.dryRun) } else { $true }
  $items = if ($null -ne $Incoming -and $null -ne $Incoming.items) { @($Incoming.items) } else { @() }
  # Wie viele Videos maximal pro Aufruf verschoben werden (0 = unbegrenzt, z. B. fuer die Vorschau).
  $limit = if ($null -ne $Incoming -and $null -ne $Incoming.limit) { [int]$Incoming.limit } else { 0 }

  $contentRoot = [System.IO.Path]::GetFullPath(($ContentRoot)).TrimEnd('\', '/')
  $rootWithSep = $contentRoot + [System.IO.Path]::DirectorySeparatorChar

  $plan = @()
  $moved = 0
  $remaining = 0
  $updatedItems = @()

  foreach ($item in $items) {
    if ($null -eq $item) { continue }
    $group = ([string]$item.group).Trim()
    $videoRel = [string]$item.videoPath

    if ([string]::IsNullOrWhiteSpace($videoRel) -or ($videoRel -match '^(?:https?|file)://')) {
      $updatedItems += $item
      continue
    }

    # Ohne Gruppe kommen die Videos in den allgemeinen Ordner.
    if ([string]::IsNullOrWhiteSpace($group)) { $group = 'Allgemein' }

    $groupName = Get-SafeFolderName $group
    $currentAbs = [System.IO.Path]::GetFullPath((Join-Path $contentRoot $videoRel))
    $fileName = [System.IO.Path]::GetFileName($currentAbs)
    # Ordnername = Videodateiname (eindeutig), damit jedes Video seinen eigenen Ordner bekommt.
    $overlayName = Get-SafeFolderName ([System.IO.Path]::GetFileNameWithoutExtension($fileName))
    if ([string]::IsNullOrWhiteSpace($overlayName)) { $overlayName = Get-SafeFolderName ([string]$item.name) }
    # Ziel-Layout ist die NEUE Ordnerstruktur Content/media/videos/<Gruppe>/<Overlay>/ –
    # frueher baute der Organizer Content/<Gruppe>/ (altes Layout) und zog damit alle
    # Videos wieder aus media/videos heraus (Ursache der toten Effekt-Module).
    $targetDir = Join-Path (Join-Path (Join-Path $contentRoot 'media\videos') $groupName) $overlayName
    $videoTargetAbs = Join-Path $targetDir $fileName
    $newVideoRel = "media/videos/$groupName/$overlayName/$fileName"

    # .js-Trigger-Datei (soll in denselben Ordner)
    $sourceFile = [string]$item.sourceFile
    $jsBase = ''
    $jsCurrentAbs = ''
    $jsTargetAbs = ''
    $newJsRel = ''
    if (-not [string]::IsNullOrWhiteSpace($sourceFile)) {
      $jsBase = [System.IO.Path]::GetFileName($sourceFile)
      $jsCurrentAbs = [System.IO.Path]::GetFullPath((Join-Path $contentRoot $sourceFile))
      $jsTargetAbs = Join-Path $targetDir $jsBase
      $newJsRel = "media/videos/$groupName/$overlayName/$jsBase"
    }

    $entry = [ordered]@{ name = [string]$item.name; group = $group; from = $videoRel; to = $newVideoRel; sourceFile = $sourceFile; status = '' }

    if (-not $currentAbs.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase)) {
      $entry.status = 'ausserhalb Content - uebersprungen'
      $plan += $entry; $updatedItems += $item; continue
    }

    $videoAtTarget = ($currentAbs -ieq $videoTargetAbs)
    $videoNeeds = (-not $videoAtTarget) -and (Test-Path -LiteralPath $currentAbs -PathType Leaf) -and (-not (Test-Path -LiteralPath $videoTargetAbs))
    $jsAtTarget = ($jsBase -ne '') -and ($jsCurrentAbs -ieq $jsTargetAbs)
    $jsNeeds = ($jsBase -ne '') -and (-not $jsAtTarget) -and (Test-Path -LiteralPath $jsCurrentAbs -PathType Leaf) -and (-not (Test-Path -LiteralPath $jsTargetAbs)) -and $jsCurrentAbs.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase)

    # Bereits fertig (Video am Ziel und .js am Ziel bzw. keine .js)
    if (-not $videoNeeds -and -not $jsNeeds) {
      $entry.status = if ($videoAtTarget) { 'schon fertig' } else { 'nichts zu tun' }
      $itemCopy = $item
      if ($videoAtTarget) { $itemCopy.videoPath = $newVideoRel }
      if ($jsAtTarget) { $itemCopy.sourceFile = $newJsRel }
      $plan += $entry; $updatedItems += $itemCopy; continue
    }

    if ($dryRun) {
      $entry.status = 'wird verschoben'
      $plan += $entry
      $itemCopy = $item
      if ($videoNeeds -or $videoAtTarget) { $itemCopy.videoPath = $newVideoRel }
      if ($jsNeeds -or $jsAtTarget) { $itemCopy.sourceFile = $newJsRel }
      $updatedItems += $itemCopy
      continue
    }

    # Haeppchen-Grenze
    if ($limit -gt 0 -and $moved -ge $limit) {
      $entry.status = 'wartet'
      $plan += $entry; $updatedItems += $item; $remaining++
      continue
    }

    try {
      if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
      $itemCopy = $item

      # 1) Video verschieben (falls noetig)
      if ($videoNeeds) { Move-Item -LiteralPath $currentAbs -Destination $videoTargetAbs }
      if ($videoNeeds -or $videoAtTarget) { $itemCopy.videoPath = $newVideoRel }

      # 2) .js-Datei verschieben + index.html-Pfad anpassen (falls noetig)
      if ($jsNeeds) {
        Move-Item -LiteralPath $jsCurrentAbs -Destination $jsTargetAbs
        Update-OverlayIndexScript -ContentRoot $contentRoot -JsBaseName $jsBase -NewRelPath $newJsRel
        $itemCopy.sourceFile = $newJsRel
      } elseif ($jsAtTarget) {
        $itemCopy.sourceFile = $newJsRel
      }

      # 3) videoPath in der .js (am endgueltigen Ort) aktualisieren
      # ($jsTargetAbs ist LEER bei Videos ohne sourceFile -> Test-Path wuerfe dann einen Fehler)
      $jsFinalAbs = ''
      if ($jsTargetAbs -ne '' -and (Test-Path -LiteralPath $jsTargetAbs -PathType Leaf)) { $jsFinalAbs = $jsTargetAbs }
      elseif ($jsCurrentAbs -ne '' -and (Test-Path -LiteralPath $jsCurrentAbs -PathType Leaf)) { $jsFinalAbs = $jsCurrentAbs }
      if ($jsFinalAbs -ne '' -and $videoRel -ne $newVideoRel) {
        try {
          $jsRaw = Get-Content -LiteralPath $jsFinalAbs -Raw
          $escOld = [regex]::Escape($videoRel)
          $jsNew = [regex]::Replace($jsRaw, "videoPath\s*:\s*(['`"])$escOld\1", "videoPath: `$1$newVideoRel`$1")
          if ($jsNew -ne $jsRaw) { Set-Content -LiteralPath $jsFinalAbs -Value $jsNew -Encoding UTF8 }
        } catch {}
      }

      # 4) JSON pro Overlay schreiben
      try {
        $settings = Normalize-VideoOverlayItem $itemCopy
        if ($null -ne $settings) {
          Set-Content -LiteralPath (Join-Path $targetDir ($overlayName + '.json')) -Value ($settings | ConvertTo-Json -Depth 6 -Compress) -Encoding UTF8
        }
      } catch {}

      $moved++
      $entry.status = 'verschoben'
      $entry.sourceFile = $itemCopy.sourceFile
      $updatedItems += $itemCopy
    } catch {
      $entry.status = 'Fehler: ' + ($_.Exception.Message)
      $plan += $entry; $updatedItems += $item; continue
    }
    $plan += $entry
  }

  if (-not $dryRun) {
    try { [void](Write-VideoOverlaysJson ([pscustomobject]@{ items = $updatedItems })) } catch {}
  }

  return ([ordered]@{ ok = $true; dryRun = $dryRun; moved = $moved; remaining = $remaining; total = $plan.Count; plan = $plan } | ConvertTo-Json -Depth 6 -Compress)
}

function Read-PositionPreviewJson {
  Ensure-PositionPreviewFile
  try {
    $raw = Get-Content -LiteralPath $PositionPreviewPath -Raw -ErrorAction Stop
    $preview = $raw | ConvertFrom-Json -ErrorAction Stop
    $now = Get-NowMilliseconds
    $activeItems = @()
    if ($null -ne $preview.items) {
      foreach ($item in @($preview.items)) {
        $notExpired = -not $item.expiresAt -or ([int64]$item.expiresAt -ge $now)
        if ($item.visible -and $notExpired) { $activeItems += $item }
      }
    }
    $topLevelActive = $preview.visible -and (-not $preview.expiresAt -or ([int64]$preview.expiresAt -ge $now))
    $preview.items = $activeItems
    $preview.visible = $topLevelActive -or ($activeItems.Count -gt 0)
    return ($preview | ConvertTo-Json -Depth 6 -Compress)
  } catch {
    $preview = New-PositionPreviewObject ([pscustomobject]@{ visible = $false })
    return ($preview | ConvertTo-Json -Depth 6 -Compress)
  }
}

function Write-PositionPreviewJson {
  param([object]$Incoming)

  Ensure-PositionPreviewFile
  $preview = New-PositionPreviewObject $Incoming
  $json = ($preview | ConvertTo-Json -Depth 6 -Compress)
  $tempPath = "$PositionPreviewPath.tmp"
  Set-Content -LiteralPath $tempPath -Value $json -Encoding UTF8
  Move-Item -LiteralPath $tempPath -Destination $PositionPreviewPath -Force
  return $json
}

function Get-OverlayStatusJson {
  $processes = if ($EmbeddedHost) { @(Get-Process -Id $PID -ErrorAction SilentlyContinue) } else { @(Get-Process -Name 'HtmlWindowsOverlay','HtmlWindowsOverlayModern' -ErrorAction SilentlyContinue) }
  $output = Read-OverlayOutputEnabled
  # "running" = Zustand des Overlay-Ausgabe-Schalters (An/Aus), NICHT ob der Prozess lebt.
  # Der Prozess soll ja gerade weiterlaufen, wenn die Ausgabe aus ist.
  $status = [ordered]@{
    ok = $true
    running = $output
    outputEnabled = $output
    processRunning = $processes.Count -gt 0
    pids = @($processes | ForEach-Object { $_.Id })
    engine = 'WebView2'
  }
  return ($status | ConvertTo-Json -Compress)
}

function Start-OverlayProcess {
  Write-OverlayOutputEnabled $true   # Ausgabe an
  if ($EmbeddedHost) { return Get-OverlayStatusJson }
  $processes = @(Get-Process -Name 'HtmlWindowsOverlay','HtmlWindowsOverlayModern' -ErrorAction SilentlyContinue)
  if ($processes.Count -eq 0) {
    $path = $OverlayExePath
    if (-not (Test-Path -LiteralPath $path)) {
      throw "Overlay EXE nicht gefunden: $path"
    }
    # WebView2-Cache aus, damit immer der aktuelle Overlay-Code geladen wird.
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--disable-http-cache --disk-cache-size=1'
    Start-Process -FilePath $path -WorkingDirectory (Split-Path -Parent $path) -WindowStyle Hidden
    # Waechter starten: beendet die Bridge, sobald die Overlay-EXE geschlossen wird (Einzel-Instanz per Mutex).
    try {
      $wd = Join-Path $PSScriptRoot 'OverlayWatchdog.ps1'
      if (Test-Path -LiteralPath $wd) {
        Start-Process powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $wd + '"') -WindowStyle Hidden
      }
    } catch {}
    Start-Sleep -Milliseconds 1500
  }
  return Get-OverlayStatusJson
}

function Stop-OverlayProcess {
  # NUR die Ausgabe ausschalten (Overlay wird per Suspend ausgeblendet). Die EXE NICHT
  # beenden – sonst reißt der Watchdog die Bridge (Port 18081) mit und die Steuerung
  # verliert die Verbindung. Prozess + Port bleiben also bewusst am Leben.
  Write-OverlayOutputEnabled $false
  return Get-OverlayStatusJson
}

function Test-ControlToken {
  param([hashtable]$Headers)
  return $Headers.ContainsKey('x-kappi-token') -and $Headers['x-kappi-token'] -eq $ControlToken
}

function Test-LocalOrigin {
  param([hashtable]$Headers)
  if (-not $Headers.ContainsKey('origin') -or [string]::IsNullOrWhiteSpace($Headers['origin'])) { return $true }
  # localhost UND private LAN-Bereiche (10.x, 192.168.x, 172.16-31.x) erlauben – fuer LAN-Zugriff.
  return ([string]$Headers['origin']) -match '^https?://(127\.0\.0\.1|localhost|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$'
}

# IP-Freigabe: welche Geraete auf die Bridge duerfen. Liste in allowed-ips.json (gecacht per
# Aenderungszeit). LEERE Liste = alle im LAN erlaubt (wie bisher). Sobald IPs eingetragen sind,
# duerfen NUR diese + Loopback (dieser PC ist NIE aussperrbar -> Notausgang am Host).
$script:AllowedIpsCache = @()
$script:AllowedIpsMt = -1
function Read-AllowedIps {
  try {
    if (Test-Path -LiteralPath $AllowedIpsPath) {
      $mt = (Get-Item -LiteralPath $AllowedIpsPath).LastWriteTimeUtc.Ticks
      if ($script:AllowedIpsMt -ne $mt) {
        $script:AllowedIpsMt = $mt
        $raw = Get-Content -LiteralPath $AllowedIpsPath -Raw -ErrorAction Stop
        $obj = if ([string]::IsNullOrWhiteSpace($raw)) { $null } else { $raw | ConvertFrom-Json -ErrorAction Stop }
        $arr = @()
        if ($null -ne $obj -and $null -ne $obj.ips) { foreach ($i in @($obj.ips)) { $s = ([string]$i).Trim(); if ($s) { $arr += $s } } }
        $script:AllowedIpsCache = $arr
      }
    } else { $script:AllowedIpsMt = 0; $script:AllowedIpsCache = @() }
  } catch { $script:AllowedIpsCache = @() }
  return $script:AllowedIpsCache
}
# Eigene Adressen DIESES PCs (LAN-IPs etc.), ~60s gecacht: Der Host darf sich nie selbst
# aussperren - auch nicht, wenn er die Seite ueber seine eigene LAN-IP (statt 127.0.0.1) oeffnet.
$script:LocalIpsCache = $null
$script:LocalIpsAt = 0
function Get-LocalMachineIps {
  $now = Get-NowMilliseconds
  if ($null -eq $script:LocalIpsCache -or (($now - $script:LocalIpsAt) -gt 60000)) {
    $ips = @()
    try { foreach ($a in [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())) { $ips += ($a.ToString() -replace '%\d+$', '') } } catch {}
    $script:LocalIpsCache = $ips
    $script:LocalIpsAt = $now
  }
  return $script:LocalIpsCache
}
function Test-IpAllowed {
  param([string]$Ip)
  if ([string]::IsNullOrWhiteSpace($Ip)) { return $true }
  $ip = $Ip -replace '^::ffff:', ''                                  # IPv4-mapped IPv6 normalisieren
  if ($ip -eq '127.0.0.1' -or $ip -eq '::1' -or $ip -eq '0.0.0.0') { return $true }  # Loopback immer erlaubt
  if (@(Get-LocalMachineIps) -contains $ip) { return $true }         # eigene LAN-Adressen immer erlaubt
  $list = Read-AllowedIps
  if ($null -eq $list -or @($list).Count -eq 0) { return $true }     # leer = alle erlaubt
  return (@($list) -contains $ip)
}

# Prueft per MSG_PEEK, ob der komplette HTTP-Header bereits im Socket liegt.
# DataAvailable allein reicht nicht: Chrome/WebView2 schicken bei Preconnects teils nur
# einen Header-Anfang. ReadLine blockierte dann den einfaedigen Loop bis zum 3000-ms-Timeout.
function Test-HttpHeaderAvailable {
  param([System.Net.Sockets.TcpClient]$Client)
  if ($null -eq $Client) { return $false }
  try {
    $available = [int]$Client.Available
    if ($available -le 0) { return $false }
    $peekLength = [Math]::Min($available, 65536)
    $peek = New-Object byte[] $peekLength
    $read = $Client.Client.Receive($peek, 0, $peekLength, [System.Net.Sockets.SocketFlags]::Peek)
    if ($read -lt 4) { return $false }
    for ($i = 0; $i -le ($read - 4); $i++) {
      if ($peek[$i] -eq 13 -and $peek[$i + 1] -eq 10 -and $peek[$i + 2] -eq 13 -and $peek[$i + 3] -eq 10) { return $true }
    }
  } catch {}
  return $false
}
function Write-HttpResponse {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$Reason,
    [string]$Body,
    [string]$ContentType = 'application/json'
  )

  if ($null -eq $Body) { $Body = '' }
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
  $headers = @(
    "HTTP/1.1 $StatusCode $Reason",
    "Content-Type: $ContentType; charset=utf-8",
    "Content-Length: $($bodyBytes.Length)",
    'Access-Control-Allow-Origin: *',
    'Access-Control-Allow-Methods: GET, POST, OPTIONS',
    'Access-Control-Allow-Headers: Content-Type, X-Kappi-Token',
    'Permissions-Policy: local-network-access=*, local-network=*, loopback-network=*',
    'Cache-Control: no-store',
    'Connection: close',
    '',
    ''
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($bodyBytes.Length -gt 0) {
    $Stream.Write($bodyBytes, 0, $bodyBytes.Length)
  }
  $Stream.Flush()
}

function Write-StaticFileResponse {
  param(
    [System.IO.Stream]$Stream,
    [string]$Path,
    [string]$ContentType
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-HttpResponse -Stream $Stream -StatusCode 404 -Reason 'Not Found' -Body '{"ok":false,"error":"not found"}'
    return
  }

  $body = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  Write-HttpResponse -Stream $Stream -StatusCode 200 -Reason 'OK' -Body $body -ContentType $ContentType
}

function Write-SettingsPageResponse {
  param(
    [System.IO.Stream]$Stream,
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-HttpResponse -Stream $Stream -StatusCode 404 -Reason 'Not Found' -Body '{"ok":false,"error":"not found"}'
    return
  }

  # Steuerseite: den pro-Installation erzeugten Control-Token erst beim Ausliefern
  # einsetzen. Im HTML steht nur der Platzhalter __BRIDGE_CONTROL_TOKEN__.
  $body = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $body = $body.Replace('__BRIDGE_CONTROL_TOKEN__', $ControlToken)
  Write-HttpResponse -Stream $Stream -StatusCode 200 -Reason 'OK' -Body $body -ContentType 'text/html; charset=utf-8'
}

# Dateilose Vorschau fuer bekannte externe Overlays. Die HTML-Seite wird nur bei
# Bedarf vom festen Originalanbieter in den Arbeitsspeicher geladen und kurz
# gecacht. Es wird nichts unter Content/html-overlays gespeichert. Feste Ziele
# statt einer freien URL verhindern, dass der Endpunkt als beliebiger Proxy
# (SSRF) missbraucht werden kann.
$script:ExternalPreviewCache = @{}
$script:ExternalPreviewCacheAt = @{}
$ExternalPreviewCacheMs = 600000

function Get-ExternalPreviewDefinition {
  param([string]$Kind)
  switch ($Kind) {
    'chatrd' {
      return @{ Url = 'https://vortisrd.github.io/chatrd/chat.html'; Base = 'https://vortisrd.github.io/chatrd/' }
    }
    'tawmae-giphy' {
      return @{ Url = 'https://tawmae.xyz/overlays/giphy-and-sb'; Base = 'https://tawmae.xyz/overlays/' }
    }
    'tawmae-better-shoutouts' {
      return @{ Url = 'https://tawmae.xyz/overlays/better-shoutouts'; Base = 'https://tawmae.xyz/overlays/' }
    }
    'tawmae-dynamic-timers-v2' {
      return @{ Url = 'https://tawmae.xyz/overlays/dynamic-timers-v2'; Base = 'https://tawmae.xyz/overlays/' }
    }
    'tawmae-spotify' {
      return @{ Url = 'https://tawmae.xyz/overlays/spotify-and-sb'; Base = 'https://tawmae.xyz/overlays/' }
    }
    'mustached-viewer-queue' {
      return @{ Url = 'https://mustachedmaniac.com/widgets/Viewer_Queue/'; Base = 'https://mustachedmaniac.com/widgets/Viewer_Queue/' }
    }
    default { return $null }
  }
}

function Set-ExternalPreviewBase {
  param([string]$Html, [string]$BaseHref)
  if ([string]::IsNullOrWhiteSpace($Html)) { return '' }
  $tag = '<base href="' + $BaseHref.Replace('&', '&amp;').Replace('"', '&quot;') + '">'
  $baseRegex = New-Object System.Text.RegularExpressions.Regex('<base\b[^>]*>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($baseRegex.IsMatch($Html)) {
    return $baseRegex.Replace($Html, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $tag }, 1)
  }
  $headRegex = New-Object System.Text.RegularExpressions.Regex('<head\b[^>]*>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  return $headRegex.Replace($Html, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $m.Value + "`r`n    " + $tag }, 1)
}

function Get-ExternalPreviewHtml {
  param([string]$Kind)
  $def = Get-ExternalPreviewDefinition $Kind
  if ($null -eq $def) { return $null }
  $now = Get-NowMilliseconds
  if ($script:ExternalPreviewCache.ContainsKey($Kind) -and
      $script:ExternalPreviewCacheAt.ContainsKey($Kind) -and
      (($now - [double]$script:ExternalPreviewCacheAt[$Kind]) -lt $ExternalPreviewCacheMs)) {
    return [string]$script:ExternalPreviewCache[$Kind]
  }
  try {
    try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 } catch {}
    $response = Invoke-WebRequest -Uri $def.Url -UseBasicParsing -TimeoutSec 8 -Headers @{ 'User-Agent' = 'FreakShow/1.0 overlay-preview' } -ErrorAction Stop
    $html = Set-ExternalPreviewBase -Html ([string]$response.Content) -BaseHref ([string]$def.Base)
    if ([string]::IsNullOrWhiteSpace($html) -or $html.Length -lt 128) { throw 'empty preview response' }
    $script:ExternalPreviewCache[$Kind] = $html
    $script:ExternalPreviewCacheAt[$Kind] = $now
    return $html
  } catch {
    Write-Host "Externe Vorschau '$Kind' konnte nicht geladen werden: $($_.Exception.Message)"
    return ''
  }
}

function Write-ExternalPreviewResponse {
  param([System.IO.Stream]$Stream, [string]$Kind)
  $html = Get-ExternalPreviewHtml $Kind
  if ($null -eq $html) {
    Write-HttpResponse -Stream $Stream -StatusCode 404 -Reason 'Not Found' -Body '{"ok":false,"error":"unknown preview"}'
    return
  }
  if ([string]::IsNullOrWhiteSpace($html)) {
    $retry = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;color:#ddd;font:14px sans-serif}body{padding:16px}</style><p>Overlay-Vorschau konnte nicht vom Anbieter geladen werden.</p>'
    Write-HttpResponse -Stream $Stream -StatusCode 502 -Reason 'Bad Gateway' -Body $retry -ContentType 'text/html; charset=utf-8'
    return
  }
  Write-HttpResponse -Stream $Stream -StatusCode 200 -Reason 'OK' -Body $html -ContentType 'text/html; charset=utf-8'
}

function Get-ContentTypeForPath {
  param([string]$Path)
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.html' { return 'text/html; charset=utf-8' }
    '.htm' { return 'text/html; charset=utf-8' }
    '.js' { return 'text/javascript; charset=utf-8' }
    '.mjs' { return 'text/javascript; charset=utf-8' }
    '.css' { return 'text/css; charset=utf-8' }
    '.json' { return 'application/json; charset=utf-8' }
    '.map' { return 'application/json; charset=utf-8' }
    '.xml' { return 'application/xml; charset=utf-8' }
    '.txt' { return 'text/plain; charset=utf-8' }
    '.svg' { return 'image/svg+xml' }
    '.ico' { return 'image/x-icon' }
    '.webp' { return 'image/webp' }
    '.avif' { return 'image/avif' }
    '.apng' { return 'image/apng' }
    '.bmp' { return 'image/bmp' }
    '.webm' { return 'video/webm' }
    '.mp4' { return 'video/mp4' }
    '.mov' { return 'video/quicktime' }
    '.m4v' { return 'video/x-m4v' }
    '.mp3' { return 'audio/mpeg' }
    '.wav' { return 'audio/wav' }
    '.ogg' { return 'audio/ogg' }
    '.png' { return 'image/png' }
    '.jpg' { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.gif' { return 'image/gif' }
    '.woff' { return 'font/woff' }
    '.woff2' { return 'font/woff2' }
    '.ttf' { return 'font/ttf' }
    '.otf' { return 'font/otf' }
    '.wasm' { return 'application/wasm' }
    '.webmanifest' { return 'application/manifest+json' }
    default { return 'application/octet-stream' }
  }
}

function Test-IsCacheableMediaPath {
  param([string]$Path)
  $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  return @('.webm','.mp4','.mov','.m4v','.mp3','.wav','.ogg','.ogv','.png','.jpg','.jpeg','.gif','.webp','.avif','.apng','.bmp','.svg','.ico','.woff','.woff2','.ttf','.otf') -contains $ext
}

function Get-MediaValidators {
  param([System.IO.FileInfo]$FileInfo)
  $etag = '"' + ([int64]$FileInfo.Length).ToString('x') + '-' + ([int64]$FileInfo.LastWriteTimeUtc.Ticks).ToString('x') + '"'
  return [pscustomobject]@{ ETag = $etag; LastModified = $FileInfo.LastWriteTimeUtc.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture) }
}

function Test-RequestNotModified {
  param([hashtable]$Headers, [string]$ETag, [datetime]$LastModifiedUtc)
  if ($null -eq $Headers) { return $false }
  if ($Headers.ContainsKey('if-none-match')) {
    foreach ($candidate in ([string]$Headers['if-none-match']).Split(',')) {
      $tag = $candidate.Trim()
      if ($tag.StartsWith('W/')) { $tag = $tag.Substring(2).Trim() }
      if ($tag -eq '*' -or $tag -eq $ETag) { return $true }
    }
    return $false
  }
  if ($Headers.ContainsKey('if-modified-since')) {
    $since = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string]$Headers['if-modified-since'], [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal, [ref]$since)) {
      $last = $LastModifiedUtc.ToUniversalTime().AddTicks(-($LastModifiedUtc.Ticks % [TimeSpan]::TicksPerSecond))
      if ($last -le $since.UtcDateTime.AddSeconds(1)) { return $true }
    }
  }
  return $false
}

function Test-IfRangeMatches {
  param([hashtable]$Headers, [string]$ETag, [datetime]$LastModifiedUtc)
  if ($null -eq $Headers -or -not $Headers.ContainsKey('if-range')) { return $true }
  $value = ([string]$Headers['if-range']).Trim()
  if ($value.StartsWith('W/')) { return $false }
  if ($value.StartsWith('"')) { return $value -eq $ETag }
  $since = [DateTimeOffset]::MinValue
  if ([DateTimeOffset]::TryParse($value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal, [ref]$since)) {
    $last = $LastModifiedUtc.ToUniversalTime().AddTicks(-($LastModifiedUtc.Ticks % [TimeSpan]::TicksPerSecond))
    return $last -le $since.UtcDateTime.AddSeconds(1)
  }
  return $false
}
function Write-BinaryFileResponse {
  param(
    [System.IO.Stream]$Stream,
    [string]$Path,
    [hashtable]$Headers
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-HttpResponse -Stream $Stream -StatusCode 404 -Reason 'Not Found' -Body '{"ok":false,"error":"not found"}'
    return
  }

  $fileInfo = Get-Item -LiteralPath $Path
  $contentType = Get-ContentTypeForPath $Path
  $isMedia = Test-IsCacheableMediaPath $Path
  $cacheControl = if ($isMedia) { 'private, no-cache, must-revalidate' } else { 'no-store' }
  $validators = if ($isMedia) { Get-MediaValidators $fileInfo } else { $null }

  if ($isMedia -and (Test-RequestNotModified -Headers $Headers -ETag $validators.ETag -LastModifiedUtc $fileInfo.LastWriteTimeUtc)) {
    $notModifiedHeaders = @(
      'HTTP/1.1 304 Not Modified',
      'Content-Length: 0',
      "ETag: $($validators.ETag)",
      "Last-Modified: $($validators.LastModified)",
      "Cache-Control: $cacheControl",
      'Accept-Ranges: bytes',
      'Access-Control-Allow-Origin: *',
      'Access-Control-Allow-Methods: GET, OPTIONS',
      'Permissions-Policy: local-network-access=*, local-network=*, loopback-network=*',
      'Connection: close',
      '',
      ''
    ) -join "`r`n"
    $notModifiedBytes = [System.Text.Encoding]::ASCII.GetBytes($notModifiedHeaders)
    $Stream.Write($notModifiedBytes, 0, $notModifiedBytes.Length)
    $Stream.Flush()
    return
  }

  $start = [int64]0
  $end = [int64]$fileInfo.Length - 1
  $partial = $false
  $rangeAllowed = (-not $isMedia) -or (Test-IfRangeMatches -Headers $Headers -ETag $validators.ETag -LastModifiedUtc $fileInfo.LastWriteTimeUtc)
  if ($rangeAllowed -and $null -ne $Headers -and $Headers.ContainsKey('range')) {
    $rangeMatch = [regex]::Match([string]$Headers['range'], '^bytes=(?<start>\d*)-(?<end>\d*)$', 'IgnoreCase')
    if ($rangeMatch.Success) {
      if (-not [string]::IsNullOrWhiteSpace($rangeMatch.Groups['start'].Value)) { $start = [Math]::Min([int64]$rangeMatch.Groups['start'].Value, [int64]$fileInfo.Length - 1) }
      if (-not [string]::IsNullOrWhiteSpace($rangeMatch.Groups['end'].Value)) { $end = [Math]::Min([int64]$rangeMatch.Groups['end'].Value, [int64]$fileInfo.Length - 1) }
      if ($end -lt $start) { $end = $start }
      $partial = $true
    }
  }
  $contentLength = $end - $start + 1
  $responseHeaders = New-Object System.Collections.Generic.List[string]
  $responseHeaders.Add($(if ($partial) { 'HTTP/1.1 206 Partial Content' } else { 'HTTP/1.1 200 OK' }))
  $responseHeaders.Add("Content-Type: $contentType")
  $responseHeaders.Add("Content-Length: $contentLength")
  if ($partial) { $responseHeaders.Add("Content-Range: bytes $start-$end/$($fileInfo.Length)") }
  $responseHeaders.Add('Accept-Ranges: bytes')
  if ($isMedia) { $responseHeaders.Add("ETag: $($validators.ETag)"); $responseHeaders.Add("Last-Modified: $($validators.LastModified)") }
  $responseHeaders.Add('Access-Control-Allow-Origin: *')
  $responseHeaders.Add('Access-Control-Allow-Methods: GET, OPTIONS')
  $responseHeaders.Add('Permissions-Policy: local-network-access=*, local-network=*, loopback-network=*')
  $responseHeaders.Add("Cache-Control: $cacheControl")
  $responseHeaders.Add('Connection: close')
  $responseHeaders.Add('')
  $responseHeaders.Add('')
  $responseHeaderText = $responseHeaders -join "`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($responseHeaderText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  $fileStream = [System.IO.File]::OpenRead($Path)
  try {
    [void]$fileStream.Seek($start, [System.IO.SeekOrigin]::Begin)
    $remaining = $contentLength
    $buffer = New-Object byte[] 16384
    while ($remaining -gt 0 -and ($read = $fileStream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))) -gt 0) {
      $Stream.Write($buffer, 0, $read)
      $remaining -= $read
    }
  } finally { $fileStream.Dispose() }
  $Stream.Flush()
}
function Read-RequestBody {
  param(
    [System.IO.StreamReader]$Reader,
    [int]$Length
  )

  if ($Length -le 0) { return '' }
  # Content-Length zaehlt UTF-8-BYTES, StreamReader liefert UTF-16-Zeichen.
  # Bytegenau zaehlen verhindert den bisherigen 3000-ms-Stall bei Umlauten/Emoji.
  $builder = [System.Text.StringBuilder]::new([Math]::Min($Length, 1048576))
  $buffer = New-Object char[] 8192
  $bytesRead = 0
  $pendingHighSurrogate = $false
  while ($bytesRead -lt $Length) {
    $remainingBytes = $Length - $bytesRead
    $charsToRead = [Math]::Min($buffer.Length, $remainingBytes)
    $next = $Reader.Read($buffer, 0, $charsToRead)
    if ($next -le 0) { break }
    [void]$builder.Append($buffer, 0, $next)
    $offset = 0
    $count = $next
    if ($pendingHighSurrogate) {
      if ($count -gt 0 -and [char]::IsLowSurrogate($buffer[0])) { $bytesRead += 4; $offset = 1; $count-- }
      else { $bytesRead += 3 }
      $pendingHighSurrogate = $false
    }
    if ($count -gt 0 -and [char]::IsHighSurrogate($buffer[$offset + $count - 1])) {
      $pendingHighSurrogate = $true
      $count--
    }
    if ($count -gt 0) { $bytesRead += [System.Text.Encoding]::UTF8.GetByteCount($buffer, $offset, $count) }
  }
  if ($pendingHighSurrogate) { $bytesRead += 3 }
  if ($bytesRead -lt $Length) { throw "Unvollstaendiger Request-Body: $bytesRead von $Length Bytes" }
  return $builder.ToString()
}
function Get-JsonStringField {
  # Zieht ein String-Feld aus einem JSON-Body OHNE JSON-Parser heraus.
  # Nötig, weil ConvertFrom-Json in Windows PowerShell 5.1 nur ~2 MB verträgt,
  # der base64-Video-Upload aber deutlich größer sein kann.
  param([string]$Body, [string]$Field)
  $key = '"' + $Field + '"'
  $ki = $Body.IndexOf($key)
  if ($ki -lt 0) { return '' }
  $ci = $Body.IndexOf(':', $ki + $key.Length)
  if ($ci -lt 0) { return '' }
  $q1 = $Body.IndexOf('"', $ci + 1)
  if ($q1 -lt 0) { return '' }
  $q2 = $Body.IndexOf('"', $q1 + 1)
  if ($q2 -lt 0) { return '' }
  return $Body.Substring($q1 + 1, $q2 - $q1 - 1)
}

function Save-UploadedVideo {
  param([string]$Body)
  if ([string]::IsNullOrWhiteSpace($Body)) { return '{"ok":false,"error":"no data"}' }
  $b64 = Get-JsonStringField -Body $Body -Field 'dataBase64'
  if ([string]::IsNullOrWhiteSpace($b64)) { return '{"ok":false,"error":"no data"}' }
  # evtl. Data-URL-Präfix (data:video/mp4;base64,...) entfernen
  $b64 = $b64 -replace '^data:[^,]*,', ''

  $rawName = Get-JsonStringField -Body $Body -Field 'filename'
  if ([string]::IsNullOrWhiteSpace($rawName)) { $rawName = 'video.webm' }
  $ext = ([System.IO.Path]::GetExtension($rawName)).ToLowerInvariant()
  $allowed = @('.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg', '.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.apng')
  if ($allowed -notcontains $ext) { return '{"ok":false,"error":"unsupported type"}' }

  $base = [System.IO.Path]::GetFileNameWithoutExtension($rawName)
  $base = ($base -replace '[^A-Za-z0-9_\-]', '_').Trim('_')
  if ([string]::IsNullOrWhiteSpace($base)) { $base = 'video' }

  # Optionaler Ziel-Ordner (z. B. 'backgrounds' oder 'images/<Gruppe>'); pro Segment
  # sicher bereinigt (max. 2 Ebenen), damit Bilder-Gruppen als Unterordner moeglich sind.
  $folderRaw = Get-JsonStringField -Body $Body -Field 'folder'
  if ([string]::IsNullOrWhiteSpace($folderRaw)) { $folderRaw = 'uploads' }
  $segs = @(($folderRaw -replace '\\', '/').Split('/') | ForEach-Object { Get-SafeGroupFolderName $_ } | Where-Object { $_ })
  if ($segs.Count -eq 0) { $segs = @('uploads') }
  if ($segs.Count -gt 2) { $segs = @($segs[0], $segs[1]) }
  $folder = ($segs -join '/')

  try {
    $contentRoot = [System.IO.Path]::GetFullPath(($ContentRoot))
    $uploadsDir = Join-Path $contentRoot ($folder -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $uploadsDir)) { New-Item -ItemType Directory -Path $uploadsDir -Force | Out-Null }

    $fileName = $base + $ext
    $target = Join-Path $uploadsDir $fileName
    $i = 1
    while (Test-Path $target) {
      $fileName = $base + '_' + $i + $ext
      $target = Join-Path $uploadsDir $fileName
      $i++
    }

    $bytes = [System.Convert]::FromBase64String($b64)
    [System.IO.File]::WriteAllBytes($target, $bytes)
  } catch {
    return '{"ok":false,"error":"write failed"}'
  }

  $displayName = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
  return (([ordered]@{ ok = $true; path = ($folder + '/' + $fileName); name = $displayName } | ConvertTo-Json -Compress))
}

# Benennt eine bereits hochgeladene Bilddatei um (behaelt den Ordner + die Endung).
# oldPath ist relativ zu Content/ (z. B. "bilder/x.jpeg"); newName wird sicher bereinigt.
function Rename-UploadedFile {
  param([string]$Body)
  if ([string]::IsNullOrWhiteSpace($Body)) { return '{"ok":false,"error":"no data"}' }
  $oldPath = Get-JsonStringField -Body $Body -Field 'oldPath'
  $newName = Get-JsonStringField -Body $Body -Field 'newName'
  if ([string]::IsNullOrWhiteSpace($oldPath) -or [string]::IsNullOrWhiteSpace($newName)) { return '{"ok":false,"error":"missing"}' }
  $oldRel = ($oldPath -replace '\\', '/').TrimStart('/')
  if ($oldRel -match '\.\.') { return '{"ok":false,"error":"bad path"}' }
  $ext = ([System.IO.Path]::GetExtension($oldRel)).ToLowerInvariant()
  $folder = ([System.IO.Path]::GetDirectoryName($oldRel) -replace '\\', '/')
  $base = ($newName -replace '[^A-Za-z0-9_\-]', '_').Trim('_')
  if ([string]::IsNullOrWhiteSpace($base)) { return '{"ok":false,"error":"bad name"}' }
  try {
    $contentRoot = [System.IO.Path]::GetFullPath(($ContentRoot))
    $srcFull = Join-Path $contentRoot ($oldRel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $srcFull)) { return '{"ok":false,"error":"not found"}' }
    $dir = Split-Path -Parent $srcFull
    $fileName = $base + $ext
    $target = Join-Path $dir $fileName
    $i = 1
    while ((Test-Path -LiteralPath $target) -and ($target -ne $srcFull)) {
      $fileName = $base + '_' + $i + $ext; $target = Join-Path $dir $fileName; $i++
    }
    if ($target -ne $srcFull) { Move-Item -LiteralPath $srcFull -Destination $target -Force }
    $rel = if ([string]::IsNullOrWhiteSpace($folder)) { $fileName } else { $folder + '/' + $fileName }
    return (([ordered]@{ ok = $true; path = $rel; name = [System.IO.Path]::GetFileNameWithoutExtension($fileName) } | ConvertTo-Json -Compress))
  } catch {
    return '{"ok":false,"error":"rename failed"}'
  }
}

# --- Bilder-Gruppenordner (Phase 2): Gruppe = Unterordner von images/ ---
# Gruppennamen ordnersicher machen: Buchstaben/Ziffern/_/- behalten, Leerzeichen -> _,
# alles andere raus. Deterministisch, damit Move/Rename/Delete denselben Ordner treffen.
function Get-SafeGroupFolderName {
  param([string]$Name)
  $n = ([string]$Name).Trim()
  if ([string]::IsNullOrWhiteSpace($n)) { return '' }
  $n = [regex]::Replace($n, '[^\w \-]', '')
  $n = [regex]::Replace($n, '\s+', '_')
  return $n.Trim('_', '.', '-')
}
function Get-ImagesContentRoot {
  return ([System.IO.Path]::GetFullPath(($ContentRoot)).TrimEnd('\', '/'))
}
# Verschiebt Bilddatei(en) in den Ordner ihrer Gruppe (images/<Gruppe>) bzw. images/ (ohne Gruppe).
# Erwartet { items: [ { path, group } ] }, liefert { ok, moved: [ { old, new } ] } zurueck.
function Get-SafeRootName {
  param([object]$Incoming)
  if ($null -ne $Incoming -and [string]$Incoming.root -eq 'backgrounds') { return 'backgrounds' }
  return 'images'
}
function Move-ImagesToGroup {
  param([object]$Incoming)
  $contentRoot = Get-ImagesContentRoot
  $sep = [System.IO.Path]::DirectorySeparatorChar
  $rootName = Get-SafeRootName $Incoming
  $imagesRoot = Join-Path $contentRoot $rootName
  if (-not (Test-Path -LiteralPath $imagesRoot)) { New-Item -ItemType Directory -Path $imagesRoot -Force | Out-Null }
  $moved = @()
  if ($null -ne $Incoming -and $null -ne $Incoming.items) {
    foreach ($it in @($Incoming.items)) {
      try {
        $rel = ([string]$it.path -replace '\\', '/').TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($rel) -or $rel -match '\.\.') { continue }
        $srcAbs = [System.IO.Path]::GetFullPath((Join-Path $contentRoot ($rel -replace '/', $sep)))
        if (-not $srcAbs.StartsWith($contentRoot + $sep, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if (-not (Test-Path -LiteralPath $srcAbs -PathType Leaf)) { continue }
        $grp = Get-SafeGroupFolderName ([string]$it.group)
        $targetDir = if ($grp) { Join-Path $imagesRoot $grp } else { $imagesRoot }
        if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
        $fileName = [System.IO.Path]::GetFileName($srcAbs)
        $targetAbs = Join-Path $targetDir $fileName
        $newRel = if ($grp) { $rootName + '/' + $grp + '/' + $fileName } else { $rootName + '/' + $fileName }
        if (([System.IO.Path]::GetFullPath($targetAbs)).TrimEnd($sep) -ieq $srcAbs.TrimEnd($sep)) {
          $moved += @{ old = $rel; new = $newRel }; continue
        }
        $baseN = [System.IO.Path]::GetFileNameWithoutExtension($fileName); $ext = [System.IO.Path]::GetExtension($fileName); $i = 1
        while (Test-Path -LiteralPath $targetAbs) { $fileName = $baseN + '_' + $i + $ext; $targetAbs = Join-Path $targetDir $fileName; $newRel = if ($grp) { $rootName + '/' + $grp + '/' + $fileName } else { $rootName + '/' + $fileName }; $i++ }
        Move-Item -LiteralPath $srcAbs -Destination $targetAbs -Force
        $moved += @{ old = $rel; new = $newRel }
      } catch {}
    }
  }
  $parts = @()
  foreach ($m in $moved) { $parts += ('{"old":"' + ($m.old.Replace('\', '\\').Replace('"', '\"')) + '","new":"' + ($m.new.Replace('\', '\\').Replace('"', '\"')) + '"}') }
  return ('{"ok":true,"moved":[' + ($parts -join ',') + ']}')
}
# Benennt den Gruppenordner um: images/<alt> -> images/<neu>. Liefert die (bereinigten) Ordnerpfade.
function Rename-ImageGroupFolder {
  param([object]$Incoming)
  $contentRoot = Get-ImagesContentRoot
  $rootName = Get-SafeRootName $Incoming
  $imagesRoot = Join-Path $contentRoot $rootName
  $oldG = Get-SafeGroupFolderName ([string]$Incoming.oldName)
  $newG = Get-SafeGroupFolderName ([string]$Incoming.newName)
  if ([string]::IsNullOrWhiteSpace($oldG) -or [string]::IsNullOrWhiteSpace($newG)) { return '{"ok":false,"error":"bad name"}' }
  $oldDir = Join-Path $imagesRoot $oldG
  $newDir = Join-Path $imagesRoot $newG
  try {
    if (Test-Path -LiteralPath $oldDir -PathType Container) {
      if (Test-Path -LiteralPath $newDir) {
        Get-ChildItem -LiteralPath $oldDir -File | ForEach-Object {
          $t = Join-Path $newDir $_.Name; $b = [System.IO.Path]::GetFileNameWithoutExtension($_.Name); $e = [System.IO.Path]::GetExtension($_.Name); $i = 1
          while (Test-Path -LiteralPath $t) { $t = Join-Path $newDir ($b + '_' + $i + $e); $i++ }
          Move-Item -LiteralPath $_.FullName -Destination $t -Force
        }
        Remove-Item -LiteralPath $oldDir -Recurse -Force
      } else {
        Move-Item -LiteralPath $oldDir -Destination $newDir -Force
      }
    } elseif (-not (Test-Path -LiteralPath $newDir)) {
      New-Item -ItemType Directory -Path $newDir -Force | Out-Null
    }
    return ('{"ok":true,"oldFolder":"' + $rootName + '/' + $oldG + '","newFolder":"' + $rootName + '/' + $newG + '"}')
  } catch { return '{"ok":false,"error":"rename failed"}' }
}
# Loescht den Gruppenordner inkl. Dateien. Liefert die geloeschten relativen Pfade.
function Remove-ImageGroupFolder {
  param([object]$Incoming)
  $contentRoot = Get-ImagesContentRoot
  $rootName = Get-SafeRootName $Incoming
  $imagesRoot = Join-Path $contentRoot $rootName
  $grp = Get-SafeGroupFolderName ([string]$Incoming.name)
  if ([string]::IsNullOrWhiteSpace($grp)) { return '{"ok":false,"error":"bad name"}' }
  $dir = Join-Path $imagesRoot $grp
  $deleted = @()
  try {
    if (Test-Path -LiteralPath $dir -PathType Container) {
      Get-ChildItem -LiteralPath $dir -File | ForEach-Object {
        $deleted += ('"' + (($rootName + '/' + $grp + '/' + $_.Name).Replace('\', '\\').Replace('"', '\"')) + '"')
      }
      Remove-Item -LiteralPath $dir -Recurse -Force
    }
    return ('{"ok":true,"folder":"' + $rootName + '/' + $grp + '","deleted":[' + ($deleted -join ',') + ']}')
  } catch { return '{"ok":false,"error":"delete failed"}' }
}

Ensure-SettingsFile
Ensure-PositionPreviewFile
# Die Positionsvorschau ist nur ein kurzlebiger Laufzeitzustand. Nach einem
# Neustart darf ein zuvor gespeicherter blauer Rahmen nicht erneut erscheinen,
# wenn der Schalter in der Oberfläche bereits aus ist.
[void](Write-PositionPreviewJson ([pscustomobject]@{ visible = $false; items = @() }))
Ensure-ExternalLinksFile
Ensure-VideoOverlaysFile
Ensure-EmoteRainUsersFile

$positionPreviewAck = [ordered]@{
  ok = $true
  seen = $false
  frames = 0
  scriptVersion = ''
  width = 0
  height = 0
  updatedAt = 0
}

$videoTrigger = [ordered]@{
  ok = $true
  id = ''
  token = 0
  updatedAt = 0
}

$emoteRainTest = [ordered]@{
  ok = $true
  name = ''
  token = 0
  updatedAt = 0
}

# --- Alte Instanzen wegraeumen, damit beim Start immer die neueste Version laeuft ---
if (-not $EmbeddedHost) { try {
  # Alte Bridge auf Port 18081 beenden (nicht sich selbst) -> Port wird frei.
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -ne $PID } |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
} catch {} }
if (-not $EmbeddedHost) { try {
  # Sicherheitsnetz: alte EmoteRainBridge-Prozesse beenden (nicht sich selbst).
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*EmoteRainBridge.ps1*' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {} }
if (-not $EmbeddedHost) { try {
  # Alten Waechter beenden (gleich startet ein frischer).
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*OverlayWatchdog.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {} }
if (-not $EmbeddedHost) { try {
  # WICHTIG: alte Bridge-Instanz(en) beenden (NICHT sich selbst). Sonst haelt die alte
  # Bridge den Port 18081, die neue kann ihn nicht binden und beendet sich -> es laeuft
  # weiter ALTER Code (z.B. ohne groupTrigger). So uebernimmt ein Neustart zuverlaessig
  # den frischen Code.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*EmoteRainBridge.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
} catch {} }
if (-not $EmbeddedHost) { try {
  # Alte Overlay-EXEs beenden, die VOR dieser Bridge gestartet wurden. Das neue
  # Overlay startet nach der Bridge und bleibt. Verhindert doppelte Fenster ->
  # sonst reagieren zwei Overlays auf denselben Trigger (mehrfaches Abspielen).
  $bridgeStart = (Get-Process -Id $PID -ErrorAction SilentlyContinue).StartTime
  if ($bridgeStart) {
    $cutoff = $bridgeStart.AddSeconds(-10)
    Get-Process -Name 'HtmlWindowsOverlayModern', 'HtmlWindowsOverlay' -ErrorAction SilentlyContinue |
      Where-Object { $_.StartTime -and $_.StartTime -lt $cutoff } |
      ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  }
} catch {} }
Start-Sleep -Milliseconds 500

# Auf ALLEN IPv4-Adressen lauschen (0.0.0.0) statt nur 127.0.0.1 -> auch im LAN erreichbar
# (z. B. Handy/anderer PC unter 192.168.x.x:$Port). Enthaelt weiterhin 127.0.0.1.
# Aenderungen bleiben durch das Kontroll-Token geschuetzt (Test-ControlToken).
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
$bridgeStarted = $false
for ($startTry = 0; $startTry -lt 12; $startTry++) {
  try { $listener.Start(); $bridgeStarted = $true; break }
  catch { Start-Sleep -Milliseconds 400; $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port) }
}
if (-not $bridgeStarted) {
  Write-Host "EmoteRainBridge konnte Port $Port nicht starten."
  exit 0
}

Write-Host "EmoteRainBridge laeuft auf http://127.0.0.1:$Port/"

# Lokalen WebSocket-Relay-Proxy starten (fuer HTTPS-Overlays wie ChatRD, die kein
# ws:// zur LAN-IP duerfen). Best effort - schlaegt es fehl, laeuft der Rest weiter.
Start-WsRelayProxy

# Zusaetzlich auf IPv6-Loopback (::1) lauschen. Grund: "localhost" wird unter Windows
# oft zuerst ueber IPv6 (::1) aufgeloest; lauscht dort nichts, entsteht beim Twitch-Login
# ueber localhost eine spuerbare Wartezeit. Best effort - klappt es nicht, laeuft alles
# wie bisher nur ueber IPv4 (127.0.0.1) weiter. ::1 ist wie 127.0.0.1 rein lokal.
$listener6 = $null
try {
  $listener6 = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::IPv6Loopback, $Port)
  $listener6.Start()
  Write-Host "EmoteRainBridge lauscht zusaetzlich auf http://[::1]:$Port/ (localhost schneller)"
} catch {
  $listener6 = $null
}

# Waechter starten: beendet die Bridge, sobald die Overlay-EXE geschlossen wird.
# So laeuft der Waechter automatisch mit - egal ob per Start-Overlay.exe oder .bat.
if (-not $EmbeddedHost) { try {
  $wd = Join-Path $PSScriptRoot 'OverlayWatchdog.ps1'
  if (Test-Path -LiteralPath $wd) {
    Start-Process powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $wd + '"') -WindowStyle Hidden
  }
} catch {} }

# Lebenszeichen des Overlays: es meldet sich per POST /heartbeat. Bleibt das ~15s aus
# (Overlay/EXE geschlossen), raeumt die Bridge auf und beendet sich selbst - zusaetzliches
# Sicherheitsnetz UNABHAENGIG vom OverlayWatchdog (gegen haengende Prozesse).
$OverlayBeatLast    = 0
$OverlaySeen        = $false
$HeartbeatTimeoutMs = 15000
$HeartbeatNextCheck = 0
$OverlaySbConnected = $false   # zuletzt gemeldeter Streamer.bot-Verbindungsstatus des Host-Overlays
$OverlaySbAt        = 0        # Zeitpunkt der Meldung (fuer "frisch?"-Pruefung)
$OverlayViewportWidth  = 0     # echte CSS-Viewportbreite der Overlay-WebView (DPI/Zoom bereits enthalten)
$OverlayViewportHeight = 0
$OverlayDevicePixelRatio = 1.0

# Angenommene, aber noch STUMME Verbindungen: Browser oeffnen "Vorrats"-Sockets (Preconnect),
# auf denen erst spaeter (oder nie) eine Anfrage kommt. Ein blockierendes ReadLine darauf wuerde
# die EINFAEDIGE Bridge fuer ALLE Klienten einfrieren (tote Knoepfe/Verzoegerungen) -> solche
# Sockets werden hier geparkt und nebenbei geprueft, statt zu blockieren.
$ParkedClients = New-Object System.Collections.Generic.List[object]

while ($true) {
  $client = $null
  $stream = $null
  try {
    # 0) Geparkte Verbindungen: Daten eingetroffen -> jetzt verarbeiten; zu lange stumm/tot -> weg.
    for ($pi = $ParkedClients.Count - 1; $pi -ge 0; $pi--) {
      $pk = $ParkedClients[$pi]
      $drop = $false
      try {
        if (Test-HttpHeaderAvailable -Client $pk.Client) { $client = $pk.Client; $stream = $pk.Stream; $ParkedClients.RemoveAt($pi); break }
        if (((Get-NowMilliseconds) -gt $pk.Deadline) -or (-not $pk.Client.Connected)) { $drop = $true }
      } catch { $drop = $true }
      if ($drop) { try { $pk.Client.Close() } catch {}; $ParkedClients.RemoveAt($pi) }
    }

    if ($null -eq $client) {
    # Beide Listener (IPv4 0.0.0.0 + IPv6 ::1) nicht-blockierend abfragen.
    if ($listener.Pending()) {
      $client = $listener.AcceptTcpClient()
    } elseif ($null -ne $listener6 -and $listener6.Pending()) {
      $client = $listener6.AcceptTcpClient()
    } else {
      Start-Sleep -Milliseconds 8
      # Lebenszeichen-Check (gedrosselt ~alle 2s): kommt vom Overlay ~15s nichts mehr,
      # ist es geschlossen -> aufraeumen und Bridge beenden.
      $hbNow = Get-NowMilliseconds
      if ($hbNow -ge $HeartbeatNextCheck) {
        $HeartbeatNextCheck = $hbNow + 2000
        # Direkt am EXE-Prozess erkennen, ob das Overlay noch laeuft - zuverlaessiger als
        # nur der Heartbeat und faengt auch haengende WebView2-Reste, die noch rendern.
        $exeAlive = if ($EmbeddedHost) { $true } else { [bool](Get-Process -Name 'HtmlWindowsOverlayModern','HtmlWindowsOverlay' -ErrorAction SilentlyContinue) }
        if ($exeAlive) { $OverlaySeen = $true }
        # Heartbeat-Ausfall nur werten, wenn ueberhaupt schon welche kamen (alte Overlay-
        # Version ohne Heartbeat-Skript soll nicht faelschlich beendet werden).
        $beatStale = ($OverlayBeatLast -gt 0 -and (($hbNow - $OverlayBeatLast) -gt $HeartbeatTimeoutMs))
        if ((-not $EmbeddedHost) -and $OverlaySeen -and ((-not $exeAlive) -or $beatStale)) {
          Stop-KappiOverlayProcesses
          break
        }
      }
      continue
    }
    # Sicherheits-Timeouts fuer Request-Body/Antwort. Unvollstaendige HTTP-Header werden
    # darunter vor jedem ReadLine nicht-blockierend erkannt und weiter geparkt.
    try { $client.ReceiveTimeout = 3000; $client.SendTimeout = 10000; $client.NoDelay = $true } catch {}
    # IP-Freigabe pruefen: nicht freigegebene Geraete bekommen eine verstaendliche 403-Antwort
    # (statt eines nackten Verbindungsresets) und werden dann getrennt. Loopback + die eigenen
    # Adressen dieses PCs sind immer erlaubt.
    $remoteIp = ''
    try { $remoteIp = $client.Client.RemoteEndPoint.Address.ToString() } catch {}
    if (-not (Test-IpAllowed $remoteIp)) {
      try { Write-HttpResponse -Stream $client.GetStream() -StatusCode 403 -Reason 'Forbidden' -Body ('{"ok":false,"error":"Dieses Geraet ist nicht freigegeben (Einstellungen -> Verbindungen -> Erlaubte Geraete).","ip":"' + (Escape-JsonString ($remoteIp -replace '^::ffff:', '')) + '"}') } catch {}
      try { $client.Close() } catch {}
      $client = $null
      continue
    }

    $stream = $client.GetStream()
    # Erst lesen, wenn CRLF CRLF komplett im Socket liegt. DataAvailable allein reicht
    # bei teilweise gesendeten Browser-Preconnects nicht und verursachte 3s-Stalls.
    if (-not (Test-HttpHeaderAvailable -Client $client)) {
      Start-Sleep -Milliseconds 4
      if (-not (Test-HttpHeaderAvailable -Client $client)) {
        $ParkedClients.Add([pscustomobject]@{ Client = $client; Stream = $stream; Deadline = ((Get-NowMilliseconds) + 6000) })
        $client = $null
        continue
      }
    }
    } else {
      # Geparkter Client ist aktiv geworden: Absender-IP (fuer /allowed-ips) neu bestimmen.
      $remoteIp = ''
      try { $remoteIp = $client.Client.RemoteEndPoint.Address.ToString() } catch {}
    }

    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $false, 4096, $true)

    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
      Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false}'
      continue
    }

    $parts = $requestLine.Split(' ')
    $method = if ($parts.Length -gt 0) { $parts[0].ToUpperInvariant() } else { '' }
    $path = if ($parts.Length -gt 1) { $parts[1].Split('?')[0] } else { '/' }
    $rawUrl = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
    $headers = @{}

    while ($true) {
      $line = $reader.ReadLine()
      if ($null -eq $line -or $line -eq '') { break }
      $idx = $line.IndexOf(':')
      if ($idx -gt 0) {
        $headers[$line.Substring(0, $idx).Trim().ToLowerInvariant()] = $line.Substring($idx + 1).Trim()
      }
    }

    $contentLength = 0
    if ($headers.ContainsKey('content-length')) {
      [void][int]::TryParse($headers['content-length'], [ref]$contentLength)
    }

    if ($method -eq 'OPTIONS') {
      Write-HttpResponse -Stream $stream -StatusCode 204 -Reason 'No Content' -Body '' -ContentType 'text/plain'
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/overlay-settings' -or $path -eq '/overlay-settings.html')) {
      Write-SettingsPageResponse -Stream $stream -Path $SettingsPagePath
      continue
    }

    if ($method -eq 'GET' -and $path -eq '/overlay-config.js') {
      Write-StaticFileResponse -Stream $stream -Path (Join-Path $AppRoot 'overlay-config.js') -ContentType 'text/javascript'
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/video-delete' -or $path -eq '/overlay/video-delete')) {
      if (-not (Test-ControlToken -Headers $headers)) {
        Write-HttpResponse -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body '{"ok":false,"error":"forbidden"}'
        continue
      }
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $rel = if ($incoming -and $incoming.sourceFile) { [string]$incoming.sourceFile } elseif ($incoming -and $incoming.videoPath) { [string]$incoming.videoPath } else { '' }
        if ([string]::IsNullOrWhiteSpace($rel)) { throw 'kein Pfad' }
        $contentRoot = [System.IO.Path]::GetFullPath(($ContentRoot)).TrimEnd('\', '/')
        $sep = [System.IO.Path]::DirectorySeparatorChar
        $abs = [System.IO.Path]::GetFullPath((Join-Path $contentRoot ($rel.Replace('/', $sep))))
        # SICHERHEIT: Ziel MUSS strikt innerhalb von Content liegen - sonst nichts loeschen.
        if (-not $abs.StartsWith($contentRoot + $sep, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'ausserhalb Content' }
        $folder = Split-Path -Parent $abs
        $relFolder = $folder.Substring($contentRoot.Length).Trim($sep).Trim('/')
        $segs = @($relFolder -split '[\\/]+' | Where-Object { $_ })
        $deletedWhat = 'nichts'
        # Effekt-Video liegt in Content\<Gruppe>\<Video>\ (>=2 Ebenen tief) -> ganzen Video-Ordner loeschen.
        # Nie Content selbst oder einen Gruppen-Ordner (1 Ebene) loeschen.
        if ($segs.Count -ge 2 -and $folder.StartsWith($contentRoot + $sep, [System.StringComparison]::OrdinalIgnoreCase)) {
          if (Test-Path -LiteralPath $folder -PathType Container) { Remove-Item -LiteralPath $folder -Recurse -Force; $deletedWhat = 'folder' }
        } else {
          # Sonst (z.B. uploads\x.mp4) nur die einzelne Datei loeschen, nicht den Ordner.
          if (Test-Path -LiteralPath $abs -PathType Leaf) { Remove-Item -LiteralPath $abs -Force; $deletedWhat = 'file' }
        }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ('{"ok":true,"deleted":"' + $deletedWhat + '"}')
      } catch {
        $m = ([string]$_.Exception.Message).Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body ('{"ok":false,"error":"' + $m + '"}')
      }
      continue
    }

    if ($method -eq 'GET' -and $path -eq '/emote-rain-extended.js') {
      Write-StaticFileResponse -Stream $stream -Path (Join-Path $AppRoot 'emote-rain-extended.js') -ContentType 'text/javascript'
      continue
    }

    # Gemeinsame Emoji-Regen-Animation (auch fuer die Kontrollpanel-Vorschau).
    if ($method -eq 'GET' -and ($path -eq '/emote-rain-anim.js' -or $path.StartsWith('/emote-rain-anim.js?', [System.StringComparison]::OrdinalIgnoreCase))) {
      Write-StaticFileResponse -Stream $stream -Path (Join-Path $AppRoot 'emote-rain-anim.js') -ContentType 'text/javascript'
      continue
    }

    # Dateilose Vorschau bekannter Anbieter. Der Query-String bleibt in der
    # Browser-Adresse erhalten, damit ChatRD/Tawmae ihre Streamer.bot-Parameter
    # wie beim Original-Link aus window.location.search lesen koennen.
    if ($method -eq 'GET' -and $path.StartsWith('/external-preview/', [System.StringComparison]::OrdinalIgnoreCase)) {
      $previewKind = $path.Substring('/external-preview/'.Length).Trim('/').ToLowerInvariant()
      Write-ExternalPreviewResponse -Stream $stream -Kind $previewKind
      continue
    }

    # index.html liegt jetzt in app/, wird aber weiter unter /content/index.html
    # ausgeliefert, damit der relative Basis-Pfad (/content/) fuer die 82 Video-Module
    # und die Effekt-Skripte korrekt bleibt.
    if ($method -eq 'GET' -and ($path -eq '/content/index.html' -or $path.StartsWith('/content/index.html?', [System.StringComparison]::OrdinalIgnoreCase))) {
      Write-BinaryFileResponse -Stream $stream -Path (Join-Path $AppRoot 'index.html') -Headers $headers
      continue
    }

    if ($method -eq 'GET' -and $path.StartsWith('/content/', [System.StringComparison]::OrdinalIgnoreCase)) {
      $contentRoot = [System.IO.Path]::GetFullPath(($ContentRoot)).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
      $relativePath = [System.Uri]::UnescapeDataString($path.Substring(9)).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $contentRoot $relativePath))
      if (-not $candidatePath.StartsWith($contentRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-HttpResponse -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body '{"ok":false,"error":"forbidden"}'
      } else {
        Write-BinaryFileResponse -Stream $stream -Path $candidatePath -Headers $headers
      }
      continue
    }

    # Overlay-Code liegt jetzt AUSSERHALB von Content (Projekt-Root\app). Eigene Route
    # mit Traversal-Schutz, damit index.html seine Skripte per /app/<datei> laden kann.
    if ($method -eq 'GET' -and $path.StartsWith('/app/', [System.StringComparison]::OrdinalIgnoreCase)) {
      $appRootFull = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
      $relativePath = [System.Uri]::UnescapeDataString($path.Substring(5)).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $appRootFull $relativePath))
      if (-not $candidatePath.StartsWith($appRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-HttpResponse -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body '{"ok":false,"error":"forbidden"}'
      } else {
        Write-BinaryFileResponse -Stream $stream -Path $candidatePath -Headers $headers
      }
      continue
    }

    if ($method -eq 'GET' -and $path -eq '/health') {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body '{"ok":true}'
      continue
    }

    if ($method -eq 'GET' -and $path -eq '/position-preview-ack') {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ($positionPreviewAck | ConvertTo-Json -Depth 4 -Compress)
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/external-links' -or $path -eq '/overlay/external-links')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-ExternalLinksJson)
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/video-overlays' -or $path -eq '/overlay/video-overlays')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Get-VideoOverlaysJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/video-overlays' -or $path -eq '/overlay/video-overlays')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-VideoOverlaysJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/video-upload' -or $path -eq '/overlay/video-upload')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Save-UploadedVideo $body)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/image-rename' -or $path -eq '/overlay/image-rename')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Rename-UploadedFile $body)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/image-move' -or $path -eq '/overlay/image-move')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Move-ImagesToGroup $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/image-group-rename' -or $path -eq '/overlay/image-group-rename')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Rename-ImageGroupFolder $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/image-group-delete' -or $path -eq '/overlay/image-group-delete')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Remove-ImageGroupFolder $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/video-pause' -or $path -eq '/overlay/video-pause')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (([ordered]@{ ok = $true; paused = (Read-VideoPaused) } | ConvertTo-Json -Compress))
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/video-pause' -or $path -eq '/overlay/video-pause')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $p = if ($null -ne $incoming -and $null -ne $incoming.paused) { [System.Convert]::ToBoolean($incoming.paused) } else { $false }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-VideoPaused $p)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/overlay-layers' -or $path -eq '/overlay/overlay-layers')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-OverlayLayersJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/overlay-layers' -or $path -eq '/overlay/overlay-layers')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-OverlayLayersJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/image-overlays' -or $path -eq '/overlay/image-overlays')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-ImageOverlaysJson)
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/autostart' -or $path -eq '/overlay/autostart')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Build-AutostartJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/heartbeat' -or $path -eq '/overlay/heartbeat')) {
      $hbBody = if ($contentLength -gt 0) { Read-RequestBody -Reader $reader -Length $contentLength } else { '' }
      $OverlayBeatLast = Get-NowMilliseconds
      $OverlaySeen = $true
      # SB-Verbindungsstatus des Host-Overlays merken (fuer /host-status auf jedem PC).
      try {
        $hb = if ([string]::IsNullOrWhiteSpace($hbBody)) { $null } else { $hbBody | ConvertFrom-Json -ErrorAction Stop }
        if ($null -ne $hb -and $null -ne $hb.sbConnected) { $OverlaySbConnected = [bool]$hb.sbConnected; $OverlaySbAt = $OverlayBeatLast }
        if ($null -ne $hb -and $null -ne $hb.viewportWidth) {
          $vw = 0
          if ([int]::TryParse(([string]$hb.viewportWidth), [ref]$vw) -and $vw -ge 100 -and $vw -le 20000) { $OverlayViewportWidth = $vw }
        }
        if ($null -ne $hb -and $null -ne $hb.viewportHeight) {
          $vh = 0
          if ([int]::TryParse(([string]$hb.viewportHeight), [ref]$vh) -and $vh -ge 100 -and $vh -le 20000) { $OverlayViewportHeight = $vh }
        }
        if ($null -ne $hb -and $null -ne $hb.devicePixelRatio) {
          $dpr = 0.0
          if ([double]::TryParse(([string]$hb.devicePixelRatio), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$dpr) -and $dpr -ge 0.5 -and $dpr -le 8.0) { $OverlayDevicePixelRatio = $dpr }
        }
      } catch {}
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body '{"ok":true}'
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/host-status' -or $path -eq '/overlay/host-status')) {
      $nowMs = Get-NowMilliseconds
      $age = if ($OverlaySbAt -gt 0) { [int64]($nowMs - $OverlaySbAt) } else { -1 }
      $fresh = ($OverlaySbAt -gt 0 -and $age -ge 0 -and $age -lt $HeartbeatTimeoutMs)   # Overlay meldet sich noch?
      $conn = ($fresh -and $OverlaySbConnected)
      $dprJson = $OverlayDevicePixelRatio.ToString([Globalization.CultureInfo]::InvariantCulture)
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ('{"ok":true,"overlayRunning":' + $(if ($fresh) { 'true' } else { 'false' }) + ',"sbConnected":' + $(if ($conn) { 'true' } else { 'false' }) + ',"ageMs":' + $age + ',"viewportWidth":' + $OverlayViewportWidth + ',"viewportHeight":' + $OverlayViewportHeight + ',"devicePixelRatio":' + $dprJson + '}')
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/allowed-ips' -or $path -eq '/overlay/allowed-ips')) {
      $list = Read-AllowedIps
      $parts = @(); foreach ($i in @($list)) { $parts += ('"' + (Escape-JsonString ([string]$i)) + '"') }
      $cip = ''; try { $cip = ($remoteIp -replace '^::ffff:', '') } catch {}
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ('{"ok":true,"ips":[' + ($parts -join ',') + '],"clientIp":"' + (Escape-JsonString $cip) + '"}')
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/allowed-ips' -or $path -eq '/overlay/allowed-ips')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $clean = @()
        if ($null -ne $incoming -and $null -ne $incoming.ips) {
          foreach ($i in @($incoming.ips)) {
            $s = (([string]$i).Trim() -replace '^::ffff:', '')
            if ($s -match '^[0-9A-Fa-f:.]{3,45}$' -and ($clean -notcontains $s)) { $clean += $s }
          }
        }
        $partsF = @(); foreach ($i in $clean) { $partsF += ('"' + (Escape-JsonString $i) + '"') }
        $json = '{"ips":[' + ($partsF -join ',') + ']}'
        $dir = Split-Path -Parent $AllowedIpsPath
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Set-Content -LiteralPath $AllowedIpsPath -Value $json -Encoding UTF8
        $script:AllowedIpsMt = -1   # Cache beim naechsten Read neu laden
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ('{"ok":true,"ips":[' + ($partsF -join ',') + ']}')
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/autostart' -or $path -eq '/overlay/autostart')) {
      if (-not (Test-LocalOrigin -Headers $headers)) {
        Write-HttpResponse -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body '{"ok":false,"error":"forbidden origin"}'
        continue
      }
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $en = ($null -ne $incoming -and $incoming.enabled -eq $true)
        $changed = Set-AutostartState -Enabled $en
        if ($changed) { Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Build-AutostartJson) }
        else { Write-HttpResponse -Stream $stream -StatusCode 500 -Reason 'Internal Server Error' -Body '{"ok":false,"error":"autostart update failed"}' }
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/monitors' -or $path -eq '/overlay/monitors')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Get-MonitorsJson)
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/overlay-monitor' -or $path -eq '/overlay/overlay-monitor')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-OverlayMonitorJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/overlay-monitor' -or $path -eq '/overlay/overlay-monitor')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-OverlayMonitorJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/pause-hotkey' -or $path -eq '/overlay/pause-hotkey')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-PauseHotkeyJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/pause-hotkey' -or $path -eq '/overlay/pause-hotkey')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-PauseHotkeyJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/ui-state' -or $path -eq '/overlay/ui-state')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-UiStateJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/ui-state' -or $path -eq '/overlay/ui-state')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      # Delta-Merge {"set":{...},"del":[...]} statt Ersetzen -> mehrere Tabs ueberschreiben sich nicht.
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Merge-UiStateJson $body)
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/websocket-config' -or $path -eq '/overlay/websocket-config')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-WebSocketConfigJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/websocket-config' -or $path -eq '/overlay/websocket-config')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-WebSocketConfigJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/backgrounds' -or $path -eq '/overlay/backgrounds')) {
      $bgGroup = ''
      $qm = $rawUrl.IndexOf('?')
      if ($qm -ge 0) {
        foreach ($kv in $rawUrl.Substring($qm + 1).Split('&')) {
          $pair = $kv.Split('=', 2)
          if ($pair.Length -eq 2 -and $pair[0] -eq 'group') { try { $bgGroup = [System.Uri]::UnescapeDataString($pair[1]) } catch { $bgGroup = $pair[1] } }
        }
      }
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-BackgroundsJson $bgGroup)
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/excluded-apps' -or $path -eq '/overlay/excluded-apps')) {
      # Heissester Endpunkt (Overlay pollt alle 150ms; kostet Get-Process + Datei-Lesen).
      # Ergebnis ~120ms cachen: entlastet die einfaedige Bridge, bleibt praktisch Echtzeit.
      $exclNow = Get-NowMilliseconds
      if (($null -eq $script:ExclCacheAt) -or (($exclNow - $script:ExclCacheAt) -gt 120)) {
        $script:ExclCacheJson = Build-ExcludedAppsJson
        $script:ExclCacheAt = $exclNow
      }
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body $script:ExclCacheJson
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/excluded-apps' -or $path -eq '/overlay/excluded-apps')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $script:ExclCacheAt = $null   # Cache verwerfen -> Aenderung wirkt sofort
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-ExcludedApps $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/cheatsheet' -or $path -eq '/overlay/cheatsheet')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-CheatsheetJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/cheatsheet' -or $path -eq '/overlay/cheatsheet')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-CheatsheetJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/running-processes' -or $path -eq '/overlay/running-processes')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Get-RunningProcessesJson)
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/overlay-instance' -or $path -eq '/overlay/overlay-instance')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ('{"ok":true,"id":"' + (Escape-JsonString $script:OverlayInstanceId) + '"}')
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/overlay-instance' -or $path -eq '/overlay/overlay-instance')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $newId = if ($null -ne $incoming -and $null -ne $incoming.id) { ([string]$incoming.id).Trim() } else { '' }
        if ($newId) { $script:OverlayInstanceId = $newId }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ('{"ok":true,"id":"' + (Escape-JsonString $script:OverlayInstanceId) + '"}')
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/image-overlays' -or $path -eq '/overlay/image-overlays')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-ImageOverlaysJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/emote-rain-users' -or $path -eq '/overlay/emote-rain-users')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-EmoteRainUsersJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/emote-rain-users' -or $path -eq '/overlay/emote-rain-users')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-EmoteRainUsersJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/organize-groups' -or $path -eq '/overlay/organize-groups')) {
      if (-not (Test-ControlToken -Headers $headers)) {
        Write-HttpResponse -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body '{"ok":false,"error":"forbidden"}'
        continue
      }
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Invoke-GroupOrganizer $incoming)
      } catch {
        $message = ([string]$_.Exception.Message).Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
        Write-HttpResponse -Stream $stream -StatusCode 500 -Reason 'Internal Server Error' -Body ('{"ok":false,"error":"' + $message + '"}')
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/trigger-video' -or $path -eq '/overlay/trigger-video')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ($videoTrigger | ConvertTo-Json -Compress)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/trigger-video' -or $path -eq '/overlay/trigger-video')) {
      if (-not (Test-ControlToken -Headers $headers)) {
        Write-HttpResponse -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body '{"ok":false,"error":"forbidden"}'
        continue
      }
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $triggerId = if ($null -ne $incoming) { [string]$incoming.id } else { '' }
        $nextToken = [int64]$videoTrigger.token + 1
        $videoTrigger = [ordered]@{
          ok = $true
          id = $triggerId
          token = $nextToken
          updatedAt = Get-NowMilliseconds
        }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ($videoTrigger | ConvertTo-Json -Compress)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/emote-rain-test' -or $path -eq '/overlay/emote-rain-test')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ($emoteRainTest | ConvertTo-Json -Compress)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/emote-rain-test' -or $path -eq '/overlay/emote-rain-test')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $testName = if ($null -ne $incoming) { [string]$incoming.name } else { '' }
        $emoteRainTest = [ordered]@{ ok = $true; name = $testName; token = ([int64]$emoteRainTest.token + 1); updatedAt = Get-NowMilliseconds }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ($emoteRainTest | ConvertTo-Json -Compress)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/external-links' -or $path -eq '/overlay/external-links')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Write-ExternalLinksJson $incoming)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'POST' -and $path -eq '/position-preview-ack') {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $positionPreviewAck = [ordered]@{
          ok = $true
          seen = $true
          frames = Clamp-Int -Value $incoming.frames -Fallback 0 -Min 0 -Max 100
          scriptVersion = [string]$incoming.scriptVersion
          width = Clamp-Int -Value $incoming.width -Fallback 0 -Min 0 -Max 20000
          height = Clamp-Int -Value $incoming.height -Fallback 0 -Min 0 -Max 20000
          updatedAt = Get-NowMilliseconds
        }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body ($positionPreviewAck | ConvertTo-Json -Depth 4 -Compress)
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and $path -eq '/overlay/status') {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Get-OverlayStatusJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/overlay/start' -or $path -eq '/overlay/stop')) {
      if (-not (Test-ControlToken -Headers $headers)) {
        Write-HttpResponse -Stream $stream -StatusCode 403 -Reason 'Forbidden' -Body '{"ok":false,"error":"forbidden"}'
        continue
      }
      try {
        $overlayStatus = if ($path -eq '/overlay/start') { Start-OverlayProcess } else { Stop-OverlayProcess }
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body $overlayStatus
      } catch {
        $message = ([string]$_.Exception.Message).Replace('\', '\\').Replace('"', '\"').Replace("`r", ' ').Replace("`n", ' ')
        Write-HttpResponse -Stream $stream -StatusCode 500 -Reason 'Internal Server Error' -Body ('{"ok":false,"error":"' + $message + '"}')
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/settings' -or $path -eq '/emote-rain-settings' -or $path -eq '/emote-rain-settings.json')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-SettingsJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/settings' -or $path -eq '/emote-rain-settings' -or $path -eq '/emote-rain-settings.json')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $json = Write-SettingsJson $incoming
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body $json
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    if ($method -eq 'GET' -and ($path -eq '/position-preview' -or $path -eq '/overlay/position-preview')) {
      Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body (Read-PositionPreviewJson)
      continue
    }

    if ($method -eq 'POST' -and ($path -eq '/position-preview' -or $path -eq '/overlay/position-preview')) {
      $body = Read-RequestBody -Reader $reader -Length $contentLength
      try {
        $incoming = if ([string]::IsNullOrWhiteSpace($body)) { $null } else { $body | ConvertFrom-Json -ErrorAction Stop }
        $json = Write-PositionPreviewJson $incoming
        Write-HttpResponse -Stream $stream -StatusCode 200 -Reason 'OK' -Body $json
      } catch {
        Write-HttpResponse -Stream $stream -StatusCode 400 -Reason 'Bad Request' -Body '{"ok":false,"error":"invalid json"}'
      }
      continue
    }

    Write-HttpResponse -Stream $stream -StatusCode 404 -Reason 'Not Found' -Body '{"ok":false,"error":"not found"}'
  } catch {
    if ($client -and $client.Connected) {
      try {
        Write-HttpResponse -Stream $client.GetStream() -StatusCode 500 -Reason 'Internal Server Error' -Body '{"ok":false}'
      } catch {}
    }
  } finally {
    if ($client) { $client.Close() }
  }
}
