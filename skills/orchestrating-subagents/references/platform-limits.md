# Platform limits and costs

Load before a wide fan-out, when a dispatch fails to launch, or when considering agent teams.

## Hard ceilings

| Limit | Default | Override |
|---|---|---|
| Concurrent subagents per session | **20** | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` |
| Subagent nesting depth below the main conversation | **3** | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` |
| Concurrent agents inside one workflow | `min(16, CPUs − 2)` | — |
| Total agents per workflow run | **1000** | — |
| Items per single `parallel()` / `pipeline()` call | **4096** | — |

At the concurrency cap, a further spawn fails with `Concurrent subagent limit reached` and the error
tells you not to retry. Queue the rest instead of retrying.

Nesting matters when a delegated agent is itself allowed to delegate: with the default depth of 3
you get main → agent → agent → agent, and the fourth layer fails.

## How results come back

A subagent's result returns to the caller's context when it completes; a background one arrives as a
completion notification in a later turn. Either way the caller sees the output.

**Teammates do not work this way.** An idle notification reports that the teammate stopped, *without
its output* — the teammate has to message the lead or write to the shared task list for its work to
be visible.

## Agent teams

Disabled by default. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; without it no team is set
up, no team directories are written, and no teammates are spawned or proposed.

**Cost: roughly 7× a standard session** when teammates run in plan mode, because each teammate is a
separate Claude instance with its own context window. That multiplier is Anthropic's, not an
estimate made here — [the costs page](https://code.claude.com/docs/en/costs) states *"agent teams
use approximately 7x more tokens than standard sessions when teammates run in plan mode, because
each teammate maintains its own context window and runs as a separate Claude instance."*

Scaling is stated separately, not bundled with that number:
[agent-teams](https://code.claude.com/docs/en/agent-teams) says *"token costs scale linearly: each
teammate has its own context window and consumes tokens independently."* The same docs suggest
*"start with 3-5 teammates for most workflows"* and *"use Sonnet for teammates."*

**The trap worth knowing before enabling them:** with teams enabled, ordinary delegation changes —
a subagent that Claude names on its own *launches as a teammate*. So a flow written expecting
subagent-style result-return can stall, because a teammate only signals that it went idle. Teams can
form even when you did not ask for one. In non-interactive mode (`-p`, Agent SDK) this does not
happen: a named subagent runs as an ordinary subagent.

Also: teammates cannot spawn teammates, there is one team per session, the lead is fixed, and
teammates ignore a definition's `skills` / `mcpServers` frontmatter — they load those from project
and user settings like a normal session.

## Model allowlist

Org `availableModels` is checked against the env var, the per-invocation parameter, and frontmatter.

When a value is blocked, it **does not fail** — it substitutes:
- a family alias (`opus`) → newest version of that family the allowlist permits;
- anything else → the inherited model for a subagent, or the lead's model for a teammate.

Interactive sessions warn on a substituted subagent model. A teammate's fallback is **not** reported.
So on a restricted org, a dispatch can quietly run on a different model than you wrote.

## Costs worth remembering

- Delegating verbose work (test runs, log processing, doc fetching) keeps the volume in the
  subagent's context and returns only a summary — that is a context saving regardless of model tier.
- Many subagents each returning a detailed result will fill the orchestrator's context anyway.
  Ask for the conclusion, not the transcript.
- Running several sessions or subagents at once multiplies token usage against your plan's rate
  limits, not just your bill.
