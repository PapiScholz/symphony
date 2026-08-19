#!/bin/bash
# RED baselines, round 3 — three scenarios x three reps, all sonnet, headless, fresh context.
#
# Clean-room contract, ENFORCED rather than asserted. Round 2's script ran from its own
# directory, which sits inside this repo, so a baseline agent could reach skills/ and
# tools/cost-report.mjs — the exact contamination round 1 was retracted for. This script
# refuses to run unless the working directory is genuinely isolated:
#
#   1. It runs from a fresh empty directory OUTSIDE any checkout of this repo.
#   2. It walks the whole ancestor chain to the filesystem root and aborts on any CLAUDE.md.
#   3. It aborts if a symphony checkout is reachable from the run directory.
#   4. Outputs land outside the repo.
#
# Known and accepted residual contamination, same as round 2: the user-level
# ~/.claude/CLAUDE.md always loads. A fully virgin environment would need a separate
# config dir with its own credentials.
set -u

# A fresh run directory per invocation, keyed on the shell PID. Reusing one path invites the
# failure this hit on Windows: a previous run's directory still held by the OS, `rm -rf`
# failing with "Device or resource busy", and guard 1 then correctly refusing to start. A
# unique directory sidesteps the lock entirely instead of fighting it. OUT is deliberately
# stable, so results from separate invocations accumulate in one place.
RUN_DIR="${RUN_DIR:-${TMPDIR:-/tmp}/symphony-red3/run-$$}"
OUT="${OUT:-${TMPDIR:-/tmp}/symphony-red3/out}"

rm -rf "$RUN_DIR" 2>/dev/null
mkdir -p "$RUN_DIR" "$OUT"
cd "$RUN_DIR" || exit 1

# --- Guard 1: the run directory must be empty.
if [ -n "$(ls -A .)" ]; then
  echo "ABORT: run directory is not empty: $RUN_DIR" >&2; exit 1
fi

# --- Guard 2: no CLAUDE.md anywhere in the ancestor chain, walked to the root.
d="$(pwd -P)"
while :; do
  if [ -f "$d/CLAUDE.md" ]; then
    echo "ABORT: project CLAUDE.md in ancestor chain: $d/CLAUDE.md" >&2; exit 1
  fi
  parent="$(dirname "$d")"
  [ "$parent" = "$d" ] && break
  d="$parent"
done

# --- Guard 3: no symphony checkout reachable from here.
d="$(pwd -P)"
while :; do
  if [ -d "$d/skills/orchestrating-subagents" ] || [ -f "$d/tools/cost-report.mjs" ]; then
    echo "ABORT: a symphony checkout is reachable at $d" >&2; exit 1
  fi
  parent="$(dirname "$d")"
  [ "$parent" = "$d" ] && break
  d="$parent"
done

echo "clean room OK: $(pwd -P)"
echo "outputs:       $OUT"

# CHECK_ONLY=1 stops here, after the guards and before any model call. CI uses this to
# verify that the guards actually fire without paying for baselines: if a guard is ever
# broken, the check sees a clean exit here instead of the script quietly launching a full
# 20-minute round. Nothing below this line runs.
if [ "${CHECK_ONLY:-}" = "1" ]; then
  echo "CHECK_ONLY: guards passed, stopping before any model call"
  exit 0
fi

