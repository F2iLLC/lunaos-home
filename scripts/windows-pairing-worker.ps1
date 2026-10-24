#requires -Version 7.0
# CurrentUser DPAPI custody for fictional pairing fingerprints. Local stdin only.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$lock = $null; $temp = $null; $result = @{ ok = $false }; $cleanup = $false
function Assert-OrdinaryPath([string] $Path) {
    for ($cursor = $Path; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'path' }
    }
}
try {
    if (-not $IsWindows) { throw 'platform' }
    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
    $buffer = [char[]]::new(1025)
    $length = [Console]::In.ReadBlock($buffer, 0, $buffer.Length)
    if ($length -le 0 -or $length -gt 1024) { throw 'request-size' }
    $request = [string]::new($buffer, 0, $length) | ConvertFrom-Json -AsHashtable -Depth 3
    if ($request -isnot [Collections.IDictionary] -or $request.operation -cnotin @('load', 'inspect', 'add', 'beginRemoval', 'remove', 'cleanup') -or
        $request.Count -ne $(if ($request.operation -cin @('add', 'beginRemoval', 'remove')) { 4 } else { 3 })) { throw 'request' }
    $probeId = [Guid]::ParseExact($request.probeId, 'D').ToString('D')
    if ($probeId -cne $request.probeId -or $request.hostFingerprint -isnot [string] -or
        $request.hostFingerprint -cnotmatch '^[a-f0-9]{64}$') { throw 'identity' }
    if ($request.operation -cin @('add', 'beginRemoval', 'remove')) {
        if ($request.peerFingerprint -isnot [string] -or $request.peerFingerprint -cnotmatch '^[a-f0-9]{64}$') { throw 'peer' }
    }
    $base = [IO.Path]::GetFullPath([IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'LunaOSHome', 'FictionalVaultAdapters'))
    $root = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $probeId))
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) + [IO.Path]::DirectorySeparatorChar
    if (-not $root.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $root.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'path' }
    Assert-OrdinaryPath $root
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'missing-store' }
    $file = Join-Path $root 'pairing.bin'
    $lockPath = Join-Path $root '.pairing.lock'
    Assert-OrdinaryPath $file
    Assert-OrdinaryPath $lockPath
    $lock = [IO.FileStream]::new($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $purpose = [Text.Encoding]::UTF8.GetBytes('LunaOSHome.FictionalPairing.v1:' + $probeId)
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    $peers = @(); $pending = @()
    if (Test-Path -LiteralPath $file -PathType Leaf) {
        $size = (Get-Item -LiteralPath $file).Length
        if ($size -le 0 -or $size -gt 8192) { throw 'size' }
        $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file), $purpose, $scope)
        try { $envelope = [Text.UTF8Encoding]::new($false, $true).GetString($plain) | ConvertFrom-Json -AsHashtable -Depth 3 }
        finally { [Array]::Clear($plain, 0, $plain.Length) }
        if ($envelope -isnot [Collections.IDictionary] -or $envelope.host -cne $request.hostFingerprint -or
            $envelope.peers -isnot [array] -or $envelope.peers.Count -gt 32) { throw 'format' }
        if ($envelope.version -eq 1 -and $envelope.Count -eq 3) {
            $pending = @()
        } elseif ($envelope.version -eq 2 -and $envelope.Count -eq 4 -and
            $envelope.pending -is [array] -and $envelope.pending.Count -le 32) {
            $pending = @($envelope.pending)
        } else { throw 'format' }
        $unique = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($peer in $envelope.peers) {
            if ($peer -isnot [string] -or $peer -cnotmatch '^[a-f0-9]{64}$' -or -not $unique.Add($peer)) { throw 'peer' }
        }
        $pendingUnique = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($peer in $pending) {
            if ($peer -isnot [string] -or $peer -cnotmatch '^[a-f0-9]{64}$' -or
                -not $pendingUnique.Add($peer) -or -not $unique.Contains($peer)) { throw 'pending' }
        }
        $peers = @($envelope.peers)
    }
    if ($request.operation -eq 'add' -and $request.peerFingerprint -cin $pending) { throw 'pending' }
    if ($request.operation -eq 'add' -and $request.peerFingerprint -cnotin $peers) {
        if ($peers.Count -ge 32) { throw 'full' }
        $peers += $request.peerFingerprint
    }
    if ($request.operation -eq 'beginRemoval') {
        if ($request.peerFingerprint -cnotin $peers) { throw 'missing-peer' }
        if ($request.peerFingerprint -cnotin $pending) { $pending += $request.peerFingerprint }
    }
    if ($request.operation -eq 'remove') {
        $peers = @($peers | Where-Object { $_ -cne $request.peerFingerprint })
        $pending = @($pending | Where-Object { $_ -cne $request.peerFingerprint })
    }
    if ($request.operation -eq 'cleanup') {
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
        $cleanup = $true
        $peers = @()
        $pending = @()
    } elseif ($request.operation -cin @('add', 'beginRemoval', 'remove')) {
        $plain = [Text.Encoding]::UTF8.GetBytes((@{ version = 2; host = $request.hostFingerprint; peers = @($peers); pending = @($pending) } | ConvertTo-Json -Depth 3 -Compress))
        try { $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $purpose, $scope) }
        finally { [Array]::Clear($plain, 0, $plain.Length) }
        if ($cipher.Length -gt 8192) { throw 'size' }
        $temp = Join-Path $root ('pairing-' + [Guid]::NewGuid().ToString('D') + '.tmp')
        $stream = [IO.FileStream]::new($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($cipher, 0, $cipher.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        [IO.File]::Move($temp, $file, $true)
        $temp = $null
    }
    $result = @{ ok = $true; peers = @($peers); pending = @($pending) }
} catch {
    # No paths, peer identifiers or OS diagnostics on stdout.
    $result = @{ ok = $false }
} finally {
    if ($lock) {
        if ($temp -and (Test-Path -LiteralPath $temp)) { Assert-OrdinaryPath $temp; Remove-Item -LiteralPath $temp }
        $lock.Dispose()
        Assert-OrdinaryPath $lockPath
        Remove-Item -LiteralPath $lockPath
    }
}
$result | ConvertTo-Json -Depth 3 -Compress
if (-not $result.ok) { exit 1 }
