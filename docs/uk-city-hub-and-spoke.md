# UK city hub-and-spoke

EventFlow's location section is a hub (`/locations`) with a spoke per city
(`/locations/:citySlug`), and a further spoke per category within a city
(`/locations/:citySlug/:categorySlug`, e.g. "Wedding Venues in Cardiff"). This
document describes what shipped, how the data model works, how a page reaches
the index, and how to migrate existing supplier records onto it.

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
| `content.heroImageCredit`, `content.heroImageSourceUrl`     | Hero attribution and source                          |
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
| `GET /locations/:citySlug/:categorySlug` | City × category page — e.g. "Venues in Cardiff". Same publication rules as the city page, evaluated entirely on its own evidence.                      |

All three pages are fully server-rendered and mounted before `express.static()`
so the shells never ship with unfilled placeholders. Modules with nothing
reliable to show — packages, events, marketplace finds, categories, nearby
areas — are omitted entirely rather than rendering an empty shelf, and a
supplier count is shown only when it is a real, current number.

Structured data is a `BreadcrumbList` on every page plus a `CollectionPage` with
an `ItemList` of supplier profiles on indexable city and city × category pages,
each with its own `@id` so a crawler never sees a category page as the same
entity as its parent city. There is deliberately no `LocalBusiness` markup:
EventFlow has no branch in these cities, and that markup belongs only on an
individual supplier's own page.

### City × category pages

`:categorySlug` resolves through the same canonical category registry used by
`/suppliers?category=` (`public/assets/js/utils/category-link.js`) — a
category is never a second, parallel taxonomy invented for this feature. A
legacy spelling of either the city or the category 301s to the one canonical
URL, the same rule the city route already applies to itself.

A category page never inherits its parent city's publication state, quality
score or indexability — `services/locationCategoryPage.service.js` runs the
same shape of gate as the city (`evaluateCategoryQualityGate`), scored against
`CATEGORY_QUALITY_SIGNALS` in `models/LocationContent.js`. There is no
category-diversity signal (a page about one category has nothing to
diversify): that weight is redistributed across supplier depth, local
content, proof of activity, internal links and review freshness, each target
sized for a single category's real inventory rather than a whole city's. A
city can look ready overall while one specific category is still thin, or the
other way round — "wedding venues in Cardiff" can go live long before every
other Cardiff category does, because nothing about the category's own score
waits for the city as a whole to be ready.

Reachability is the one thing a category page does take from its city: every
category page's breadcrumb, and its "see every supplier in this city"
fallback, link back to `/locations/:citySlug`, so a category page is only
ever publicly visible while the city page is too (pilot or published), and
only ever listed in the sitemap while the city page is published. A category
can pass its own gate long before the city is ready for launch — it simply
waits alongside it, rather than shipping a page whose own breadcrumb 404s.

Editorial content — an intro, planning sections, FAQs, an SEO title and
description — lives in its own `location_category_pages` MongoDB collection,
keyed by `citySlug:categorySlug`, in exactly the shape `location_pages` uses
one level up. A category page has no hero image of its own: it borrows the
parent city's, so an editor is never keeping two photographs in step for the
same place. When nobody has written an introduction, one is composed live
from the category's real inventory (`composeAutomaticCategoryIntro`), the
same discipline `composeAutomaticIntro` already applies at city level.

Two kinds of cross-links exist purely to give a visitor (and a crawler)
somewhere real to go next, and both also feed the internal-links quality
signal: "Also in Cardiff" links to the city's other published category pages,
and "Wedding venues near Cardiff" links to the same category in nearby
published cities. Nothing links to a page that is not actually reachable.

Automatic publication mirrors the city-level job: any city × category
combination with three or more real suppliers in that category, that no
admin has ever saved through the editor, is published (but never
index-requested) on the same nightly run as the city job
(`services/locationAutoPublish.service.js`) — but only once the city page
itself is publicly visible, for the same reachability reason as above. The
city job runs first on every cycle, so a city that clears its own bar the
same night still carries its qualifying categories with it.

