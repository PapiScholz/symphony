// scripts/lib/repo.mjs — tiny shared helpers for the check-*.mjs scripts.
// Zero dependencies, Node >= 18.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/lib/ -> scripts/ -> repo root
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Directories that are never part of "the repo" for these checks: VCS
// internals and the (gitignored, machine-local) graphify cache/output.
const SKIP_DIR_NAMES = new Set([".git", "node_modules", "graphify-out"]);

// Recursively walks the repo (or a subdirectory of it), yielding absolute
// file paths. Skips SKIP_DIR_NAMES anywhere in the tree.
export function walkFiles(startDir) {
  const out = [];
  const stack = [startDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

export function relRoot(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join("/");
}

// Small result collector shared by every check script: accumulate failures,
// print them all at the end (not just the first), exit 1 if any exist.
export class Reporter {
  constructor(checkName) {
    this.checkName = checkName;
    this.failures = [];
    this.passNotes = [];
  }
  fail(message) {
    this.failures.push(message);
  }
  note(message) {
    this.passNotes.push(message);
  }
  finish() {
    if (this.failures.length > 0) {
      process.stderr.write(`\n[${this.checkName}] FAILED (${this.failures.length} issue${this.failures.length === 1 ? "" : "s"}):\n`);
      for (const f of this.failures) {
        process.stderr.write(`  - ${f}\n`);
      }
      process.exit(1);
    } else {
      process.stdout.write(`[${this.checkName}] OK${this.passNotes.length ? " — " + this.passNotes.join("; ") : ""}\n`);
    }
  }
}
