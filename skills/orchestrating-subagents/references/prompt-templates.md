# Dispatch prompt templates

Load when writing the `prompt` field for a delegated agent.

**These templates are meant to be edited.** When you have to add something to one to make a dispatch
work — a constraint the agent kept violating, a path it kept mangling, an output rule it kept
ignoring — put that addition back into the template here and add a line to the changelog at the
bottom. A template that never changes is one nobody is really using.

The tier in each heading is the floor the template is written for. A template that closes the spec
tightly is what lets the floor be low.

---

## Extract to a fixed schema — `haiku` / `low`

```
Read the files listed and produce JSON matching the schema below.
Output ONLY valid JSON — no prose, no markdown fences, no preamble.

Files (verbatim absolute paths):
<FILE_LIST>

Schema (match exactly):
<SCHEMA PASTED IN FULL — never "the schema I mentioned">

Rules:
- <field> must be <constraint>
- Copy each source path character-for-character from the list above.
- <the 2-3 constraints that actually matter>

Read each file once, in ranges if large. Do not re-read.
Write the result with the Write tool to this exact absolute path:
<OUTPUT_PATH>

Final message: "N records written" and nothing else.
```

Why it holds at `haiku`: nothing is left to interpretation — schema inline, paths verbatim, output
location fixed, response format constrained.

## Locate in a codebase — `sonnet` / `medium`

```
Search breadth: <medium | thorough>. Read-only.

Goal: <the single question to answer>.

Look for: <symbols, filename patterns, config keys>.
Start at: <paths or globs>, then widen if empty.

Report, per finding: file path with line number, a ≤10-line excerpt, and one line
on why it is relevant. No whole files.

If you find nothing, say so explicitly and list where you looked — a negative
result only counts if the search is stated.

Answer this directly at the end: <the yes/no or which-one question>.
```

The last two paragraphs exist because an unstated negative is indistinguishable from a failed search.

## Review a change — `sonnet` / `high`

```
Review <diff | files> for <dimension: correctness | security | performance>.

For each finding: file:line, one sentence on the defect, and a concrete failure
scenario (inputs or state → wrong output). A finding without a failure scenario
is not a finding — drop it.

Rank by severity, worst first. If nothing survives that bar, return an empty list;
do not pad.

Do not fix anything. Do not comment on style or formatting.
```

## Adversarially verify one claim — `opus` / `high`

```
Try to REFUTE this claim: <claim, stated in full>.

Evidence available: <paths, commands allowed>.

Default to refuted=true when uncertain. A claim survives only if you found
positive evidence for it, not merely the absence of evidence against it.

Return: {refuted: bool, reason: string, evidence: string}
```

Run several of these per claim and take the majority. Give each verifier a **different lens**
(correctness, security, does-it-reproduce) rather than the same prompt N times — redundancy catches
less than diversity does.

## Classify or label in bulk — `haiku` / `low`

```
Read <INPUT_PATH>. It contains <N> items; each has <fields>.

For each item write a <length> <language> name/label describing what it IS,
judged from <which fields>. <Ignore any pre-existing label — it is untrusted.>

Constraints:
- Must be <positive shape rule: prose with a space, sentence case, …>
- Must be unique across your file.
- <one worked example of a good output and one of a bad one>

Write JSON {<id>: "<label>"} covering EVERY item — do not skip any — to:
<OUTPUT_PATH>

Final message: the count only.
```

"Covering EVERY item" plus a count-only response is what makes silent truncation visible.

---

## Changelog

- 2026-08-18 — created. Extract/locate/review/verify/classify, drawn from the roles actually
  dispatched during the graphify rebuild.
