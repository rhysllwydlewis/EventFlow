# UK city hub-and-spoke

EventFlow's location section is a hub (`/locations`) with a spoke per city
(`/locations/:citySlug`). This document describes what shipped, how the data
model works, how a page reaches the index, and how to migrate existing supplier
records onto it.

## Design rules

Three rules explain most of the decisions below.

1. **A reachable page and an indexable page are different things.** Publication
   makes a page public. Indexing additionally requires an editor to ask for it
   _and_ a measurable quality gate to pass. Neither alone is enough.
2. **Ambiguous data is never promoted into a public claim.** A free-text
   location that merely mentions a city is queued for a human, not mapped.
3. **Every result is explainable.** A supplier on a city page carries the reason
   it is there: `Based in Cardiff`, `Serves Cardiff`, or `18 miles away`.

## Data model

### City registry — `data/uk-cities.json`

The authoritative list of places EventFlow recognises. It is repository-backed
so a city entity cannot appear or vanish because a database write failed. Each
entry has a slug, canonical name, alternative names, nation, region, centre
coordinate, default service radius and nearby slugs.

`services/locationRegistry.service.js` loads and validates it on first use.
Validation is strict and throws: a malformed registry is a deployment error, not
a runtime condition to work around. It checks slug format, coordinates inside
the UK bounding box, radius bounds, unique slugs, unique aliases and that every
nearby slug resolves.

Cardiff and Caerdydd are one entity. Alternative names — including the Welsh
names for Cardiff, Swansea, Newport and Wrexham — resolve to the canonical
English slug. There are no Welsh URLs and no `hreflang`: that waits for a
genuinely translated `/cy/` experience rather than mixing languages on an
English canonical page.

### Editorial state — `location_pages` collection

Everything editorial or operational lives in MongoDB, keyed by registry slug:

| Field                                                       | Meaning                                              |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `status`                                                    | `draft`, `review`, `pilot`, `published` or `retired` |
| `indexingRequested`                                         | An editor has asked for this page to be indexed      |
| `seo.title`, `seo.metaDescription`                          | Editor overrides for the generated metadata          |
| `content.intro`, `content.planningSections`, `content.faqs` | Local copy                                           |
| `content.heroImageUrl`, `content.heroImageAlt`              | Hero media                                           |
| `lastReviewedAt`, `reviewedBy`                              | Human review record                                  |
| `publishedAt`, `updatedAt`                                  | Timestamps used by the sitemap                       |

A city with no record is a draft. Adding a city to the registry never publishes
anything.

### Supplier geography

Two new supplier fields, both additive. The legacy `supplier.location` string is
untouched and stays readable throughout the migration.

```json
{
  "baseLocation": {
    "displayName": "Cardiff, Wales",
    "postcode": "CF10 1AA",
    "citySlug": "cardiff",
    "nation": "Wales",
    "coordinates": { "type": "Point", "coordinates": [-3.1791, 51.4816] },
    "source": "postcode_lookup",
    "confidence": "high"
  },
  "serviceAreas": [
    { "type": "city", "slug": "cardiff", "source": "supplier_selected" },
    { "type": "radius", "miles": 35, "source": "supplier_selected" }
  ],
  "travelPolicy": { "nationwide": false }
}
```

Coordinates are GeoJSON `[longitude, latitude]` everywhere, matching the rest of
the platform. `source` and `confidence` are stored so a mapping can always be
traced back to how it was made.

#### Where `baseLocation` comes from

`supplierLocation.deriveBaseLocation()` runs whenever a supplier creates or
edits their profile, so a mapping is maintained by the platform rather than by
the one-off backfill. Signals are tried in order of how far they can be trusted:

| Order | Signal                                               | Source          | Confidence |
| ----- | ---------------------------------------------------- | --------------- | ---------- |
| 1     | `basePostcode`, `venuePostcode` or `postcode`        | postcode_lookup | high       |
| 2     | `latitude`/`longitude` the platform already geocoded | postcode_lookup | high       |
| 3     | Legacy `location` that is exactly a city name        | registry_name   | high       |
| —     | Anything else                                        | —               | unmapped   |

Nothing below that bar is guessed at. An unmapped supplier gets
`locationMappingReviewRequired: true` and is absent from the city pages until a
human resolves it, which is recoverable; a wrongly placed supplier is not. Two
further rules protect existing decisions:

