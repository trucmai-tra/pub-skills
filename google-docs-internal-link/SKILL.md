---
name: google-docs-internal-link
description: "Apply Canva Vietnam internal links inside existing Google Docs while preserving formatting, or calibrate the linker from the reviewer's manual additions and revisions. Reuse canonical candidates and history, verify contextual relevance, resolve ambiguous accepted targets with Google evidence, and audit changes. Calibration compares saved post-run snapshots without editing Docs. The source page URL may be blank for an unlaunched page."
---
## Marketplace paths

When this skill is installed from a marketplace, resolve `<skill-dir>` to the
directory containing this `SKILL.md`. A dependency placeholder such as
`<canva-crawl-skill-dir>` refers to that separately installed skill's directory.
Commands below use these placeholders instead of assuming a repository-local
`.claude/skills/` checkout.


# Google Docs Internal Linker

Add links to finished Google Docs without rewriting their original body text.
Reuse the existing mass template-page linking system, apply validated links
directly to the original Docs, and append a review section at the bottom. When
the user identifies Docs as examples of links they added manually, use the
calibration workflow below instead of editing those Docs again.

## Run contract

Accept one or more Google Doc URLs or a Drive folder. For each Doc, collect:

- `document_url`;
- finished body copy as HTML when link metadata is available, otherwise plain text;
- `page_url`, which may be blank for an unlaunched page;
- `main_keywords`, when available.

Never reject or pause a Doc only because `page_url` is blank. A blank value
disables only self-link comparison. All other guardrails remain active.

Create each run under:

`project/google-docs-internal-link/runs/<descriptive-name>/`

Keep extracted inputs, plans, validation results, and `audit.json` together.

## Manual-link calibration

Use this mode when the user identifies completed Docs, spreadsheet rows, or a batch
as examples of their own internal-linking choices.

1. Resolve the exact source rows, Docs, and source page URLs.
2. Extract every linked anchor, target URL, and surrounding publishable body
   paragraph. Merge adjacent runs with the same URL before trimming whitespace;
   formatting splits and linked spaces are not separate choices. Exclude brief
   tables and the generated review footer.
3. When these Docs have a saved automatic run, compare against its verified
   post-run snapshots. Follow [revision-calibration.md](references/revision-calibration.md).
   Label retained skill output `retained_automatic`, other unchanged links
   `retained_preexisting`, and only verified new or retargeted pairs `reviewer_added`.
   Retention after review is not evidence of manual authorship. Without a saved
   run, exact anchor-target pairs marked `Use` in an `Internal links` table are
   `page_strategy_use`; label other links `reviewer_added` only when the reviewer explicitly
   identifies them as his additions. Unknown provenance stays unimported.
4. Store the evidence as `manual-link-evidence.json` using contract
   `canva.internal-link-calibration.v1` in the run directory.
5. Compare the manual pairs with the canonical candidate snapshot:

```bash
python3 <skill-dir>/scripts/audit_manual_evidence.py \
  --input "<run-dir>/manual-link-evidence.json" \
  --out "<run-dir>/manual-link-audit.json"
```

Use this audit to separate source-page similarity from sentence-level link
usefulness and to identify destinations or exact anchors missing from the
candidate pool.

6. Inspect each changed pair in its sentence. Mark uncertain destination intent
   with `learning_status: hold` and a reason, preserving the observation without
   teaching it as a general preference. Dry-run and import only eligible
   `reviewer_added` pairs:

```bash
node <skill-dir>/scripts/import_manual_evidence.mjs \
  --input "<run-dir>/manual-link-evidence.json" \
  --source-run "<descriptive-run-name>" \
  --dry-run
```

Run the same command without `--dry-run` after the counts and source scope are
correct. The importer writes distinct source-anchor-target rows as `manual`
evidence to the canonical historical CSV, preserves its UTF-8 BOM, ignores
baseline and retained automatic links, skips held observations, and is idempotent.
For verified revision comparisons, add `--import-confirmed-removals` to both
commands to record removed pairs whose original paragraph still exists unchanged.
Moved occurrences and copy deletions are not negative preferences.

One source page is page-local evidence. Do not promote a one-off pair to an
explicit mapping. Repeated exact anchor-target choices across at least two
distinct source pages may become learned evidence through the existing engine.
Report targets missing from the candidate snapshot. The planner may use one of
these targets only when the same exact anchor-target pair is verified across at
least two distinct source pages; one-off missing targets remain evidence-only.

For calibration completion, report inspected rows, additions, retargetings,
retained automatic links, learning holds, imported evidence, and regression
results. Keep the Docs unchanged. The live-application footer and completion
requirements below do not apply to calibration or evaluation.

## Required references

Read before acting:

