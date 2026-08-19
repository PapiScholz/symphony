# Changelog

## 0.1.0 — 2026-08-19

First release.

### Added

- **`orchestrating-subagents` skill** — the dispatch contract, the model × effort table, in-flight
  signals for detecting mis-tiering, and five reference files (agent definition fields, platform
  limits, workflows, prompt templates, learning log). Built with a RED-GREEN-REFACTOR cycle: 3
  baseline agents without the skill produced 3 *different* behaviours (omitting `model` with a
  rationalisation, choosing correctly, and applying one tier to the whole batch); 3 agents with the
  skill converged on the same correct shape. The REFACTOR pass fixed a real defect the test exposed
  — the skill originally told agents to pass `effort` to the `Agent` tool, which silently ignores it.
- **`tools/cost-report.mjs`** — zero-dependency Node CLI computing real token usage per model from
  Claude Code's own transcripts, split orchestrator vs subagent. Leads with tokens; dollar figures
  are subordinated under a section for consumption-billed users, because on Pro/Max subscriptions
  they appear on no bill. `--no-usd` removes them entirely.
- **`tools/pricing.json`** — per-model prices with sources and retrieval date.
- **`tools/transcript-schema.json`** — the reverse-engineered transcript format the report reads.
- **`hooks/subagent-dispatch-log.{ps1,sh}`** — a `PreToolUse` observer recording which model each
  dispatch requested, marking `INHERITED` when none was set. Never blocks, always exits 0, so it
  cannot cost a retry.
- **`benchmark/red-baselines.md`** — the runs where three planned skills were tested and cancelled
  because their baselines did not fail.

### Not included, on purpose

- `measuring-orchestration-cost`, `writing-agent-specs`, `verifying-agent-output` — planned, tested,
  dropped. See `benchmark/red-baselines.md`.
- An A/B benchmark comparing orchestrated against single-model runs. Not run yet; METHODOLOGY says
  so plainly rather than implying otherwise.

### Known limitations

- All measurements are N=1: one session, one author, one project.
- The re-tiering figure is a counterfactual and an upper bound, not a measurement.
- The transcript schema is reverse-engineered and drifts between Claude Code releases.
- The subscription argument rests partly on a first-hand incident with no published artifact.
