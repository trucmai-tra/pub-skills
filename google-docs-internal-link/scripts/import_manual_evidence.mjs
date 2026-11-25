#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeUrl } from "./plan_links.mjs";
import { normalizeAnchorText } from "../runtime/lib/text-utils.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(here, "../runtime");
const HISTORY_COLUMNS = [
  "source_run",
  "source_slug",
  "source_url",
  "target_url",
  "anchor",
  "link_source",
  "target_title",
  "target_type",
  "target_was_in_source_scope",
  "target_is_scope",
  "paragraph",
  "source_target_occurrences",
  "audit_flags",
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])),
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(path, rows) {
  const lines = [HISTORY_COLUMNS.join(",")];
  for (const row of rows) lines.push(HISTORY_COLUMNS.map((column) => csvCell(row[column])).join(","));
  writeFileSync(path, `\uFEFF${lines.join("\n")}\n`, "utf8");
}

function evidenceKey(sourceUrl, targetUrl, anchor) {
  return [canonicalizeUrl(sourceUrl), canonicalizeUrl(targetUrl), normalizeAnchorText(anchor)].join("\u0001");
}

function requireCanvaVnUrl(value, label) {
  const canonical = canonicalizeUrl(value);
  if (!canonical.startsWith("https://www.canva.com/vi_vn/")) throw new Error(`${label} must be a Canva /vi_vn/ URL: ${value}`);
  return canonical;
}

