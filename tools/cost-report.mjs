#!/usr/bin/env node
// cost-report.mjs — real token cost of a Claude Code session, from on-disk transcripts.
//
// Node >= 18, zero dependencies, cross-platform (Windows / macOS / Linux).
//
// Usage:
//   node cost-report.mjs [--session <uuid|latest>] [--project <slug|auto>] [--json] [--pricing <path>]
//
// This tool is deliberately conservative: it never guesses a price, never silently
// drops tokens it can't price, and never prints a "you saved X%" headline without the
// upper-bound caveat attached. See ../docs (or the spec that produced this file) for
// the full reasoning. If something looks wrong, that's more likely a real gap in the
// (reverse-engineered) transcript schema than a bug in the arithmetic — check
// transcript-schema.json's "unverified"/"inferred" notes first.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const DEFAULT_PRICING_PATH = path.join(SCRIPT_DIR, "pricing.json");

const UPPER_BOUND_CAVEAT =
  "Upper bound. A single agent doing this work would not have spent these same tokens: " +
  "each subagent re-creates its own prompt cache, which one continuous session pays once. " +
  "Real saving is lower.";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { session: "latest", project: "auto", json: false, pricing: null, help: false, usd: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--session":
        args.session = argv[++i];
        break;
      case "--project":
        args.project = argv[++i];
        break;
      case "--json":
        args.json = true;
        break;
      case "--pricing":
        args.pricing = argv[++i];
        break;
      case "--usd":
        args.usd = true; // explicit no-op: USD section is shown by default anyway
        break;
      case "--no-usd":
        args.usd = false;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new UserError(`Unknown argument: ${a}. Run with --help for usage.`);
    }
  }
  return args;
}

const HELP = `cost-report.mjs — token distribution (and, if you pay per token, cost) of a Claude Code session from its on-disk transcripts

Usage:
  node cost-report.mjs [--session <uuid|latest>] [--project <slug|auto>] [--json] [--pricing <path>] [--usd|--no-usd]

Options:
  --session <uuid|latest>   Session to cost. Default: latest.
  --project <slug|auto>     Project slug under <config>/projects/. Default: auto (derived from cwd).
  --json                    Emit machine-readable JSON instead of the human-readable report. Always includes
                             both tokens and USD, regardless of --usd/--no-usd.
  --pricing <path>          Path to a pricing.json (same shape as the bundled one). Default: ./pricing.json next to this script.
  --usd                     Show the "if you pay per token" USD section. This is the default — the flag exists
                             for symmetry with --no-usd and is otherwise a no-op.
  --no-usd                  Suppress the USD section entirely. For Claude Pro/Max/Team subscribers, where the
                             session cost figure is not billed and the dollar amounts are noise.

Env:
  CLAUDE_CONFIG_DIR         Overrides the default ~/.claude config directory.

Note: token counts are real and apply to every plan. USD figures only apply if you (or your org) pay per
token — API, Amazon Bedrock, Google Vertex, or Microsoft Foundry. On Claude Pro/Max/Team subscriptions,
usage is included in the flat subscription fee and these dollar figures are not billed to you.
`;

class UserError extends Error {}

// ---------------------------------------------------------------------------
// Path / config resolution
// ---------------------------------------------------------------------------

function expandTilde(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function resolveConfigDir() {
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir && envDir.trim() !== "") {
    return path.resolve(expandTilde(envDir));
  }
  return path.join(os.homedir(), ".claude");
}

// Mirrors Claude Code's on-disk project-slug scheme: every path separator and
// every ':' (Windows drive letter) becomes a literal '-'. No collapsing of
// consecutive separators — "C:\Users\x" -> "C--Users-x" (colon AND backslash
// each produce their own dash). Verified against real project dirs on this
// machine (C--Users-ezesc-Github-Almacen <- C:\Users\ezesc\Github\Almacen).
function pathToSlug(absPath) {
  return absPath.replace(/[\\/:]/g, "-");
}

