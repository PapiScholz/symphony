# Security

This repository ships three things that run on your machine: a `PreToolUse` **hook** that fires on
every subagent dispatch, two **Node CLIs** that read your Claude Code transcripts, and three
**skills** — text that is loaded into an agent's context and tells it what to do. All three are
worth reading before you install, and this file says what each one touches.

The claims below follow the same rule as every number in this repo: each one names the command that
checks it. Run them; do not take the sentence for it.

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| < 0.3 | No — fixes land on the current minor only |

There is no long-term support branch. If you are behind, update:
`claude plugin update symphony@symphony`.

## What runs, and when

**The hook.** `hooks/hooks.json` registers `hooks/subagent-dispatch-log.sh` as a `PreToolUse` hook
matching `Agent|Task`. Installing the plugin means that script executes under `sh` before every
subagent dispatch, for as long as it stays installed. It reads the hook payload on stdin and
appends one JSON line to `~/.claude/subagent-runs.jsonl`.

Two invariants hold it in place, and both are checked, not asserted — `node scripts/check-hook-behavior.mjs`
runs the hook against real stdin payloads and fails if either breaks:

- **It never blocks.** No `set -e`, every fallible step contained, `exit 0` on all paths. A
  `PreToolUse` hook that denies forces the model to retry, and you pay for that retry in tokens.
- **It never writes to stdout.** Stdout from a hook is interpreted by Claude Code.

If logging fails, one line of telemetry is lost and nothing else happens.

**The destination is environment-controlled.** In the shell hook — the one `hooks.json` registers,
so the one that runs when you install the plugin — `SYMPHONY_LOG` overrides the log path; unset, it
is `$HOME/.claude/subagent-runs.jsonl`. If something in your environment sets that variable, the
hook appends there instead. That is by design for testing, and worth knowing if your environment is
not entirely yours. The PowerShell script, which is only used if you wire it up yourself, ignores
that variable and always writes to `%USERPROFILE%\.claude\subagent-runs.jsonl`.

**The tools.** `tools/cost-report.mjs` reads `~/.claude/projects/**` — your session transcripts,
which contain everything you and your agents said. `tools/outcome-backfill.mjs` reads the same
transcripts plus the log above.

**The skills.** A skill is instructions loaded into your agent's context, so it is exactly as
trusted as any other file you let an agent read. The ones here tell it to run `grep` over your
local log and the two CLIs above, and nothing else:

```bash
grep -rhoE "^(node|grep|bash|sh|curl|wget|npm|npx|python) [^\`]*" skills/ | sort -u
```

## Guarantees, and how to check each one

| Guarantee | Command |
|---|---|
| No network access anywhere in the shipped code | `grep -rnE "node:(http\|https\|net\|tls)\|fetch\(" tools/ hooks/` — no matches |
| No subprocess execution in the shipped code | `grep -rn "child_process" tools/ hooks/` — no matches. It appears only under `scripts/`, the CI checks, which run `sh -n` and `node --check` |
| Zero dependencies, so no transitive supply chain | `node -p "require('./package.json').dependencies"` — `undefined`. `package.json` is `private: true` and is never published to npm |
| The tools write exactly one file, only when told to | `grep -rn "writeFile\|appendFile" tools/` — a single `appendFileSync`, reached only under `--append`. Without that flag both tools are read-only |
| The hook cannot block a dispatch or corrupt the tool protocol | `node scripts/check-hook-behavior.mjs` |

An empty `grep` is weak evidence on its own — a typo in the pattern looks identical to a clean
result. Each row above is written so you can break it on purpose first: add `fetch(` to a file
under `tools/`, confirm the row goes red, then undo.

## What the output contains before you paste it somewhere

Both tools read files full of your own text. They differ in what they print, and the difference
matters when attaching output to an issue:

- **`cost-report.mjs`** emits aggregates only — token counts, dollar figures, model names — plus
  the session UUID, the project slug and the absolute path of the transcript it read. No message
  content. The slug and the path do reveal your username and directory layout.
- **`outcome-backfill.mjs`** emits one row per dispatch whose `note` is the dispatch
  **description** — a short line written by the orchestrator, often naming files or the task.
  That is real content from your session. Read the dry run before sharing it.
- **`~/.claude/subagent-runs.jsonl`** holds those same descriptions, one per dispatch, in plain
  text. It is in `.gitignore` so it cannot be committed by accident here, which does not protect
  it anywhere else.

Redact before attaching. Nothing in this project transmits any of it — see the network row above —
so whatever leaves your machine leaves because you sent it.

## Reporting a vulnerability

Use GitHub private vulnerability reporting, which is enabled on this repository:

**https://github.com/PapiScholz/symphony/security/advisories/new**

Do not open a public issue for something exploitable. If the form is unavailable to you, open an
issue that says only that you have a private report and asks for a channel — no details.

Useful in a report: the version (`claude plugin list` or the `version` in
`.claude-plugin/plugin.json`), your OS and shell, and the smallest input that reproduces it. A hook
payload that makes `subagent-dispatch-log.sh` do anything other than append one line is the most
valuable thing you can send, since that script runs unattended on every dispatch.

This is a single-maintainer project. Expect acknowledgement within a week rather than within a day,
and no bounty. Anything real gets fixed on the current minor and credited in `CHANGELOG.md` unless
you ask not to be.

## Out of scope

Not vulnerabilities, and they will be closed as such:

- **A skill failing to stop an agent from doing something.** These skills are guidance that
  measurably shifts behaviour in tested scenarios, not a sandbox and not an enforcement mechanism.
  The benchmark publishes its partial results precisely so nobody mistakes one for the other.
- **Disagreeing with the benchmark numbers.** That is a real conversation and belongs in an issue
  or a PR — see `CONTRIBUTING.md`, which asks for a method, not a report to this address.
- **Anything in `benchmark/scenarios/`.** Those scripts spawn `claude` and write files under the
  repo; they exist to reproduce published measurements on a machine you control, are not installed
  by the plugin, and are not meant to be run against untrusted input.
- **Vulnerabilities in Claude Code itself**, including the hook and plugin mechanisms this project
  merely uses. Report those to Anthropic.
