#!/usr/bin/env node
import assert from "node:assert/strict";

import { parseCsv, scoreReviewRows } from "./score_contextual_review.mjs";

const rows = [
  {
    document_url: "doc-1",
    anchor: "mẫu CV",
    target_url: "target-1",
    decision: "accept",
    selection_status: "selected",
    human_verdict: "keep",
    human_reason: "",
  },
  {
    document_url: "doc-1",
    anchor: "thiết kế",
    target_url: "target-2",
    decision: "accept",
    selection_status: "selected",
    human_verdict: "remove",
    human_reason: "wrong_context",
  },
  {
    document_url: "doc-1",
    anchor: "website",
    target_url: "target-3",
    decision: "review",
    selection_status: "context_review",
    human_verdict: "keep",
    human_reason: "",
  },
];

const result = scoreReviewRows(rows);
assert.equal(result.selected.precision, 0.5);
assert.equal(result.selected.critical_error_count, 1);
assert.equal(result.review.promotion_rate, 1);
assert.equal(result.release_check.status, "insufficient_labels");

const parsed = parseCsv('\uFEFFa,b\n"one, two","quoted ""value"""\n');
assert.deepEqual(parsed, [{ a: "one, two", b: 'quoted "value"' }]);

process.stdout.write("PASS: contextual review scoring\n");
