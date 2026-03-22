# Post-Merge Smoke Test — Admin Consolidation

Run these checks after deploying to verify deprecated pages redirect correctly,
the unified navbar renders on all admin pages, and the new Exports page works.

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
| `/admin` | Dashboard loads; no "Pexels" or "Content Dates" entries in navbar |
| `/admin-media` | Media Center loads; Pexels picker and photos library present |
| `/admin-content` | Content tabs load; "Legal Dates" tab visible and functional |
| `/admin-content?tab=legalDates` | Page opens directly on the Legal Dates tab |
| `/admin-homepage` | Homepage widget config loads |
| `/admin-exports` | Exports page loads; three export buttons visible |
| `/admin-search` | Search page loads; entity-type search works |
| `/admin-messenger-view` | Messenger moderation view loads (may require `?conversation=<id>`) |

---

## 3. Admin Exports page

Navigate to `/admin-exports` and verify:

- ✅ Page loads with the unified admin navbar
- ✅ "Users CSV" export button triggers a file download
- ✅ "Marketing Contacts CSV" export button triggers a file download
- ✅ "Full Platform Export" shows a confirmation dialog before downloading

---

## 4. Unified navbar rendering

The admin navbar is now rendered from `admin-navbar.js` (`NAV_ITEMS` registry) rather
than being hardcoded in each HTML page.  Verify on any admin page:

- ✅ All nav links are present and point to canonical clean URLs (no `.html`)
- ✅ The active page is highlighted correctly
- ✅ **Exports** link (`📤 Exports`) appears in the navbar and opens `/admin-exports`
- ✅ **Media** link points to `/admin-media`
- ✅ **Content** link points to `/admin-content`
- ❌ No "Pexels" standalone entry
- ❌ No "Content Dates" standalone entry

---

## 5. Admin Registry canonical URL policy

The single source of truth is `config/adminRegistry.js`.  Any new admin page must:

1. Add an entry to `REGISTRY` in `config/adminRegistry.js`
2. Create the `public/<page>.html` file (using `<div id="adminNavbarMount"></div>` for the navbar)
3. Run `npx jest tests/unit/admin-allowlist.test.js tests/unit/admin-registry.test.js` to
   verify the allowlist and serve-static array are in sync automatically

No manual edits to `middleware/adminPages.js` or `scripts/serve-static.js` are needed
for new pages (the registry drives both).

---

## 6. Static-mode parity (serve-static.js)

Run the static server and repeat the redirect checks above:

```bash
node scripts/serve-static.js &
curl -I http://127.0.0.1:5000/admin-pexels
curl -I http://127.0.0.1:5000/admin-content-dates
curl -I http://127.0.0.1:5000/admin-exports
```

The first two should return `302` with the same `Location` headers as production.
The last should return `200` (the exports page HTML).

---

## 7. Automated test coverage

| Test file | What it validates |
|---|---|
| `tests/unit/admin-registry.test.js` | Registry structure, allowlist generation, HTML file sync |
| `tests/unit/admin-allowlist.test.js` | Allowlist ↔ HTML files, serve-static sync, no native dialogs in JS |
| `tests/unit/admin-deprecated-redirects.test.js` | Redirect rules in server.js and serve-static.js |
| `e2e/admin-smoke.spec.js` | All canonical admin pages load without errors; navbar visible |
| `e2e/admin-consolidation.spec.js` | Redirect behaviour for deprecated pages |

Run all admin-related unit tests:

```bash
npx jest tests/unit/admin-registry.test.js tests/unit/admin-allowlist.test.js tests/unit/admin-deprecated-redirects.test.js
```

