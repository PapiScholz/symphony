#!/usr/bin/env node
// check-hook-behavior.mjs — behavioral test of hooks/subagent-dispatch-log.sh.
//
// The hook's whole reason for existing safely inside a PreToolUse hook is one
// invariant: it NEVER blocks (non-zero exit forces the model to retry the
// tool call, and the user pays for that retry in tokens) and NEVER writes to
// stdout (PreToolUse stdout is treated as hook output/feedback). This script
// feeds it four payloads over stdin and checks that invariant holds for all
// four, then checks what actually landed in the JSONL log for the two valid
// payloads.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const HOOK_PATH = path.join(REPO_ROOT, "hooks", "subagent-dispatch-log.sh");

function tmpLogPath(label) {
  return path.join(os.tmpdir(), `symphony-hook-test-${label}-${process.pid}-${Date.now()}.jsonl`);
}

function runHook(stdinText, logPath) {
  return spawnSync("sh", [HOOK_PATH], {
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

function main() {
  const reporter = new Reporter("hook-behavior");

  if (!fs.existsSync(HOOK_PATH)) {
    reporter.fail(`${relRoot(HOOK_PATH)}: file does not exist`);
    reporter.finish();
    return;
  }

  const producedLogs = {};

  for (const c of CASES) {
    const logPath = tmpLogPath(c.label);
    const result = runHook(c.stdin, logPath);
    producedLogs[c.label] = logPath;

    if (result.error) {
      reporter.fail(`[${c.label}] could not invoke 'sh ${relRoot(HOOK_PATH)}': ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      reporter.fail(
        `[${c.label}] exit code was ${result.status}, expected 0 (a non-zero exit here blocks the tool call and forces a paid retry). stderr: ${(result.stderr || "(empty)").trim()}`
      );
    }
    if (result.stdout !== "") {
      reporter.fail(
        `[${c.label}] stdout was not empty (${JSON.stringify(result.stdout)}), expected ''. PreToolUse stdout is surfaced back to the model — this hook must be silent.`
      );
    }
  }

  // empty-input must produce no log file / no lines at all — the script
  // returns before ever reaching the write, per its own early-exit on blank
  // stdin.
  {
    const lines = readLogLines(producedLogs["empty-input"]);
    if (lines.length !== 0) {
      reporter.fail(`[empty-input] expected no lines written to SYMPHONY_LOG, found ${lines.length}`);
    }
  }

  // valid-with-model: expect exactly one JSON line, model == "opus".
  {
    const lines = readLogLines(producedLogs["valid-with-model"]);
    if (lines.length === 0) {
      reporter.fail("[valid-with-model] expected at least one line written to SYMPHONY_LOG, found none");
    }
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        reporter.fail(`[valid-with-model] log line is not valid JSON: ${err.message} — line: ${line}`);
        continue;
      }
      if (parsed.model !== "opus") {
        reporter.fail(`[valid-with-model] expected model "opus" in the log line, got ${JSON.stringify(parsed.model)}`);
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
      reporter.fail("[valid-without-model] expected at least one line written to SYMPHONY_LOG, found none");
    }
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        reporter.fail(`[valid-without-model] log line is not valid JSON: ${err.message} — line: ${line}`);
        continue;
      }
      if (parsed.model !== "INHERITED") {
        reporter.fail(`[valid-without-model] expected model "INHERITED" in the log line, got ${JSON.stringify(parsed.model)}`);
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
        reporter.fail(`[malformed-json] log line is not valid JSON: ${err.message} — line: ${line}`);
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

  reporter.note(`ran ${CASES.length} stdin case(s) against ${relRoot(HOOK_PATH)}`);
  reporter.finish();
}

main();
