param(
    [switch]$Injected,
    [switch]$Hidden,
    [string]$Model = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { throw 'Install Node.js 22 for development, or use the installer.' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 22 was not found.' }
$launchArgs = @((Join-Path $projectRoot 'scripts/launch-local.cjs'), $Model)
if ($Hidden) { $launchArgs += '--hidden' }
& $nodePath @launchArgs
exit $LASTEXITCODE
