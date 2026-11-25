import assert from "node:assert/strict";

import { buildConflictRows } from "./export_contextual_conflicts.mjs";
import { createPlan } from "./plan_links.mjs";
import { resolvePlanWithGoogle, validateApplicationPlan } from "./resolve_google_conflicts.mjs";

function buildAmbiguousPlan() {
  return createPlan(
    {
      document_url: "https://docs.google.com/document/d/test/edit",
      page_url: "https://www.canva.com/vi_vn/thiet-ke/logo/",
      main_keywords: ["logo"],
      format: "plain",
      content: "Chia sẻ thiết kế trên mạng xã hội phù hợp.",
    },
    {
      candidatePayload: {
        generated_at: "2026-09-07T00:00:00Z",
        candidates: [
          {
            url: "https://www.canva.com/vi_vn/thiet-ke/hinh-anh-cho-mang-xa-hoi/",
            title: "Ảnh đồ hoạ cho mạng xã hội",
            page_type: "create",
            page_type_label: "Create",
            is_scope: true,
            ytd_logged_out_sessions: 100,
            main_keywords: ["mạng xã hội"],
            anchors: [{ text: "mạng xã hội", source: "keyword", role: "Main" }],
          },
          {
            url: "https://www.canva.com/vi_vn/mang-xa-hoi/",
            title: "Mạng xã hội",
            page_type: "product",
            page_type_label: "Product",
            is_scope: true,
            ytd_logged_out_sessions: 10,
            main_keywords: ["mạng xã hội"],
            anchors: [{ text: "mạng xã hội", source: "keyword", role: "Main" }],
          },
        ],
      },
      feedback: [],
      mappings: { rules: [] },
      paths: {},
    },
  );
}

const plan = buildAmbiguousPlan();
assert.equal(plan.placements[0].target_url.endsWith("/thiet-ke/hinh-anh-cho-mang-xa-hoi/"), true);
assert.equal(validateApplicationPlan(plan).ok, false);

const rows = buildConflictRows([{ path: "test-plan.json", plan }]).map((row) => ({
  ...row,
  serp_group_choice: row.target_url.endsWith("/mang-xa-hoi/") ? "use" : "skip",
  serp_query: "mạng xã hội site:canva.com/vi_vn/",
  serp_checked_at: "2026-09-07T00:00:00Z",
  serp_google_priority_url: "https://www.canva.com/vi_vn/mang-xa-hoi/",
  serp_google_priority_rank: "1",
  serp_row_status: row.target_url.endsWith("/mang-xa-hoi/") ? "google_first_eligible" : "lower_google_priority",
  serp_family_eligible: "yes",
  serp_semantic_eligible: "yes",
  serp_target_in_bank: "yes",
  serp_group_note: "first eligible Google result",
}));
const resolved = resolvePlanWithGoogle(plan, rows, {
  planFile: "test-plan.json",
  sourceCsv: "priority.csv",
});
assert.equal(resolved.placements.length, 1);
assert.equal(resolved.placements[0].target_url, "https://www.canva.com/vi_vn/mang-xa-hoi/");
assert.equal(resolved.google_conflict_resolution.counts.use_applied, 1);
assert.equal(resolved.google_conflict_resolution.application_ready, true);
assert.equal(validateApplicationPlan(resolved).ok, true);
assert.equal(
  resolved.contextual_decisions.find((item) => item.target_url.endsWith("/mang-xa-hoi/")).serp_resolution.plan_action,
  "apply",
);
assert.equal(
  resolved.contextual_decisions.find((item) => item.target_url.includes("/thiet-ke/hinh-anh")).serp_resolution.plan_action,
  "skip",
);

const reviewPlan = buildAmbiguousPlan();
reviewPlan.placements = [];
for (const decision of reviewPlan.contextual_decisions) {
  decision.decision = "review";
  decision.selection_status = "not_eligible";
}
reviewPlan.stats.planned = 0;
const reviewRows = buildConflictRows([{ path: "review-plan.json", plan: reviewPlan }]).map((row) => ({
  ...row,
  serp_group_choice: "review",
  serp_query: "mạng xã hội site:canva.com/vi_vn/",
  serp_checked_at: "2026-09-07T00:00:00Z",
  serp_group_note: "Google priority matches only a non-accepted contextual candidate",
}));
const reviewResolved = resolvePlanWithGoogle(reviewPlan, reviewRows, {
  planFile: "review-plan.json",
  sourceCsv: "priority.csv",
});
assert.equal(reviewResolved.placements.length, 0);
assert.equal(reviewResolved.google_conflict_resolution.counts.review_skipped, 1);
assert.equal(reviewResolved.google_conflict_resolution.application_ready, true);
assert.equal(validateApplicationPlan(reviewResolved).ok, true);

assert.throws(
  () => resolvePlanWithGoogle(plan, rows.slice(1), { planFile: "test-plan.json", sourceCsv: "stale.csv" }),
  /does not match the plan/,
);
assert.throws(
  () => resolvePlanWithGoogle(plan, rows.map((row) => ({ ...row, serp_checked_at: "" })), {
    planFile: "test-plan.json",
    sourceCsv: "invalid-use.csv",
  }),
  /invalid Google use row/,
);

console.log("PASS: Google conflict resolutions connected to application plans");
