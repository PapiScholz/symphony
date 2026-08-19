// scripts/lib/glob-skills.mjs — finds skills/*/SKILL.md without a glob dependency.

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./repo.mjs";

export function globSkillFiles() {
  const skillsDir = path.join(REPO_ROOT, "skills");
  if (!fs.existsSync(skillsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
    if (fs.existsSync(skillFile)) out.push(skillFile);
  }
  return out;
}
