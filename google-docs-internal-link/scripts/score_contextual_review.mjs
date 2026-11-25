#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CRITICAL_REASONS = new Set(["wrong_context", "wrong_target", "source_topic_repeat"]);

export function parseCsv(text) {
  const records = [];
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
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      records.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    records.push(row);
  }
  if (!records.length) return [];
  const headers = records[0];
  return records.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])),
  );
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

export function scoreReviewRows(rows) {
  const normalized = rows.map((row) => ({
    ...row,
    human_verdict: String(row.human_verdict || "").trim().toLowerCase(),
    human_reason: String(row.human_reason || "").trim().toLowerCase(),
  }));
  const selected = normalized.filter((row) => row.selection_status === "selected");
  const selectedKept = selected.filter((row) => row.human_verdict === "keep").length;
  const selectedRemoved = selected.filter((row) => row.human_verdict === "remove").length;
  const selectedUncertain = selected.filter((row) => row.human_verdict === "uncertain").length;
  const selectedUnlabeled = selected.length - selectedKept - selectedRemoved - selectedUncertain;
  const criticalErrors = selected.filter(
    (row) => row.human_verdict === "remove" && CRITICAL_REASONS.has(row.human_reason),
  );

  const review = normalized.filter(
    (row) => row.decision === "review" && row.selection_status !== "selected",
  );
  const reviewKept = review.filter((row) => row.human_verdict === "keep").length;
  const reviewRemoved = review.filter((row) => row.human_verdict === "remove").length;
  const selectedLabeled = selectedKept + selectedRemoved;
  const selectedPrecision = rate(selectedKept, selectedLabeled);
  const ready = selectedLabeled >= 30 && selectedPrecision >= 0.9 && criticalErrors.length === 0;

  return {
    schema_version: 1,
    selected: {
      total: selected.length,
      kept: selectedKept,
      removed: selectedRemoved,
      uncertain: selectedUncertain,
      unlabeled: selectedUnlabeled,
      precision: selectedPrecision,
      critical_error_count: criticalErrors.length,
      critical_errors: criticalErrors.map((row) => ({
        document_url: row.document_url,
        anchor: row.anchor,
        target_url: row.target_url,
        human_reason: row.human_reason,
      })),
    },
    review: {
      total: review.length,
      kept: reviewKept,
      removed: reviewRemoved,
      uncertain: review.filter((row) => row.human_verdict === "uncertain").length,
      unlabeled: review.filter((row) => !row.human_verdict).length,
      promotion_rate: rate(reviewKept, reviewKept + reviewRemoved),
    },
    release_check: {
      minimum_labeled_selected: 30,
      minimum_selected_precision: 0.9,
      maximum_critical_selected_errors: 0,
      status: selectedLabeled < 30 ? "insufficient_labels" : ready ? "pass" : "fail",
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const input = args[0];
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : "";
  if (!input || input.startsWith("--") || (outIndex >= 0 && !out)) {
    throw new Error("Usage: score_contextual_review.mjs <review.csv> [--out <report.json>]");
  }
  const result = scoreReviewRows(parseCsv(readFileSync(resolve(input), "utf8")));
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (out) writeFileSync(resolve(out), output, "utf8");
  process.stdout.write(output);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}
