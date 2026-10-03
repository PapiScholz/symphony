# subagent-dispatch-log.ps1 — a pure observer of subagent dispatches.
#
# The PowerShell half of subagent-dispatch-log.sh. Records, for every call to the
# Agent/Task tool, which model and effort were requested. The reason it exists: an
# omitted `model` means `inherit`, and that omission is invisible in the
# transcript — the log makes it visible after the fact.
#
# INVARIANT: this hook NEVER blocks and NEVER writes to stdout.
# A PreToolUse hook that denies forces the model to retry the call, and the user
# pays for that retry in tokens. So the whole body sits inside a try/catch that
# ends in `exit 0`: if logging fails, one line of telemetry is lost and nothing
# else. It never gets in the way of the work.
#
# Registered in hooks/hooks.json -> hooks.PreToolUse, matcher "Agent|Task".

$ErrorActionPreference = 'SilentlyContinue'

# Stop markers for `stopHint`. They must be the SAME as STOP_MARKERS in
# subagent-dispatch-log.sh: the README calls the two scripts a pair, and they have
# drifted before (which is why scripts/check-hook-behavior.mjs exists).
#
# `stopHint` is a HEURISTIC: it tries to tell a mandate that says where to stop
# from one that asks for an open-ended survey. Lowercase ASCII, no accents, and it
# can give false positives. Every consumer labels it as a heuristic — the repo's
# CONTRIBUTING does not admit a number without that distinction. The full list of
# limitations is in the .sh half.
$StopMarkers = @(
    'stop when', 'stop after', 'first blocker', 'report the first',
    'at most', 'max turns', 'do not continue',
    'primer bloqueante', 'para cuando', 'como maximo', 'no sigas'
)

try {
    # Read stdin as UTF-8 bytes, not through [Console]::In. The console reader
    # decodes with the active code page, so on a non-UTF-8 Windows console every
    # non-ASCII character in the payload arrived as two or three wrong ones: the
    # description was logged garbled and the prompt length came out wrong.
    $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), (New-Object System.Text.UTF8Encoding($false)))
    $raw = $reader.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json
    $ti = $payload.tool_input
    if ($null -eq $ti) { exit 0 }

    # An absent `model` is the case worth recording, not one to discard.
    $model = if ($ti.model) { [string]$ti.model } else { 'INHERITED' }
    $effort = if ($ti.effort) { [string]$ti.effort } else { 'inherited' }
    $type = if ($ti.subagent_type) { [string]$ti.subagent_type } else { 'general-purpose' }
    $desc = if ($ti.description) { [string]$ti.description } else { '' }

    $prompt = if ($ti.prompt) { [string]$ti.prompt } else { '' }

    # ASCII-only lowercasing, to match jq's ascii_downcase and awk under LC_ALL=C.
    # ToLowerInvariant() also folds non-ASCII letters (the Kelvin sign becomes
    # 'k'), which would let this half find a marker the other half cannot.
    $lower = [regex]::Replace($prompt, '[A-Z]', { param($m) $m.Value.ToLowerInvariant() })
    $stopHint = $false
    foreach ($marker in $StopMarkers) {
        if ($lower.Contains($marker)) { $stopHint = $true; break }
    }

    $entry = [ordered]@{
        ts          = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        session     = [string]$payload.session_id
        tool        = [string]$payload.tool_name
        type        = $type
        model       = $model
        effort      = $effort
        desc        = $desc
        # UTF-8 bytes, like the .sh half. $prompt.Length would count UTF-16 units,
        # which disagrees with jq on anything outside the BMP (an emoji is 2 here).
        promptBytes = [System.Text.Encoding]::UTF8.GetByteCount($prompt)
        stopHint    = $stopHint
    }

    $line = ($entry | ConvertTo-Json -Compress -Depth 3)

    # SYMPHONY_LOG redirects the log, as in subagent-dispatch-log.sh. Without it the
    # two scripts are not the pair the README says they are, and the test of this
    # file would have nowhere to write but the real log of whoever runs the suite.
    # $HOME covers pwsh on Linux/macOS, where USERPROFILE does not exist.
    if ($env:SYMPHONY_LOG) {
        $logPath = $env:SYMPHONY_LOG
    }
    else {
        $home_ = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
        $logPath = Join-Path $home_ (Join-Path '.claude' 'subagent-runs.jsonl')
    }

    # Cheap rotation: past ~1MB, keep only the last 2000 lines.
    if (Test-Path $logPath) {
        $info = Get-Item $logPath
        if ($info.Length -gt 1MB) {
            $tail = Get-Content $logPath -Tail 2000 -Encoding utf8
            [System.IO.File]::WriteAllLines($logPath, $tail, (New-Object System.Text.UTF8Encoding($false)))
        }
    }

    # UTF8Encoding($false) = no BOM. Windows PowerShell 5.1 writes a BOM with
    # -Encoding utf8, and a BOM mid-file breaks line-by-line parsing of the JSONL.
    [System.IO.File]::AppendAllText($logPath, $line + "`n", (New-Object System.Text.UTF8Encoding($false)))
}
catch {
    # Deliberate silence: a broken hook must never be the user's problem.
}

exit 0
