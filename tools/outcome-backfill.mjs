#!/usr/bin/env node
// outcome-backfill.mjs — fill in the outcome half of the learning log from disk.
//
// Node >= 18, zero dependencies, cross-platform (Windows / macOS / Linux).
//
// Usage:
//   node outcome-backfill.mjs                 # dry run: print what would be appended
//   node outcome-backfill.mjs --append        # append the outcome entries to the log
//   node outcome-backfill.mjs --json          # machine-readable
//   node outcome-backfill.mjs --log <path>    # non-default log location
//
// Why this exists: the dispatch half of ~/.claude/subagent-runs.jsonl is written
// automatically by the PreToolUse hook. The outcome half was specified as
// hand-written after a batch returns, and measurement says that never happens:
// 208 dispatches, 0 outcome entries. It was not forgetfulness -- tool_uses,
// tokens and duration are already on disk in the transcripts. Only the verdict
// is a judgement, so only the verdict is left blank here.
//
// The join is the one documented as verified 34/34 in transcript-schema.json:
// a 'user' line in the main transcript carries
//   toolUseResult = { agentId, resolvedModel, description, ... }
// which links a dispatch to the subagent's own transcript at
//   <project-dir>/<session-uuid>/subagents/agent-<agentId>.jsonl
//
// This tool never assigns a verdict. `ok` / `under` / `over` is the human call
// the rubric in skills/orchestrating-subagents/references/learning-log.md
// describes, and a machine-written verdict would be exactly the unearned
// confidence the log is meant to correct.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const APPEND = args.includes("--append");
const AS_JSON = args.includes("--json");
const logFlagIdx = args.indexOf("--log");
const LOG_PATH =
  logFlagIdx !== -1 && args[logFlagIdx + 1]
    ? args[logFlagIdx + 1]
    : path.join(os.homedir(), ".claude", "subagent-runs.jsonl");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

function readJsonl(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // A truncated tail line is normal on a live transcript; skip it.
    }
  }
  return out;
}

// Locate <projects>/<slug>/<session>.jsonl without knowing the slug.
// Cached: a backfill over many dispatches otherwise re-scans the same dirs.
const sessionFileCache = new Map();
function findSessionDir(sessionId) {
  if (sessionFileCache.has(sessionId)) return sessionFileCache.get(sessionId);
  let found = null;
  let slugs = [];
  try {
    slugs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    sessionFileCache.set(sessionId, null);
    return null;
  }
  for (const d of slugs) {
    if (!d.isDirectory()) continue;
    const candidate = path.join(PROJECTS_DIR, d.name, sessionId + ".jsonl");
    if (fs.existsSync(candidate)) {
      found = { transcript: candidate, dir: path.join(PROJECTS_DIR, d.name, sessionId) };
      break;
    }
  }
  sessionFileCache.set(sessionId, found);
  return found;
}

// Every Agent dispatch result in one session's main transcript.
const dispatchCache = new Map();
function dispatchesInSession(sessionId) {
  if (dispatchCache.has(sessionId)) return dispatchCache.get(sessionId);
  const loc = findSessionDir(sessionId);
  if (!loc) {
    dispatchCache.set(sessionId, []);
    return [];
  }
  const results = [];
  for (const line of readJsonl(loc.transcript)) {
    const r = line?.message?.toolUseResult ?? line?.toolUseResult;
    if (r && r.agentId) {
      results.push({
        agentId: r.agentId,
        resolvedModel: r.resolvedModel ?? null,
        description: r.description ?? "",
        subagentsDir: path.join(loc.dir, "subagents"),
      });
    }
  }
  dispatchCache.set(sessionId, results);
  return results;
}

