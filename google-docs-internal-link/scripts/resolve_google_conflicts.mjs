#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAnchorText } from "../runtime/lib/text-utils.mjs";
import { buildConflictRows } from "./export_contextual_conflicts.mjs";
import { isHardSkipCandidate } from "./contextual_relevance.mjs";
import { canonicalizeUrl, validatePlan } from "./plan_links.mjs";

const VALID_CHOICES = new Set(["use", "skip", "hold", "review"]);

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function paragraphList(plain) {
  return String(plain || "")
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sentenceIndex(paragraph, offset) {
  let start = 0;
  let index = 0;
  for (const match of paragraph.matchAll(/[.!?…]+(?:\s+|$)/g)) {
    const end = match.index + match[0].length;
    if (start <= offset && offset < end) return index;
    start = end;
    index += 1;
  }
  return start <= offset && offset <= paragraph.length ? index : -1;
}

function exactMatchIndex(paragraphs, chosenParagraph, chosenStart, anchor) {
  let count = 0;
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    let from = 0;
    for (;;) {
      const found = paragraph.indexOf(anchor, from);
      if (found === -1) break;
      count += 1;
      if (paragraphIndex === chosenParagraph && found === chosenStart) return count;
      from = found + Math.max(1, anchor.length);
    }
  }
  return null;
}

function locatorForDecision(decision, paragraphs) {
  const paragraphIndex = Number(decision.paragraph_index);
  const start = Number(decision.start);
  const end = Number(decision.end);
  const paragraph = paragraphs[paragraphIndex] || "";
  return {
    paragraph_index: paragraphIndex,
    start,
    end,
    prefix: paragraph.slice(Math.max(0, start - 48), start),
    suffix: paragraph.slice(end, Math.min(paragraph.length, end + 48)),
    match_index: exactMatchIndex(paragraphs, paragraphIndex, start, decision.anchor),
    match_index_scope: "planner_plain_text",
    paragraph_fingerprint: sha256(paragraph),
  };
}

function candidateKey(item, documentUrl = "") {
  const locator = item.locator || {};
  return [
    item.document_url || documentUrl,
    Number(item.paragraph_index ?? locator.paragraph_index),
    Number(item.start ?? locator.start),
    Number(item.end ?? locator.end),
    normalizeAnchorText(item.anchor),
    canonicalizeUrl(item.target_url),
  ].join("\u0001");
}

function overlaps(left, right) {
  return Number(left.start) < Number(right.end) && Number(right.start) < Number(left.end);
}

function decisionForRow(plan, row) {
  const documentUrl = plan.document?.document_url || "";
  const key = candidateKey(row);
  const matches = (plan.contextual_decisions || []).filter(
    (decision) => candidateKey(decision, documentUrl) === key,
  );
  if (!matches.length) return null;
  return matches.find((decision) => decision.evidence_tier === row.evidence_tier) || matches[0];
}

function placementForDecision(plan, decision, paragraphs) {
  const acceptThreshold = Number(plan.policy?.contextual_relevance?.accept_threshold || 55);
  const reviewThreshold = Number(plan.policy?.contextual_relevance?.review_threshold || 30);
  return {
    anchor: decision.anchor,
    anchor_normalized: normalizeAnchorText(decision.anchor),
    target_url: decision.target_url,
    target_url_normalized: canonicalizeUrl(decision.target_url),
    target_title: decision.target_title || "",
    target_type: decision.target_type || "",
    evidence_tier: decision.evidence_tier || "",
    contextual_relevance: {
      version: Number(plan.policy?.contextual_relevance?.version || 1),
      decision: decision.decision,
      score: Number(decision.score),
      thresholds: { accept: acceptThreshold, review: reviewThreshold },
      signals: decision.signals || [],
      penalties: decision.penalties || [],
      metrics: decision.metrics || {},
    },
    locator: locatorForDecision(decision, paragraphs),
  };
}

