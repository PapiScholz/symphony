#!/usr/bin/env node
// check-hook-behavior.mjs — behavioral test of BOTH halves of the dispatch hook:
// hooks/subagent-dispatch-log.sh and hooks/subagent-dispatch-log.ps1.
//
// The hook's whole reason for existing safely inside a PreToolUse hook is one
// invariant: it NEVER blocks (non-zero exit forces the model to retry the
// tool call, and the user pays for that retry in tokens) and NEVER writes to
// stdout (PreToolUse stdout is treated as hook output/feedback). This script
// feeds each implementation four payloads over stdin and checks that invariant
// holds for all four, then checks what actually landed in the JSONL log for the
// two valid payloads.
//
// The README calls the two scripts a matched pair. Until this file ran both,
// that was a claim: they had already drifted — the shell hook honoured
// SYMPHONY_LOG and the PowerShell one wrote to a fixed path, which is also what
// made it untestable without touching the runner's own log. The cases and the
// assertions below are shell-agnostic on purpose; only INTERPRETERS changes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const INTERPRETERS = [
  {
    name: "sh",
    hookPath: path.join(REPO_ROOT, "hooks", "subagent-dispatch-log.sh"),
    command: "sh",
    args: (hookPath) => [hookPath],
    // A POSIX sh is present everywhere this repo is developed or built: dash on
    // ubuntu-latest, Git Bash's sh.exe on Windows. Its absence is a hard failure.
    requiredEverywhere: true,
  },
  {
    name: "pwsh",
    hookPath: path.join(REPO_ROOT, "hooks", "subagent-dispatch-log.ps1"),
    command: "pwsh",
    args: (hookPath) => ["-NoProfile", "-NonInteractive", "-File", hookPath],
    // PowerShell ships with ubuntu-latest but a contributor on Linux may not
    // have it. Skipping locally is fine; skipping in CI is not — see below.
    requiredEverywhere: false,
  },
];

function tmpLogPath(label) {
  return path.join(os.tmpdir(), `symphony-hook-test-${label}-${process.pid}-${Date.now()}.jsonl`);
}

function runHook(interp, stdinText, logPath) {
  return spawnSync(interp.command, interp.args(interp.hookPath), {
    input: stdinText,
    encoding: "utf8",
    env: { ...process.env, SYMPHONY_LOG: logPath },
  });
}

function readLogLines(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const raw = fs.readFileSync(logPath, "utf8");
  return raw.split(/\r?\n/).filter((l) => l.trim() !== "");
}

const CASES = [
  {
    label: "valid-with-model",
    stdin: JSON.stringify({
      session_id: "test-session-1",
      tool_name: "Task",
      tool_input: {
        subagent_type: "general-purpose",
        model: "opus",
        effort: "high",
        description: "ci behavior test with model",
      },
    }),
  },
  {
    label: "valid-without-model",
    stdin: JSON.stringify({
      session_id: "test-session-2",
      tool_name: "Task",
      tool_input: {
        subagent_type: "Explore",
        description: "ci behavior test without model",
      },
    }),
  },
  {
    label: "malformed-json",
    stdin: '{this is not valid json, "session_id":',
  },
  {
    label: "empty-input",
    stdin: "",
  },
];

