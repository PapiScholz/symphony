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

## Correction to round 2's published harness

`benchmark/scenarios/run-baselines.sh`, the script committed as round 2's harness, opens with
`cd "$(dirname "$0")"`. That places the working directory at `benchmark/scenarios/` — **inside this
repo**, two levels below a root containing `skills/orchestrating-subagents/`,
`skills/measuring-orchestration-cost/` and `tools/cost-report.mjs`. The clean-room paragraph above
says round 2 ran with "no Symphony checkout in reach". As committed, the script does not reproduce
that condition.

What is and is not being claimed here:

- **Verifiable:** a third party running the published script does not get the documented clean room.
  That is a reproducibility defect and it is the reason this note exists.
- **Not claimed:** that round 2's results are contaminated. The evidence points the other way —
  reaching this repo's own tooling would have *improved* the `cost` baseline, and that baseline
  failed 3/3 on exactly the points the tooling would have supplied (`isSidechain`, the billing
  model). An agent that had found `tools/cost-report.mjs` would not have proposed summing token
  counts from completion notifications.

Round 3 below replaces assertion with enforcement: `run-baselines-round3.sh` walks the ancestor
chain to the filesystem root and **aborts** on a project `CLAUDE.md` or on any reachable Symphony
checkout, rather than trusting where it was launched from. Each of those guards was tested by
making it fire before the round was run.

---

## Round 3, attempt 1 — RETRACTED. The control was holding the skill.

The first execution of round 3 ran nine baselines in a directory that passed every filesystem
guard: empty, no project `CLAUDE.md` anywhere up to the filesystem root, no Symphony checkout
reachable. It was still contaminated, and the outputs say so in their own words.

Claude Code loads **user-level plugins into every session on the machine**, including a headless
`claude -p` launched from an empty temp directory. Symphony was installed as a plugin on the
authoring machine. So every control had `orchestrating-subagents` and
`measuring-orchestration-cost` in context while being tested on what an agent does *without*
them.

The controls quoted the material back:

- `recovery` rep2: *"**per the model table** that's a `haiku`/low-effort job, not something that
  needs `fable`."* — "the model table" is this skill's model × effort table.
- `recovery` rep1: *"«filling a fixed schema» is mechanical work that belongs on `haiku` at `low`
  effort, not on `fable`."* — the table's first row, nearly verbatim.
- `recovery` rep3: *"…if the source files are large/dense enough that haiku might **thin out** on
  them"* — "thin out" is the skill's phrasing.
- `context` rep2 opened with *"Checked the transcripts first (**per the cost skill**: measure,
  don't estimate)"*, naming the second skill outright.

`recovery` scored 3/3 on four of its five criteria. Read naively that is a clean DROP: the
behaviour is already there, the skill teaches nothing. It is the opposite. The behaviour was
there because the answer was in the room. **This is round 1's error with the sign flipped** —
round 1's contamination made skills look unnecessary too, and that conclusion had to be
retracted as well.

Confirmed directly rather than inferred, from an empty temp directory:

```
$ printf 'List every skill available to you ... If none, output NONE.' | claude -p --model sonnet
symphony:measuring-orchestration-cost
symphony:orchestrating-subagents
```

**Why no filesystem guard could have caught this.** Guards 1-3 inspect the disk. The
contamination did not come from the disk near the run directory; it came from the user's global
plugin configuration, which is invisible from where the guards look. A harness that checks the
filesystem is answering the wrong question.

**The fix, in two parts.** Every model call now passes `--safe-mode`, which starts a session with
CLAUDE.md, skills, plugins, hooks, MCP servers, custom agents and output styles disabled while
leaving auth and model selection intact. And a fourth guard **asks the model itself** what it can
see, before any baseline is paid for, aborting the round if a Symphony skill answers. Trusting the
flag would repeat the original mistake: the flag is verified, not assumed.

Note that `--safe-mode` makes round 3's clean room **stricter than round 2's**, which accepted the
user-level `~/.claude/CLAUDE.md` as disclosed residual contamination. That residue is now gone
too, so the two rounds are not strictly comparable.

