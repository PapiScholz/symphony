# Changelog

## 0.2.0 — 2026-08-19

### Added

- **`when-not-to-orchestrate`** — the three gates a task must pass before it is worth fanning out
  (divisible, closable, checkable), the per-agent overhead that does not amortise, and the failure
  only parallelism can create. Its RED baseline failed behaviourally: three controls running inside
  a real 40-file repository were told to parallelise a 12-site rename, two did it — one reporting
  "All 15 agents finished cleanly" — and a third watched one of its own agents flag files it had
  never touched and dismissed it as "not an actual issue". GREEN is **partial and published as
  partial**: declining goes 1/3 to 3/3 and the concrete alternative 1/3 to 3/3, while naming the
  per-agent overhead stayed 0/3. A refactor targeting that gap made the primary criterion worse and
  was reverted; both arms are recorded.
- **`skills.sh.json`** — curates how the three skills group on the repo's skills.sh page. skills.sh
  searches over a skill's name and description only, never the README, so that page and those
  fields are the whole discovery surface.
- **CI check `check-benchmark-scripts.mjs`** — `bash -n`, CRLF and BOM checks on every benchmark
  script, plus a behavioural check that **fires** the clean-room guards and fails if they do not
  abort. Proven red four ways before being wired in.
- **`check-manifests.mjs` now validates `skills.sh.json`** — every skill on disk must appear in
  exactly one grouping. Proven red four ways.
- **A contamination probe in the benchmark harness** that asks the model what skills it can see and
  aborts the round if a Symphony skill answers.

### Fixed

- **Round 3's first nine baselines were retracted.** They passed every filesystem guard and were
  still contaminated: Claude Code loads user-level plugins into every session on the machine,
  including headless `-p` runs from an empty directory, so the controls had the skills under test
  in context and quoted them back. All model calls in the harness now pass `--safe-mode`, and the
  probe above verifies it rather than trusting it.
- **The round-2 harness does not reproduce its documented clean room.** `run-baselines.sh` runs
  from inside this repo, where `skills/` and `tools/cost-report.mjs` are reachable. The script is
  kept as-is, since it produced published results, with the defect stated in its header and in
  `benchmark/red-baselines.md`.
- **The agent-teams "roughly 7x" figure is now sourced.** It is Anthropic's, verbatim, from the
  Claude Code costs page — previously asserted without a citation in a repo whose whole argument is
  that it shows its numbers.
- `CONTRIBUTING.md` said three planned skills had been cancelled; two had.
- `.gitignore` now covers `graphify-out/` and `benchmark/scenarios/out/`, which were only being
  excluded by a global ignore file on the author's machine.

### Changed

- **The install command moved from line 218 to the top of the README**, with a three-skill summary
  above it. The evidence and its caveats are untouched and stay in the same file.
- Both existing skill descriptions gained search terms additively — no existing trigger condition
  was weakened.
- `measuring-orchestration-cost` gained a **"Two limits, not one"** section separating the context
  window from cumulative consumption. 3/3 controls in round 3 treated them as one resource.

## 0.1.1 — 2026-08-19

### Fixed

- **The plugin now actually installs the dispatch-logging hook.** 0.1.0's README claimed the plugin
  route installed it; it did not. `plugin.json` declared no `hooks`, and the default location
  (`hooks/hooks.json`) did not exist, so the plugin shipped the scripts without registering them.
  Added `hooks/hooks.json` binding `PreToolUse` on `Agent|Task` to the POSIX hook via
  `${CLAUDE_PLUGIN_ROOT}`. Verified with the exact command the plugin runs.

  Note for anyone who also configured the hook by hand in `settings.json`: plugin hooks **merge**
  with user hooks rather than replacing them, so running both logs every dispatch twice. Remove the
  manual entry when installing the plugin.

## 0.1.0 — 2026-08-19

First release. Two skills, the tooling to measure what orchestration actually consumes, and the
test runs that decided which skills got written.

### Skills

- **`orchestrating-subagents`** — the dispatch contract, the model × effort table, in-flight signals
  for detecting mis-tiering, and five reference files (agent definition fields, platform limits,
  workflows, prompt templates, learning log). Built RED-GREEN-REFACTOR: three baseline agents
  without it produced three *different* behaviours (omitting `model` with a rationalisation,
  choosing correctly, applying one tier to the whole batch); three with it converged on the same
  shape. The refactor pass fixed a defect the test exposed — the skill originally told agents to
  pass `effort` to the `Agent` tool, which silently ignores it.
- **`measuring-orchestration-cost`** — establishing how the user is billed before quoting any
  figure, reading token usage from the transcripts, and the counterfactual with its ceiling. Its
  baseline failed 3/3 in a clean room: none established the billing model, none named `isSidechain`,
  one asserted "orchestration is cheaper at scale" without measuring it, and one repeated the
  folklore `haiku << sonnet << opus` ratio (real Opus:Haiku is 5×, not the 60× circulating
  elsewhere).

### Tooling

- **`tools/cost-report.mjs`** — zero-dependency Node CLI computing real per-model token usage from
  Claude Code's own transcripts, split orchestrator vs subagent. Leads with tokens; dollars are
  subordinated under a pay-per-token section, because on Pro/Max they appear on no bill. `--no-usd`
  removes them entirely. Verified against a hand-computed figure, agreeing to the cent.
- **`tools/pricing.json`** — per-model prices with sources and retrieval date.
- **`tools/transcript-schema.json`** — the reverse-engineered transcript format the report reads.
- **`hooks/subagent-dispatch-log.{ps1,sh}`** — a `PreToolUse` observer recording which model each
  dispatch requested, marking `INHERITED` when none was set. Never blocks, always exits 0, so it
  cannot cost a retry.

### CI

- **`.github/workflows/ci.yml`** plus `npm test` — seven checks: skill frontmatter (including that
  `name` matches its directory), manifest validity and version agreement, `node --check`, hook
  syntax with CRLF and BOM scans, hook behaviour (four stdin cases must each exit 0 with empty
  stdout), pricing sanity with alias resolution, and internal link resolution. **Every check was
  proven by injecting a violation and confirming it fails**, then reverting.
- **`.github/workflows/release.yml`** — re-runs the suite on a version tag, refuses to publish if
  the tag disagrees with the manifests, and builds release notes from this file.

### Dropped on purpose

`verifying-agent-output` and `writing-agent-specs` were planned, tested and not written: their
baselines did not fail. See `benchmark/red-baselines.md`, which also retracts a first round of
testing that was contaminated and proved nothing.

### Known limitations

- Measurements are N=1: one session, one author, one project.
- The re-tiering figure is a counterfactual and an upper bound, not a measurement.
- The transcript schema is reverse-engineered and drifts between Claude Code releases.
- The subscription argument rests partly on a first-hand incident with no published artifact.
- No A/B benchmark comparing orchestrated against single-model runs has been executed.
