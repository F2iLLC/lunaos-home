#requires -Version 7.0
<#
Opt-in Session 2 experiment. Uses only the fixed fictional fixture below.
No app integration, unlock prompt, workflow authorization, or production vault.
#>
[CmdletBinding()]
param(
    [ValidateSet('Run', 'Write', 'Read', 'Reject')]
    [string] $Phase = 'Run',
    [string] $ProbeId,
    [ValidateSet('record', 'tampered', 'truncated', 'wrong-purpose')]
    [string] $Case = 'record'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This probe requires Windows and PowerShell 7.' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData

# Public purpose binding, not a password or an additional secret.
$purpose = [Text.Encoding]::UTF8.GetBytes('LunaOSHome.FictionalStorageProbe.v1')
$fixture = '{"schema":1,"fictional":true,"members":[{"id":"alex-example","workplace":"Willow Studio"},{"id":"sam-example","school":"Meadow School"}]}'
$plain = [Text.Encoding]::UTF8.GetBytes($fixture)
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$base = [IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'LunaOSHome', 'FictionalStorageProbes')
if ($Phase -eq 'Run') {
    if ($ProbeId) { throw 'Run generates its own isolated probe identifier.' }
    $ProbeId = [Guid]::NewGuid().ToString('D')
} elseif ($ProbeId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
    throw 'A valid synthetic probe identifier is required.'
}
$root = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $ProbeId))
$prefix = [IO.Path]::GetFullPath($base) + [IO.Path]::DirectorySeparatorChar
if (-not $root.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid probe location.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) + [IO.Path]::DirectorySeparatorChar
if ($root.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'Probe files must be outside the checkout.' }

function Assert-OrdinaryPath([string] $Path) {
    # Refuse existing junction/symlink ancestors, including at cleanup time.
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Reparse points are not allowed in the probe path.'
            }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}

function Write-NewCiphertext([string] $Name, [byte[]] $Bytes) {
    $path = Join-Path $root $Name
    Assert-OrdinaryPath $path
    $stream = [IO.FileStream]::new($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}

function Read-Ciphertext([string] $Name) {
    $path = Join-Path $root $Name
    Assert-OrdinaryPath $path
    $length = (Get-Item -LiteralPath $path).Length
    if ($length -le 0 -or $length -gt 65536) { throw 'Invalid probe ciphertext size.' }
    return ,([IO.File]::ReadAllBytes($path))
}

function Invoke-ProbeChild([string] $ChildPhase, [string] $ChildCase = 'record') {
    $start = [Diagnostics.ProcessStartInfo]::new((Get-Process -Id $PID).Path)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($arg in @('-NoProfile', '-NonInteractive', '-File', $PSCommandPath, '-Phase', $ChildPhase, '-ProbeId', $ProbeId, '-Case', $ChildCase)) {
        $start.ArgumentList.Add($arg)
    }
    $child = [Diagnostics.Process]::Start($start)
    try {
        $output = $child.StandardOutput.ReadToEndAsync()
        $errors = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(30000)) { $child.Kill(); throw 'Probe child timed out.' }
        if ($child.ExitCode -ne 0) { throw "Synthetic child check failed: $ChildPhase/$ChildCase" }
        $result = $output.GetAwaiter().GetResult() | ConvertFrom-Json
        if (-not $result.passed) { throw 'Probe child did not report success.' }
        return $result
    } finally { $child.Dispose() }
}

