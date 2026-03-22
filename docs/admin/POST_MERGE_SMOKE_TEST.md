# Post-Merge Smoke Test — Admin Consolidation (PR #750)

Run these checks after deploying the consolidation changes to verify deprecated pages
redirect correctly and canonical pages function as expected.

---

## 1. Deprecated page redirects

| Request URL | Expected redirect | Expected status |
|---|---|---|
| `/admin-pexels` | `/admin-media` | 302 |
| `/admin-pexels.html` | `/admin-media` | 302 |
| `/admin-pexels?foo=bar` | `/admin-media?foo=bar` | 302 |
| `/admin-content-dates` | `/admin-content?tab=legalDates` | 302 |
| `/admin-content-dates.html` | `/admin-content?tab=legalDates` | 302 |
| `/admin-content-dates?ref=email` | `/admin-content?ref=email&tab=legalDates` | 302 |

### How to verify (curl)

```bash
# Pexels → Media Center
curl -I http://localhost:3000/admin-pexels
# Expect: HTTP/1.1 302  Location: /admin-media

curl -I "http://localhost:3000/admin-pexels?foo=bar"
# Expect: HTTP/1.1 302  Location: /admin-media?foo=bar

# Content Dates → Content (legalDates tab)
curl -I http://localhost:3000/admin-content-dates
# Expect: HTTP/1.1 302  Location: /admin-content?tab=legalDates

curl -I "http://localhost:3000/admin-content-dates?ref=email"
# Expect: HTTP/1.1 302  Location: /admin-content?ref=email&tab=legalDates
```

---

## 2. Canonical page smoke checks

Log in as an admin and verify the following pages load without JS errors (check browser
console):

| URL | Expected behaviour |
|---|---|
| `/admin-media` | Media Center loads; Pexels picker and photos library present |
| `/admin-content` | Content tabs load; "Legal Dates" tab visible and functional |
| `/admin-content?tab=legalDates` | Page opens directly on the Legal Dates tab |
| `/admin-homepage` | Homepage widget config loads |
| `/admin` | Dashboard loads; no "Pexels" or "Content Dates" entries in navbar |

---

## 3. Admin navbar check

Open `/admin` and inspect the top navigation bar. Confirm:

- ✅ **Media** link points to `/admin-media`
- ✅ **Content** link points to `/admin-content`
- ❌ No "Pexels" standalone entry
- ❌ No "Content Dates" standalone entry

---

## 4. Static-mode parity (serve-static.js)

Run the static server and repeat the redirect checks above:

```bash
node scripts/serve-static.js &
curl -I http://127.0.0.1:5000/admin-pexels
curl -I http://127.0.0.1:5000/admin-content-dates
```

Both should return `302` with the same `Location` headers as production.

---

## 5. Automated test coverage

The following unit test file validates the redirect rules without a running server:

```
tests/unit/admin-deprecated-redirects.test.js
```

Run with:

```bash
npx jest tests/unit/admin-deprecated-redirects.test.js
```
