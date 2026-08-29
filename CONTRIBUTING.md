# Contributing

## The bar for a new skill

Symphony uses the RED-GREEN method from `superpowers:writing-skills`. A skill is not accepted
because it reads well. It is accepted because there is a documented run where agents **without** it
failed, and a run where agents **with** it did not.

Concretely, a skill PR needs:

1. **A pressure scenario** — a realistic task that tempts the failure the skill prevents.
2. **A baseline (RED)** — that scenario run against at least 3 fresh agents that do not have the
   skill, with their behaviour recorded. If they pass, stop: the skill has nothing to teach. That
   result is still worth a PR — see `benchmark/red-baselines.md`, where two planned skills were
   cancelled exactly this way.
3. **A verification (GREEN)** — the same scenario, same rep count, with the skill loaded.
4. **The transcripts or a faithful summary**, so a reader can re-run and disagree.

Skills that arrive without a failing baseline will be asked for one before review.

## The bar for a claim

Any number in this repo must be reproducible from data a reader can obtain, or explicitly labelled
as unverifiable.

- Reproducible: token counts from Claude Code transcripts, computed by `tools/cost-report.mjs`.
- Explicitly labelled: the "three subagents were killed mid-run" incident, which is a first-hand
  report with no published artifact behind it, and says so in both README and METHODOLOGY.

Never cite an illustrative example from documentation as if it were captured data. An earlier draft
of the README did exactly that, and the fix is recorded in METHODOLOGY.

Do not add a claim about subscription quota draining faster or slower per model. It is undocumented
and unmeasured here. If you can measure it, that is a valuable PR — bring the method.

## Correcting the numbers

`tools/pricing.json` carries `_retrieved` and `_sources`. Prices change. If they have, update the
file and say where you got them; the report prints the date it used.

If `tools/transcript-schema.json` stops matching reality — likely, since it is reverse-engineered
from a format that drifts between Claude Code releases — a PR fixing it is welcome. Mark anything
you could not verify as unverified rather than guessing.

## Cutting a release

1. Bump the version in **both** manifests — `.claude-plugin/plugin.json` and
   `.claude-plugin/marketplace.json`. The release workflow refuses a tag that disagrees with either.
2. Add the `## <version> — <date>` section to `CHANGELOG.md`. The workflow extracts the release
   notes by matching that heading exactly, and fails if it finds nothing.
3. Run `npm test` locally. CI confirms a release; it should not be where you discover it is broken.
4. **Tag with `git tag -a`, never a bare `git tag`.** `git push --follow-tags` pushes annotated
   tags only, so a lightweight tag stays on your machine while the push reports success — the
   release workflow never fires and nothing says why. Every tag in this repo's history is
   annotated; `v0.3.0` was briefly not, and the mismatch was only visible in `git cat-file -t`.
5. Push the branch and the tag, then check the run: `gh run list --limit 3`. A release whose
   workflow failed still leaves the tag behind, and the tag is what people install.

## Style

English. No emoji. No hype. State what is known, what is assumed, and what is unknown, and keep the
three distinguishable.
