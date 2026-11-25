#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyAnchorIntent, classifyTargetFamily } from "./contextual_relevance.mjs";
import { normalizeSearchText } from "../runtime/lib/text-utils.mjs";

const COLUMNS = [
  "conflict_id",
  "issue_types",
  "suggested_resolution",
  "plan_file",
  "source_page_url",
  "document_url",
  "document_title",
  "paragraph_index",
  "start",
  "end",
  "anchor",
  "anchor_intent",
  "sentence",
  "target_url",
  "target_title",
  "target_type",
  "target_family",
  "evidence_tier",
  "decision",
  "selection_status",
  "score",
  "signals",
  "penalties",
  "human_choice",
  "human_note",
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function priority(row) {
  if (row.selection_status === "selected") return 1_000 + Number(row.score || 0);
  return Number(row.score || 0);
}

function candidateKey(row) {
  return [
    row.document_url,
    row.paragraph_index,
    row.start,
    row.end,
    normalizeSearchText(row.anchor),
    row.target_url,
  ].join("\u0001");
}

function overlaps(left, right) {
  return Number(left.start) < Number(right.end) && Number(right.start) < Number(left.end);
}

function issueTypes(rows) {
  const anchors = new Set(rows.map((row) => normalizeSearchText(row.anchor)));
  const targets = new Set(rows.map((row) => row.target_url));
  const families = new Set(rows.map((row) => row.target_family));
  const issues = [];
  if (anchors.size > 1) issues.push("overlapping_anchor_variants");
  if (targets.size > 1) issues.push("multiple_candidate_targets");
  if (families.size > 1) issues.push("mixed_target_families");
  return issues;
}

function suggestedResolution(rows) {
  if (rows.every((row) => row.penalties.includes("anchor_repeats_source_topic"))) return "skip_source_topic";
  if (rows.filter((row) => row.selection_status === "selected").length === 1) return "verify_selected_or_override";
  return "choose_one_row_or_skip_all";
}

export function buildConflictRows(plans) {
  const deduplicated = new Map();
  for (const { path, plan } of plans) {
    const document = plan.document || {};
    for (const item of plan.contextual_decisions || []) {
      if (!new Set(["accept", "review"]).has(item.decision)) continue;
      const targetType = item.target_type || "";
      const row = {
        plan_file: basename(path),
        source_page_url: document.source_page_url || document.page_url || "",
        document_url: document.document_url || "",
        document_title: document.title || "",
        paragraph_index: Number(item.paragraph_index),
        start: Number(item.start),
        end: Number(item.end),
        anchor: item.anchor || "",
        anchor_intent: classifyAnchorIntent(item.anchor || ""),
        sentence: item.sentence || "",
        target_url: item.target_url || "",
        target_title: item.target_title || "",
        target_type: targetType,
        target_family: classifyTargetFamily({
          url: item.target_url || "",
          page_type_label: targetType,
        }),
        evidence_tier: item.evidence_tier || "",
        decision: item.decision || "",
        selection_status: item.selection_status || "",
        score: Number(item.score || 0),
        signals: item.signals || [],
        penalties: item.penalties || [],
      };
      const key = candidateKey(row);
      const previous = deduplicated.get(key);
      if (!previous || priority(row) > priority(previous)) deduplicated.set(key, row);
    }
  }

  const byParagraph = new Map();
  for (const row of deduplicated.values()) {
    const key = `${row.document_url}\u0001${row.paragraph_index}`;
    if (!byParagraph.has(key)) byParagraph.set(key, []);
    byParagraph.get(key).push(row);
  }

  const conflicts = [];
  let groupNumber = 0;
  for (const rows of byParagraph.values()) {
    rows.sort((left, right) => left.start - right.start || right.end - left.end || right.score - left.score);
    const components = [];
    for (const row of rows) {
      const component = components.at(-1);
      if (!component || !component.some((existing) => overlaps(existing, row))) components.push([row]);
      else component.push(row);
    }
    for (const component of components) {
      const issues = issueTypes(component);
      if (!issues.length) continue;
      groupNumber += 1;
      const conflictId = `C${String(groupNumber).padStart(3, "0")}`;
      const resolution = suggestedResolution(component);
      component
        .sort((left, right) => left.start - right.start || right.score - left.score || left.target_url.localeCompare(right.target_url))
        .forEach((row) => conflicts.push({
          conflict_id: conflictId,
          issue_types: issues.join(" | "),
          suggested_resolution: resolution,
          ...row,
          signals: row.signals.join(" | "),
          penalties: row.penalties.join(" | "),
          human_choice: "",
          human_note: "",
        }));
    }
  }
  return conflicts;
}

export function conflictCsv(rows) {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) lines.push(COLUMNS.map((column) => csvCell(row[column])).join(","));
  return `\uFEFF${lines.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : "";
  const paths = args.filter((value, index) => value !== "--out" && index !== outIndex + 1);
  if (!out || !paths.length) {
    throw new Error("Usage: export_contextual_conflicts.mjs --out <conflicts.csv> <plan.json> [...]");
  }
  const plans = paths.map((path) => ({
    path: resolve(path),
    plan: JSON.parse(readFileSync(resolve(path), "utf8")),
  }));
  const rows = buildConflictRows(plans);
  writeFileSync(resolve(out), conflictCsv(rows), "utf8");
  process.stdout.write(`${JSON.stringify({
    plans: plans.length,
    conflicts: new Set(rows.map((row) => row.conflict_id)).size,
    rows: rows.length,
  })}\n`);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}
