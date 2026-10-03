#!/usr/bin/env node
// check-outcome-backfill.mjs — runs tools/outcome-backfill.mjs against a fake
// ~/.claude and checks the stopHint split it reports.
//
// The hook recorded stopHint for a release cycle with nothing reading it: the
// field existed, the log filled up, and no output anywhere showed it. This check
// is what keeps the consumer half from going dead again. It builds a home
// directory with one session, three dispatches and their subagent transcripts,
// then asserts on --json output:
//   - each bucket (marker / no marker / not recorded) gets the right dispatches
//     and tokens, so a split that drops or mis-buckets a row fails;
//   - rows logged before the field existed land in "not recorded", never in "no
//     marker" -- folding them in would inflate exactly the number people quote;
//   - the human-readable output says "heuristic", because CONTRIBUTING does not
//     admit this number without that label.
// No network, no model, no real transcripts: the tool reads only the temp dir.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, Reporter } from "./lib/repo.mjs";

const TOOL = path.join(REPO_ROOT, "tools", "outcome-backfill.mjs");
const SESSION = "00000000-0000-4000-8000-000000000001";

const DISPATCHES = [
  { desc: "bounded audit", agentId: "a1", stopHint: true, promptBytes: 60, tokens: 1000, toolUses: 2 },
  { desc: "open survey", agentId: "a2", stopHint: false, promptBytes: 40, tokens: 7000, toolUses: 9 },
  { desc: "legacy row", agentId: "a3", stopHint: undefined, promptBytes: undefined, tokens: 2000, toolUses: 3 },
];

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function buildHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "symphony-backfill-"));
  const projectDir = path.join(home, ".claude", "projects", "C--fake-project");

  // Main transcript: one toolUseResult per dispatch -- the join the tool documents.
  writeJsonl(
    path.join(projectDir, SESSION + ".jsonl"),
    DISPATCHES.map((d) => ({
      type: "user",
      toolUseResult: { agentId: d.agentId, resolvedModel: "claude-haiku-4-5-20251001", description: d.desc },
    }))
  );

  // One subagent transcript per dispatch. All tokens on input_tokens so the
  // expected total is exactly d.tokens.
  for (const d of DISPATCHES) {
    const lines = [];
    for (let i = 0; i < d.toolUses; i++) {
      lines.push({
        type: "assistant",
        message: {
          model: "claude-haiku-4-5-20251001",
          content: [{ type: "tool_use", name: "Read" }],
          usage: { input_tokens: i === 0 ? d.tokens : 0, output_tokens: 0 },
        },
      });
    }
    writeJsonl(path.join(projectDir, SESSION, "subagents", "agent-" + d.agentId + ".jsonl"), lines);
  }

  // The hook's log, as the hook writes it. The legacy row has neither field.
  const log = path.join(home, ".claude", "subagent-runs.jsonl");
  writeJsonl(
    log,
    DISPATCHES.map((d) => {
      const row = { ts: "2026-10-01T00:00:00Z", session: SESSION, tool: "Agent", type: "general-purpose", model: "haiku", effort: "inherited", desc: d.desc };
      if (d.stopHint !== undefined) row.stopHint = d.stopHint;
      if (d.promptBytes !== undefined) row.promptBytes = d.promptBytes;
      return row;
    })
  );
  return { home, log };
}

function runTool(home, log, extra) {
  // os.homedir() reads USERPROFILE on Windows and HOME elsewhere; set both.
  return spawnSync(process.execPath, [TOOL, "--log", log, ...extra], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

function main() {
  const reporter = new Reporter("outcome-backfill");
  const { home, log } = buildHome();

  try {
    const json = runTool(home, log, ["--json"]);
    if (json.status !== 0) {
      reporter.fail(`--json exited ${json.status}. stderr: ${(json.stderr || "").trim()}`);
      reporter.finish();
      return;
    }
    let out;
    try {
      out = JSON.parse(json.stdout);
    } catch (err) {
      reporter.fail(`--json output is not JSON: ${err.message}`);
      reporter.finish();
      return;
    }

    if (out.filled?.length !== DISPATCHES.length) {
      reporter.fail(`expected ${DISPATCHES.length} matched dispatches, got ${out.filled?.length} (unmatched: ${JSON.stringify(out.unmatched)})`);
    }

    const split = out.stopHintSplit;
    if (!split) {
      reporter.fail("--json output has no stopHintSplit; the field the hook writes has no consumer again");
    } else {
      const total = DISPATCHES.reduce((s, d) => s + d.tokens, 0);
      const expect = {
        withMarker: DISPATCHES.filter((d) => d.stopHint === true),
        withoutMarker: DISPATCHES.filter((d) => d.stopHint === false),
        notRecorded: DISPATCHES.filter((d) => d.stopHint === undefined),
      };
      for (const [key, ds] of Object.entries(expect)) {
        const tokens = ds.reduce((s, d) => s + d.tokens, 0);
        const share = Math.round((tokens / total) * 1000) / 1000;
        const got = split[key];
        if (!got || got.dispatches !== ds.length || got.tokens !== tokens || got.tokenShare !== share) {
          reporter.fail(`stopHintSplit.${key}: expected ${JSON.stringify({ dispatches: ds.length, tokens, tokenShare: share })}, got ${JSON.stringify(got)}`);
        }
      }
      if (!/heuristic/i.test(split._note || "")) {
        reporter.fail("stopHintSplit._note does not call stopHint a heuristic");
      }
    }

    for (const f of out.filled ?? []) {
      const d = DISPATCHES.find((x) => x.desc === f.note);
      if (d && f.promptBytes !== (d.promptBytes ?? null)) {
        reporter.fail(`filled row "${f.note}": expected promptBytes ${d.promptBytes ?? null}, got ${f.promptBytes}`);
      }
    }

    const human = runTool(home, log, []);
    if (human.status !== 0) {
      reporter.fail(`dry run exited ${human.status}. stderr: ${(human.stderr || "").trim()}`);
    } else if (!/HEURISTIC/.test(human.stdout) || !/no stop marker/.test(human.stdout)) {
      reporter.fail(`human output does not show the stopHint split labelled as a heuristic. Got:\n${human.stdout}`);
    }

    reporter.note(`ran outcome-backfill on ${DISPATCHES.length} synthetic dispatches; stopHint split checked in --json and text output`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }

  reporter.finish();
}

main();
