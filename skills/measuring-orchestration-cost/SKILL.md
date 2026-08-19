---
name: measuring-orchestration-cost
description: Use when asked whether delegating paid off, whether a run was expensive, or how much a fan-out cost — and before quoting any cost figure, saving, or percentage for agent work. Also use when writing a cost claim into a report, README, or commit message, or when a session hit a usage limit and you need to explain where the budget went.
---

# Measuring Orchestration Cost

## Overview

Two questions get confused. *What did this run consume* is measurable from disk. *What would the alternative have cost* was never run and is a counterfactual. Never let the second borrow the authority of the first.

## First: does money even apply?

Before computing a single dollar, establish how the user is billed. Getting this wrong makes every figure that follows decorative.

| Billing | The right unit |
|---|---|
| Subscription (Pro, Max, Team seat) | **Not dollars.** The tokens are already paid for. Report token volume, the share that ran on premium models, and limits hit. |
| Per-token (API key, Bedrock, Vertex, Foundry, Console) | Dollars, priced from a rate card with a retrieval date. |

Claude Code's own docs: *"Claude Max and Pro subscribers have usage included in their subscription, so the session cost figure isn't relevant for billing purposes."* Quoting a dollar saving to a flat-rate subscriber is a number that appears on no bill.

Unknown billing? Ask, or lead with tokens — they are true either way.

## Where the data actually is

```
~/.claude/projects/<slug>/<session>.jsonl              orchestrator turns
~/.claude/projects/<slug>/<session>/subagents/*.jsonl  one file per subagent
```

Only `assistant` lines carry `message.usage`. `isSidechain: true` marks a subagent turn. `message.model` gives the model per turn. Skip `<synthetic>` lines.

**Do not source token counts from completion notifications.** Those are transient conversation state; the transcripts are durable, complete, and re-readable after the fact.

Total context = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. They do not overlap — do not add `iterations[]`, which mirrors the same fields.

## Computing it

```
node tools/cost-report.mjs --session latest        # tokens first, USD subordinate
node tools/cost-report.mjs --no-usd                # subscription: drop dollars entirely
```

Price each component at its own rate: plain input, cache write, cache read, output. A model with no price is reported as unpriced, never guessed.

## The counterfactual, and its ceiling

Re-pricing delegated tokens at the orchestrator's rate answers "what if I hadn't delegated". It is an **upper bound on the saving**, for three reasons, and all three must travel with the number:

1. A cheaper model may need more turns for the same result.
2. It was never executed — it is arithmetic on already-spent tokens.
3. **Fan-out has a measured re-priming tax.** Each subagent builds its own prompt cache; one continuous session builds it once. Measured on a real session: cache-write per unit of output was **5.52** for the orchestrator against **13.22** for subagents — delegated work paid **2.39×** more. Multi-agent spend already carries overhead a solo run would not.

## Do Not

**❌ State that orchestrating is cheaper without having measured this run.** It is conditional, and the published evidence cuts both ways.
**❌ Quote a saving without its upper-bound caveat.**
**❌ Use headline model-price ratios from memory.** Read the rate card; ratios are far tighter than folklore claims.
**❌ Report dollars to a subscriber as if they were billed.**
**❌ Estimate what you can measure.** The transcripts are on disk.

## References

`references/what-to-report.md` — the shape of an honest cost answer, and what to say when the data is missing.