// tool_uses and token totals from the subagent's own transcript.
function measureAgent(subagentsDir, agentId) {
  const file = path.join(subagentsDir, "agent-" + agentId + ".jsonl");
  if (!fs.existsSync(file)) return null;
  const lines = readJsonl(file);
  let toolUses = 0;
  let tokens = 0;
  let modelSeen = null;
  for (const line of lines) {
    if (line?.type !== "assistant") continue;
    const msg = line.message ?? {};
    if (msg.model && msg.model !== "<synthetic>" && !modelSeen) modelSeen = msg.model;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const c of content) if (c?.type === "tool_use") toolUses++;
    const u = msg.usage;
    if (u) {
      // Same fields cost-report.mjs prices. thinking_tokens is a subset of
      // output_tokens -- adding it would double-count.
      tokens +=
        (u.input_tokens ?? 0) +
        (u.output_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0);
    }
  }
  return { toolUses, tokens, modelSeen };
}

function main() {
  const rows = readJsonl(LOG_PATH);
  if (rows.length === 0) {
    console.error("No log at " + LOG_PATH + " (or it is empty). Nothing to do.");
    process.exit(0);
  }

  // Dispatch half = written by the hook (has `tool`). Outcome half = has `verdict`.
  const dispatches = rows.filter((r) => r.tool && !("verdict" in r));
  const alreadyClosed = new Set(
    rows.filter((r) => "verdict" in r && r.agentId).map((r) => r.agentId)
  );

  const filled = [];
  const unmatched = [];

  for (const d of dispatches) {
    if (!d.session) {
      unmatched.push({ desc: d.desc, why: "no session id on the dispatch row" });
      continue;
    }
    const candidates = dispatchesInSession(d.session).filter(
      (c) => c.description === d.desc && !alreadyClosed.has(c.agentId)
    );
    if (candidates.length === 0) {
      unmatched.push({ desc: d.desc, why: "no matching dispatch in the transcript" });
      continue;
    }
    // Same description dispatched twice in one session: take them in order.
    const match = candidates.shift();
    alreadyClosed.add(match.agentId);

    const m = measureAgent(match.subagentsDir, match.agentId);
    if (!m) {
      unmatched.push({ desc: d.desc, why: "subagent transcript missing on disk" });
      continue;
    }

    filled.push({
      ts: d.ts,
      kind: null, // your own short label for the work shape -- you name it
      agentId: match.agentId,
      type: d.type,
      model: d.model,
      resolvedModel: match.resolvedModel ?? m.modelSeen ?? null,
      effort: d.effort,
      tool_uses: m.toolUses,
      tokens: m.tokens,
      verdict: null, // ok | under | over -- see the rubric, this stays a human call
      note: d.desc,
    });
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ filled, unmatched }, null, 2));
  } else {
    console.log("log:        " + LOG_PATH);
    console.log("dispatches: " + dispatches.length + " without an outcome");
    console.log("matched:    " + filled.length);
    console.log("unmatched:  " + unmatched.length);
    if (filled.length) {
      console.log("");
      console.log("  tool_uses     tokens  asked -> resolved            work");
      for (const f of filled) {
        const asked = String(f.model).padEnd(9);
        const res = String(f.resolvedModel ?? "?").padEnd(18);
        console.log(
          "  " +
            String(f.tool_uses).padStart(9) +
            String(f.tokens).padStart(11) +
            "  " +
            asked +
            "-> " +
            res +
            " " +
            String(f.note).slice(0, 34)
        );
      }
    }
    if (unmatched.length) {
      console.log("");
      console.log("unmatched (left alone, nothing is guessed):");
      const why = new Map();
      for (const u of unmatched) why.set(u.why, (why.get(u.why) ?? 0) + 1);
      for (const [w, n] of why) console.log("  " + String(n).padStart(4) + "  " + w);
    }
  }

  if (!APPEND) {
    if (!AS_JSON) {
      console.log("");
      console.log("Dry run. Re-run with --append to write these to the log.");
      console.log("verdict and kind are left null on purpose -- fill them in by hand.");
    }
    return;
  }

  if (filled.length === 0) {
    if (!AS_JSON) console.log("\nNothing to append.");
    return;
  }
  const payload = filled.map((f) => JSON.stringify(f)).join("\n") + "\n";
  fs.appendFileSync(LOG_PATH, payload, "utf8");
  if (!AS_JSON) console.log("\nAppended " + filled.length + " outcome entr(ies) to " + LOG_PATH);
}

main();
