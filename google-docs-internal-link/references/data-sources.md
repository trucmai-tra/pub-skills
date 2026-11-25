# Canonical internal-link sources

The marketplace package includes sanitized snapshots of these sources. Read
them from `<skill-dir>/runtime/` and do not rebuild them during a normal Google
Docs run.

## Candidate URL and anchor pool

`<skill-dir>/runtime/data/candidates.json`

This is the primary static source for Canva VN destinations and possible
anchors. Each candidate includes URL, title, page type, scope state, traffic
evidence, main keywords, and anchor records.

The contextual evaluator builds the target topic from the URL slug, title, and
main keywords. Anchor records generate exact-text candidates. Traffic and
search volume remain tie-breakers; they do not override a contextual `review`
or `reject` decision.

## Retired targets

`<skill-dir>/runtime/data/retired-targets.json`

Exclude every target marked `retired` before using candidate records,
historical evidence, feedback, or explicit mappings. Historical rows may keep
the URL as an audit record, but they must never reactivate it as a target.

## Human feedback

`<skill-dir>/runtime/data/link_feedback.json`

- Repeated additions across distinct source pages create reusable positive
  evidence.
- One addition remains page-local evidence and must not become a universal
  mapping by itself.
- Removals are authoritative. Two or more source-page removals of the same
  anchor-target pair create a global block.

## Historical applied links

`<skill-dir>/runtime/data/internal-links.csv`

Use distinct manually added source-anchor-target rows as historical human
evidence. Do not feed automatic rows back into the learner, which would make
the system reinforce its own past output.

For Docs that the user explicitly identifies as manual-link examples, use
`scripts/import_manual_evidence.mjs`. Import only links labeled `reviewer_added` in
the calibration manifest. Exact duplicates in one Doc do not add evidence, and
reruns must remain idempotent. Keep targets missing from the candidate pool in
the historical CSV with an audit flag, but report that they cannot become
automatic placements after one source example. When the same exact
anchor-target pair recurs across at least two source pages, the local planner
may promote that missing Canva VN target into its runtime candidate set. This
does not modify the canonical candidate snapshot or promote unrelated anchors.
Repeated exact manual evidence may also admit a short learned anchor that the
general anchor-length filter would exclude. Keep one-off short anchors blocked.

When the examples revise a previous automatic run, use verified snapshot diffs.
Never import retained automatic output as manual evidence. Keep observations
marked `learning_status: hold` in the evidence manifest, outside training history.
The importer's `--import-confirmed-removals` option writes only verified removals
from unchanged paragraphs to the canonical feedback file. See
[revision-calibration.md](revision-calibration.md).

## Explicit mappings

`<skill-dir>/runtime/data/destination-mappings.json`

Apply these before learned or general candidates. A mapping is eligible only
when its target URL exists in the candidate pool and its exact phrase appears
naturally in body copy.

## Existing engine

`<skill-dir>/runtime/lib/linker.mjs`

Use the local deterministic engine through the bundled planner. Do not send
Google Doc content to the deployed API. Local execution avoids unnecessary external transmission and uses the
canonical snapshots bundled with the installed plugin.

## Missing sources

Fail before editing Docs when the candidate or feedback files are missing or
invalid. Report the missing path. Do not substitute web research, Ahrefs,
DataForSEO, or newly invented target URLs.
