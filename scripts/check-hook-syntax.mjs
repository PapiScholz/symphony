#!/usr/bin/env node
// check-hook-syntax.mjs — syntax checks on both halves of the dispatch hook.
//
// hooks/subagent-dispatch-log.sh — three checks:
//   1. `sh -n` (POSIX shell syntax check, no execution)
//   2. no CRLF line endings
//   3. no BOM (UTF-8 or UTF-16) at the start of the file
//
// Both CRLF and a BOM were real bugs in this repo's history: a BOM landed in
// the JSONL log's first line and broke every downstream JSON.parse.
//
// hooks/subagent-dispatch-log.ps1 — syntax only, via PowerShell's own parser.
// The CRLF and BOM rules are deliberately NOT applied to it, and copying them
// across would be cargo cult: .gitattributes pins eol=lf for *.sh because `sh`
// executes those files, while PowerShell reads CRLF fine — and on Windows
// PowerShell 5.1 a UTF-8 BOM is what makes a file with accented characters
// decode correctly, so forbidding it would be actively wrong.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const SH_HOOK = path.join(REPO_ROOT, "hooks", "subagent-dispatch-log.sh");
const PS1_HOOK = path.join(REPO_ROOT, "hooks", "subagent-dispatch-log.ps1");

// Parses the file and prints one line per syntax error. Nothing is executed:
// ParseFile builds the AST and reports errors without running the script.
function psParseScript(targetPath) {
  const quoted = "'" + targetPath.split("'").join("''") + "'";
  return [
    "$errs = $null",
    `[void][System.Management.Automation.Language.Parser]::ParseFile(${quoted}, [ref]$null, [ref]$errs)`,
    "if ($errs -and $errs.Count -gt 0) {",
    '  $errs | ForEach-Object { Write-Output ("line {0}: {1}" -f $_.Extent.StartLineNumber, $_.Message) }',
    "  exit 1",
    "}",
    "exit 0",
  ].join("\n");
}

function checkShellHook(reporter) {
  const rel = relRoot(SH_HOOK);

  if (!fs.existsSync(SH_HOOK)) {
    reporter.fail(`${rel}: file does not exist`);
    return;
  }

  // 1. sh -n
  const result = spawnSync("sh", ["-n", SH_HOOK], { encoding: "utf8" });
  if (result.error) {
    reporter.fail(`could not invoke 'sh' to check ${rel}: ${result.error.message} (need a POSIX sh on PATH — dash on ubuntu-latest, Git Bash's sh.exe on Windows)`);
  } else if (result.status !== 0) {
    reporter.fail(`${rel}: 'sh -n' reported a syntax error (exit ${result.status}):\n    ${(result.stderr || "").trim().split("\n").join("\n    ")}`);
  }

  // 2 & 3. raw bytes: CRLF and BOM
  const buf = fs.readFileSync(SH_HOOK);

  const hasUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const hasUtf16leBom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  const hasUtf16beBom = buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff;
  if (hasUtf8Bom || hasUtf16leBom || hasUtf16beBom) {
    const kind = hasUtf8Bom ? "UTF-8" : hasUtf16leBom ? "UTF-16LE" : "UTF-16BE";
    reporter.fail(`${rel}: starts with a ${kind} BOM — a BOM in this file broke JSONL parsing downstream in this repo's history`);
  }

  let crlfCount = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) crlfCount++;
  }
  if (crlfCount > 0) {
    reporter.fail(`${rel}: contains ${crlfCount} CRLF line ending(s) — must be LF-only (this file is invoked as a POSIX shell script)`);
  }
}

function checkPowerShellHook(reporter) {
  const rel = relRoot(PS1_HOOK);

  if (!fs.existsSync(PS1_HOOK)) {
    reporter.fail(`${rel}: file does not exist`);
    return;
  }

  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", psParseScript(PS1_HOOK)], {
    encoding: "utf8",
  });

  if (result.error) {
    // A missing interpreter is missing coverage, not a pass. Locally that is
    // tolerable — a contributor on Linux may not have PowerShell — but in CI it
    // means this half of the hook went unchecked while the suite reported green,
    // which is the exact failure this check was added to end.
    const message = `${rel}: could not invoke 'pwsh' (${result.error.message}) — this half of the hook went UNCHECKED`;
    if (process.env.CI) {
      reporter.fail(`${message}. pwsh ships with ubuntu-latest; if that changed, add a PowerShell setup step to the workflow rather than dropping the check.`);
    } else {
      reporter.note(`SKIPPED ${rel}: no pwsh on PATH (checked in CI, not here)`);
    }
    return;
  }

  if (result.status !== 0) {
    const detail = (result.stdout || result.stderr || "").trim();
    reporter.fail(`${rel}: PowerShell reported ${detail ? "a syntax error" : `exit ${result.status}`}:\n    ${detail.split("\n").join("\n    ")}`);
  }
}

function main() {
  const reporter = new Reporter("hook-syntax");
  checkShellHook(reporter);
  checkPowerShellHook(reporter);
  reporter.finish();
}

main();
