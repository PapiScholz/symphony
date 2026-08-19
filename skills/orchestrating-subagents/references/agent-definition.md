# Subagent definition reference

Load when writing or editing a `.claude/agents/*.md` file, or when you need a field that is not
`model` / `effort` / `tools`.

## Frontmatter fields

Only `name` and `description` are required.

| Field | Type | Notes |
|---|---|---|
| `name` | string | Lowercase + hyphens, unique. No `:` — that is reserved for plugin-scoped ids. Identity comes from this field only, never from the file path. |
| `description` | string | Tells the orchestrator when to delegate here. |
| `model` | string | `haiku` \| `sonnet` \| `opus` \| `fable` \| a full id \| `inherit`. **Omitted = `inherit`.** Prefer the family alias over a pinned id: a pinned id silently rots when the family moves on. |
| `effort` | string | `low` \| `medium` \| `high` \| `xhigh` \| `max`. Overrides session effort while this agent runs. Available levels depend on the model. |
| `tools` | list | Omitted = inherits every tool available to subagents. Can allow spawning specific agents: `Agent(worker, researcher)`. |
| `disallowedTools` | list | Removes from the inherited pool. Applied **before** `tools` resolves. MCP wildcards allowed (`mcp__server__*`). |
| `permissionMode` | string | `default` \| `acceptEdits` \| `auto` \| `dontAsk` \| `bypassPermissions` \| `plan`. Defaults to inheriting the parent's. |
| `maxTurns` | number | Hard stop on agentic turns. |
| `skills` | list | Skills preloaded into its context at startup. |
| `mcpServers` | list/object | MCP servers available to it. |
| `hooks` | object | Lifecycle hooks scoped to this agent. |
| `memory` | string | `user` \| `project` \| `local` — persistent cross-session memory. |
| `background` | boolean | Keep in background even when asked for foreground. |
| `isolation` | string | `worktree` → its own temporary git worktree. Costs setup time and disk; use only when parallel agents would edit the same files. |
| `color` | string | Display color. |
| `initialPrompt` | string | Auto-submitted first turn when run as a main session via `--agent`. |

If nothing in `tools` resolves to a real tool, the launch fails with an error naming the unresolved
entries — it does not silently fall back.

## Where definitions live

Highest priority first:

1. Managed settings (org-wide)
2. `--agents` CLI flag (session only)
3. `.claude/agents/` (project)
4. `~/.claude/agents/` (all projects)
5. Plugin `agents/` directory

Project definitions are discovered by walking up from the working directory, so every
`.claude/agents/` between it and the repo root is scanned; when two define the same `name`, the one
closest to the working directory wins. Both roots are scanned recursively — subfolders are fine and
do not affect identity.

## Model resolution order

`CLAUDE_CODE_SUBAGENT_MODEL` env var → per-invocation `model` parameter → frontmatter `model` →
main conversation's model.

The env var overrides *both* the invocation parameter and the frontmatter, so it is a blunt
instrument: it removes your ability to raise the tier for one dispatch. Leave it unset unless an
entire session is mechanical.

Effort resolves separately: `CLAUDE_CODE_EFFORT_LEVEL` → frontmatter `effort` → session level →
model default.

## What a subagent starts with

**Loads:** its own system prompt, the delegation prompt you wrote, the full CLAUDE.md hierarchy, a
git status snapshot, any preloaded `skills`, and the sibling roster for SendMessage.
(`Explore` and `Plan` skip CLAUDE.md and git status.)

**Does not load:** your conversation history, your output style, auto memory from the main
conversation, the parent session's skills, or the parent's context window size.

Practical consequence: the prompt is the only channel. Anything the agent needs that lives in your
conversation must be restated in it — paths verbatim, schema pasted in, success criterion spelled
out. This is also why a closed spec is what lets a cheap model succeed.

Extended thinking is the exception: as of v2.1.198 subagents inherit the session's thinking
configuration, and there is no per-subagent setting.
