# Ahrefs access and recipes

Read before research. These recipes were checked against Ahrefs MCP `doc` on
2026-10-29. Read `doc` before first use of each endpoint in a new chat; live
documentation takes priority. Discover tools by endpoint name across clients.

## Access and cost

Use Ahrefs MCP for ranking-page keywords and final exact-query volumes. Do
not use its SERP endpoint in this workflow. `doc` and `subscription-info-limits-and-usage` are free. Do
not make paid sample requests just to validate the skill.

Estimate a bounded Ahrefs plan covering unique URL pulls, deeper pulls, and
final volume verification. SERPs come from the DataForSEO API; exclude them
from Ahrefs units and account for their USD charges separately. Cost is normally `max(50, rows × field costs)`;
count each field once across select, filters, and sorting. Verify live costs.
`volume` and `sum_traffic` each cost 10 units per row.

Check finite workspace and API-key remaining quotas and use the smaller as
the effective remaining quota; ignore unlimited caps. Estimate maximum calls,
rows, and units without pausing for approval. Research calls are authorized by
invocation of this skill. Do not request cost confirmation or an allowance.
Respect actual quota and any explicitly supplied budget. Reduce scope if quota
is insufficient. Record actual response costs and cache hits.

The signed-in Ahrefs UI is an alternative when requested or the API is
unavailable. Use available browser controls. Verify active country, query,
exact URL scope, and complete export. Preserve exports and source dates. UI
research consumes no API units but may have account/export limits. Check metric
basis before combining UI and API values. Do not silently substitute another
paid provider or initiate login from an expiry notice.

## Exact ranking-page keywords

Endpoint: `site-explorer-organic-keywords`

```json
{
  "target": "<selected URL>",
  "mode": "exact",
  "country": "VN",
  "date": "<research date YYYY-MM-DD>",
  "volume_mode": "average",
  "limit": 40,
  "order_by": "sum_traffic:desc",
  "select": "keyword,volume,best_position,sum_traffic",
  "where": "{\"field\":\"best_position_kind\",\"is\":[\"eq\",\"organic\"]}"
}
```

Read `keywords`. The filter field is `best_position_kind`, not `_merged`.
Documented worst-case cost is `40 × (1 + 10 + 1 + 10 + 1) = 920` units.
Extra filters can change cost. Brand and relevance review happen locally.

Set `volume_mode=average` explicitly; the default is monthly. Preserve that
setting. Final verification uses Keywords Explorer's 12-month average; flag
unresolved differences rather than assuming default organic volume is equal.

Use exact URL scope. Domain metrics and batch analysis cannot replace page
keyword extraction. No keywords for one URL does not prove no topic demand.
Inspect another relevant ranking page.

When the cap hides relevant coverage, consider 100 rows for that page within
available quota and any explicitly supplied budget. Account for the full request and do not append its repeated
first 40 rows as new observations. Keep requests and their provenance separate.

## Final exact-query volume

Endpoint: `keywords-explorer-overview`

```json
{
  "country": "VN",
  "keywords": "<comma-separated exact queries>",
  "select": "keyword,volume",
  "limit": 100
}
```

Batch up to 100 unique queries, or the smaller documented request limit. Set
`limit` to the actual batch size. `volume` is estimated average monthly searches
over the latest known 12 months. Request canonical forms and material raw
variants needed for ambiguity checks. Cost is `max(50, n × 11)` at documented
prices. Include these calls in the cost estimate; proceed without a confirmation prompt.

Map responses by exact returned query, never list order. Identify missing
queries. A query containing a comma needs a documented input alternative or UI
lookup; do not silently split it or auto-create a persistent Ahrefs list.

If verification is unavailable or exceeds actual quota or an explicitly supplied budget, use a compatible,
documented observation and label its source, or mark the metric unknown. Never
fabricate a metric or conceal a basis change. KD, CPC, Parent Topic, global
volume, and historical series are not required by default. Honor any
`render_with` requirement before presenting its response.
