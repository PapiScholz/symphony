#!/bin/bash
# Does the skill FIRE, or only work when you paste it in?
#
# The GREEN arms in benchmark/red-baselines.md inject a SKILL.md body with
# --append-system-prompt-file. That proves the guidance changes behaviour when an agent reads
# it. It does not prove the agent ever reaches for it. In real use only the `description` is
# resident and the body loads when that description matches.
#
# So this runs the scenario in an ORDINARY session -- no --safe-mode, the symphony plugin
# installed at user scope, exactly what someone who ran `/plugin install` has -- and reads the
# stream to see whether the Skill tool was invoked with when-not-to-orchestrate.
#
# Two prompt variants, because a single one would flatter the result:
#   verbatim   -- the phrasing the skill's own description quotes ("throw this at a bunch of
#                 agents"). Firing here only shows the description matches words written into
#                 it after the scenario existed.
#   paraphrase -- the same request without any of the description's flagship phrases. Firing
#                 here is the result that means something.
#
# Accepted and unavoidable impurity: an ordinary session also loads the other symphony skills
# and the user's own CLAUDE.md. That is the point -- it is the real environment, not a clean
# room. This measures firing, not the size of the behavioural effect.
set -u

OUT="${OUT:-${TMPDIR:-/tmp}/symphony-fires}"
REPO="${REPO:-${TMPDIR:-/tmp}/symphony-fires/example-service}"
REPS="${REPS:-3}"
mkdir -p "$OUT"

scaffold() {
  local root="$1"; local i
  rm -rf "$root"; mkdir -p "$root/src" "$root/docs"
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
    printf '// module-%s\nfunction helper%s(x){return String(x).trim();}\nmodule.exports={helper%s};\n' "$i" "$i" "$i" > "$root/src/module-$i.js"
  done
  cat > "$root/config.js" <<'JS'
module.exports = { endpoint: "https://example.invalid/v1", apiTimeout: 30000, retries: 3 };
JS
  cat > "$root/docs/configuration.md" <<'MD'
# Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `apiTimeout` | number | `30000` | Milliseconds before a request is aborted. |
MD
  printf '# example-service\n\nSet `apiTimeout` in `config.js` to control the upstream request deadline.\n' > "$root/README.md"
  printf '{ "name": "example-service", "version": "1.4.0", "private": true }\n' > "$root/package.json"
}

PROMPT_VERBATIM='Throw this at a bunch of agents in parallel so it goes fast — rename the config key `apiTimeout` to `requestTimeoutMs` everywhere in the repo, and update the docs to match.'
PROMPT_PARAPHRASE='We should get through this quicker by having several workers handle different files at the same time. Change the config key `apiTimeout` to `requestTimeoutMs` right across the codebase, and make the documentation say the new name too.'

run() {
  local variant="$1" prompt="$2" rep="$3"
  local raw="$OUT/${variant}-rep${rep}.jsonl"
  echo "[$(date +%H:%M:%S)] ${variant} rep${rep}..."
  scaffold "$REPO"
  ( cd "$REPO" && printf '%s' "$prompt" \
      | claude -p --model sonnet --output-format stream-json --verbose ) > "$raw" 2>&1

  # Did the Skill tool fire, and with which skill?
  local fired
  fired=$(grep -o '"name":"Skill"[^}]*}' "$raw" | head -3)
  local named
  named=$(grep -o 'when-not-to-orchestrate' "$raw" | head -1)
  {
    echo "variant=$variant rep=$rep"
    echo "skill_tool_invoked=$( [ -n "$fired" ] && echo YES || echo NO )"
    echo "when-not-to-orchestrate_mentioned=$( [ -n "$named" ] && echo YES || echo NO )"
  } > "$OUT/${variant}-rep${rep}.verdict"
  cat "$OUT/${variant}-rep${rep}.verdict"
}

for r in $(seq 1 "$REPS"); do run verbatim   "$PROMPT_VERBATIM"   "$r"; done
for r in $(seq 1 "$REPS"); do run paraphrase "$PROMPT_PARAPHRASE" "$r"; done

echo "ALL DONE"
ls "$OUT"
