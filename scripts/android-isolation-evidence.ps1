function Get-ValidatedProbeIsolationEvidence([string] $Response) {
    $evidence = @{}
    foreach ($field in @('sameLocationVerified', 'readOpen', 'writeOpen')) {
        $lines = @($Response -split "`n" | Where-Object { $_ -match "^INSTRUMENTATION_RESULT: ${field}=" })
        if ($lines.Count -ne 1) { throw 'Missing or ambiguous isolation evidence.' }
        $value = $lines[0].Substring("INSTRUMENTATION_RESULT: ${field}=".Length).TrimEnd("`r")
        if (($field -eq 'sameLocationVerified' -and $value -cne 'true') -or
            ($field -ne 'sameLocationVerified' -and $value -cnotin @('EACCES', 'ENOENT'))) {
            throw 'Isolation controls did not establish denied access.'
        }
        $evidence[$field] = $value
    }
    return $evidence
}