1. [data-sources.md](references/data-sources.md) before planning links.
2. [contextual-relevance.md](references/contextual-relevance.md) before planning links.
3. [testing.md](references/testing.md) when testing or evaluating the planner.
4. [google-serp-priority.md](references/google-serp-priority.md) when resolving
   ambiguous targets with Google rank.
5. [chrome-apply.md](references/chrome-apply.md) before editing Docs.
6. The browser runtime documentation returned by `cua_repl` before browser
   action. Follow the runtime selection in `chrome-apply.md`; a separately
   installed `chrome:control-chrome` skill is not required for this route.

## Evaluation mode

When the user asks to test or evaluate the planner, stop after planning and
validation. Do not edit Google Docs. Follow [testing.md](references/testing.md)
and export human-review and conflict CSVs from the plan files. Keep regression
examples separate from unseen evaluation Docs so imported evidence cannot
inflate the measured result.

## Workflow

### 1. Extract the Docs

Use Google Drive tools for semantic reading when available. Do not use the
Drive connector to regenerate a new Doc. Preserve the original Doc and its
formatting.

Prefer HTML or another rich extraction that exposes existing hyperlinks. If
only plain text is available, inspect the Doc through background Chrome control
before application and treat every visible existing body target URL as already
used.

If the Doc already ends with exactly one Heading 2 named `Links added for
review`, treat that heading and everything after it as the generated review
section. Exclude it from planner input, body-link uniqueness checks, topic
matching, and placement counts. Treat all preceding content as the protected
original body. If the heading is duplicated, ambiguous, or not the final
section, stop instead of guessing which content is generated.

Store one planner input per Doc:

```json
{
  "document_url": "https://docs.google.com/document/d/.../edit",
  "title": "Finished bespoke page",
  "page_url": "",
  "main_keywords": ["example keyword"],
  "format": "html",
  "content": "<p>Finished page copy...</p>"
}
```

Do not infer that a blank `page_url` is an error. New pages often have no URL.

### 2. Build the deterministic plan

Run:

```bash
node <skill-dir>/scripts/plan_links.mjs \
  --input "<doc-input.json>" \
  --out "<doc-preliminary-plan.json>"
```

The planner reads the packaged snapshot of the canonical mass-creation
sources. It does not browse Canva, call Ahrefs, inspect SERPs, or invent targets.
It removes retired targets before candidate generation or historical-evidence
promotion.

It applies evidence in this order:

1. explicit destination mappings;
2. repeated human-added anchor-target pairs;
3. the existing candidate URL and anchor pool.

The ordinary planner remains local and does not query Google. After building
the preliminary plan, export its overlapping-anchor and multiple-target
conflicts. A live application run must resolve every detected conflict through
the Google SERP priority workflow before editing the Doc. The first result is a
priority only after the Create-versus-Template family rule, retired-target
filtering, and contextual safety checks. Follow
[google-serp-priority.md](references/google-serp-priority.md).

The Google resolver writes the decisions back into a separate application
plan. It may replace a preliminary placement only with a contextually accepted
Google winner. It cannot promote `review` or `reject`. A `skip`, `hold`,
`review`, or globally blocked `use` result becomes no link in the application
plan and remains recorded for audit.

Exact phrase matching generates candidates but does not authorize a placement.
The local contextual evaluator compares the anchor and sentence with the target
URL slug, title, target main keywords, source URL slug, source main keywords,
and repeated manual evidence. It assigns `accept`, `review`, or `reject`. Only
`accept` may enter the plan. `review` and `reject` remain in
`contextual_decisions` with scores and reason codes. Follow
[contextual-relevance.md](references/contextual-relevance.md).

It outputs exact paragraph, character, prefix, suffix, local match-index, and
paragraph-fingerprint locators for Chrome control. `locator.match_index` is
scoped to the planner's extracted plain text. It is not the occurrence number
in Google Docs Find, which searches the entire document case-insensitively.
Resolve a fresh whole-Doc occurrence before applying a link.

### 3. Resolve conflicts and validate without a human gate

Export conflicts from the preliminary plan:

```bash
node <skill-dir>/scripts/export_contextual_conflicts.mjs \
  --out "<run-dir>/contextual-conflicts.csv" \
  "<run-dir>"/*-preliminary-plan.json
```

If the CSV contains conflict rows, collect and prioritize Google evidence as
described in [google-serp-priority.md](references/google-serp-priority.md), then
connect its choices to each preliminary plan:

```bash
node <skill-dir>/scripts/resolve_google_conflicts.mjs \
  --plan "<doc-preliminary-plan.json>" \
  --serp-csv "<contextual-conflicts-google-priority.csv>" \
  --out "<doc-application-plan.json>"
```

