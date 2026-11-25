import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importManualEvidence } from "./import_manual_evidence.mjs";

const root = mkdtempSync(join(tmpdir(), "internal-link-evidence-"));
try {
  const dataDir = join(root, "data");
  await import("node:fs").then(({ mkdirSync }) => mkdirSync(dataDir, { recursive: true }));
  const historyPath = join(dataDir, "internal-links.csv");
  const feedbackPath = join(dataDir, "link_feedback.json");
  writeFileSync(feedbackPath, "[]\n");
  writeFileSync(
    historyPath,
    "\uFEFFsource_run,source_slug,source_url,target_url,anchor,link_source,target_title,target_type,target_was_in_source_scope,target_is_scope,paragraph,source_target_occurrences,audit_flags\n",
    "utf8",
  );
  writeFileSync(
    join(dataDir, "candidates.json"),
    JSON.stringify({ candidates: [{ url: "https://www.canva.com/vi_vn/target/", title: "Target", page_type_label: "Feature", is_scope: true }] }),
    "utf8",
  );
  const manifest = {
    contract: "canva.internal-link-calibration.v1",
    documents: [{
      row: 99,
      source_slug: "source",
      source_url: "https://www.canva.com/vi_vn/source/",
      current_links: [
        { anchor: "Cụm lặp", target_url: "https://www.canva.com/vi_vn/target/", evidence_label: "reviewer_added", paragraph_index: 2 },
        { anchor: "Cụm lặp", target_url: "https://www.canva.com/vi_vn/target/", evidence_label: "reviewer_added", paragraph_index: 5 },
        { anchor: "Liên kết có sẵn", target_url: "https://www.canva.com/vi_vn/baseline/", evidence_label: "page_strategy_use", paragraph_index: 1 },
        { anchor: "Đích mới", target_url: "https://www.canva.com/vi_vn/missing/", evidence_label: "reviewer_added", paragraph_index: 7 },
        { anchor: "Automatic", target_url: "https://www.canva.com/vi_vn/automatic/", evidence_label: "retained_automatic" },
        { anchor: "Ambiguous", target_url: "https://www.canva.com/vi_vn/ambiguous/", evidence_label: "reviewer_added", learning_status: "hold" },
      ],
    }],
  };
  const dryRun = importManualEvidence(manifest, { repoRoot: root, historyPath, sourceRun: "test", dryRun: true });
  assert.equal(dryRun.added, 2);
  assert.equal(dryRun.held_for_review, 1);
  assert.equal(dryRun.duplicate_input_pairs, 1);
  assert.deepEqual(dryRun.missing_candidate_targets, ["https://www.canva.com/vi_vn/missing/"]);
  assert.equal(readFileSync(historyPath, "utf8").split("\n").length, 2);

  const applied = importManualEvidence(manifest, { repoRoot: root, historyPath, sourceRun: "test" });
  assert.equal(applied.added, 2);
  const written = readFileSync(historyPath);
  assert.deepEqual([...written.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(written.toString("utf8"), /manual_doc_calibration;target_missing_from_candidate_pool/);

  const rerun = importManualEvidence(manifest, { repoRoot: root, historyPath, sourceRun: "test" });
  assert.equal(rerun.added, 0);
  assert.equal(rerun.already_recorded, 2);
  assert.throws(() => importManualEvidence({ ...manifest, calibration_mode: "revision_diff" }, { repoRoot: root, dryRun: true }), /verified baseline diff/);
  const verified = structuredClone(manifest);
  verified.calibration_mode = "revision_diff";
  verified.baseline_run = "saved-run";
  verified.documents[0].baseline_revision = "before";
  verified.documents[0].current_revision = "after";
  for (const link of verified.documents[0].current_links) {
    link.provenance = "post_run_snapshot_diff";
    link.change = "added";
  }
  assert.equal(importManualEvidence(verified, { repoRoot: root, dryRun: true }).added, 0);
  verified.documents[0].current_links[0].change = "retained";
  assert.throws(() => importManualEvidence(verified, { repoRoot: root, dryRun: true }), /verified baseline diff/);
  verified.documents[0].current_links[0].change = "added";
  verified.documents[0].removed_links = [
    { anchor: "tài liệu", target_url: "https://www.canva.com/vi_vn/thiet-ke/documents/", removal_confirmed: true, reason: "unchanged_paragraph" },
    { anchor: "Deleted copy", target_url: "https://www.canva.com/vi_vn/deleted/", removal_confirmed: false, reason: "copy_changed_or_deleted" },
  ];
  assert.equal(importManualEvidence(verified, { repoRoot: root, dryRun: true, importRemovals: true }).confirmed_removals_added, 1);
  assert.deepEqual(JSON.parse(readFileSync(feedbackPath)), []);
  assert.equal(importManualEvidence(verified, { repoRoot: root, importRemovals: true }).confirmed_removals_added, 1);
  assert.equal(importManualEvidence(verified, { repoRoot: root, importRemovals: true }).confirmed_removals_added, 0);
  assert.equal(JSON.parse(readFileSync(feedbackPath)).length, 1);
  verified.documents[0].current_links.push({ ...verified.documents[0].removed_links[0], evidence_label: "retained_preexisting" });
  assert.throws(() => importManualEvidence(verified, { repoRoot: root, dryRun: true, importRemovals: true }), /still exists/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("google-docs-internal-link manual evidence tests passed");
