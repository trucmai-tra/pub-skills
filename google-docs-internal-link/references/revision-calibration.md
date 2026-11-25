# Learn from revisions without recycling automatic output

Read this when the reviewer revises a batch that the linker previously edited. The
baseline is the last verified post-run snapshot, not the original unlinked copy
and not the generated review footer. The footer may be stale after manual edits.

## Extract and classify

Save fresh native Doc reads as `row-<n>-current.json`. Preserve the baseline run.
Then run this only after the reviewer has explicitly confirmed they made the revisions:

```bash
python3 <skill-dir>/scripts/compare_revision_links.py \
  --baseline-run "<previous-run>" --current-dir "<calibration-run>" \
  --out "<calibration-run>/manual-link-evidence.json" --reviewer-confirmed-revisions
```

The comparator requires an unambiguous `Final page copy` boundary and excludes
the final `Links added for review` section. It fails on multiple tabs until a
specific tab is selected. For a different layout, explicitly identify and save
equivalent boundaries before comparing; never treat a strategy table as body.

- Join contiguous hyperlink runs with the same normalized target. Ignore
  whitespace-only runs; trim after joining. Preserve Vietnamese accents.
- Compare source–anchor–target pairs independently of absolute character
  offsets. Text edits can shift every later offset.
- Unchanged automatic pairs are `retained_automatic`, never new manual votes.
  Other old pairs are `retained_preexisting`. Keep both visible in the report.
- New pairs and changed targets are `reviewer_added`, with change `added` or
  `retargeted`. A moved pair stays retained. Record both revisions and provenance.
- An absent pair is a confirmed removal only when its original paragraph is
  still present unchanged. Otherwise record uncertainty. Never learn a removal
  from deleted or rewritten copy alone.

Inspect all changed pairs before import. Set `learning_status: hold` with a
specific `learning_reason` when the sentence does not establish the destination's
meaning. Authorship and suitability for reuse are separate facts. Keep the Doc
and the observed link intact. A hold is local to that observation, not a global
ban on its anchor or destination.

Use `--import-confirmed-removals` with the usual importer dry run and import.
It writes confirmed negatives to canonical `link_feedback.json`. Existing
distinct-source rules apply: two source-page removals block that exact pair.
It does not retire the whole destination or block more specific anchors.

## What the Optimize 2.0 revision batch established

Rows 38–62, reviewed on 2026-09-19, contained 23 Docs. Rows 42 and 58 had no
folder. The reviewer added 41 pairs, retargeted three, and retained 116 automatic pairs
plus 57 pre-existing pairs. This is calibration evidence, not an unseen test.

Repeated new choices were:

| Exact anchor | Destination | Distinct source pages |
| --- | --- | --- |
| tài liệu | `/vi_vn/tai-lieu/` | 4 |
| ảnh chân dung | `/vi_vn/anh/s/chan-dung/` | 3 |
| album gia đình | `/vi_vn/album-anh/mau/` | 2 |
| Canva Pro | `/vi_vn/pro/` | 2 |
| email | `/vi_vn/email/` | 2 |
| phông | `/vi_vn/tinh-nang/phong-chu-mien-phi/` | 2 |

All three retargetings replaced `tài liệu` → `/vi_vn/thiet-ke/documents/`
with `/vi_vn/tai-lieu/`. Use canonical feedback to enforce this exact correction.
Do not turn it into a block on every anchor for the Documents create page.

These examples support three selection habits:

1. Consider a verified broader hub for a neutral entity anchor. Do not force
   every noun into a creation tool. Keep action anchors such as `tạo` and
   `thiết kế` subject to the existing page-family constraint.
2. A short anchor can be useful when repeated human evidence establishes its
   destination. Do not lower the general length or relevance thresholds.
3. Separate a photo/template collection from generating or editing that object.
   `ảnh chân dung` referring to an existing photograph does not by itself imply
   AI portrait generation. A named product such as `Canva Pro` can be useful
   even when the sentence explains a limitation rather than a benefit.

Some observed choices require more context before reuse. In this batch,
`khung hình` in an aspect-ratio sentence pointed to decorative frames;
Vietnamese glyph support pointed to handwritten fonts; and recoloring a photo
pointed to coloring templates. Hold these observations rather than treating
their shared words as interchangeable meanings. Similar uncertainty applies
when a generic anchor is mapped to an unstated platform or AI workflow.

The audit found 19 of 44 changed-link observations pointed outside the candidate
snapshot, and only 12 had an exact anchor in that snapshot. Report these gaps.
Repeated exact pairs may enter the runtime candidate set through existing
history rules; one-off missing targets remain evidence-only. Do not scrape new
targets, invent synonyms, or modify the candidate snapshot during calibration.

## Verify the next run's behavior

Save plans on the same original inputs before importing evidence, then rerun
after import. Report accepted candidates separately from selected placements:
sentence limits, existing targets, source-topic rules, and conflicts can prevent
a valid candidate from being selected. Treat this as a regression comparison.
Do not report it as general accuracy or evidence that every manual choice will
be reproduced. Google conflict resolution is still required before application.

Test split hyperlink runs, linked whitespace, stale footers, retained automatic
links, retargeted and moved pairs, rewritten copy, held evidence, and idempotent
positive/negative imports. Keep the local evidence manifest and per-row report.
