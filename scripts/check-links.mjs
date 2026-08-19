#!/usr/bin/env node
// check-links.mjs — internal-only link check.
//
// Scans README.md, METHODOLOGY.md, CONTRIBUTING.md and every skills/*/SKILL.md
// for (a) markdown links [text](path) and (b) inline-code path references
// (`some/repo/path.ext`) that look like a repo-relative path, and asserts each
// one exists on disk. External URLs (http/https/mailto) are intentionally
// skipped — they're flaky and rate-limited in CI, and this check is about
// catching a renamed/moved file, not link rot on the open web.
//
// Resolution is intentionally forgiving about *where* a relative path is
// relative to, because this repo's docs reference the same file two ways:
// root-relative ("skills/orchestrating-subagents/references/learning-log.md")
// from README.md, and skill-relative ("references/learning-log.md") from
// inside SKILL.md itself, where it also gets referenced *as if root-relative*
// from other docs. A path is accepted if it resolves against the repo root,
// against the referencing file's own directory, OR — as a last resort — by
// matching a unique file elsewhere in the repo whose path ends with it. Only
// if none of those find a real file does the check fail.

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, Reporter, relRoot, walkFiles } from "./lib/repo.mjs";
import { globSkillFiles } from "./lib/glob-skills.mjs";

const TARGET_FILES = [
  path.join(REPO_ROOT, "README.md"),
  path.join(REPO_ROOT, "METHODOLOGY.md"),
  path.join(REPO_ROOT, "CONTRIBUTING.md"),
  ...globSkillFiles(),
].filter((f) => fs.existsSync(f));

// path segment: word chars, dot, dash, underscore. Requires at least one '/'.
const PATH_SEGMENT = "[A-Za-z0-9_.-]+";
const REPO_PATH_RE = new RegExp(`${PATH_SEGMENT}(?:/${PATH_SEGMENT})+`);

const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)\)/g;
// Single-backtick inline code spans (not triple-backtick fences — handled by
// stripping fenced blocks before this regex runs).
const INLINE_CODE_RE = /`([^`\n]+)`/g;

function stripCodeFences(text) {
  // Replace fenced code blocks with blank lines of the same line count, so
  // line numbers stay accurate for reporting but fence contents (command
  // examples, sample JSON, etc.) aren't scanned as prose paths.
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ""));
}

function looksLikeRepoPath(candidate) {
  if (!candidate) return false;
  if (/^(https?:|mailto:|tel:)/i.test(candidate)) return false;
  if (candidate.startsWith("#")) return false;
  if (candidate.includes("://")) return false;
  if (candidate.startsWith("~")) return false;
  if (candidate.includes("<") || candidate.includes(">")) return false;
  if (candidate.includes(" ")) return false;
  // Glob patterns in prose ("hooks/subagent-dispatch-log.*", ".claude/agents/*.md")
  // describe a class of files, not one concrete path — not something this
  // check can (or should) resolve to a single file.
  if (/[*?[\]]/.test(candidate)) return false;
  return REPO_PATH_RE.test(candidate);
}

function stripAnchor(p) {
  const i = p.indexOf("#");
  return i === -1 ? p : p.slice(0, i);
}

// Lazily built index: basename-suffix -> list of absolute paths in the repo
// whose relRoot ends with that suffix. Built once per run.
let suffixIndexCache = null;
function allRepoFiles() {
  if (!suffixIndexCache) {
    suffixIndexCache = walkFiles(REPO_ROOT);
  }
  return suffixIndexCache;
}

function resolveReference(refPath, sourceFile) {
  const cleaned = stripAnchor(refPath).trim();
  if (cleaned === "") return { ok: true, via: "empty-after-anchor-strip" }; // pure "#fragment" already filtered upstream, defensive only

  const rootCandidate = path.join(REPO_ROOT, cleaned);
  if (fs.existsSync(rootCandidate)) return { ok: true, via: "root-relative" };

  const fileDirCandidate = path.join(path.dirname(sourceFile), cleaned);
  if (fs.existsSync(fileDirCandidate)) return { ok: true, via: "file-relative" };

  // Suffix search: does exactly one real file in the repo end with this path?
  const normalizedCleaned = cleaned.split(path.sep).join("/");
  const matches = allRepoFiles().filter((f) => relRoot(f) === normalizedCleaned || relRoot(f).endsWith("/" + normalizedCleaned));
  if (matches.length >= 1) {
    return { ok: true, via: `suffix-match (${matches.length} candidate${matches.length === 1 ? "" : "s"}: ${matches.map(relRoot).join(", ")})` };
  }

  return { ok: false };
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function checkFile(file, reporter) {
  const rel = relRoot(file);
  const rawText = fs.readFileSync(file, "utf8");
  const scanText = stripCodeFences(rawText);

  const seen = new Set(); // avoid duplicate reports for the same (line, path)

  let m;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(scanText)) !== null) {
    const target = m[2];
    if (!looksLikeRepoPathOrAnchorOnly(target)) continue;
    const line = lineNumberAt(scanText, m.index);
    const key = `${line}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = resolveReference(target, file);
    if (!result.ok) {
      reporter.fail(`${rel}:${line}: markdown link target "${target}" does not exist on disk (tried repo-root-relative, file-relative, and a repo-wide suffix match)`);
    }
  }

  INLINE_CODE_RE.lastIndex = 0;
  while ((m = INLINE_CODE_RE.exec(scanText)) !== null) {
    const candidate = m[1];
    if (!looksLikeRepoPath(candidate)) continue;
    const line = lineNumberAt(scanText, m.index);
    const key = `${line}:${candidate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = resolveReference(candidate, file);
    if (!result.ok) {
      reporter.fail(`${rel}:${line}: inline path reference \`${candidate}\` does not exist on disk (tried repo-root-relative, file-relative, and a repo-wide suffix match)`);
    }
  }
}

// Markdown-link targets are allowed to be pure anchors ("#section") — those
// are intra-document, not a repo path, and are skipped rather than failed.
function looksLikeRepoPathOrAnchorOnly(target) {
  if (target.startsWith("#")) return false; // pure anchor: not a repo path, nothing to check
  if (/^(https?:|mailto:|tel:)/i.test(target)) return false;
  if (target.includes("://")) return false;
  if (/[*?[\]]/.test(target)) return false; // glob pattern, not a concrete path
  return true; // markdown links are explicit authorial intent — check anything else, even without a second path segment (e.g. "LICENSE")
}

function main() {
  const reporter = new Reporter("internal-links");
  if (TARGET_FILES.length === 0) {
    reporter.fail("no target files found (README.md / METHODOLOGY.md / CONTRIBUTING.md / skills/*/SKILL.md)");
  }
  for (const f of TARGET_FILES) checkFile(f, reporter);
  reporter.note(`scanned ${TARGET_FILES.length} file(s): ${TARGET_FILES.map(relRoot).join(", ")}`);
  reporter.finish();
}

main();