function groupChoice(rows) {
  const values = new Set(rows.map((row) => row.serp_group_choice));
  for (const value of values) {
    if (!VALID_CHOICES.has(value)) throw new Error(`Invalid Google group choice: ${value || "<blank>"}`);
  }
  const useRows = rows.filter((row) => row.serp_group_choice === "use");
  if (useRows.length > 1) throw new Error(`${rows[0].conflict_id} has more than one use row`);
  if (useRows.length === 1) {
    if (rows.some((row) => !new Set(["use", "skip"]).has(row.serp_group_choice))) {
      throw new Error(`${rows[0].conflict_id} mixes use with an unresolved choice`);
    }
    const useRow = useRows[0];
    if (
      useRow.serp_row_status !== "google_first_eligible" ||
      useRow.serp_family_eligible !== "yes" ||
      useRow.serp_semantic_eligible !== "yes" ||
      useRow.serp_target_in_bank !== "yes" ||
      canonicalizeUrl(useRow.target_url) !== canonicalizeUrl(useRow.serp_google_priority_url) ||
      !useRow.serp_query ||
      !useRow.serp_checked_at
    ) {
      throw new Error(`${rows[0].conflict_id} has an invalid Google use row`);
    }
    return "use";
  }
  if (values.size !== 1) throw new Error(`${rows[0].conflict_id} has inconsistent group choices`);
  return [...values][0];
}

function constraintReason(plan, placement, placements, paragraphs) {
  const target = canonicalizeUrl(placement.target_url);
  const anchor = normalizeAnchorText(placement.anchor);
  const locator = placement.locator;
  const paragraph = paragraphs[locator.paragraph_index];
  const pageUrl = canonicalizeUrl(plan.document?.source_page_url || "");
  const retired = new Set((plan.sources?.retired_targets || []).map(canonicalizeUrl).filter(Boolean));
  const preservedTargets = new Set((plan.preserved_links || []).map((item) => canonicalizeUrl(item.target_url)).filter(Boolean));
  const preservedAnchors = new Set((plan.preserved_links || []).map((item) => normalizeAnchorText(item.anchor)).filter(Boolean));
  if (!target) return "invalid_target";
  if (retired.has(target)) return "retired_target";
  if (pageUrl && target === pageUrl) return "self_link";
  if (placement.contextual_relevance?.decision !== "accept") return "non_accept";
  if (paragraph === undefined) return "stale_locator";
  if (paragraph.slice(locator.start, locator.end) !== placement.anchor) return "stale_locator";
  if (isHardSkipCandidate({
    visible_anchor: placement.anchor,
    paragraph,
    start: locator.start,
    end: locator.end,
  })) return "hard_skip_anchor";
  if (preservedTargets.has(target) || placements.some((item) => canonicalizeUrl(item.target_url) === target)) {
    return "duplicate_target";
  }
  if (preservedAnchors.has(anchor) || placements.some((item) => normalizeAnchorText(item.anchor) === anchor)) {
    return "duplicate_anchor";
  }
  if (placements.length >= Number(plan.policy?.max_auto_links || 12)) return "plan_limit";
  const sameParagraph = placements.filter(
    (item) => Number(item.locator?.paragraph_index) === Number(locator.paragraph_index),
  );
  if (sameParagraph.length >= Number(plan.policy?.max_per_paragraph || 2)) return "paragraph_limit";
  const candidateSentence = sentenceIndex(paragraph, locator.start);
  if (sameParagraph.some((item) => sentenceIndex(paragraph, item.locator.start) === candidateSentence)) {
    return "sentence_limit";
  }
  if (sameParagraph.some((item) => overlaps(item.locator, locator))) return "overlap";
  const protectedIndexes = new Set((plan.document?.protected_paragraphs || []).map((item) => Number(item.paragraph_index)));
  if (protectedIndexes.has(Number(locator.paragraph_index))) return "protected_content";
  if (locator.match_index === null || sha256(paragraph) !== locator.paragraph_fingerprint) return "stale_locator";
  return "";
}

