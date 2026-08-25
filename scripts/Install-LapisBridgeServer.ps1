[CmdletBinding()]
param(
    [Parameter()]
    [string]$ServerRoot = 'C:\Lapis',

    [Parameter(Mandatory = $true)]
    [string]$StagedJar,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string]$ExpectedSha256
)

$ErrorActionPreference = 'Stop'

$resolvedRoot = (Resolve-Path -LiteralPath $ServerRoot).Path
$modsDirectory = Join-Path $resolvedRoot 'mods'
$resolvedMods = (Resolve-Path -LiteralPath $modsDirectory).Path
$resolvedStaged = (Resolve-Path -LiteralPath $StagedJar).Path

if (-not $resolvedMods.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The mods directory is outside the server root.'
}

$stagedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedStaged).Hash
if ($stagedHash -ne $ExpectedSha256.ToUpperInvariant()) {
    throw "The staged Bridge hash does not match. Actual: $stagedHash"
}

$current = @(Get-ChildItem -LiteralPath $resolvedMods -File -Filter 'LapisBridgeServer-*.jar')
if ($current.Count -ne 1) {
    throw "Expected exactly one installed Bridge JAR, found $($current.Count)."
}

$lockProbe = $null
try {
    $lockProbe = [IO.File]::Open(
        $current[0].FullName,
        [IO.FileMode]::Open,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
} catch {
    throw 'The current Bridge JAR is still in use. Stop the Minecraft JVM before installing.'
} finally {
    if ($null -ne $lockProbe) { $lockProbe.Dispose() }
}

$version = [IO.Path]::GetFileNameWithoutExtension($resolvedStaged) -replace '^LapisBridgeServer-', ''
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'The staged Bridge filename must be LapisBridgeServer-x.y.z.jar.'
}

$target = Join-Path $resolvedMods "LapisBridgeServer-$version.jar"
$backupDirectory = Join-Path $resolvedRoot ('.lapis-backups\bridge\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$backup = Join-Path $backupDirectory $current[0].Name

Move-Item -LiteralPath $current[0].FullName -Destination $backup
try {
    Move-Item -LiteralPath $resolvedStaged -Destination $target
    $installed = @(Get-ChildItem -LiteralPath $resolvedMods -File -Filter 'LapisBridgeServer-*.jar')
    if ($installed.Count -ne 1 -or $installed[0].FullName -ne $target) {
        throw 'Post-install validation failed.'
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash -ne $stagedHash) {
        throw 'Installed Bridge hash validation failed.'
    }
} catch {
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        Move-Item -LiteralPath $target -Destination $resolvedStaged -Force
    }
    Move-Item -LiteralPath $backup -Destination $current[0].FullName -Force
    throw
}

Write-Output "Installed $target"
Write-Output "Backup $backup"
