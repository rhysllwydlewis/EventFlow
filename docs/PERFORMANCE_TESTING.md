# Performance Testing & QA Guide

## Overview

This guide provides comprehensive testing procedures to verify EventFlow's performance optimizations, including compression, caching, and asset delivery.

## Quick Verification

### 1. Performance Endpoint

**Check compression and caching configuration:**

```bash
curl http://localhost:3000/api/performance
```

**Expected Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-06T00:00:00.000Z",
  "client": {
    "acceptEncoding": "gzip, deflate, br",
    "compression": {
      "brotli": true,
      "gzip": true,
      "deflate": true,
      "preferred": "brotli"
    }
  },
  "server": {
    "compression": {
      "enabled": true,
      "brotliSupport": true,
      "gzipSupport": true
    },
    "caching": {
      "html": { "maxAge": 300 },
      "staticAssets": { "maxAge": 604800 },
      "uploads": { "maxAge": 31536000 }
    }
  },
  "verification": {
    "compressionActive": true,
    "cachingActive": true,
    "brotliAvailable": true
  }
}
```

### 2. Health Check

**Verify database and system health:**

```bash
curl http://localhost:3000/api/health
```

**Key fields to check:**

- `status`: Should be "ok"
- `services.mongodb`: Should be "connected" (production)
- `services.activeBackend`: Should be "mongodb" (production)

## Compression Testing

### Test 1: Brotli Compression

**Check Brotli encoding for HTML:**

```bash
curl -H "Accept-Encoding: br" \
  -I http://localhost:3000/ | grep -i content-encoding
```

**Expected:** `Content-Encoding: br`

**Check Brotli encoding for CSS:**

```bash
curl -H "Accept-Encoding: br" \
  -I http://localhost:3000/assets/css/styles.css | grep -i content-encoding
```

**Expected:** `Content-Encoding: br`

### Test 2: Gzip Compression (Fallback)

**Check gzip encoding:**

```bash
curl -H "Accept-Encoding: gzip" \
  -I http://localhost:3000/ | grep -i content-encoding
```

**Expected:** `Content-Encoding: gzip`

### Test 3: Compression Ratio

**Measure compression savings for HTML:**

```bash
# Uncompressed size
curl -s http://localhost:3000/ | wc -c

# Compressed size (with Brotli)
curl -s -H "Accept-Encoding: br" --compressed http://localhost:3000/ | wc -c
```

**Expected:** 60-80% reduction for text content

**Measure compression savings for CSS:**

```bash
# Uncompressed size
curl -s http://localhost:3000/assets/css/styles.css | wc -c

# Compressed size (with Brotli)
curl -s -H "Accept-Encoding: br" --compressed http://localhost:3000/assets/css/styles.css | wc -c
```

**Expected:** 70-85% reduction for CSS

### Test 4: Large Response Compression

**Test API responses are compressed:**

```bash
curl -H "Accept-Encoding: br" \
  -I http://localhost:3000/api/packages/search | grep -i content-encoding
