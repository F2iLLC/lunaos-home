param([Parameter(Mandatory)][string]$InputDirectory, [Parameter(Mandatory)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expected = @(Get-Content -Raw (Join-Path $PSScriptRoot 'reply-prompts.json') | ConvertFrom-Json)
$pack = Get-Content -Raw (Join-Path $InputDirectory 'pack.json') | ConvertFrom-Json
if ($pack.provider -ne 'ElevenLabs' -or $pack.clips.Count -ne $expected.Count) { throw 'A complete prepared ElevenLabs reply pack is required.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Reply output already exists.' }
$validated = @()
foreach ($clip in $expected) {
    $entries = @($pack.clips | Where-Object { $_.id -ceq $clip.id })
    if ($entries.Count -ne 1 -or $entries[0].text -cne $clip.text) { throw "Reply manifest mismatch: $($clip.id)" }
    $file = Join-Path $InputDirectory ($clip.id + '.wav')
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $entries[0].sha256) { throw "Reply checksum mismatch: $($clip.id)" }
    $bytes = [IO.File]::ReadAllBytes($file)
    # The preparer emits canonical mono 24 kHz PCM16 WAVs with a 44-byte header.
    if ($bytes.Length -lt 4844 -or $bytes.Length -gt 576044 -or
        [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -cne 'RIFF' -or
        [Text.Encoding]::ASCII.GetString($bytes, 8, 8) -cne 'WAVEfmt ' -or
        [BitConverter]::ToInt32($bytes, 16) -ne 16 -or
        [BitConverter]::ToInt16($bytes, 20) -ne 1 -or
        [BitConverter]::ToInt16($bytes, 22) -ne 1 -or
        [BitConverter]::ToInt32($bytes, 24) -ne 24000 -or
        [BitConverter]::ToInt32($bytes, 28) -ne 48000 -or
        [BitConverter]::ToInt16($bytes, 32) -ne 2 -or $bytes.Length % 2 -ne 0 -or
        [BitConverter]::ToInt16($bytes, 34) -ne 16 -or
        [Text.Encoding]::ASCII.GetString($bytes, 36, 4) -cne 'data' -or
        [BitConverter]::ToInt32($bytes, 40) -ne $bytes.Length - 44 -or
        [BitConverter]::ToInt32($bytes, 4) -ne $bytes.Length - 8) { throw "Invalid or oversized reply WAV: $($clip.id)" }
    $validated += $file
}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
foreach ($file in $validated) { Copy-Item -LiteralPath $file -Destination $OutputDirectory }
Write-Output "Validated and copied $($validated.Count) offline ElevenLabs replies."
