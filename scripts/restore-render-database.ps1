param(
  [string]$BackupFile
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceEnvPath = Join-Path $repoRoot 'apps/api/.env'

function Find-PostgresTool([string]$toolName) {
  $fileName = "$toolName.exe"
  $candidates = [System.Collections.Generic.List[string]]::new()

  # Prefer tools already on PATH, then inspect the normal PostgreSQL install roots.
  $onPath = Get-Command $fileName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath) { $candidates.Add($onPath.Source) }

  $roots = @(
    (Join-Path $env:ProgramFiles 'PostgreSQL'),
    (Join-Path $env:ProgramW6432 'PostgreSQL'),
    'C:\Program Files\PostgreSQL',
    'C:\Program Files (x86)\PostgreSQL'
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($installRoot in $roots) {
    if (-not (Test-Path -LiteralPath $installRoot -PathType Container)) { continue }
    $versions = Get-ChildItem -LiteralPath $installRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^\d+(?:\.\d+)*$' } |
      Sort-Object { if ($_.Name.Contains('.')) { [version]$_.Name } else { [version]"$($_.Name).0" } } -Descending
    foreach ($version in $versions) {
      $candidate = Join-Path $version.FullName "bin\$fileName"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $candidates.Add($candidate) }
    }
  }

  $candidate = $candidates | Select-Object -Unique | Select-Object -First 1
  if ($candidate) { return $candidate }
  if (-not ($roots | Where-Object { Test-Path -LiteralPath $_ -PathType Container })) {
    throw 'PostgreSQL command-line tools were not found on PATH or in the standard installation directories.'
  }
  throw "Could not find $fileName on PATH or under the standard PostgreSQL installation directories."
}

function Parse-DatabaseUrl([string]$value) {
  $uri = [uri]$value
  if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'Database URL must use PostgreSQL.' }
  $credentials = [uri]::UnescapeDataString($uri.UserInfo).Split(':', 2)
  if ($credentials.Count -ne 2 -or [string]::IsNullOrWhiteSpace($credentials[0])) { throw 'Database URL credentials are incomplete.' }
  return @{
    Host = $uri.DnsSafeHost
    Port = if ($uri.IsDefaultPort) { '5432' } else { [string]$uri.Port }
    User = $credentials[0]
    Password = $credentials[1]
    Database = [uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    SslMode = if ($uri.Query -match '(?i)(?:\?|&)sslmode=require(?:&|$)') { 'require' } else { 'disable' }
  }
}

function Invoke-Psql([string]$tool, [hashtable]$database, [string]$sql) {
  $env:PGPASSWORD = $database.Password
  $env:PGSSLMODE = $database.SslMode
  $output = & $tool --no-psqlrc --tuples-only --no-align --quiet --no-password `
    --host $database.Host --port $database.Port --username $database.User `
    --dbname $database.Database --command $sql 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'A database verification query failed; details were suppressed to protect connection information.' }
  return ($output | Out-String).Trim()
}

if (-not (Test-Path -LiteralPath $sourceEnvPath)) { throw 'apps/api/.env is required to confirm the existing local database source.' }
$sourceLine = Get-Content -LiteralPath $sourceEnvPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $sourceLine) { throw 'The local API environment does not define DATABASE_URL.' }
$sourceUrl = (($sourceLine -split '=', 2)[1]).Trim().Trim('"').Trim("'")
$source = Parse-DatabaseUrl $sourceUrl
if ($source.Host -notin @('localhost', '127.0.0.1', '::1')) { throw 'The source DATABASE_URL must point to the local database.' }

if (-not $BackupFile) {
  $backupDirectory = Join-Path $repoRoot '.database-backups'
  $latest = Get-ChildItem -LiteralPath $backupDirectory -Filter '*.dump' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw 'No database backup was found in .database-backups.' }
  $BackupFile = $latest.FullName
}
$backupPath = (Resolve-Path -LiteralPath $BackupFile).Path
$backupRoot = (Resolve-Path -LiteralPath (Join-Path $repoRoot '.database-backups')).Path.TrimEnd('\') + '\'
if (-not $backupPath.StartsWith($backupRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'The backup file must be inside the ignored .database-backups directory.' }

$pgRestore = Find-PostgresTool 'pg_restore'
$psql = Find-PostgresTool 'psql'
& $pgRestore --list $backupPath *> $null
if ($LASTEXITCODE -ne 0) { throw 'The backup archive failed its integrity listing check.' }

$secureUrl = Read-Host -Prompt 'Paste the Render EXTERNAL PostgreSQL URL (input hidden)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
  $targetUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $secureUrl.Dispose()
}

$target = Parse-DatabaseUrl $targetUrl
$targetUrl = $null
if (-not $target.Host.EndsWith('.render.com', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target must be a Render-hosted PostgreSQL database.' }
if ($target.SslMode -ne 'require') { throw 'Use the Render external URL with sslmode=require.' }
if ($target.Host -in @('localhost', '127.0.0.1', '::1')) { throw 'Target cannot be the original local database.' }

try {
  $relationCount = Invoke-Psql $psql $target "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','S','f');"
  if ([int]$relationCount -ne 0) { throw 'Target database is not empty. Nothing was restored; create a fresh empty Render database.' }

  $env:PGPASSWORD = $target.Password
  $env:PGSSLMODE = 'require'
  & $pgRestore --exit-on-error --single-transaction --no-owner --no-acl --no-password `
    --host $target.Host --port $target.Port --username $target.User `
    --dbname $target.Database $backupPath
  if ($LASTEXITCODE -ne 0) { throw 'Restore failed and the single transaction was rolled back; the source database remains unchanged.' }

  $tableCount = Invoke-Psql $psql $target "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"
  $migrationCount = Invoke-Psql $psql $target 'SELECT count(*) FROM public."_prisma_migrations";'
  if ([int]$tableCount -lt 1 -or [int]$migrationCount -lt 1) { throw 'Restore finished but post-restore schema verification failed.' }
  Write-Output "Restore verified. Restored tables: $tableCount; Prisma migration records: $migrationCount. The local source database was not modified."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  $sourceUrl = $null
  $source.Password = $null
  $target.Password = $null
}
