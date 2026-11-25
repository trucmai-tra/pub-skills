# Deterministic contextual relevance

Read this reference before creating or validating an internal-link plan.

## Boundary

The evaluator is local and deterministic. It does not call an LLM, embeddings,
SEO retrieval tools, or another external service. Exact anchor matching
generates candidates; contextual relevance decides whether a candidate can be
applied.

## Inputs

Build three profiles:

- Source topic: semantic tokens from `page_url` and `main_keywords`.
- Target topic: semantic tokens from the candidate URL slug, title, and target
  main keywords.
- Anchor context: the exact visible anchor, its complete sentence, and its
  paragraph.

Exclude the complete `How to steps` section before candidate generation. The
section begins at that Heading 2 and ends immediately before the next Heading
2. Treat its headings and body paragraphs as protected content.

Ignore structural Canva path segments and common Vietnamese function words.
Preserve short product and format tokens such as `CV`, `PDF`, `PNG`, and `QR`.

## Decision order

1. Hard-reject `viết CV xin việc`, including a shorter candidate anchor inside
   that complete phrase. This rule overrides explicit mappings and SERP rank.
2. Hard-reject the exact anchor-target pair `hình thu nhỏ` →
   `https://www.canva.com/vi_vn/hinh-anh-dep-tren-mang-xa-hoi/mau/thumbnail-youtube/`.
   This user-directed block overrides explicit mappings and SERP rank without
   blocking the same anchor from every other destination.
3. Hard-reject the exact anchor-target pair `thang` →
   `https://www.canva.com/vi_vn/giao-an/mau/thang/`. This generic anchor does
   not establish lesson-plan intent, so the pair is never appropriate for
   automatic linking.
4. Preserve pre-existing links without rescoring them.
5. Treat an explicit destination mapping as `accept` after the ordinary
   self-link, duplicate, and protected-content checks.
6. Give repeated manual anchor-target pairs strong evidence, but require
   sentence support when the anchor is known to be context-dependent.
7. For general candidates, score:
   - anchor overlap with the target topic;
   - exact anchor phrase in the target slug, title, or main keywords;
   - anchor specificity;
   - target-topic tokens in the sentence, then the paragraph;
   - source-target relationship when the sentence also supports the target;
   - source-topic duplication risk.
8. Use anchor intent as a page-family constraint:
   - anchors beginning with `mẫu` belong to Template Search or Template
     Subcategory targets;
   - anchors beginning with `tạo` or `thiết kế` favor Create targets and must
     not point to template targets;
   - explicit mappings may override this constraint.
9. Rank accepted alternatives by contextual score before historical keyword
   and traffic tie-breakers. This allows a lower-traffic target to win when its
   topic fits the sentence better.

URL keywords are evidence, not proof. A literal slug match such as `lịch sử`
to `/mau/s/lich-su/` must be rejected when the sentence means `lịch sử nghề
nghiệp` and the target has no employment context.

## Decisions

- `accept`: eligible for deterministic planning and application.
- `review`: plausible but not strong enough for automatic editing.
- `reject`: contextual evidence conflicts with or does not support the target.

The current thresholds are emitted in `plan.policy.contextual_relevance` and
on every placement. Only `accept` can have `selection_status: selected`.

Every contextual decision records:

- anchor, target URL, target title, sentence, and exact location;
- evidence tier, anchor source, and repeated-positive count;
- score and decision;
- positive signals, penalties, and matched topic tokens;
- whether it was selected or lost to a duplicate, sentence, paragraph,
  overlap, or plan limit.

## Known limits

This is a token-based relevance gate, not general language understanding.
Vietnamese synonyms that share no target metadata may still be missed.
Incomplete target titles or main keywords reduce confidence. Add verified
manual evidence or improve canonical target metadata instead of weakening the
threshold for one example.

## Verification

Run:

```bash
node <skill-dir>/scripts/test_contextual_relevance.mjs
node <skill-dir>/scripts/test_plan_links.mjs
node --test <skill-dir>/runtime/tests/linker.test.mjs
```

For a calibration batch, compare the new plans with the previous dry run.
Confirm that known polysemy failures are `review` or `reject`, and inspect all
selected `candidate_pool` placements before changing thresholds.
