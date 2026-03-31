# Marketplace Listing Coordinates Backfill

## Background

Marketplace listings created before the distance-filter feature was added
do not have `locationCoordinates` stored in the database. The distance filter
only applies to listings that have `locationCoordinates`; listings without them
are included in all results regardless of radius.

Running the backfill geocodes each legacy listing's `location` string via the
[postcodes.io](https://postcodes.io) API and stores `{ lat, lng }` in
`locationCoordinates`, making those listings filterable by distance.

## When to Run

Run this once after deploying the distance-filter feature (PR #862 /
`copilot/fix-marketplace-feature-issues`), and again after any bulk import of
listings without coordinates.

## Requirements

- `MONGODB_URI` environment variable pointing at your MongoDB instance
- Node.js 18+ (uses the built-in `fetch` API)
- Network access to `api.postcodes.io` (UK only; free, no API key required)

## Usage

```bash
# Preview what would be updated without writing to the database
node scripts/backfill-marketplace-coordinates.js --dry-run

# Run for real (geocodes and updates all missing listings)
node scripts/backfill-marketplace-coordinates.js

# Process only the first 50 listings (useful for staged rollout)
node scripts/backfill-marketplace-coordinates.js --limit 50

# Dry run for first 10 listings
node scripts/backfill-marketplace-coordinates.js --dry-run --limit 10
```

## What it Does

1. Queries `marketplace_listings` for documents with a non-empty `location`
   string but without `locationCoordinates`.
2. For each matching listing, calls `api.postcodes.io/postcodes/{postcode}` to
   resolve the location to `{ lat, lng }`.
3. Writes `locationCoordinates: { lat, lng }` back to the document.
4. Rate-limits geocode requests to **10 per second** to stay within postcodes.io
   fair-use limits.
5. Skips listings it cannot geocode and logs a warning for each (non-fatal).

## Output

```
[INFO] Starting marketplace coordinates backfill...
[INFO] Found 42 listing(s) without locationCoordinates
[INFO] [1/42] Processing listing abc123: "Cardiff"
[INFO]   → 51.4816, -3.1791
[INFO] [2/42] Processing listing def456: "SW1A 1AA"
[INFO]   → 51.5014, -0.1419
[WARN] [3/42] Could not geocode "Unknown Town" — skipping
...
=== Backfill complete ===
Processed : 42
Updated   : 40
Skipped   : 2 (could not geocode)
Failed    : 0 (database write errors)
```

## Limitations

- Only UK postcodes and postcode-like strings are geocoded (postcodes.io
  is UK-only).
- Free-text city or town names are attempted via postcodes.io but may not
  resolve (listings with town names like "London" will likely be skipped).
- The script is idempotent: running it twice will not overwrite coordinates
  that were set by the first run (those listings no longer match the query).

## Production Notes

- The script is safe to run while the app is live; it only writes to documents
  that do not already have coordinates.
- For large datasets, use `--limit` to process in batches and monitor for
  rate-limit errors.
- If postcodes.io is temporarily unavailable, re-run the script once it
  recovers; the query will only pick up listings that are still missing
  coordinates.