The admin API is a direct, one-level-deeper mirror of the city editor's:
`GET /api/v1/admin/locations/:slug/categories` lists every category with
either real supplier coverage or an existing editorial record;
`GET .../categories/:categorySlug`, `PATCH .../categories/:categorySlug` and
`GET .../categories/:categorySlug/preview` behave exactly like their
city-level counterparts, field for field. There is deliberately no dedicated
admin UI screen for it in this round — the API is complete and tested, and a
visual editor is a natural, small follow-up rather than something this PR
needed to build to make the pages themselves work.

### Marketplace listings on the city page

A "Marketplace finds in Cardiff" module surfaces marketplace listings
(`marketplace_listings` — the peer-to-peer buy/sell items, not a supplier's
own packages) on a city page, resolved through
`services/marketplaceListingLocation.service.js`. A listing is not a mobile
business, so it gets a smaller relationship vocabulary than a supplier: it is
either `in_city` (its resolved city matches) or `nearby` (its coordinate
falls within the city's own catchment radius) — never "serves" or
"nationwide", and `in_city` always outranks `nearby` outright.

Resolution follows the same "never guess" rule as suppliers, reusing
`supplierLocation.classifyLegacyLocation()` directly rather than a second
implementation: a listing's `citySlug`, once stored, is trusted; failing that,
a geocoded coordinate resolves to the nearest registry city; failing that, the
free-text `location` is classified — an exact match on one city name is
high-confidence, anything ambiguous is left unmapped.
`routes/marketplace.js` derives and stores `citySlug` on every listing create,
and re-derives it (and re-geocodes) only when an edit actually changes the
location text — the same discipline the live supplier write path already
follows, so an unrelated edit costs no geocoder call.
`scripts/audit-marketplace-listing-locations.js` backfills listings that
predate this change, in the same dry-run → apply → verify shape as
`scripts/audit-supplier-locations.js`.

The module is not gated by the city's own quality score or publication
workflow — it just renders when there is something real, the same way
packages and events already do, and is absent entirely when there is nothing
eligible rather than showing a "0 marketplace items" placeholder.

## Sitemap

`sitemap.js` runs the same gate the pages use, so the sitemap cannot advertise a
URL that returns `noindex`. A page leaves the sitemap automatically when it is
unpublished, when indexing is withdrawn, or when its inventory or review date
decays past the gate. `lastmod` is the page's real content date — never the time
the sitemap was generated. The hub is listed only when at least one city page is
indexable. City × category pages are listed the same way, each evaluated
against its own gate — a city being indexable never carries a category page
along on the strength of the city's own score — but only once the city page
itself is published, so the category page's breadcrumb never points at a
page the sitemap has excluded. Only categories a city actually has suppliers
in are ever considered.

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

### The editor

Each city card has an **Edit** action opening a per-city editor over
`GET /api/v1/admin/locations/:slug` and `PATCH /api/v1/admin/locations/:slug`:

| Field                                     | Limit                                            |
| ----------------------------------------- | ------------------------------------------------ |
| SEO title                                 | 70                                               |
| Meta description                          | 160                                              |
| Hero image URL / alt text                 | 500 / 200                                        |
| Local introduction                        | `LIMITS.introMaxLength`                          |
| Planning section title / body             | `sectionTitleMaxLength` / `sectionBodyMaxLength` |
| Planning section source name / URL / date | 120 / 500 / 40                                   |
| FAQ question / answer                     | `faqQuestionMaxLength` / `faqAnswerMaxLength`    |

Planning sections and FAQs are repeatable, and can be added, reordered and
removed; the array order is the order the page renders. The limits are read from
the API response rather than duplicated in the client, so the counters can never
promise more room than the server keeps.

The hero editor opens the existing Pexels selector with a search derived from
the current city and nation. Choosing a photo fills the image, alt text,
photographer and Pexels source together; changing the image URL manually clears
that attribution so it cannot be carried onto an unrelated image.

Public pages without an editor-selected image use the same integration
automatically. Every city in the registry gets a disambiguated city, region and
nation search, with landscape results ranked for explicit geographic matches and
cached for 24 hours. Cardiff, Bristol and Newport retain reviewed fixed defaults;
an editor-selected image always takes precedence for every city. If Pexels is not
configured or does not return a safe result, the page keeps its named-city
placeholder rather than showing an unrelated photograph.

Three rules shape the editor:

- **Saving copy sends `seo` and `content` and nothing else.** Publication state,
  the indexing request and the reviewed stamp belong to the workflow buttons;
  writing a paragraph cannot move any of them.
- **Unsaved work is never lost silently.** Closing, pressing Escape, or leaving
  the page with changes pending asks first, and the footer says "Unsaved
  changes" while any are outstanding.
- **A draft can be previewed without being published.**
  `GET /api/v1/admin/locations/:slug/preview` renders the page exactly as it
  would appear, in whatever state it is in, admin-only, `no-store` and
  `noindex, nofollow`. Nobody has to promote a Draft to Pilot — which makes it
  publicly reachable — just to read their own copy.

Client-side validation blocks a save on an over-length field, a hero image with
no alt text, and a hero or source URL that is not `http(s)`. It warns, and asks,
before saving a section or FAQ that is missing half of its pair, because the API
discards those rather than storing them half-written. The gate blockers and
editorial warnings are shown inside the editor, so the reason a page is being
held back is visible while the copy that would fix it is being written.

## Migrating supplier locations

### The three production commands

Run them in this order. Read the report between each one; nothing here is
reversed for you.

```bash
# 1. Dry run — reads only, writes nothing, refuses to run if it is not
#    talking to a healthy MongoDB.
NODE_ENV=production node scripts/audit-supplier-locations.js \
  --require-mongodb --json audit-dry-run.json

# 2. Apply — writes high-confidence mappings only, verifies every one.
NODE_ENV=production node scripts/audit-supplier-locations.js \
  --require-mongodb --confirm-production --apply --json audit-apply.json

# 3. Verify — the same dry run again. Every migrated record now reports
#    already_mapped, and high_confidence has dropped by the number written.
NODE_ENV=production node scripts/audit-supplier-locations.js \
  --require-mongodb --json audit-verify.json
```

Check after step 2: `written` equals `verified`, and `failedWrites` is empty.
Check after step 3: `counts.already_mapped` has risen by step 2's `written`, and
`counts.high_confidence` has fallen by the same number. A second `--apply` is
safe but should write nothing.

### Exit codes

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| 0    | Completed; no failed writes                                 |
| 2    | Refused before touching anything — a precondition was unmet |
| 3    | A write did not land; the run stopped at that record        |
| 1    | Unhandled error                                             |

### Safety rules the script enforces

- **Explicit initialisation.** The database is initialised up front and the
  active backend is named in the report and on stdout, rather than being
  discovered implicitly on the first read — which is the moment it is too late
  to refuse.
- **`--require-mongodb`** exits non-zero unless the backend is MongoDB _and_ the
  connection is healthy. Use it on every production invocation, dry runs
  included, so a mis-set `MONGODB_URI` fails loudly instead of quietly auditing
  a local file store.
- **`--apply` always refuses** any backend but a healthy MongoDB, whether or not
  `--require-mongodb` was passed.
- **`NODE_ENV=production` additionally requires `--confirm-production`** before
  `--apply` is accepted.
- **Every write is checked and re-read.** `updateOne`'s return value is checked,
  then the record is read back to confirm the mapping is present and the legacy
  `location` string is unchanged. Only a verified write increments `written`.
- **A failed write stops the run** with exit code 3 and a `failedWrites` entry,
  rather than continuing and producing a report nobody can trust.
- **Dry run remains the default.** `--apply` is the only way to write.

### Other options

```bash
node scripts/audit-supplier-locations.js                  # local dry run, prints a report
node scripts/audit-supplier-locations.js --limit 50       # audit the first 50 records
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

Page views carry `page_type` (`locations_hub`, `location_city` or
`location_city_category`) and `location_slug` (plus `category_slug` on a
category page), taken from meta tags the server renders. Supplier impressions
and clicks carry the supplier ID and the relationship type. No visitor postcode
is written to analytics in any form: the location dimension is always a
published city slug.

## Tests

| File                                                      | Covers                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `tests/unit/location-registry.test.js`                    | slugs, aliases, validation, distance, postcode resolution                           |
| `tests/unit/supplier-location-matching.test.js`           | legacy classification, service areas, relationship precedence, ranking, eligibility |
| `tests/unit/location-page-quality.test.js`                | publication states, quality gate, metadata, structured data                         |
| `tests/unit/location-sitemap.test.js`                     | sitemap inclusion and automatic removal                                             |
| `tests/unit/location-indexes.test.js`                     | index manifest                                                                      |
| `tests/unit/supplier-location-audit-script.test.js`       | dry-run safety and apply behaviour                                                  |
| `tests/unit/supplier-location-write-path.test.js`         | live derivation on profile create/edit, coverage validation, geocoder failure       |
| `tests/unit/admin-locations-editor.test.js`               | editor markup, accessibility hooks, limits kept in step with the API                |
| `tests/unit/admin-locations-editor-behaviour.test.js`     | the editor driven through a real DOM: load, repeat, reorder, save, unsaved changes  |
| `tests/unit/location-category-page.test.js`               | category gate, metadata, structured data, cross-links, automatic intro              |
| `tests/unit/location-category-guides.test.js`             | serviceCategory/eventType matching, city-pinned guides on a category page           |
| `tests/unit/location-category-auto-publish.test.js`       | category-level automatic publication and its admin-managed safety net               |
| `tests/unit/location-category-sitemap.test.js`            | sitemap inclusion and automatic removal for city × category pages                   |
| `tests/unit/marketplace-listing-location.test.js`         | listing city derivation, in_city/nearby matching, ranking                           |
| `tests/unit/marketplace-listing-city-mapping.test.js`     | citySlug derivation and re-derivation on listing create/edit                        |
| `tests/unit/marketplace-listing-audit-script.test.js`     | dry-run safety and apply behaviour for the listing backfill script                  |
| `tests/integration/locations-pages.test.js`               | status codes, redirects, headers, escaping, module omission                         |
| `tests/integration/locations-category-pages.test.js`      | city × category route: status codes, redirects, cross-links, module omission        |
| `tests/integration/locations-marketplace-module.test.js`  | the marketplace module on a city page: ranking, labels, module omission             |
| `tests/integration/admin-locations-api.test.js`           | access control, workflow, warnings, input limits                                    |
| `tests/integration/admin-location-categories-api.test.js` | the category admin API, mirroring the city one                                      |
| `e2e/locations.spec.js`                                   | browser suite; requires `E2E_MODE=full` because the pages need real data            |

## What is deliberately not here

- **A dedicated admin UI screen for category pages.** The admin API
  (`/api/v1/admin/locations/:slug/categories/...`) is complete and tested; a
  visual editor mirroring the city one is a natural, small follow-up.
- **Guide content written specifically for a city × category combination.**
  The catalogue schema (`serviceCategory`, `eventType`, `cities`) and the
  matching logic are built and tested; writing the guides themselves is
  editorial work, not a code change.
- **Marketplace listings on a city × category page.** The module is on the
  city page only. Marketplace categories (`attire`, `decor`, `av-equipment`,
  `photography`, `party-supplies`, `florals`) do not line up cleanly with the
  supplier category taxonomy, so filtering listings by category stays out of
  this round rather than shipping an inconsistent mapping.
- **Welsh-language URLs or `hreflang`.** Aliases only. Cardiff's Welsh name
  appears as a factual mention inside the city's introduction
  (`alternateNameNote` in `locationPage.service.js`), never as a second URL,
  route or `hreflang` — that stays out of scope until a full `/cy/` experience
  exists and is maintained, and there is no plan to build one.
- **Fabricated local statistics.** Planning sections that quote figures without a
  source raise an editorial warning; no average price or availability claim is
  generated anywhere in this code.
