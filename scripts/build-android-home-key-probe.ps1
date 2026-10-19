#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $OutputDirectory,
    [Parameter(Mandatory)][string] $DebugKeystore,
    [string] $Sdk = $env:ANDROID_HOME,
    [string] $Jdk = $env:JAVA_HOME
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $output)) { throw 'Choose a new output directory outside the checkout.' }
for ($cursor = [IO.Path]::GetDirectoryName($output); $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Linked output ancestor.'
    }
}
function Invoke-KeyProbeTool([string] $Tool, [string[]] $ToolArgs) {
    & $Tool @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "Test build failed: $([IO.Path]::GetFileName($Tool))" }
}
$buildTools = Join-Path $Sdk 'build-tools/37.0.0'
$androidJar = Join-Path $Sdk 'platforms/android-37.0/android.jar'
$source = Join-Path $PSScriptRoot 'android-home-key-probe'
$classes = Join-Path $output 'classes'
$dex = Join-Path $output 'dex'
[IO.Directory]::CreateDirectory($classes) | Out-Null
[IO.Directory]::CreateDirectory($dex) | Out-Null
$savedJava = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $Jdk
    Invoke-KeyProbeTool "$Jdk/bin/javac.exe" @('-encoding','UTF-8','-source','8','-target','8','-classpath',$androidJar,'-d',$classes,"$source/HomeKeyProbe.java","$source/HomeQueueProbe.java","$source/HomeStoreProbe.java")
    Invoke-KeyProbeTool "$Jdk/bin/jar.exe" @('--create','--file',"$output/classes.jar",'-C',$classes,'.')
    Invoke-KeyProbeTool "$buildTools/d8.bat" @('--min-api','30','--lib',$androidJar,'--output',$dex,"$output/classes.jar")
    Invoke-KeyProbeTool "$buildTools/aapt2.exe" @('link','-I',$androidJar,'--manifest',"$source/AndroidManifest.xml",'-o',"$output/unsigned.apk")
    Invoke-KeyProbeTool "$Jdk/bin/jar.exe" @('--update','--file',"$output/unsigned.apk",'-C',$dex,'classes.dex')
    Invoke-KeyProbeTool "$buildTools/zipalign.exe" @('-p','4',"$output/unsigned.apk","$output/aligned.apk")
    # Standard Android debug keystore only; never accept release signing credentials.
    Invoke-KeyProbeTool "$buildTools/apksigner.bat" @('sign','--ks',$DebugKeystore,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',"$output/home-key-probe.apk","$output/aligned.apk")
    Invoke-KeyProbeTool "$buildTools/apksigner.bat" @('verify',"$output/home-key-probe.apk")
    Write-Output 'Built emulator-only synthetic key-loss and queued-work probes; nothing installed or executed.'
} finally { $env:JAVA_HOME = $savedJava }
