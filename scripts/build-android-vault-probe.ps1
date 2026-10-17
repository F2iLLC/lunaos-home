#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $OutputDirectory,
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
$buildTools = Join-Path $Sdk 'build-tools/37.0.0'
$androidJar = Join-Path $Sdk 'platforms/android-37.0/android.jar'
$javac = Join-Path $Jdk 'bin/javac.exe'
$jar = Join-Path $Jdk 'bin/jar.exe'
$keytool = Join-Path $Jdk 'bin/keytool.exe'
foreach ($tool in @($androidJar, $javac, $jar, $keytool, "$buildTools/aapt2.exe", "$buildTools/d8.bat", "$buildTools/zipalign.exe", "$buildTools/apksigner.bat")) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Install the documented JDK/SDK prerequisites first.' }
}
$classes = Join-Path $output 'classes'
$dex = Join-Path $output 'dex'
[IO.Directory]::CreateDirectory($classes) | Out-Null
[IO.Directory]::CreateDirectory($dex) | Out-Null
$savedJava = $env:JAVA_HOME
$savedPassword = $env:LUNA_PROBE_SIGNING_PASSWORD
try {
    $env:JAVA_HOME = $Jdk
    # Disposable development-only key; not a production or secret password.
    $env:LUNA_PROBE_SIGNING_PASSWORD = 'fictional-probe-only'
    Invoke-ProbeTool $javac @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $androidJar, '-d', $classes, (Join-Path $PSScriptRoot 'android-vault-probe/VaultProbe.java'))
    Invoke-ProbeTool $jar @('--create', '--file', "$output/classes.jar", '-C', $classes, '.')
    Invoke-ProbeTool "$buildTools/d8.bat" @('--min-api', '24', '--lib', $androidJar, '--output', $dex, "$output/classes.jar")
    Invoke-ProbeTool "$buildTools/aapt2.exe" @('link', '-I', $androidJar, '--manifest', (Join-Path $PSScriptRoot 'android-vault-probe/AndroidManifest.xml'), '-o', "$output/unsigned.apk")
    Invoke-ProbeTool $jar @('--update', '--file', "$output/unsigned.apk", '-C', $dex, 'classes.dex')
    Invoke-ProbeTool "$buildTools/zipalign.exe" @('-p', '4', "$output/unsigned.apk", "$output/aligned.apk")
    Invoke-ProbeTool $keytool @('-genkeypair', '-keystore', "$output/probe.p12", '-storetype', 'PKCS12', '-alias', 'probe', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=Fictional Local Probe', '-storepass:env', 'LUNA_PROBE_SIGNING_PASSWORD', '-keypass:env', 'LUNA_PROBE_SIGNING_PASSWORD')
    Invoke-ProbeTool "$buildTools/apksigner.bat" @('sign', '--ks', "$output/probe.p12", '--ks-pass', 'env:LUNA_PROBE_SIGNING_PASSWORD', '--out', "$output/probe.apk", "$output/aligned.apk")
    Invoke-ProbeTool "$buildTools/apksigner.bat" @('verify', "$output/probe.apk")
    Write-Output 'Built and signature-verified the isolated synthetic probe. No device installation performed.'
} finally {
    $env:JAVA_HOME = $savedJava
    $env:LUNA_PROBE_SIGNING_PASSWORD = $savedPassword
}