function parseArgs(argv) {
  const args = { dryRun: false, sourceRun: "manual-doc-calibration" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") args.input = argv[++index];
    else if (value === "--history") args.history = argv[++index];
    else if (value === "--repo-root") args.repoRoot = argv[++index];
    else if (value === "--source-run") args.sourceRun = argv[++index];
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--import-confirmed-removals") args.importRemovals = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.input) throw new Error("Usage: import_manual_evidence.mjs --input <manual-link-evidence.json> [--dry-run]");
  return args;
}

export function importManualEvidence(manifest, options = {}) {
  if (manifest?.contract !== "canva.internal-link-calibration.v1") {
    throw new Error("Expected canva.internal-link-calibration.v1 input");
  }
  const repoRoot = resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const historyPath = resolve(options.historyPath || resolve(repoRoot, "data/internal-links.csv"));
  const candidatesPath = resolve(repoRoot, "data/candidates.json");
  const existingText = readFileSync(historyPath, "utf8");
  const existingRows = parseCsv(existingText);
  const candidatePayload = JSON.parse(readFileSync(candidatesPath, "utf8"));
  const candidateByUrl = new Map((candidatePayload.candidates || []).map((candidate) => [canonicalizeUrl(candidate.url), candidate]));
  const existingKeys = new Set(existingRows.filter((row) => row.link_source === "manual").map((row) =>
    evidenceKey(row.source_url, row.target_url, row.anchor),
  ));
  const inputKeys = new Set();
  const inputTargetUrls = new Set();
  const additions = [];
  let duplicateInput = 0;
  let alreadyRecorded = 0;
  let heldForReview = 0;

  for (const document of manifest.documents || []) {
    const sourceUrl = requireCanvaVnUrl(document.source_url, "source_url");
    const observed = (document.current_links || []).filter((link) => link.evidence_label === "reviewer_added");
    for (const link of observed) {
      if (manifest.calibration_mode === "revision_diff" && (
        !manifest.baseline_run || !document.baseline_revision || !document.current_revision ||
        link.provenance !== "post_run_snapshot_diff" || !["added", "retargeted"].includes(link.change)
      )) throw new Error(`Row ${document.row}: revision evidence requires a verified baseline diff`);
    }
    heldForReview += observed.filter((link) => link.learning_status === "hold").length;
    const links = observed.filter((link) => link.learning_status !== "hold");
    const targetCounts = new Map();
    for (const link of links) {
      const targetUrl = requireCanvaVnUrl(link.target_url, "target_url");
      targetCounts.set(targetUrl, (targetCounts.get(targetUrl) || 0) + 1);
    }
    for (const link of links) {
      const targetUrl = requireCanvaVnUrl(link.target_url, "target_url");
      const anchor = String(link.anchor || "").trim();
      inputTargetUrls.add(targetUrl);
      if (!anchor) throw new Error(`Blank anchor in row ${document.row}`);
      const key = evidenceKey(sourceUrl, targetUrl, anchor);
      if (inputKeys.has(key)) {
        duplicateInput += 1;
        continue;
      }
      inputKeys.add(key);
      if (existingKeys.has(key)) {
        alreadyRecorded += 1;
        continue;
      }
      const candidate = candidateByUrl.get(targetUrl);
      additions.push({
        source_run: options.sourceRun || "manual-doc-calibration",
        source_slug: document.source_slug || "",
        source_url: sourceUrl,
        target_url: targetUrl,
        anchor,
        link_source: "manual",
        target_title: candidate?.title || "",
        target_type: candidate?.page_type_label || candidate?.page_type || "",
        target_was_in_source_scope: "false",
        target_is_scope: candidate?.is_scope ? "true" : "false",
        paragraph: Number.isInteger(link.paragraph_index) ? link.paragraph_index : "",
        source_target_occurrences: targetCounts.get(targetUrl) || 1,
        audit_flags: candidate ? "manual_doc_calibration" : "manual_doc_calibration;target_missing_from_candidate_pool",
      });
    }
  }

  additions.sort((a, b) => a.source_slug.localeCompare(b.source_slug) || Number(a.paragraph || 0) - Number(b.paragraph || 0));
  const missingTargets = [...inputTargetUrls].filter((targetUrl) => !candidateByUrl.has(targetUrl)).sort();
  let feedbackPath = null;
  let feedback = [];
  const removals = [];
  if (options.importRemovals) {
    if (manifest.calibration_mode !== "revision_diff" || !manifest.baseline_run) {
      throw new Error("Removal import requires revision_diff with a saved baseline");
    }
    feedbackPath = resolve(repoRoot, "data/link_feedback.json");
    feedback = JSON.parse(readFileSync(feedbackPath, "utf8"));
    const keys = new Set(feedback.filter((e) => e.action === "removed").map((e) => evidenceKey(e.page_url, e.target_url, e.anchor)));
    for (const document of manifest.documents || []) {
      if (!document.baseline_revision || !document.current_revision) throw new Error("Removal evidence requires both revisions");
      const sourceUrl = requireCanvaVnUrl(document.source_url, "source_url");
      for (const link of document.removed_links || []) {
        if (!link.removal_confirmed || link.reason !== "unchanged_paragraph") continue;
        const targetUrl = requireCanvaVnUrl(link.target_url, "target_url");
        const anchor = String(link.anchor || "").trim();
        if (!anchor) throw new Error("Removal evidence requires a nonblank anchor");
        const key = evidenceKey(sourceUrl, targetUrl, anchor);
        // A moved occurrence is not a removed source-anchor-target pair.
        if ((document.current_links || []).some((l) => evidenceKey(sourceUrl, l.target_url, l.anchor) === key)) {
          throw new Error("Removal pair still exists in the current body");
        }
        if (keys.has(key)) continue;
        keys.add(key);
        removals.push({ action: "removed", target_url: targetUrl, anchor, page_url: sourceUrl,
          page_slug: document.source_slug || "", at: new Date().toISOString(),
          source_run: options.sourceRun || "manual-doc-calibration", source: "manual_revision_diff" });
      }
    }
  }
  if (!options.dryRun && additions.length) writeCsv(historyPath, [...existingRows, ...additions]);
  if (!options.dryRun && removals.length) writeFileSync(feedbackPath, `${JSON.stringify([...feedback, ...removals], null, 2)}\n`, "utf8");
  return {
    history_path: historyPath,
    dry_run: Boolean(options.dryRun),
    input_documents: manifest.documents?.length || 0,
    distinct_input_pairs: inputKeys.size,
    duplicate_input_pairs: duplicateInput,
    already_recorded: alreadyRecorded,
    held_for_review: heldForReview,
    confirmed_removals_added: removals.length,
    added: additions.length,
    missing_candidate_targets: missingTargets,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(args.repoRoot || DEFAULT_REPO_ROOT);
  const manifest = JSON.parse(readFileSync(resolve(args.input), "utf8"));
  const result = importManualEvidence(manifest, {
    repoRoot,
    historyPath: args.history,
    sourceRun: args.sourceRun,
    dryRun: args.dryRun,
    importRemovals: args.importRemovals,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