**What this implies for round 2.** Uncertain, and left uncertain rather than resolved by
assertion. The plugin cache on the authoring machine is dated after round 2's results were
written up, so round 2 most likely predates the plugin entirely — but round 2's raw outputs were
not kept, so it cannot be re-audited. What can be said is that round 2's reported failure mode is
the one contamination would have prevented: its `cost` controls never named `isSidechain`, and the
skill names it explicitly. A control holding that skill does not produce that miss.

---

## Round 3 — criteria fixed before any output was read

Three scenarios, three reps each, `claude -p --model sonnet`, enforced clean room. The scoring
criteria below were written into this file **before the first run produced a byte**, which is the
only thing that keeps the scoring from drifting toward the result you were hoping for.

Three of the six candidate topics were dropped before testing, because a read of the shipped skills
found them already covered: workflow shape (`pipeline()` vs `parallel()` and barriers) in
`references/workflows.md`, adversarial verification with distinct lenses in
`references/prompt-templates.md`, and agent-team cost and idle-notification behaviour in
`references/platform-limits.md`. Testing those would have measured nothing.

### Scenario `context` — the orchestrator's own context budget

**Premise:** the orchestrator is the largest single consumer in a fan-out and has no guidance about
its own window. Nothing in the shipped skills addresses it.

A rep passes a criterion only if the text supports it explicitly.

1. Accounts for the orchestrator's window as the **returned result payloads plus its own file
   reads** — and does not confuse it with the subagents' internal token use, which never enters the
   orchestrator's window.
2. Names a concrete mechanism for keeping payloads out: agent writes an artifact to disk and
   returns a path or short summary, a schema-capped return, or a search-only agent type so file
   dumps stay inside the subagent.
3. Distinguishes the **context window** (a per-session capacity limit) from **token consumption**
   (quota or billing). They fail differently and get conflated constantly.
4. Does not reach for `/compact` or `/clear` as the primary fix without stating what it destroys —
   the integration context is the orchestrator's entire value.
5. Quotes no percentage or share it did not measure.

### Scenario `threshold` — when NOT to orchestrate

**Premise:** asked to fan out work that is too small and too coupled for it, the orchestrator
complies instead of pushing back.

**Method note:** the prompt ends *"Respond to them"*, not *"set up the orchestration"*. A scenario
that orders the agent to orchestrate tests nothing — a baseline that complies is obeying, not
failing. The scenario has to leave room to say no.

1. Declines to fan out, or states plainly that fanning out is the wrong call here.
2. Names the **fixed per-agent overhead** as the reason — a subagent reloads its system prompt,
   project instructions and context before doing anything — not merely "this is a small task".
3. Names the **coupling**: a rename needs global consistency, and independent agents cannot verify
   each other's edits.
4. Offers the concrete cheaper alternative.
5. Gives a reusable **threshold rule**, not a one-off intuition.

### Scenario `recovery` — agents that died mid-flight

**Premise:** three of twelve agents die on a model-specific rate limit. The shipped skill says
"check the artifact on disk before relaunching" three times but never says how.

**Declared risk:** `verifying-agent-output` already scored 5/5 on checking artifacts. An agent that
verifies on success will plausibly verify on failure too. If this baseline passes it is dropped and
documented as dropped, like the other two. That is the method working.

1. Checks disk for the three artifacts **before** dispatching anything.
2. Distinguishes present-and-valid from present-and-partial from absent, and handles the partial
   case explicitly — a truncated artifact that still parses is the dangerous one.
3. Re-dispatches at a **lower** tier, not the tier that just hit its ceiling.
4. Leaves the nine successful agents alone.
5. Scopes the relaunch to what is actually missing rather than re-running the batch.

---

## Round 3 results

Nine controls, `claude -p --safe-mode --model sonnet`, enforced clean room, contamination probe
clean on every run. Scored against the criteria above, which were written before any output
existed and were not touched afterwards.

