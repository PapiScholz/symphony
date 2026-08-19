# Methodology

How the numbers in `README.md` were produced, and how to check them yourself. Written
for a reader who wants to refute them, not just accept them.

## N = 1

One session, one author, one project (a POS/inventory Electron app called Almacen). No
control group, no repeated trials, no cross-author replication. Treat every number below
as "this is what one real session actually cost," not as a validated average or a claim
about sessions in general.

## Where the data comes from

Claude Code writes a transcript for every session to disk, under the user's config
directory (`~/.claude` by default, overridable with `CLAUDE_CONFIG_DIR`):

- **Main transcript:** `<config>/projects/<project-slug>/<session-uuid>.jsonl` — one JSON
  object per line, the primary (non-sidechain) conversation.
- **Project slug:** every path separator and every `:` (Windows drive letter) in the
  project's absolute path becomes a literal `-`, with no collapsing of runs — e.g.
  `C:\Users\ezesc\Github\Almacen` becomes `C--Users-ezesc-Github-Almacen`. Verified
  against real project directories, not assumed.
- **Subagent dispatches:** each async `Agent`-tool call that actually produced turns gets
  its own pair of files under a sibling directory named after the session UUID:
  `<project-dir>/<session-uuid>/subagents/agent-<agentId>.jsonl` (the subagent's own
  turn-by-turn transcript) and `agent-<agentId>.meta.json` (agent type, description, the
  originating tool-use id, spawn depth).

Only `assistant`-type lines carry `message.usage` — verified by checking zero usage
objects on any other line type across a sampled 2,115-line main transcript (containing
854 `attachment`, 460 `assistant`, 247 `user`, and smaller counts of session-bookkeeping
line types like `ai-title`, `mode`, `queue-operation`). `isSidechain: true` marks a
subagent turn: verified true on every line in every sampled `subagents/*.jsonl` file, and
false or absent on every line in the sampled main transcript. The two files are a clean
partition — subagent turns are never inlined into the main transcript in this format
version.

Joining a dispatch in the main transcript to its subagent's own transcript has three
corroborating keys (validated 34/34, no orphans in either direction, in the transcript
sampled): the `Agent` tool-use id matching `meta.json`'s `toolUseId`; the `user` line
holding that tool-use's result carrying `toolUseResult.agentId` directly (fastest, no
extra file read); and a redundant `queue-operation` notification carrying the same id in
an XML-ish `<task-id>`. The join was validated for direct children of the top-level
session; nested/forked agents (spawn depth > 1) were not specifically exercised in this
pass.

## The costing rule

Total context consumed by one API call:

```
input_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

These are three non-overlapping buckets (verified: `input_tokens` sits at 2 tokens, or 0,
on essentially every usage-bearing line sampled — main and subagent alike — while the
cache fields carry the real prompt-size magnitude; consistent with `input_tokens`
covering only what wasn't served from cache that call, matching documented Messages API
semantics). `output_tokens` is separate from all three and is not double-counted against
`output_tokens_details.thinking_tokens`, which is a subset of it, not additive.

Each bucket is priced separately from `tools/pricing.json`: `input_tokens` at the base
input rate, `cache_read_input_tokens` at the cache-read rate (0.1x base input for every
model in the file), and cache writes split by TTL — `cache_creation.ephemeral_5m_input_tokens`
at `cache_write` (1.25x base input), `ephemeral_1h_input_tokens` at `cache_write_1h` (2x
base input). `output_tokens` at the output rate.

`message.model == "<synthetic>"` lines (a handful, all-zero usage, that look like
locally-injected status/error turns rather than real API calls) are excluded from every
total. Their usage was verified zero in every case observed, though the mechanism that
produces them was not traced further.

## What the tool automates, and what it does not

`tools/cost-report.mjs` groups every usage-bearing line by `(isSidechain, model)` only.
That grouping is exactly what produces the two tables in the README automatically:
orchestrator vs. subagent totals, and the subagent-by-model breakdown (turns, tokens,
USD) — run it and you get those numbers directly, with no additional analysis.

It does **not** group by individual agent dispatch or by task. The re-tiering
counterfactual in the README ($225.04 actual vs. $170.37 re-tiered, $54.68 difference)
required a step the tool does not perform: going back over each subagent dispatch,
classifying its task against the skill's own model × effort table (mechanical
extraction/labeling/schema-filling → `haiku`; locating code, research, bounded-judgment
reading → `sonnet`; multi-file implementation, debugging, correctness review → `sonnet`
at high effort; architecture/design/synthesis → left at `opus`/`fable`), and re-pricing
each dispatch's actual token volume at its reclassified tier's rate, then summing.
Reproducing the top two tables in the README is push-button. Reproducing the re-tiering
table requires this manual classification pass; there is no `--retier` flag, and the
classification itself is not saved anywhere in this repo as a script or a dataset.

The tool ships a different, automated counterfactual of its own —
`== Counterfactual: subagent tokens at the orchestrator's rate ==` in its output, also
present in `--json` under `counterfactual`. It prices the actual subagent token volume at
the *orchestrator's* rate, answering "what would this have cost if none of it had been
delegated." That is the upper bound on the value of delegating at all. It is a different
question from the README's re-tiering table, which asks what the *already-delegated*
work should have cost at the *right* tier per task. Running `cost-report.mjs` on your own
session gives you the first number, not the second — do not conflate them.

