#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildConflictRows, conflictCsv } from "./export_contextual_conflicts.mjs";

const plan = {
  document: {
    document_url: "https://docs.google.com/document/d/test/edit",
    title: "Conflict test",
    source_page_url: "https://www.canva.com/vi_vn/source/",
  },
  contextual_decisions: [
    {
      anchor: "Tạo CV",
      target_url: "https://www.canva.com/vi_vn/so-yeu-ly-lich-ai/",
      target_title: "Sơ yếu lý lịch AI",
      target_type: "Product",
      paragraph_index: 3,
      start: 0,
      end: 6,
      sentence: "Tạo CV xin việc online.",
      decision: "review",
      selection_status: "not_eligible",
      score: 43,
      evidence_tier: "candidate_pool",
      signals: [],
      penalties: ["anchor_repeats_source_topic"],
    },
    {
      anchor: "Tạo CV xin việc",
      target_url: "https://www.canva.com/vi_vn/thiet-ke/cv/",
      target_title: "Sơ yếu lý lịch",
      target_type: "Create",
      paragraph_index: 3,
      start: 0,
      end: 15,
      sentence: "Tạo CV xin việc online.",
      decision: "review",
      selection_status: "not_eligible",
      score: 25,
      evidence_tier: "candidate_pool",
      signals: [],
      penalties: ["anchor_repeats_source_topic"],
    },
    {
      anchor: "lịch sử",
      target_url: "https://www.canva.com/vi_vn/mau/s/lich-su/",
      paragraph_index: 5,
      start: 10,
      end: 17,
      sentence: "Mô tả lịch sử nghề nghiệp.",
      decision: "reject",
      selection_status: "not_eligible",
      score: 5,
    },
  ],
};

const rows = buildConflictRows([{ path: "/tmp/conflict-plan.json", plan }]);
assert.equal(rows.length, 2);
assert.equal(new Set(rows.map((row) => row.conflict_id)).size, 1);
assert.equal(rows[0].issue_types.includes("overlapping_anchor_variants"), true);
assert.equal(rows[0].issue_types.includes("multiple_candidate_targets"), true);
assert.equal(rows[0].suggested_resolution, "skip_source_topic");
assert.equal(conflictCsv(rows).startsWith("\uFEFFconflict_id,"), true);

process.stdout.write("PASS: contextual conflict export\n");
