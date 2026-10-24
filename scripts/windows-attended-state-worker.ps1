# Local developer fixture custody only. No file paths, credentials or OS UI.
#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
    $inputText = [Console]::In.ReadToEnd()
    if ($inputText.Length -gt 131072) { throw 'size' }
    $request = $inputText | ConvertFrom-Json -AsHashtable
    if ($request.Count -ne 2 -or $request.operation -cnotin @('protect', 'unprotect')) { throw 'request' }
    $bytes = [Convert]::FromBase64String($request.bytes)
    $purpose = [Text.Encoding]::UTF8.GetBytes('LunaOSHome:fictional-joined-restart:v1')
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($request.operation -ceq 'protect') {
        $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $purpose, $scope)
    } else {
        $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $purpose, $scope)
    }
    [Console]::Out.Write([Convert]::ToBase64String($result))
    exit 0
} catch {
    exit 1
} finally {
    if (Get-Variable bytes -ErrorAction SilentlyContinue) { [Array]::Clear($bytes) }
    if (Get-Variable result -ErrorAction SilentlyContinue) { [Array]::Clear($result) }
}