**One-cent note:** the README shows $225.05 as the measured total and $225.04 as "session
as actually run" in the re-tiering table. Both are correct; the gap is rounding at
different aggregation points (per-line vs. per-model-bucket) between the two
calculations, not an arithmetic error. Either figure rounds the same way to the nearest
dollar.

## Why the re-tiered figure is an upper bound, not a promise

Three reasons, stated plainly:

1. **Same-turn-count assumption.** The re-tiering prices the same token volume at a
   cheaper rate. It does not model a cheaper model needing more turns to reach the same
   result — which happens, and would eat into the saving. The actual saving from
   re-running the same work on cheaper tiers could be smaller than $54.68, possibly
   substantially.
2. **Prompt cache is not re-created for free.** Each subagent in a parallel fan-out pays
   its own cache-write cost once, on first use; a single continuous session sharing one
   context would not repeat that cost per subagent. This works in the other direction —
   it means the *actual* multi-agent spend already includes overhead a single-agent
   equivalent would not — but it does not change the upper-bound status of the re-tiering
   figure itself.
3. **No independent re-run.** The $170.37 figure was never actually executed. It is
   arithmetic on the same session's already-spent tokens, not a second measured run at
   the cheaper tiers.

## The schema is reverse-engineered, not documented

`tools/transcript-schema.json` was produced by inspecting real transcripts on one
machine — 82 sampled sessions spanning CLI versions 2.1.121 through 2.1.233 — not from
any Anthropic specification. Every claim in it is tagged `verified` (empirically
confirmed against the evidence sources listed at the top of the file) or left as
`inferred`/`unverified` where it wasn't. Concretely:

- New top-level keys and even new line types (`ai-title`, `mode`) appeared between
  2.1.121 and 2.1.220 in the sampled range — the format is actively evolving release to
  release, not frozen.
- `cost-report.mjs` reads defensively as a result: only `input_tokens` and
  `output_tokens` are treated as guaranteed present on a usage-bearing line; every other
  field is read optionally.
- A future CLI version can still break this. Before trusting a number the tool produces,
  check `transcript-schema.json`'s `verified` vs. `inferred`/`unverified` annotations, and
  prefer re-running the tool against a current transcript over trusting an old figure.

## What the subscription argument does and doesn't claim

The README leads with tokens, not dollars, and argues that mistiering has a real cost
even for readers whose plan makes the dollar figures decorative (Claude Pro, Max, Team —
see the README's "If you pay per token" section for why the dollar table doesn't apply
to them). That argument rests on exactly two facts, both directly verifiable in this
repo and in Anthropic's own documentation, and nothing past those two:

