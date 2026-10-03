# orchestration-reminder.ps1 — one line of context at the start of a session.
#
# The PowerShell half of orchestration-reminder.sh. The README calls the hook
# scripts matched pairs; they have drifted before, which is why
# scripts/check-hook-behavior.mjs runs both. Keep the printed text identical:
# the test compares the two outputs against each other, not just against a
# pattern.
#
# Why this exists, and why printing here does NOT break the invariant that
# subagent-dispatch-log declares: see the header of orchestration-reminder.sh.
# Short version: that invariant is about PreToolUse, where stdout is tool
# feedback and a non-zero exit denies the call at the user's expense. This is
# SessionStart, where stdout is the documented channel for adding context and
# there is no call to deny.

$ErrorActionPreference = 'SilentlyContinue'

# SYMPHONY_NO_REMINDER=1 turns it off without editing the plugin.
if ($env:SYMPHONY_NO_REMINDER) { exit 0 }

try {
    # ASCII only, single-quoted: identical bytes to the sh half. See the note there.
    Write-Output 'Symphony: before dispatching any subagent, load symphony:orchestrating-subagents. Give every subagent prompt an explicit stop condition ("report the first blocker and stop"), not an open-ended survey.'
}
catch {
    # A broken reminder must never be the user's problem.
}

exit 0
