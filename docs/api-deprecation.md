# API Deprecation — Unversioned Aliases

**Status:** Active — will be enforced by middleware from this release onward.
**Sunset:** 2026-12-31 (applies to all unversioned `/api/...` aliases).
**Removal release:** EventFlow v20.0.0.

---

## What's deprecated

For historical reasons the REST API is mounted at **two** prefixes:

- `/api/v1/...` — the canonical, versioned API.
- `/api/...` — an unversioned alias of the same handlers, kept for backward compatibility with older clients.

Every unversioned call now includes the following response headers:

```
Deprecation: true
Sunset: <HTTP-date, 2026-12-31>
Link: </api/v1/...>; rel="successor-version",
      <https://github.com/rhysllwydlewis/EventFlow/blob/main/docs/api-deprecation.md>;
        rel="deprecation"; type="text/html"
```

These are the standards-track headers from **RFC 8594 (Sunset)** and **RFC 9745 (Deprecation)** — any HTTP client library that understands them will surface the warning automatically.

The server also logs a one-time per-process warning the first time each legacy mount-path is hit:

```
[deprecation] Legacy API in use: /api → use /api/v1 instead.
Scheduled for removal in v20.0.0 (2026-12-31).
```

> **Note:** this policy is separate from the messenger-specific deprecation covered in
> [`LEGACY_API_SHUTDOWN.md`](./LEGACY_API_SHUTDOWN.md). That document deals with the
> v1/v2/v3 **messaging** APIs being replaced by Messenger v4; this document deals with
> the general unversioned `/api` → `/api/v1` alias.

---

## How to migrate

1. Replace every `/api/...` call in your client with `/api/v1/...`.
2. Watch for `Deprecation: true` and `Sunset` headers in your HTTP logs — they point at remaining legacy usage.
3. Any handler under the unversioned mount will be removed in EventFlow v20.0.0.

## How it's implemented

The middleware lives in [`middleware/legacyApiDeprecation.js`](../middleware/legacyApiDeprecation.js). It's applied per-mount-path in both `routes/index.js` and legacy compatibility mounts in `server.js`:

```js
app.use('/api/v1', contactRoutes); // canonical
app.use('/api', legacyApiDeprecation('/api', '/api/v1'), contactRoutes); // deprecated
```

Legacy inline supplier endpoints now have a canonical alias at `/api/v1/me/suppliers` and the old `/api/me/suppliers` alias emits the same deprecation headers.

Contract tests in `tests/integration/legacy-api-deprecation.test.js` lock down the header format, per-prefix coverage for legacy mounts, the once-per-route logging, and the fact that versioned mounts (including `/api/v2/...`) do **not** emit these headers.