1. **Premium models carry their own limit, separate from the shared window.** Claude
   Code's documentation on rate limits states that session and weekly windows "are
   shared across all models, so switching models with `/model` doesn't restore access,
   though it does keep the developer working after the model-specific 'You've hit your
   Opus limit' message." Fable and Opus are gated by a model-specific ceiling on top of
   the shared one.
2. **Exhausting that ceiling kills work in flight, not just future dispatches.** Three
   subagents doing mechanical extraction died mid-run when the Fable-specific limit was
   hit; the harness returned `Agent terminated early due to an API error: You've reached
   your Fable 5 limit` for each, and their partial output had to be inspected and partly
   re-run before it could be trusted.

   **The evidentiary status of this claim is weaker than the token tables, and you should
   know that.** The tables are reproducible from the transcripts by anyone. This incident
   is not: it was observed first-hand by the author in the session's conversation, and no
   artifact in this repo captures it. The dispatch hook logs which model each dispatch
   *requested*; it does not log whether the agent later died, because `PreToolUse` fires
   before the agent runs. The example entry in `references/learning-log.md` describing
   this event is **illustrative documentation of the log format, hand-written — not a
   captured record.** Citing it as evidence would be circular, and an earlier draft of
   these documents did exactly that. Treat point 2 as a first-hand report. Point 1 and
   the token tables stand on their own.

**What this document deliberately does not claim:** that a cheaper model (`haiku`,
`sonnet`) burns through the *shared* session/weekly token window more slowly than an
expensive one, for the same unit of delegated work. That would be the more directly
useful claim for a subscriber deciding how to tier — but it is not documented anywhere
by Anthropic, was not measured in this session, and this repo has no data, from
`cost-report.mjs` or otherwise, that would support it in either direction. Token counts
per model are known; how those token counts convert to consumption of the shared
window, model by model, is not something this repo observed or can currently observe.
The two points above — a separate ceiling on premium models, and that ceiling killing
in-flight work when it's hit — stand on their own and do not need that unverified claim
to hold. Treat any stronger version of the subscription argument than these two points
as unsupported by what's in this repo.

## No A/B benchmark exists yet

Nothing in this repo runs a controlled trial of "orchestrated and tiered" against
"single-agent, no delegation" on matched tasks. Everything in the README is one real
session's measured spend, plus a manual re-tiering counterfactual computed on that same
session's already-spent tokens — not a benchmark, and not a claim that orchestration
"wins" in general. Say this plainly rather than implying otherwise: if you're looking for
a controlled comparison to cite, it is not here.

## Reproducing this yourself

From the project whose session you want to cost:

```
node tools/cost-report.mjs                          # latest session, auto project, human-readable
node tools/cost-report.mjs --session <uuid>          # a specific session
node tools/cost-report.mjs --project <slug>           # explicit project slug, if auto-detection is wrong
node tools/cost-report.mjs --json                     # machine-readable, same figures
node tools/cost-report.mjs --pricing ./my-pricing.json  # check against different/updated rates
```

`--project auto` derives the slug from the current working directory using the same
scheme Claude Code itself uses (see "Where the data comes from" above); pass `--project`
explicitly if that guess is wrong, or if you're costing a session for a project you're
not currently sitting in.

To spot-check a single figure by hand: open the relevant `.jsonl` file, find an
`assistant` line, read `message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`
(and `message.usage.cache_creation.{ephemeral_5m_input_tokens,ephemeral_1h_input_tokens}`
for the cache-write split), and multiply each bucket by its rate in `tools/pricing.json`
for `message.model`. Sum across every `assistant` line for the model/sidechain
combination you're checking, and compare against the row `cost-report.mjs` printed for
that combination.

To reproduce the re-tiering table, there is no shortcut: pull the per-dispatch
descriptions from each `subagents/agent-*.meta.json` (or from the dispatch log the
`hooks/subagent-dispatch-log.*` scripts write, if it was running), classify each against
the model × effort table in `skills/orchestrating-subagents/SKILL.md`, and re-price that
dispatch's tokens (from its own `agent-*.jsonl`) at the reclassified tier's rate in
`tools/pricing.json`.
