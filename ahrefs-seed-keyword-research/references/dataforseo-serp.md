# DataForSEO SERP access

Use DataForSEO API for every initial seed, expansion seed, Main candidate, and
supporting-cluster SERP check. Ahrefs MCP supplies ranking keywords and final
search volumes, not SERPs.

Read the repository [DataForSEO skill](<dataforseo-skill-dir>/SKILL.md) before running
its local CLI. The CLI calls `POST /v3/serp/google/organic/live/advanced` and
reads `DATAFORSEO_API_KEY` from the process environment or the user's project `.env`. Set `DATAFORSEO_ENV_FILE` to the absolute project `.env` path when running from the installed dependency directory. Do not print
credentials or create another `.env`.

## Run a SERP pull

From the repository's `<dataforseo-skill-dir>/` directory:

```bash
python3 -m dataforseo serp \
  --keyword "<exact seed>" \
  --location 2704 --language vi --device desktop --depth 15 \
  --json --out /absolute/run/folder/raw/serp-round-01-seed-01.json \
  2> /absolute/run/folder/raw/serp-round-01-seed-01.log
```

Replace placeholders with real values, quote seeds safely, and create the run
folder first. Vietnam is location `2704`, language `vi`; use documented location
and language values for another requested market. Keep settings consistent.
One Live request contains one task. Reuse a saved seed/market/language/device
result within the run rather than paying for repeated research.

The CLI's JSON is a normalized export with `summary` and `results`, not the full
provider response. Each organic result includes `rank_absolute`, `rank_organic`,
URL, title, and description. Its intent label is a URL/domain heuristic;
inspect actual pages before making intent decisions. Select by organic rank,
not absolute rank, because other SERP elements can occupy intervening positions.

Record the request parameters, retrieval time, output path, and stderr cost in
`research.json`. If a provider result timestamp is unavailable in the export,
leave it unknown rather than inventing one. If full provider JSON is needed,
use the existing client's `post` method with the same endpoint and save the
response; do not change the shared CLI merely for this skill. Keep any full
responses separate from normalized exports.

Default depth 15 supports SERP context. Review the first ten organic results
and inspect three to four suitable pages. If fewer than ten organic results
are returned, record the actual count and deepen only when needed and within
available quota and any explicitly supplied budget. Preserve SERP feature notes as context, not selected page rows.

## Cost and failures

Estimate DataForSEO USD cost for all planned SERP calls separately from Ahrefs
API units. Check current pricing rather than treating the older skill's price
estimate as a guarantee. Record actual returned costs, including charged
failed requests or retries. Proceed without permission or cost-confirmation
prompts; invocation of this skill authorizes research calls.

Validate command success and nonempty usable results before advancing. Retry
recoverable failures within actual quota and any explicitly supplied budget; report persistent authentication,
quota, or response failures and deliver partial research where appropriate.
Keep SERP pulls on DataForSEO. Report a provider failure instead of introducing
a permission prompt to switch providers.

Endpoint and one-task request constraint verified on 2026-10-29 against the
[official DataForSEO documentation](https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/).