```

**Expected:** `Content-Encoding: br`

## Caching Header Testing

### Test 1: HTML Page Caching

**Check Cache-Control for HTML:**

```bash
curl -I http://localhost:3000/ | grep -i cache-control
```

**Expected:** `Cache-Control: public, max-age=300, must-revalidate`

- 5-minute cache
- Must revalidate with server
- Public (can be cached by CDN/proxy)

### Test 2: CSS/JS Asset Caching

**Check Cache-Control for CSS:**

```bash
curl -I http://localhost:3000/assets/css/styles.css | grep -i cache-control
```

**Expected:** `Cache-Control: public, max-age=604800, must-revalidate`

- 1-week cache
- Public caching enabled

**Check Cache-Control for JS:**

```bash
curl -I http://localhost:3000/assets/js/app.js | grep -i cache-control
```

**Expected:** `Cache-Control: public, max-age=604800, must-revalidate`

### Test 3: Image Caching

**Check Cache-Control for images:**

```bash
curl -I http://localhost:3000/favicon.svg | grep -i cache-control
```

**Expected:** `Cache-Control: public, max-age=604800, must-revalidate`

### Test 4: User Uploads Caching

**Check Cache-Control for uploads:**

```bash
# Replace with actual upload path
curl -I http://localhost:3000/uploads/avatar-123.jpg | grep -i cache-control
```

**Expected:** `Cache-Control: public, max-age=31536000, immutable`

- 1-year cache
- Immutable (content never changes)

### Test 5: Versioned Assets (if applicable)

**Check Cache-Control for hashed assets:**

```bash
# Example: styles.a1b2c3d4.css
curl -I http://localhost:3000/assets/css/styles.a1b2c3d4.css | grep -i cache-control
```

**Expected:** `Cache-Control: public, max-age=31536000, immutable`

## Asset Optimization Testing

### Test 1: Asset Sizes

**Check CSS total size:**

```bash
du -sh public/assets/css/
```

**Expected:** < 300KB (current: ~292KB) ✅

**Check JS total size:**

```bash
du -sh public/assets/js/
```

**Expected:** < 1.5MB (current: ~1.2MB) ✅

### Test 2: Favicon Optimization

**Check favicon size:**

```bash
ls -lh public/favicon.svg
```

**Expected:** < 1KB (current: 245 bytes) ✅

### Test 3: Image Format Support

**Check if images use modern formats:**

```bash
find public -name "*.webp" | wc -l
```

**Expected:** WebP images present for optimal compression

### Test 4: Lazy Loading

**Manual verification required:**

1. Open browser DevTools → Network tab
2. Load homepage
3. Scroll down page
4. Verify images below fold are loaded on-demand

**Expected:** Images load as they enter viewport

## Browser Testing

### Test in Multiple Browsers

Test compression and caching in:

- ✅ Chrome/Edge (Brotli support)
- ✅ Firefox (Brotli support)
- ✅ Safari (Brotli support in macOS 11+)
- ⚠️ Older browsers (gzip fallback)

### DevTools Performance Audit

**Chrome DevTools:**

1. Open DevTools → Lighthouse
2. Select "Performance" category
3. Click "Generate report"

**Expected Scores:**

- Performance: 90+ / 100
- Best Practices: 95+ / 100

**Common Issues to Check:**

- ✅ Text compression enabled
- ✅ Static assets cached
- ✅ Minimize main-thread work
- ✅ Reduce JavaScript execution time

### Network Tab Analysis

**Check request counts:**

1. Open DevTools → Network
2. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
3. Count HTTP requests

**Expected:**

- Homepage: 20-30 requests
- Subsequent pages: 5-15 requests (cached assets)

**Check total transfer size:**

- First load: 500KB - 1MB
- Cached load: 50KB - 200KB

## Production Verification

### Test on Deployed URL

**Replace `yourdomain.com` with actual domain:**

**1. Check compression:**

```bash
curl -H "Accept-Encoding: br" \
  -I https://yourdomain.com/ | grep -i content-encoding
```

**2. Check caching:**

```bash
curl -I https://yourdomain.com/ | grep -i cache-control
```

**3. Check HTTPS redirect:**

```bash
curl -I http://yourdomain.com/
```

**Expected:** `Location: https://yourdomain.com/` (301/302 redirect)

**4. Check security headers:**

```bash
curl -I https://yourdomain.com/ | grep -E "Strict-Transport-Security|X-Frame-Options|X-Content-Type"
```

**Expected:**

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`

### Test CDN Integration (if applicable)

**Check CDN caching:**

```bash
curl -I https://yourdomain.com/assets/css/styles.css | grep -i "x-cache"
```

**Expected (Cloudflare):**

- First request: `CF-Cache-Status: MISS`
- Second request: `CF-Cache-Status: HIT`

## MongoDB Performance Testing

### Test 1: Connection Status

**Check MongoDB is active backend:**

```bash
curl http://localhost:3000/api/health | jq '.services.activeBackend'
```

**Expected:** `"mongodb"`

### Test 2: Query Performance

**Check query metrics:**

```bash
curl http://localhost:3000/api/health | jq '.services.queryMetrics'
```

**Expected Response:**

```json
{
  "totalQueries": 1234,
  "slowQueries": 5,
  "avgQueryTime": 45.2
}
```

**Acceptable Thresholds:**

- Average query time: < 100ms
- Slow queries: < 5% of total

### Test 3: Readiness Probe

**Check MongoDB readiness:**

```bash
curl -w "\nHTTP Status: %{http_code}\n" http://localhost:3000/api/ready
```

**Expected:** HTTP 200 (ready)
**If MongoDB down:** HTTP 503 (not ready)

## Load Testing (Optional)

### Simple Load Test with Apache Bench

**Test homepage performance:**

```bash
ab -n 1000 -c 10 http://localhost:3000/
```

**Expected:**

- Requests per second: > 100
- Mean response time: < 100ms
- Failed requests: 0

**Test API endpoint:**

```bash
ab -n 1000 -c 10 http://localhost:3000/api/health
```

**Expected:**

- Requests per second: > 500
- Mean response time: < 20ms

### Load Test with wrk (Advanced)

**Install wrk:**

```bash
# macOS
brew install wrk

