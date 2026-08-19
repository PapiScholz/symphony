#!/bin/bash
# Does the skill FIRE, or does it only work when you paste it in?
#
# The GREEN arms in benchmark/red-baselines.md inject a SKILL.md body with
# --append-system-prompt-file. That proves the guidance changes behaviour when an agent reads
# it. It does not prove an agent ever reaches for it. In real use only the `description` is
# resident, and the body loads when that description matches.
#
# So this runs the scenario in an ORDINARY session -- no --safe-mode, the symphony plugin
# installed at user scope, exactly what someone who ran `/plugin install` has -- and reads the
# event stream to see whether the Skill tool was invoked.
#
# TWO PROMPT VARIANTS, because one would flatter the result:
#
#   verbatim    the phrasing the skill's own description quotes ("throw this at a bunch of
#               agents"). That phrase was written INTO the description after this scenario
#               existed, so firing here shows a text matching itself. A negative here is still
#               strong -- not firing on the words its own description quotes is decisive.
#   paraphrase  the same request with none of the description's flagship phrases. Firing here
#               is the result that means something.
#
# DETECTOR CONTROL, because an absence is only evidence if the detector is known to work. A
# prompt naming the skill outright must produce {"skill":"symphony:when-not-to-orchestrate"};
# if it does not, every "did not fire" below is indistinguishable from a stream that never
# reports skills, and firing-report.mjs refuses to conclude anything.
#
# Accepted, unavoidable impurity: an ordinary session also loads the other symphony skills and
# the user's own CLAUDE.md. That is the point -- this is the real environment, not a clean
# room. It measures firing, not the size of the behavioural effect.
set -u

OUT="${OUT:-${TMPDIR:-/tmp}/symphony-fires/out}"
REPO="${REPO:-${TMPDIR:-/tmp}/symphony-fires/run-$$/example-service}"
REPS="${REPS:-3}"
VARIANTS="${VARIANTS:-verbatim paraphrase}"
SKIP_CONTROL="${SKIP_CONTROL:-}"

mkdir -p "$OUT" "$(dirname "$REPO")"

# The plugin must reach the agent through its INSTALLED path. An agent that finds SKILL.md on
# disk and reads it has not fired a skill, it has read a file -- so refuse to run anywhere a
# symphony checkout is reachable, or under a project CLAUDE.md.
d="$(cd "$(dirname "$REPO")" && pwd -P)"
while :; do
  [ -f "$d/CLAUDE.md" ] && { echo "ABORT: project CLAUDE.md at $d" >&2; exit 1; }
  [ -d "$d/skills/when-not-to-orchestrate" ] && { echo "ABORT: symphony checkout reachable at $d — the skill could be read as a file" >&2; exit 1; }
  parent="$(dirname "$d")"; [ "$parent" = "$d" ] && break; d="$parent"
done
echo "clean room OK: $(dirname "$REPO")"

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
PROMPT_CONTROL='Use your when-not-to-orchestrate skill and list the three gates it names. Nothing else.'

run() {
  local label="$1" prompt="$2"
  local raw="$OUT/${label}.jsonl"
  echo "[$(date +%H:%M:%S)] ${label}..."
  scaffold "$REPO"
  ( cd "$REPO" && printf '%s' "$prompt" \
      | claude -p --model sonnet --output-format stream-json --verbose ) > "$raw" 2>&1
  echo "[$(date +%H:%M:%S)] ${label} done ($(wc -c < "$raw") bytes)"
}

[ "$SKIP_CONTROL" = "1" ] || run "control" "$PROMPT_CONTROL"

for variant in $VARIANTS; do
  case "$variant" in
    verbatim)   prompt="$PROMPT_VERBATIM" ;;
    paraphrase) prompt="$PROMPT_PARAPHRASE" ;;
    *) echo "ABORT: unknown variant '$variant'" >&2; exit 1 ;;
  esac
  for r in $(seq 1 "$REPS"); do run "${variant}-rep${r}" "$prompt"; done
done

echo "ALL DONE"
echo "analyse: node benchmark/scenarios/firing-report.mjs $OUT"
