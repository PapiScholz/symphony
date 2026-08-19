#!/usr/bin/env node
// check-skill-frontmatter.mjs — validates skills/*/SKILL.md frontmatter against
// the agentskills.io spec subset this repo relies on:
//   - YAML frontmatter delimited by `---` lines
//   - has `name` and `description`
//   - `name` matches the parent directory name (hard requirement of the spec)
//   - frontmatter body is <= 1024 characters
//
// Zero dependencies, no YAML parser — the frontmatter here is always flat
// scalar key: value pairs, so a line-based scan is enough and avoids pulling
// in a dependency for one file shape.

import fs from "node:fs";
import path from "node:path";
import { globSkillFiles } from "./lib/glob-skills.mjs";
import { Reporter, relRoot } from "./lib/repo.mjs";

const MAX_FRONTMATTER_CHARS = 1024;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

function stripQuotes(v) {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function extractScalar(fmBody, key) {
  const re = new RegExp(`^${key}:[ \\t]*(.*)$`, "m");
  const m = fmBody.match(re);
  if (!m) return null;
  return stripQuotes(m[1]);
}

function checkFile(file, reporter) {
  const rel = relRoot(file);
  const dirName = path.basename(path.dirname(file));
  const text = fs.readFileSync(file, "utf8");

  const m = text.match(FRONTMATTER_RE);
  if (!m) {
    reporter.fail(`${rel}: no YAML frontmatter delimited by '---' lines at the top of the file`);
    return;
  }
  const fmBody = m[1];

  if (fmBody.length > MAX_FRONTMATTER_CHARS) {
    reporter.fail(`${rel}: frontmatter is ${fmBody.length} chars, exceeds the ${MAX_FRONTMATTER_CHARS}-char cap`);
  }

  const name = extractScalar(fmBody, "name");
  if (!name) {
    reporter.fail(`${rel}: frontmatter missing required key 'name'`);
  }
  const description = extractScalar(fmBody, "description");
  if (!description) {
    reporter.fail(`${rel}: frontmatter missing required key 'description'`);
  }

  if (name && name !== dirName) {
    reporter.fail(`${rel}: frontmatter name '${name}' does not match parent directory name '${dirName}' (agentskills.io spec requires an exact match)`);
  }
}

function main() {
  const reporter = new Reporter("skill-frontmatter");
  const files = globSkillFiles();
  if (files.length === 0) {
    reporter.fail("no skills/*/SKILL.md files found — nothing to validate (this is itself suspicious for this repo)");
  }
  for (const f of files) checkFile(f, reporter);
  reporter.note(`checked ${files.length} SKILL.md file(s)`);
  reporter.finish();
}

main();
