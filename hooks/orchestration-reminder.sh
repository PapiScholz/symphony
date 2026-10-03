#!/bin/sh
# orchestration-reminder.sh — one line of context at the start of a session.
#
# Why this exists: the skills in this plugin only help when they are loaded, and
# the moment they are needed most is the moment they are easiest to skip. In the
# incident that prompted this hook, two subagents were dispatched with open-ended
# mandates and burned ~416k tokens between them; the orchestrating agent had all
# three skills installed and invoked none of them. Nothing in the session
# surfaced that until the bill did.
#
# That incident is a FIRST-HAND REPORT: no transcript of it is published in this
# repo, so treat it the way README and METHODOLOGY treat the "three subagents
# killed mid-run" report. Nor is there a RED/GREEN run showing that this line
# changes behaviour. It is cheap, and that is the whole case for it; the printed
# text below makes no claim about tokens for the same reason.
#
# WHY THIS DOES NOT BREAK THE INVARIANT OF subagent-dispatch-log.
# That hook documents, correctly, that it must never block and never write to
# stdout. Read quickly, this file looks like a violation: a symphony hook that
# prints. It is not, and the difference is the event:
#
#   PreToolUse  — stdout is fed back to the model as tool feedback, and a
#                 non-zero exit DENIES the call. A denial forces the model to
#                 retry, and the user pays for the retry. Hence: never.
#   SessionStart — stdout IS the documented channel for adding context, and
#                 there is no tool call to deny. Printing is the whole point.
#
# So: do not "fix" this by silencing it. If it ever needs to stop printing, the
# reason will be that the reminder stopped changing behaviour, not consistency
# with the other hook.
#
# The cost is one line, once per session. That is the budget it has to earn.
#
# Registered in hooks/hooks.json -> hooks.SessionStart.
#
# Same defensive shape as its sibling: no `set -e`, nothing that can escape,
# always `exit 0`. A broken reminder must never be the user's problem.

# SYMPHONY_NO_REMINDER=1 turns it off without editing the plugin, for anyone who
# has internalised this and does not want to pay for the line.
if [ -n "${SYMPHONY_NO_REMINDER}" ]; then
    exit 0
fi

# ASCII only, and single-quoted so the inner double quotes need no escaping. The
# rest of this repo's shell files avoid non-ASCII on purpose: the text has to
# survive Windows PowerShell 5.1 and a Git Bash on a non-UTF-8 code page
# byte-for-byte, because check-hook-behavior.mjs compares the two halves' output
# against each other.
printf '%s\n' 'Symphony: before dispatching any subagent, load symphony:orchestrating-subagents. Give every subagent prompt an explicit stop condition ("report the first blocker and stop"), not an open-ended survey.'

exit 0
