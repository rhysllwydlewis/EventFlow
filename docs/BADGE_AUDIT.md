# EventFlow Badge Reference

> **Purpose:** Canonical reference for every supplier badge in the EventFlow platform, documenting the post-consolidation state: one set of CSS classes, one colour per badge, and consistent text labels across all renderers.
>
> **Last updated:** April 2026

---

## Table of Contents

1. [Badge Reference Table](#1-badge-reference-table)
2. [Changes Made](#2-changes-made)
3. [Implementation Notes](#3-implementation-notes)

---

## 1. Badge Reference Table

> **Icon column** shows the visual as rendered in a browser (emoji / CSS `::before` content).  
> **CSS Class** is the single canonical class to use everywhere.  
> **Pages Used** lists every page / context where the badge is rendered.

| Badge Name                          | Visual / Icon             | CSS Class                          | Colours                                                  | Pages Used On                                                                                                                                                |
| ----------------------------------- | ------------------------- | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Starter** _(free tier)_           | `◆ Starter`               | `.badge-starter`                   | Background `#f1f5f9` · text `#475569` · border `#cbd5e1` | Supplier profile (`supplier.html`), search results (`index.html`), suppliers browse (`suppliers.html`), supplier cards, package listings, supplier dashboard |
| **Pro**                             | `⭐ Pro`                  | `.badge-pro`                       | Gold gradient `#f59e0b → #d97706` · text `#78350f`       | Supplier profile, search results, suppliers browse, supplier cards, package listings, supplier dashboard, admin support tickets                              |
| **Pro Plus**                        | `💎 Pro Plus`             | `.badge-pro-plus`                  | Purple gradient `#7c3aed → #5b21b6` · text `#ffffff`     | Supplier profile, search results, suppliers browse, supplier cards, package listings, supplier dashboard, admin support tickets                              |
| **Founding Supplier**               | `⭐ Founding Supplier`    | `.badge-founding`                  | Gold gradient `#fbbf24 → #f59e0b` · text `#78350f`       | Supplier profile, search results, suppliers browse, supplier cards, package listings, supplier dashboard                                                     |
| **Featured**                        | `★ Featured`              | `.badge-featured`                  | Purple gradient `#a78bfa → #8b5cf6` · text `#ffffff`     | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                         |
| **Email Verified**                  | `✓ Email Verified`        | `.badge-email-verified`            | Background `#dbeafe` · text `#1e40af` · border `#3b82f6` | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                         |
| **Phone Verified**                  | `✓ Phone Verified`        | `.badge-phone-verified`            | Background `#d1fae5` · text `#065f46` · border `#10b981` | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                         |
| **Business Verified**               | `✓ Business Verified`     | `.badge-business-verified`         | Background `#e0e7ff` · text `#3730a3` · border `#6366f1` | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                         |
| **Verified** _(review / legacy)_    | `✓ Verified Customer`     | `.badge-verified`                  | Background `#d1fae5` · text `#065f46` · border `#10b981` | Review cards (verified customer), legacy supplier verified fallback                                                                                          |
| **Supplier** _(review card)_        | `🏢 Supplier`             | `.badge-supplier`                  | Indigo gradient `#6366f1 → #4f46e5` · text `#ffffff`     | Review cards when the reviewer is a supplier                                                                                                                 |
| **Fast Responder** _(auto-awarded)_ | `⚡ Fast Responder`       | `.badge-fast-responder`            | Amber gradient `#fef3c7 → #fde68a` · text `#92400e`      | Supplier profile badges section                                                                                                                              |
| **Top Rated** _(auto-awarded)_      | `🌟 Top Rated`            | `.badge-top-rated`                 | Yellow gradient `#fef9c3 → #fde047` · text `#713f12`     | Supplier profile badges section                                                                                                                              |
| **Expert** _(auto-awarded)_         | `🎓 Expert`               | `.badge-expert`                    | Purple gradient `#ede9fe → #c4b5fd` · text `#4c1d95`     | Supplier profile badges section                                                                                                                              |
| **Test Data**                       | `🧪 Test data`            | `.badge-test-data`                 | Background `#fef3c7` · text `#92400e` · border `#f59e0b` | Supplier cards and package cards when `isTest = true`                                                                                                        |
| **Distance**                        | `0.5 mi` _(dynamic text)_ | `.badge-distance`                  | Background `#e0f2fe` · text `#0369a1` (pill shape)       | Supplier search results when geo-distance API data is returned                                                                                               |
| **Tier Icon — Pro**                 | `⭐` _(inline span)_      | `.tier-icon.tier-icon-pro`         | Color `#d97706`                                          | Inline beside supplier name in messages, cards, package breadcrumbs                                                                                          |
| **Tier Icon — Pro Plus**            | `💎` _(inline span)_      | `.tier-icon.tier-icon-pro-plus`    | Color `#7c3aed`                                          | Inline beside supplier name in messages, cards, package breadcrumbs                                                                                          |
| **Admin Tier — Free**               | `Free`                    | `.tier-badge.tier-badge--free`     | Grey gradient `#6b7280 → #9ca3af` · text `#fff`          | Admin support-tickets page only                                                                                                                              |
| **Admin Tier — Pro**                | `Pro Plus`                | `.tier-badge.tier-badge--pro`      | Blue gradient `#2563eb → #3b82f6` · text `#fff`          | Admin support-tickets page only                                                                                                                              |
| **Admin Tier — Pro Plus**           | `Pro Plus`                | `.tier-badge.tier-badge--pro_plus` | Purple gradient `#7c3aed → #a855f7` · text `#fff`        | Admin support-tickets page only                                                                                                                              |

---

### Badge Visual Previews

The table below shows representative HTML + inline style previews for the primary supplier-facing badges. Screenshots can be generated by opening the `/supplier` profile page locally with appropriate test data.

| Badge             | Preview HTML                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| Starter           | `<span class="badge badge-starter">◆ Starter</span>`                     |
| Pro               | `<span class="badge badge-pro">⭐ Pro</span>`                            |
| Pro Plus          | `<span class="badge badge-pro-plus">💎 Pro Plus</span>`                  |
| Founding Supplier | `<span class="badge badge-founding">⭐ Founding Supplier</span>`         |
| Featured          | `<span class="badge badge-featured">★ Featured</span>`                   |
| Email Verified    | `<span class="badge badge-email-verified">✓ Email Verified</span>`       |
| Phone Verified    | `<span class="badge badge-phone-verified">✓ Phone Verified</span>`       |
| Business Verified | `<span class="badge badge-business-verified">✓ Business Verified</span>` |
| Verified          | `<span class="badge badge-verified">✓ Verified Customer</span>`          |
| Supplier          | `<span class="badge badge-supplier">🏢 Supplier</span>`                  |
| Fast Responder    | `<span class="badge badge-fast-responder">⚡ Fast Responder</span>`      |
| Top Rated         | `<span class="badge badge-top-rated">🌟 Top Rated</span>`                |
| Expert            | `<span class="badge badge-expert">🎓 Expert</span>`                      |
| Test Data         | `<span class="badge badge-test-data">🧪 Test data</span>`                |
| Distance          | `<span class="badge badge-distance">0.5 mi</span>`                       |

---

## 2. Changes Made

This document replaces `docs/history/BADGE_LIFECYCLE.md` as the canonical badge reference. The following inconsistencies were resolved in April 2026:

### 2.1 New Badge: Starter

Added `.badge-starter` for free-tier suppliers. All pages that previously showed no tier badge for free suppliers now show "Starter". This covers:

- `verification-badges.js` → `renderVerificationBadges()`
- `supplier-card.js` → `renderBadges()`
- `app.js` → `supplierCard()` and the dashboard supplier listing
- `suppliers-init.js` → `createSupplierCard()`
- `package-list.js` → supplier mini-badge
- `lead-quality-helper.js` → `getSupplierBadges()`
- `feature-access.js` → `getSupplierBadgeHtml()`

### 2.2 Colour Consolidation

| Badge                  | Old (inconsistent)                                    | New (canonical)                                               |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| **Pro**                | 4 different schemes: gold / blue / green / purple     | Gold gradient `#f59e0b → #d97706` everywhere                  |
| **Pro Plus**           | 2 different schemes: pink / purple                    | Purple gradient `#7c3aed → #5b21b6` everywhere                |
| **Featured**           | Purple (badges.css) vs orange (components.css)        | Purple gradient `#a78bfa → #8b5cf6` everywhere                |
| **Verified**           | Green (components.css) vs teal (supplier-profile.css) | Green `#d1fae5 / #065f46` as base; hero override remains teal |
| **Distance**           | Grey (suppliers-page.css)                             | Blue `#e0f2fe / #0369a1` matching badges.css                  |
| **sp-badge--pro**      | Blue `#dbeafe / #1d4ed8`                              | Warm gold `#fef3c7 / #92400e` to match Pro identity           |
| **sp-badge--pro-plus** | Light purple                                          | Deep purple `#ede9fe / #5b21b6` to match Pro Plus identity    |

### 2.3 Text Label Standardisation

All renderers now use:

| Badge             | Canonical text                                                     |
| ----------------- | ------------------------------------------------------------------ |
| Starter           | `Starter`                                                          |
| Pro               | `Pro`                                                              |
| Pro Plus          | `Pro Plus`                                                         |
| Founding Supplier | `Founding Supplier`                                                |
| Featured          | `Featured`                                                         |
| Email Verified    | `Email Verified` (full badge) / `✓ Email` (sp-badge compact)       |
| Phone Verified    | `Phone Verified` (full badge) / `✓ Phone` (sp-badge compact)       |
| Business Verified | `Business Verified` (full badge) / `✓ Business` (sp-badge compact) |

Previously: "Professional", "Professional Plus", "Pro+", "✦ Pro Plus" were all in use simultaneously.

### 2.4 Icon Standardisation

**Founding Supplier badge:**

| Before                     | File                                  |
| -------------------------- | ------------------------------------- |
| `<i class="fas fa-crown">` | `verification-badges.js`              |
| `⭐` inline text           | `app.js`, `suppliers-init.js`         |
| _(no icon)_                | `supplier-card.js`, `package-list.js` |
| `🏆` (server definition)   | `badgeManagement.js`                  |

**After:** CSS `::before { content: '⭐' }` from `badges.css` handles the icon consistently for all renderers. No renderer inlines a competing icon.

**Pro Plus icon:**

| Before          | File                                              |
| --------------- | ------------------------------------------------- |
| `👑` `::before` | `styles.css`, `subscription.css` (legacy classes) |
| `💎` `::before` | `badges.css` (modern class)                       |

**After:** All legacy `.supplier-badge.pro_plus` now use `💎` `::before` to match `.badge-pro-plus`.

### 2.5 Duplicate Featured Badge Fixed

`supplier-card.js` previously pushed a Featured badge twice — once from the tier check (`tier === 'featured'`) and once from the boolean check (`supplier.featured`). Both paths are now merged into a single `isFeatured` check.

### 2.6 Missing Pro Plus Fixed

`lead-quality-helper.js → getSupplierBadges()` previously had no `pro_plus` branch, silently omitting the tier badge. Fixed with a proper `pro_plus` check using the same tier-resolution pattern as other renderers.

### 2.7 Badge ID Mismatch Fixed

`auth.service.js → _checkFounderBadge()` was pushing `'founder'` into the badges array. All front-end renderers check for `'founding'`. Fixed: now pushes `'founding'`, and all renderers also accept both IDs as a safety net.

### 2.8 Legacy Classes Aligned

The legacy classes (`.supplier-badge.pro`, `.supplier-badge.pro_plus`, `.pro-badge`, `.pro-plus-badge`, `.subscription-badge.pro`, `.subscription-badge.pro_plus`) in `styles.css` and `subscription.css` now use the same canonical colours as the modern `.badge-pro` / `.badge-pro-plus` classes.

### 2.9 CSS Conflict in `components.css` Removed

`.badge-pro` (blue), `.badge-featured` (orange), and `.badge-verified` (different green) were redefined in `components.css`, causing load-order conflicts with `badges.css`. These conflicting overrides have been removed; `badges.css` is now the sole source of truth for badge colours.

---

## 3. Implementation Notes

### CSS Source of Truth

All badge base styles live in `public/assets/css/badges.css`. Do **not** redefine badge colours elsewhere.

The only permitted overrides are in `supplier-profile.css` under `.hero-badges .badge-*` — these apply backdrop-blur and alpha transparency when badges sit on top of the profile banner image.

### JS Source of Truth

All multi-page badge rendering should go through `public/assets/js/utils/verification-badges.js` (`renderVerificationBadges()`). Page-specific renderers (`app.js`, `supplier-card.js`, `suppliers-init.js`, `package-list.js`) maintain their own badge-building for performance reasons but must be kept in sync.

### Tier Resolution

All JS files resolve the subscription tier using this priority order:

1. `supplier.subscriptionTier` (new field)
2. `supplier.subscription.tier` (nested object)
3. `supplier.isPro === true` → `'pro'` (legacy boolean)
4. Fall through → `'free'` (renders Starter badge)

### Earned Badges (Fast Responder, Top Rated, Expert)

These are auto-awarded server-side by `utils/badgeManagement.js` based on performance criteria. They appear in `supplier.badgeDetails[]` and are rendered by `verification-badges.js`. They do not appear in compact card/search contexts — only on the full supplier profile page.

### Admin Tier Badges

`.tier-badge--pro`, `.tier-badge--pro_plus`, `.tier-badge--free` in `admin.css` are intentionally different (blue for Pro, grey for Free) to visually distinguish the admin view from supplier-facing badges. These are rendered only in `admin-tickets-init.js`.

### Suppliers Browse Page (`.sp-badge`)

The suppliers browse page (`suppliers.html`) uses the compact `.sp-badge` system from `suppliers-page.css`. These are smaller pills (10px font, 4px radius) rendered inside `.sp-card-badges`. They carry both their own `sp-badge--*` class and the corresponding `badge-*` class so `badges.css` icon pseudo-elements apply.
