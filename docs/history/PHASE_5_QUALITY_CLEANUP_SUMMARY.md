# Phase 5 Quality Cleanup — PR Summary

This document records every change made in the Phase 5 quality cleanup PR, organised by audit item number.

**Date:** February 2026

---

## Pre-Merge Checklist Results

1. ✅ **No regressions** — All modified files have correct syntax, no missing imports, no broken references; 146/147 test suites pass (1 was already skipped before these changes)
2. ✅ **Test compatibility** — Jest coverage thresholds raised modestly (15/17/20/20 → 20/22/25/25); CI should not fail on existing coverage levels
3. ✅ **ES module conversion** — `supplier-profile.js` imports `renderVerificationBadges`, `renderVerificationSection`, and `renderTierIcon` directly; the intermediate `window.*` exposure block removed from `supplier.html`; stale comment updated
4. ✅ **Documentation accuracy** — `UNIMPLEMENTED_FEATURES.md` and `BACKEND_APIS_STATUS.md` now reflect Phase 3–4 shipped features; `MARKETPLACE_FILTER_STATUS.md` created
5. ✅ **Leftover TODOs** — Resolved TODOs removed; remaining TODOs (attachment cloud storage, save-to-favorites) are accurate and intentional
6. ✅ **No secrets or test data** leaked in changes
7. ✅ **Lint pass** — Formatting consistent with existing codebase style
8. ✅ **This summary document** created at `docs/history/PHASE_5_QUALITY_CLEANUP_SUMMARY.md`

### Post-Initial-Commit Review Corrections

After a self-review pass the following bugs introduced in the initial commit were fixed:

- **`config/content-config.js`** — `validateProductionConfig()` incorrectly included `[Not currently VAT` in the placeholder detection list, causing a false-positive info log on every server startup (the `vatNumber: '[Not currently VAT registered]'` value is a permanent legal note, not a replaceable placeholder). Removed from the detection list.
- **`public/assets/js/supplier-profile.js`** — Stale comment "Try to import and use verification-badges module" updated now that the functions are imported directly at module scope.
- **`services/searchService.js`** — Upgraded the minimal distance stub comment to match the detailed explanation added to `search.js` (requirements for 2dsphere index, postcode lookup, `$geoNear`).

---

## Item 3 — Fix Chat Participant Display

**File changed:** `routes/chat-v5.js`

**Problem:** When creating a conversation, every participant other than the current user received hardcoded `displayName: 'User'`, `avatar: null`, and `role: 'customer'` with TODO comments.

**Fix:**

- Resolved the MongoDB `db` instance inside the conversation creation handler
- For each non-current-user participant, looked up the user document in the `users` collection by `_id` (with ObjectId and string fallback)
- Populated `displayName` from `user.name || user.email || 'Unknown User'`
- Populated `avatar` from `user.avatar || null`
- Populated `role` from `user.role || 'customer'`
- Falls back to safe defaults if the user document is not found
- Lookup errors are caught and logged as warnings without breaking conversation creation
- Removed the two TODO comments

---

## Item 4 — Raise Test Coverage Thresholds & Update forceExit Comment

**File changed:** `jest.config.js`

**Problem:** Coverage thresholds were extremely low (15/17/20/20). `forceExit: true` had a TODO to remove it.

**Fix:**

- Raised thresholds to `branches: 20, functions: 22, lines: 25, statements: 25`
- Updated the `forceExit` comment to note the known open-handle issue remains unresolved (Feb 2026); `forceExit: true` kept to avoid CI breakage

---

## Item 5 — Fix Content Config Placeholders

**File changed:** `config/content-config.js`

**Problem:** Placeholder values like `12345678`, `123 Business Street`, `EC1A 1BB` looked like real data and were only warned about in production with strict mode.

**Fix:**

- Renamed placeholder fallbacks to clearly use the `REPLACE_ME_` prefix (e.g. `REPLACE_ME_COMPANY_NUMBER`, `REPLACE_ME_ADDRESS_LINE1`, etc.)
- Added prominent comment blocks above the company and contact sections reminding developers these must be set before production launch
- Updated `validateProductionConfig()` to:
  - Detect `REPLACE_ME_` prefixed values (simpler, unambiguous detection)
  - Log an info-level message in all environments (not just production) when placeholders are found
  - Warn in production or when `CONTENT_CONFIG_STRICT=true`

---

## Item 6 — Document Distance Sort & Availability Filter Stubs

**Files changed:**

- `search.js` — Added `else if (sortBy === 'distance')` stub branch with detailed comment explaining requirements (2dsphere index, postcode→lat/lng lookup, MongoDB `$geoNear`)
- `public/assets/js/marketplace.js` — Replaced vague "in future, could filter by location" comment with a structured STUB comment explaining exactly what's needed
- `docs/MARKETPLACE_FILTER_STATUS.md` — **New file** documenting every filter/sort option, its functional status, and what's needed to complete the stubs

---

## Item 7 — Update Stale UNIMPLEMENTED_FEATURES.md

**File changed:** `docs/UNIMPLEMENTED_FEATURES.md`

**Changes:**

- Marked items 1 (Dashboard Analytics), 2 (Skeleton Loaders), 3 (Trust Badges), 4 (ALTCHA), 5 (Lead Quality Display), 13 (PWA Install Prompt) as ✅ Implemented with notes on what was shipped
- Updated item 7 (Faceted Search) to ⚠️ Partially Implemented — Phase 4 added marketplace filters but distance/availability are stubs
- Updated item 9 (Stripe) to ⚠️ Partially Implemented — Phase 4 improved upgrade flow
- Removed already-completed items from Quick Wins section; listed remaining ones
- Updated Recommendations to reflect current state
- Updated "Last Updated" to February 2026

---

## Item 8 — Update Stale BACKEND_APIS_STATUS.md

**File changed:** `docs/api/BACKEND_APIS_STATUS.md`

**Changes:**

- Added entries for Phase 3–4 additions: Lead Quality API, Marketplace Listings API, Supplier Search V2 API, PWA Manifest
- Added message attachment storage limitation note
- Updated the summary table with all new endpoints and their statuses
- Updated "Last Updated" date to February 2026

---

## Item 9 — Refactor supplier-profile.js Global Exposure

**Files changed:**

- `public/assets/js/supplier-profile.js` — Added ES module import statement at top; updated header comment
- `public/supplier.html` — Removed intermediate `<script type="module">` block that exposed functions on `window`; changed `<script src="...supplier-profile.js">` to `<script type="module" src="...supplier-profile.js">`

**Notes:** The IIFE wrapper inside `supplier-profile.js` is retained as it is harmless inside an ES module and avoids a large refactor. `renderVerificationBadges` and `renderTierIcon` are now available as module-scoped bindings accessed directly by name inside the IIFE closure.

---

## Item 10 — Messaging Attachment Storage Warning

**File changed:** `routes/messaging-v2.js`

**Problem:** `storeAttachment()` silently wrote files to local disk with only a TODO comment about cloud storage.

**Fix:**

- Added `logger.warn(...)` call at the start of every `storeAttachment()` invocation warning that files will be lost on redeployment
- Expanded the JSDoc comment block explaining the production limitation and the steps required to integrate with S3/Cloudinary via the existing `photo-upload.js` infrastructure
- The TODO comment is retained (accurately) since the cloud integration was not implemented in this PR
