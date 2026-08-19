# Symphony

Skills for orchestrating Claude Code subagents.

## The problem

Delegating work to a subagent has two dials: which model runs it, and how much reasoning
effort it spends. In Claude Code both dials default to *inherit* — a subagent silently
runs at the orchestrator's model and effort unless you set them explicitly. That default
is not neutral. It puts the most expensive model in the fleet on whatever gets delegated,
including the mechanical, checkable, low-judgment work that delegation exists for.

This is not a hypothetical. It happened in the session that produced this skill — the
author, mid-session, writing the rules about tiering delegated work, was at that same
moment delegating work at the wrong tier. The numbers below are measured from that
session's own transcripts, with this repo's own `tools/cost-report.mjs`.

## The numbers

Real session, 230.1M tokens total, measured directly from Claude Code's on-disk
transcripts (see `METHODOLOGY.md` for exactly how). Tokens are what every reader pays in
— API/Bedrock/Vertex/Foundry users in dollars, Pro/Max/Team subscribers in quota — so
that's what leads here. If you're billed per token, the dollar breakdown has its own
section below.

| | tokens | share of session |
|---|---|---|
| Orchestrator (fable-5 + opus-5) | 151.5M | 66% |
| Subagents (opus-5 + sonnet-5 + fable-5) | 78.7M | 34% |
| **Total** | **230.1M** | |

Subagent totals by model — this is the line that carries the argument:

| Model | Turns | Tokens | Share of delegated tokens |
|---|---|---|---|
| `claude-sonnet-5` | 473 | 49.2M | 62% |
| `claude-opus-5` | 188 | 19.5M | 25% |
| `claude-fable-5` | 86 | 10.0M | 13% |

**38% of delegated tokens — 29.5M of 78.7M — ran on premium models, Fable and Opus,
doing mechanical work: filling a fixed JSON schema, writing short labels.** That's
exactly the shape of work the skill's own model × effort table (below) puts at
`haiku`/`low`. Fable took 86 turns to sonnet's 473 — a fifth of the turn count — while
still consuming 10.0M tokens.

> **These figures are a snapshot, and the tool will not reproduce them exactly.** They
> were captured while the session was still running. Re-run later in the same session and
> the premium share *falls* — not because anything was rewritten, but because the premium
> total stopped growing once the mistiering was corrected, while sonnet's kept climbing.
> A later reading of the same session shows 29.46M premium tokens against a larger
> delegated total: the same absolute premium volume, a smaller share. The number that
> matters is the absolute one.

### What the mistiering actually cost

Not money, first — a ceiling. Fable and Opus carry a model-specific rate limit on top of
the shared session/weekly window. Claude Code's own documentation on rate limits:

> Session and weekly windows "are shared across all models, so switching models with
> `/model` doesn't restore access, though it does keep the developer working after the
> model-specific 'You've hit your Opus limit' message."

Mid-session, the mechanical schema-filling running on Fable exhausted that
Fable-specific limit, and **three in-flight subagents doing the same mechanical work
were killed** — the harness returned `Agent terminated early due to an API error:
You've reached your Fable 5 limit` for each. Their partial output had to be inspected
and the work partly re-run.

A note on what backs that claim, because this repo is asking you to trust its numbers:
the token tables above are reproducible by anyone with the transcripts and
`tools/cost-report.mjs`. **This particular incident is not.** It was observed by the
author in the session's own conversation; the dispatch log
(`hooks/subagent-dispatch-log.*`) records what model each dispatch *requested*, not
whether it later died, so no published artifact in this repo proves it. Treat it as a
first-hand report, not as verifiable evidence. The example line in
`references/learning-log.md` that describes this event is illustrative documentation of
the log format — it is not a captured record, and citing it as one would be circular.

