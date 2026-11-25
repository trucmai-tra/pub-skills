# Cleanup and deliverables

## Canonical keywords

Preserve raw observations. Normalize Unicode to NFC, trim and collapse spaces,
and compare case-insensitively. Use language judgment for the remaining work:

- Merge accented and unaccented queries only when context establishes the same
  meaning. Prefer a correctly accented natural canonical form.
- Correct clear typos only when unambiguous. An inferred correction is a label
  until its own exact query and volume have been verified.
- Never merge queries solely because their accent-stripped forms match.
  Vietnamese accents can distinguish different meanings.
- Keep meaningful modifiers, audiences, formats, and tasks distinct. Review
  reordered terms in context; some are duplicates, others have different intent.
- Retain ambiguous unaccented phrases for review or exclude them with a reason.

For each decision save raw query, canonical query, action, reason, confidence,
and observation IDs. Useful actions are `keep`, `merge_variant`, `correct_typo`,
`review`, and `exclude`.

Deduplicate across seeds, URLs, and rounds. Keep one accepted canonical row and
all distinct source observations. Count unique URLs and unique domains
separately. Repeated pulls of one page remain one source page.

## Metric contract

`Search Volume` means Ahrefs estimated average monthly searches for the exact
canonical query in the target country over its latest known 12 months. Record
retrieval date and basis. This estimate is not traffic or guaranteed demand.

- Repeated observations across pages count once for volume.
- Never sum accent variants, typos, or reordered duplicates into canonical
  volume. Ahrefs may group variants internally. Preserve raw variant metrics
  separately without claiming an additive total.
- Do not sum competitor traffic into a forecast. Position and traffic remain
  tied to their source URL.
- Prefer the final same-batch exact-query overview value. Otherwise choose the
  latest compatible average-volume observation and label its source. Preserve
  conflicts and explain the choice; do not automatically take the maximum.
- If a corrected canonical form lacks a verified metric, leave volume blank.
  Keep the original query's metric in evidence rather than transferring it.
- Keep zero distinct from missing data. Use blank cells for missing volume
  and an explicit metric status such as `unknown` or `unverified`.
- Store volumes and counts as numeric XLSX cells. Use comma thousands and dot
  decimals, with explicit separators consistent with the repository spreadsheet
  policy. If CSV is explicitly requested, use a UTF-8 BOM and dot decimals
  without thousands separators.

Do not sum all keyword volumes into aggregate page demand. Queries overlap.
Report the Main query and supporting evidence instead.

## Evidence records

Keep these logical records in `research.json`; adapt nesting to the run:

- Input: seeds, country, language, page purpose, constraints, limits.
- Costs: estimated and actual DataForSEO USD charges and Ahrefs API units
  tracked separately, cache hits, actual remaining quota, and any budget the user
  explicitly supplied. No approval or allowance record is required.
- SERPs: seed, round, provider, retrieval/result timestamps, location, language, device,
  organic and absolute positions, ranked URLs, selections,
  skips with reasons, raw response path.
- Page notes: exact URL, status/date, title, available meta description,
  H1/H2s, page type, task, topics, limitations.
- Observations: unique ID, raw query, URL, country, date, volume mode, volume,
  best position, traffic, seed, round, raw response path.
- Decisions: variant map, accepted terms, groups, exclusions, separate-page
  opportunities, rationale, confidence.
- Rounds: seeds, selected/reused pages, novelty calculation, new topics,
  unresolved questions, costs, continue/stop decision.
- Conclusion: Main and alternatives, status, stop reason, coverage gaps,
  failed requests, next useful steps.

Use `complete` only for a coherent page plan with evidence for saturation or
coverage. Use `partial` if limits or missing evidence stop useful research.
Save raw files under `raw/` with stable request IDs and resume successful work.

## Workbook layout

Deliver `keyword-research.xlsx` by default using the relevant spreadsheet skill.

- `Keywords`: the canonical table below, with Main first and clearly highlighted.
  Freeze the header row, enable filters, set readable column widths, wrap long
  text, and format numeric volumes and counts. Keep source URLs clickable.
- `Page Brief`: page purpose, Main rationale, supporting groups, title/meta/H1
  recommendations, H2 outline, research status, stop reason, and limitations.
  Use clear labels, wrapped text, and enough width to read the recommendations.

Verify that the saved workbook reopens, its data matches the final research
records, and text is readable without clipping. Preserve the companion
`page-brief.md`, `research.json`, and raw evidence. Do not deliver CSV as the
primary file unless the user explicitly requests that format.

## Keyword table

One row per accepted canonical term, with exactly one `Main`:

```text
Keyword | Type | Search Volume | Country | Volume Basis | Metric Date |
Metric Status | Intent | Topic / Proposed Section | Source Page Count |
Source Domain Count | Source URLs | Raw Variants | Evidence / Rationale |
Confidence
```

Put Main first. Group Supporting by section and sort by relevance, using volume
as a tie-breaker. Every accepted row needs an observation, exact-query
verification, or explicitly marked inferred correction linked to raw evidence.
An inferred correction cannot silently become an observed query. Keep
speculative editorial ideas outside the keyword table until verified.

Keep rejected terms and separate-page opportunities in the research record.
Discuss material exclusions in the brief. Do not pad the supporting set.

## Page brief

Include:

1. Purpose, audience, task, and page type. Explain the chosen scope if SERPs
   contain mixed intent.
2. Main, its exact-query volume or limitation, evidence, and why alternatives
   were rejected or assigned elsewhere.
3. Supporting groups: reader need, key terms, sources, and intended use in a
   heading, body, or useful FAQ.
4. Title, meta description, and H1 direction plus a reader-led H2 outline.
   Draft examples are allowed when marked as recommendations. Do not invent
   product features, free access, limits, or performance claims.
5. Useful questions supported by observed queries or inspected pages. Do not
   invent PAA evidence or force an FAQ section.
6. Separate-page opportunities, exclusions, uncertainty, and source limitations.
7. Seeds/pages researched, round yields, stop reason, status, DataForSEO USD charges, Ahrefs API units spent, and
   links to evidence files.

Link sources beside material intent and coverage conclusions. Competitor
headings identify needs; do not copy them or assume every competitor section
belongs on the new page. Do not create headings for every accent variant.

## Final checks

- Exactly one Main with rationale, provisional if necessary.
- No duplicate canonical rows or semantically different queries merged by
  accent stripping.
- Every accepted row traces to evidence and correction decisions are visible.
- No repeated observation inflates volume or source counts.
- Country, basis, dates, numeric values, and zero/missing states agree.
- Positions and traffic stay attached to actual source URLs.
- The outline follows selected page intent and observed reader needs.
- Stop status agrees with round evidence; resource-limited work is partial.
- Costs reconcile with saved responses and remaining failures are disclosed.