- A `baseLocation` whose source is `admin_verified` is never overwritten by a
  profile edit.
- Re-derivation only runs when an edit actually changes `location`,
  `basePostcode`, `venuePostcode` or the coordinates, so unrelated edits cost no
  geocoder call and cannot disturb a good mapping.

Suppliers set this themselves on the profile form: an optional base postcode
(never shown publicly — only the city it falls in), a travel radius in miles and
a "whole UK" checkbox, which the client translates into the `serviceAreas`
shape. The API re-validates everything through `sanitiseServiceAreas()`:
unknown cities, out-of-range radii and unrecognised types are dropped rather
than stored as coverage the pages would not honour.

## Matching and ranking

`services/supplierLocation.service.js` resolves a supplier against a city in a
fixed precedence order — the first match wins:

1. **based_in** — the supplier's base city slug is this city.
2. **serves** — the supplier explicitly lists this city as a service area.
3. **radius** — the supplier's base coordinate is within its declared travel
   radius of the city centre, measured with the existing Haversine helper.
4. **nationwide** — the supplier claims UK-wide cover.

Nationwide suppliers are a fallback, never a local leader. A supplier based in
the city is never demoted to "serves" because it also listed a service area.

Ranking is `relationship weight + quality + capped tier boost`. The tier boost
is capped at **15**, deliberately below the narrowest gap between relationship
tiers (20). A distant Pro supplier therefore cannot displace an equally strong
local match on subscription alone; the boost only breaks ties within a tier.
There is a test asserting that relationship, and it should stay.

Result integrity: unapproved, suspended, test, soft-deleted and orphaned
supplier records are excluded, and duplicate records for the same business are
collapsed to their strongest relationship before ranking.

## Indexability quality gate

`services/locationPage.service.js` scores six independent signals, each against
its own target rather than a single hard-coded supplier count:

| Signal             | Weight | Full marks at              |
| ------------------ | ------ | -------------------------- |
| Supplier depth     | 25     | 8 eligible suppliers       |
| Category diversity | 20     | 4 categories               |
| Local content      | 20     | intro + 1 planning section |
| Proof of activity  | 15     | 3 packages/events/reviews  |
| Internal links     | 10     | 2 published nearby pages   |
| Review freshness   | 10     | reviewed within 365 days   |

The pass mark is 60. Alongside the score, a page must be `published`, have
`indexingRequested`, have a local introduction and have been reviewed by a
person within the last year. Anything missing is returned as a named blocker, so
the admin screen can explain a refusal rather than showing a red light.

Failing the gate does not hide the page: it serves 200 with `noindex, follow`
and is absent from the sitemap.

## Routes

