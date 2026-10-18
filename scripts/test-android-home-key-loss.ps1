#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $Serial,
    [Parameter(Mandatory)][string] $ProbeApk,
    [switch] $VerifyOnly,
    [ValidateSet('held-read-end','held-write-end','held-read-recreate','read-return-after-end','commit-return-after-end','commit-lost-ack')][string] $QueueCheck,
    [string] $Sdk = $env:ANDROID_HOME
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Serial -notmatch '^emulator-\d+$') { throw 'Dedicated emulator only; physical devices are refused.' }
if ($VerifyOnly -and $QueueCheck) { throw 'Choose one check.' }
$adb = Join-Path $Sdk 'platform-tools/adb.exe'
function Invoke-KeyProbeAdb([string[]] $AdbArgs) {
    $response = & $adb -s $Serial @AdbArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Emulator test command failed.' }
    return ($response -join "`n")
}
$avd = Invoke-KeyProbeAdb @('emu','avd','name')
if (($avd -split "`n")[0].Trim() -cne 'HomeVaultAcceptance_API36') { throw 'Use the dedicated disposable acceptance emulator.' }
$probe = 'io.github.f2illc.lunaos.homekeyprobe'
$target = 'io.github.f2illc.lunaos.home.preview.debug'
if ((Invoke-KeyProbeAdb @('shell','pm','list','packages',$probe)) -match 'package:') { throw 'Probe already installed; preserve existing work.' }
if ((Invoke-KeyProbeAdb @('shell','pm','list','packages',$target)) -notmatch ('(?m)^package:' + [regex]::Escape($target) + '\r?$')) { throw 'Install the reviewed Home debug APK first.' }
$manifest = & (Join-Path $Sdk 'build-tools/37.0.0/aapt2.exe') dump xmltree $ProbeApk --file AndroidManifest.xml 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect probe APK.' }
$manifest = $manifest -join "`n"
if ($manifest -notmatch ('A: package="' + [regex]::Escape($probe) + '"') -or
    $manifest -notmatch ('targetPackage[^\r\n]*"' + [regex]::Escape($target) + '"') -or
    $manifest -notmatch 'testOnly[^\r\n]*=true' -or
    $manifest -notmatch 'allowBackup[^\r\n]*=false' -or
    $manifest -match 'E: (uses-permission\S*|activity\S*|service|receiver|provider)\b|sharedUserId') { throw 'Unexpected test package policy.' }
$installed = $false
try {
    if ((Invoke-KeyProbeAdb @('install','-t',$ProbeApk)) -notmatch '(?m)^Success\r?$') { throw 'Test install failed.' }
    $installed = $true
    $operation = if ($QueueCheck) { $QueueCheck } elseif ($VerifyOnly) { 'verify-synthetic-sam-key-absent' } else { 'delete-synthetic-sam-key' }
    $storeCheck = $QueueCheck -and -not $QueueCheck.StartsWith('held-')
    $class = if ($storeCheck) { 'HomeStoreProbe' } elseif ($QueueCheck) { 'HomeQueueProbe' } else { 'HomeKeyProbe' }
    if ($QueueCheck) { Write-Output 'Complete Android verification on the dedicated emulator and approve the selected Alex scope. The probe does not grant itself access.' }
    $result = Invoke-KeyProbeAdb @('shell','am','instrument','-w','-e','operation',$operation,"$probe/$probe.$class")
    $expected = if ($storeCheck) { @('result=PASS',"operation=$QueueCheck",'realStoreCompleted=true','accessAndContentCleared=true','oneStoreCall=true','noReplayDuringCheck=true') } elseif ($QueueCheck) { @('result=PASS',"operation=$QueueCheck",'queuedWorkObserved=true','accessAndContentCleared=true','ciphertextUnchanged=true') } else { @('result=PASS','samKeyAbsent=true','ciphertextUnchanged=true') }
    foreach ($line in $expected) {
        if ($result -notmatch ('(?m)^INSTRUMENTATION_RESULT: ' + [regex]::Escape($line) + '\r?$')) { throw 'Acceptance probe assertions failed.' }
    }
    if ($result -notmatch '(?m)^INSTRUMENTATION_CODE: -1\r?$') { throw 'Probe did not complete.' }
} finally {
    if ($installed) {
        if ((Invoke-KeyProbeAdb @('uninstall',$probe)) -notmatch '(?m)^Success\r?$' -or
            (Invoke-KeyProbeAdb @('shell','pm','list','packages',$probe)) -match 'package:') { throw 'Test package cleanup failed.' }
    }
}
if ($QueueCheck) {
    if ($storeCheck) { Write-Output "PASS: $QueueCheck; one real store call completed, access/content cleared, no replay during check; test package removed." }
    else { Write-Output "PASS: $QueueCheck; queued work observed, access/content cleared, ciphertext unchanged; test package removed." }
} elseif ($VerifyOnly) {
    Write-Output 'Synthetic Sam key is still absent; ciphertext unchanged; test package removed. No key or record was modified.'
} else {
    Write-Output 'Synthetic Sam key removed on dedicated emulator; ciphertext unchanged; test package removed. Verify denial through Home next; this is not a completed acceptance check.'
}
