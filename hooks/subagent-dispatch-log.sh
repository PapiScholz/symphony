#!/bin/sh
# subagent-dispatch-log.sh — a pure observer of subagent dispatches.
#
# Records, for every call to the Agent/Task tool, which model and effort were
# requested. The reason it exists: an omitted `model` means `inherit`, and that
# omission is invisible in the transcript — the log makes it visible after the fact.
#
# INVARIANT: this hook NEVER blocks and NEVER writes to stdout.
# A PreToolUse hook that denies forces the model to retry the call, and the user
# pays for that retry in tokens. So the whole body is written so that no error
# escapes: no `set -e`, every step that can fail is contained, and the script
# always ends in `exit 0`. If logging fails, one line of telemetry is lost and
# nothing else. It never gets in the way of the work.
#
# Registered in hooks/hooks.json -> hooks.PreToolUse, matcher "Agent|Task".
#
# Portable to bash/dash/POSIX sh on Linux and macOS (BSD userland). Uses jq when
# available; otherwise degrades to a minimal JSON parser written in awk (portable
# across gawk, mawk and the BSD/macOS awk).

LOG="${SYMPHONY_LOG:-$HOME/.claude/subagent-runs.jsonl}"

# Stop markers for `stopHint`. The list lives here, in plain sight, rather than
# hidden inside a regex, because `stopHint` is a HEURISTIC and whoever reads the
# log has to be able to judge it without reading the code. It must be identical
# to $StopMarkers in subagent-dispatch-log.ps1.
#
# What it tries to catch: a mandate that tells the subagent where to stop
# ("report the first blocker and stop") instead of asking for an open-ended
# survey. A dispatch without one is not wrong in itself, but it is the kind that
# runs to six figures of tokens, and until now nothing told it apart from a
# bounded one. The Spanish markers are there because prompts are written in
# whatever language the user works in.
#
# LIMITATIONS, which matter as much as the list:
#  - Lowercase ASCII only, matched against an ASCII-lowercased prompt. "como
#    maximo" matches; "como máximo" with an accent does not. Accents are not
#    normalised on purpose: doing that in awk over multibyte UTF-8 is fragile, and
#    a false negative here is cheap — the field is a hint, not a gate.
#  - A prompt can carry a marker and still have no real bound. This is a hint
#    about the SHAPE of the mandate, not a measurement of its effect.
#
# Every consumer of this field must present it as a heuristic. The repo's
# CONTRIBUTING is explicit: a number is published reproducible or labelled.
STOP_MARKERS="stop when|stop after|first blocker|report the first|at most|max turns|do not continue|primer bloqueante|para cuando|como maximo|no sigas"

# Sentinel for "field absent" in the awk fallback (chosen not to collide with real text).
MISSING_MARKER='@@__SDL_MISSING__@@'

