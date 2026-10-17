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
$outsider = "$package.outsider"
$run = [Guid]::NewGuid().ToString('D')
$installed = [Collections.Generic.List[string]]::new()
$isolationFailure = $null
function Invoke-ProbeAdb([string[]] $AdbArgs) {
    $response = & $adb -s $Serial @AdbArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Android probe command failed.' }
    return ($response -join "`n")
}
function Invoke-ProbeStep([string] $Operation, [string] $Expected = 'PASS', [string] $Target = $package) {
    $response = Invoke-ProbeAdb @('shell', 'am', 'instrument', '-w', '-e', 'run', $run, '-e', 'operation', $Operation, "$Target/$package.VaultProbe")
    $code = if ($Expected -eq 'PASS') { '-1' } else { '1' }
    if ($response -notmatch "(?m)^INSTRUMENTATION_RESULT: result=$Expected\r?$" -or
        $response -notmatch "(?m)^INSTRUMENTATION_CODE: $code\r?$" ) {
        $check = 'unreported'
        if ($response -match '(?m)^INSTRUMENTATION_RESULT: check=([a-z-]{1,60})\r?$') { $check = $Matches[1] }
        throw "Probe step failed: $Operation ($check)"
    }
    if ($Expected -eq 'PASS') {
        if ($response -notmatch '(?m)^INSTRUMENTATION_RESULT: processId=(\d+)\r?$') { throw 'Missing process evidence.' }
        return [int] $Matches[1]
    }
}
$packages = @(@{ Id = $package; Apk = $Apk }, @{ Id = $outsider; Apk = (Join-Path (Split-Path $Apk) 'outsider.apk') })
if ((Invoke-ProbeAdb @('get-state')).Trim() -ne 'device') { throw 'Choose an authorized connected test device.' }
foreach ($candidate in $packages) {
    if (-not (Test-Path -LiteralPath $candidate.Apk -PathType Leaf)) { throw 'Build both isolated probes first.' }
    $manifest = & $aapt dump xmltree $candidate.Apk --file AndroidManifest.xml 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the probe manifest.' }
    $manifest = $manifest -join "`n"
    if ($manifest -notmatch ('A: package="' + [regex]::Escape($candidate.Id) + '"') -or
        $manifest -match 'E: (uses-permission\S*|activity\S*|service|receiver|provider)\b|sharedUserId' -or
        $manifest -notmatch 'allowBackup\([^\r\n]*=false' -or
        $manifest -notmatch 'usesCleartextTraffic\([^\r\n]*=false') { throw 'Unexpected probe package policy.' }
    if ((Invoke-ProbeAdb @('shell', 'pm', 'list', 'packages', $candidate.Id)) -match 'package:') {
        throw 'The probe package is already installed. Preserve it; choose a clean test device.'
    }
}
try {
    foreach ($candidate in $packages) {
        if ((Invoke-ProbeAdb @('install', '-t', $candidate.Apk)) -notmatch '(?m)^Success\r?$') { throw 'Probe install failed.' }
        $installed.Add($candidate.Id)
    }
    $firstProcess = Invoke-ProbeStep 'create'
    Invoke-ProbeStep 'create' 'FAIL' # Must not reset existing records or keys.
    Invoke-ProbeAdb @('shell', 'am', 'force-stop', $package) | Out-Null
    $secondProcess = Invoke-ProbeStep 'read'
    if ($firstProcess -eq $secondProcess) { throw 'Fresh-process check did not observe a different process.' }
    # Preserve a failed isolation result while still running independent storage checks.
    try { Invoke-ProbeStep 'isolation' 'PASS' $outsider | Out-Null }
    catch { $isolationFailure = $_ }
    Invoke-ProbeStep 'create' 'FAIL' $outsider
    Invoke-ProbeStep 'read' | Out-Null # Owner's key/file still work after outsider attempts.
    Invoke-ProbeStep 'tamper' | Out-Null
    Invoke-ProbeStep 'delete-key' | Out-Null
    Invoke-ProbeAdb @('shell', 'am', 'force-stop', $package) | Out-Null
    Invoke-ProbeStep 'missing-key' | Out-Null
    Invoke-ProbeStep 'cleanup' | Out-Null
} finally {
    $cleanupFailed = $false
    foreach ($target in $installed) {
        # Attempt removal of every package installed here, even if one removal fails.
        try {
            if ((Invoke-ProbeAdb @('uninstall', $target)) -notmatch '(?m)^Success\r?$') { throw 'Probe uninstall failed.' }
            if ((Invoke-ProbeAdb @('shell', 'pm', 'list', 'packages', $target)) -match ('(?m)^package:' + [regex]::Escape($target) + '\r?$')) { throw 'Probe package remains installed.' }
        } catch { $cleanupFailed = $true }
    }
    if ($cleanupFailed) { throw 'One or more isolated probe packages could not be removed.' }
}
if ($isolationFailure) {
    Write-Output 'Storage/restart/tamper/missing-key checks and cleanup passed. File-isolation acceptance did not pass.'
    throw $isolationFailure
}
Write-Output 'PASS: encrypted round trip, duplicate-create denial, fresh process, separate-UID key/file isolation, tamper/truncation/purpose rejection, missing-key denial after restart, fixture cleanup and removal of both packages.'
