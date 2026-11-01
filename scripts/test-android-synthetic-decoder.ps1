#requires -Version 7.0
<#
Windows-only synthetic experiment, not an Android acceptance test. Never opens
a microphone, reads recordings or dispatches timers. No Python installation is
needed: only the pinned wheel's native DLLs are loaded. Downloads are separate.
#>
param(
    [Parameter(Mandatory)][string] $InputDirectory,
    [Parameter(Mandatory)][string] $OutputDirectory,
    [string] $Jdk = $env:JAVA_HOME,
    [ValidateRange(1, 10)][int] $Repeats = 2
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Requires Windows x64 PowerShell.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $PSScriptRoot 'android-offline-voice-probe'
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Synthetic artifacts and native dependencies must remain outside Git.'
}
if (Test-Path -LiteralPath $output) { throw 'Choose a new output directory.' }
for ($cursor = [IO.Path]::GetDirectoryName($output); $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Choose an output without linked ancestors.'
    }
}
$nativeInput = Get-Content -Raw "$source/synthetic-inputs.json" | ConvertFrom-Json
$modelInput = @(Get-Content -Raw "$source/inputs.json" | ConvertFrom-Json | Where-Object { $_.file -eq 'model.zip' })[0]
foreach ($inputRecord in @($nativeInput, $modelInput)) {
    if ((Get-FileHash -LiteralPath (Join-Path $InputDirectory $inputRecord.file) -Algorithm SHA256).Hash -ne $inputRecord.sha256) {
        throw "Dependency checksum mismatch: $($inputRecord.file)"
    }
}
foreach ($tool in @('java.exe', 'javac.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Jdk "bin/$tool"))) { throw 'Provide a JDK.' }
}
[IO.Directory]::CreateDirectory($output) | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $InputDirectory $nativeInput.file), "$output/runtime")
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $InputDirectory $modelInput.file), "$output/model")

