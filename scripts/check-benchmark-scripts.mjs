#!/usr/bin/env node
// check-benchmark-scripts.mjs — the benchmark harness is evidence, so CI treats it as code.
//
// Two things are checked:
//
//   1. SYNTAX — every benchmark/scenarios/*.sh parses under `bash -n`, has no CRLF and no
//      BOM. These are bash scripts, not POSIX sh (they use `read -r -d ''`), so bash is the
//      right parser. A benchmark script that does not parse would ship green otherwise:
//      nothing else in CI reads this directory.
//
//   2. BEHAVIOR — run-baselines-round3.sh must ABORT when its clean-room conditions are
//      violated, rather than running the baselines anyway. This is the property that makes
//      round 3's results trustworthy, and round 2's harness did not have it: it asserted a
//      clean room in prose while running inside this repo. Asserting a guard exists is not
//      the same as watching it fire, so this check fires it.
//
//      Two violations are injected, one per guard:
//        - a run directory with a project CLAUDE.md in its ancestor chain
//        - a run directory with a symphony checkout reachable above it
//      Each must exit non-zero and say ABORT. The guards run before any `claude` call, so
//      this costs nothing and needs no model access.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const SCENARIO_DIR = path.join(REPO_ROOT, "benchmark", "scenarios");
const ROUND3 = path.join(SCENARIO_DIR, "run-baselines-round3.sh");

function checkSyntax(reporter) {
  if (!fs.existsSync(SCENARIO_DIR)) {
    reporter.fail(`${relRoot(SCENARIO_DIR)}: directory does not exist`);
    return 0;
  }
  const scripts = fs
    .readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".sh"))
    .map((f) => path.join(SCENARIO_DIR, f));

  if (scripts.length === 0) {
    reporter.fail(`${relRoot(SCENARIO_DIR)}: no .sh scripts found — the benchmark harness is missing`);
    return 0;
  }

  for (const file of scripts) {
    const rel = relRoot(file);
    const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
    if (result.error) {
      reporter.fail(`could not invoke 'bash' to check ${rel}: ${result.error.message}`);
    } else if (result.status !== 0) {
      reporter.fail(
        `${rel}: 'bash -n' reported a syntax error (exit ${result.status}):\n    ${(result.stderr || "").trim().split("\n").join("\n    ")}`
      );
    }

    const buf = fs.readFileSync(file);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      reporter.fail(`${rel}: starts with a UTF-8 BOM`);
    }
    let crlf = 0;
    for (let i = 0; i < buf.length - 1; i++) if (buf[i] === 0x0d && buf[i + 1] === 0x0a) crlf++;
    if (crlf > 0) {
      reporter.fail(`${rel}: contains ${crlf} CRLF line ending(s) — must be LF-only`);
    }
  }
  return scripts.length;
}

// Runs round 3 with RUN_DIR pointed somewhere that violates a guard. Returns true if it
// aborted the way it is supposed to.
function expectAbort(reporter, label, runDir, outDir) {
  // CHECK_ONLY makes the script stop right after the guards, before any model call. Without
  // it, a BROKEN guard means this check launches a full baseline round -- twenty minutes and
  // real quota -- which is exactly what happened the first time this check was tested. The
  // timeout is the second line of defence, in case CHECK_ONLY is ever removed from the script.
  const result = spawnSync("bash", [ROUND3], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, RUN_DIR: runDir, OUT: outDir, CHECK_ONLY: "1" },
  });
  if (result.error) {
    reporter.fail(`could not invoke 'bash' for the ${label} guard: ${result.error.message}`);
    return false;
  }
  if (result.signal) {
    reporter.fail(
      `${relRoot(ROUND3)}: the ${label} guard did not fire and the script had to be killed (${result.signal}) — ` +
        `it kept going past the guards with a violated clean room.`
    );
    return false;
  }
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status === 0) {
    reporter.fail(
      `${relRoot(ROUND3)}: the ${label} guard did NOT fire — the script exited 0 with a violated clean room. ` +
        `It would have run the baselines in a contaminated directory.`
    );
    return false;
  }
  if (!combined.includes("ABORT")) {
    reporter.fail(
      `${relRoot(ROUND3)}: the ${label} guard exited ${result.status} but printed no ABORT message; got:\n    ${combined.trim().split("\n").join("\n    ")}`
    );
    return false;
  }
  return true;
}

function checkGuards(reporter) {
  if (!fs.existsSync(ROUND3)) {
    reporter.fail(`${relRoot(ROUND3)}: file does not exist`);
    return 0;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-guardcheck-"));
  let fired = 0;
  try {
    // Guard: a project CLAUDE.md in the ancestor chain.
    const claudeRoot = path.join(tmp, "with-claude-md");
    fs.mkdirSync(path.join(claudeRoot, "nested"), { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, "CLAUDE.md"), "# injected by check-benchmark-scripts\n");
    if (expectAbort(reporter, "project CLAUDE.md", path.join(claudeRoot, "nested", "run"), path.join(tmp, "out"))) {
      fired++;
    }

    // Guard: a reachable symphony checkout. The repo itself is one.
    if (expectAbort(reporter, "reachable symphony checkout", path.join(REPO_ROOT, ".guardcheck-probe"), path.join(tmp, "out"))) {
      fired++;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(path.join(REPO_ROOT, ".guardcheck-probe"), { recursive: true, force: true });
  }
  return fired;
}

function main() {
  const reporter = new Reporter("benchmark-scripts");
  const scriptCount = checkSyntax(reporter);
  const guardCount = checkGuards(reporter);
  reporter.note(`checked ${scriptCount} scenario script(s); ${guardCount}/2 clean-room guard(s) fired as required`);
  reporter.finish();
}

main();
