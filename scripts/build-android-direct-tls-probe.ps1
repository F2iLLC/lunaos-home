#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $OutputDirectory,
    [Parameter(Mandatory)][string] $DebugKeystore,
    [Parameter(Mandatory)][string] $FixtureDirectory,
    [ValidateSet('All','Compile','Package')][string] $Stage = 'All',
    [string] $Sdk = $env:ANDROID_HOME,
    [string] $Jdk = $env:JAVA_HOME
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    (($Stage -ne 'Package') -and (Test-Path -LiteralPath $output))) { throw 'Choose a new output directory outside the checkout.' }
for ($cursor = $output; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Linked output ancestor.'
    }
}
function Invoke-DirectTlsTool([string] $Tool, [string[]] $ToolArgs) {
    & $Tool @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "Test build failed: $([IO.Path]::GetFileName($Tool))" }
}
$buildTools = Join-Path $Sdk 'build-tools/37.0.0'
$androidJar = Join-Path $Sdk 'platforms/android-37.0/android.jar'
$source = Join-Path $PSScriptRoot 'android-direct-tls-probe'
$classes = Join-Path $output 'classes'
$dex = Join-Path $output 'dex'
if ($Stage -eq 'Package' -and (!(Test-Path -LiteralPath "$output/compile-complete.txt") -or
    [IO.File]::ReadAllText("$output/compile-complete.txt") -ne 'Disposable direct TLS compilation complete')) {
    throw 'Package only a completed disposable compile directory.'
}
[IO.Directory]::CreateDirectory($classes) | Out-Null
[IO.Directory]::CreateDirectory($dex) | Out-Null
$savedJava = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $Jdk
    if ($Stage -ne 'Package') {
    Invoke-DirectTlsTool "$Jdk/bin/javac.exe" @('-encoding','UTF-8','-source','8','-target','8','-classpath',$androidJar,'-d',$classes,"$source/DirectTlsProbe.java","$source/SyntheticTlsClient.java","$source/VersionedEditState.java","$source/PairingActivity.java","$source/DirectTlsRaceProbe.java","$source/NativeIdentity.java","$source/FixtureConfig.java","$source/IdentityProbe.java")
    Invoke-DirectTlsTool "$Jdk/bin/jar.exe" @('--create','--file',"$output/classes.jar",'-C',$classes,'.')
    Invoke-DirectTlsTool "$buildTools/d8.bat" @('--min-api','30','--lib',$androidJar,'--output',$dex,"$output/classes.jar")
        [IO.File]::WriteAllText("$output/compile-complete.txt", 'Disposable direct TLS compilation complete')
    }
    if ($Stage -eq 'Compile') { Write-Output 'Compilation complete; no pairing offer packaged.'; return }
    $assets = Join-Path $output 'assets'
    [IO.Directory]::CreateDirectory($assets) | Out-Null
    foreach ($name in @('ca.pem')) {
        $item = Get-Item -LiteralPath (Join-Path $FixtureDirectory $name) -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 16384) {
            throw 'Expected a small regular disposable fixture file.'
        }
        Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $assets $name)
    }
    Invoke-DirectTlsTool "$buildTools/aapt2.exe" @('link','-A',$assets,'-I',$androidJar,'--manifest',"$source/AndroidManifest.xml",'-o',"$output/unsigned.apk")
    Invoke-DirectTlsTool "$Jdk/bin/jar.exe" @('--update','--file',"$output/unsigned.apk",'-C',$dex,'classes.dex')
    Invoke-DirectTlsTool "$buildTools/zipalign.exe" @('-p','4',"$output/unsigned.apk","$output/aligned.apk")
    # Standard Android debug keystore only; never accept release signing credentials.
    Invoke-DirectTlsTool "$buildTools/apksigner.bat" @('sign','--ks',$DebugKeystore,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',"$output/direct-tls-probe.apk","$output/aligned.apk")
    Invoke-DirectTlsTool "$buildTools/apksigner.bat" @('verify',"$output/direct-tls-probe.apk")
    Write-Output 'Built separate fictional TLS test package; Home unchanged.'
} finally { $env:JAVA_HOME = $savedJava }