# --- Guard 4: ask the MODEL whether it is contaminated.
#
# Guards 1-3 inspect the filesystem, and a filesystem is the wrong place to look. Claude Code
# loads user-level plugins and skills into EVERY session on the machine, including a headless
# `-p` run launched from an empty directory. The first attempt at this round was invalidated
# exactly that way: the controls quoted the skill under test back at us -- "per the model
# table that's a haiku/low-effort job" -- and scored 3/3 on criteria they were reading the
# answer to. No filesystem check could have caught it.
#
# So this guard asks the model what it actually has. If any symphony skill answers, the round
# does not run. --safe-mode is what keeps it clean; this verifies that it worked rather than
# trusting the flag.
if [ "${SKIP_CONTAMINATION_PROBE:-}" != "1" ]; then
  echo "probing for skill contamination..."
  probe=$(printf '%s' 'List every skill available to you whose name mentions orchestration, subagents, delegation, or measuring cost. Output ONLY the names, one per line. If none, output the single word NONE.' | claude -p --safe-mode --model sonnet 2>&1)
  if printf '%s' "$probe" | grep -qi 'orchestrating-subagents\|measuring-orchestration-cost\|symphony'; then
    echo "ABORT: the control can see the skills under test. Baselines would be worthless." >&2
    echo "       probe returned:" >&2
    printf '%s\n' "$probe" | sed 's/^/       /' >&2
    exit 1
  fi
  echo "contamination probe clean"
  echo
fi

# SCENARIOS selects which scenarios to run, space-separated. Default is all three. Use it to
# re-run only what is missing rather than the whole batch -- the same rule this round's
# `recovery` scenario is about.
SCENARIOS="${SCENARIOS:-context threshold recovery}"
echo "scenarios:     $SCENARIOS"
echo

# --------------------------------------------------------------------------
# Scenario A — the orchestrator's own context budget.
# --------------------------------------------------------------------------
read -r -d '' SCENARIO_CONTEXT <<'EOP'
You are the orchestrator in a Claude Code session. Over this session you have dispatched 14 subagents across three waves. All of them returned, and you read each result as it came back.

Your context window is now 78% full. The integration work — reconciling what the 14 agents produced into a single coherent result — has not started yet, and it is the part that actually needs the conversation history.

Two questions, answer both concretely:

1. Where did YOUR context actually go? Account for it.
2. What do you change, specifically, for the waves that remain and for the integration step?

Be specific and mechanical. If there are settings, tool parameters, or dispatch patterns you would change, name them exactly.

Do not ask clarifying questions. Produce your answer.
EOP

# --------------------------------------------------------------------------
# Scenario B — the threshold for when NOT to orchestrate.
# Note: the prompt says "respond to them", NOT "set up the orchestration".
# A scenario that orders the agent to orchestrate tests nothing: a baseline
# that complies is obeying, not failing.
# --------------------------------------------------------------------------
read -r -d '' SCENARIO_THRESHOLD <<'EOP'
You are working in a Claude Code session on a repository. It has 40 source files; 12 of them mention the config key `apiTimeout`.

Your user says to you, verbatim:

> "Throw this at a bunch of agents in parallel so it goes fast — rename the config key `apiTimeout` to `requestTimeoutMs` everywhere in the repo, and update the docs to match."

Respond to them.

Do not ask clarifying questions. Produce your response.
EOP

# --------------------------------------------------------------------------
# Scenario C — recovering agents that died mid-flight.
# --------------------------------------------------------------------------
read -r -d '' SCENARIO_RECOVERY <<'EOP'
You are working in a Claude Code session. You dispatched 12 subagents in parallel. Each one was told to read a slice of source files, build a JSON artifact matching a fixed schema, and write it to `/scratch/extract-<n>.json`, where <n> is 1 through 12.

Nine of them returned normally, reporting success.

The other three did not return a result. For each of those three, the harness returned:

    Agent terminated early due to an API error: You've reached your Fable 5 limit

You still need all 12 artifacts to do the merge.

What exactly do you do now? Be specific and concrete: name the checks, the commands, and what you would dispatch, with what settings.

Do not ask clarifying questions. Produce your answer.
EOP

# The `threshold` scenario describes a concrete repository -- 40 source files, 12 of which
# mention `apiTimeout`. Run it in a bare empty directory and the agent looks around, finds no
# repo, and hedges about the missing files instead of answering the orchestration question.
# That is a scenario-design defect, not a finding, so the scenario gets the repo it describes.
# Nothing here creates a CLAUDE.md or anything resembling a symphony checkout: the clean-room
# guards above have already run, and this scaffold does not reintroduce what they exclude.
scaffold_threshold_repo() {
  local root="$1"
  rm -rf "$root"; mkdir -p "$root/src" "$root/docs"
  local i
  for i in $(seq 1 12); do
    cat > "$root/src/service-$i.js" <<JS
// service-$i — request layer
const config = require("../config");

async function callUpstream$i(payload) {
  return fetch(config.endpoint, {
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.apiTimeout),
  });
}

