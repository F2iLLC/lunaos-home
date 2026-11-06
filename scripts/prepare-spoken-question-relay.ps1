#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $OutputDirectory,
    [Parameter(Mandatory)][string] $EnvFile,
    [Parameter(Mandatory)][string] $VoiceId,
    [string] $Model = 'qwen3:32b'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if ($output.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
    $output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $output)) { throw 'Choose a new private directory outside Git.' }
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf) -or $VoiceId -notmatch '^[A-Za-z0-9]{20,64}$') { throw 'Private inputs unavailable.' }
[IO.Directory]::CreateDirectory($output) | Out-Null
# Limit the new configuration directory to this Windows identity and SYSTEM.
$acl = Get-Acl -LiteralPath $output
$acl.SetAccessRuleProtection($true, $false)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $output -AclObject $acl
$rsa = [Security.Cryptography.RSA]::Create(2048)
$certificate = $null
try {
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddDnsName('localhost'); $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(30))
    $pem = $certificate.ExportCertificatePem()
    [IO.File]::WriteAllText((Join-Path $output 'relay-cert.pem'), $pem)
    [IO.File]::WriteAllText((Join-Path $output 'relay-key.pem'), $rsa.ExportPkcs8PrivateKeyPem())
    $token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    @{enabled=$true;provider='ollama-qwen';bindAddress='127.0.0.1';ollamaEndpoint='http://127.0.0.1:11434/api/chat';
        envFile=[IO.Path]::GetFullPath($EnvFile);voiceId=$VoiceId;model=$Model;token=$token;
        cert=(Join-Path $output 'relay-cert.pem');key=(Join-Path $output 'relay-key.pem')} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'host.json')
    @{endpoint='https://localhost:18743/question';certificate=$pem;token=$token} | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $output 'question-relay.json')
    Write-Output 'Private relay configuration prepared. No provider keys copied; no capture or service started.'
} finally { $rsa.Dispose(); if ($certificate) { $certificate.Dispose() } }
