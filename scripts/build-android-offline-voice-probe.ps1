#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $OutputDirectory,
    [Parameter(Mandatory)][string] $InputDirectory,
    [string] $ReplyDirectory,
    [string] $Sdk = $env:ANDROID_HOME,
    [string] $Jdk = $env:JAVA_HOME
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Invoke-ProbeTool([string] $Tool, [string[]] $ToolArgs) {
    & $Tool @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "Probe build tool failed: $([IO.Path]::GetFileName($Tool))" }
}
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Build outputs and disposable signing material must be outside the checkout.'
}
if (Test-Path -LiteralPath $output) { throw 'Choose a new output directory; existing work is never overwritten.' }
for ($cursor = [IO.Path]::GetDirectoryName($output); $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Choose an output without linked ancestors.'
    }
}
$source = Join-Path $PSScriptRoot 'android-offline-voice-probe'
$dependencies = Get-Content -Raw (Join-Path $source 'inputs.json') | ConvertFrom-Json
foreach ($dependency in $dependencies) {
    $inputPath = Join-Path $InputDirectory $dependency.file
    if ((Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash -ne $dependency.sha256) {
        throw "Dependency checksum mismatch: $($dependency.file)"
    }
}
$buildTools = Join-Path $Sdk 'build-tools/37.0.0'
$androidJar = Join-Path $Sdk 'platforms/android-37.0/android.jar'
$javac = Join-Path $Jdk 'bin/javac.exe'
$jar = Join-Path $Jdk 'bin/jar.exe'
$java = Join-Path $Jdk 'bin/java.exe'
$keytool = Join-Path $Jdk 'bin/keytool.exe'
foreach ($tool in @($androidJar, $javac, $jar, $java, $keytool, "$buildTools/aapt2.exe", "$buildTools/d8.bat", "$buildTools/zipalign.exe", "$buildTools/apksigner.bat")) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Install the documented JDK/SDK prerequisites first.' }
}
foreach ($dir in @('classes', 'tests', 'dex', 'assets', 'native/lib/armeabi-v7a')) {
    [IO.Directory]::CreateDirectory((Join-Path $output $dir)) | Out-Null
}
foreach ($name in @('vosk', 'jna', 'model')) {
    $file = if ($name -eq 'model') { 'model.zip' } else { "$name.aar" }
    [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $InputDirectory $file), (Join-Path $output $name))
}
Copy-Item -LiteralPath "$output/model/vosk-model-small-en-us-0.15" -Destination "$output/assets/model" -Recurse
Copy-Item -LiteralPath "$source/THIRD-PARTY-NOTICES.txt" -Destination "$output/assets/THIRD-PARTY-NOTICES.txt"
Copy-Item -LiteralPath "$repo/LICENSE" -Destination "$output/assets/HOME-LICENSE.txt"
foreach ($name in @('vosk', 'jna')) {
    Copy-Item -Path "$output/$name/jni/armeabi-v7a/*.so" -Destination "$output/native/lib/armeabi-v7a"
}
if (-not $ReplyDirectory) { $ReplyDirectory = Join-Path $InputDirectory 'replies' }
& "$source/copy-reply-prompts.ps1" -InputDirectory $ReplyDirectory -OutputDirectory "$output/assets/replies"
$savedJava = $env:JAVA_HOME
$savedPassword = $env:LUNA_VOICE_PROBE_SIGNING_PASSWORD
try {
    $env:JAVA_HOME = $Jdk
    $env:LUNA_VOICE_PROBE_SIGNING_PASSWORD = 'fictional-probe-only'
    Invoke-ProbeTool $javac @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-d', "$output/tests", "$source/TimerPhrase.java", "$source/TimerCommand.java", "$source/TimerLedger.java", "$source/TimerPhraseTest.java", "$source/TimerHandoffGate.java", "$source/TimerHandoffGateTest.java", "$source/WakeSession.java", "$source/QuestionPolicy.java", "$source/WakeSessionTest.java", "$source/PendingTimerRequest.java", "$source/PendingTimerRequestTest.java")
    Invoke-ProbeTool $java @('-cp', "$output/tests", 'io.github.f2illc.lunaos.home.voiceprobe.TimerPhraseTest')
    Invoke-ProbeTool $java @('-cp', "$output/tests", 'io.github.f2illc.lunaos.home.voiceprobe.TimerHandoffGateTest')
    Invoke-ProbeTool $java @('-cp', "$output/tests", 'io.github.f2illc.lunaos.home.voiceprobe.WakeSessionTest')
    Invoke-ProbeTool $java @('-cp', "$output/tests", 'io.github.f2illc.lunaos.home.voiceprobe.PendingTimerRequestTest')
    $classpath = "$androidJar;$output/vosk/classes.jar;$output/jna/classes.jar"
    Invoke-ProbeTool $javac @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $classpath, '-d', "$output/classes", "$source/TimerPhrase.java", "$source/CommandAudio.java", "$source/TimerCommand.java", "$source/TimerLedger.java", "$source/TimerHandoffGate.java", "$source/WakeSession.java", "$source/VoiceProbe.java", "$source/LunaFace.java", "$source/ProbeCapture.java", "$source/QuestionPolicy.java", "$source/QuestionReply.java", "$source/PendingTimerRequest.java", "$source/BackgroundWakeService.java", "$source/NativeTimers.java", "$source/TimerReceiver.java", "$source/TimerAlarmService.java", "$source/SpokenReply.java", "$source/ReplyPlan.java", "$source/PromptPlayer.java")
    Invoke-ProbeTool $jar @('--create', '--file', "$output/classes.jar", '-C', "$output/classes", '.')
    Invoke-ProbeTool "$buildTools/d8.bat" @('--min-api', '26', '--lib', $androidJar, '--output', "$output/dex", "$output/classes.jar", "$output/vosk/classes.jar", "$output/jna/classes.jar")
    Invoke-ProbeTool $keytool @('-genkeypair', '-keystore', "$output/probe.p12", '-storetype', 'PKCS12', '-alias', 'probe', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=Fictional Local Probe', '-storepass:env', 'LUNA_VOICE_PROBE_SIGNING_PASSWORD', '-keypass:env', 'LUNA_VOICE_PROBE_SIGNING_PASSWORD')
    Invoke-ProbeTool "$buildTools/aapt2.exe" @('link', '-I', $androidJar, '--manifest', "$source/AndroidManifest.xml", '-o', "$output/probe-unsigned.apk")
    # jar normalizes asset entry separators on Windows; aapt2 -A can emit backslashes.
    Invoke-ProbeTool $jar @('--update', '--file', "$output/probe-unsigned.apk", '-C', "$output/dex", 'classes.dex', '-C', "$output/native", 'lib', '-C', $output, 'assets')
    Invoke-ProbeTool $jar @('--update', '--file', "$output/probe-unsigned.apk", '--no-compress', '-C', $output, 'assets/replies')
    $archive = [IO.Compression.ZipFile]::OpenRead("$output/probe-unsigned.apk")
    try {
        if (@($archive.Entries | Where-Object { $_.FullName.Contains('\') }).Count) {
            throw 'APK contains non-portable entry paths.'
        }
        foreach ($entry in @('assets/model/am/final.mdl', 'assets/model/conf/model.conf',
            'assets/replies/timer-1.wav', 'assets/replies/started-60-minute.wav', 'assets/THIRD-PARTY-NOTICES.txt', 'lib/armeabi-v7a/libvosk.so', 'lib/armeabi-v7a/libjnidispatch.so')) {
            if (-not $archive.GetEntry($entry)) { throw "APK is missing required entry: $entry" }
        }
        foreach ($clip in (Get-Content -Raw "$source/reply-prompts.json" | ConvertFrom-Json)) {
            $entry = $archive.GetEntry("assets/replies/$($clip.id).wav")
            if (-not $entry -or $entry.Length -lt 4844 -or $entry.Length -ne $entry.CompressedLength) {
                throw "APK is missing an uncompressed reply: $($clip.id)"
            }
        }
    } finally { $archive.Dispose() }
    Invoke-ProbeTool "$buildTools/zipalign.exe" @('-p', '4', "$output/probe-unsigned.apk", "$output/probe-aligned.apk")
    Invoke-ProbeTool "$buildTools/apksigner.bat" @('sign', '--ks', "$output/probe.p12", '--ks-pass', 'env:LUNA_VOICE_PROBE_SIGNING_PASSWORD', '--out', "$output/probe.apk", "$output/probe-aligned.apk")
    Invoke-ProbeTool "$buildTools/apksigner.bat" @('verify', "$output/probe.apk")
    Write-Output 'Built and signature-verified the isolated ARM32 voice probe. No installation performed.'
} finally {
    $env:JAVA_HOME = $savedJava
    $env:LUNA_VOICE_PROBE_SIGNING_PASSWORD = $savedPassword
}
