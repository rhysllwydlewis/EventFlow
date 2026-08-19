# SEO indexing governance rollout

This change alters eligibility and canonicalisation only. It does not delete production data.

## Pre-deploy

1. Run `npm run test:seo-integrity`.
2. Start EventFlow locally and run `npm run seo:sitemap:verify`. Every emitted URL must finish at HTTP 200, be indexable, have a unique sitemap location, and self-canonicalise.
3. Produce a read-only record report with `npm run seo:quarantine:dry-run -- --json artifacts/seo-before.json`.
4. Review every non-confirmed row. Record human decisions in a signed JSON file:

```json
{
  "schemaVersion": 1,
  "reviewedBy": "operator@example.com",
  "reviewedAt": "2026-08-19T12:00:00.000Z",
  "decisions": [
    { "collection": "suppliers", "id": "supplier-id", "decision": "quarantine", "reason": "confirmed fixture" },
    { "collection": "packages", "id": "package-id", "decision": "keep", "reason": "real listing" }
  ]
}
```

## Deploy and cleanup

1. Deploy application code first. Confirm `/robots.txt` and `/sitemap.xml` return 200.
2. Run another dry run against production and archive the JSON.
3. Apply only reviewed decisions: `npm run seo:quarantine:apply -- --review-file review.json --json artifacts/seo-after.json`.
4. Compare each row's `before`, `after`, reviewer and reason. No unmatched heuristic-only row may be changed.
5. Run the sitemap verifier against production with `SEO_AUDIT_BASE_URL=https://event-flow.co.uk npm run seo:sitemap:verify`.

## Search Console follow-up

Submit the current sitemap, inspect representative supplier/package/category/calendar URLs, then monitor Pages, sitemaps and performance weekly for four weeks. Do not use “Validate fix” for exclusions that are intentional `noindex`, redirects or canonicals.

## Rollback

Roll back the application release first. Restore only reviewed cleanup rows from the archived `before` values (`approved` and quarantine fields), record who restored them and why, regenerate the sitemap, and rerun the full verifier. Never bulk-delete or infer restoration targets from a name search.

## Explicit deferrals

Thresholds are policy values and should be reviewed after enough real inventory and Search Console data exists. This PR does not promise ranking gains, manipulate structured review data, or mutate production records during deployment.