module.exports = { callUpstream$i, defaultTimeout: config.apiTimeout };
JS
  done
  for i in $(seq 13 36); do
    cat > "$root/src/module-$i.js" <<JS
// module-$i — no timeout configuration here
function helper$i(input) {
  return String(input).trim();
}

module.exports = { helper$i };
JS
  done
  cat > "$root/config.js" <<'JS'
module.exports = {
  endpoint: "https://example.invalid/v1",
  apiTimeout: 30000,
  retries: 3,
};
JS
  cat > "$root/docs/configuration.md" <<'MD'
# Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `endpoint` | string | — | Upstream base URL. |
| `apiTimeout` | number | `30000` | Milliseconds before a request is aborted. |
| `retries` | number | `3` | Retry attempts on a failed request. |
MD
  cat > "$root/README.md" <<'MD'
# example-service

Set `apiTimeout` in `config.js` to control the upstream request deadline.
See `docs/configuration.md` for the full option list.
MD
  cat > "$root/package.json" <<'JSON'
{ "name": "example-service", "version": "1.4.0", "private": true }
JSON
}

# SKILL_FILE turns this harness from RED into GREEN. Set it to a SKILL.md and its text is
# appended to the system prompt of every scenario run; leave it unset for the baseline. The
# scenario, the clean room, the model and the rep count are identical either way, so the only
# difference between the two rounds is the guidance under test -- which is the whole point.
# The contamination probe above deliberately does NOT get the skill: it must keep answering
# the question "can the control see the installed skills", not "did we just inject one".
SKILL_FILE="${SKILL_FILE:-}"
SKILL_ARGS=()
if [ -n "$SKILL_FILE" ]; then
  if [ ! -f "$SKILL_FILE" ]; then
    echo "ABORT: SKILL_FILE does not exist: $SKILL_FILE" >&2; exit 1
  fi
  SKILL_ARGS=(--append-system-prompt-file "$SKILL_FILE")
  echo "GREEN run: appending $SKILL_FILE"
  echo
fi

# run <scenario-name> <prompt> <rep> [workdir]
run() {
  local name="$1" prompt="$2" rep="$3" workdir="${4:-}"
  local f="$OUT/${name}-rep${rep}.txt"
  echo "[$(date +%H:%M:%S)] running ${name} rep${rep}..."
  if [ -n "$workdir" ]; then
    ( cd "$workdir" && printf '%s' "$prompt" | claude -p --safe-mode --model sonnet "${SKILL_ARGS[@]}" ) > "$f" 2>&1
  else
    printf '%s' "$prompt" | claude -p --safe-mode --model sonnet "${SKILL_ARGS[@]}" > "$f" 2>&1
  fi
  echo "[$(date +%H:%M:%S)] ${name} rep${rep} done ($(wc -c < "$f") bytes)"
}

for name in $SCENARIOS; do
  workdir=""
  case "$name" in
    context)   prompt="$SCENARIO_CONTEXT" ;;
    recovery)  prompt="$SCENARIO_RECOVERY" ;;
    threshold)
      prompt="$SCENARIO_THRESHOLD"
      workdir="$(pwd -P)/example-service"
      ;;
    *) echo "ABORT: unknown scenario '$name'" >&2; exit 1 ;;
  esac
  for r in 1 2 3; do
    # Fresh scaffold per rep, so no rep sees another rep's edits.
    [ "$name" = "threshold" ] && scaffold_threshold_repo "$workdir"
    run "$name" "$prompt" "$r" "$workdir"
  done
done

echo "ALL DONE"
ls -la "$OUT"
