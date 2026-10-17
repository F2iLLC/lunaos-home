#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $Serial,
    [Parameter(Mandatory)][string] $Apk,
    [string] $Sdk = $env:ANDROID_HOME
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$adb = Join-Path $Sdk 'platform-tools/adb.exe'
$aapt = Join-Path $Sdk 'build-tools/37.0.0/aapt2.exe'
$package = 'io.github.f2illc.lunaos.vaultprobe'
$run = [Guid]::NewGuid().ToString('D')
$installed = $false
function Invoke-ProbeAdb([string[]] $AdbArgs) {
    $response = & $adb -s $Serial @AdbArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Android probe command failed.' }
    return ($response -join "`n")
}
function Invoke-ProbeStep([string] $Operation, [string] $Expected = 'PASS') {
    $response = Invoke-ProbeAdb @('shell', 'am', 'instrument', '-w', '-e', 'run', $run, '-e', 'operation', $Operation, "$package/.VaultProbe")
    $code = if ($Expected -eq 'PASS') { '-1' } else { '1' }
    if ($response -notmatch "(?m)^INSTRUMENTATION_RESULT: result=$Expected\r?$" -or
        $response -notmatch "(?m)^INSTRUMENTATION_CODE: $code\r?$" ) { throw "Probe step failed: $Operation" }
    if ($Expected -eq 'PASS') {
        if ($response -notmatch '(?m)^INSTRUMENTATION_RESULT: processId=(\d+)\r?$') { throw 'Missing process evidence.' }
        return [int] $Matches[1]
    }
}
if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) { throw 'Build the isolated probe first.' }
$manifest = & $aapt dump xmltree $Apk --file AndroidManifest.xml 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the probe manifest.' }
$manifest = $manifest -join "`n"
if ($manifest -notmatch 'A: package="io.github.f2illc.lunaos.vaultprobe"' -or
    $manifest -match 'E: (uses-permission\S*|activity\S*|service|receiver|provider)\b' -or
    $manifest -notmatch 'allowBackup\([^\r\n]*=false' -or
    $manifest -notmatch 'usesCleartextTraffic\([^\r\n]*=false') { throw 'Unexpected probe package policy.' }
if ((Invoke-ProbeAdb @('get-state')).Trim() -ne 'device') { throw 'Choose an authorized connected test device.' }
if ((Invoke-ProbeAdb @('shell', 'pm', 'list', 'packages', $package)) -match 'package:') {
    throw 'The probe package is already installed. Preserve it; choose a clean test device.'
}
try {
    if ((Invoke-ProbeAdb @('install', '-t', $Apk)) -notmatch '(?m)^Success\r?$') { throw 'Probe install failed.' }
    $installed = $true
    $firstProcess = Invoke-ProbeStep 'create'
    Invoke-ProbeStep 'create' 'FAIL' # Must not reset existing records or keys.
    Invoke-ProbeAdb @('shell', 'am', 'force-stop', $package) | Out-Null
    $secondProcess = Invoke-ProbeStep 'read'
    if ($firstProcess -eq $secondProcess) { throw 'Fresh-process check did not observe a different process.' }
    Invoke-ProbeStep 'tamper' | Out-Null
    Invoke-ProbeStep 'delete-key' | Out-Null
    Invoke-ProbeAdb @('shell', 'am', 'force-stop', $package) | Out-Null
    Invoke-ProbeStep 'missing-key' | Out-Null
    Invoke-ProbeStep 'cleanup' | Out-Null
} finally {
    if ($installed) {
        # Only the isolated package installed by this invocation; never Home or other apps.
        if ((Invoke-ProbeAdb @('uninstall', $package)) -notmatch '(?m)^Success\r?$') { throw 'Probe uninstall failed.' }
        if ((Invoke-ProbeAdb @('shell', 'pm', 'list', 'packages', $package)) -match 'package:') { throw 'Probe package remains installed.' }
    }
}
Write-Output 'PASS: encrypted round trip, duplicate-create denial, fresh process, tamper/truncation/purpose rejection, missing-key denial after restart, fixture cleanup and package removal.'
