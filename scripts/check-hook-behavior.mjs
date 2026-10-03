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

// The sh hook has TWO parsers: jq when it is on PATH, and a hand-written awk
// fallback when it is not. Only one of them runs on any given machine, and until
// this existed the check reported "ran 4 cases against ...sh" either way — which
// overstates what was covered. Found by breaking the jq branch on a machine
// without jq and watching the suite stay green.
//
// hideJq forces the fallback by putting a fake `jq` that always fails first on
// PATH. The hook treats "jq ran and produced nothing" exactly like "no jq" and
// drops to awk, so this exercises the real fallback path. It does NOT strip the
// PATH directories that hold jq: on ubuntu-latest jq lives in /usr/bin next to
// sh itself, and stripping it took sh with it (spawnSync sh ENOENT) — invisible
// on a machine whose jq sits in its own directory. With jq absent to begin with,
// both passes exercise awk and the reporter says the jq branch went unchecked.
function jqOnPath() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["jq"], { encoding: "utf8" });
  return !probe.error && probe.status === 0 && (probe.stdout || "").trim() !== "";
}

let failingJqDir = null;
function pathWithFailingJq() {
  if (failingJqDir === null) {
    failingJqDir = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-nojq-"));
    const shim = path.join(failingJqDir, "jq");
    fs.writeFileSync(shim, "#!/bin/sh\nexit 1\n");
    fs.chmodSync(shim, 0o755);
  }
  const sep = process.platform === "win32" ? ";" : ":";
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  return { key, value: failingJqDir + sep + (process.env[key] || "") };
}

