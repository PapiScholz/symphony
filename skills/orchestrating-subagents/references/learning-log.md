# Learning log

Load before sizing a fan-out, and after a batch returns.

The table in SKILL.md is a starting point, not a verdict. It says what a *kind* of work usually
needs; the log says what *this* kind of work actually needed last time, on this machine. When they
disagree, the log wins — it is evidence and the table is a prior.

## Where it lives

`~/.claude/subagent-runs.jsonl` — one JSON object per line, appended.

A `PreToolUse` hook on the `Agent` tool writes the dispatch half automatically. The hook never
blocks: it exits 0 unconditionally, so it cannot cost a retry. If the file is missing, the hook is
not installed and the log is simply empty — nothing else breaks.

## Consulting it before you dispatch

```bash
# what tier did this kind of work end up needing?
grep -i '"kind":"extract"' ~/.claude/subagent-runs.jsonl | tail -20

# every dispatch that came back mis-tiered, most recent last
grep -E '"verdict":"(under|over)"' ~/.claude/subagent-runs.jsonl | tail -20
```

Two questions worth answering before writing the batch:

1. **Has this shape of work run before?** If yes, start from the tier that came back `ok`, not from
   the table.
2. **Did it ever come back `under`?** If yes, the prompt was probably the problem, not the model —
   check whether the spec was closed before you raise the tier.

## Closing the loop after it returns

Each completion reports `tool_uses`, `subagent_tokens`, `duration_ms`. Append the outcome half.

The two lines below are **hand-written examples of the format, not captured records** — do not cite
them as evidence of anything:

```jsonl
{"ts":"2026-08-18T21:40:00Z","kind":"label","model":"haiku","effort":"low","tool_uses":2,"tokens":18400,"verdict":"ok"}
{"ts":"2026-08-18T21:41:00Z","kind":"extract","model":"fable","effort":"high","tool_uses":18,"tokens":192246,"verdict":"over","note":"mechanical schema fill; hit the Fable rate limit and killed 3 siblings"}
```

Fields: `kind` (your own short label for the work shape — reuse the same string for the same shape,
that is what makes the log queryable), `model`, `effort`, `tool_uses`, `tokens`, `verdict`
(`ok` | `under` | `over`), optional `note`.

**Verdict rubric**, so the word means the same thing every time:

| verdict | when |
|---|---|
| `ok` | finished in a turn count proportional to the work, output usable as returned |
| `under` | many turns, asked for clarification, or output needed correction before use |
| `over` | trivial turn count for the tier, or died on a rate limit the work did not justify |

An `over` is worth logging even when the result was fine — that is the entry that saves money next
time, and it is the one there is no incentive to write down.

## When a lesson outlives the log

The log is per-machine, unversioned, and rotates. If a finding is durable — a whole class of work
that always needs a different tier than the table says — it belongs in memory or in the table
itself, not only here. Rotate the file when it passes a few thousand lines; keep the tail.
