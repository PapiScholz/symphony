# Escalating to a workflow

Load when the fan-out is large enough or repetitive enough that turn-by-turn orchestration is the
wrong tool.

## When a workflow beats plain dispatch

Plain `Agent` calls keep the plan in your head: you decide turn by turn what to spawn next, and every
intermediate result lands in your context. A workflow moves the plan into a script — the loop, the
branching and the intermediate results live in script variables, and only the final answer reaches
you.

Reach for one when:
- the same step must run over many items (a migration, an audit, a sweep);
- the orchestration itself is worth keeping and re-running;
- you want a quality pattern encoded — independent finders, then adversarial verifiers — rather than
  a single pass.

Stay with plain dispatch for a handful of one-off tasks, or when you need to look at each result and
decide what comes next.

**Consent is required.** Never start a workflow on your own initiative: the user must ask for one, or
say `ultracode`, or invoke a skill that calls it. A workflow can spawn dozens of agents.

## Model and effort per stage

Every agent in a workflow uses the **session's** model unless the script says otherwise — the same
inheritance trap as a plain dispatch, one level further away from view.

```js
const found = await agent(prompt, { model: 'haiku', effort: 'low', schema: FINDING })
```

`opts.model` and `opts.effort` take the same values as the dispatch contract. Set them per stage:
a discovery stage and a verification stage almost never deserve the same tier.

`CLAUDE_CODE_SUBAGENT_MODEL` overrides `opts.model` too, so it flattens a carefully tiered script.

## Shape

`pipeline(items, stage1, stage2, …)` runs each item through every stage independently, with no
barrier between stages — item A can be in stage 3 while item B is still in stage 1. This is the
default.

`parallel(thunks)` is a **barrier**: it waits for all of them. Justified only when a stage genuinely
needs every prior result at once — dedup across the whole set, an early exit on zero findings, or a
prompt that compares findings against each other. "I need to flatten the array first" is not a
reason; do that inside a pipeline stage.

A thunk that throws resolves to `null` rather than rejecting, so `.filter(Boolean)` before using
results.

## Budget

`budget.total` is the turn's token target (`null` if unset), `budget.spent()` and
`budget.remaining()` track it. It is a hard ceiling: once spent reaches total, further `agent()`
calls throw. Guard loops on `budget.total` — with no target, `remaining()` is `Infinity` and the loop
runs to the 1000-agent cap.

## Practical notes

- Scripts are plain JavaScript, not TypeScript. `Date.now()`, `Math.random()` and argless
  `new Date()` throw, because they would break resume — pass timestamps in through `args`.
- Every run persists its script under the session directory and returns the path; edit that file and
  re-invoke with `scriptPath` instead of resending the whole script.
- `resumeFromRunId` replays the unchanged prefix from cache and re-runs from the first edited call.
- If a completed run returns something unexpected, read `journal.jsonl` in the transcript dir before
  theorising — it records what each agent actually returned.
- Log what a script drops. A silent top-N or no-retry reads as "covered everything" when it did not.
