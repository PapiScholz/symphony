#!/usr/bin/env node
// check-node-syntax.mjs — `node --check` on every .mjs file in the repo
// (tools/cost-report.mjs plus anything else that shows up, including these
// check scripts themselves — a syntax error in scripts/ should fail CI too).

import { spawnSync } from "node:child_process";
import { walkFiles, relRoot, Reporter, REPO_ROOT } from "./lib/repo.mjs";

function main() {
  const reporter = new Reporter("node-syntax");
  const files = walkFiles(REPO_ROOT).filter((f) => f.endsWith(".mjs"));

  if (files.length === 0) {
    reporter.fail("no .mjs files found in the repo — expected at least tools/cost-report.mjs");
  }

  for (const file of files) {
    const rel = relRoot(file);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.error) {
      reporter.fail(`${rel}: could not run 'node --check' — ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      reporter.fail(`${rel}: node --check failed (exit ${result.status})\n    ${stderr.split("\n").join("\n    ")}`);
    }
  }

  reporter.note(`checked ${files.length} .mjs file(s): ${files.map(relRoot).join(", ")}`);
  reporter.finish();
}

main();
