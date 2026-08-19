#!/bin/sh
# subagent-dispatch-log.sh — observador puro de dispatches de subagentes.
#
# Registra, por cada llamada al tool Agent/Task, que modelo y effort se pidieron.
# Su razon de ser: `model` omitido significa `inherit`, y esa omision es invisible
# en la transcripcion — el log la vuelve visible despues del hecho.
#
# INVARIANTE: este hook NUNCA bloquea y NUNCA escribe a stdout.
# Un PreToolUse que deniega obliga al modelo a reintentar la llamada, y ese
# reintento lo paga el usuario en tokens. Por eso todo el cuerpo esta escrito
# para que ningun error escape: sin `set -e`, cada paso que puede fallar
# queda contenido, y el script siempre termina en `exit 0`. Si el log falla,
# se pierde una linea de telemetria y nada mas. Nunca se interpone en el trabajo.
#
# Registrado en ~/.claude/settings.json -> hooks.PreToolUse, matcher "Agent|Task".
#
# Portable a bash/dash/POSIX sh en Linux y macOS (userland BSD). Usa jq si esta
# disponible; si no, degrada a un parser JSON minimo escrito en awk (portable
# entre gawk, mawk y el awk de BSD/macOS).

LOG="${SYMPHONY_LOG:-$HOME/.claude/subagent-runs.jsonl}"
MISSING_MARKER='@@__SDL_MISSING__@@'

# Marca de campo ausente para el fallback en awk (evita colisionar con texto real).
run() {
    raw=$(cat)

    # Vacio o solo whitespace -> nada que registrar, no es un error.
    stripped=$(printf '%s' "$raw" | tr -d '[:space:]')
    if [ -z "$stripped" ]; then
        return 0
    fi

    # Chequeo barato de forma: si no arranca con '{' (ignorando whitespace
    # inicial), no vale la pena intentar parsear — ni con jq ni a mano.
    trimmed=$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//')
    case "$trimmed" in
        "{"*) : ;;
        *) return 0 ;;
    esac

    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)
    if [ -z "$ts" ]; then
        return 0
    fi

    line=""
    if command -v jq >/dev/null 2>&1; then
        line=$(printf '%s' "$raw" | jq -c --arg ts "$ts" '
            {
                ts:      $ts,
                session: ((.session_id // "") | tostring),
                tool:    ((.tool_name // "") | tostring),
                type:    ((.tool_input.subagent_type // "general-purpose") | tostring),
                model:   ((.tool_input.model // "INHERITED") | tostring),
                effort:  ((.tool_input.effort // "inherited") | tostring),
                desc:    ((.tool_input.description // "") | tostring)
            }
        ' 2>/dev/null)
    fi

    # Sin jq, o jq fallo (JSON invalido) -> fallback en awk.
    if [ -z "$line" ]; then
        line=$(RAW_JSON="$raw" TS_VAL="$ts" MISSING="$MISSING_MARKER" awk '
            BEGIN {
                json = ENVIRON["RAW_JSON"]
                ts = ENVIRON["TS_VAL"]
                miss = ENVIRON["MISSING"]

                session = extract(json, "session_id"); if (session == miss) session = ""
                tool    = extract(json, "tool_name");  if (tool == miss) tool = ""
                type    = extract(json, "subagent_type"); if (type == miss) type = "general-purpose"
                model   = extract(json, "model");      if (model == miss) model = "INHERITED"
                effort  = extract(json, "effort");     if (effort == miss) effort = "inherited"
                desc    = extract(json, "description"); if (desc == miss) desc = ""

                printf "{\"ts\":\"%s\",\"session\":\"%s\",\"tool\":\"%s\",\"type\":\"%s\",\"model\":\"%s\",\"effort\":\"%s\",\"desc\":\"%s\"}\n", \
                    esc(ts), esc(session), esc(tool), esc(type), esc(model), esc(effort), esc(desc)
            }

            # Busca "key": "..." en el JSON crudo y devuelve el valor con los
            # escapes JSON basicos (\" \ \n \t \r) resueltos. No es un parser
            # JSON completo — alcanza para el shape fijo de este payload.
            function extract(j, key,    re, start, i, c, out, inesc, n) {
                re = "\"" key "\"[ \t\n]*:[ \t\n]*\""
                start = match(j, re)
                if (start == 0) return ENVIRON["MISSING"]
                start = start + RLENGTH
                out = ""
                inesc = 0
                n = length(j)
                for (i = start; i <= n; i++) {
                    c = substr(j, i, 1)
                    if (inesc) {
                        if (c == "n") out = out "\n"
                        else if (c == "t") out = out "\t"
                        else if (c == "r") out = out "\r"
                        else out = out c
                        inesc = 0
                    } else {
                        if (c == "\\") inesc = 1
                        else if (c == "\"") return out
                        else out = out c
                    }
                }
                return out
            }

            # Re-escapa para volver a meter el valor en JSON de salida.
            function esc(s,    out, i, c, n) {
                out = ""
                n = length(s)
                for (i = 1; i <= n; i++) {
                    c = substr(s, i, 1)
                    if (c == "\\") out = out "\\\\"
                    else if (c == "\"") out = out "\\\""
                    else if (c == "\n") out = out "\n"
                    else if (c == "\r") out = out "\r"
                    else if (c == "\t") out = out "\t"
                    else out = out c
                }
                return out
            }
        ' 2>/dev/null)
    fi

    if [ -z "$line" ]; then
        return 0
    fi

    logdir=$(dirname "$LOG" 2>/dev/null)
    mkdir -p "$logdir" 2>/dev/null

    # Rotacion barata: si el log supera ~1MB, conservar solo las ultimas 2000 lineas.
    if [ -f "$LOG" ]; then
        size=$(wc -c < "$LOG" 2>/dev/null | tr -d ' ')
        if [ -n "$size" ]; then
            over=$(awk -v s="$size" 'BEGIN { print (s > 1048576) ? 1 : 0 }' 2>/dev/null)
            if [ "$over" = "1" ]; then
                tmp="${LOG}.tmp.$$"
                if tail -n 2000 "$LOG" > "$tmp" 2>/dev/null; then
                    mv "$tmp" "$LOG" 2>/dev/null
                else
                    rm -f "$tmp" 2>/dev/null
                fi
            fi
        fi
    fi

    # Sin BOM (printf no lo agrega), terminador LF. Append atomico de una linea.
    printf '%s\n' "$line" >> "$LOG" 2>/dev/null

    return 0
}

run
exit 0
