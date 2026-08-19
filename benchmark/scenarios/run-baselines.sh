#!/bin/bash
# RED baselines re-run in a clean directory (no project CLAUDE.md, no symphony repo).
#
# KNOWN DEFECT, kept as-is because this is the artifact that produced round 2's published
# results and rewriting it would misrepresent them. The `cd` below puts the working
# directory at benchmark/scenarios/ -- INSIDE this repo -- so a baseline agent can reach
# skills/ and tools/cost-report.mjs. That does not reproduce the clean room that
# benchmark/red-baselines.md describes for round 2. See the section "Correction to round
# 2's published harness" in that file for what is and is not being claimed about it.
#
# For a harness that ENFORCES the clean room instead of asserting it, and aborts when the
# conditions are not met, use run-baselines-round3.sh.
# 3 scenarios x 3 reps, all on sonnet, headless, fresh context each.
cd "$(dirname "$0")" || exit 1  # run from anywhere; outputs land in ./out
OUT="$(pwd)/out"
mkdir -p "$OUT"

read -r -d '' SCENARIO_COST <<'EOP'
You are working in a Claude Code session. You just finished a large task by delegating it to 12 subagents across two waves.

Your user now asks you, directly:

> "Did orchestrating that actually pay off, or would it have been cheaper and better to just do it yourself in one session? Show me."

Answer them concretely. Say exactly what you would measure, where the data comes from, how you would compute it, and what you would tell them. If you would run commands, give the exact commands. Be specific — vague methodology is not an answer.

Do not ask clarifying questions. Produce your answer.
EOP

read -r -d '' SCENARIO_SPEC <<'EOP'
You are working in a Claude Code session on a repo. You need to delegate this work to a subagent running on a cheap, fast model (haiku):

Extract entities and relationships from 20 markdown documents in `docs/` into a fixed JSON schema. The schema is:

{"nodes":[{"id":"string","label":"string","type":"concept|file|rule","sourceDoc":"string"}],
 "edges":[{"from":"nodeId","to":"nodeId","relation":"references|depends_on|contradicts"}]}

Node ids must be unique across all documents. The result has to end up somewhere the orchestrator can pick it up and merge.

Write the exact `prompt` string you would pass to that subagent. Write it out in full, as you would actually send it — not a description of what it would contain.

Do not ask clarifying questions. Produce the prompt.
EOP

read -r -d '' SCENARIO_VERIFY <<'EOP'
You are working in a Claude Code session. You dispatched 12 subagents in parallel. Each was told to read some source files, produce a JSON artifact matching a fixed schema, and write it to a given path in a scratch directory.

All 12 have now returned. Every one of their final messages says some version of "done" — for example: "written 47 nodes, 61 edges", "extraction complete, 5 files written", "all done, validated".

Your next step is to merge their output into a single result and use it.

What exactly do you do now, before merging? Be specific and concrete: name the checks you would run and the commands you would use. If you would just merge, say that.

Do not ask clarifying questions. Produce your answer.
EOP

run() {
  local name="$1" prompt="$2" rep="$3"
  local f="$OUT/${name}-rep${rep}.txt"
  echo "[$(date +%H:%M:%S)] running ${name} rep${rep}..."
  printf '%s' "$prompt" | claude -p --model sonnet > "$f" 2>&1
  echo "[$(date +%H:%M:%S)] ${name} rep${rep} done ($(wc -c < "$f") bytes)"
}

for r in 1 2 3; do run cost   "$SCENARIO_COST"   "$r"; done
for r in 1 2 3; do run spec   "$SCENARIO_SPEC"   "$r"; done
for r in 1 2 3; do run verify "$SCENARIO_VERIFY" "$r"; done

echo "ALL DONE"
ls -la "$OUT"
