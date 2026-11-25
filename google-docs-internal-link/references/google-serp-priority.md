# Google SERP priority for ambiguous targets

Use this evidence layer when an anchor has multiple plausible Canva Vietnam
destinations or overlapping anchor variants need resolution. A live
application run must resolve every detected conflict before editing a Doc. A
plan with no conflicts does not need a SERP call.

## Query and locale

For each conflict group, choose the longest overlapping anchor phrase as the
query keyword. This prevents an incomplete substring such as `ảnh đại` from
overriding the complete anchor `ảnh đại diện`. Deduplicate those query anchors
case-insensitively, then query Google as:

```text
<most specific overlapping anchor> site:canva.com/vi_vn/
```

Prefer the actual Google results page in Chrome because the `site:` operator is
visible and auditable there. Save the evidence date, query, result ranks, and
URLs in the run directory. Use the DataForSEO Google organic live endpoint
only as a fallback, with Vietnam location code `2704`, Vietnamese language
`vi`, and desktop results. Its observed cost in this audit was $0.01 to $0.0175
per query. Estimate before a batch and reject a fallback run if its results
materially disagree with a spot-check in the real Google interface.

## Eligibility before rank

Google rank chooses between eligible targets. It does not override these rules:

1. Exclude retired URLs and exact self-links.
2. Hard-skip `viết CV xin việc`. Google rank cannot override this rule.
3. For an anchor beginning with `mẫu` or `các mẫu`, consider only Template
   Search or Template Subcategory pages.
4. For an anchor beginning with `tạo`, `thiết kế`, `cách tạo`, or
   `cách thiết kế`, consider only Create pages for SERP priority.
5. For a neutral anchor, consider any active target family.
6. For provider fallback results, require the result URL, title, or snippet to
   share the anchor's specific topic terms after generic words such as `tạo`,
   `thiết kế`, `mẫu`, and `online` are removed. Exclude Help, Login, Creator,
   and locale-home URLs unless they are already approved in the active bank.
7. Preserve the contextual safety decision. Only `accept` candidates are
   eligible for a Google `use` choice. A first-ranked result cannot promote a
   `review` or `reject` candidate and does not override wrong meaning,
   source-topic repetition, protected content, or an existing-link uniqueness
   rule.

The first non-retired, family-eligible Canva Vietnam organic result is the
Google priority. Provider fallback results must also pass the topic-term check.
If the priority is outside the active internal-link bank, flag it for a bank
decision. Do not silently fall through to a lower result or add a new target
automatically.

## Run

Start with the conflict CSV produced by the contextual evaluator. After saving
browser-verified results to JSON, reprocess them without another paid query:

```bash
python3 <skill-dir>/scripts/prioritize_conflicts_with_google.py \
  --conflicts "<run-dir>/contextual-conflicts.csv" \
  --cached-evidence "<run-dir>/browser-google-serp-results.json" \
  --out-json "<run-dir>/google-serp-evidence.json" \
  --out-csv "<run-dir>/contextual-conflicts-google-priority.csv"
```

If Chrome is unavailable, omit `--cached-evidence` to use the DataForSEO
fallback. Keep its concurrency at `1` for site-restricted queries.

The enriched CSV keeps every original review field and adds the Google query,
rank of each candidate, first eligible Google URL, first eligible bank URL,
row status, and a group-level `use`, `skip`, `hold`, or `review` suggestion.
The priority script does not edit plans, Docs, or the link bank.

Connect the enriched choices to each preliminary plan:

```bash
node <skill-dir>/scripts/resolve_google_conflicts.mjs \
  --plan "<run-dir>/<doc>-preliminary-plan.json" \
  --serp-csv "<run-dir>/contextual-conflicts-google-priority.csv" \
  --out "<run-dir>/<doc>-application-plan.json"
```

The resolver removes every preliminary placement represented by a conflict,
then adds back only a contextually accepted row marked `use` when all global
link constraints still pass. It records `skip`, `hold`, and `review` as no-link
actions. If a `use` candidate conflicts with the document-wide target, anchor,
sentence, paragraph, overlap, or plan limits, it is also omitted and recorded
with the blocking reason.

Validate the connected plan before application:

```bash
node <skill-dir>/scripts/validate_plan.mjs \
  --for-application "<run-dir>/<doc>-application-plan.json"
```

Application validation fails when a detected conflict lacks a final `apply` or
`skip` plan action. This prevents a preliminary selection from bypassing the
Google resolution layer.

When Google points to a target outside the bank, inspect the page before adding
it. When every row repeats the source topic, keep the group skipped even if one
candidate ranks first.
