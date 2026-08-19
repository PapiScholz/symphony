# The shape of an honest cost answer

Load when writing the actual answer, or when the data you need is missing.

## Order

1. **Billing model first.** One line: subscription or per-token. Everything downstream depends on it.
2. **What was consumed** — measured. Tokens by model, orchestrator vs delegated, the premium share
   of delegated work.
3. **What it means** — limits hit, work lost, wall-clock.
4. **The counterfactual** — last, labelled, with its ceiling attached.

Never invert 2 and 4. A counterfactual quoted before a measurement reads as a measurement.

## For a subscriber

The useful facts are:

- **Premium share of delegated work.** Mechanical work on a premium model buys nothing.
- **Model-specific limits.** Premium models carry their own ceiling on top of the shared session and
  weekly windows. Burning it on schema-filling is the expensive mistake, not the token count.
- **Work lost.** Hitting a limit kills agents in flight, and their partial output has to be checked
  and re-run.

Do **not** claim a cheaper model drains the shared quota more slowly. That is undocumented. The
windows are shared across models; only the premium ceilings are separate.

## For a per-token payer

Dollars, with the pricing file's retrieval date and source printed alongside. Prices change; a
figure without a date is unverifiable in six months.

## When the data is missing

Say which of these is true rather than producing a number anyway:

| Situation | Say |
|---|---|
| Transcripts not on this machine | "Usage lives in the session transcripts; I do not have them here." |
| Model has no price in the rate card | Report its tokens, exclude it from totals, name it as unpriced. |
| Asked about a run you did not observe | Give the method and the exact command, not a figure. |
| Only completion notifications available | Those are transient. Point at the transcripts instead. |

"I can measure this, here is the command" beats a confident wrong number. The one thing never to do
is interpolate a plausible figure — a fabricated number is indistinguishable from a real one until
someone audits it, and by then it has been quoted elsewhere.

## Wall-clock

Parallel dispatch collapses N agents to roughly `max(duration)` instead of `sum(duration)` — but
only for the waves that were genuinely concurrent. A "wave" of one dispatch is sequential work with
extra overhead. Count real fan-out waves before crediting parallelism.

## Writing it into a document

Any figure that will outlive the conversation needs, alongside it: how it was computed, the date,
whether it is a measurement or a counterfactual, and what would falsify it. If you cannot supply
those four, the number is not ready to publish.