**What this does not claim:** that a cheaper model drains the *shared* session/weekly
quota more slowly than an expensive one for the same work. That isn't documented
anywhere and wasn't measured here — see `METHODOLOGY.md` for why it's deliberately left
unasserted. What's verifiable is narrower: premium models carry their own separate
ceiling, mechanical work burns it for no benefit, and exhausting it killed real work
in flight. On a flat-rate plan, that's the actual cost of mis-tiering — not a dollar
figure, a ceiling arriving early with subagents mid-task.

## If you pay per token (API, Bedrock, Vertex, Foundry)

Everything in this section applies only if your account is billed by consumption. If
you're on a Claude Pro, Max, or Team seat, this doesn't apply to your bill — Claude
Code's own docs say so directly:

> "The Session block in `/usage` shows API token usage and is intended for API users.
> Claude Max and Pro subscribers have usage included in their subscription, so the
> session cost figure isn't relevant for billing purposes."

And where it is relevant, it's an estimate, not an invoice:

> "Claude Code computes the dollar figure locally from token counts priced at standard
> list rates, so it doesn't reflect promotional pricing or contracted discounts and may
> differ from your actual bill."

With both caveats stated in Anthropic's own words, here's the same session priced at
standard list rates:

| | tokens | USD |
|---|---|---|
| Orchestrator (fable-5 + opus-5) | 151.5M | $130.22 |
| Subagents (opus-5 + sonnet-5 + fable-5) | 78.7M | $94.82 |
| **Total** | **230.1M** | **$225.05** |

Subagent totals by model:

| Model | Turns | Tokens | USD |
|---|---|---|---|
| `claude-sonnet-5` | 473 | 49.2M | $22.17 |
| `claude-opus-5` | 188 | 19.5M | $35.71 |
| `claude-fable-5` | 86 | 10.0M | $36.95 |

Fable did one fifth of sonnet's turns and cost 67% more.

Re-tiering the delegated work per the skill's own model × effort table (mechanical
extraction/labeling → haiku, bounded-judgment work → sonnet, kept as-is otherwise):

| | USD |
|---|---|
| Session as actually run | $225.04 |
| Same work, tiered per the table | $170.37 |
| **Difference** | **$54.68 — 24% of total, 58% of the delegated portion** |

(The one-cent gap between $225.05 and $225.04 above is rounding at different aggregation
points in the two calculations, not an arithmetic error — see `METHODOLOGY.md`.)

The number that keeps this honest: the orchestrator alone was 58% of the total cost
($130.22 of $225.05), and that portion is **irreducible** by tiering. Something has to
read everything, plan, and integrate results, and in this session nothing cheaper than
fable/opus could carry that role. Tiering caps out at the delegated 42% of the bill —
which is why the saving above is 24% of the total, not close to it.

**The $170.37 figure is a counterfactual, not a second measurement.** It applies cheaper
per-token rates to token volumes that were actually spent, assuming the same number of
turns at the cheaper tier. In practice a smaller model sometimes needs more turns to
reach the same result, which eats into the saving, and a single continuous session would
not have re-created each subagent's prompt cache from scratch the way the parallel
subagents did. It is an upper bound, not a promise. Full reasoning in `METHODOLOGY.md`.

## What the skill does

`skills/orchestrating-subagents/SKILL.md` loads whenever you're about to dispatch one or
more subagents — a single delegated search, a parallel fan-out, or a repeated batch — or
when you're writing a `.claude/agents/*.md` definition.

It sets out:

- **The dispatch contract.** A one-off `Agent` call takes exactly four fields —
  `subagent_type`, `model`, `description`, `prompt` — filled every time. `effort` is
  *not* a parameter of the `Agent` tool; setting it there is silently ignored. Effort is
  set in a `.claude/agents/*.md` definition's frontmatter, in a workflow stage's
  `opts.effort`, or shaped through the prompt itself for a one-off call.
- **A model × effort table**, keyed to the shape of the work: filling a fixed schema or
  labeling gets `haiku`/`low`; locating code or bounded-judgment reading gets
  `sonnet`/`medium`; multi-file implementation or debugging gets `sonnet`/`high`;
  architecture, design, and adversarial verification get `opus` or `fable` at
  `high`/`xhigh`. The prompt sets the tier, not the topic — a closed spec (schema pasted
  in, output path given, success criterion stated) is what makes a cheap model
  sufficient; prose-described work takes `sonnet` as the floor.
