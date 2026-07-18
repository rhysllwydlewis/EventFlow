# Backend API status

**Last verified:** 18 July 2026  
**Verification base:** `main` at `5fe6c87e8329740f2eccca6398f2a7d65b885278`, plus this pull request.

This document is a navigation summary. Route files and automated tests are authoritative for endpoint behaviour. Do not add a TODO here unless it links to an open GitHub issue.

## Supplier analytics

**Implemented**

- Supplier profile-view and enquiry tracking service: `services/analyticsService.js`
- Supplier analytics retrieval routes
- 7, 30 and 90-day aggregation
- Supplier dashboard consumption and integration tests

Any claim that analytics tracking is wholly missing is outdated. Improvements to analytics quality or attribution should be filed as specific issues with evidence.

## Lead quality

**Implemented**

- Lead scoring in `utils/leadScoring.js`
- Scores and quality classifications stored for supplier-facing lead journeys
- Supplier dashboard presentation and tests

## Marketplace

**Implemented**

- Listing search and filtering
- Listing create, update, delete and detail routes
- Postcode geocoding and radius filtering
- Logged-in seller journeys and seller messaging

The public page must not describe the whole marketplace as "Coming Soon" while these live journeys are exposed.

## Supplier search

**Implemented**

- Supplier search API and public supplier directory
- Category, location and other supported filters
- Search caching and analytics hooks

Any unsupported or fallback sort mode should be documented at the exact route or filed as an issue rather than recorded as a broad product TODO here.

## Supplier photos

**Implemented in `routes/suppliers-v2.js`**

- `GET /api/me/suppliers/:id/photos`
- `POST /api/me/suppliers/:id/photos`
- `DELETE /api/me/suppliers/:id/photos/:photoId`
- `PATCH /api/me/suppliers/:id/photos/order`

The previous statement that photo list and delete endpoints were missing was stale.

## Production system endpoints

**Implemented and monitored**

- `/api/health`
- `/api/ready`
- `/api/config`
- `/deployment.json`
- `/robots.txt`
- `/sitemap.xml`

The scheduled Production Synthetics workflow also checks canonical-host redirects and unsupported public launch claims.

## Messaging and attachments

Messaging routes and real-time transport are implemented. Storage architecture and retention must be verified from current storage configuration before making claims about deployment persistence. Create a targeted issue when a concrete attachment-loss reproduction exists.

## How to update this document

1. Verify the current route and mounted path.
2. Verify at least one relevant automated test.
3. Record the commit or pull request used for verification.
4. Link unfinished work to an open issue.
5. Remove or archive superseded status text instead of leaving contradictory sections in place.
