#requires -Version 7.0
# Local stdin/stdout worker for the synthetic Windows adapter. Not a network API.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$lock = $null; $temp = $null; $locked = $false; $cleanup = $false; $testFault = $null
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
function Assert-NotebookKeys($Value, [string[]] $Required, [string[]] $Optional) {
    if ($Value -isnot [Collections.IDictionary]) { throw 'notebook-data' }
    foreach ($key in $Required) { if (-not $Value.Contains($key)) { throw 'notebook-data' } }
    foreach ($key in $Value.psbase.Keys) { if ($key -cnotin $Required -and $key -cnotin $Optional) { throw 'notebook-data' } }
}
function Assert-NotebookText($Value, [int] $Max) {
    if ($Value -isnot [string] -or $Value.Trim().Length -lt 1 -or $Value.Length -gt $Max) { throw 'notebook-data' }
}
function Assert-NotebookId($Value) {
    if ($Value -isnot [string] -or $Value -cnotmatch '^[A-Za-z0-9_-]{1,80}$') { throw 'notebook-data' }
}
# One household's lists (lib/notebook-contract.js). List type is metadata only.
function Assert-Notebook($Value) {
    # Refuse rather than silently rewrite stored timestamps on older PowerShell.
    if (-not $parse.ContainsKey('DateKind')) { throw 'notebook-needs-datekind' }
    Assert-NotebookKeys $Value @('kind', 'notebook') @()
    $book = $Value.notebook
    Assert-NotebookKeys $book @('version', 'householdId', 'commitId', 'lists') @()
    if (($book.version -isnot [int] -and $book.version -isnot [long]) -or $book.version -ne 1 -or
        $book.commitId -isnot [string] -or $book.commitId -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or
        $book.lists -isnot [array] -or $book.lists.Count -gt 50) { throw 'notebook-data' }
    Assert-NotebookId $book.householdId
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($list in $book.lists) {
        Assert-NotebookKeys $list @('id', 'name', 'createdAt', 'updatedAt', 'items') @('description', 'type')
        Assert-NotebookId $list.id
        Assert-NotebookText $list.name 80
        if (-not $seen.Add($list.id) -or $list.items -isnot [array] -or $list.items.Count -gt 200) { throw 'notebook-data' }
        foreach ($item in $list.items) {
            Assert-NotebookKeys $item @('id', 'text', 'completed', 'position', 'createdAt', 'updatedAt') @('quantity', 'unit', 'notes')
            Assert-NotebookId $item.id
            Assert-NotebookText $item.text 160
            if ($item.completed -isnot [bool] -or ($item.position -isnot [int] -and $item.position -isnot [long]) -or
                $item.position -lt 0 -or $item.position -gt 200) { throw 'notebook-data' }
        }
    }
}
function Test-ListRecord($Value) {
    return $Value -is [Collections.IDictionary] -and $Value.Contains('kind') -and
        $Value.kind -cin @('grocery-list', 'household-notebook')
}
function Assert-RecordData($Value) {
    if ($Value -isnot [Collections.IDictionary]) { throw 'data' }
    if ($Value.Contains('kind') -and $Value.kind -ceq 'household-notebook') { Assert-Notebook $Value; return }
    if ($Value.Contains('kind') -and $Value.kind -ceq 'grocery-list') {
        if ($Value.Count -ne 3 -or -not $Value.Contains('list') -or -not $Value.Contains('outcomes') -or
            $Value.list -isnot [Collections.IDictionary] -or $Value.list.Count -ne 6 -or
            $Value.outcomes -isnot [array] -or $Value.outcomes.Count -gt 512 -or
            $Value.list.items -isnot [array] -or $Value.list.items.Count -gt 500) { throw 'grocery-data' }
        foreach ($key in @('id', 'householdId')) { Assert-Id $Value.list[$key] }
        Assert-Revision $Value.list.revision
        if ($Value.list.label -isnot [string] -or $Value.list.label.Length -lt 1 -or $Value.list.label.Length -gt 120 -or
            $Value.list.updatedBy -isnot [Collections.IDictionary] -or $Value.list.updatedBy.Count -ne 2 -or
            $Value.list.updatedBy.kind -cnotin @('human', 'assistant')) { throw 'grocery-data' }
        Assert-Id $Value.list.updatedBy.id
        foreach ($item in $Value.list.items) {
            if ($item -isnot [Collections.IDictionary] -or $item.Count -lt 3 -or $item.Count -gt 6 -or
                $item.label -isnot [string] -or $item.label.Length -lt 1 -or $item.label.Length -gt 120 -or
                $item.completed -isnot [bool]) { throw 'grocery-data' }
            Assert-Id $item.id
        }
        foreach ($outcome in $Value.outcomes) {
            if ($outcome -isnot [Collections.IDictionary] -or $outcome.Count -ne 3 -or
                $outcome.requestId -isnot [string] -or $outcome.fingerprint -isnot [string] -or
                $outcome.fingerprint.Length -lt 1 -or $outcome.fingerprint.Length -gt 8192 -or
                $outcome.receipt -isnot [Collections.IDictionary] -or $outcome.receipt.status -cne 'applied') { throw 'grocery-data' }
        }
        return
    }
    Assert-Detail $Value
}
try {
    if (-not $IsWindows) { throw 'platform' }
    # Notebook records nest deeper than grocery lists, and their timestamps must
    # come back as the text that was stored. DateKind exists from PowerShell 7.5;
    # without it Assert-Notebook refuses notebook records.
    $parse = @{ AsHashtable = $true; Depth = 16 }
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { $parse.DateKind = 'String' }
    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
    $buffer = [char[]]::new(262145)
    $length = [Console]::In.ReadBlock($buffer, 0, $buffer.Length)
    if ($length -gt 262144) { throw 'input-size' }
    $request = [string]::new($buffer, 0, $length) | ConvertFrom-Json @parse
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
    if ($request.Contains('testFault')) { $testFault = $request.testFault }
    $versioned = $contractVersion -eq 2
    if ($versioned -and $operation -cin @('snapshot', 'restore')) { throw 'unsupported-recovery' }
    if ($operation -cnotin @('init', 'open', 'read', 'create', 'edit', 'edit-profile', 'delete', 'snapshot', 'restore', 'cleanup')) { throw 'operation' }
    $expected = switch ($operation) { 'read' { 3 }; 'create' { 4 }; 'edit' { 4 }; 'edit-profile' { 4 }; 'delete' { 3 }; 'restore' { 3 }; default { 2 } }
    if ($request.Contains('contractVersion')) { $expected++ }
    if ($request.Contains('testFault')) {
        $expected++
        # Test-only definitions shared with lib/windows-probe-store.js; read only when a fault is requested.
        $faultContract = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'windows-vault-faults.json') -Raw | ConvertFrom-Json -AsHashtable
        if (-not $versioned -or $operation -cnotin $faultContract.operations -or
            $request.testFault -isnot [string] -or $request.testFault -cnotin $faultContract.faults) { throw 'test-fault' }
    }
    if ($versioned -and $operation -cin @('edit', 'edit-profile', 'delete')) {
        $expected++
        Assert-Revision $request.expectedRevision
    }
    if ($request.Count -ne $expected) { throw 'request' }
    if ($operation -cin @('read', 'create', 'edit', 'edit-profile', 'delete')) { Assert-Id $request.recordId }
    if ($operation -cin @('create', 'edit', 'edit-profile')) {
        if ($versioned -and $operation -ne 'edit-profile') { Assert-RecordData $request.data } else { Assert-Detail $request.data }
    }
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
            try { $envelope = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json @parse }
            finally { [Array]::Clear($plain, 0, $plain.Length) }
            if ($envelope.Count -ne 2 -or $envelope.format -ne $contractVersion -or $envelope.records -isnot [Collections.IDictionary] -or $envelope.records.psbase.Count -gt 64) { throw 'format' }
            foreach ($key in $envelope.records.psbase.Keys) {
                Assert-Id $key
                $record = $envelope.records[$key]
                if ($versioned) {
                    if ($record -isnot [Collections.IDictionary] -or $record.Count -ne 2) { throw 'record' }
                    Assert-Revision $record.revision
                    Assert-RecordData $record.data
                } else { Assert-Detail $record }
            }
        }
        $result = @{ ok = $true }
        # Compare and commit under the same exclusive file lock, including when
        # another process opened the store. Never fetch a newer revision for a caller.
        if ($versioned -and $operation -cin @('create', 'edit', 'edit-profile', 'delete')) {
            $exists = $envelope.records.psbase.Contains($request.recordId)
            if (($operation -eq 'create' -and $exists) -or
                ($operation -ne 'create' -and (-not $exists -or
                    $envelope.records[$request.recordId].revision -cne $request.expectedRevision))) {
                $errorCode = 'CONFLICT'
                throw 'conflict'
            }
            if ($operation -eq 'edit-profile' -and (Test-ListRecord $envelope.records[$request.recordId].data)) {
                $errorCode = 'UNSUPPORTED'
                throw 'unsupported-record-type'
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
            'edit-profile' {
                if (-not $envelope.records.psbase.Contains($request.recordId)) { throw 'missing-record' }
                $result.revision = [Guid]::NewGuid().ToString('D')
                $envelope.records[$request.recordId] = @{ revision = $result.revision; data = $request.data }
            }
            'delete' {
                if (-not $envelope.records.psbase.Contains($request.recordId)) { throw 'missing-record' }
                $envelope.records.psbase.Remove($request.recordId)
                if ($versioned) { $result.revision = $request.expectedRevision }
            }
        }
        if ($operation -cin @('init', 'create', 'edit', 'edit-profile', 'delete', 'restore')) {
            $plain = [Text.Encoding]::UTF8.GetBytes(($envelope | ConvertTo-Json -Depth 16 -Compress))
            try { $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $purpose, $scope) }
            finally { [Array]::Clear($plain, 0, $plain.Length) }
            if ($cipher.Length -gt 262144) { throw 'size' }
            $temp = Join-Path $root ('records-' + [Guid]::NewGuid().ToString('D') + '.tmp')
            $stream = [IO.FileStream]::new($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                if ($testFault -ceq 'before-write') { throw 'injected-before-write' }
                if ($testFault -cin @('during-write', 'disk-full', 'process-interruption')) {
                    $partial = [Math]::Max(1, [Math]::Floor($cipher.Length / 2))
                    $stream.Write($cipher, 0, $partial)
                    throw 'injected-during-write'
                }
                $stream.Write($cipher, 0, $cipher.Length)
                if ($testFault -ceq 'after-write') { throw 'injected-after-write' }
                $stream.Flush($true)
            } finally { $stream.Dispose() }
            if ($testFault -ceq 'tampered-temporary') {
                $damaged = [IO.File]::ReadAllBytes($temp)
                $damaged[$damaged.Length - 1] = $damaged[$damaged.Length - 1] -bxor 1
                [IO.File]::WriteAllBytes($temp, $damaged)
                throw 'injected-temporary-tamper'
            }
            if ($testFault -ceq 'before-replacement') { throw 'injected-before-replacement' }
            [IO.File]::Move($temp, $file, $operation -ne 'init')
            $temp = $null
            if ($testFault -ceq 'after-replacement') { throw 'injected-after-replacement' }
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
$result | ConvertTo-Json -Depth 16 -Compress
if (-not $result.ok) { exit 1 }
