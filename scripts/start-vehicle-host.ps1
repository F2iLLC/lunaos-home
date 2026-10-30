param([Parameter(Mandatory)][string] $PrivateLauncher, [Parameter(Mandatory)][string] $NodeExecutable)
$ErrorActionPreference = 'Stop'
& $NodeExecutable --experimental-transform-types $PrivateLauncher
exit $LASTEXITCODE
