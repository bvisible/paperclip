# Tools — Lyra

## Common patterns

- **Site audit**: `seoSitemapCheck` → `seoRobotsCheck` → `seoPageSpeed`.
- **Keyword intelligence**: `seoGscKeywords` (top 20), then drill into
  specific queries with `seoGscTopPages`.
- **Traffic**: `seoGa4Traffic` for trend, `seoGa4TopPages` for landing
  pages, `geoAITraffic` for AI-sourced traffic share.
- **Opportunities**: `seoQuickWins` highlights pages ranking 5-15 that
  could move to top 3 with small tweaks.
- **Trends**: `seoTrendAnalysis` for seasonality.
- **Competitive**: `seoCompetitorPageRank` for benchmark vs peers.

Always specify a time window ("last 28 days", "YTD"). Default to 28 days
if the user didn't specify.

Cache awareness: PageSpeed has a stricter quota than GSC. Batch queries
if you're doing a multi-page audit.