function resolutionForRow(row, planAction, reason) {
  return {
    conflict_id: row.conflict_id,
    suggestion: row.serp_group_choice,
    plan_action: planAction,
    reason,
    query: row.serp_query || "",
    checked_at: row.serp_checked_at || "",
    google_priority_url: row.serp_google_priority_url || "",
    google_priority_rank: row.serp_google_priority_rank || "",
    group_note: row.serp_group_note || "",
  };
}

function addSkipped(skipped, item) {
  const key = [item.conflict_id || "", item.reason || "", normalizeAnchorText(item.anchor), canonicalizeUrl(item.target_url)].join("\u0001");
  if (skipped.some((existing) => [
    existing.conflict_id || "",
    existing.reason || "",
    normalizeAnchorText(existing.anchor),
    canonicalizeUrl(existing.target_url),
  ].join("\u0001") === key)) return;
  skipped.push(item);
}

export function resolvePlanWithGoogle(planInput, csvRows, options = {}) {
  const plan = structuredClone(planInput);
  const planFile = options.planFile || "plan.json";
  const documentUrl = plan.document?.document_url || "";
  const expectedRows = buildConflictRows([{ path: planFile, plan }]);
  const expectedKeys = new Set(expectedRows.map((row) => candidateKey(row)));
  const basenameMatch = basename(planFile);
  const rows = csvRows.filter((row) => (
    row.plan_file === basenameMatch || (row.document_url && row.document_url === documentUrl)
  ));
  const actualKeys = new Set(rows.map((row) => candidateKey(row)));
  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
  const stale = [...actualKeys].filter((key) => !expectedKeys.has(key));
  if (missing.length || stale.length) {
    throw new Error(`Google conflict CSV does not match the plan: ${missing.length} missing and ${stale.length} stale candidate rows`);
  }
  if (actualKeys.size !== rows.length) throw new Error("Google conflict CSV contains duplicate candidate rows for this plan");
  const expectedByKey = new Map(expectedRows.map((row) => [candidateKey(row), row]));
  for (const row of rows) {
    const expected = expectedByKey.get(candidateKey(row));
    if (row.decision !== expected.decision || Number(row.score) !== Number(expected.score)) {
      throw new Error(`Google conflict CSV has stale contextual evidence for ${row.conflict_id}`);
    }
  }

  const byGroup = new Map();
  for (const row of rows) {
    if (!row.conflict_id) throw new Error("Google conflict row is missing conflict_id");
    if (!byGroup.has(row.conflict_id)) byGroup.set(row.conflict_id, []);
    byGroup.get(row.conflict_id).push(row);
  }

  const conflictKeys = new Set(rows.map((row) => candidateKey(row)));
  const originalPlacements = plan.placements || [];
  const originalPlacementKeys = new Set(originalPlacements.map((item) => candidateKey(item, documentUrl)));
  const placements = originalPlacements.filter((item) => !conflictKeys.has(candidateKey(item, documentUrl)));
  const removedPlacements = originalPlacements.filter((item) => conflictKeys.has(candidateKey(item, documentUrl)));
  const skipped = [...(plan.skipped || [])];
  const paragraphs = paragraphList(plan.document?.plain_text || "");
  const groups = [];

  const orderedGroups = [...byGroup.entries()]
    .map(([conflictId, groupRows]) => ({
      conflictId,
      rows: groupRows,
      choice: groupChoice(groupRows),
      hadPlacement: groupRows.some((row) => originalPlacementKeys.has(candidateKey(row))),
    }))
    .sort((left, right) => Number(right.hadPlacement) - Number(left.hadPlacement) || left.conflictId.localeCompare(right.conflictId));

  for (const group of orderedGroups) {
    const useRow = group.rows.find((row) => row.serp_group_choice === "use");
    const suggested = group.choice;
    let outcome = `${suggested}_skipped`;
    let appliedKey = "";
    let blockedReason = suggested;

    if (useRow) {
      const decision = decisionForRow(plan, useRow);
      if (!decision) throw new Error(`${group.conflictId} use row does not map to a contextual decision`);
      if (decision.decision !== "accept" || useRow.decision !== "accept") {
        blockedReason = "non_accept";
        outcome = "use_blocked";
      } else {
        const placement = placementForDecision(plan, decision, paragraphs);
        blockedReason = constraintReason(plan, placement, placements, paragraphs);
        if (!blockedReason) {
          placements.push(placement);
          appliedKey = candidateKey(useRow);
          outcome = "use_applied";
          decision.selection_status = "selected";
          decision.serp_resolution = resolutionForRow(useRow, "apply", "google_priority");
        } else {
          outcome = "use_blocked";
          decision.selection_status = `not_selected_google_${blockedReason}`;
          decision.serp_resolution = resolutionForRow(useRow, "skip", blockedReason);
          addSkipped(skipped, {
            anchor: decision.anchor,
            target_url: decision.target_url,
            evidence_tier: decision.evidence_tier,
            conflict_id: group.conflictId,
            reason: `google_conflict_${blockedReason}`,
          });
        }
      }
    }

    for (const row of group.rows) {
      const key = candidateKey(row);
      const decision = decisionForRow(plan, row);
      if (!decision) throw new Error(`${group.conflictId} row does not map to a contextual decision`);
      if (key === appliedKey) continue;
      const reason = row.serp_group_choice === "use" ? blockedReason : (
        suggested === "use" ? "google_alternative" : suggested
      );
      decision.selection_status = `not_selected_google_${reason}`;
      decision.serp_resolution = resolutionForRow(row, "skip", reason);
      const removed = removedPlacements.find((item) => candidateKey(item, documentUrl) === key);
      if (removed) {
        addSkipped(skipped, {
          anchor: removed.anchor,
          target_url: removed.target_url,
          evidence_tier: removed.evidence_tier,
          conflict_id: group.conflictId,
          reason: `google_conflict_${reason}`,
        });
      }
    }

    groups.push({
      conflict_id: group.conflictId,
      suggestion: suggested,
      outcome,
      applied_anchor: useRow && appliedKey ? useRow.anchor : "",
      applied_target_url: useRow && appliedKey ? useRow.target_url : "",
      blocked_reason: outcome === "use_blocked" ? blockedReason : "",
      query: group.rows[0].serp_query || "",
      note: group.rows[0].serp_group_note || "",
    });
  }

  placements.sort((left, right) => (
    Number(left.locator?.paragraph_index) - Number(right.locator?.paragraph_index) ||
    Number(left.locator?.start) - Number(right.locator?.start) ||
    left.target_url.localeCompare(right.target_url)
  ));
  const counts = Object.fromEntries([
    "use_applied",
    "use_blocked",
    "skip_skipped",
    "hold_skipped",
    "review_skipped",
  ].map((status) => [status, groups.filter((group) => group.outcome === status).length]));

  plan.generated_at = new Date().toISOString();
  plan.placements = placements;
  plan.skipped = skipped;
  plan.policy = {
    ...(plan.policy || {}),
    google_conflict_resolution: {
      enabled: true,
      required_for_application: true,
      unresolved_behavior: "skip",
      google_cannot_promote_review: true,
    },
  };
  plan.google_conflict_resolution = {
    version: 1,
    source_csv: options.sourceCsv || "",
    resolved_at: new Date().toISOString(),
    application_ready: true,
    conflict_rows: rows.length,
    groups_total: groups.length,
    counts,
    editorial_follow_up_groups: groups
      .filter((group) => new Set(["hold_skipped", "review_skipped", "use_blocked"]).has(group.outcome))
      .map((group) => group.conflict_id),
    groups,
  };
  plan.stats = {
    ...(plan.stats || {}),
    planned: placements.length,
    skipped: skipped.length,
    google_conflict_groups: groups.length,
    google_conflict_use_applied: counts.use_applied,
    google_conflict_use_blocked: counts.use_blocked,
    google_conflict_skipped: counts.skip_skipped,
    google_conflict_hold_skipped: counts.hold_skipped,
    google_conflict_review_skipped: counts.review_skipped,
  };

  const validation = validateApplicationPlan(plan);
  if (!validation.ok) throw new Error(`Resolved plan failed validation:\n${validation.errors.join("\n")}`);
  return plan;
}

