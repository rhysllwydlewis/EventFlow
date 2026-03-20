# Pre-Merge Checklist — Catalog Cache & Freshness

**PR branch**: `copilot/add-jadeassist-option-1-integration`  
**Date**: 2026-03-20  
**Feature**: Server-side catalog cache with TTL expiry and supplier-event invalidation

---

## 1. Functionality

- [x] `services/catalogCache.js` created with `get()`, `set()`, `invalidate()`, `getTtl()`, `startRefreshTimer()`, `stopRefreshTimer()`
- [x] Cache is backed by shared `cache.js` (Redis if `REDIS_URL` set, otherwise in-memory)
- [x] `CATALOG_CACHE_TTL_SECONDS` env var respected (default 300 s)
- [x] `routes/catalog.js` — `/suppliers` and `/venues` list routes use cache (miss → DB → cache, hit → skip DB)
- [x] `routes/catalog.js` — filtering, sorting, and pagination applied in-memory after cache hit
- [x] `routes/supplier-admin.js` — `catalogCache.invalidate()` called after approve, reject, request-changes, suspend, pro toggle, and admin PATCH
- [x] `routes/supplier-management.js` — `catalogCache.invalidate()` called after supplier profile PATCH
- [x] All `invalidate()` calls are non-blocking (`.catch()` guard so a cache error never breaks the API response)
- [x] `Cache-Control` response header uses dynamic `catalogCache.getTtl()` value

---

## 2. Code Quality

- [x] `buildTextFilter` replaced with `buildSearchRegex` — returns `RegExp` directly, no more fragile `.name` property access on a MongoDB query object
- [x] Rate limiter changed from `searchLimiter` (30/min) to `apiLimiter` (100/15 min) — correct for machine-to-machine use
- [x] `startRefreshTimer` timer has `.unref()` so it does not prevent process exit in test environments
- [x] All new code follows existing JSDoc comment conventions
- [x] No commented-out code; no debug `console.log` calls

---

## 3. Tests

- [x] All 23 existing catalog API tests pass (`tests/unit/catalog-api.test.js`)
- [x] `catalogCache` is mocked (`get: null` / `set: no-op` / `invalidate: no-op`) so tests remain isolated
- [x] `apiLimiter` mock added alongside the existing `searchLimiter` mock

---

## 4. Security

- [x] `catalogCache.invalidate()` never exposes internal errors to the HTTP response (non-blocking `.catch`)
- [x] No new secrets or credentials introduced
- [x] `CATALOG_API_KEY` auth middleware unchanged — all existing protection preserved
- [x] No user-supplied input is stored in the cache (only DB query results keyed by fixed strings)

---

## 5. Documentation

- [x] `docs/catalog-api.md` updated:
  - [x] `CATALOG_CACHE_TTL_SECONDS` added to environment variables table
  - [x] New **Server-Side Caching** section documents TTL, invalidation triggers, and filter/sort behaviour
  - [x] All `Cache-Control` header values updated to reflect dynamic TTL
  - [x] Rate limiting section corrected to reflect `apiLimiter`
- [x] `services/catalogCache.js` is fully JSDoc-commented with usage examples

---

## 6. Deployment Checklist

- [ ] **Optional**: set `CATALOG_CACHE_TTL_SECONDS` in Railway EventFlow environment (default 300 s is fine for most cases)
- [ ] **Optional**: set `REDIS_URL` if you want Redis-backed caching (cross-instance cache sharing); without it, in-memory cache is used per-dyno
- [ ] Confirm `CATALOG_API_KEY` is set in EventFlow Railway and mirrored in JadeAssist Railway as `EVENTFLOW_CATALOG_API_KEY`
- [ ] After deployment, verify `GET /api/catalog/suppliers` returns `X-Cache` header or correct `Cache-Control` header
- [ ] After approving a test supplier in admin, verify a subsequent `GET /api/catalog/suppliers` reflects the change (cache invalidated)

---

## 7. Rollback Plan

The cache is additive — if `catalogCache.get()` returns `null` (cache miss or Redis down), the route falls through to the database exactly as before. Removing `REDIS_URL` or restarting the dyno clears the in-memory cache. No database migration required.

---

## ✅ Status: Ready to Merge
