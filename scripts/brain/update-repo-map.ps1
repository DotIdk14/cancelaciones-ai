[CmdletBinding()]
param(
  [ValidateSet('Check', 'Update', 'Watch', 'Stop')]
  [string]$Mode = 'Check',
  [switch]$Force,
  [int]$DebounceSeconds = 7,
  [ValidateRange(250, 10000)]
  [int]$PollMilliseconds = 1500,
  [string]$AiderPythonPath
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

function Find-RepositoryRoot {
  $candidate = $PSScriptRoot
  while ($candidate) {
    if ((Test-Path (Join-Path $candidate '.git')) -and (Test-Path (Join-Path $candidate 'package.json'))) {
      return (Resolve-Path $candidate).Path
    }
    $parent = Split-Path $candidate -Parent
    if (!$parent -or $parent -eq $candidate) { break }
    $candidate = $parent
  }
  throw 'No encontré la raíz del repositorio desde scripts/brain.'
}

$script:RepoRoot = Find-RepositoryRoot
$script:GitDir = (& git -C $script:RepoRoot rev-parse --absolute-git-dir).Trim()
if ($LASTEXITCODE -ne 0 -or !$script:GitDir) { throw 'No se pudo resolver el directorio Git.' }
$script:MapPath = Join-Path $script:RepoRoot 'docs/brain/repo-map.md'
$script:SuccessStatePath = Join-Path $script:GitDir 'repo-map-success.json'
$script:AttemptStatePath = Join-Path $script:GitDir 'repo-map-attempt.json'
$script:LogPath = Join-Path $script:GitDir 'repo-map-update.log'
$script:UpdateLockPath = Join-Path $script:GitDir 'repo-map-update.lock'
$script:WatchLockPath = Join-Path $script:GitDir 'repo-map-watch.lock'
$script:WatchStopPath = Join-Path $script:GitDir 'repo-map-watch.stop'

function Write-Status([string]$Message) {
  $line = '{0} {1}{2}' -f [DateTimeOffset]::Now.ToString('o'), $Message, [Environment]::NewLine
  [System.IO.File]::AppendAllText($script:LogPath, $line, $Utf8NoBom)
  Write-Host $Message
}

function Get-FileDigest([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
  }
  finally { $stream.Dispose() }
}

function Test-IgnoredPath([string]$RelativePath) {
  $p = $RelativePath.Replace('\', '/').ToLowerInvariant()
  $segments = $p.Split('/')
  $ignoredDirectories = @('.git', 'node_modules', 'dist', 'build', '.next', '.vite', '.cache', 'coverage', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.vercel', '.worktrees', '.serena', '.impeccable', '.superpowers')
  if ($p -eq 'docs/brain' -or $p.StartsWith('docs/brain/')) { return $true }
  foreach ($segment in $segments) {
    if ($ignoredDirectories -contains $segment) { return $true }
    if ($segment -like '.env*' -or $segment -like '*.pem' -or $segment -like '*.key' -or $segment -like '*credential*' -or $segment -like 'secrets.*') { return $true }
  }
  if ($p -match '(^|/)(secrets?|private|credentials?)(/|$)' -or $p -match '\.(tmp|temp|swp|swo|bak|orig|log)$') { return $true }
  return $false
}

function Get-RepositoryFingerprint {
  $files = [System.Collections.Generic.List[string]]::new()
  $listedFiles = @(& git -C $script:RepoRoot ls-files --cached --others --exclude-standard 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "git ls-files falló: $($listedFiles -join ' ')" }
  foreach ($entry in $listedFiles) {
    $relative = ([string]$entry).Replace('\', '/')
    if (!$relative -or (Test-IgnoredPath $relative)) { continue }
    $fullPath = Join-Path $script:RepoRoot $relative
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) { $files.Add($relative) }
  }
  $files.Sort([StringComparer]::OrdinalIgnoreCase)
  $parts = [System.Collections.Generic.List[string]]::new()
  foreach ($relative in $files) {
    $fullPath = Join-Path $script:RepoRoot $relative
    $parts.Add("$relative`0$(Get-FileDigest $fullPath)")
  }

  $branch = (& git -C $script:RepoRoot symbolic-ref --quiet --short HEAD 2>$null)
  if ($LASTEXITCODE -ne 0) { $branch = 'DETACHED' }
  $head = (& git -C $script:RepoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer HEAD.' }
  $parts.Add("GIT-BRANCH`0$branch")
  $parts.Add("GIT-HEAD`0$head")
  foreach ($marker in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply', 'sequencer')) {
    $markerPath = Join-Path $script:GitDir $marker
    if (Test-Path $markerPath) {
      if ((Get-Item $markerPath).PSIsContainer) { $parts.Add("GIT-OP`0$marker`0active") }
      else { $parts.Add("GIT-OP`0$marker`0$(Get-FileDigest $markerPath)") }
    }
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($parts -join "`n"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  return [pscustomobject]@{ Fingerprint = $hash; Branch = $branch; Head = $head; Files = $files.Count }
}

function Read-State([string]$Path) {
  if (!(Test-Path $Path)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) }
  catch { Write-Status "WARN estado ilegible '$Path': $($_.Exception.Message)"; return $null }
}

function Save-State([string]$Path, $State) {
  $json = $State | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($Path, $json + "`n", $Utf8NoBom)
}

function Get-AiderPython {
  if ($AiderPythonPath) { return $AiderPythonPath }
  $toolDir = (& uv tool dir).Trim()
  if ($LASTEXITCODE -ne 0 -or !$toolDir) { throw 'uv tool dir falló; instala Aider con uv tool install aider-chat.' }
  $python = Join-Path $toolDir 'aider-chat\Scripts\python.exe'
  if (!(Test-Path $python)) { throw "No encontré el Python de Aider en '$python'." }
  return $python
}

function Quote-WindowsArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $escaped = [System.Text.RegularExpressions.Regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [System.Text.RegularExpressions.Regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Enter-FileLock([string]$Path, [int]$WaitSeconds = 0) {
  $deadline = [DateTimeOffset]::Now.AddSeconds($WaitSeconds)
  do {
    try { return [System.IO.File]::Open($Path, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) }
    catch [System.IO.IOException] {
      if ([DateTimeOffset]::Now -ge $deadline) { return $null }
      Start-Sleep -Milliseconds 250
    }
  } while ($true)
}

function Invoke-MapUpdate {
  $script:UpdateLockBusy = $false
  $waitForUpdate = if ($script:AllowFailedRetry) { 30 } else { 0 }
  $lock = Enter-FileLock $script:UpdateLockPath $waitForUpdate
  if (!$lock) { $script:UpdateLockBusy = $true; Write-Status 'SKIP ya existe una actualización en curso.'; return $false }
  $tempRoot = Join-Path $env:TEMP ('repo-map-' + [guid]::NewGuid().ToString('N'))
  $outPath = "$tempRoot.out"
  $errPath = "$tempRoot.err"
  $ignorePath = "$tempRoot.ignore"
  try {
    $current = Get-RepositoryFingerprint
    $lastSuccess = Read-State $script:SuccessStatePath
    $lastAttempt = Read-State $script:AttemptStatePath
    if (!$Force -and $lastSuccess -and $lastSuccess.fingerprint -eq $current.Fingerprint) {
      Write-Status "FRESH rama=$($current.Branch) archivos=$($current.Files) fingerprint=$($current.Fingerprint.Substring(0,12))"
      return $true
    }
    if (!$Force -and !$script:AllowFailedRetry -and $lastAttempt -and $lastAttempt.fingerprint -eq $current.Fingerprint -and $lastAttempt.status -eq 'ERROR') {
      Write-Status "SKIP Aider ya falló para esta huella; se reintentará al cambiar el repositorio o al iniciar Check."
      return $false
    }

    $aiderPython = Get-AiderPython
    if (!(Test-Path (Split-Path $script:MapPath -Parent))) { New-Item -ItemType Directory -Path (Split-Path $script:MapPath -Parent) -Force | Out-Null }
    $ignoreLines = @('docs/brain/**', '**/.env*', '.env*', '.insforge/**', '.vercel/**', '**/*.pem', '**/*.key', '**/*secret*', '**/*credential*', '**/*token*', '**/private/**', '**/credentials/**', '*.pdf', '*.xlsx', '*.xls', '*.docx', '*.zip')
    $existingIgnore = Join-Path $script:RepoRoot '.aiderignore'
    if (Test-Path $existingIgnore) { $ignoreLines += Get-Content -LiteralPath $existingIgnore -Encoding UTF8 }
    [System.IO.File]::WriteAllText($ignorePath, ($ignoreLines -join "`n") + "`n", $Utf8NoBom)
    $null = [System.IO.File]::WriteAllText($outPath, '', $Utf8NoBom)
    $null = [System.IO.File]::WriteAllText($errPath, '', $Utf8NoBom)

    $arguments = @('-X', 'utf8', '-m', 'aider', '--no-analytics', '--no-show-model-warnings', '--show-repo-map', '--map-tokens', '4096', '--aiderignore', $ignorePath)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $aiderPython
    $startInfo.Arguments = (($arguments | ForEach-Object { Quote-WindowsArgument ([string]$_) }) -join ' ')
    $startInfo.WorkingDirectory = $script:RepoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (!$process.Start()) { throw 'No se pudo iniciar Python de Aider.' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(120000)) {
      $process.Kill()
      $process.WaitForExit()
      throw 'Aider excedió el límite de 120 segundos.'
    }
    $exitCode = $process.ExitCode
    $generated = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $process.Dispose()
    [System.IO.File]::WriteAllText($outPath, $generated, $Utf8NoBom)
    [System.IO.File]::WriteAllText($errPath, $stderr, $Utf8NoBom)

    if ($exitCode -ne 0) { throw "Aider terminó con código $exitCode. $($stderr.Trim())" }
    $header = $generated.Substring(0, [Math]::Min(1200, $generated.Length))
    if ($generated.Length -lt 100 -or $generated -notmatch '(?m)^.{1,300}:\r?$' -or $header -match '(?i)(traceback|usage: __main__|error:)') {
      throw "La salida de Aider no parece un Repo Map válido (longitud $($generated.Length)). $($stderr.Trim())"
    }
    $generated = $generated.TrimEnd("`r", "`n") + "`n"
    $old = if (Test-Path $script:MapPath) { [System.IO.File]::ReadAllText($script:MapPath, [System.Text.Encoding]::UTF8) } else { $null }
    $afterGeneration = Get-RepositoryFingerprint
    if ($afterGeneration.Fingerprint -ne $current.Fingerprint) {
      $script:StaleDuringGeneration = $true
      throw 'El repositorio cambió mientras Aider generaba el mapa; se conserva el mapa anterior y el observador volverá a intentarlo tras la pausa.'
    }
    if ($old -cne $generated) {
      $mapTemp = "$($script:MapPath).$([guid]::NewGuid().ToString('N')).tmp"
      [System.IO.File]::WriteAllText($mapTemp, $generated, $Utf8NoBom)
      if (Test-Path $script:MapPath) {
        $backup = "$($script:MapPath).$([guid]::NewGuid().ToString('N')).bak"
        [System.IO.File]::Replace($mapTemp, $script:MapPath, $backup)
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
      }
      else { [System.IO.File]::Move($mapTemp, $script:MapPath) }
      $result = 'UPDATED'
    } else { $result = 'UNCHANGED' }

    $after = $afterGeneration
    $state = [ordered]@{ fingerprint = $after.Fingerprint; branch = $after.Branch; head = $after.Head; files = $after.Files; updatedAt = [DateTimeOffset]::Now.ToString('o'); status = 'OK' }
    Save-State $script:SuccessStatePath $state
    Save-State $script:AttemptStatePath $state
    Write-Status "$result rama=$($after.Branch) archivos=$($after.Files) fingerprint=$($after.Fingerprint.Substring(0,12)) tokens=4096"
    return $true
  } catch {
    try {
      $failureFingerprint = Get-RepositoryFingerprint
      Save-State $script:AttemptStatePath ([ordered]@{ fingerprint = $failureFingerprint.Fingerprint; branch = $failureFingerprint.Branch; head = $failureFingerprint.Head; attemptedAt = [DateTimeOffset]::Now.ToString('o'); status = 'ERROR'; error = $_.Exception.Message })
    } catch { }
    Write-Status "ERROR $($_.Exception.Message)"
    return $false
  } finally {
    foreach ($path in @($outPath, $errPath, $ignorePath, $mapTemp)) { if ($path) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue } }
    $lock.Dispose()
  }
}

if ($Mode -eq 'Stop') {
  [System.IO.File]::WriteAllText($script:WatchStopPath, 'stop', $Utf8NoBom)
  Write-Status 'WATCH stop solicitado.'
  exit 0
}
$script:AllowFailedRetry = ($Mode -ne 'Watch')
if ($Mode -ne 'Watch') { $ok = Invoke-MapUpdate; if (!$ok) { exit 1 }; exit 0 }

if ($DebounceSeconds -lt 5 -or $DebounceSeconds -gt 10) { throw 'DebounceSeconds debe estar entre 5 y 10.' }
$watchLock = Enter-FileLock $script:WatchLockPath
if (!$watchLock) { Write-Status 'SKIP ya existe un observador para este repositorio.'; exit 0 }
$cancel = [ConsoleCancelEventHandler]{ param($sender, $eventArgs) $eventArgs.Cancel = $true; $script:StopWatcher = $true }
$script:StopWatcher = $false
[Console]::add_CancelKeyPress($cancel)
Write-Status "WATCH iniciado debounce=${DebounceSeconds}s poll=${PollMilliseconds}ms (Ctrl+C para detener)."
try {
  $script:StaleDuringGeneration = $false
  $null = Invoke-MapUpdate
  $lastSeen = (Get-RepositoryFingerprint).Fingerprint
  $changedAt = if ($script:StaleDuringGeneration) { [DateTimeOffset]::Now } else { $null }
  while (!$script:StopWatcher -and !(Test-Path $script:WatchStopPath)) {
    Start-Sleep -Milliseconds $PollMilliseconds
    $now = (Get-RepositoryFingerprint).Fingerprint
    if ($now -ne $lastSeen) { $lastSeen = $now; $changedAt = [DateTimeOffset]::Now }
    if ($changedAt -and ([DateTimeOffset]::Now - $changedAt).TotalSeconds -ge $DebounceSeconds) {
      $script:StaleDuringGeneration = $false
      $null = Invoke-MapUpdate
      $lastSeen = (Get-RepositoryFingerprint).Fingerprint
      if ($script:StaleDuringGeneration -or $script:UpdateLockBusy) { $changedAt = [DateTimeOffset]::Now }
      else { $changedAt = $null }
    }
  }
  Remove-Item -LiteralPath $script:WatchStopPath -Force -ErrorAction SilentlyContinue
  Write-Status 'WATCH detenido limpiamente.'
} finally {
  [Console]::remove_CancelKeyPress($cancel)
  $watchLock.Dispose()
}
