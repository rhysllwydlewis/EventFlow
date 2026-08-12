# Service Worker API Caching Security Implementation

## Overview

This document summarizes the security improvements made to prevent sensitive API responses from being cached by the service worker, eliminating "stale security" risks where user/admin data could be served from cache in offline or flaky network scenarios.

## Changes Made

### 1. Service Worker Updates (`public/sw.js`)

**Security Improvements:**

- Added allowlist of safe public API endpoints that may be cached
- Changed default API caching behavior from "cache everything" to "cache nothing"
- Implemented Cache-Control header inspection
- Added fail-closed behavior for sensitive APIs when offline

**Safe API Endpoints Allowlist:**

- `/api/config` - Public configuration (Google Maps API key, version)
- `/api/meta` - Application metadata (version, node version, environment)

**Removed from allowlist (contain internal info):**

- `/api/health` - Exposes database errors and internal state
- `/api/ready` - Exposes connection details and debug messages
- `/api/performance` - Exposes internal configuration (compression levels, caching strategy)

**Behavior:**

- **Allowlisted endpoints WITH cacheable headers** → Cached and served offline
- **Allowlisted endpoints WITH no-store/private/no-cache** → Never cached
- **Non-allowlisted endpoints** → Never cached, return 503 offline
- **Static assets (images, CSS, JS, HTML)** → Unchanged, still cached

### 2. Server-Side Cache Headers (`server.js`)

**New Middleware:**
Added `/api` middleware that sets `Cache-Control: no-store, private` by default for all API endpoints, except those on the safe cacheable list.

**Safe Cacheable Endpoints:**

- `/api/config`
- `/api/meta`

**Note:** `/api/health`, `/api/ready`, and `/api/performance` were removed from the allowlist because they expose internal information:

- `/api/health` and `/api/ready`: database errors, connection states, debug messages
- `/api/performance`: internal configuration details (compression levels, caching strategy) that could aid reconnaissance

**Defense in Depth:**

- Server sets no-store headers
- Service worker respects no-store headers
- Double protection against caching sensitive data

### 3. System Routes Updates (`routes/system.js`)

**Explicit Cache Headers:**

- `/api/config` → `public, max-age=300` (5 minutes)
- `/api/meta` → `public, max-age=300` (5 minutes)
- `/api/health` → `no-store, private` (contains debug info)
- `/api/ready` → `no-store, private` (contains debug info)
- `/api/performance` → `no-store, private` (contains internal config)

### 4. E2E Tests (`e2e/sw-api-caching.spec.js`)

**Test Coverage:**

- **Test A:** Verifies sensitive APIs (like `/api/auth/me`, `/api/admin/users`) are NOT cached
- **Test B:** Verifies allowlisted APIs with public headers ARE cached and served offline
- **Test C:** Verifies responses with `no-store` are never cached, even if allowlisted
- **Test D:** Verifies non-allowlisted APIs return 503 when offline (fail-closed)
- **Test E:** Verifies server sends proper Cache-Control headers

## Security Benefits

### Before (Vulnerable)

```
User requests /api/auth/me → Response cached
Network goes offline/flaky → Stale cached response served
Result: Old user data (potentially wrong role/permissions) used
```

### After (Secure)

```
User requests /api/auth/me → Response has no-store header
Service worker sees no-store → Does not cache
Network goes offline/flaky → 503 error returned
Result: App fails safely, no stale security data
```

## Testing

### Manual Testing

1. **Test sensitive endpoint headers:**

```bash
curl -I http://localhost:3000/api/auth/me
# Should show: Cache-Control: no-store, private
```

2. **Test safe endpoint headers:**

```bash
curl -I http://localhost:3000/api/config
# Should show: Cache-Control: public, max-age=300
```

3. **Test arbitrary API endpoint:**

```bash
curl -I http://localhost:3000/api/suppliers
# Should show: Cache-Control: no-store, private
```

### Automated Testing

Run the E2E test suite:

```bash
npm run test:e2e -- e2e/sw-api-caching.spec.js
```

## Acceptance Criteria Status

- [x] `/api/admin/*`, `/api/auth/*`, and user-specific `/api/*` are never cached by service worker
- [x] When offline, sensitive API requests return 503 JSON rather than cached data
- [x] Sensitive API responses include `Cache-Control: no-store, private` (server-side)
- [x] Existing offline behavior for HTML/static assets remains unchanged
- [x] Tests added and passing

## Impact on Users

### Online Users

- **No change** - All requests go to network as before
- Slightly better security headers

### Offline Users

- **Safe endpoints** (config, meta, health) - Still work offline if previously cached
- **Sensitive endpoints** (auth, admin, user data) - Fail with clear 503 error message
- **Static assets** (HTML, CSS, JS, images) - Still work offline as before

### Developer Experience

- Clear allowlist of cacheable endpoints
- Easy to add new safe endpoints to allowlist
- Comprehensive test coverage

## Future Considerations

### Adding New Safe Endpoints

To add a new endpoint that should be cacheable:

1. **Add to service worker allowlist** (`public/sw.js`):

```javascript
const SAFE_API_ENDPOINTS = [
  '/api/config',
  '/api/meta',
  '/api/health',
  '/api/performance',
  '/api/your-new-endpoint', // Add here
];
```

2. **Add to server middleware allowlist** (`server.js`):

```javascript
const SAFE_CACHEABLE_ENDPOINTS = [
  '/api/config',
  '/api/meta',
  '/api/health',
  '/api/ready',
  '/api/performance',
  '/api/your-new-endpoint', // Add here
];
```

3. **Set public cache headers in route handler**:

```javascript
router.get('/your-new-endpoint', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    /* ... */
  });
});
```

### Monitoring

Consider adding analytics to track:

- 503 offline errors from service worker
- Cache hit rates for safe endpoints
- Any unexpected caching behavior

## References

- [MDN: Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control)
- [Service Workers: Safe to cache criteria](https://web.dev/service-worker-caching-and-http-caching/)
- [OWASP: Caching Security](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html)
