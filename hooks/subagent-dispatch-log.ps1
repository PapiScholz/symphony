# subagent-dispatch-log.ps1 — observador puro de dispatches de subagentes.
#
# Registra, por cada llamada al tool Agent/Task, qué modelo y effort se pidieron.
# Su razón de ser: `model` omitido significa `inherit`, y esa omisión es invisible
# en la transcripción — el log la vuelve visible después del hecho.
#
# INVARIANTE: este hook NUNCA bloquea y NUNCA escribe a stdout.
# Un PreToolUse que deniega obliga al modelo a reintentar la llamada, y ese
# reintento lo paga el usuario en tokens. Por eso todo el cuerpo va dentro de un
# try/catch que termina en `exit 0`: si el log falla, se pierde una línea de
# telemetría y nada más. Nunca se interpone en el trabajo.
#
# Registrado en ~/.claude/settings.json -> hooks.PreToolUse, matcher "Agent|Task".

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload = $raw | ConvertFrom-Json
    $ti = $payload.tool_input
    if ($null -eq $ti) { exit 0 }

    # `model` ausente es el caso que interesa registrar, no uno a descartar.
    $model = if ($ti.model) { [string]$ti.model } else { 'INHERITED' }
    $effort = if ($ti.effort) { [string]$ti.effort } else { 'inherited' }
    $type = if ($ti.subagent_type) { [string]$ti.subagent_type } else { 'general-purpose' }
    $desc = if ($ti.description) { [string]$ti.description } else { '' }

    $entry = [ordered]@{
        ts      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        session = [string]$payload.session_id
        tool    = [string]$payload.tool_name
        type    = $type
        model   = $model
        effort  = $effort
        desc    = $desc
    }

    $line = ($entry | ConvertTo-Json -Compress -Depth 3)
    $logPath = Join-Path $env:USERPROFILE '.claude\subagent-runs.jsonl'

    # Rotación barata: si pasa ~4000 líneas, conservar la cola.
    if (Test-Path $logPath) {
        $info = Get-Item $logPath
        if ($info.Length -gt 1MB) {
            $tail = Get-Content $logPath -Tail 2000
            [System.IO.File]::WriteAllLines($logPath, $tail, (New-Object System.Text.UTF8Encoding($false)))
        }
    }

    # UTF8Encoding($false) = sin BOM. Windows PowerShell 5.1 escribe BOM con -Encoding utf8
    # y un BOM a mitad de archivo rompe el parseo linea por linea del JSONL.
    [System.IO.File]::AppendAllText($logPath, $line + "`n", (New-Object System.Text.UTF8Encoding($false)))
}
catch {
    # Silencio deliberado: un hook roto no debe ser un problema del usuario.
}

exit 0
