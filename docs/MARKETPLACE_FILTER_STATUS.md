# Marketplace Filter & Sort Status

This document tracks which marketplace filters and sort options are fully functional, which are stubs, and what is needed to complete each one.

**Last Updated:** March 2026 (Phase 5 update — location/distance filter completed)

---

## Supplier Search Filters (`/api/v2/search/suppliers`)

| Filter / Sort               | Status        | Notes                                                                                                                    |
| --------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Keyword search (`q`)        | ✅ Functional | Full-text weighted relevance search; **Phase 2:** all-words matching (multi-word queries no longer require exact phrase) |
| Category filter             | ✅ Functional | Exact match on `category` field                                                                                          |
| Location (text)             | ✅ Functional | Case-insensitive substring match on location string                                                                      |
| Min/max price               | ✅ Functional | Numeric range filter on price fields                                                                                     |
| Min rating                  | ✅ Functional | Filter on `averageRating`                                                                                                |
| Amenities                   | ✅ Functional | Array intersection filter                                                                                                |
| Min guests                  | ✅ Functional | Numeric filter on capacity                                                                                               |
| Pro only                    | ✅ Functional | Boolean flag filter                                                                                                      |
| Featured only               | ✅ Functional | Boolean flag filter                                                                                                      |
| Verified only               | ✅ Functional | Boolean flag filter                                                                                                      |
| Sort: relevance             | ✅ Functional | **Phase 2:** quality-based browse ranking when no query; tie-break by quality score                                      |
| Sort: rating                | ✅ Functional | **Phase 2:** ties broken by reviewCount desc, then quality                                                               |
| Sort: reviews               | ✅ Functional | **Phase 2:** ties broken by averageRating desc, then quality                                                             |
| Sort: name                  | ✅ Functional | Alphabetical sort                                                                                                        |
| Sort: newest                | ✅ Functional | Sort by `updatedAt`/`createdAt` desc; **Phase 2:** ties broken by quality                                                |
| Sort: price asc/desc        | ✅ Functional | Numeric sort on price; **Phase 2:** ties broken by quality                                                               |
| Sort: distance              | ✅ Functional | Geocodes postcode; sorts nearest first; falls back to quality sort when no postcode given                                |
| **Availability date range** | ⚠️ **STUB**   | No availability fields on supplier documents yet — see below                                                             |

---

## Discovery Endpoints (Phase 2 additions)

| Endpoint                                 | Status   | Notes                                                     |
| ---------------------------------------- | -------- | --------------------------------------------------------- |
| `GET /api/v2/search/discovery`           | ✅ Added | Returns `featured`, `topRated`, `newArrivals` buckets     |
| `GET /api/v2/search/similar/:supplierId` | ✅ Added | Similar suppliers by category, price tier, tags, location |

---

## Facets (`/api/v2/search/suppliers` response)

| Facet       | Status        | Notes                                                  |
| ----------- | ------------- | ------------------------------------------------------ |
| categories  | ✅ Functional | Sorted by count desc, max 20                           |
| ratings     | ✅ Functional | Four buckets: 3.0+, 3.5+, 4.0+, 4.5+                   |
| priceRanges | ✅ Functional | Four buckets: $, $$, $$$, $$$$                         |
| amenities   | ✅ Functional | Sorted by count desc, max 15                           |
| locations   | ✅ Added      | **Phase 2:** Top 10 string locations by supplier count |

---

## Marketplace Listings Filters (`/api/v1/marketplace/listings`)

| Filter / Sort                | Status        | Notes                                                                                                                                                                                                      |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category filter              | ✅ Functional |                                                                                                                                                                                                            |
| Condition filter             | ✅ Functional |                                                                                                                                                                                                            |
| Price range                  | ✅ Functional |                                                                                                                                                                                                            |
| Keyword search               | ✅ Functional |                                                                                                                                                                                                            |
| Sort: newest                 | ✅ Functional | Default                                                                                                                                                                                                    |
| Sort: price low→high         | ✅ Functional |                                                                                                                                                                                                            |
| Sort: price high→low         | ✅ Functional |                                                                                                                                                                                                            |
| **Location/distance filter** | ✅ Functional | Postcode geocoded server-side (postcodes.io); `lat`, `lng`, `radius` passed to API; listings with stored `locationCoordinates` are distance-filtered; new listings auto-geocode their location on creation |

---

## Stub Details & What's Needed

### Availability Date Range Filter (Supplier Search)

**Current behaviour:** No availability filter exists in the UI or API yet.

**What's needed to complete:**

1. Add `availability` fields (e.g. blocked dates or available date ranges) to supplier documents
2. Add an availability filter parameter to `GET /api/v2/search/suppliers`
3. Implement date-range intersection logic in `searchSuppliers()` in `searchService.js`
4. Add a date-range picker UI component to the supplier search page

### Location/Distance Filter (Marketplace Listings)

**Status: ✅ Functional** (implemented in Phase 5)

**Location:** `public/assets/js/marketplace.js` — apply button handler / `loadListings()`

**How it works:**

1. User enters postcode + radius in the location modal
2. Frontend calls `GET /api/v1/marketplace/geocode-postcode?postcode=<postcode>` (server-side proxy to postcodes.io — no API key required)
3. Resolved `lat`/`lng` are stored alongside `postcode` and `radius` in `localStorage` under `marketplaceLocation`
4. `loadListings()` reads the saved location and appends `lat`, `lng`, `radius` to the API query
5. Backend (`routes/marketplace.js`) filters listings: those with a `locationCoordinates` field are distance-checked using the Haversine formula; legacy listings without coordinates are included (graceful degradation)
6. New listings auto-geocode their `location` text on creation and store `locationCoordinates: { lat, lng }`

---

## Summary

| Category             | Fully Functional                          | Stubs / Incomplete |
| -------------------- | ----------------------------------------- | ------------------ |
| Supplier search      | 11 filters/sorts + distance               | 1 (availability)   |
| Supplier discovery   | similar suppliers, discovery feed, facets | —                  |
| Marketplace listings | 7 filters/sorts (all functional)          | —                  |
