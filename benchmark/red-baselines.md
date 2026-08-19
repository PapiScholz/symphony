# RED baselines: what got tested, what got written, what got dropped

Symphony ships two skills. Two more were planned and **cancelled by their own test results**. This
document is the evidence, including a first round of testing that was invalid and had to be redone.

## The rule being followed

`superpowers:writing-skills`, the authoring method used here, states it plainly:

> Always include a no-guidance control. **If the control doesn't exhibit the failure, there is
> nothing to fix — stop, don't author the guidance.**

You run the scenario the skill targets against agents that do not have it, and you watch them fail.
If they don't fail, the skill has nothing to teach.

## Round 1 was contaminated. It is reported anyway.

The first pass ran nine agents inside the `Almacen` repo — a project whose `CLAUDE.md` already
carries strong verification rules. One agent quoted it verbatim: *"un resultado NEGATIVO de un
one-liner ad-hoc no es evidencia"* ("a negative result from an ad-hoc one-liner is not evidence").
The `cost` scenario was worse than contaminated: the agent found and ran this repo's own
`tools/cost-report.mjs`, so it measured an agent **holding the tool**, not a control lacking it.

That round concluded all three skills were unnecessary. **That conclusion was not supported by the
evidence**, and round 2 overturned part of it.

## Round 2: clean room

Nine runs, `claude -p` headless, `sonnet`, fresh context each, executed from an empty temp directory
with **no project `CLAUDE.md` anywhere in the ancestor chain** (verified by walking to the filesystem
root) and no Symphony checkout in reach.

Remaining known contamination, disclosed: the user-level `~/.claude/CLAUDE.md` still loads, as it
does in any real session on that machine. A fully virgin environment would need a separate config
dir with its own credentials.

Scored against explicit per-scenario criteria fixed before reading the outputs.

---

## `verifying-agent-output` — DROPPED. 5/5, all three reps

**Premise:** orchestrators trust a subagent's "done" instead of checking the artifact.

**Scenario:** 12 subagents return, all reporting success. What do you do before merging?

Every rep, unprompted, refused the self-report and listed: verify the file exists and is non-empty,
validate it parses, validate against the schema separately, **cross-check each agent's claimed
counts against the counts actually in the file**, hunt duplicate ids and dangling edge references
across the merged set, spot-check content against sources, and only then merge. One added checking
`LastWriteTime` to catch a stale file from a previous run.

Identical result in both rounds. The failure this skill targets does not occur. **Not written.**

---

## `writing-agent-specs` — DROPPED. 3-4/5, marginal

**Premise:** agents write vague dispatch prompts, so cheap models fail on work they could handle.

**Scenario:** delegate schema-bound extraction to a `haiku` subagent; write the exact prompt.

All three pasted the schema inline, gave absolute paths, defined a unique-id scheme to prevent
collisions across documents, and named an exact output path. The consistent gap was minor: two of
three did not tell the subagent to proceed without asking clarifying questions.

A skill for one missing sentence is padding. **Not written.**

---

## `measuring-orchestration-cost` — WRITTEN. Baseline failed 3/3 on the thing that matters

**Scenario:** after a 12-agent run, answer the user's "did orchestrating actually pay off?"

Round 1 could not test this at all — the agent used the repo's own tool. In the clean room the
failure is consistent and specific:

- **3/3 never established how the user is billed.** None asked or noted that on a Pro/Max
  subscription a dollar figure appears on no invoice. One went straight to
  `$ cost = tokens × per-model rate`.
- **3/3 never named `isSidechain`**, the field that separates orchestrator turns from subagent
  turns. One proposed summing `subagent_tokens` from completion notifications — transient
  conversation state — rather than the durable transcripts.
- **One asserted the conclusion outright**: *"this is the actual mechanism behind 'orchestration is
  cheaper at scale'"* — the claim this repo exists to qualify, stated without measuring it.
- One repeated the folklore ratio `haiku << sonnet << opus`. Real Opus:Haiku is 5×, not the 60×
  circulating in comparable skills.

That is a real, repeatable failure in the exact place a wrong answer is most costly: a fabricated
cost figure is indistinguishable from a measured one until somebody audits it.

**Written.**

### GREEN: the same scenario, same clean room, with the skill loaded

Three more runs, identical scenario and environment, the skill read first. Scored on the four
criteria the baseline failed, fixed before reading the outputs:

| Criterion | Without the skill | With the skill |
|---|---|---|
| Establishes the billing model before quoting money | 0/3 | **3/3** |
| Names `isSidechain` to separate orchestrator from subagents | 0/3 | **3/3** |
| Labels the counterfactual as an upper bound | 0/3 | **3/3** |
| Accounts for the cache re-priming tax | 0/3 | **3/3** |

Zero to three on every axis, with the reps converging on the same shape rather than each finding
its own answer — which is the signal the method looks for. Reproduce it by running the scenario in
`benchmark/` with and without `skills/measuring-orchestration-cost/SKILL.md` in context.

---

## What this cost, and what it bought

Eighteen agent runs across two rounds. One skill written, two dropped, and one earlier conclusion
retracted. The method's value shows up as much in the skills it stops you writing as in the ones it
lets through — and in catching that round 1 proved nothing.

If you want to challenge any of this, the scenarios are reproducible verbatim. Run them in a clean
directory. If your control fails where ours passed, open an issue with the transcript: that is a
contribution, and the skill gets written.