// Returns true if the interpreter ran, false if it was absent (already reported).
function checkOneHook(interp, reporter) {
  const rel = relRoot(interp.hookPath);
  const tag = `${interp.name}:`;

  if (!fs.existsSync(interp.hookPath)) {
    reporter.fail(`${rel}: file does not exist`);
    return false;
  }

  const producedLogs = {};
  let interpreterMissing = null;

  for (const c of CASES) {
    const logPath = tmpLogPath(`${interp.name}-${c.label}`);
    const result = runHook(interp, c.stdin, logPath);
    producedLogs[c.label] = logPath;

    if (result.error) {
      interpreterMissing = result.error.message;
      break;
    }
    if (result.status !== 0) {
      reporter.fail(
        `${tag} [${c.label}] exit code was ${result.status}, expected 0 (a non-zero exit here blocks the tool call and forces a paid retry). stderr: ${(result.stderr || "(empty)").trim()}`
      );
    }
    if (result.stdout !== "") {
      reporter.fail(
        `${tag} [${c.label}] stdout was not empty (${JSON.stringify(result.stdout)}), expected ''. PreToolUse stdout is surfaced back to the model — this hook must be silent.`
      );
    }
  }

  if (interpreterMissing !== null) {
    // A missing interpreter is missing coverage, not a pass.
    const message = `${rel}: could not invoke '${interp.command}' (${interpreterMissing}) — this half of the hook went UNCHECKED`;
    if (interp.requiredEverywhere || process.env.CI) {
      reporter.fail(`${message}. In CI both halves must run; add a setup step for the interpreter rather than dropping the check.`);
    } else {
      reporter.note(`SKIPPED ${rel}: no ${interp.command} on PATH (checked in CI, not here)`);
    }
    for (const logPath of Object.values(producedLogs)) {
      try {
        fs.rmSync(logPath, { force: true });
      } catch {
        // ignore
      }
    }
    return false;
  }

  // empty-input must produce no log file / no lines at all — the script
  // returns before ever reaching the write, per its own early-exit on blank
  // stdin.
  {
    const lines = readLogLines(producedLogs["empty-input"]);
    if (lines.length !== 0) {
      reporter.fail(`${tag} [empty-input] expected no lines written to SYMPHONY_LOG, found ${lines.length}`);
    }
  }

  // valid-with-model: expect exactly one JSON line, model == "opus".
  {
    const lines = readLogLines(producedLogs["valid-with-model"]);
    if (lines.length === 0) {
      reporter.fail(`${tag} [valid-with-model] expected at least one line written to SYMPHONY_LOG, found none (if this half ignores SYMPHONY_LOG it just wrote to the real log instead)`);
    }
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        reporter.fail(`${tag} [valid-with-model] log line is not valid JSON: ${err.message} — line: ${line}`);
        continue;
      }
      if (parsed.model !== "opus") {
        reporter.fail(`${tag} [valid-with-model] expected model "opus" in the log line, got ${JSON.stringify(parsed.model)}`);
      }
    }
  }

  // valid-without-model: expect exactly one JSON line, model == "INHERITED".
  // This is the invariant the whole hook exists to make visible: an omitted
  // `model` means "inherit the orchestrator's", and that omission is
  // otherwise invisible in the transcript.
  {
    const lines = readLogLines(producedLogs["valid-without-model"]);
    if (lines.length === 0) {
      reporter.fail(`${tag} [valid-without-model] expected at least one line written to SYMPHONY_LOG, found none`);
    }
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        reporter.fail(`${tag} [valid-without-model] log line is not valid JSON: ${err.message} — line: ${line}`);
        continue;
      }
      if (parsed.model !== "INHERITED") {
        reporter.fail(`${tag} [valid-without-model] expected model "INHERITED" in the log line, got ${JSON.stringify(parsed.model)}`);
      }
    }
  }

  // malformed-json: whatever (if anything) landed in the log must still
  // parse as JSON — the hook must never emit a broken line, even on garbage
  // input.
  {
    const lines = readLogLines(producedLogs["malformed-json"]);
    for (const line of lines) {
      try {
        JSON.parse(line);
      } catch (err) {
        reporter.fail(`${tag} [malformed-json] log line is not valid JSON: ${err.message} — line: ${line}`);
      }
    }
  }

  // Cleanup temp log files (best-effort).
  for (const logPath of Object.values(producedLogs)) {
    try {
      fs.rmSync(logPath, { force: true });
    } catch {
      // ignore
    }
  }

  return true;
}

function main() {
  const reporter = new Reporter("hook-behavior");

  const ran = [];
  for (const interp of INTERPRETERS) {
    if (checkOneHook(interp, reporter)) ran.push(relRoot(interp.hookPath));
  }

  if (ran.length > 0) {
    reporter.note(`ran ${CASES.length} stdin case(s) against ${ran.join(" and ")}`);
  }
  reporter.finish();
}

main();