# Ubuntu
apt-get install wrk
```

**Run load test:**

```bash
wrk -t4 -c100 -d30s http://localhost:3000/
```

**Analyze results:**

- Latency (avg): < 100ms
- Requests/sec: > 100
- Transfer/sec: Varies based on content

## Automated Testing

### Add to CI/CD Pipeline

**Example GitHub Actions workflow:**

```yaml
# .github/workflows/performance-test.yml
name: Performance Tests

on: [push, pull_request]

jobs:
  performance:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Start server
        run: npm start &
        env:
          NODE_ENV: test
          JWT_SECRET: test-secret-min-32-characters-long

      - name: Wait for server
        run: npx wait-on http://localhost:3000/api/health

      - name: Test compression
        run: |
          curl -H "Accept-Encoding: br" -I http://localhost:3000/ | grep -q "Content-Encoding: br"
          echo "✅ Brotli compression active"

      - name: Test caching headers
        run: |
          curl -I http://localhost:3000/assets/css/styles.css | grep -q "Cache-Control: public, max-age=604800"
          echo "✅ Cache headers configured"

      - name: Test performance endpoint
        run: |
          curl http://localhost:3000/api/performance | jq '.verification.compressionActive' | grep -q "true"
          echo "✅ Performance optimizations verified"
```

## Manual QA Checklist

### Before Release

- [ ] Performance endpoint returns "ok" status
- [ ] Health endpoint shows MongoDB connected (production)
- [ ] Compression headers present (Brotli or gzip)
- [ ] Cache-Control headers match specification
- [ ] CSS/JS assets are minified
- [ ] Images are optimized (WebP where supported)
- [ ] Favicon is small (< 1KB)
- [ ] No console errors in browser
- [ ] Lighthouse score > 90
- [ ] Network requests < 30 on homepage
- [ ] First load < 1MB transfer
- [ ] Cached load < 200KB transfer

### Production Deployment Checklist

- [ ] HTTPS enabled and enforced
- [ ] Security headers configured (HSTS, X-Frame-Options, etc.)
- [ ] MongoDB connected (check `/api/health`)
- [ ] CDN configured (if applicable)
- [ ] Compression verified on production URL
- [ ] Caching verified on production URL
- [ ] No mixed content warnings
- [ ] All assets load successfully
- [ ] Performance monitoring enabled
- [ ] Error tracking configured (Sentry)

## Troubleshooting

### Issue: Compression not working

**Symptoms:**

- `Content-Encoding` header missing
- Large transfer sizes
- Performance endpoint shows `compressionActive: false`

**Solutions:**

1. Check `Accept-Encoding` header is sent by client
2. Verify `compression` middleware is loaded
3. Check response size > 1KB (threshold)
4. Verify content-type is compressible

### Issue: Caching headers incorrect

**Symptoms:**

- Wrong `Cache-Control` values
- Assets not cached by browser
- Too aggressive caching (auth issues)

**Solutions:**

1. Check static file middleware order in `server.js`
2. Verify path matches caching rules
3. Clear browser cache and test
4. Check for middleware overriding headers

### Issue: MongoDB not connected

**Symptoms:**

- Health endpoint shows `activeBackend: "local"`
- Readiness probe returns 503
- "Using local file storage" in logs

**Solutions:**

1. Verify `MONGODB_URI` is set correctly
2. Check network access in MongoDB Atlas
3. Verify database credentials
4. Check connection string format
5. Review logs for connection errors

### Issue: Slow performance

**Symptoms:**

- Lighthouse score < 80
- Slow page loads
- High query times in metrics

**Solutions:**

1. Check query metrics in health endpoint
2. Verify indexes exist on MongoDB collections
3. Enable compression if disabled
4. Check network latency to MongoDB
5. Review slow query logs
6. Consider adding CDN

## Performance Metrics Tracking

### Key Performance Indicators (KPIs)

**Frontend Performance:**

- First Contentful Paint (FCP): < 1.8s
- Largest Contentful Paint (LCP): < 2.5s
- Cumulative Layout Shift (CLS): < 0.1
- First Input Delay (FID): < 100ms
- Time to Interactive (TTI): < 3.8s

**Backend Performance:**

- API response time (p50): < 100ms
- API response time (p95): < 500ms
- Database query time (avg): < 50ms
- Error rate: < 0.1%
- Uptime: > 99.9%

**Resource Metrics:**

- Total page weight: < 1MB (first load)
- Total page weight: < 200KB (cached)
- HTTP requests: < 30 (first load)
- HTTP requests: < 15 (cached)
- Image optimization: > 80% WebP adoption

### Monitoring Tools

**Recommended:**

1. **Google Lighthouse** - Automated audits
2. **Chrome DevTools** - Network and performance analysis
3. **MongoDB Atlas Monitoring** - Database performance
4. **Sentry** - Error tracking and performance monitoring
5. **Railway/Heroku Metrics** - Server resource usage

**Optional:**

1. **WebPageTest** - Real-world performance testing
2. **GTmetrix** - Performance analysis and recommendations
3. **Cloudflare Analytics** - CDN and caching metrics
4. **New Relic / Datadog** - Application performance monitoring

## Lighthouse in CI (`.lighthouserc.mobile.json`)

CI audits `/`, `/marketplace`, `/pricing` and `/suppliers` on a mobile profile against
`scripts/serve-static.js`, a static test server, not the real app. Two things follow:

- **That server must send what production sends.** It compresses with the production middleware
  (`middleware/compression.js`: Brotli, then gzip). Until it did, the homepage was measured at 4.1 MB
  against 1.8 MB from the real site, and scored about 57 (often under the 0.5 threshold) where
  production scores about 66. `tests/unit/static-server-compression.test.js` starts the server and
  checks it. Anything else production does to a response that affects weight or timing belongs in that
  server too.
- **It is HTTP/1.1 on localhost**, where production is HTTP/2 behind Cloudflare, so a page with many
  small stylesheets (the homepage links 26 in its `<head>`) is slightly worse here than for a visitor.

Measured on the homepage (mobile, 3 runs each, local; compressed server unless noted), so nobody
spends time on these again:

| Change                                                   | Median score      | Largest Contentful Paint |
| -------------------------------------------------------- | ----------------- | ------------------------ |
| Compressed static server (the fix)                       | 66 (from 57)      | 9.0 s (from 22.7 s)      |
| Remove every `backdrop-filter`                           | 66                | 9.0 s                    |
| Preload the LCP image (`collage-venue-640.webp`)         | 67                | 9.1 s                    |
| Load the six below-the-fold stylesheets without blocking | 45 (worse, 42-64) | 9.1 s                    |
| Remove `hero-collage.js`                                 | 65                | 8.2 s                    |
| Remove the hero video                                    | 68                | 8.8 s                    |

The LCP element is `img#collage-venues`. It finishes downloading in under a second; the delay is
main-thread work (style, layout and rendering account for most of 11 s of CPU-throttled time) spread
across 26 stylesheets (381 KiB) and 58 scripts (1 MB), not any one of them. A real improvement needs
fewer, larger files (bundling), which changes how every page loads its CSS and JS and needs its own
plan. The thresholds are deliberately unchanged.

## Additional Resources

- [MDN: HTTP Caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [MDN: HTTP Compression](https://developer.mozilla.org/en-US/docs/Web/HTTP/Compression)
- [Google: Web Vitals](https://web.dev/vitals/)
- [Brotli vs Gzip Compression](https://paulcalvano.com/2018-07-25-brotli-compression-how-much-will-it-reduce-your-content/)

---

**Last Updated:** 2026-01-06  
**Version:** 1.0.0
