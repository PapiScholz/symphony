#!/usr/bin/env node
// check-hook-syntax.mjs — three checks on hooks/subagent-dispatch-log.sh:
//   1. `sh -n` (POSIX shell syntax check, no execution)
//   2. no CRLF line endings
//   3. no BOM (UTF-8 or UTF-16) at the start of the file
//
// Both CRLF and a BOM were real bugs in this repo's history: a BOM landed in
// the JSONL log's first line and broke every downstream JSON.parse.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const HOOK_PATH = path.join(REPO_ROOT, "hooks", "subagent-dispatch-log.sh");

function main() {
  const reporter = new Reporter("hook-syntax");
  const rel = relRoot(HOOK_PATH);

  if (!fs.existsSync(HOOK_PATH)) {
    reporter.fail(`${rel}: file does not exist`);
    reporter.finish();
    return;
  }

  // 1. sh -n
  const result = spawnSync("sh", ["-n", HOOK_PATH], { encoding: "utf8" });
  if (result.error) {
    reporter.fail(`could not invoke 'sh' to check ${rel}: ${result.error.message} (need a POSIX sh on PATH — dash on ubuntu-latest, Git Bash's sh.exe on Windows)`);
  } else if (result.status !== 0) {
    reporter.fail(`${rel}: 'sh -n' reported a syntax error (exit ${result.status}):\n    ${(result.stderr || "").trim().split("\n").join("\n    ")}`);
  }

  // 2 & 3. raw bytes: CRLF and BOM
  const buf = fs.readFileSync(HOOK_PATH);

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

  reporter.finish();
}

main();
