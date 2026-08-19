#!/usr/bin/env node
// check-manifests.mjs — validates .claude-plugin/marketplace.json and plugin.json:
//   - both parse as JSON
//   - marketplace.json has name, owner.name, plugins[] each with name + source
//   - plugin.json has name
//   - the plugin's version in marketplace.json agrees with plugin.json's version

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, Reporter, relRoot } from "./lib/repo.mjs";

const MARKETPLACE_PATH = path.join(REPO_ROOT, ".claude-plugin", "marketplace.json");
const PLUGIN_PATH = path.join(REPO_ROOT, ".claude-plugin", "plugin.json");

function loadJson(filePath, reporter) {
  const rel = relRoot(filePath);
  if (!fs.existsSync(filePath)) {
    reporter.fail(`${rel}: file does not exist`);
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    reporter.fail(`${rel}: not valid JSON — ${err.message}`);
    return null;
  }
}

function main() {
  const reporter = new Reporter("manifests");

  const marketplace = loadJson(MARKETPLACE_PATH, reporter);
  const plugin = loadJson(PLUGIN_PATH, reporter);

  if (marketplace) {
    const rel = relRoot(MARKETPLACE_PATH);
    if (typeof marketplace.name !== "string" || marketplace.name.trim() === "") {
      reporter.fail(`${rel}: missing or empty required field 'name'`);
    }
    if (!marketplace.owner || typeof marketplace.owner.name !== "string" || marketplace.owner.name.trim() === "") {
      reporter.fail(`${rel}: missing or empty required field 'owner.name'`);
    }
    if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
      reporter.fail(`${rel}: 'plugins' must be a non-empty array`);
    } else {
      marketplace.plugins.forEach((p, i) => {
        if (!p || typeof p.name !== "string" || p.name.trim() === "") {
          reporter.fail(`${rel}: plugins[${i}] missing or empty required field 'name'`);
        }
        if (!p || typeof p.source !== "string" || p.source.trim() === "") {
          reporter.fail(`${rel}: plugins[${i}] missing or empty required field 'source'`);
        }
      });
    }
  }

  if (plugin) {
    const rel = relRoot(PLUGIN_PATH);
    if (typeof plugin.name !== "string" || plugin.name.trim() === "") {
      reporter.fail(`${rel}: missing or empty required field 'name'`);
    }
  }

  // Version agreement: find the marketplace plugin entry matching plugin.json's
  // name (falls back to the sole entry if there's exactly one, since a
  // single-plugin marketplace — this repo's shape today — has no ambiguity).
  if (marketplace && plugin && Array.isArray(marketplace.plugins)) {
    let entry = null;
    if (typeof plugin.name === "string") {
      entry = marketplace.plugins.find((p) => p && p.name === plugin.name) || null;
    }
    if (!entry && marketplace.plugins.length === 1) {
      entry = marketplace.plugins[0];
    }
    if (!entry) {
      reporter.fail(
        `${relRoot(MARKETPLACE_PATH)}: no plugins[] entry named '${plugin.name}' to compare against ${relRoot(PLUGIN_PATH)}'s version`
      );
    } else {
      if (typeof entry.version !== "string") {
        reporter.fail(`${relRoot(MARKETPLACE_PATH)}: plugins[] entry '${entry.name}' has no 'version' field`);
      }
      if (typeof plugin.version !== "string") {
        reporter.fail(`${relRoot(PLUGIN_PATH)}: missing 'version' field`);
      }
      if (typeof entry.version === "string" && typeof plugin.version === "string" && entry.version !== plugin.version) {
        reporter.fail(
          `version mismatch: ${relRoot(MARKETPLACE_PATH)} plugins[].version = "${entry.version}" but ${relRoot(PLUGIN_PATH)} version = "${plugin.version}"`
        );
      }
    }
  }

  checkSkillsShConfig(reporter);

  reporter.finish();
}

// skills.sh.json curates how this repo's skills are grouped on its skills.sh page. skills.sh
// searches over a skill's name and description only -- not the README -- so that page and those
// fields are the entire discovery surface. A skill missing from the config silently lands in the
// ungrouped bucket, which is the kind of failure nobody notices from inside the repo.
function checkSkillsShConfig(reporter) {
  const configPath = path.join(REPO_ROOT, "skills.sh.json");
  if (!fs.existsSync(configPath)) return; // optional file

  const rel = relRoot(configPath);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    reporter.fail(`${rel}: is not valid JSON — ${err.message}`);
    return;
  }

  if (!Array.isArray(config.groupings)) {
    reporter.fail(`${rel}: 'groupings' must be an array`);
    return;
  }
  if (config.notGrouped !== undefined && config.notGrouped !== "top" && config.notGrouped !== "bottom") {
    reporter.fail(`${rel}: 'notGrouped' must be "top" or "bottom", got ${JSON.stringify(config.notGrouped)}`);
  }

  const listed = [];
  for (const [i, group] of config.groupings.entries()) {
    if (!group || typeof group.title !== "string" || !group.title.trim()) {
      reporter.fail(`${rel}: groupings[${i}] has no non-empty 'title'`);
    }
    if (!Array.isArray(group?.skills)) {
      reporter.fail(`${rel}: groupings[${i}] ('${group?.title}') has no 'skills' array`);
      continue;
    }
    listed.push(...group.skills);
  }

  const onDisk = fs
    .readdirSync(path.join(REPO_ROOT, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(REPO_ROOT, "skills", d.name, "SKILL.md")))
    .map((d) => d.name);

  for (const name of onDisk) {
    if (!listed.includes(name)) {
      reporter.fail(
        `${rel}: skill '${name}' exists on disk but is in no grouping — it would fall into the ungrouped bucket on skills.sh`
      );
    }
  }
  for (const name of listed) {
    if (!onDisk.includes(name)) {
      reporter.fail(`${rel}: grouping lists '${name}', which is not a skill directory under skills/`);
    }
  }
  const dupes = listed.filter((n, i) => listed.indexOf(n) !== i);
  for (const name of new Set(dupes)) {
    reporter.fail(`${rel}: skill '${name}' appears in more than one grouping`);
  }
}

main();
