#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $HostConfig,
    [Parameter(Mandatory)][string] $PhoneConfig,
    [Parameter(Mandatory)][string] $PhoneVpnAddress
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach ($file in @($HostConfig, $PhoneConfig)) {
    if (-not [IO.Path]::IsPathFullyQualified($file)) { throw 'Use absolute private configuration paths.' }
    $resolved = (Resolve-Path -LiteralPath $file).Path
    if ($resolved.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Keep runtime configuration outside the checkout.' }
}
function Test-OverlayAddress([string] $Address) {
    if ($Address -notmatch '^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
    $parsed = $null
    return [Net.IPAddress]::TryParse($Address, [ref]$parsed) -and $parsed.ToString() -eq $Address -and
        [int]$Matches[1] -ge 64 -and [int]$Matches[1] -le 127
}
if (-not (Test-OverlayAddress $PhoneVpnAddress)) { throw 'Use the enrolled phone Tailscale IPv4 address.' }
$tailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
$stateText = & $tailscale status --json
if ($LASTEXITCODE -ne 0) { throw 'Tailscale status unavailable.' }
$state = $stateText | ConvertFrom-Json
if ($state.BackendState -ne 'Running') { throw 'Complete owner Tailscale sign-in first.' }
$hostAddress = @($state.TailscaleIPs | Where-Object { Test-OverlayAddress $_ })
if ($hostAddress.Count -ne 1) { throw 'Expected one host overlay IPv4 address.' }
$peers = @($state.Peer.PSObject.Properties.Value | Where-Object { $_.Online -and $PhoneVpnAddress -in $_.TailscaleIPs })
if ($peers.Count -ne 1) { throw 'Expected the selected phone online in the owner tailnet.' }
$interface = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $hostAddress[0])
if ($interface.Count -ne 1) { throw 'Overlay interface unavailable.' }
$hostBefore = [IO.File]::ReadAllText($HostConfig)
$phoneBefore = [IO.File]::ReadAllText($PhoneConfig)
$hostSettings = $hostBefore | ConvertFrom-Json
$phoneSettings = $phoneBefore | ConvertFrom-Json
if ($hostSettings.port -lt 1 -or $hostSettings.port -gt 65535 -or
    $hostSettings.vehicleConversations -ne $true -or $phoneSettings.vehicleConversations -ne $true) { throw 'Expected configured conversation endpoint with a stable port.' }
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$ruleName = 'LunaOS-Home-Vehicle-Overlay'
if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) { throw 'Existing overlay rule: inspect it before reconfiguring.' }
# No wildcard bind, public endpoint, subnet route, exit node or all-tailnet rule.
$rule = New-NetFirewallRule -Name $ruleName -DisplayName 'Home vehicle: enrolled phone over private overlay' `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $hostSettings.port -LocalAddress $hostAddress[0] `
    -RemoteAddress $PhoneVpnAddress -InterfaceAlias $interface[0].InterfaceAlias -Profile Any -Program $node
try {
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
    Copy-Item -LiteralPath $HostConfig -Destination ($HostConfig + '.before-vpn-' + $stamp)
    Copy-Item -LiteralPath $PhoneConfig -Destination ($PhoneConfig + '.before-vpn-' + $stamp)
    $hostSettings.bindAddress = $hostAddress[0]
    $phoneSettings.transportAddress = $hostAddress[0]
    $phoneSettings.port = $hostSettings.port
    $phoneSettings | Add-Member -NotePropertyName vehicleHarnessAdbReverse -NotePropertyValue $false -Force
    [IO.File]::WriteAllText($HostConfig, ($hostSettings | ConvertTo-Json -Depth 20))
    [IO.File]::WriteAllText($PhoneConfig, ($phoneSettings | ConvertTo-Json -Depth 20))
} catch {
    [IO.File]::WriteAllText($HostConfig, $hostBefore)
    [IO.File]::WriteAllText($PhoneConfig, $phoneBefore)
    $rule | Remove-NetFirewallRule
    throw 'Private configuration update failed; restored configuration and removed the new rule.'
}
Write-Output 'Prepared exact phone-to-host overlay rule and private destination configuration. Restart Home and provision the phone config through the trusted channel; then verify enrolled TLS with Wi-Fi disabled. Certificates, pins, identity and grants were preserved.'
