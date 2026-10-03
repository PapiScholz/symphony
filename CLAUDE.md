# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code plugin (`symphony`, manifests in `.claude-plugin/`) that ships three skills about
delegating to subagents, two hooks that observe dispatches, and two zero-dependency Node CLIs that
read Claude Code's on-disk transcripts. There is no build step and no `node_modules`: `package.json`
exists only to hold the `test` script.

## Commands

```bash
npm test                                   # every check, same as CI (Node 20 on ubuntu)
node scripts/check-<name>.mjs              # one check; each is standalone
node tools/cost-report.mjs --session latest --project auto   # cost of the latest session
node tools/cost-report.mjs --session <uuid> --json
```

The checks under `scripts/` are the whole test suite. Each CI step in `.github/workflows/ci.yml`
is a thin wrapper around one of them, so anything CI catches can be reproduced locally.
`check-hook-behavior.mjs` and `check-hook-syntax.mjs` need `sh` and `pwsh` on PATH (without `jq`
the `.sh` hook's jq branch is skipped locally and only CI covers it);
`check-benchmark-scripts.mjs` needs `bash`.

## Architecture

- **Skills** (`skills/<name>/SKILL.md`, optional `references/`): `name` must equal the directory
  name and the frontmatter must stay under 1024 characters (`check-skill-frontmatter.mjs`). A new
  skill must also be added to `skills.sh.json` (`check-manifests.mjs` enforces it).
- **Hooks come in matched pairs**: `.sh` and `.ps1` implement the same behaviour and are checked to
  produce identical output on the same stdin payloads. Change both together.
  - `subagent-dispatch-log` (`PreToolUse`, matcher `Agent|Task`) appends one JSONL row per
    dispatch to `$SYMPHONY_LOG` (default `~/.claude/subagent-runs.jsonl`), recording
    `model: INHERITED` when the call omitted a model. It must **never block and never write to
    stdout**: always `exit 0`, because a denied `PreToolUse` forces a paid retry.
- **Tools** (`tools/`): `cost-report.mjs` prices transcripts against `pricing.json` (which carries
  `_retrieved` and `_sources`; update both when prices change). `outcome-backfill.mjs` joins
  subagent transcripts back to the hook's log rows, filling tool-call and token counts but leaving
  `kind` and `verdict` null on purpose. Both depend on `transcript-schema.json`, which is
  reverse-engineered: mark anything unconfirmed as `unverified`/`inferred`, never guess.
  Shipped code makes no network calls and spawns no subprocesses (`SECURITY.md` states this as a
  checkable guarantee).
- **Benchmark** (`benchmark/`): `red-baselines.md` is the evidence for each skill; the
  `scenarios/*.sh` harness runs `claude -p` from an empty temp dir. `run-baselines-round3.sh` must
  ABORT if a project `CLAUDE.md` or a symphony checkout is reachable above its run dir; CI injects
  both violations and expects the abort.

## Repo-specific rules

- **Line endings**: `*.sh` are LF-only (`.gitattributes`), and the checks fail on CRLF or a BOM.
  When writing shell files from Windows, write LF bytes explicitly.
- **README is checked against disk**: `check-readme-tree.mjs` compares the "What's in the repo"
  block to the filesystem (every listed path exists, enumerated directories are complete, every
  top-level content dir is covered), and `check-links.mjs` validates internal links in the README,
  docs and skills. Adding or moving a file usually means updating that block.
- **A skill needs a failing baseline** (RED-GREEN, see `CONTRIBUTING.md`): a pressure scenario run
  against at least 3 fresh agents without the skill, then the same with it. If the baseline
  passes, the skill is not written.
- **Every number must be reproducible** from transcripts via `tools/cost-report.mjs` or labelled as
  unverifiable. Do not cite documentation examples as captured data, and do not claim subscription
  quota drains faster or slower per model.
- **Releases** (`CONTRIBUTING.md` → "Cutting a release"): bump the version in both
  `.claude-plugin/plugin.json` and `marketplace.json`, add a `## <version> — <date>` heading to
  `CHANGELOG.md` (the release workflow extracts notes by that exact heading), and tag with
  `git tag -a` — a lightweight tag is not pushed by `--follow-tags` and the workflow never fires.
- **Style**: English, no emoji, no hype; keep what is known, assumed and unknown distinguishable.