run() {
    raw=$(cat)

    # Empty or whitespace-only -> nothing to record, and not an error.
    stripped=$(printf '%s' "$raw" | tr -d '[:space:]')
    if [ -z "$stripped" ]; then
        return 0
    fi

    # Cheap shape check: if it does not start with '{' (ignoring leading
    # whitespace), it is not worth parsing — neither with jq nor by hand.
    trimmed=$(printf '%s' "$raw" | sed -e 's/^[[:space:]]*//')
    case "$trimmed" in
        "{"*) : ;;
        *) return 0 ;;
    esac

    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)
    if [ -z "$ts" ]; then
        return 0
    fi

    # `promptBytes` is the prompt's length in UTF-8 BYTES, decoded (escapes
    # resolved). Bytes, not characters, because bytes are the only unit all three
    # parsers can agree on: jq's `length` counts code points, PowerShell's counts
    # UTF-16 units, and awk's depends on the locale (mawk never counts characters).
    # Measured before this was settled: a 26-character Spanish prompt logged 26
    # under jq and 29 under awk and pwsh, so the number depended on the machine.
    line=""
    if command -v jq >/dev/null 2>&1; then
        line=$(printf '%s' "$raw" | jq -c --arg ts "$ts" --arg markers "$STOP_MARKERS" '
            ((.tool_input.prompt // "") | tostring) as $prompt
            | ($prompt | ascii_downcase) as $lower
            | {
                ts:      $ts,
                session: ((.session_id // "") | tostring),
                tool:    ((.tool_name // "") | tostring),
                type:    ((.tool_input.subagent_type // "general-purpose") | tostring),
                model:   ((.tool_input.model // "INHERITED") | tostring),
                effort:  ((.tool_input.effort // "inherited") | tostring),
                desc:    ((.tool_input.description // "") | tostring),
                promptBytes: ($prompt | utf8bytelength),
                stopHint: (($markers | split("|")) | any(. as $m | $lower | contains($m)))
            }
        ' 2>/dev/null)
    fi

    # No jq, or jq failed (invalid JSON, or a jq too old for utf8bytelength) -> awk.
    #
    # LC_ALL=C makes awk byte-oriented on every implementation: length() counts
    # bytes and tolower() touches ASCII only, which is exactly what jq's
    # utf8bytelength and ascii_downcase do. Multibyte characters pass through
    # substr() byte by byte and are reassembled unchanged in the output.
    if [ -z "$line" ]; then
        line=$(RAW_JSON="$raw" TS_VAL="$ts" MISSING="$MISSING_MARKER" MARKERS="$STOP_MARKERS" LC_ALL=C awk '
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
                prompt  = extract(json, "prompt");      if (prompt == miss) prompt = ""

                # Counted on the DECODED text, the same as the jq branch: counting
                # the raw JSON would give a prompt with quotes a different number
                # depending on which branch ran.
                printf "{\"ts\":\"%s\",\"session\":\"%s\",\"tool\":\"%s\",\"type\":\"%s\",\"model\":\"%s\",\"effort\":\"%s\",\"desc\":\"%s\",\"promptBytes\":%d,\"stopHint\":%s}\n", \
                    esc(ts), esc(session), esc(tool), esc(type), esc(model), esc(effort), esc(desc), \
                    length(prompt), (has_stop_marker(prompt) ? "true" : "false")
            }

            # Returns 1 if the prompt contains any of the markers in MARKERS.
            # tolower() is enough: the markers are already lowercase ASCII (see
            # the STOP_MARKERS comment above, with its limitations).
            function has_stop_marker(p,    lower, n, i, parts) {
                lower = tolower(p)
                n = split(ENVIRON["MARKERS"], parts, "|")
                for (i = 1; i <= n; i++) {
                    if (parts[i] != "" && index(lower, parts[i]) > 0) return 1
                }
                return 0
            }

            # Finds "key": "..." in the raw JSON and returns the value with the
            # basic JSON escapes (\" \\ \n \t \r) resolved. Not a full JSON
            # parser — enough for the fixed shape of this payload. \uXXXX escapes
            # are NOT decoded; a payload that uses them for non-ASCII text logs a
            # different promptBytes here than under jq. Claude Code sends raw
            # UTF-8, so this is a known gap rather than an observed one.
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

            # Re-escapes a value to put it back into the output JSON.
            function esc(s,    out, i, c, n) {
                out = ""
                n = length(s)
                for (i = 1; i <= n; i++) {
                    c = substr(s, i, 1)
                    if (c == "\\") out = out "\\\\"
                    else if (c == "\"") out = out "\\\""
                    else if (c == "\n") out = out "\\n"
                    else if (c == "\r") out = out "\\r"
                    else if (c == "\t") out = out "\\t"
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

    # Cheap rotation: past ~1MB, keep only the last 2000 lines.
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

    # No BOM (printf adds none), LF terminator. Atomic single-line append.
    printf '%s\n' "$line" >> "$LOG" 2>/dev/null

    return 0
}

run
exit 0
