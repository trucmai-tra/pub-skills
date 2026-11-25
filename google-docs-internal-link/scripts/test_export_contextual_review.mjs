#!/usr/bin/env node
import assert from "node:assert/strict";

import { buildReviewRows, reviewCsv } from "./export_contextual_review.mjs";

const plan = {
  document: {
    document_url: "https://docs.google.com/document/d/test/edit",
    title: "Blind test",
    source_page_url: "https://www.canva.com/vi_vn/source/",
  },
  contextual_decisions: [
    {
      anchor: "mẫu CV",
      target_url: "https://www.canva.com/vi_vn/mau/s/cv/",
      target_title: "Mẫu CV",
      paragraph_index: 3,
      start: 10,
      sentence: "Chọn mẫu CV phù hợp.",
      decision: "accept",
      selection_status: "selected",
      score: 88,
      evidence_tier: "candidate_pool",
      signals: ["anchor_target_overlap"],
      penalties: [],
    },
    {
      anchor: "thiết kế",
      target_url: "https://www.canva.com/vi_vn/thiet-ke/",
      target_title: "Thiết kế",
      paragraph_index: 4,
      start: 2,
      sentence: "Hoàn thiện thiết kế của bạn.",
      decision: "review",
      selection_status: "context_review",
      score: 35,
      evidence_tier: "candidate_pool",
      signals: [],
      penalties: ["generic_anchor"],
    },
    {
      anchor: "lịch sử",
      target_url: "https://www.canva.com/vi_vn/mau/s/lich-su/",
      target_title: "Lịch sử",
      paragraph_index: 5,
      start: 8,
      sentence: "Mô tả lịch sử nghề nghiệp.",
      decision: "reject",
      selection_status: "context_reject",
      score: 10,
      evidence_tier: "candidate_pool",
      signals: [],
      penalties: ["context_mismatch"],
    },
  ],
};

const rows = buildReviewRows([{ path: "/tmp/blind-plan.json", plan }]);
assert.equal(rows.length, 2);
assert.deepEqual(rows.map((row) => row.decision).sort(), ["accept", "review"]);
assert.equal(rows.every((row) => row.human_verdict === ""), true);

const csv = reviewCsv(rows);
assert.equal(csv.startsWith("\uFEFFplan_file,"), true);
assert.equal(csv.includes("Chọn mẫu CV phù hợp."), true);
assert.equal(csv.includes("lịch sử nghề nghiệp"), false);

process.stdout.write("PASS: contextual review export\n");
