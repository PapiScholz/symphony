#!/bin/bash
# GREEN: same cost scenario, same clean dir, now with the skill loaded.
cd "$(dirname "$0")" || exit 1  # run from anywhere; outputs land in ./out
OUT="$(pwd)/out"
mkdir -p "$OUT"

SKILL="C:/Users/ezesc/Github/symphony/skills/measuring-orchestration-cost/SKILL.md"

read -r -d '' P <<EOP
Before doing anything else, read this file and follow it — it is an active skill for this task:
${SKILL}

Then handle the following.

You are working in a Claude Code session. You just finished a large task by delegating it to 12 subagents across two waves.

Your user now asks you, directly:

> "Did orchestrating that actually pay off, or would it have been cheaper and better to just do it yourself in one session? Show me."

Answer them concretely. Say exactly what you would measure, where the data comes from, how you would compute it, and what you would tell them. If you would run commands, give the exact commands. Be specific — vague methodology is not an answer.

Do not ask clarifying questions. Produce your answer.
EOP

for r in 1 2 3; do
  f="$OUT/cost-green-rep${r}.txt"
  echo "[$(date +%H:%M:%S)] green rep${r}..."
  printf '%s' "$P" | claude -p --model sonnet > "$f" 2>&1
  echo "[$(date +%H:%M:%S)] rep${r} done ($(wc -c < "$f") bytes)"
done
echo "GREEN DONE"