function resolveProjectDir(configDir, projectArg, cwd) {
  const projectsRoot = path.join(configDir, "projects");
  let slug;
  if (!projectArg || projectArg === "auto") {
    slug = pathToSlug(path.resolve(cwd));
  } else {
    slug = projectArg;
  }
  const projectDir = path.join(projectsRoot, slug);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    let available = [];
    try {
      available = fs.readdirSync(projectsRoot).filter((d) => {
        try {
          return fs.statSync(path.join(projectsRoot, d)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      // projectsRoot itself missing; leave available empty
    }
    const hint =
      available.length > 0
        ? `\nKnown projects under ${projectsRoot}:\n  ${available.join("\n  ")}`
        : `\nNo project directories found under ${projectsRoot} (does ${configDir} look right? Try CLAUDE_CONFIG_DIR).`;
    throw new UserError(`No project directory for slug "${slug}" (looked in ${projectDir}).${hint}`);
  }
  return { projectDir, slug };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listSessions(projectDir) {
  const entries = fs.readdirSync(projectDir);
  const sessions = [];
  for (const e of entries) {
    if (e.endsWith(".jsonl")) {
      const uuid = e.slice(0, -".jsonl".length);
      if (UUID_RE.test(uuid)) {
        const full = path.join(projectDir, e);
        const st = fs.statSync(full);
        sessions.push({ uuid, path: full, mtimeMs: st.mtimeMs });
      }
    }
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}

function resolveSession(projectDir, sessionArg) {
  const sessions = listSessions(projectDir);
  if (sessions.length === 0) {
    throw new UserError(`No session transcripts (*.jsonl) found under ${projectDir}.`);
  }
  if (!sessionArg || sessionArg === "latest") {
    return sessions[0];
  }
  const found = sessions.find((s) => s.uuid.toLowerCase() === sessionArg.toLowerCase());
  if (!found) {
    const knownList = sessions
      .slice(0, 10)
      .map((s) => `  ${s.uuid}`)
      .join("\n");
    const more = sessions.length > 10 ? `\n  ... and ${sessions.length - 10} more` : "";
    throw new UserError(
      `Session "${sessionArg}" not found under ${projectDir}.\nMost recent known sessions:\n${knownList}${more}`
    );
  }
  return found;
}

function subagentFiles(projectDir, uuid) {
  const dir = path.join(projectDir, uuid, "subagents");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
}

// ---------------------------------------------------------------------------
// Transcript reading
// ---------------------------------------------------------------------------

// Reads a .jsonl file line by line, tolerant of a truncated/corrupt trailing
// line (the main transcript can be actively growing while this reads it) and
// of any single malformed line. Malformed lines are skipped, not fatal.
function readJsonlLines(filePath, warnings) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    warnings.push(`Could not read ${filePath}: ${err.message}`);
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const objects = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      objects.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed/partial lines (e.g. a session still being written).
      warnings.push(`Skipped 1 malformed JSON line in ${path.basename(filePath)}.`);
    }
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function newGroup(isSidechain, model) {
  return {
    isSidechain,
    model,
    lines: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    usedFallback5mForUntaggedCacheWrite: false,
  };
}

function addUsageLine(group, usage) {
  group.lines += 1;
  group.input_tokens += usage.input_tokens || 0;
  group.output_tokens += usage.output_tokens || 0;
  group.cache_read_input_tokens += usage.cache_read_input_tokens || 0;

  const cc = usage.cache_creation;
  const totalCacheCreation = usage.cache_creation_input_tokens || 0;
  if (cc && (typeof cc.ephemeral_1h_input_tokens === "number" || typeof cc.ephemeral_5m_input_tokens === "number")) {
    group.cache_write_5m_tokens += cc.ephemeral_5m_input_tokens || 0;
    group.cache_write_1h_tokens += cc.ephemeral_1h_input_tokens || 0;
  } else if (totalCacheCreation > 0) {
    // cache_creation_input_tokens present but no 1h/5m split (schema note:
    // this field pairing wasn't observed to vary, but the schema explicitly
    // says be defensive about optional fields). Assume 5m (the default TTL)
    // and say so in the notes.
    group.cache_write_5m_tokens += totalCacheCreation;
    group.usedFallback5mForUntaggedCacheWrite = true;
  }
}

// Walks one transcript file (main or a subagent file) and folds every
// assistant line's usage into `groups`, keyed by (isSidechain, model).
// Per spec: only 'assistant' lines carry usage; skip <synthetic>; use
// isSidechain (defaulting to the file's own context if the field is somehow
// absent on a subagent-file line, since sidechain_semantics in the schema
// says subagent files are 100% isSidechain:true in every sample checked).
function foldTranscript(filePath, groups, warnings, opts) {
  const lines = readJsonlLines(filePath, warnings);
  let skippedSynthetic = 0;
  for (const line of lines) {
    if (line.type !== "assistant") continue;
    const message = line.message;
    if (!message || !message.usage) continue;
    const model = message.model;
    if (model === "<synthetic>") {
      skippedSynthetic += 1;
      continue;
    }
    if (!model) continue; // defensive: schema says model is always present on assistant lines, but don't crash if not.
    const isSidechain = typeof line.isSidechain === "boolean" ? line.isSidechain : opts.defaultIsSidechain;
    const key = `${isSidechain}|${model}`;
    if (!groups.has(key)) groups.set(key, newGroup(isSidechain, model));
    addUsageLine(groups.get(key), message.usage);
  }
  return skippedSynthetic;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function loadPricing(pricingPath) {
  let raw;
  try {
    raw = fs.readFileSync(pricingPath, "utf8");
  } catch (err) {
    throw new UserError(`Could not read pricing file ${pricingPath}: ${err.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new UserError(`Pricing file ${pricingPath} is not valid JSON: ${err.message}`);
  }
  if (!data.models || typeof data.models !== "object") {
    throw new UserError(`Pricing file ${pricingPath} has no "models" object.`);
  }
  return data;
}

const REQUIRED_RATE_KEYS = ["input", "output", "cache_write", "cache_read"];

// Returns { found, priceable, entry } — never throws. A model is "priceable"
// only if every required rate is a finite number; a missing entry OR a null
// price on any required key makes it unpriceable, per the spec: never guess,
// never silently drop.
function resolveModelPricing(pricing, modelId) {
  let entry = pricing.models[modelId];
  if (!entry && pricing.aliases && pricing.aliases[modelId]) {
    entry = pricing.models[pricing.aliases[modelId]];
  }
  if (!entry) return { found: false, priceable: false, entry: null };
  const priceable = REQUIRED_RATE_KEYS.every((k) => typeof entry[k] === "number" && Number.isFinite(entry[k]));
  return { found: true, priceable, entry };
}

// Prices one aggregated group at a given rate entry. `rate` must already be
// known-priceable (all four REQUIRED_RATE_KEYS present). Handles the
// ephemeral_1h_input_tokens / cache_write_1h fallback per spec: if the
// pricing file has no cache_write_1h rate for this model but the group has
// 1h-cache tokens, fall back to the 5m cache_write rate and note it.
function priceGroup(group, rate, rateModelId, notes) {
  const usd = {};
  usd.input = (group.input_tokens / 1e6) * rate.input;
  usd.output = (group.output_tokens / 1e6) * rate.output;
  usd.cacheRead = (group.cache_read_input_tokens / 1e6) * rate.cache_read;

  let write1hRate = rate.cache_write_1h;
  if (
    group.cache_write_1h_tokens > 0 &&
    !(typeof write1hRate === "number" && Number.isFinite(write1hRate))
  ) {
    write1hRate = rate.cache_write;
    notes.add(
      `${rateModelId}: pricing.json has no cache_write_1h rate; used the 5m cache_write rate for ` +
        `${group.cache_write_1h_tokens.toLocaleString("en-US")} ephemeral_1h_input_tokens (understates cost, since 1h writes cost more than 5m writes).`
    );
  }
  usd.cacheWrite =
    (group.cache_write_5m_tokens / 1e6) * rate.cache_write + (group.cache_write_1h_tokens / 1e6) * write1hRate;

  if (group.usedFallback5mForUntaggedCacheWrite) {
    notes.add(
      `${rateModelId}: some assistant lines had cache_creation_input_tokens but no ephemeral_1h/5m split; assumed 5m-TTL rate.`
    );
  }

  usd.total = usd.input + usd.output + usd.cacheRead + usd.cacheWrite;
  return usd;
}

function groupTokenTotal(group) {
  return (
    group.input_tokens +
    group.output_tokens +
    group.cache_read_input_tokens +
    group.cache_write_5m_tokens +
    group.cache_write_1h_tokens
  );
}

// ---------------------------------------------------------------------------
// Token distribution (price-independent — works even with no pricing.json
// coverage at all, and regardless of --usd/--no-usd).
// ---------------------------------------------------------------------------

// "Premium" here means a model family that costs materially more per token
// than the workhorse tiers, per the families named in the spec. This is a
// token-distribution label, not a claim about subscription quota: this tool
// never states or implies that a cheaper model consumes a subscription's
// shared quota more slowly — that isn't documented anywhere and isn't
// verified here.
const PREMIUM_MODEL_RE = /opus|fable|mythos/i;

function isPremiumModel(modelId) {
  return PREMIUM_MODEL_RE.test(modelId);
}

// Builds the token-only summary (per-model rows, orchestrator/delegated
// split, premium share of delegated tokens) directly from `groups`, i.e.
// from every model that produced usage — priced or not. Unlike buildReport()
// this never excludes a model for lack of pricing data, because none of
// these figures are dollar figures.
function buildTokenSummary(groups) {
  const perModel = [];
  let orchestratorTokens = 0;
  let delegatedTokens = 0;
  let premiumDelegatedTokens = 0;
  const premiumDelegatedByModel = new Map();

  for (const group of groups.values()) {
    if (group.lines === 0) continue;
    const total = groupTokenTotal(group);
    const premium = isPremiumModel(group.model);
    perModel.push({
      model: group.model,
      isSidechain: group.isSidechain,
      lines: group.lines,
      premium,
      tokens: {
        input_tokens: group.input_tokens,
        output_tokens: group.output_tokens,
        cache_read_input_tokens: group.cache_read_input_tokens,
        cache_write_5m_tokens: group.cache_write_5m_tokens,
        cache_write_1h_tokens: group.cache_write_1h_tokens,
        total,
      },
    });
    if (group.isSidechain) {
      delegatedTokens += total;
      if (premium) {
        premiumDelegatedTokens += total;
        premiumDelegatedByModel.set(group.model, (premiumDelegatedByModel.get(group.model) || 0) + total);
      }
    } else {
      orchestratorTokens += total;
    }
  }

  const premiumShare = delegatedTokens > 0 ? premiumDelegatedTokens / delegatedTokens : null;

  return {
    perModel,
    orchestratorTokens,
    delegatedTokens,
    premiumDelegatedTokens,
    premiumShare,
    premiumDelegatedByModel: [...premiumDelegatedByModel.entries()]
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function buildReport(groups, pricing, notes) {
  const rows = [];
  const unpriced = [];
  for (const group of groups.values()) {
    if (group.lines === 0) continue;
    const { found, priceable, entry } = resolveModelPricing(pricing, group.model);
    if (!found || !priceable) {
      unpriced.push({
        model: group.model,
        isSidechain: group.isSidechain,
        reason: !found ? "no entry in pricing.json" : "one or more rates are null in pricing.json",
        tokens: {
          input_tokens: group.input_tokens,
          output_tokens: group.output_tokens,
          cache_read_input_tokens: group.cache_read_input_tokens,
          cache_write_5m_tokens: group.cache_write_5m_tokens,
          cache_write_1h_tokens: group.cache_write_1h_tokens,
          total: groupTokenTotal(group),
        },
      });
      continue;
    }
    const usd = priceGroup(group, entry, group.model, notes);
    rows.push({
      model: group.model,
      isSidechain: group.isSidechain,
      lines: group.lines,
      tokens: {
        input_tokens: group.input_tokens,
        output_tokens: group.output_tokens,
        cache_read_input_tokens: group.cache_read_input_tokens,
        cache_write_5m_tokens: group.cache_write_5m_tokens,
        cache_write_1h_tokens: group.cache_write_1h_tokens,
        total: groupTokenTotal(group),
      },
      usd,
    });
  }
  return { rows, unpriced };
}

function subtotal(rows, isSidechain) {
  const filtered = rows.filter((r) => r.isSidechain === isSidechain);
  const usd = filtered.reduce((acc, r) => acc + r.usd.total, 0);
  const tokens = filtered.reduce((acc, r) => acc + r.tokens.total, 0);
  return { usd, tokens, rows: filtered };
}

// Counterfactual: what would the (priced) subagent token volume have cost at
// the orchestrator's rate? Orchestrator model = the non-sidechain model with
// the most output_tokens. To avoid ever overstating the "saving", the token
// volume compared on both sides (actual subagent $ vs counterfactual $) is
// restricted to subagent groups that ARE priced — unpriced subagent tokens
// are excluded from *both* sides so the comparison stays apples-to-apples,
// and their exclusion is called out explicitly.
function buildCounterfactual(groups, rows, unpriced, pricing, notes) {
  const orchestratorRows = rows.filter((r) => !r.isSidechain);
  if (orchestratorRows.length === 0) {
    return { available: false, reason: "No priced orchestrator (non-sidechain) turns found." };
  }
  let orchestratorModel = null;
  let maxOutput = -1;
  for (const g of groups.values()) {
    if (g.isSidechain) continue;
    if (g.output_tokens > maxOutput) {
      maxOutput = g.output_tokens;
      orchestratorModel = g.model;
    }
  }
  if (!orchestratorModel) {
    return { available: false, reason: "Could not determine an orchestrator model (no non-sidechain output tokens)." };
  }
  const { found, priceable, entry } = resolveModelPricing(pricing, orchestratorModel);
  if (!found || !priceable) {
    return {
      available: false,
      reason: `Orchestrator model "${orchestratorModel}" has no usable price in pricing.json — counterfactual cannot be computed.`,
      orchestratorModel,
    };
  }

  const subagentRows = rows.filter((r) => r.isSidechain);
  const unpricedSubagent = unpriced.filter((u) => u.isSidechain);

  const actualSubagentUsd = subagentRows.reduce((acc, r) => acc + r.usd.total, 0);
  const actualSubagentTokens = subagentRows.reduce((acc, r) => acc + r.tokens.total, 0);

  // Fold priced subagent groups' token components into one bucket, then
  // price that bucket at the orchestrator's rate.
  const bucket = newGroup(true, "__counterfactual_bucket__");
  for (const r of subagentRows) {
    bucket.input_tokens += r.tokens.input_tokens;
    bucket.output_tokens += r.tokens.output_tokens;
    bucket.cache_read_input_tokens += r.tokens.cache_read_input_tokens;
    bucket.cache_write_5m_tokens += r.tokens.cache_write_5m_tokens;
    bucket.cache_write_1h_tokens += r.tokens.cache_write_1h_tokens;
    bucket.lines += r.lines;
  }
  const counterfactualUsd = bucket.lines > 0 ? priceGroup(bucket, entry, orchestratorModel, notes).total : 0;

  if (unpricedSubagent.length > 0) {
    const excludedTokens = unpricedSubagent.reduce((acc, u) => acc + u.tokens.total, 0);
    notes.add(
      `Counterfactual excludes ${excludedTokens.toLocaleString("en-US")} subagent tokens from unpriced models ` +
        `(${unpricedSubagent.map((u) => u.model).join(", ")}) — they're missing from both the actual subagent ` +
        `subtotal and the counterfactual, so the comparison stays apples-to-apples instead of overstating the saving.`
    );
  }

  const upperBoundSavingUsd = counterfactualUsd - actualSubagentUsd;

  return {
    available: true,
    orchestratorModel,
    actualSubagentUsd,
    actualSubagentTokens,
    counterfactualUsd,
    upperBoundSavingUsd,
    caveat: UPPER_BOUND_CAVEAT,
  };
}

// ---------------------------------------------------------------------------
// Formatting (human-readable)
// ---------------------------------------------------------------------------

function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

function fmtUsd(n) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  const out = [line(headers), widths.map((w) => "-".repeat(w)).join("  ")];
  for (const r of rows) out.push(line(r));
  return out.join("\n");
}

function sectionTable(rows) {
  const headers = ["Model", "Lines", "Input", "CacheWrite", "CacheRead", "Output", "Total tok", "USD"];
  const tableRows = rows.map((r) => [
    r.model,
    fmtInt(r.lines),
    fmtInt(r.tokens.input_tokens),
    fmtInt(r.tokens.cache_write_5m_tokens + r.tokens.cache_write_1h_tokens),
    fmtInt(r.tokens.cache_read_input_tokens),
    fmtInt(r.tokens.output_tokens),
    fmtInt(r.tokens.total),
    fmtUsd(r.usd.total),
  ]);
  return renderTable(headers, tableRows);
}

// Token-only variant of sectionTable — no USD column. Used in the tokens
// section, which must stand on its own even when there's no usable pricing
// data at all (unpriced models still show up here).
function tokenTable(rows) {
  const headers = ["Model", "Lines", "Input", "CacheWrite", "CacheRead", "Output", "Total tok"];
  const tableRows = rows.map((r) => [
    r.model,
    fmtInt(r.lines),
    fmtInt(r.tokens.input_tokens),
    fmtInt(r.tokens.cache_write_5m_tokens + r.tokens.cache_write_1h_tokens),
    fmtInt(r.tokens.cache_read_input_tokens),
    fmtInt(r.tokens.output_tokens),
    fmtInt(r.tokens.total),
  ]);
  return renderTable(headers, tableRows);
}

function fmtPct(n) {
  return `${Math.round(n * 100)}%`;
}

function renderHuman(report, opts) {
  const {
    session,
    slug,
    mainTranscript,
    subagentFileCount,
    pricingPath,
    pricing,
    rows,
    unpriced,
    orchestratorSub,
    subagentSub,
    grandTotalUsd,
    grandTotalTokens,
    counterfactual,
    tokenSummary,
    notes,
    warnings,
  } = report;
  const showUsd = opts && opts.showUsd !== false;

  const out = [];
  out.push(`Session:    ${session}`);
  out.push(`Project:    ${slug}`);
  out.push(`Transcript: ${mainTranscript} (+${subagentFileCount} subagent file${subagentFileCount === 1 ? "" : "s"})`);
  out.push("");

  // -------------------------------------------------------------------
  // Tokens first. These figures are real for every plan — subscription
  // or pay-per-token — and don't depend on pricing.json coverage.
  // -------------------------------------------------------------------
  out.push("== Tokens: orchestrator (non-sidechain) ==");
  const orchestratorTokenRows = tokenSummary.perModel.filter((r) => !r.isSidechain);
  if (orchestratorTokenRows.length > 0) {
    out.push(tokenTable(orchestratorTokenRows));
  } else {
    out.push("(no orchestrator usage)");
  }
  out.push(`Subtotal: ${fmtInt(tokenSummary.orchestratorTokens)} tokens`);
  out.push("");

  out.push("== Tokens: delegated / subagents (isSidechain=true) ==");
  const delegatedTokenRows = tokenSummary.perModel.filter((r) => r.isSidechain);
  if (delegatedTokenRows.length > 0) {
    out.push(tokenTable(delegatedTokenRows));
  } else {
    out.push("(no subagent usage in this session)");
  }
  out.push(`Subtotal: ${fmtInt(tokenSummary.delegatedTokens)} tokens`);
  out.push("");

  out.push("== Premium share of delegated work ==");
  if (tokenSummary.delegatedTokens > 0) {
    out.push(
      `Premium share of delegated work: ${fmtPct(tokenSummary.premiumShare)} ` +
        `(${fmtInt(tokenSummary.premiumDelegatedTokens)} of ${fmtInt(tokenSummary.delegatedTokens)} tokens)`
    );
    out.push("Premium = opus / fable / mythos model families. sonnet and haiku are not counted as premium.");
  } else {
    out.push("n/a — no delegated (subagent) tokens in this session.");
  }
  out.push("");

  out.push("== Re-tiering candidates (token-only — no USD, no verdict) ==");
  if (tokenSummary.premiumDelegatedTokens > 0) {
    out.push(
      `${fmtInt(tokenSummary.premiumDelegatedTokens)} delegated tokens ran on a premium model:`
    );
    for (const m of tokenSummary.premiumDelegatedByModel) {
      out.push(`  - ${m.model}: ${fmtInt(m.tokens)} tokens`);
    }
    out.push("");
    out.push(
      "Candidate for re-tiering — the tool cannot tell what the work was; you can. This is a prompt for " +
        "human review of whether that delegated work needed a premium model, not a verdict that it didn't."
    );
  } else {
    out.push("None — no delegated tokens ran on a premium model in this session.");
  }
  out.push("");

  // -------------------------------------------------------------------
  // USD — subordinate section, only for consumption-billed usage.
  // -------------------------------------------------------------------
  if (showUsd) {
    out.push("== If you pay per token (API, Bedrock, Vertex, Foundry) ==");
    out.push(
      "On Claude Pro/Max/Team subscriptions, usage is included in the flat subscription fee and the dollar " +
        "figures below are not billed to you — shown here for consumption-billed users only."
    );
    out.push("");
    out.push(`Pricing: ${pricingPath} (retrieved ${pricing._retrieved || "unknown date"})`);
    out.push("");

    out.push("-- Orchestrator (non-sidechain) --");
    if (orchestratorSub.rows.length > 0) {
      out.push(sectionTable(orchestratorSub.rows));
    } else {
      out.push("(no priced orchestrator usage)");
    }
    out.push(`Subtotal: ${fmtUsd(orchestratorSub.usd)}  (${fmtInt(orchestratorSub.tokens)} tokens)`);
    out.push("");

    out.push("-- Subagents (isSidechain=true) --");
    if (subagentSub.rows.length > 0) {
      out.push(sectionTable(subagentSub.rows));
    } else {
      out.push("(no subagent usage in this session)");
    }
    out.push(`Subtotal: ${fmtUsd(subagentSub.usd)}  (${fmtInt(subagentSub.tokens)} tokens)`);
    out.push("");

    if (unpriced.length > 0) {
      out.push("-- UNPRICED (excluded from USD totals below — see reason per row) --");
      const headers = ["Model", "Sidechain", "Reason", "Total tok"];
      const tRows = unpriced.map((u) => [u.model, u.isSidechain ? "subagent" : "orchestrator", u.reason, fmtInt(u.tokens.total)]);
      out.push(renderTable(headers, tRows));
      out.push("WARNING: the tokens above are real and counted, but excluded from every USD figure in this report.");
      out.push("");
    }

    out.push("-- Grand total (priced models only) --");
    out.push(`USD:    ${fmtUsd(grandTotalUsd)}`);
    out.push(`Tokens: ${fmtInt(grandTotalTokens)}`);
    out.push("");

    out.push("-- Counterfactual: subagent tokens at the orchestrator's rate --");
    if (counterfactual.available) {
      out.push(`Orchestrator model (most non-sidechain output tokens): ${counterfactual.orchestratorModel}`);
      out.push(`Actual subagent cost (priced models):                  ${fmtUsd(counterfactual.actualSubagentUsd)}`);
      out.push(`Same subagent tokens, priced at orchestrator's rate:   ${fmtUsd(counterfactual.counterfactualUsd)}`);
      out.push(`Upper bound on saving:                                 ${fmtUsd(counterfactual.upperBoundSavingUsd)}`);
      out.push("");
      out.push(counterfactual.caveat);
    } else {
      out.push(`Not available: ${counterfactual.reason}`);
    }
    out.push("");

    if (notes.size > 0) {
      out.push("-- Notes --");
      for (const n of notes) out.push(`- ${n}`);
      out.push("");
    }

    out.push("Sources: " + (Array.isArray(pricing._sources) ? pricing._sources.join(", ") : "unknown"));
    if (pricing._disclaimer) out.push(pricing._disclaimer);
    out.push("");
  }

  if (warnings.length > 0) {
    out.push("== Warnings ==");
    for (const w of warnings) out.push(`- ${w}`);
    out.push("");
  }

  return out.join("\n").replace(/\n+$/, "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const configDir = resolveConfigDir();
  const { projectDir, slug } = resolveProjectDir(configDir, args.project, process.cwd());
  const session = resolveSession(projectDir, args.session);
  const pricingPath = args.pricing ? path.resolve(expandTilde(args.pricing)) : DEFAULT_PRICING_PATH;
  const pricing = loadPricing(pricingPath);

  const warnings = [];
  const notes = new Set();
  const groups = new Map();

  const synthMain = foldTranscript(session.path, groups, warnings, { defaultIsSidechain: false });
  const subFiles = subagentFiles(projectDir, session.uuid);
  let synthSub = 0;
  for (const f of subFiles) {
    synthSub += foldTranscript(f, groups, warnings, { defaultIsSidechain: true });
  }
  if (synthMain + synthSub > 0) {
    notes.add(`Skipped ${synthMain + synthSub} assistant line(s) with model "<synthetic>" per spec (locally-synthesized, not a real API call).`);
  }

  const { rows, unpriced } = buildReport(groups, pricing, notes);
  const orchestratorSub = subtotal(rows, false);
  const subagentSub = subtotal(rows, true);
  const grandTotalUsd = orchestratorSub.usd + subagentSub.usd;
  const grandTotalTokens = orchestratorSub.tokens + subagentSub.tokens;
  const counterfactual = buildCounterfactual(groups, rows, unpriced, pricing, notes);
  const tokenSummary = buildTokenSummary(groups);

  const report = {
    session: session.uuid,
    slug,
    mainTranscript: session.path,
    subagentFileCount: subFiles.length,
    pricingPath,
    pricing,
    rows,
    unpriced,
    orchestratorSub,
    subagentSub,
    grandTotalUsd,
    grandTotalTokens,
    counterfactual,
    tokenSummary,
    notes,
    warnings,
  };

  if (args.json) {
    // --json always emits both tokens and USD, regardless of --usd/--no-usd
    // (those flags only affect the human-readable report).
    const jsonOut = {
      session: session.uuid,
      project: slug,
      mainTranscript: session.path,
      subagentFileCount: subFiles.length,
      pricingFile: pricingPath,
      pricingRetrieved: pricing._retrieved || null,
      pricingSources: pricing._sources || [],
      byModel: rows.map((r) => ({
        model: r.model,
        isSidechain: r.isSidechain,
        lines: r.lines,
        tokens: r.tokens,
        usd: r.usd,
      })),
      unpriced,
      subtotals: {
        orchestrator: { usd: orchestratorSub.usd, tokens: orchestratorSub.tokens },
        subagent: { usd: subagentSub.usd, tokens: subagentSub.tokens },
      },
      grandTotalUsd,
      grandTotalTokens,
      counterfactual,
      tokens: {
        byModel: tokenSummary.perModel,
        orchestratorTokens: tokenSummary.orchestratorTokens,
        delegatedTokens: tokenSummary.delegatedTokens,
        premiumDelegatedTokens: tokenSummary.premiumDelegatedTokens,
        premiumShare: tokenSummary.premiumShare,
        premiumDelegatedByModel: tokenSummary.premiumDelegatedByModel,
      },
      notes: [...notes],
      warnings,
    };
    process.stdout.write(JSON.stringify(jsonOut, null, 2) + "\n");
  } else {
    process.stdout.write(renderHuman(report, { showUsd: args.usd }) + "\n");
  }
}

try {
  main();
} catch (err) {
  if (err instanceof UserError) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`Unexpected error: ${err.stack || err.message}\n`);
  process.exit(1);
}
