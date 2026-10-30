#requires -Version 7.0
param(
    [Parameter(Mandatory)][string] $PrivateLauncher,
    [string] $TaskName = 'LunaOS Home Vehicle Host'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$launcher = (Resolve-Path -LiteralPath $PrivateLauncher).Path
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($launcher.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($launcher) -ne '.mjs' -or $launcher.Contains('"')) { throw 'Use a private external .mjs credential launcher.' }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Task already exists; inspect it before changing startup.' }
$pwsh = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$node = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$runner = Join-Path $PSScriptRoot 'start-vehicle-host.ps1'
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
# Existing launcher resolves credentials at runtime; no credentials in task arguments.
$action = New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoProfile -WindowStyle Hidden -File "' + $runner + '" -PrivateLauncher "' + $launcher + '" -NodeExecutable "' + $node + '"') -WorkingDirectory ([IO.Path]::GetDirectoryName($launcher))
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Write-Output 'Registered current-user logon startup with three crash retries. Sign-in and an awake computer are required. No boot-before-login or sleep-policy change.'