function runHook(interp, stdinText, logPath, { hideJq = false } = {}) {
  const env = { ...process.env, SYMPHONY_LOG: logPath };
  if (hideJq) {
    const { key, value } = pathWithFailingJq();
    env[key] = value;
  }
  return spawnSync(interp.command, interp.args(interp.hookPath), {
    input: stdinText,
    encoding: "utf8",
    env,
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
        // Carries a stop marker, so stopHint must be true. The PAIR matters more
        // than either case alone: a stopHint hardcoded to false passes a
        // false-only test and then reports "no dispatch was ever bounded" — which
        // reads exactly like a real finding. Zero matches and nothing-to-match are
        // indistinguishable unless something is asserted to match.
        prompt: "Audit the diff. Report the first blocker and stop.",
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
        // No stop marker: the open-ended mandate this field exists to surface.
        prompt: "Look around the codebase and tell me everything you find.",
      },
    }),
  },
  {
    // Everything the ASCII fixtures above cannot catch, in one payload. Each piece
    // broke a half of the hook before this case existed:
    //   - a newline in the description made the awk fallback write a raw newline
    //     into the JSONL, splitting one row into two invalid ones;
    //   - non-ASCII reached the .ps1 through the console code page and was logged
    //     garbled ("é" became two other characters);
    //   - the prompt length was counted in three different units, so the accent
    //     and the emoji gave a different number per interpreter.
    label: "valid-unicode",
    stdin: JSON.stringify({
      session_id: "test-session-3",
      tool_name: "Agent",
      tool_input: {
        model: "haiku",
        description: 'revisá "esto"\nline two \\ end',
        prompt: "Leé C:\\repo\\file y no sigas \u{1F600} after that",
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

function fixtureInput(label) {
  return JSON.parse(CASES.find((c) => c.label === label).stdin).tool_input;
}

// promptBytes is the DECODED prompt's length in UTF-8 bytes — the one unit jq,
// awk and PowerShell can all compute identically. Asserting the exact number,
// on a fixture with escapes and non-ASCII, is what keeps the three honest.
function assertPromptBytes(reporter, tag, label, parsed, expectedPrompt) {
  const expected = Buffer.byteLength(expectedPrompt, "utf8");
  if (parsed.promptBytes !== expected) {
    reporter.fail(
      `${tag} [${label}] expected promptBytes ${expected} (the decoded prompt in UTF-8 bytes), got ${JSON.stringify(parsed.promptBytes)}`
    );
  }
}

// Exactly one line per valid payload, and it parses. More than one line is how
// an unescaped newline shows up: one row split into two broken ones.
function readOneRow(reporter, tag, label, logPath) {
  const lines = readLogLines(logPath);
  if (lines.length !== 1) {
    reporter.fail(`${tag} [${label}] expected exactly 1 line in SYMPHONY_LOG, found ${lines.length}${lines.length === 0 ? " (if this half ignores SYMPHONY_LOG it just wrote to the real log instead)" : ""}`);
    if (lines.length === 0) return null;
  }
  try {
    return JSON.parse(lines[0]);
  } catch (err) {
    reporter.fail(`${tag} [${label}] log line is not valid JSON: ${err.message} — line: ${lines[0]}`);
    return null;
  }
}

// Returns true if the interpreter ran, false if it was absent (already reported).
function checkOneHook(interp, reporter, { hideJq = false, pass = "" } = {}) {
  const rel = relRoot(interp.hookPath);
  const tag = pass ? `${interp.name}/${pass}:` : `${interp.name}:`;

  if (!fs.existsSync(interp.hookPath)) {
    reporter.fail(`${rel}: file does not exist`);
    return false;
  }

  const producedLogs = {};
  let interpreterMissing = null;

  for (const c of CASES) {
    const logPath = tmpLogPath(`${interp.name}${pass ? `-${pass}` : ""}-${c.label}`);
    const result = runHook(interp, c.stdin, logPath, { hideJq });
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
    const parsed = readOneRow(reporter, tag, "valid-with-model", producedLogs["valid-with-model"]);
    if (parsed) {
      if (parsed.model !== "opus") {
        reporter.fail(`${tag} [valid-with-model] expected model "opus" in the log line, got ${JSON.stringify(parsed.model)}`);
      }
      // stopHint is a heuristic, but it is a heuristic with a definite answer on
      // this fixture: the prompt says "Report the first blocker and stop".
      if (parsed.stopHint !== true) {
        reporter.fail(`${tag} [valid-with-model] expected stopHint true (the prompt carries a stop marker), got ${JSON.stringify(parsed.stopHint)}`);
      }
      assertPromptBytes(reporter, tag, "valid-with-model", parsed, fixtureInput("valid-with-model").prompt);
    }
  }

  // valid-without-model: expect exactly one JSON line, model == "INHERITED".
  // This is the invariant the whole hook exists to make visible: an omitted
  // `model` means "inherit the orchestrator's", and that omission is
  // otherwise invisible in the transcript.
  {
    const parsed = readOneRow(reporter, tag, "valid-without-model", producedLogs["valid-without-model"]);
    if (parsed) {
      if (parsed.model !== "INHERITED") {
        reporter.fail(`${tag} [valid-without-model] expected model "INHERITED" in the log line, got ${JSON.stringify(parsed.model)}`);
      }
      // The other half of the stopHint pair. Without this, a hook that always
      // answers true would pass just as happily as one that works.
      if (parsed.stopHint !== false) {
        reporter.fail(`${tag} [valid-without-model] expected stopHint false (the prompt has no stop marker), got ${JSON.stringify(parsed.stopHint)}`);
      }
      assertPromptBytes(reporter, tag, "valid-without-model", parsed, fixtureInput("valid-without-model").prompt);
    }
  }

  // valid-unicode: the description must round-trip byte for byte, the prompt
  // length must be the UTF-8 byte count, and a Spanish marker must still match.
  {
    const input = fixtureInput("valid-unicode");
    const parsed = readOneRow(reporter, tag, "valid-unicode", producedLogs["valid-unicode"]);
    if (parsed) {
      if (parsed.desc !== input.description) {
        reporter.fail(`${tag} [valid-unicode] description did not round-trip: expected ${JSON.stringify(input.description)}, got ${JSON.stringify(parsed.desc)}`);
      }
      if (parsed.stopHint !== true) {
        reporter.fail(`${tag} [valid-unicode] expected stopHint true (the prompt says "no sigas"), got ${JSON.stringify(parsed.stopHint)}`);
      }
      assertPromptBytes(reporter, tag, "valid-unicode", parsed, input.prompt);
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

// The reminder hook is a SessionStart hook, and its contract is the INVERSE of
// the dispatch hook's: it MUST write to stdout, because on SessionStart stdout is
// the documented channel for adding context. It still must never exit non-zero.
//
// Both halves are checked against each other rather than against a pattern. They
// are a matched pair that has drifted before, and here the drift would be
// invisible in the worst way: each half prints something plausible, and only the
// platform decides which advice a user gets.
const REMINDER_INTERPRETERS = INTERPRETERS.map((interp) => ({
  ...interp,
  hookPath: path.join(REPO_ROOT, "hooks", path.basename(interp.hookPath).replace("subagent-dispatch-log", "orchestration-reminder")),
}));

function checkReminderHook(reporter) {
  const outputs = new Map();

  for (const interp of REMINDER_INTERPRETERS) {
    const rel = relRoot(interp.hookPath);
    const tag = `${interp.name}:`;

    if (!fs.existsSync(interp.hookPath)) {
      reporter.fail(`${rel}: file does not exist`);
      continue;
    }

    const result = spawnSync(interp.command, interp.args(interp.hookPath), {
      input: "",
      encoding: "utf8",
      env: { ...process.env, SYMPHONY_NO_REMINDER: "" },
    });

    if (result.error) {
      const message = `${rel}: could not invoke '${interp.command}' (${result.error.message}) — this half went UNCHECKED`;
      if (interp.requiredEverywhere || process.env.CI) {
        reporter.fail(`${message}. In CI both halves must run.`);
      } else {
        reporter.note(`SKIPPED ${rel}: no ${interp.command} on PATH (checked in CI, not here)`);
      }
      continue;
    }

    if (result.status !== 0) {
      reporter.fail(`${tag} reminder exited ${result.status}, expected 0. stderr: ${(result.stderr || "(empty)").trim()}`);
    }

    const out = (result.stdout || "").trim();
    if (out === "") {
      reporter.fail(`${tag} reminder wrote nothing to stdout. On SessionStart stdout IS the context channel — a silent reminder is a reminder that does not exist.`);
      continue;
    }
    if (!out.includes("symphony:orchestrating-subagents")) {
      reporter.fail(`${tag} reminder does not name the skill to load, which is the only actionable part of it. Got: ${JSON.stringify(out)}`);
    }
    // Non-ASCII has bitten this repo's Windows half before; an em dash here would
    // arrive mangled under a non-UTF-8 code page and the two halves would differ.
    const nonAscii = [...out].filter((ch) => ch.codePointAt(0) > 127);
    if (nonAscii.length > 0) {
      reporter.fail(`${tag} reminder contains non-ASCII characters (${JSON.stringify(nonAscii.join(""))}); keep it ASCII so both halves emit identical bytes on any code page.`);
    }

    outputs.set(interp.name, out);

    // Opting out must actually opt out, or the escape hatch is decoration.
    const off = spawnSync(interp.command, interp.args(interp.hookPath), {
      input: "",
      encoding: "utf8",
      env: { ...process.env, SYMPHONY_NO_REMINDER: "1" },
    });
    if (!off.error && (off.stdout || "").trim() !== "") {
      reporter.fail(`${tag} SYMPHONY_NO_REMINDER=1 did not silence the reminder; it still printed ${JSON.stringify(off.stdout)}`);
    }
  }

  if (outputs.size === 2) {
    const [a, b] = [...outputs.entries()];
    if (a[1] !== b[1]) {
      reporter.fail(
        `the two reminder halves print different text — ${a[0]}: ${JSON.stringify(a[1])} vs ${b[0]}: ${JSON.stringify(b[1])}`
      );
    }
  }

  return outputs.size;
}

function main() {
  const reporter = new Reporter("hook-behavior");

  const ran = [];
  const hasJq = jqOnPath();

  for (const interp of INTERPRETERS) {
    if (interp.name === "sh") {
      // Pass 1: ambient PATH. Pass 2: jq hidden, forcing the awk fallback.
      if (checkOneHook(interp, reporter, { pass: hasJq ? "jq" : "awk" })) {
        ran.push(relRoot(interp.hookPath));
      }
      checkOneHook(interp, reporter, { hideJq: true, pass: "awk-forced" });
      if (!hasJq) {
        // Missing coverage, said out loud. The jq filter is the branch that runs
        // on most machines and in CI; a green run here does not speak for it.
        const message = "sh: jq is not on PATH, so the jq branch of subagent-dispatch-log.sh went UNCHECKED (only the awk fallback ran)";
        if (process.env.CI) {
          reporter.fail(`${message}. CI must cover both parsers; install jq in the workflow rather than dropping the check.`);
        } else {
          reporter.note(`SKIPPED ${message} (checked in CI, not here)`);
        }
      }
      continue;
    }
    if (checkOneHook(interp, reporter)) ran.push(relRoot(interp.hookPath));
  }

  if (ran.length > 0) {
    reporter.note(`ran ${CASES.length} stdin case(s) against ${ran.join(" and ")}`);
  }

  if (failingJqDir !== null) {
    try {
      fs.rmSync(failingJqDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  const reminderHalves = checkReminderHook(reporter);
  if (reminderHalves > 0) {
    reporter.note(`checked the SessionStart reminder on ${reminderHalves} interpreter(s)`);
  }

  reporter.finish();
}

main();
