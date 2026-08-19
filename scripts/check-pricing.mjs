#!/usr/bin/env node
// check-pricing.mjs — sanity checks on tools/pricing.json:
//   - parses as JSON
//   - every entry in "models" has numeric-or-null "input" and "output"
//   - every alias in "aliases" resolves to a key in "models" (no dangling alias)

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const PRICING_PATH = path.join(REPO_ROOT, "tools", "pricing.json");

function isNumericOrNull(v) {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}

function main() {
  const reporter = new Reporter("pricing");
  const rel = relRoot(PRICING_PATH);

  if (!fs.existsSync(PRICING_PATH)) {
    reporter.fail(`${rel}: file does not exist`);
    reporter.finish();
    return;
  }

  const raw = fs.readFileSync(PRICING_PATH, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    reporter.fail(`${rel}: not valid JSON — ${err.message}`);
    reporter.finish();
    return;
  }

  if (!data.models || typeof data.models !== "object" || Array.isArray(data.models)) {
    reporter.fail(`${rel}: missing or malformed "models" object`);
    reporter.finish();
    return;
  }

  const modelKeys = Object.keys(data.models);
  for (const key of modelKeys) {
    const entry = data.models[key];
    if (!entry || typeof entry !== "object") {
      reporter.fail(`${rel}: models["${key}"] is not an object`);
      continue;
    }
    if (!("input" in entry) || !isNumericOrNull(entry.input)) {
      reporter.fail(`${rel}: models["${key}"].input must be numeric or null, got ${JSON.stringify(entry.input)}`);
    }
    if (!("output" in entry) || !isNumericOrNull(entry.output)) {
      reporter.fail(`${rel}: models["${key}"].output must be numeric or null, got ${JSON.stringify(entry.output)}`);
    }
  }

  const aliases = data.aliases && typeof data.aliases === "object" ? data.aliases : {};
  const aliasNames = Object.keys(aliases);
  for (const aliasName of aliasNames) {
    const target = aliases[aliasName];
    if (typeof target !== "string" || !modelKeys.includes(target)) {
      reporter.fail(`${rel}: aliases["${aliasName}"] -> "${target}" does not resolve to a key in "models" (dangling alias)`);
    }
  }

  reporter.note(`checked ${modelKeys.length} model entr${modelKeys.length === 1 ? "y" : "ies"}, ${aliasNames.length} alias(es)`);
  reporter.finish();
}

main();
