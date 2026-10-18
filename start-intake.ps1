$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { throw 'Node.js 22 is required for local intake development.' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found' }
& $nodePath (Join-Path $PSScriptRoot 'scripts/manual-intake.cjs') serve
exit $LASTEXITCODE