- **How to read a returned agent's `tool_uses`, `subagent_tokens`, and `duration_ms`** —
  many turns on simple work means under-tiered, ~2 calls on work you thought was hard
  means over-tiered, and the fix applies to what you haven't launched yet, never to
  agents already in flight.
- **Common mistakes**, including omitting `model` "because the work deserves quality" (it
  buys the orchestrator's price, not quality), one tier for a mixed batch, and passing
  `effort` to the `Agent` tool where it does nothing.
- **Five reference files** for deeper detail: `agent-definition.md` (frontmatter fields,
  where definitions live, model/effort resolution order), `platform-limits.md`
  (concurrency caps, nesting, allowlist fallback), `prompt-templates.md` (reusable
  dispatch prompts by role), `workflows.md` (escalating to a scripted workflow, per-stage
  tiering), and `learning-log.md` (recording outcomes and reusing them next batch).

## The second skill: `measuring-orchestration-cost`

`skills/measuring-orchestration-cost/SKILL.md` loads before you quote any cost figure, saving,
or percentage for agent work — or when a run hits a usage limit and you have to explain where
the budget went.

It exists because its baseline failed, repeatably, on the thing that matters most. Three agents
in a clean room, asked "did orchestrating pay off, show me":

- **None established how the user is billed.** One went straight to
  `$ cost = tokens × per-model rate` — a figure that appears on no invoice for a Pro/Max
  subscriber.
- **None named `isSidechain`**, the field separating orchestrator turns from subagent turns.
  One proposed summing token counts from completion notifications — transient conversation
  state — instead of the durable transcripts.
- **One asserted the conclusion**: *"this is the actual mechanism behind 'orchestration is
  cheaper at scale'"*, stated without measuring it.
- **One repeated the folklore ratio** `haiku << sonnet << opus`. Real Opus:Haiku is 5×, not the
  60× circulating in comparable skills.

So it teaches: establish the billing model first, read usage from the transcripts, price each
token component separately, and never let a counterfactual borrow the authority of a
measurement.

### Two skills that were tested and deliberately not written

`verifying-agent-output` and `writing-agent-specs` were planned and cancelled by their own
tests. Without any skill, agents already refused to trust a subagent's "done" — checking the
artifact on disk, validating the schema, cross-checking claimed counts against real ones, and
hunting dangling references before merging (5/5, all reps). And they already pasted full schemas
into dispatch prompts with absolute paths and unique-id schemes. Writing those would have padded
the repo with guidance that demonstrably teaches nothing.

A first round of this testing was **contaminated and is retracted** — it ran inside a repo whose
`CLAUDE.md` already carries verification rules, and its cost scenario used this repo's own tool.
The clean-room re-run, the retraction, and how to challenge any of it are in
[`benchmark/red-baselines.md`](benchmark/red-baselines.md).

## Install

```
npx skills add PapiScholz/symphony              # skills only
```

```
/plugin marketplace add PapiScholz/symphony     # then: /plugin install symphony@symphony
```

The plugin route also installs the dispatch-logging hook (below); the skills-only route
does not.

## What's in the repo

```
skills/orchestrating-subagents/   SKILL.md + 5 reference files (above)
hooks/                            subagent-dispatch-log.sh, subagent-dispatch-log.ps1
tools/cost-report.mjs             zero-dependency Node CLI: real token cost from transcripts
tools/pricing.json                per-model $/MTok rates, dated and sourced
tools/transcript-schema.json      the reverse-engineered transcript format this all reads
```

`hooks/subagent-dispatch-log.sh` and `.ps1` are a matched pair (POSIX shell and
PowerShell) implementing the same `PreToolUse` observer for the `Agent`/`Task` tools.
Each run it logs, to a local JSONL file, which model and effort a dispatch actually
requested — in particular, it records `model: INHERITED` when the call omitted the
field, which is otherwise invisible in the transcript after the fact. It never blocks
the call and always exits 0: a `PreToolUse` hook that denies forces a retry, and that
retry is paid for in tokens, so the hook is written so no failure path can escape that
`exit 0`.

`tools/cost-report.mjs` reads a session's on-disk transcripts and produces the tables
above (orchestrator vs. subagent, and subagent-by-model, in both tokens and dollars)
directly — no other setup required. See "How to reproduce the numbers" below.

## When NOT to orchestrate

| Situation | Why |
|---|---|
| Work too small for the per-agent context overhead | A subagent reloads CLAUDE.md, git status, and its own system prompt before it does anything — fixed cost that a two-minute task can't amortize. |
| Tightly coupled work where shared context is the asset | A subagent starts from zero: no conversation history, no output style, no parent skills. Splitting work that depends on that shared context forces you to restate it in every prompt, or lose it. |
| Specs that cannot be closed | A cheap tier only works against a closed spec (schema, path, success criterion). An open-ended prose task takes `sonnet` as the floor regardless of how simple it sounds, and multi-agent failure research (below) finds most multi-agent failures trace to spec ambiguity, not model weakness. |
| Anything where the orchestrator's own cost dominates the total | In the measured session, the orchestrator was 58% of the bill and untouchable by tiering. If your ratio looks similar, optimizing the subagent tier is optimizing the smaller number. |

## Evidence

Orchestration and tiering are conditional wins, not universal ones. Both sides:

**Supporting** — routing and cascading save cost or improve quality on the right shape of
work:
- [FrugalGPT](https://arxiv.org/abs/2305.05176) — matches GPT-4 accuracy at up to 98%
  lower cost via cascading.
- [RouteLLM](https://arxiv.org/abs/2406.18665) — over 2x cost reduction with no quality
  loss.
- [Mixture-of-Agents](https://arxiv.org/abs/2406.04692) — orchestrated open models beat
  GPT-4o on AlpacaEval 2.0.
- [Anthropic's multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
  — beat single-agent Opus by 90.2%, **using roughly 15x the tokens**, and Anthropic says
  explicitly that this suits parallelizable research, not most coding tasks.

**Against** — multi-agent orchestration fails often, and not always for the reason you'd
expect:
- [MAST](https://arxiv.org/abs/2503.13657) — multi-agent systems fail 41-86.7% of the
  time, mostly from specification ambiguity and coordination breakdowns, not from model
  weakness.
- [Cognition — "Don't Build Multi-Agents"](https://cognition.com/blog/dont-build-multi-agents)
- [arxiv.org/abs/2604.02460](https://arxiv.org/abs/2604.02460) — with reasoning-token
  budget held constant, single-agent matches or beats multi-agent.

Read together: routing and cascading reliably save cost when task difficulty is
heterogeneous. Orchestration wins on quality for parallelizable, verifiable work, given
more total compute to spend. It degrades when the spec is loose or the coordination is
unengineered — which is most of the time multi-agent setups get tried casually.

## How to reproduce the numbers

`tools/cost-report.mjs` is a zero-dependency Node (>=18) CLI that reads Claude Code's own
on-disk transcripts and prices them against `tools/pricing.json`:

```
node tools/cost-report.mjs --session latest --project auto
node tools/cost-report.mjs --session <uuid> --json
node tools/cost-report.mjs --pricing ./tools/pricing.json
```

Run from inside the project whose session you want to cost (or pass `--project <slug>`
explicitly); it derives the project slug from the current working directory the same way
Claude Code does. It prints the orchestrator/subagent split and the per-model subagent
breakdown directly, in both tokens and dollars — the token tables above and the dollar
tables in "If you pay per token" come straight out of it. The re-tiering table ($170.37
/ $54.68) is a manual step on top, not a flag; see `METHODOLOGY.md` for exactly what the
tool automates and what it does not.

## License

[MIT](LICENSE)
