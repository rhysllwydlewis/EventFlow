# Marketplace Architecture

**Last Updated:** March 2026

---

## Routes and HTML Files

| URL                                 | HTML File                                      | Notes                                  |
| ----------------------------------- | ---------------------------------------------- | -------------------------------------- |
| `/marketplace`                      | `public/marketplace.html`                      | Public browsing page (canonical)       |
| `/my-marketplace-listings`          | `public/my-marketplace-listings.html`          | Seller dashboard — manage own listings |
| `/supplier/marketplace-new-listing` | `public/supplier/marketplace-new-listing.html` | Create a new listing                   |
| `/admin-marketplace`                | `public/admin-marketplace.html`                | Admin moderation panel                 |

---

## JavaScript Entrypoints

### Canonical: `public/assets/js/marketplace.js` (IIFE)

- **Loaded by:** `public/marketplace.html`
- **Style:** Self-contained IIFE (`(function() { 'use strict'; ... })()`), no build step required
- **API endpoint:** `/api/v1/marketplace/listings`
- **Features:**
  - URL-driven filters (category, condition, price range, keyword, sort)
  - Location/distance filter (postcode → geocode → lat/lng/radius to API)
  - Pagination via client-side "Load More"
  - Listing detail modal (open from URL `?listing=<id>`)
  - Save/shortlist listings
  - Skeleton loading states
  - Empty state + error handling
  - Share listings (Facebook, Twitter, copy link)
  - Mobile filter sidebar toggle
  - Grid/list view toggle

### Supporting: `public/assets/js/pages/marketplace-dom-init.js`

- **Loaded by:** `public/marketplace.html` (after `marketplace.js`)
- **Purpose:** Sets SEO metadata (title, description, canonical) and initialises the `ErrorBoundary`
- **Not a marketplace initializer** — no API calls

### Secondary: `public/assets/js/pages/marketplace-init.js` (ES Module)

- **Loaded by:** _Not loaded by `marketplace.html`_ — this is a standalone ES-module entrypoint
- **API endpoint:** `/api/v1/marketplace/listings` (aligned with canonical namespace)
- **Purpose:** Alternative/experimental initializer used in contexts where ES modules are bundled
- **Note:** If this file is included on a page, it auto-initialises when `#marketplace-results` is present

---

## API Endpoint Namespace

The canonical backend namespace is **`/api/v1/marketplace/...`**.

A backward-compatible alias at `/api/marketplace/...` is also mounted (see `routes/index.js`):

```js
app.use('/api/v1/marketplace', marketplaceRoutes);
app.use('/api/marketplace', marketplaceRoutes); // Backward compatibility
```

All new frontend code should use `/api/v1/marketplace/...`.

---

## Backend Routes (`routes/marketplace.js`)

| Method   | Path                                    | Auth               | Description                                                                                                               |
| -------- | --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/marketplace/geocode-postcode`  | Public             | Server-side postcode → lat/lng lookup (proxies postcodes.io)                                                              |
| `GET`    | `/api/v1/marketplace/listings`          | Public             | List/search listings — supports `category`, `condition`, `minPrice`, `maxPrice`, `search`, `sort`, `lat`, `lng`, `radius` |
| `GET`    | `/api/v1/marketplace/listings/:id`      | Public             | Get single listing                                                                                                        |
| `POST`   | `/api/v1/marketplace/listings`          | Auth               | Create listing (geocodes location, stores `locationCoordinates`)                                                          |
| `PUT`    | `/api/v1/marketplace/listings/:id`      | Auth (owner/admin) | Update listing                                                                                                            |
| `DELETE` | `/api/v1/marketplace/listings/:id`      | Auth (owner/admin) | Delete listing                                                                                                            |
| `GET`    | `/api/v1/marketplace/my-listings`       | Auth               | Get authenticated user's listings                                                                                         |
| `GET`    | `/api/v1/marketplace/my-listings/:id`   | Auth               | Get own listing for editing                                                                                               |
| `GET`    | `/api/v1/marketplace/saved`             | Auth               | Get saved/shortlisted listings                                                                                            |
| `POST`   | `/api/v1/marketplace/saved/:listingId?` | Auth               | Save a listing                                                                                                            |
| `DELETE` | `/api/v1/marketplace/saved/:listingId`  | Auth               | Unsave a listing                                                                                                          |

---

## Location/Distance Filter

### How it works end-to-end

1. **User opens the location modal** (click "📍 All UK" / change-location button)
2. User enters a postcode and radius, then clicks **Apply**
3. The frontend calls `GET /api/v1/marketplace/geocode-postcode?postcode=<postcode>` (server-side proxy to [postcodes.io](https://postcodes.io))
4. Resolved `latitude` and `longitude` are stored alongside `postcode` and `radius` in `localStorage` under `marketplaceLocation`
5. On every `loadListings()` call, if `lat`, `lng`, and `radius` are present in `localStorage`, they are appended to the API query: `?lat=<lat>&lng=<lng>&radius=<radius>`
6. The backend filters listings: those with a stored `locationCoordinates` field (`{ lat, lng }`) are distance-checked using the Haversine formula; listings without coordinates are included (graceful degradation for legacy data)

### Storing coordinates on new listings

When `POST /api/v1/marketplace/listings` is called with a non-empty `location` string, the backend attempts to geocode it via `utils/geocoding.js` and stores the result as `locationCoordinates: { lat, lng }` on the listing document.

Geocoding failure is non-fatal — the listing is created without coordinates.

### "Use My Location" (browser geolocation)

If the user clicks **Use My Location**, the browser's `Geolocation API` resolves coordinates directly. These are stored as `data-lat` / `data-lng` attributes on the postcode input, so the Apply handler can skip the geocode API call.

---

## Database Collections

| Collection                | Purpose                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `marketplace_listings`    | Listing documents (`id`, `userId`, `title`, `description`, `price`, `category`, `condition`, `location`, `locationCoordinates?`, `images`, `approved`, `status`, `createdAt`, `updatedAt`) |
| `marketplace_images`      | Image metadata linked to listings                                                                                                                                                          |
| `marketplace_saved_items` | User shortlist/saved items                                                                                                                                                                 |

### Indexes on `marketplace_listings`

| Index                                                                     | Notes                     |
| ------------------------------------------------------------------------- | ------------------------- |
| `{ id: 1 }` (unique)                                                      | Primary lookup            |
| `{ userId: 1 }`                                                           | My listings queries       |
| `{ approved: 1, status: 1 }`                                              | Public browse filter      |
| `{ createdAt: -1 }`                                                       | Default newest-first sort |
| `{ 'locationCoordinates.lat': 1, 'locationCoordinates.lng': 1 }` (sparse) | Distance filter support   |

---

## Geocoding Service

**File:** `utils/geocoding.js`

- Uses [postcodes.io](https://postcodes.io) — no API key required
- Results are cached via `cache` module (24-hour TTL)
- Exported functions: `geocodePostcode`, `geocodeLocation`, `calculateDistance`, `isValidUKPostcode`
- Also used by supplier search distance sort (`services/searchService.js`)