# Export the actual Java grammars and classify results using the actual parser.
# Synthetic decoded text goes through an in-memory pipe; output has codes only.
@'
package io.github.f2illc.lunaos.home.voiceprobe;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
public final class SyntheticPolicy {
    public static void main(String[] args) throws Exception {
        System.out.println(WakeSession.grammar());
        System.out.println(TimerPhrase.commandGrammar());
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = input.readLine()) != null) {
            String text = new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8);
            System.out.println(TimerPhrase.commandDetail(text) + ":" + TimerPhrase.commandSeconds(text));
        }
    }
}
'@ | Set-Content -LiteralPath "$output/SyntheticPolicy.java" -Encoding utf8
& "$Jdk/bin/javac.exe" -d $output "$output/SyntheticPolicy.java" "$source/TimerPhrase.java" "$source/WakeSession.java"
if ($LASTEXITCODE -ne 0) { throw 'Policy compilation failed.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HomeSyntheticVosk {
    [DllImport("kernel32", CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
    [DllImport("libvosk", CallingConvention=CallingConvention.Cdecl)] public static extern void vosk_set_log_level(int level);
    [DllImport("libvosk", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr vosk_model_new([MarshalAs(UnmanagedType.LPUTF8Str)] string path);
    [DllImport("libvosk", CallingConvention=CallingConvention.Cdecl)] public static extern void vosk_model_free(IntPtr model);
    [DllImport("libvosk", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_new_grm(IntPtr model, float rate, [MarshalAs(UnmanagedType.LPUTF8Str)] string grammar);
    [DllImport("libvosk", CallingConvention=CallingConvention.Cdecl)] public static extern int vosk_recognizer_accept_waveform(IntPtr recognizer, byte[] data, int length);
    [DllImport("libvosk", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr vosk_recognizer_result(IntPtr recognizer);
    [DllImport("libvosk", CallingConvention=CallingConvention.Cdecl)] public static extern void vosk_recognizer_free(IntPtr recognizer);
}
'@
if (-not [HomeSyntheticVosk]::SetDllDirectory("$output/runtime/vosk")) { throw 'Native search path failed.' }
$model = [IntPtr]::Zero
$policy = $null
$voice = $null
try {
    [HomeSyntheticVosk]::vosk_set_log_level(-1)
    $model = [HomeSyntheticVosk]::vosk_model_new("$output/model/vosk-model-small-en-us-0.15")
    if ($model -eq [IntPtr]::Zero) { throw 'Model load failed.' }
    $start = [Diagnostics.ProcessStartInfo]::new("$Jdk/bin/java.exe")
    foreach ($arg in @('-cp', $output, 'io.github.f2illc.lunaos.home.voiceprobe.SyntheticPolicy')) { $start.ArgumentList.Add($arg) }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $policy = [Diagnostics.Process]::Start($start)
    $wakeGrammar = $policy.StandardOutput.ReadLine()
    $commandGrammar = $policy.StandardOutput.ReadLine()
    if (-not $wakeGrammar -or -not $commandGrammar) { throw 'Policy grammar export failed.' }
    $voice = New-Object -ComObject SAPI.SpVoice
    function New-SyntheticAudio([string] $Text) {
        $stream = New-Object -ComObject SAPI.SpMemoryStream
        $stream.Format.Type = 18 # SAFT16kHz16BitMono
        $voice.AudioOutputStream = $stream
        $voice.Speak($Text, 0) | Out-Null
        # SAPI still owns this stream; let COM reference counting release it.
        # Force-releasing its shared RCW while SAPI holds it can crash the host.
        return ,([byte[]] $stream.GetData())
    }
    $rows = @()
    $fixtures = @()
    $voiceIndex = 0
    [IO.Directory]::CreateDirectory("$output/fixtures") | Out-Null
    [IO.File]::WriteAllText("$output/fixtures/wake.json", $wakeGrammar)
    [IO.File]::WriteAllText("$output/fixtures/command.json", $commandGrammar)
    foreach ($token in @($voice.GetVoices())) {
        $voice.Voice = $token
        foreach ($rate in @(-2, 0, 2)) {
            $voice.Rate = $rate
            $wakeAudio = New-SyntheticAudio 'Hey Luna'
            $commandAudio = New-SyntheticAudio 'Set a timer for five seconds'
            $stem = "v$voiceIndex-rate$rate"
            [IO.File]::WriteAllBytes("$output/fixtures/$stem-wake.pcm", $wakeAudio)
            [IO.File]::WriteAllBytes("$output/fixtures/$stem-command.pcm", $commandAudio)
            $fixtures += "$voiceIndex $rate $stem-wake.pcm $stem-command.pcm"
            foreach ($repeat in 1..$Repeats) {
                # -1 is a command-only control; other values are added silence.
                foreach ($gap in @(-1, 0, 250, 500, 1000, 1500)) {
                    $direct = $gap -lt 0
                    $audio = if ($direct) { [byte[]] ($commandAudio + [byte[]]::new(96000)) }
                        else { [byte[]] ($wakeAudio + [byte[]]::new(32 * $gap) + $commandAudio + [byte[]]::new(96000)) }
                    $wake = [IntPtr]::Zero; $command = [IntPtr]::Zero
                    try {
                        $command = [HomeSyntheticVosk]::vosk_recognizer_new_grm($model, 16000, $commandGrammar)
                        if (-not $direct) { $wake = [HomeSyntheticVosk]::vosk_recognizer_new_grm($model, 16000, $wakeGrammar) }
                        if ($command -eq [IntPtr]::Zero -or (-not $direct -and $wake -eq [IntPtr]::Zero)) { throw 'Recognizer creation failed.' }
                        $awake = $direct; $matched = $false; $wakeEnd = -1; $rejections = @()
                        # Same 1600-sample/100ms chunk capacity as ProbeCapture.
                        for ($offset = 0; $offset -lt $audio.Length; $offset += 3200) {
                            if ($wakeEnd -ge 0 -and $offset / 32 -ge $wakeEnd + 10000) { break }
                            $count = [Math]::Min(3200, $audio.Length - $offset)
                            $chunk = [byte[]]::new($count)
                            [Array]::Copy($audio, $offset, $chunk, 0, $count)
                            $current = if ($awake) { $command } else { $wake }
                            $complete = [HomeSyntheticVosk]::vosk_recognizer_accept_waveform($current, $chunk, $count)
                            if ($complete -lt 0) { throw 'Native decoding failed.' }
                            if ($complete -gt 0) {
                                $text = ([Runtime.InteropServices.Marshal]::PtrToStringUTF8([HomeSyntheticVosk]::vosk_recognizer_result($current)) | ConvertFrom-Json).text
                                if (-not $awake) {
                                    if ($text -eq 'hey luna') { $awake = $true; $wakeEnd = ($offset + $count) / 32 }
                                } else {
                                    $policy.StandardInput.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
                                    $policy.StandardInput.Flush()
                                    $detail = $policy.StandardOutput.ReadLine()
                                    if (-not $detail) { throw 'Policy classification failed.' }
                                    if ($detail -eq 'SUPPORTED_TIMER:5') { $matched = $true; break }
                                    $rejections += $detail
                                }
                            }
                        }
                        $row = [pscustomobject]@{
                            voice = $token.GetDescription(); rate = $rate; repeat = $repeat; addedGapMs = $gap
                            commandOnly = $direct; wakeMatched = (-not $direct -and $awake)
                            expectedCommandMatched = $matched; rejectedFinalCodes = $rejections
                            # SAPI audio includes its own pauses; this is a byte boundary, not speech onset.
                            commandBufferBeforeSwitchMs = $(if ($direct -or $wakeEnd -lt 0) { 0 } else { [Math]::Max(0, $wakeEnd - $wakeAudio.Length / 32 - $gap) })
                        }
                        $rows += $row
                        $row | ConvertTo-Json -Compress
                    } finally {
                        if ($wake -ne [IntPtr]::Zero) { [HomeSyntheticVosk]::vosk_recognizer_free($wake) }
                        if ($command -ne [IntPtr]::Zero) { [HomeSyntheticVosk]::vosk_recognizer_free($command) }
                    }
                }
            }
        }
        $voiceIndex++
    }
    $fixtures | Set-Content -LiteralPath "$output/fixtures/manifest.txt" -Encoding ascii
    $rows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$output/results.json" -Encoding utf8
    Write-Output 'Synthetic experiment complete. Inspect result codes; failures are observations, not Android qualification.'
} finally {
    if ($null -ne $policy) {
        $policy.StandardInput.Close()
        if (-not $policy.WaitForExit(5000)) { $policy.Kill() }
        $policy.Dispose()
    }
    if ($null -ne $voice) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice) | Out-Null }
    if ($model -ne [IntPtr]::Zero) { [HomeSyntheticVosk]::vosk_model_free($model) }
    [HomeSyntheticVosk]::SetDllDirectory($null) | Out-Null
}