| Scenario | Result | Verdict |
|---|---|---|
| `context` | C1 2/3 · **C2 3/3** · C3 0/3 · **C4 3/3** · C5 1/3 | **DROPPED** |
| `recovery` | R1-R5 **5/5, all three reps** | **DROPPED** |
| `threshold` | T1 1/3 · **T2 0/3** · **T3 0/3** · T4 1/3 · **T5 0/3** | **WRITTEN** |

A note on `--safe-mode`, because it cuts against us: it also removes the author's user-level
`~/.claude/CLAUDE.md`, which is long and pushes agents toward more rigour. The controls here are
noticeably terser than the contaminated round's (372-573 bytes against 813-1281 on `threshold`).
That is the *correct* baseline for a published skill — a stranger installing it does not have the
author's config — but it means a skill can look more necessary here than it would to someone with
a strong personal setup. Stated rather than buried.

---

### `context` — DROPPED. The mechanism is already known

**Premise:** the orchestrator is the largest consumer in a fan-out and has no guidance about its
own window.

All three controls independently proposed the same fixes: schema-capped returns, bulky output
written to a file with only a path returned, and compaction treated as a last resort. One:

> "Treat auto-compaction as a last resort, not a plan: it's lossy for 'which agent said X vs Y'
> granularity, which is precisely what reconciliation depends on."

A skill teaching that would document what agents already do. **Not written.**

Two real gaps survive, and neither is a skill:

- **C3, 0/3.** None separated the **context window** (a per-session capacity limit) from **token
  consumption** (quota or billing). All three treat them as one undifferentiated resource. That is
  a paragraph in an existing skill, not a new one.
- **C5, 2/3 failed** by quoting arithmetic they never measured — *"easily 1.5-4k tokens per agent
  × 14 = 20-55k tokens"*. That is `measuring-orchestration-cost`'s territory, and this is
  independent confirmation of its premise arriving from a scenario that was **not about cost at
  all**. Evidence for the skill that already exists.

### `recovery` — DROPPED. 5/5, all three reps

**Premise:** three of twelve agents die on a model-specific rate limit; the orchestrator relaunches
blind.

The risk was declared in writing before the round ran: `verifying-agent-output` had already scored
5/5 on checking artifacts, so an agent that verifies on success would plausibly verify on failure.
It did. All three checked disk before dispatching, treated the nine "successes" as unverified,
distinguished truncated from absent, and re-dispatched only the missing slices off Fable. One went
further than the criteria required:

> "Don't trust the 9 'successes' blindly — verify them first. Agent self-reports describe intent,
> not necessarily reality... Any that fail validation get bucketed with the 3 known failures."

**Not written.**

An honest oddity: the *clean* controls scored **better** than the contaminated ones on R5 (3/3
against 1/3). With three reps this is not a mechanism, but the plausible reading is that the
skill's own phrasing — "check the artifact on disk before relaunching" — *narrows* attention to
the agents that died, while a control reasoning from scratch generalises to all twelve. Recorded
because it is inconvenient, not despite it.

### `threshold` — WRITTEN. The failure is behavioural, not verbal

**Premise:** told to fan out work that is too coupled for it, the orchestrator complies.

This round the controls ran inside a real scaffolded repository — 40 files, 12 mentioning
`apiTimeout`, plus config, README and docs — so they **did the work** rather than describing a
plan. Two of three fanned it out. One opened with:

> "Done. All 15 agents finished cleanly and a repo-wide grep confirms zero remaining references to
> `apiTimeout`."

Fifteen agents to change one key in fifteen files. And the third produced the finding this skill
is built on:

> "the config.js/services-1–4 agent flagged an 'anomaly' mid-run — it saw other files already
> renamed that it never touched. That's just the other three parallel agents finishing their edits
> concurrently, **not an actual issue**."

The coupling surfaced, was recognised, and was dismissed — by the orchestrator that created it.
On a rename with a clean grep afterwards it happened to be harmless. On a change whose halves must
agree, that same dismissal ships a broken tree behind twelve green reports.

Zero of three named the fixed per-agent overhead. Zero named the coupling. Zero gave a rule that
transfers — even the one that declined justified it as a judgement about *this* task's uniformity
rather than a criterion.

