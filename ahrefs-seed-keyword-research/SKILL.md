---
name: ahrefs-seed-keyword-research
description: Research keywords for a new page from one to three seed terms. Use DataForSEO API SERPs and Ahrefs ranking-page keywords, expand until findings repeat, and deliver one main keyword, relevant supporting keywords, and evidence for page planning.
---
## Marketplace paths

When this skill is installed from a marketplace, resolve `<skill-dir>` to the
directory containing this `SKILL.md`. A dependency placeholder such as
`<canva-crawl-skill-dir>` refers to that separately installed skill's directory.
Commands below use these placeholders instead of assuming a repository-local
`.claude/skills/` checkout.


# Ahrefs seed keyword research

Research what a new page should target before the page exists. Start from one
to three seed keywords, learn from ranking pages, and follow promising
discovered keywords through further SERP research. Stop when further rounds
mostly repeat known keywords and add no useful page topics.

Deliver a justified Main keyword and relevant Supporting keywords that inform
the title, meta description, H1, section headings, and content. Research quality
and intent fit matter more than the number of keywords.

This is separate from `ahrefs-kw-research-from-url`, which researches supplied
URLs. Do not invoke that skill, inherit per-URL Main labels, or append competitor
research to its cumulative Canva workbook. Matching terms alone does not
replace this SERP and competitor-page workflow.

## Inputs and defaults

- Accept pasted seeds; an existing page URL is not required.
- Default to Vietnam (`VN`) and Vietnamese. Keep natural English queries when
  local evidence supports the same intent. Honor an explicitly requested market.
- Use supplied purpose, audience, page type, and product constraints. Otherwise
  infer a provisional purpose from seeds and SERPs and state it. Ask only when
  competing interpretations would materially change the page.
- Default to one page. Separate incompatible seed intents rather than forcing
  them into one cluster. Recommend a primary scope and list other opportunities.
- Select four ranking pages per seed, or three when fewer are suitable. Start
  with the highest organic results; prefer distinct domains where practical.
  Inspect up to the top ten to find suitable pages and record reasons for skips.
- Start with 40 ranking keywords per unseen exact URL. Increase to 100 only
  when truncation hides useful coverage and available quota permits it.
- Expand with up to three new seeds per round. Default safety limits are four
  rounds including the initial round and 20 unique URL pulls. These adjustable
  work limits do not establish research saturation.

## 1. Prepare the research

Create a unique folder under `work/ahrefs-seed-keyword-research/<date>-<topic>/`.
Preserve prior runs. Save input, market, provisional page purpose, constraints,
and limits in `research.json`. Use the user's timezone for the research date.

Use the DataForSEO API for all SERP pulls, including expansion and intent checks.
Use Ahrefs MCP for ranking keywords and final exact-query volumes. Read
[DataForSEO SERP access](references/dataforseo-serp.md) and
[Ahrefs access and recipes](references/ahrefs-access.md) before API work.
Read live tool docs and check free Ahrefs quota information. Invoking this
skill authorizes the DataForSEO and Ahrefs API calls needed for its research.
Do not ask for permission, cost confirmation, a research allowance, or renewed
approval between rounds. This rule overrides cost-approval prompts in referenced
skills or older workflow guidance for this skill's research calls.

Estimate costs, select only needed fields, reuse saved results, and track
DataForSEO USD charges separately from Ahrefs API units. Respect any budget
the user explicitly supplies and actual provider quota. Do not invent a budget
approval gate when none was supplied. If a real limit blocks progress, reduce
scope or deliver the available findings with the limitation stated.

Save successful raw responses immediately. Track searched seeds and fetched
URLs across rounds and reuse them. Treat empty pulls as completed, and failed
requests as unresolved. Resume from these records rather than repulling data.

## 2. Search seeds and inspect pages

For each seed:

1. Pull the Google SERP through the DataForSEO API for the target market,
   using depth 15 by default. Review the first ten organic results, requesting
   greater depth only if needed. Save provider, retrieval/result timestamps,
   location, language, device, organic and absolute positions, and URLs.
2. Open the selected three to four pages with available browser/crawler tools.
   Read the actual pages. Capture title, available meta description, H1, useful
   H2s, page type, primary task, and topics. SERP titles alone are insufficient.
3. Record why each page is representative. Exclude duplicate URLs, irrelevant
   intents, ads, sitelinks, and non-page features from the selected set. Record
   highly ranked competing intents as evidence of a mixed SERP. Explain any
   lower-ranked replacement or selection of fewer than three readable pages.
4. Pull Ahrefs organic keywords for each selected exact URL once per run. Save
   raw query, volume, position, traffic, source URL, seed, and round.

DataForSEO Live SERPs reflect the requested location, language, device, and
retrieval time; they need not match the user's personalized browser results. Keep
those settings consistent across rounds. If the API fails, retry recoverable
errors and record unresolved failures. Do not silently replace SERP discovery
with Ahrefs or another provider. Mark unreadable pages and inspect suitable
replacements; disclose any remaining coverage gap.