Assert-OrdinaryPath $root
if ($Phase -ne 'Run') {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Probe directory is missing.' }
    if ($Phase -eq 'Write') {
        $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $purpose, $scope)
        Write-NewCiphertext 'record.bin' $cipher
        # A second encryption is retained to inspect both disk outputs.
        Write-NewCiphertext 'second.bin' ([Security.Cryptography.ProtectedData]::Protect($plain, $purpose, $scope))
    } else {
        $name = if ($Case -eq 'wrong-purpose') { 'record.bin' } else { "$Case.bin" }
        $cipher = Read-Ciphertext $name
        $entropy = if ($Case -eq 'wrong-purpose') { [Text.Encoding]::UTF8.GetBytes('DifferentProbePurpose') } else { $purpose }
        $rejected = $false
        $decoded = $null
        try {
            $decoded = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, $scope)
        } catch [Security.Cryptography.CryptographicException] { $rejected = $true }
        try {
            if ($Phase -eq 'Reject') {
                if (-not $rejected) { throw 'Corrupt or wrong-purpose data was accepted.' }
            } elseif ($rejected -or [Text.Encoding]::UTF8.GetString($decoded) -cne $fixture) {
                throw 'The fictional record did not round trip exactly.'
            }
        } finally { if ($null -ne $decoded) { [Array]::Clear($decoded, 0, $decoded.Length) } }
    }
    [Array]::Clear($plain, 0, $plain.Length)
    @{ passed = $true; phase = $Phase; case = $Case; processId = $PID } | ConvertTo-Json -Compress
    exit 0
}

if (Test-Path -LiteralPath $root) { throw 'Refusing to reuse an existing probe directory.' }
$created = $false
try {
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $created = $true
    # Limit the probe directory to the current Windows user and LocalSystem.
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $root -AclObject $acl
    $writer = Invoke-ProbeChild 'Write'
    $reader = Invoke-ProbeChild 'Read'
    if ($writer.processId -eq $reader.processId -or $reader.processId -eq $PID) { throw 'Fresh-process check failed.' }

    $cipher = Read-Ciphertext 'record.bin'
    $second = Read-Ciphertext 'second.bin'
    if ([Convert]::ToBase64String($cipher) -ceq [Convert]::ToBase64String($second)) { throw 'Repeated encryption produced identical output.' }
    $altered = [byte[]] $cipher.Clone()
    $index = [int][Math]::Floor($altered.Length / 2)
    $altered[$index] = $altered[$index] -bxor 1
    Write-NewCiphertext 'tampered.bin' $altered
    Write-NewCiphertext 'truncated.bin' ([byte[]] $cipher[0..31])
    foreach ($bad in @('tampered', 'truncated', 'wrong-purpose')) { Invoke-ProbeChild 'Reject' $bad | Out-Null }
    Invoke-ProbeChild 'Read' | Out-Null # Failed reads did not change the valid file.

    $files = @(Get-ChildItem -LiteralPath $root -File -Force)
    if ($files.Count -ne 4) { throw 'Unexpected probe disk output.' }
    foreach ($file in $files) {
        $bytes = Read-Ciphertext $file.Name
        foreach ($encoding in @([Text.Encoding]::UTF8, [Text.Encoding]::Unicode)) {
            $text = $encoding.GetString($bytes)
            foreach ($marker in @('alex-example', 'sam-example', 'Willow Studio', 'Meadow School')) {
                if ($text.Contains($marker)) { throw 'A fictional plaintext marker was found on disk.' }
            }
        }
    }
    $report = [ordered]@{
        passed = $true
        facility = 'Windows DPAPI CurrentUser via .NET ProtectedData'
        freshProcessRoundTrip = $true
        syntheticMembers = 2
        alteredCiphertextRejected = $true
        truncatedCiphertextRejected = $true
        wrongPurposeRejected = $true
        validRecordUnchangedAfterFailures = $true
        repeatedEncryptionDiffers = $true
        inspectedCiphertextFiles = $files.Count
        utf8AndUtf16FixtureMarkersAbsent = $true
        powershellVersion = $PSVersionTable.PSVersion.ToString()
        windowsVersion = [Environment]::OSVersion.Version.ToString()
        limit = 'No OS unlock prompt, cross-user denial, backup exclusion, grants, Android, pairing or app integration proved.'
    }
} finally {
    [Array]::Clear($plain, 0, $plain.Length)
    if ($created) {
        # Exact known files only, no recursive deletion or caller-selected paths.
        Assert-OrdinaryPath $root
        foreach ($name in @('record.bin', 'second.bin', 'tampered.bin', 'truncated.bin')) {
            $path = Join-Path $root $name
            Assert-OrdinaryPath $path
            if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path }
        }
        [IO.Directory]::Delete($root, $false)
    }
}
$report['isolatedProbeDirectoryRemoved'] = -not (Test-Path -LiteralPath $root)
$report | ConvertTo-Json
