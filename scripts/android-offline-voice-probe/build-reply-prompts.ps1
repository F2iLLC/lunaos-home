param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::Adult, 0, [Globalization.CultureInfo]::GetCultureInfo('en-US'))
    $clips = @{
        started = 'started for'; extended = 'extended by'; canceled = 'canceled';
        seconds = 'seconds'; minutes = 'minutes'; second = 'second'; minute = 'minute';
        ambiguous = 'More than one timer is active. Say the timer number, for example, cancel timer one, or add one minute to timer two.';
        full = 'Eight timers are already active. Cancel one first.';
        inactive = 'That timer is not active.';
        limit = 'A timer cannot exceed twenty four hours. Nothing changed.';
        failed = 'Timer change failed or is uncertain. Check the timer list before retrying.';
        unsupported = 'Unsupported timer command. Nothing changed.'
    }
    for ($id = 1; $id -le 8; $id++) { $clips["timer-$id"] = "Timer $id" }
    for ($n = 1; $n -le 60; $n++) { $clips["number-$n"] = [string]$n }
    foreach ($item in $clips.GetEnumerator()) {
        $voice.SetOutputToWaveFile((Join-Path $OutputDirectory ($item.Key + '.wav')))
        $voice.Speak($item.Value)
        $voice.SetOutputToNull()
    }
} finally { $voice.Dispose() }