Use the preliminary plan directly only when the conflict export is empty.
Never pass a conflict-bearing preliminary plan to the Doc application step.

Run:

```bash
node <skill-dir>/scripts/validate_plan.mjs \
  --for-application "<doc-application-plan.json>"
```

Repair deterministic failures before touching Google Docs. Do not show the user a
plan for approval. Validation is a machine safety step, not a human gate.

Hard rules:

- never link `viết CV xin việc`, including a shorter candidate anchor whose
  character range falls inside that complete phrase;
- route the exact normalized anchor `thiết kế` only to
  `https://www.canva.com/vi_vn/thiet-ke/`; never route that exact anchor to
  `https://www.canva.com/vi_vn/thiet-ke/app/`. A more specific anchor such as
  `thiết kế app` remains eligible for the App page when all other rules pass;
- never link the exact pair `hình thu nhỏ` →
  `https://www.canva.com/vi_vn/hinh-anh-dep-tren-mang-xa-hoi/mau/thumbnail-youtube/`;
- never link the exact pair `thang` →
  `https://www.canva.com/vi_vn/giao-an/mau/thang/`;
- use each normalized target URL at most once in the protected body, including
  existing body links;
- use each normalized anchor at most once in the protected body;
- preserve existing body links;
- skip self-links only when a nonblank `page_url` matches the target;
- never link the meta title, meta description, any Google Docs Title or
  Heading-styled text, markdown or HTML headings, overlapping ranges, or the
  source page's own main topic;
- treat the complete `How to steps` section as protected content, from that
  Heading 2 through the paragraph before the next Heading 2, and never add an
  internal link anywhere inside it;
- require accent-exact Vietnamese text and complete word boundaries;
- apply only candidates with an `accept` contextual-relevance decision;
- require a final Google plan action for every detected conflict before live
  application;
- let Google choose only among `accept` candidates, never promote `review` or
  `reject`, and fail closed by omitting `skip`, `hold`, `review`, or blocked
  `use` candidates;
- keep `review` and `reject` candidates visible in the plan but never apply them;
- allow at most one link per sentence and two per paragraph;
- by default, add at most 12 automatic links and require no minimum; this is a
  configurable local safety ceiling, not a Google Docs, Canva, or SEO limit;
- skip ambiguous or stale locators instead of guessing.

### 4. Apply directly with background Chrome control

Follow [chrome-apply.md](references/chrome-apply.md). Use the Chrome extension profile named by
`GOOGLE_DOCS_INTERNAL_LINKER_CHROME_PROFILE` when configured. Otherwise use the
only authenticated work Chrome extension profile; stop if the choice is
ambiguous. Use `cua_repl` browser extension controls, not native desktop control
or a replica profile. Operate a claimed background tab without activating,
raising, or focusing it.

The user's invocation authorizes routine link edits to the specified Docs. Do
not ask for a separate review or confirmation before applying validated links.

Select only the existing anchor characters and add the URL with Google Docs'
link command. Never replace the original body or paste regenerated content.

After auditing the body links, append or update exactly one bottom section:

```text
Links added for review

- anchor text → https://www.canva.com/vi_vn/target/
```

Format the label as Heading 2 and each placement as a bullet. If there are no
audited links to list, write `No links were added.` below the label. Follow
[chrome-apply.md](references/chrome-apply.md) for rerun and verification rules.

### 5. Verify and report

After each Doc:

- prove the protected original body text did not change;
- prove every applied destination appears once in the protected body;
- confirm the selected anchor points to the planned target and is visibly
  styled as a Google Docs hyperlink, not only linked in metadata;
- confirm exactly one `Links added for review` section is the final Doc section
  and matches the verified body links managed by this skill;
- record applied, skipped, and failed placements with reasons;
- reopen or refresh when necessary to confirm the Doc saved.

Write `audit.json` and return a compact per-Doc summary. Every audit item must
include `anchor`, `target_url`, `target_title` when known, `status`, and a reason
for non-applied items. Do not auto-remove an existing duplicate or rewrite copy.
The user will adjust links in document context.

End the response with `Links added for review`. Group links by Doc and list
every placement whose audited status is `applied` as:

```text
- anchor text → https://www.canva.com/vi_vn/target/
```

Build both the in-Doc section and the response section from post-run
verification, not the plan. Exclude preserved pre-existing, skipped, and failed
links. If there are no verified skill-managed entries, say `No links were
added.` This consolidated section is mandatory so the user can review all additions
at once.

## Completion

Complete only when every supplied Doc is `applied`, `partially_applied`, or
`skipped` with an explicit reason, every plan passes deterministic validation,
the post-run audit accounts for every planned placement, exactly one verified
`Links added for review` section is at the bottom of each Doc, and the final
response contains the same consolidated section.
