# JadeAssist Catalog API

EventFlow exposes a read-only **Catalog API** under `/api/catalog` for use by the
JadeAssist chat backend (Option 1 integration). JadeAssist can query supplier and
venue data from the same MongoDB that powers the EventFlow website, without
requiring direct database access or duplicating data.

## Architecture

```
JadeAssist Backend (Railway)
  └─ GET https://event-flow.co.uk/api/catalog/suppliers?category=Photography&location=London
  └─ GET https://event-flow.co.uk/api/catalog/venues?minCapacity=100
       │
  EventFlow (Railway, MongoDB)
  routes/catalog.js → db-unified → MongoDB suppliers collection
```

## Environment Variables

| Variable                    | Required                      | Description                                                                                                                |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `CATALOG_API_KEY`           | **Recommended in production** | When set, every request must supply an `X-Catalog-Api-Key: <value>` header. When unset, the API is publicly accessible.    |
| `CATALOG_API_BASE_URL`      | Optional                      | Override the catalog base URL returned in `/api/config`. Defaults to `""` (same origin).                                   |
| `CATALOG_CACHE_TTL_SECONDS` | Optional                      | Server-side cache TTL in seconds. Defaults to `300` (5 minutes). Set lower for faster freshness, higher to reduce DB load. |

### Setting `CATALOG_API_KEY` on Railway

In the EventFlow Railway service:

```
CATALOG_API_KEY=<generate a long random string>
```

In the JadeAssist Railway service:

```
EVENTFLOW_CATALOG_API_KEY=<same value>
EVENTFLOW_CATALOG_BASE_URL=https://event-flow.co.uk
```

## Endpoints

### Authentication

When `CATALOG_API_KEY` is set, all requests must include:

```
X-Catalog-Api-Key: <key>
```

A missing or incorrect key returns `401 Unauthorized`.

---

### GET /api/catalog/categories

Returns the list of valid supplier categories.

**Response:**

```json
{
  "categories": [
    "Venues",
    "Catering",
    "Photography",
    "Videography",
    "Entertainment",
    "Florist",
    "Decor",
    "Transport",
    "Cake",
    "Stationery",
    "Hair & Makeup",
    "Planning",
    "Other"
  ]
}
```

Cache: `public, max-age=<CATALOG_CACHE_TTL_SECONDS>` (default 5 minutes)

---

### GET /api/catalog/suppliers

Paginated list of approved, published suppliers.

**Query Parameters:**

| Param      | Type    | Description                                         |
| ---------- | ------- | --------------------------------------------------- |
| `q`        | string  | Free-text search across name, description, location |
| `category` | string  | Filter by category (must be a valid category value) |
| `location` | string  | Substring filter on the `location` field            |
| `limit`    | integer | Page size (1–100, default 20)                       |
| `offset`   | integer | Records to skip (default 0)                         |

**Response:**

