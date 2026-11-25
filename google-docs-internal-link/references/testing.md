# Testing the contextual relevance engine

Use this workflow when the user asks whether the planner is ready for automatic
Google Docs edits. Testing is a dry run unless the user separately asks for a live
application trial.

## Separate regression from evaluation

Use previously reviewed Docs for regression testing. They should continue to
produce sensible decisions after a code or threshold change, but they do not
measure unbiased accuracy once their links have been imported as historical
evidence.

Measure quality on a blind holdout of 10 to 20 finished Docs whose manual link
choices have not been imported. Include different page types and topics. Keep
their human links hidden from the planner until its plans and review CSV have
been saved.

## Stage 1: automated checks

Run:

```bash
node <skill-dir>/scripts/test_contextual_relevance.mjs
node <skill-dir>/scripts/test_plan_links.mjs
node <skill-dir>/scripts/test_export_contextual_review.mjs
node <skill-dir>/scripts/test_export_contextual_conflicts.mjs
python3 <skill-dir>/scripts/test_prioritize_conflicts_with_google.py
node <skill-dir>/scripts/test_resolve_google_conflicts.mjs
node <skill-dir>/scripts/test_score_contextual_review.mjs
python3 <skill-dir>/scripts/test_compare_revision_links.py
node <skill-dir>/scripts/test_import_manual_evidence.mjs
node <skill-dir>/scripts/test_revision_preferences.mjs
node --test <skill-dir>/runtime/tests/linker.test.mjs
```

These tests catch deterministic regressions. They do not establish editorial
quality.

## Stage 2: blind dry run

For every holdout Doc, extract the body, build a plan, and validate it using
the normal workflow. Do not edit the Doc and do not import its manual links.

Export the selected placements and borderline review decisions:

```bash
node <skill-dir>/scripts/export_contextual_review.mjs \
  --out "<run-dir>/contextual-review.csv" \
  --include selected,review \
  "<run-dir>"/*-plan.json
```

The exporter keeps every selected placement and only the highest-scoring
review target for the same exact anchor occurrence. This avoids making the
human labeler compare duplicate alternatives that the planner would not apply.

Export unresolved groups separately:

```bash
node <skill-dir>/scripts/export_contextual_conflicts.mjs \
  --out "<run-dir>/contextual-conflicts.csv" \
  "<run-dir>"/*-plan.json
```

This groups overlapping anchor variants and multiple candidate targets. For
each `conflict_id`, set `human_choice` to `use` on at most one row, set the
others to `skip`, or mark every row `skip`. Use `human_note` when the decision
should become a reusable mapping or rule.

For ambiguous destination groups, add dated Google Vietnam evidence before
labeling:

```bash
python3 <skill-dir>/scripts/prioritize_conflicts_with_google.py \
  --conflicts "<run-dir>/contextual-conflicts.csv" \
  --out-json "<run-dir>/google-serp-evidence.json" \
  --out-csv "<run-dir>/contextual-conflicts-google-priority.csv"
```

Use the first family-eligible result, not the raw first result. Do not let SERP
rank override a retired URL, self-link, source-topic repeat, or contextual
meaning failure. A first eligible result outside the active bank is a `hold`
for inspection, not permission to add it automatically.

For an end-to-end plan test, connect the enriched CSV back into each plan and
run application validation. Confirm that Google changes only conflict-bearing
placements, cannot promote `review`, and turns `skip`, `hold`, and `review`
groups into no-link actions.

Review the CSV without looking at the scores first. Set `human_verdict` to
`keep`, `remove`, or `uncertain`. Use `human_reason` for a short category such
as `wrong_context`, `wrong_target`, `source_topic_repeat`, `anchor_too_broad`,
`duplicate_intent`, `missing_target`, or `other`.

After labels are frozen, reveal the Docs' original manual links. Record which
manual anchor-target pairs appeared as `selected`, `review`, or were missed.
Do not import those pairs until the evaluation results are final.

Score the labeled CSV:

```bash
node <skill-dir>/scripts/score_contextual_review.mjs \
  "<run-dir>/contextual-review.csv" \
  --out "<run-dir>/contextual-review-report.json"
```

## Metrics

Use selected precision as the primary metric:

`kept selected placements / (kept selected placements + removed selected placements)`

Exclude `uncertain` labels from the denominator and report their count. Also
report:

- critical selected errors: clearly wrong target, wrong meaning, or source-topic repeat;
- review promotion rate: share of labeled `review` rows a human would keep;
- manual-pair coverage: share of the hidden manual pairs found as `selected` or `review`;
- selected links per Doc and reasons for zero-link Docs.

Use a minimum of 30 labeled selected placements before tuning thresholds.
A practical first release bar is at least 90% selected precision with zero
critical selected errors. This is a local operating target, not an SEO or
Google Docs limitation. Favor precision over link count because a missed link
can be added later, while an irrelevant automatic link damages trust.

## Stage 3: small live trial

After the blind dry run passes, apply the planner to 3 to 5 test Docs. Verify
that the protected body text is unchanged, each selected target appears once,
the planned anchor points to the intended URL, and the final review section
matches the links actually applied. Expand the batch only after this check.

When thresholds or scoring rules change, repeat the automated tests and the
regression set. Start a new blind holdout when making a major scoring change;
do not repeatedly tune against the same evaluation Docs.
