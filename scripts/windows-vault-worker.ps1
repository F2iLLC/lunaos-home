#requires -Version 7.0
# Local stdin/stdout worker for the synthetic Windows adapter. Not a network API.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$lock = $null; $temp = $null; $locked = $false; $cleanup = $false
$errorCode = 'STORAGE_FAILED'
function Assert-OrdinaryPath([string] $Path) {
    for ($cursor = $Path; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'path' }
    }
}
function Assert-Id($Value) {
    if ($Value -isnot [string] -or $Value -cnotmatch '^[a-z0-9_-]{1,80}$') { throw 'id' }
}
function Assert-Revision($Value) {
    if ($Value -isnot [string] -or $Value -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'revision' }
}
function Assert-Detail($Value) {
    if ($Value -isnot [Collections.IDictionary] -or $Value.Count -ne 3) { throw 'detail' }
    foreach ($key in @('memberId', 'label', 'value')) { if (-not $Value.Contains($key)) { throw 'detail' } }
    Assert-Id $Value.memberId
    foreach ($key in @('label', 'value')) {
        $max = if ($key -eq 'label') { 80 } else { 240 }
        if ($Value[$key] -isnot [string] -or $Value[$key].Length -lt 1 -or $Value[$key].Length -gt $max) { throw 'detail' }
        try { [Text.UTF8Encoding]::new($false, $true).GetBytes($Value[$key]) | Out-Null }
        catch { throw 'detail' }
    }
}
try {
    if (-not $IsWindows) { throw 'platform' }
    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
    $buffer = [char[]]::new(262145)
    $length = [Console]::In.ReadBlock($buffer, 0, $buffer.Length)
    if ($length -gt 262144) { throw 'input-size' }
    $request = [string]::new($buffer, 0, $length) | ConvertFrom-Json -AsHashtable -Depth 8
    if ($request -isnot [Collections.IDictionary] -or $request.probeId -cnotmatch '^[0-9a-f-]{36}$') { throw 'request' }
    $probeGuid = [Guid]::ParseExact($request.probeId, 'D')
    if ($probeGuid.ToString('D') -cne $request.probeId) { throw 'id' }
    $operation = $request.operation
    $contractVersion = 1
    if ($request.Contains('contractVersion')) {
        if (($request.contractVersion -isnot [int] -and $request.contractVersion -isnot [long]) -or
            $request.contractVersion -notin @(1, 2)) { throw 'contract' }
        $contractVersion = $request.contractVersion
    }
    $versioned = $contractVersion -eq 2
    if ($versioned -and $operation -cin @('snapshot', 'restore')) { throw 'unsupported-recovery' }
    if ($operation -cnotin @('init', 'open', 'read', 'create', 'edit', 'delete', 'snapshot', 'restore', 'cleanup')) { throw 'operation' }
    $expected = switch ($operation) { 'read' { 3 }; 'create' { 4 }; 'edit' { 4 }; 'delete' { 3 }; 'restore' { 3 }; default { 2 } }
    if ($request.Contains('contractVersion')) { $expected++ }
    if ($versioned -and $operation -cin @('edit', 'delete')) {
        $expected++
        Assert-Revision $request.expectedRevision
    }
    if ($request.Count -ne $expected) { throw 'request' }
    if ($operation -cin @('read', 'create', 'edit', 'delete')) { Assert-Id $request.recordId }
    if ($operation -cin @('create', 'edit')) { Assert-Detail $request.data }
    if ($operation -eq 'restore') {
        $snapshot = $request.snapshot
        if ($snapshot -isnot [Collections.IDictionary] -or $snapshot.Count -ne 2 -or $snapshot.schema -ne 1 -or
            $snapshot.records -isnot [Collections.IDictionary] -or $snapshot.records.psbase.Count -gt 64) { throw 'snapshot' }
        foreach ($key in $snapshot.records.psbase.Keys) { Assert-Id $key; Assert-Detail $snapshot.records[$key] }
    }

    $base = [IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'LunaOSHome', 'FictionalVaultAdapters')
    $root = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $request.probeId))
    $prefix = [IO.Path]::GetFullPath($base) + [IO.Path]::DirectorySeparatorChar
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) + [IO.Path]::DirectorySeparatorChar
    if (-not $root.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'path' }
    Assert-OrdinaryPath $root
    if ($operation -eq 'init') {
        if (Test-Path -LiteralPath $root) { throw 'exists' }
        [IO.Directory]::CreateDirectory($root) | Out-Null
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
        }
        Set-Acl -LiteralPath $root -AclObject $acl
    } elseif (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'missing-store' }
    $lockPath = Join-Path $root '.lock'
    $file = Join-Path $root 'records.bin'
    Assert-OrdinaryPath $file
    Assert-OrdinaryPath $lockPath
    $lock = [IO.FileStream]::new($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $locked = $true
    if ($operation -eq 'cleanup') {
        # Do not delete unknown files or stale locks. No recursive deletion.
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
        $cleanup = $true
        $result = @{ ok = $true }
    } else {
        $purpose = [Text.Encoding]::UTF8.GetBytes('LunaOSHome.FictionalVault.v' + $contractVersion + ':' + $request.probeId)
        $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
        if ($operation -eq 'init') { $envelope = @{ format = $contractVersion; records = @{} } }
        else {
            $size = (Get-Item -LiteralPath $file).Length
            if ($size -le 0 -or $size -gt 262144) { throw 'size' }
            $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file), $purpose, $scope)
            try { $envelope = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json -AsHashtable -Depth 8 }
            finally { [Array]::Clear($plain, 0, $plain.Length) }
            if ($envelope.Count -ne 2 -or $envelope.format -ne $contractVersion -or $envelope.records -isnot [Collections.IDictionary] -or $envelope.records.psbase.Count -gt 64) { throw 'format' }
            foreach ($key in $envelope.records.psbase.Keys) {
                Assert-Id $key
                $record = $envelope.records[$key]
                if ($versioned) {
                    if ($record -isnot [Collections.IDictionary] -or $record.Count -ne 2) { throw 'record' }
                    Assert-Revision $record.revision
                    Assert-Detail $record.data
                } else { Assert-Detail $record }
            }
        }
        $result = @{ ok = $true }
        # Compare and commit under the same exclusive file lock, including when
        # another process opened the store. Never fetch a newer revision for a caller.
        if ($versioned -and $operation -cin @('create', 'edit', 'delete')) {
            $exists = $envelope.records.psbase.Contains($request.recordId)
            if (($operation -eq 'create' -and $exists) -or
                ($operation -ne 'create' -and (-not $exists -or
                    $envelope.records[$request.recordId].revision -cne $request.expectedRevision))) {
                $errorCode = 'CONFLICT'
                throw 'conflict'
            }
        }
        switch ($operation) {
            'open' { $result.directory = $root }
            'init' { $result.directory = $root }
            'read' { $result.data = $envelope.records[$request.recordId] }
            'snapshot' { $result.snapshot = @{ schema = 1; records = $envelope.records } }
            'restore' {
                if ($envelope.records.psbase.Count -ne 0) { throw 'nonempty-store' }
                $envelope.records = $snapshot.records
            }
            'create' {
                if ($envelope.records.psbase.Contains($request.recordId) -or $envelope.records.psbase.Count -ge 64) { throw 'exists-or-full' }
                if ($versioned) {
                    $result.revision = [Guid]::NewGuid().ToString('D')
                    $envelope.records[$request.recordId] = @{ revision = $result.revision; data = $request.data }
                } else { $envelope.records[$request.recordId] = $request.data }
            }
            'edit' {
                if (-not $envelope.records.psbase.Contains($request.recordId)) { throw 'missing-record' }
                if ($versioned) {
                    $result.revision = [Guid]::NewGuid().ToString('D')
                    $envelope.records[$request.recordId] = @{ revision = $result.revision; data = $request.data }
                } else { $envelope.records[$request.recordId] = $request.data }
            }
            'delete' {
                if (-not $envelope.records.psbase.Contains($request.recordId)) { throw 'missing-record' }
                $envelope.records.psbase.Remove($request.recordId)
                if ($versioned) { $result.revision = $request.expectedRevision }
            }
        }
        if ($operation -cin @('init', 'create', 'edit', 'delete', 'restore')) {
            $plain = [Text.Encoding]::UTF8.GetBytes(($envelope | ConvertTo-Json -Depth 8 -Compress))
            try { $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $purpose, $scope) }
            finally { [Array]::Clear($plain, 0, $plain.Length) }
            if ($cipher.Length -gt 262144) { throw 'size' }
            $temp = Join-Path $root ('records-' + [Guid]::NewGuid().ToString('D') + '.tmp')
            $stream = [IO.FileStream]::new($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $stream.Write($cipher, 0, $cipher.Length); $stream.Flush($true) } finally { $stream.Dispose() }
            [IO.File]::Move($temp, $file, $operation -ne 'init')
            $temp = $null
        }
    }
} catch {
    # Do not expose record contents, local paths or OS diagnostics to callers.
    $result = @{ ok = $false; error = $errorCode }
} finally {
    if ($locked) {
        if ($temp) { Assert-OrdinaryPath $temp; if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
        $lock.Dispose()
        Assert-OrdinaryPath $lockPath
        Remove-Item -LiteralPath $lockPath
        if ($cleanup) { [IO.Directory]::Delete($root, $false) }
    }
}
$result | ConvertTo-Json -Depth 8 -Compress
if (-not $result.ok) { exit 1 }