```json
{
  "suppliers": [
    {
      "id": "sup_abc123",
      "name": "Jane's Photography",
      "category": "Photography",
      "description": "Wedding and event photography...",
      "location": "London",
      "priceRange": "££",
      "logo": "https://...",
      "coverImage": null,
      "images": [],
      "amenities": [],
      "website": "https://example.com",
      "bookingUrl": null,
      "slug": "janes-photography",
      "isPro": true,
      "tags": ["wedding", "portrait"],
      "maxGuests": null,
      "responseTime": "Within 24 hours",
      "viewCount": 42
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

Cache: `public, max-age=<CATALOG_CACHE_TTL_SECONDS>` (default 5 minutes)

---

### GET /api/catalog/supplier/:id

Single supplier by ID.

**Response:** `{ "supplier": { ...public fields... } }`

Returns `404` if the supplier is not found or is not approved/published.

Cache: `public, max-age=<CATALOG_CACHE_TTL_SECONDS>` (default 5 minutes)

---

### GET /api/catalog/venues

Paginated list of approved, published venues (suppliers with `category = "Venues"`).

**Query Parameters:**

| Param         | Type    | Description                                |
| ------------- | ------- | ------------------------------------------ |
| `q`           | string  | Free-text search                           |
| `location`    | string  | Substring filter on location               |
| `minCapacity` | integer | Minimum guest capacity (`maxGuests` field) |
| `maxCapacity` | integer | Maximum guest capacity                     |
| `limit`       | integer | Page size (1–100, default 20)              |
| `offset`      | integer | Records to skip (default 0)                |

**Response:**

```json
{
  "venues": [
    {
      "id": "sup_v001",
      "name": "The Grand Hall",
      "category": "Venues",
      "location": "Manchester",
      "maxGuests": 300,
      ...
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

Cache: `public, max-age=<CATALOG_CACHE_TTL_SECONDS>` (default 5 minutes)

---

### GET /api/catalog/venue/:id

Single venue by ID.

**Response:** `{ "venue": { ...public fields... } }`

Returns `404` if not found or not a published venue.

Cache: `public, max-age=<CATALOG_CACHE_TTL_SECONDS>` (default 5 minutes)

---

## Public Fields

Only the following fields are returned (private fields such as `ownerUserId`, `email`,
`phone`, and internal state fields are never exposed):

`id`, `name`, `category`, `description`, `location`, `priceRange`, `price_display`,
`logo`, `coverImage`, `images`, `amenities`, `website`, `bookingUrl`, `slug`,
`isPro`, `tags`, `maxGuests`, `responseTime`, `viewCount`

## Rate Limiting

The catalog endpoints use `apiLimiter` (100 requests per 15 minutes per IP).
This is appropriate for a machine-to-machine integration.

## Server-Side Caching

The catalog API uses a dedicated server-side cache (`services/catalogCache.js`) backed
by the shared `cache.js` layer (Redis when `REDIS_URL` is set, otherwise in-memory).

### How it works

- **List endpoints** (`/suppliers`, `/venues`) fetch all approved/published records
  from MongoDB on the first request and store them under namespaced keys
  (`catalog:suppliers:all`, `catalog:venues:all`) with a TTL of
  `CATALOG_CACHE_TTL_SECONDS` (default 300 s).
- Subsequent requests within the TTL window are served entirely from the cache —
  no database query is made.
- **Automatic invalidation** — whenever an admin approves, rejects, requests changes
  on, or suspends a supplier (`routes/supplier-admin.js`), or whenever a supplier
  owner edits their profile (`routes/supplier-management.js`), the entire catalog
  cache is busted via `catalogCache.invalidate()`. The next request repopulates from
  the database automatically.
- **Time-based refresh** — when the server starts you may optionally call
  `catalogCache.startRefreshTimer(fn)` to pre-warm the cache on a regular interval
  equal to the TTL, so the first request after each cycle still hits the cache.
- Filtering, sorting, and pagination are applied **in-memory after the cache hit**,
  so per-query results are always accurate even when the full list is cached.

### TTL configuration

```
# Railway / .env
CATALOG_CACHE_TTL_SECONDS=300   # 5 minutes (default)
CATALOG_CACHE_TTL_SECONDS=60    # 1 minute for near-real-time freshness
CATALOG_CACHE_TTL_SECONDS=3600  # 1 hour for high-traffic / low-churn catalogs
```

### Cache-Control headers

All catalog responses include a `Cache-Control: public, max-age=<TTL>` header so
downstream CDNs and HTTP caches also respect the same TTL.

## Config Endpoint

`GET /api/config` now includes `catalogApiBaseUrl` so that client-side code can
discover the correct EventFlow base URL for catalog calls:

```json
{
  "catalogApiBaseUrl": "https://event-flow.co.uk"
}
```

This value is also propagated into `window.JADEASSIST_CONFIG.catalogApiBaseUrl` by
`jadeassist-init.v2.js` and forwarded as `catalogApiBaseUrl` in `JadeWidget.init()`
when it is non-empty.

## Widget Script Hardening

All public pages load exactly **one** instance of the widget bundle
(`/assets/js/vendor/jade-widget.js`) and **one** init script
(`/assets/js/jadeassist-init.v2.js`). The legacy `jadeassist-init.js` is no longer
included in any page. The `window.__JADE_WIDGET_INITIALIZED__` guard in the init
script prevents double-initialisation even if the scripts were accidentally loaded
twice.
