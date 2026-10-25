#requires -Version 7.0
param(
    [Parameter(Mandatory)][ValidateSet('stale-edit','write-unknown')][string] $Scenario,
    [Parameter(Mandatory)][string] $Apk,
    [Parameter(Mandatory)][string] $Serial,
    [Parameter(Mandatory)][string] $Model,
    [Parameter(Mandatory)][int] $Api,
    [Parameter(Mandatory)][string] $Address,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string] $SourceHead,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string] $ApkSha256,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string] $NativeSha256,
    [switch] $PreflightOnly
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $repo
if ((git rev-parse HEAD).Trim() -ne $SourceHead -or (git status --porcelain)) { throw 'Reviewed clean source required.' }
$native = Join-Path $repo 'src-tauri/target/debug/lunaos-home-preview.exe'
if ((Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ApkSha256 -or
    (Get-FileHash -LiteralPath $native -Algorithm SHA256).Hash.ToLowerInvariant() -ne $NativeSha256) { throw 'Reviewed build hashes required.' }
if (!$env:ANDROID_HOME -or !(Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'))) { throw 'Selected Android SDK required.' }
if ($PreflightOnly) { Write-Output 'PASS: clean source and build pins. No phone, prompt or record operation performed.'; exit 0 }
$output = Join-Path $env:LOCALAPPDATA ('LunaOSHome/AttendedEvidence/home-' + $Scenario + '-' + [guid]::NewGuid().ToString())
Write-Host 'Fictional only. Passwords stay in Windows. No reboot. Wait for each readiness message; only you press Save.'
node (Join-Path $PSScriptRoot 'test-attended-home-direct.mjs') $output $Apk $Serial $Model $Api $Address $Scenario
$result = $LASTEXITCODE
Write-Host ('Runner exit: ' + $result + '. Review result.json and cleanup; failed attempts remain incomplete.')
exit $result
