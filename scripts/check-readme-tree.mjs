#!/usr/bin/env node
// check-readme-tree.mjs — keeps README's "What's in the repo" block honest.
//
// That block is a doc that ENUMERATES, which is the kind that rots silently:
// someone adds item N+1 and does not go back, and the list still reads as
// complete because it is consistent with itself. It has gone stale twice —
// tools/outcome-backfill.mjs shipped with no entry, and two of the three skills
// plus scripts/ and benchmark/ were missing outright.
//
// Three rules, checked against the filesystem:
//
//   R1  every path the block lists exists, and a trailing "/" means a directory
//   R2  if the block enumerates children of a directory, it enumerates ALL of
//       them — listing three of tools/'s four files is the failure that
//       prompted this check
//   R3  every top-level directory of actual content is covered by some entry,
//       either directly or through one of its children
//
// It cannot see prose. "the eight checks" inside a description is exactly the
// kind of hand-written count this cannot verify, which is why such counts do
// not belong in the block.

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const README = path.join(REPO_ROOT, "README.md");
const HEADING = "## What's in the repo";

// Top-level entries that are not expected in the tree, with the reason they are
// not. Anything outside this list must be documented — adding to it is a visible
// decision in a diff, not a default.
const ROOT_EXEMPT = new Set([
  "node_modules", // never committed
  "graphify-out", // gitignored, machine-local tool output
  "LICENSE", // self-explanatory
  "package.json", // the test runner's own manifest
  "package-lock.json",
  "skills.sh.json", // metadata for the skills.sh listing page
]);

// Root-level prose documents explain themselves; a new one should not force an
// edit to a block that is about where the *code* lives.
function isRootDoc(name) {
  return name.endsWith(".md");
}

// Dot-entries (.git, .github, .gitignore, .claude-plugin, ...) are tooling and
// VCS surface, not repo content in the sense this block documents.
function isDotEntry(name) {
  return name.startsWith(".");
}

// Returns the lines of the first fenced block after HEADING, or null.
function extractTreeLines(text) {
  const headingIdx = text.indexOf(HEADING);
  if (headingIdx === -1) return null;

  const after = text.slice(headingIdx + HEADING.length);
  const openIdx = after.indexOf("```");
  if (openIdx === -1) return null;

  const afterOpen = after.slice(openIdx + 3);
  const newlineIdx = afterOpen.indexOf("\n");
  if (newlineIdx === -1) return null;

  const body = afterOpen.slice(newlineIdx + 1);
  const closeIdx = body.indexOf("```");
  if (closeIdx === -1) return null;

  return body.slice(0, closeIdx).split("\n");
}

function main() {
  const reporter = new Reporter("readme-tree");

  if (!fs.existsSync(README)) {
    reporter.fail("README.md does not exist");
    reporter.finish();
    return;
  }

  const lines = extractTreeLines(fs.readFileSync(README, "utf8"));
  if (lines === null) {
    // Finding nothing and saying nothing would reproduce the bug this check
    // exists to catch, so a missing block is a failure, not a silent pass.
    reporter.fail(`README.md: could not find a fenced block under "${HEADING}" — if that section was renamed or removed, update HEADING in this script deliberately`);
    reporter.finish();
    return;
  }

  // First token of each non-empty line is the path; the rest is description.
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    entries.push(trimmed.split(/\s+/)[0]);
  }

  if (entries.length === 0) {
    reporter.fail(`README.md: the block under "${HEADING}" lists no paths`);
    reporter.finish();
    return;
  }

  // R1 — everything listed exists, and "/" means directory.
  const listed = new Set(); // normalized, no trailing slash
  for (const entry of entries) {
    const wantsDir = entry.endsWith("/");
    const norm = wantsDir ? entry.slice(0, -1) : entry;
    listed.add(norm);

    const abs = path.join(REPO_ROOT, norm);
    if (!fs.existsSync(abs)) {
      reporter.fail(`README.md tree lists "${entry}", which does not exist on disk`);
      continue;
    }
    const isDir = fs.statSync(abs).isDirectory();
    if (wantsDir && !isDir) {
      reporter.fail(`README.md tree lists "${entry}" with a trailing slash, but it is a file`);
    } else if (!wantsDir && isDir) {
      reporter.fail(`README.md tree lists "${entry}" as a file, but it is a directory (write it as "${entry}/")`);
    }
  }

  // R2 — a directory whose children are enumerated must have all of them listed.
  const childrenByParent = new Map();
  for (const norm of listed) {
    const parent = path.posix.dirname(norm.split(path.sep).join("/"));
    if (parent === ".") continue; // top level: handled by R3
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, new Set());
    childrenByParent.get(parent).add(path.posix.basename(norm));
  }

  for (const [parent, names] of childrenByParent) {
    const parentAbs = path.join(REPO_ROOT, parent);
    if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isDirectory()) continue;

    const onDisk = fs.readdirSync(parentAbs).filter((n) => !isDotEntry(n));
    const missing = onDisk.filter((n) => !names.has(n));
    if (missing.length > 0) {
      reporter.fail(
        `README.md tree enumerates ${names.size} entr${names.size === 1 ? "y" : "ies"} under "${parent}/" but ${missing.length} more exist(s) on disk: ${missing.join(", ")}. Enumerate all of them or describe the directory as a whole ("${parent}/  ...").`
      );
    }
  }

  // R3 — every top-level content entry is covered, directly or by a child.
  const rootOnDisk = fs.readdirSync(REPO_ROOT).filter((n) => !isDotEntry(n) && !ROOT_EXEMPT.has(n) && !isRootDoc(n));
  for (const name of rootOnDisk) {
    const covered = [...listed].some((l) => l === name || l.startsWith(name + "/") || l.startsWith(name + path.sep));
    if (!covered) {
      reporter.fail(`README.md tree does not mention "${name}", which is top-level content in this repo. Add a line for it, or add it to ROOT_EXEMPT in ${relRoot(path.join(REPO_ROOT, "scripts", "check-readme-tree.mjs"))} with the reason.`);
    }
  }

  reporter.note(`checked ${entries.length} tree entr${entries.length === 1 ? "y" : "ies"} against disk`);
  reporter.finish();
}

main();
