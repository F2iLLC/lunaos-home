#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-isolation-evidence.ps1')
function Evidence([string] $Read, [string] $Write) {
    return "INSTRUMENTATION_RESULT: sameLocationVerified=true`r`nINSTRUMENTATION_RESULT: readOpen=$Read`r`nINSTRUMENTATION_RESULT: writeOpen=$Write`r`n"
}
foreach ($read in @('EACCES', 'ENOENT')) {
    foreach ($write in @('EACCES', 'ENOENT')) {
        $result = Get-ValidatedProbeIsolationEvidence (Evidence $read $write)
        if ($result.readOpen -cne $read -or $result.writeOpen -cne $write) { throw 'Reported errors changed.' }
    }
}
$valid = Evidence 'ENOENT' 'EACCES'
$invalid = @(
    (Evidence 'OPENED' 'EACCES'), (Evidence 'ENOENT' 'OPENED'),
    (Evidence 'OTHER' 'EACCES'), (Evidence 'ENOENT' 'OTHER'),
    (Evidence 'EPERM' 'EACCES'), (Evidence 'ENOENT' 'enoent'),
    $valid.Replace('sameLocationVerified=true', 'sameLocationVerified=false'),
    $valid.Replace('INSTRUMENTATION_RESULT: sameLocationVerified=true' + "`r`n", ''),
    $valid.Replace('INSTRUMENTATION_RESULT: readOpen=ENOENT' + "`r`n", ''),
    $valid.Replace('INSTRUMENTATION_RESULT: writeOpen=EACCES' + "`r`n", ''),
    ($valid + 'INSTRUMENTATION_RESULT: readOpen=OPENED' + "`r`n"),
    ($valid + 'INSTRUMENTATION_RESULT: sameLocationVerified=true' + "`r`n")
)
foreach ($response in $invalid) {
    $rejected = $false
    try { Get-ValidatedProbeIsolationEvidence $response | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Invalid or incomplete isolation result accepted.' }
}
Write-Output "PASS: four accepted errno pairs preserve their values; $($invalid.Count) invalid, missing or ambiguous controls rejected."