| Route                                    | Behaviour                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /locations`                         | Hub. Lists published cities grouped by nation, with crawlable `<a href>` links. Indexable once at least one city is published.                         |
| `GET /locations/:citySlug`               | City page. 200 when published or in pilot; 301 from any alias or non-canonical spelling; 404 for unknown slugs and for draft, review or retired pages. |
| `GET /locations/:citySlug/:categorySlug` | Reserved. 404 unless `LOCATION_CATEGORY_PAGES=true`; redirects to the city page while the pages are unbuilt.                                           |

Both pages are fully server-rendered and mounted before `express.static()` so
the shells never ship with unfilled placeholders. Modules with nothing reliable
to show — packages, events, categories, nearby areas — are omitted entirely
rather than rendering an empty shelf, and a supplier count is shown only when it
is a real, current number.

Structured data is a `BreadcrumbList` on every page plus a `CollectionPage` with
an `ItemList` of supplier profiles on indexable city pages. There is deliberately
no `LocalBusiness` markup: EventFlow has no branch in these cities, and that
markup belongs only on an individual supplier's own page.

## Sitemap

`sitemap.js` runs the same gate the pages use, so the sitemap cannot advertise a
URL that returns `noindex`. A page leaves the sitemap automatically when it is
unpublished, when indexing is withdrawn, or when its inventory or review date
decays past the gate. `lastmod` is the page's real content date — never the time
the sitemap was generated. The hub is listed only when at least one city page is
indexable.

## Admin

`/admin-locations` lists every registry city with its state, quality score,
blockers and editorial warnings, backed by `/api/v1/admin/locations`
(admin-only, CSRF-protected, audit-logged).

Warnings cover duplicate titles, duplicate descriptions, duplicate copy, copy
that differs from another city only by the city name, planning sections quoting
figures without a source, weak inventory, missing nearby links and indexing
requested while the gate fails.

Marking a page reviewed is an explicit action (`markReviewed: true`) with the
reviewer's identity recorded; it never happens as a side effect of saving a typo
fix.

Workflow: `draft → review → pilot → published (noindex) → indexable → periodic
review`.

## Migrating supplier locations

```bash
node scripts/audit-supplier-locations.js                  # dry run, prints a report
node scripts/audit-supplier-locations.js --json audit.json
node scripts/audit-supplier-locations.js --apply          # writes high-confidence mappings only
node scripts/audit-supplier-locations.js --apply --limit 50
```

The script classifies every supplier as `already_mapped`, `high_confidence`,
`review_required` or `unmapped`.

- An exact match on the whole legacy string ("Cardiff", "Caerdydd") is a
  high-confidence mapping.
- A valid postcode resolved through Postcodes.io is a high-confidence mapping,
  and is preferred over the free text.
- "Cardiff and South Wales" names a city _and_ claims a wider area, so it is
  review-required with a suggested slug — never mapped automatically.
- Text naming two cities is review-required with no suggestion.
- Everything else is unmapped.

Only high-confidence rows are written, and only under `--apply`. The legacy
`location` string is never modified, so the migration is reversible: dropping the
`baseLocation` field returns a record to its previous behaviour.

The script and the live write path share `buildBaseLocationDocument()`, so a
supplier mapped by the backfill and one mapped by their own profile edit end up
with byte-identical structure. Suppliers the script leaves as `review_required`
or `unmapped` are counted in the admin Location Pages summary, so the backlog
stays visible after the migration report has been closed.

## Rollback

- **A single page:** set its `status` to `draft` or `retired` through the admin
  API. It leaves the sitemap and returns 404 (or, for pilot, 200 + noindex) on
  the next request; the read cache is cleared on write.
- **The whole section:** remove the two `app.use(require('./routes/locations'))`
  mounts. Nothing else on the platform reads `location_pages`, and supplier
  records keep working from their legacy `location` string.
- **The migration:** unset `baseLocation` on affected suppliers. No legacy field
  was overwritten.

## Analytics

Page views carry `page_type` (`locations_hub` or `location_city`) and
`location_slug`, taken from meta tags the server renders. Supplier impressions
and clicks carry the supplier ID and the relationship type. No visitor postcode
is written to analytics in any form: the location dimension is always a
published city slug.

## Tests

| File                                                | Covers                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `tests/unit/location-registry.test.js`              | slugs, aliases, validation, distance, postcode resolution                           |
| `tests/unit/supplier-location-matching.test.js`     | legacy classification, service areas, relationship precedence, ranking, eligibility |
| `tests/unit/location-page-quality.test.js`          | publication states, quality gate, metadata, structured data                         |
| `tests/unit/location-sitemap.test.js`               | sitemap inclusion and automatic removal                                             |
| `tests/unit/location-indexes.test.js`               | index manifest                                                                      |
| `tests/unit/supplier-location-audit-script.test.js` | dry-run safety and apply behaviour                                                  |
| `tests/unit/supplier-location-write-path.test.js`   | live derivation on profile create/edit, coverage validation, geocoder failure       |
| `tests/integration/locations-pages.test.js`         | status codes, redirects, headers, escaping, module omission                         |
| `tests/integration/admin-locations-api.test.js`     | access control, workflow, warnings, input limits                                    |
| `e2e/locations.spec.js`                             | browser suite; requires `E2E_MODE=full` because the pages need real data            |

## What is deliberately not here

- **Indexable city-category pages.** The URL is reserved and flag-gated. Each
  combination has to earn its own launch on its own evidence.
- **Welsh-language URLs or `hreflang`.** Aliases only, until a full `/cy/`
  experience exists and is maintained.
- **Fabricated local statistics.** Planning sections that quote figures without a
  source raise an editorial warning; no average price or availability claim is
  generated anywhere in this code.