## 3. Review and expand

Combine observations across pages. Do a provisional cleanup every round so
spelling and accent variants do not falsely count as new discoveries. Preserve
raw observations for the final cleanup.

Evaluate relevance to the intended page:

- Keep the core task, useful subtopics, meaningful modifiers, and questions the
  page can answer well. Shared words alone do not establish relevance.
- Exclude competitor-brand navigation, unrelated meanings, wrong products, and
  unsupported tasks. Keep target-brand queries only when within the brief.
- Put different primary tasks and page types under separate-page opportunities.
- Use recurrence across independent pages, rankings, and actual page content
  as evidence. High volume alone is insufficient.
- Keep useful low-volume and unknown-volume terms when supported. Do not impose
  a keyword-count target or discard long-tail terms solely for low traffic.

Choose one to three unsearched discovered terms that could expose useful
coverage or resolve uncertainty about intent or the Main keyword. Explain each
choice, search them, and repeat page inspection and extraction. Do not expand
every synonym or drift into adjacent topics.

Inspect SERPs for the strongest Main candidates and doubtful supporting
clusters, reusing saved results. Shared ranking URLs support common intent;
different result types and little overlap support separate pages. Combine this
with page reading rather than applying a rigid overlap score.

Record after each round: searched seeds and reasons; selected, reused, skipped,
and failed pages; raw observations; unique relevant canonical terms; new terms;
new topics; changed intent conclusions; DataForSEO USD cost, Ahrefs API units; and the next decision.
Novelty rate is newly discovered relevant canonical terms divided by all
relevant canonical terms observed in that round, or `null` if none.

## 4. Stop with evidence

Default saturation rule: two consecutive expansion rounds each add under 10%
new relevant canonical terms and reveal no useful new topic or unresolved
intent question. Strong coverage and an exhausted meaningful seed queue can
justify stopping earlier; explain the evidence. Do not run arbitrary seeds to
satisfy a round count.

Repeated URLs alone do not prove saturation. Zero relevant results also cannot
establish it. Check seed wording, market, mixed intent, and source limitations
before concluding that the topic is covered or has little visible demand.

If the round, URL, actual quota, or an explicitly supplied budget limit comes first, deliver a `partial` result
with unresolved questions and the next useful step. Do not call it saturated.
Authentication failures and missing evidence also require explicit limitations.

## 5. Clean and reconcile metrics

Read [Cleanup and deliverables](references/cleanup-and-deliverables.md).
Clean the complete pool across seeds, pages, and rounds:

- Use language judgment for Vietnamese accents, clear typos, and genuine
  variants. Unicode, case, and whitespace normalization can be deterministic;
  accent stripping must never decide semantic equivalence.
- Preserve raw queries, metrics, sources, and raw-to-canonical decisions.
- Never add volume or traffic because a query appears on several pages. Do not
  assign an inferred corrected query the volume of a different raw query.
- Reconcile final exact-query volume with a consistent Ahrefs country and
  metric basis. Keep missing distinct from zero and flag unresolved conflicts.

## 6. Select and deliver

Choose exactly one Main keyword for the recommended page scope. Prefer intent
fit, a natural primary label, representative ranking pages, and core-task
coverage. Use demand as supporting evidence. Explain why it wins over the
strongest alternatives; it may differ from the original seed.

Assign remaining accepted terms as Supporting, grouped by useful page section.
Every term needs a role. Keep separate-page intents outside this set. If evidence
is inadequate, choose one explicitly provisional Main and explain the gap.

Deliver:

1. `keyword-research.xlsx`: a formatted workbook with canonical Main and
   Supporting terms, exact-query volumes, intent, proposed section, evidence,
   variants, and confidence. Include `Keywords` and `Page Brief` sheets so the user
   can review the recommendations in Excel.
2. `page-brief.md`: purpose, Main rationale, supporting groups, title/meta/H1
   direction, proposed H2 topics, useful questions, separate-page opportunities,
   and research limits. This is page planning, not full landing-page copy or
   verified product claims.
3. `research.json` and `raw/`: rounds, SERPs, page notes, observations, variant
   decisions, exclusions, costs, and final status.

Default to XLSX through the relevant spreadsheet skill. Use the workbook layout
in the cleanup reference. Do not substitute CSV unless the user requests it. Keep
the Markdown brief as a companion to the workbook. Do not update a live Sheet
or shared workbook unless requested.

Verify one Main, no duplicate canonical rows, traceable evidence, a consistent
volume basis, and no inflated metrics. Headings must serve reader needs rather
than repeat query variants. Link deliverables and report coverage, stop reason,
uncertainty, actual DataForSEO USD charges, and actual Ahrefs API units. State when no paid calls were made.