**Written**, as `when-not-to-orchestrate`.

---

### GREEN for `when-not-to-orchestrate` — partial, and reported as partial

Same harness, same clean room, same scenario, same rep count. One variable changed: the SKILL.md
appended to the system prompt. Two versions were tested, and **both are reported** — publishing
only the better arm would be choosing the result.

| Criterion | RED (no skill) | v1 — 763 words | v2 — 998 words, refactored |
|---|---|---|---|
| T1 declines the fan-out | 1/3 | **3/3** | 1/3 |
| T2 names fixed per-agent overhead | 0/3 | 0/3 | 1/3 |
| T3 names the coupling | 0/3 | 2/3 | 2/3 |
| T4 gives the cheaper alternative | 1/3 | **3/3** | 3/3 |
| T5 gives a transferable rule | 0/3 | 1/3 | 1/3 |

**v1 ships.** The rule for choosing between them — best T1, the criterion the skill exists to move
— was written down before either arm was scored.

**What the skill does reliably:** it changes the decision. T1 goes 1/3 → 3/3 and T4 1/3 → 3/3, with
the three reps converging on the same shape rather than each inventing its own. None of them quote
the skill; all three restate it applied to the task.

**What it does not:** T2 stayed at 0/3 and T5 reached only 1/3. The skill has a section on
per-agent overhead that its readers do not reproduce, and a rule they state as a fact about today's
files — *"this was one rename applied at 12 identical call sites"* — rather than as a criterion.
That is a real limitation of the artifact, not a rounding error, and it is not claimed away.

**The refactor made it worse, which is why it was reverted.** v2 added a "Saying It" section with a
worked example, aimed squarely at T2 and T5. T2 did tick up — one rep produced *"each agent would've
paid full startup cost to change one identical string"*, the only time any rep in any arm hit that
criterion. But T1 collapsed from 3/3 to 1/3: two of three reps stopped addressing the parallel-agent
request at all and regressed to bare completion reports of 295 and 298 bytes, below RED's own range.
With three reps per arm this is not a proven mechanism, and it is not being sold as one. The
hypothesis worth testing later is that a longer, more prescriptive skill competes for attention with
the task in front of it.

### A limitation both GREEN arms share

`--append-system-prompt-file` puts the skill's **body** into the system prompt. That tests whether
the content changes behaviour, which is the question the method asks. It does **not** test whether
the skill would fire on its own: in real use only the `description` is always resident — about 120
to 130 tokens per skill, per `claude plugin details` — and the body loads when the description
matches. Round 2's GREEN has the same gap.

Closing it does not need a new harness. `claude plugin eval` runs cases against a plugin through
the real loading path and adds a no-plugin baseline arm of its own (`--ablation with-without`),
with graders marked `with-only` — including `tool_used: Skill` — acting as a plugin-*fired*
indicator rather than part of the score. That is exactly the missing measurement, and it is the
instrument for the next round.

**It is not usable yet from here.** `claude plugin eval` is in early access, and on the authoring
machine it exits with `plugin eval is currently in early access` — `init` included, so not even a
case template can be generated. No eval suite is shipped in this repo, because a suite that has
never been executed is not a test, and committing one would repeat the mistake this document
exists to record. When access lands, the three round-3 scenarios port over directly: each becomes
a case, `scaffold_script` replaces the harness's repo scaffolding, `--runs 3` matches the rep
count, and the ablation arm replaces `--safe-mode` plus the contamination probe.

---

## What this cost, and what it bought

Thirty-three agent runs across three rounds, nine of which were thrown away when the controls
turned out to be reading the skill under test. Two skills written, three dropped, and two earlier
conclusions retracted. The method's value shows up as much in the skills it stops you writing as in the ones it
lets through — and in catching that round 1 proved nothing.

If you want to challenge any of this, the scenarios are reproducible verbatim. Run them in a clean
directory. If your control fails where ours passed, open an issue with the transcript: that is a
contribution, and the skill gets written.
