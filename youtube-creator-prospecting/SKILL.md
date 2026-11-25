---
name: youtube-creator-prospecting
description: "Build Vietnamese YouTube channel outreach prospect lists from a Canva Vietnam target URL. Use for approved query discovery, Google-visible videos, channel enrichment, public About-page links and emails, language evidence, or a prospecting workbook."
---
## Marketplace paths

When this skill is installed from a marketplace, resolve `<skill-dir>` to the
directory containing this `SKILL.md`. A dependency placeholder such as
`<canva-crawl-skill-dir>` refers to that separately installed skill's directory.
Commands below use these placeholders instead of assuming a repository-local
`.claude/skills/` checkout.


# Canva YouTube Prospecting

Find standard YouTube videos visible in Google Vietnam for topics related to one
Canva Vietnam landing page, then aggregate the results into outreach-ready
channel prospects.

## Fixed Scope

- Require one `canva.com/vi_vn/` URL.
- Use Google Vietnam, Vietnamese, desktop.
- Measure Google visibility with `site:youtube.com`, not YouTube search ranking.
- Keep only standard `youtube.com/watch?v=` videos.
- Exclude Shorts, `/live/` URLs, channel URLs, playlists, and videos where
  DataForSEO Video Info returns `is_live=true`.
- Stop at prospect discovery. Extract only email addresses visibly published
  in the public channel description or About links.
- Do not bypass YouTube's CAPTCHA-protected business email flow, use logged-in
  browser automation to reveal hidden emails, crawl external sites for emails,
  draft outreach, or contact any channel.

## 1. Prepare the Target Folder

Install dependencies once if required:

```bash
python3 -m pip install -r \
  <skill-dir>/requirements.txt
```

Run:

```bash
python3 <skill-dir>/scripts/prospecting.py \
  prepare \
  --target-url "<canva-vn-url>"
```

The command creates:

```text
work/youtube-prospecting/<target-url-path>/
```

For example:

```text
https://www.canva.com/vi_vn/thiet-ke/video/
-> work/youtube-prospecting/vi_vn/thiet-ke/video/
```

It also creates `work/youtube-prospecting/readme.md` and a target-specific
`readme.md`. Keep every input, output, preview, and audit file inside the
target-specific folder.

## 2. Read the Canva Page

Use the `canva-crawl` skill in Markdown mode. Do not add another Canva crawler:

```bash
<canva-crawl-skill-dir>/crawl.sh \
  "<canva-vn-url>" \
  --md \
  --out "work/youtube-prospecting/<target-url-path>/target-page.md"
```

Read the title, headings, main copy, feature, audience, use cases, and outcomes.

## 3. Generate Queries and Stop for Approval

Generate 5-10 Vietnamese informational queries. Cover direct feature terms and
closely adjacent use cases where a creator could naturally make a tutorial,
comparison, workflow, or educational video.

Present:

| query | angle | relationship | rationale |
|---|---|---|---|

Do not add search operators. The collection script appends
`site:youtube.com`.

Stop before any DataForSEO call. The reviewer must approve, reject, edit, or add
queries.

After approval, write `approved-queries.csv` with UTF-8 BOM and preserve the reviewer's
exact edits:

```csv
query,angle,relationship,rationale
cách làm video bằng AI,AI video workflow,direct,Closely matches the target feature.
```

## 4. Collect and Enrich

Run:

```bash
python3 <skill-dir>/scripts/prospecting.py \
  collect \
  --target-url "<canva-vn-url>" \
  --queries "work/youtube-prospecting/<target-url-path>/approved-queries.csv"
```

The command:

- Executes each approved query as `<query> site:youtube.com`.
- Preserves Google `rank_absolute` for every SERP occurrence.
- Parses standard organic results and Google video modules.
- Audits but excludes Shorts, live URLs, and non-video YouTube URLs.
- Deduplicates videos by immutable video ID.
- Calls DataForSEO YouTube Video Info once per unique video.
- Deduplicates channels by immutable channel ID.
- Fetches each unique channel About page once.
- Records actual DataForSEO cost in `run-summary.json`.

### Data ownership

Use DataForSEO Video Info for:

- Canonical video title and URL.
- Video views, likes, comments, publication date, duration, tags, and category.
- Channel ID, name, URL, logo, and subscriber count.

Use the public channel About page only for:

- Public channel video count.
- Total channel views.
- Channel join date.
- Published website and social links.
- Publicly written email addresses, including multiple addresses.
- URLs present in the channel description.

Do not parse subscriber count from the channel page or overwrite Google rank
with Video Info's endpoint-local `rank_absolute`.

To refresh public About links and emails for an existing run without repeating
paid DataForSEO calls:

```bash
python3 <skill-dir>/scripts/prospecting.py \
  refresh-about \
  --target-url "<canva-vn-url>"
```

### Language evidence

`language_code=vi` means the request was localized to Vietnamese. It does not
prove the video's spoken language.

Use subtitle evidence:

- `vietnamese_spoken_signal`: Vietnamese auto-generated captions.
- `vietnamese_caption_available`: manual Vietnamese captions only.
- `non_vietnamese_spoken_signal`: auto-generated captions in another language.
- `unknown`: insufficient evidence.

Retain uncertain videos and expose the status for filtering. Do not silently
classify request locale as video language.

## 5. Build and Verify the Workbook

Use the spreadsheet artifact runtime. In Codex, call
`load_workspace_dependencies`, then use the returned Node executable and Node
package directory:

```bash
NODE_PATH="<workspace-node-modules>" \
  "<workspace-node>" \
  <skill-dir>/scripts/build_workbook.mjs \
  "work/youtube-prospecting/<target-url-path>/workbook-data.json" \
  "work/youtube-prospecting/<target-url-path>/youtube-prospects.xlsx" \
  "work/youtube-prospecting/<target-url-path>/previews"
```

The builder inspects key ranges, scans formula errors, renders every sheet, and
exports one workbook.

## Outputs

- `target-page.md`
- `approved-queries.csv`
- `executed-queries.csv`
- `raw-serp-results.csv`
- `auditor-video-queue.csv`
- `ranking-videos.csv`
- `channel-prospects.csv`
- `channel-links.csv`
- `language-audit.csv`
- `workbook-data.json`
- `youtube-prospects.xlsx`
- `previews/`
- `run-summary.json`

Workbook tabs:

1. `Auditor video queue`
2. `Channel prospects`
3. `Ranking videos`
4. `SERP evidence`
5. `Channel links`
6. `Language audit`

The `Auditor video queue` tab is the primary outreach-review surface. It has
one row per qualified non-live ranking video, with channel and contact fields
repeated for template mapping. Rows include channels without public emails so
the auditor can review or filter them manually. Sort order is channel
subscribers descending, then Google best rank absolute ascending within each
channel, then video views descending, then video title and video ID for stable
ties. `google_best_rank_absolute` is the Google Vietnam SERP rank for
`<query> site:youtube.com`, not native YouTube search rank.

All CSV files use UTF-8 BOM and escape formula-like text for spreadsheet safety.
