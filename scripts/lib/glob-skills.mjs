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

// skills/*/references/*.md — the files a SKILL.md defers to. Deliberately kept
// out of globSkillFiles(): reference files carry no frontmatter, so the
// frontmatter check must not see them. Their prose cites repo paths like any
// other doc, which is what the link check needs them for.
export function globSkillReferenceFiles() {
  const skillsDir = path.join(REPO_ROOT, "skills");
  if (!fs.existsSync(skillsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const refDir = path.join(skillsDir, entry.name, "references");
    if (!fs.existsSync(refDir)) continue;
    for (const ref of fs.readdirSync(refDir, { withFileTypes: true })) {
      if (ref.isFile() && ref.name.endsWith(".md")) out.push(path.join(refDir, ref.name));
    }
  }
  return out;
}
