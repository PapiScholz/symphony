#!/usr/bin/env node
// firing-report.mjs — read the stream-json transcripts written by run-firing-test.sh and
// report, per run, which skills fired and which tools were used.
//
// A skill invocation is a tool_use named `Skill`; its input carries the skill id. Absence of
// those events only means something if the detector is known to produce them, so this reports
// the control arm first and refuses to draw a conclusion when the control is silent.

import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node firing-report.mjs <dir with *.jsonl>");
  process.exit(2);
}

function scan(file) {
  const skills = [];
  const tools = new Map();
  let finalText = "";
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (typeof o.result === "string" && o.result.trim()) finalText = o.result.trim();
    for (const c of o?.message?.content ?? []) {
      if (c?.type === "tool_use") {
        tools.set(c.name, (tools.get(c.name) ?? 0) + 1);
        if (c.name === "Skill") skills.push(c.input?.skill ?? JSON.stringify(c.input));
      }
      if (c?.type === "text" && c.text?.trim()) finalText = c.text.trim();
    }
  }
  return { skills, tools, finalText };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
const control = files.find((f) => f.startsWith("control"));
const arms = files.filter((f) => !f.startsWith("control"));

let detectorWorks = false;
if (control) {
  const r = scan(path.join(dir, control));
  detectorWorks = r.skills.length > 0;
  console.log(`DETECTOR CONTROL (${control})`);
  console.log(`  skills fired: ${r.skills.length ? r.skills.join(", ") : "(none)"}`);
  console.log(`  verdict: ${detectorWorks ? "detector WORKS — an absence below is meaningful" : "detector SILENT — absences below prove nothing"}`);
} else {
  console.log("DETECTOR CONTROL: missing — absences below prove nothing");
}
console.log();

// Grouped by variant: `verbatim` shares its phrasing with the skill's own description, so a
// hit there shows a text matching itself. `paraphrase` shares none of it — that is the arm
// whose result carries information.
const byVariant = new Map();
let fired = 0;
for (const f of arms) {
  const variant = f.split("-rep")[0];
  if (!byVariant.has(variant)) byVariant.set(variant, { fired: 0, total: 0 });
  const r = scan(path.join(dir, f));
  const fanned = (r.tools.get("Task") ?? 0) + (r.tools.get("Agent") ?? 0);
  const v = byVariant.get(variant);
  v.total++;
  if (r.skills.length) { fired++; v.fired++; }
  console.log(`${f}`);
  console.log(`  skills fired : ${r.skills.length ? r.skills.join(", ") : "(none)"}`);
  console.log(`  tools        : ${[...r.tools].map(([k, v]) => `${k}x${v}`).join(" ") || "(none)"}`);
  console.log(`  fanned out   : ${fanned > 0 ? `YES (${fanned} agent dispatches)` : "no"}`);
  console.log(`  answer       : ${r.finalText.replace(/\s+/g, " ").slice(0, 220)}`);
  console.log();
}

console.log("SUMMARY");
for (const [variant, v] of byVariant) {
  const note =
    variant === "verbatim"
      ? "  (shares wording with the skill's description — a hit here proves little, a miss is decisive)"
      : variant === "paraphrase"
        ? "  (shares no wording with the description — this is the arm that carries information)"
        : "";
  console.log(`  ${variant}: fired unprompted in ${v.fired}/${v.total} runs${note}`);
}
console.log(`  overall: ${fired}/${arms.length}`);
if (!detectorWorks) {
  console.log("");
  console.log("WARNING: the control did not fire either. Nothing above is evidence — fix the detector first.");
  process.exit(3);
}
