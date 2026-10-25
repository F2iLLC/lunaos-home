#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $OutputDirectory,
    [string] $Sdk = $env:ANDROID_HOME,
    [string] $Jdk = $env:JAVA_HOME
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Invoke-VehicleTool([string] $Tool, [string[]] $ToolArgs) {
    & $Tool @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "Vehicle build failed: $([IO.Path]::GetFileName($Tool))" }
}
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or $output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep build outputs and disposable signing material outside the checkout.'
}
if (Test-Path -LiteralPath $output) { throw 'Choose a new output directory; existing work is preserved.' }
for ($cursor = [IO.Path]::GetDirectoryName($output); $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked output ancestor.' }
}
$buildTools = Join-Path $Sdk 'build-tools/37.0.0'
$androidJar = Join-Path $Sdk 'platforms/android-37.0/android.jar'
$javac = Join-Path $Jdk 'bin/javac.exe'
$jar = Join-Path $Jdk 'bin/jar.exe'
$keytool = Join-Path $Jdk 'bin/keytool.exe'
foreach ($tool in @($androidJar, $javac, $jar, $keytool, "$buildTools/aapt2.exe", "$buildTools/d8.bat", "$buildTools/zipalign.exe", "$buildTools/apksigner.bat")) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw 'Install Android SDK37 and JDK first.' }
}
$classes = Join-Path $output 'classes'
$dex = Join-Path $output 'dex'
[IO.Directory]::CreateDirectory($classes) | Out-Null
[IO.Directory]::CreateDirectory($dex) | Out-Null
# Derive components/permissions from the actual Home debug manifest. The test
# launcher is the only exported UI; Home keeps that same screen non-exported.
$manifestModule = (Join-Path $PSScriptRoot 'prepare-android.mjs').Replace('\', '/')
$manifestPath = Join-Path $output 'AndroidManifest.xml'
# A file URL passed as an argument avoids interpolating paths into JavaScript.
$manifestCode = @'
const { vaultDebugManifest } = await import(process.argv[1]);
let xml = vaultDebugManifest.replace('<manifest ', '<manifest package="io.github.f2illc.lunaos.home.vehicleprobe" ')
  .replace('<application>', '<uses-sdk android:minSdkVersion="31" android:targetSdkVersion="36" /><application android:label="Vehicle Preview" android:debuggable="true" android:allowBackup="false" android:usesCleartextTraffic="false">')
  .replace(/\s*<activity android:name="(?:\.VaultActivity|io.github.f2illc.lunaos.directtlsprobe.PairingActivity)"[^>]*\/>/g, '')
  .replace(/\s*<receiver android:name="androidx.profileinstaller.ProfileInstallReceiver"[^>]*\/>/g, '')
  .replace('<activity android:name="io.github.f2illc.lunaos.home.vehicle.VehicleSetupActivity" android:exported="false" />', '<activity android:name="io.github.f2illc.lunaos.home.vehicle.VehicleSetupActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter></activity>')
  .replace('</manifest>', '<instrumentation android:name="io.github.f2illc.lunaos.directtlsprobe.VehicleProbe" android:targetPackage="io.github.f2illc.lunaos.home.vehicleprobe" /></manifest>');
process.stdout.write(xml);
'@
$manifestUrl = ([Uri]$manifestModule).AbsoluteUri
$manifest = & node --input-type=module -e $manifestCode $manifestUrl
if ($LASTEXITCODE -ne 0) { throw 'Manifest generation failed.' }
[IO.File]::WriteAllText($manifestPath, ($manifest -join "`n"))
$sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'android/vehicle') -Filter '*.java' | ForEach-Object FullName)
$sources += @('VehicleTransport.java', 'SyntheticTlsClient.java', 'VersionedEditState.java', 'NativeIdentity.java', 'FixtureConfig.java', 'VehicleProbe.java') | ForEach-Object { Join-Path $PSScriptRoot "android-direct-tls-probe/$_" }
$savedJava = $env:JAVA_HOME
$savedPassword = $env:LUNA_VEHICLE_SIGNING_PASSWORD
try {
    $env:JAVA_HOME = $Jdk
    $env:LUNA_VEHICLE_SIGNING_PASSWORD = 'disposable-vehicle-preview'
    Invoke-VehicleTool $javac (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $androidJar, '-d', $classes) + $sources)
    Invoke-VehicleTool $jar @('--create', '--file', "$output/classes.jar", '-C', $classes, '.')
    Invoke-VehicleTool "$buildTools/d8.bat" @('--min-api', '31', '--lib', $androidJar, '--output', $dex, "$output/classes.jar")
    Invoke-VehicleTool "$buildTools/aapt2.exe" @('link', '-I', $androidJar, '--manifest', $manifestPath, '-o', "$output/unsigned.apk")
    Invoke-VehicleTool $jar @('--update', '--file', "$output/unsigned.apk", '-C', $dex, 'classes.dex')
    Invoke-VehicleTool "$buildTools/zipalign.exe" @('-p', '4', "$output/unsigned.apk", "$output/aligned.apk")
    Invoke-VehicleTool $keytool @('-genkeypair', '-keystore', "$output/development.p12", '-storetype', 'PKCS12', '-alias', 'vehicle', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=Disposable Home Vehicle Preview', '-storepass:env', 'LUNA_VEHICLE_SIGNING_PASSWORD', '-keypass:env', 'LUNA_VEHICLE_SIGNING_PASSWORD')
    Invoke-VehicleTool "$buildTools/apksigner.bat" @('sign', '--ks', "$output/development.p12", '--ks-pass', 'env:LUNA_VEHICLE_SIGNING_PASSWORD', '--out', "$output/vehicle.apk", "$output/aligned.apk")
    Invoke-VehicleTool "$buildTools/apksigner.bat" @('verify', "$output/vehicle.apk")
    Write-Output 'Built and verified isolated vehicle harness from Home sources. No installation performed.'
} finally { $env:JAVA_HOME = $savedJava; $env:LUNA_VEHICLE_SIGNING_PASSWORD = $savedPassword }