export function validateApplicationPlan(plan) {
  const base = validatePlan(plan);
  const errors = [...base.errors];
  const rows = buildConflictRows([{ path: "plan.json", plan }]);
  if (!rows.length) return { ok: errors.length === 0, errors, warnings: base.warnings };
  if (!plan.google_conflict_resolution?.application_ready) {
    errors.push("Google conflict resolution is required before application");
    return { ok: false, errors, warnings: base.warnings };
  }
  const decisions = plan.contextual_decisions || [];
  const documentUrl = plan.document?.document_url || "";
  const placements = new Set((plan.placements || []).map((item) => candidateKey(item, documentUrl)));
  const byGroup = new Map();
  for (const row of rows) {
    const matching = decisions.filter((item) => candidateKey(item, documentUrl) === candidateKey(row));
    const decision = matching.find((item) => item.serp_resolution) || matching[0];
    const resolution = decision?.serp_resolution;
    if (!resolution || !new Set(["apply", "skip"]).has(resolution.plan_action)) {
      errors.push(`Conflict candidate ${row.conflict_id} lacks a final Google plan action`);
      continue;
    }
    if (!byGroup.has(resolution.conflict_id)) byGroup.set(resolution.conflict_id, []);
    byGroup.get(resolution.conflict_id).push({ decision, resolution });
    const isPlaced = placements.has(candidateKey(row));
    if (resolution.plan_action === "apply" && !isPlaced) {
      errors.push(`${resolution.conflict_id} marks a candidate apply but it is not in placements`);
    }
    if (resolution.plan_action === "skip" && isPlaced) {
      errors.push(`${resolution.conflict_id} keeps a candidate whose final action is skip`);
    }
    if (resolution.plan_action === "apply" && (resolution.suggestion !== "use" || decision.decision !== "accept")) {
      errors.push(`${resolution.conflict_id} applies a candidate without an accepted Google use decision`);
    }
  }
  for (const [conflictId, items] of byGroup) {
    if (items.filter((item) => item.resolution.plan_action === "apply").length > 1) {
      errors.push(`${conflictId} applies more than one conflict candidate`);
    }
  }
  if (Number(plan.google_conflict_resolution.groups_total) !== byGroup.size) {
    errors.push("Google conflict group count does not match the resolved decisions");
  }
  return { ok: errors.length === 0, errors, warnings: base.warnings };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--plan") args.plan = argv[++index];
    else if (value === "--serp-csv") args.serpCsv = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.plan || !args.serpCsv || !args.out) {
    throw new Error("Usage: resolve_google_conflicts.mjs --plan <plan.json> --serp-csv <priority.csv> --out <resolved-plan.json>");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = resolve(args.plan);
  const csvPath = resolve(args.serpCsv);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const resolved = resolvePlanWithGoogle(plan, rows, {
    planFile: planPath,
    sourceCsv: csvPath,
  });
  writeFileSync(resolve(args.out), `${JSON.stringify(resolved, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    out: resolve(args.out),
    placements: resolved.placements.length,
    ...resolved.google_conflict_resolution.counts,
    editorial_follow_up_groups: resolved.google_conflict_resolution.editorial_follow_up_groups,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
