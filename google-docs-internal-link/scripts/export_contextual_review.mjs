#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COLUMNS = [
  "plan_file",
  "source_page_url",
  "document_url",
  "document_title",
  "paragraph_index",
  "start",
  "anchor",
  "sentence",
  "target_url",
  "target_title",
  "evidence_tier",
  "decision",
  "selection_status",
  "score",
  "signals",
  "penalties",
  "human_verdict",
  "human_reason",
];

const VALID_GROUPS = new Set(["selected", "review", "reject", "accepted_unselected"]);

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function decisionGroup(item) {
  if (item.selection_status === "selected") return "selected";
  if (item.decision === "review") return "review";
  if (item.decision === "reject") return "reject";
  return "accepted_unselected";
}

function rowKey(row) {
  return [
    row.document_url,
    row.paragraph_index,
    row.start,
    row.anchor.toLocaleLowerCase("vi"),
  ].join("\u0001");
}

function rowPriority(row) {
  if (row.selection_status === "selected") return 1_000 + Number(row.score || 0);
  if (row.decision === "review") return 500 + Number(row.score || 0);
  if (row.decision === "accept") return 250 + Number(row.score || 0);
  return Number(row.score || 0);
}

export function buildReviewRows(plans, includeGroups = new Set(["selected", "review"])) {
  const deduplicated = new Map();
  for (const { path, plan } of plans) {
    const document = plan.document || {};
    for (const item of plan.contextual_decisions || []) {
      if (!includeGroups.has(decisionGroup(item))) continue;
      const row = {
        plan_file: basename(path),
        source_page_url: document.source_page_url || document.page_url || "",
        document_url: document.document_url || "",
        document_title: document.title || "",
        paragraph_index: item.paragraph_index,
        start: item.start,
        anchor: item.anchor || "",
        sentence: item.sentence || "",
        target_url: item.target_url || "",
        target_title: item.target_title || "",
        evidence_tier: item.evidence_tier || "",
        decision: item.decision || "",
        selection_status: item.selection_status || "",
        score: item.score,
        signals: (item.signals || []).join(" | "),
        penalties: (item.penalties || []).join(" | "),
        human_verdict: "",
        human_reason: "",
      };
      const key = rowKey(row);
      const previous = deduplicated.get(key);
      if (!previous || rowPriority(row) > rowPriority(previous)) deduplicated.set(key, row);
    }
  }
  return [...deduplicated.values()].sort((left, right) =>
    left.document_title.localeCompare(right.document_title, "vi") ||
    Number(left.paragraph_index) - Number(right.paragraph_index) ||
    Number(left.start) - Number(right.start) ||
    left.anchor.localeCompare(right.anchor, "vi") ||
    left.target_url.localeCompare(right.target_url),
  );
}

export function reviewCsv(rows) {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) lines.push(COLUMNS.map((column) => csvCell(row[column])).join(","));
  return `\uFEFF${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { include: new Set(["selected", "review"]), plans: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--out") args.out = argv[++index];
    else if (value === "--include") {
      args.include = new Set(String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean));
    } else if (value.startsWith("--")) throw new Error(`Unknown argument: ${value}`);
    else args.plans.push(value);
  }
  if (!args.out || !args.plans.length) {
    throw new Error(
      "Usage: export_contextual_review.mjs --out <review.csv> [--include selected,review] <plan.json> [...]",
    );
  }
  for (const group of args.include) {
    if (!VALID_GROUPS.has(group)) throw new Error(`Unknown review group: ${group}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plans = args.plans.map((path) => ({
    path: resolve(path),
    plan: JSON.parse(readFileSync(resolve(path), "utf8")),
  }));
  const rows = buildReviewRows(plans, args.include);
  writeFileSync(resolve(args.out), reviewCsv(rows), "utf8");
  const counts = Object.fromEntries([...VALID_GROUPS].map((group) => [group, 0]));
  for (const row of rows) counts[decisionGroup(row)] += 1;
  process.stdout.write(`${JSON.stringify({ plans: plans.length, rows: rows.length, counts })}\n`);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}
