# RED baselines: three skills that were tested and deliberately not written

Symphony ships one skill. Three more were planned, scoped, and then **cancelled by their own
test results**. This document is the evidence, because a repo that claims to test its skills owes
you the run where the test said "don't".

## The rule being followed

`superpowers:writing-skills` — the skill-authoring method this repo uses — states it plainly:

> Always include a no-guidance control. **If the control doesn't exhibit the failure, there is
> nothing to fix — stop, don't author the guidance.**

So before writing a skill, you run the scenario it targets against agents that do **not** have it,
and you watch them fail. If they don't fail, the skill has nothing to teach.

## Method

Three scenarios, one per planned skill, 3 repetitions each, 9 agents total, all on `sonnet`, all in
fresh context with no access to the planned skill. Date: 2026-08-19.

---

## 1. `writing-agent-specs` — CANCELLED, 3/3 passed

**Planned premise:** agents write vague dispatch prompts, so cheap models fail on work they could
have handled with a closed spec.

**Scenario given:** delegate entity extraction from 20 markdown docs into a fixed JSON schema to a
`haiku` subagent. Write the exact prompt string.

**What the control actually did — all three:**
- Pasted the full schema inline rather than referring to it
- Gave absolute file paths, enumerated or discovered via glob
- Specified a unique-id scheme to prevent collisions across documents
- Named an exact output path and required valid JSON with no fences
- Constrained the reply format ("do not paste the JSON back")
- Told the agent not to ask clarifying questions and to proceed on ambiguity

One rep went further than the brief: it checked the repo and found `docs/` actually holds 31 `.md`
files, not the 20 stated, and wrote the prompt to discover the real set instead of hardcoding a
wrong count.

**Verdict:** the failure the skill was meant to prevent did not occur. Not written.

---

## 2. `verifying-agent-output` — CANCELLED, 3/3 passed

**Planned premise:** orchestrators trust a subagent's "done" message instead of checking the
artifact.

**Scenario given:** 12 subagents return, all reporting success. What do you do before merging?

**What the control actually did — all three:**
- Refused the self-report explicitly: "an agent's final message describes intent, not verified
  outcome"
- Checked file existence, non-emptiness, and count against the expected number
- Validated JSON parses, then validated against the schema separately
- **Cross-checked each agent's claimed counts against the counts actually in the file** — naming a
  mismatch as evidence the agent hallucinated its own summary
- Checked for duplicate ids and dangling edge references across the merged set, a failure that only
  appears at merge time
- Spot-checked content against source files, noting schema-valid output can still be fabricated
- Merged only after all checks passed, then re-validated the merged artifact

One rep also checked `LastWriteTime`, to catch a stale file from a previous run being mistaken for
a fresh success.

**Verdict:** comprehensively covered without the skill. Not written.

---

## 3. `measuring-orchestration-cost` — INCONCLUSIVE, test invalid

**Scenario given:** after a 12-agent run, answer the user's "did orchestrating actually pay off?"

**Why the test is void:** the agent found and ran `tools/cost-report.mjs` — the tool this repo had
already built — and answered using it. That measures an agent holding the tool, not a control
lacking the knowledge. The scenario cannot be run inside this repo.

**Verdict:** no valid baseline, so no skill. Re-testing would require a machine without Symphony
installed.

---

## Contamination worth disclosing

These baselines ran inside the `Almacen` repo, whose `CLAUDE.md` already carries strong verification
rules — including one that a rep quoted verbatim: *"un resultado NEGATIVO de un one-liner ad-hoc no
es evidencia"* ("a negative result from an ad-hoc one-liner is not evidence").

So the control was not a naked agent. It was an agent already primed by a well-instructed repo. A
cleaner test would run in an empty directory with no `CLAUDE.md`, and **might** show the failures
these runs did not.

That cuts both ways, and honesty requires stating both:
- These results do not prove the skills would be useless everywhere.
- They do prove the skills were unnecessary **here**, under the conditions actually tested — and an
  untested skill written anyway is exactly the padding this repo exists to argue against.

## What this means for the repo

Symphony ships **one** skill instead of four. The dropped three cost nine agent runs to disprove,
and that is the point: the method's value is as much in the skills it stops you writing as in the
ones it lets through.

If you want to challenge this, the scenarios above are reproducible verbatim. Run them in a clean
directory. If your control fails where ours passed, open an issue with the transcript — that is a
contribution, and the skill gets written.
