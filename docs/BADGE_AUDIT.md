# EventFlow Badge Audit

> **Purpose:** Catalog every supplier-related badge used across the EventFlow website, identify where each badge appears, how it is styled, and flag any inconsistencies in naming, styling, icons, or rendering logic.
>
> **Date:** April 2026  
> **Scope:** All visual indicators (labels/tags/badges) displayed on supplier profiles, supplier cards, search results, dashboards, admin pages, and review cards.

---

## Table of Contents

1. [Badge Inventory Table](#1-badge-inventory-table)
2. [Inconsistencies Summary](#2-inconsistencies-summary)
3. [Recommendations](#3-recommendations)

---

## 1. Badge Inventory Table

> **Column guide**
> - **CSS Class(es)** — all classes that produce this badge's visual output (modern + legacy)
> - **Visual / Icon** — the icon/emoji prepended, either via CSS `::before` or inline in HTML
> - **Defined Colors** — background color(s) across every CSS file where the class appears
> - **Pages Used On** — HTML pages / routes where the badge is rendered
> - **Rendering Source File(s)** — JS files that emit the badge HTML
> - **Notes / Inconsistencies** — cross-file discrepancies

| Badge Name | Visual / Icon | CSS Class(es) | Defined Colors (per CSS file) | Pages Used On | Rendering Source File(s) | Notes / Inconsistencies |
|---|---|---|---|---|---|---|
| **Founding Supplier** | Varies (see notes) | `.badge-founding` (modern)<br>`.sp-badge.sp-badge--founding` (suppliers page) | `badges.css`: gold gradient `#fbbf24→#f59e0b`, text `#78350f`<br>`supplier-profile.css` hero: `rgba(245,158,11,0.92)`<br>`suppliers-page.css (.sp-badge--founding)`: flat `#fef3c7 / #92400e` | Supplier profile (`supplier.html`), search/browse results (`index.html` via `app.js`), suppliers browse page (`suppliers.html` via `suppliers-init.js`), supplier cards (`supplier-card.js`), package listings (`package-list.js`), supplier dashboard hero | `verification-badges.js`, `app.js`, `suppliers-init.js`, `supplier-card.js`, `package-list.js` | ⚠️ **Icon inconsistency**: `verification-badges.js` uses `<i class="fas fa-crown">` (Font Awesome crown); `app.js` and `suppliers-init.js` use `⭐` emoji; `supplier-card.js` and `package-list.js` use no icon (plain text only). Server-side `badgeManagement.js` defines icon as `🏆` (trophy) and color `#DC2626` (red) — neither matches any front-end renderer. Auth service adds badge ID `'founder'` (note different spelling: `founding` vs `founder`). |
| **Pro (Subscription Tier)** | `⭐` (CSS `::before` in `badges.css` / `styles.css`) | `.badge-pro` (modern primary)<br>`.supplier-badge.pro` (legacy profile/dashboard)<br>`.pro-badge` (legacy dashboard ribbon)<br>`.tier-badge--pro` (admin tickets)<br>`.sp-badge.sp-badge--pro` (suppliers browse page) | `badges.css (.badge-pro)`: gold gradient `#f59e0b→#d97706`, text `#78350f`<br>`components.css (.badge-pro)`: flat blue `#e3f2fd / #1565c0` ← **conflicts with badges.css**<br>`styles.css (.supplier-badge.pro)`: green gradient `#0B8073→#13B6A2`<br>`styles.css (.pro-badge)`: flat green `#00c896`<br>`subscription.css (.supplier-badge.pro)`: purple gradient `#667eea→#764ba2`<br>`subscription.css (.subscription-badge.pro)`: purple gradient `#667eea→#764ba2`<br>`admin.css (.tier-badge--pro)`: blue gradient `#2563eb→#3b82f6`<br>`supplier-profile.css (.hero-badges .badge-pro)`: gold `rgba(245,158,11,0.95)`<br>`suppliers-page.css (.sp-badge--pro)`: flat blue `#dbeafe / #1d4ed8` | All supplier-facing pages (profile, search, cards), admin support-tickets, subscription management page, supplier dashboard | `verification-badges.js` (renders text `"Pro"`), `app.js` (renders text `"Professional"`), `suppliers-init.js` (renders text `"Pro"`), `supplier-card.js` (renders text `"Professional"`), `package-list.js` (renders text `"Pro"`), `feature-access.js` (renders `"Pro"` via legacy `.supplier-badge.pro`), `admin-tickets-init.js` (via `getTierBadgeHtml()`) | ⚠️ **Color inconsistency**: 4+ different color schemes — gold (badges.css), blue (components.css), green (styles.css), purple (subscription.css). ⚠️ **Naming inconsistency**: text label varies between `"Pro"`, `"Professional"` across renderers. ⚠️ **CSS load-order conflict**: `.badge-pro` in `components.css` is blue flat; in `badges.css` is gold gradient — which wins depends on `<link>` order. |
| **Pro Plus (Subscription Tier)** | `💎` (CSS `::before` in `badges.css`)<br>`👑` (CSS `::before` in `styles.css` / `subscription.css`) | `.badge-pro-plus` (modern primary)<br>`.supplier-badge.pro_plus` (legacy profile/dashboard)<br>`.pro-plus-badge` (legacy dashboard ribbon)<br>`.tier-badge--pro_plus` (admin tickets)<br>`.sp-badge.sp-badge--pro-plus` (suppliers browse page) | `badges.css (.badge-pro-plus)`: purple gradient `#7c3aed→#5b21b6`, text `#fff`<br>`styles.css (.supplier-badge.pro_plus)`: pink gradient `#f093fb→#f5576c`<br>`styles.css (.pro-plus-badge)`: pink gradient `#f093fb→#f5576c`<br>`subscription.css (.supplier-badge.pro_plus)`: pink gradient `#f093fb→#f5576c`<br>`subscription.css (.subscription-badge.pro_plus)`: pink gradient `#f093fb→#f5576c`<br>`admin.css (.tier-badge--pro_plus)`: purple gradient `#7c3aed→#a855f7`<br>`supplier-profile.css (.hero-badges .badge-pro-plus)`: indigo `rgba(99,102,241,0.95)`<br>`suppliers-page.css (.sp-badge--pro-plus)`: flat purple `#f3e8ff / #7c3aed` | All supplier-facing pages (profile, search, cards), admin support-tickets, subscription management page, supplier dashboard | `verification-badges.js` (renders `"Pro Plus"`), `app.js` (renders `"Professional Plus"`), `suppliers-init.js` (renders `"✦ Pro Plus"`), `supplier-card.js` (renders `"Professional Plus"`), `package-list.js` (renders `"Pro Plus"`), `feature-access.js` (renders `"Pro+"` via legacy `.supplier-badge.pro_plus`) | ⚠️ **Naming inconsistency**: `"Pro Plus"`, `"Professional Plus"`, `"Pro+"`, `"✦ Pro Plus"` used interchangeably across renderers. ⚠️ **Icon inconsistency**: `💎` in modern CSS vs `👑` in legacy CSS. ⚠️ **Color inconsistency**: purple (badges.css/admin.css) vs pink gradient (styles.css/subscription.css). ⚠️ **Missing from `lead-quality-helper.js`**: `getSupplierBadges()` handles `pro` and `featured` tiers but has no `pro_plus` branch. |
| **Featured** | `★` (CSS `::before` in `badges.css`)<br>`⭐` inline text in `supplier-card.js` | `.badge-featured` (modern primary)<br>`.sp-badge.sp-badge--featured` (suppliers browse page) | `badges.css (.badge-featured)`: purple gradient `#a78bfa→#8b5cf6`, text `#fff`<br>`components.css (.badge-featured)`: flat orange `#fff3e0 / #e65100` ← **conflicts with badges.css**<br>`supplier-profile.css (.hero-badges .badge-featured)`: `rgba(139,92,246,0.92)`<br>`suppliers-page.css (.sp-badge--featured)`: flat orange `#fff7ed / #c2410c` | Supplier profile, search results, supplier cards, package listings, admin | `verification-badges.js` (renders text `"Featured"`), `app.js` (renders `"Featured"` when `tier === 'featured'`), `supplier-card.js` (renders `"⭐ Featured"` as separate badge), `package-list.js` (renders `"Featured"`), `lead-quality-helper.js` (renders `"Featured"`) | ⚠️ **Color inconsistency**: purple in `badges.css` vs flat orange in `components.css`. ⚠️ **Duplicate rendering**: `supplier-card.js` renders Featured BOTH as a tier badge (`if tier === 'featured'`) AND as a separate boolean badge (`if supplier.featured`), potentially producing two Featured badges for the same supplier. ⚠️ **Semantic mismatch**: some code treats `'featured'` as a `subscriptionTier` value; `verification-badges.js` treats it as a separate `featured` boolean field. |
| **Email Verified** | `✓` (CSS `::before`)<br>`<i class="fas fa-envelope-circle-check">` (in `verification-badges.js`) | `.badge-email-verified` (modern primary)<br>`.sp-badge.sp-badge--email` (suppliers browse page) | `badges.css (.badge-email-verified)`: blue `#dbeafe / #1e40af`, border `#3b82f6`<br>`suppliers-page.css (.sp-badge--email)`: light blue `#e0f2fe / #0369a1` | Supplier profile, search results, supplier cards, package listings | `verification-badges.js` (text `"Email"` with FA icon), `app.js` (text `"Email Verified"`), `supplier-card.js` (text `"Email Verified"`), `suppliers-init.js` (text `"✓ Email"`), `package-list.js` (text `"✓ Email"`) | ⚠️ **Text inconsistency**: `"Email Verified"` vs `"Email"` vs `"✓ Email"` across renderers. In `app.js` this class is also used as a **legacy fallback** with text `"Verified"` when only `supplier.verified` is set (no granular verification data). |
| **Phone Verified** | `✓` (CSS `::before`)<br>`<i class="fas fa-phone-check">` (in `verification-badges.js`) | `.badge-phone-verified` (modern primary)<br>`.sp-badge.sp-badge--phone` (suppliers browse page) | `badges.css (.badge-phone-verified)`: green `#d1fae5 / #065f46`, border `#10b981`<br>`suppliers-page.css (.sp-badge--phone)`: green `#f0fdf4 / #166534` | Supplier profile, search results, supplier cards, package listings | `verification-badges.js` (text `"Phone"` with FA icon), `app.js` (text `"Phone Verified"`), `supplier-card.js` (text `"Phone Verified"`), `suppliers-init.js` (text `"✓ Phone"`), `package-list.js` (text `"✓ Phone"`) | ⚠️ **Text inconsistency**: `"Phone Verified"` vs `"Phone"` vs `"✓ Phone"` across renderers. |
| **Business Verified** | `✓` (CSS `::before`)<br>`<i class="fas fa-building-circle-check">` (in `verification-badges.js`) | `.badge-business-verified` (modern primary)<br>`.sp-badge.sp-badge--business` (suppliers browse page) | `badges.css (.badge-business-verified)`: indigo `#e0e7ff / #3730a3`, border `#6366f1`<br>`suppliers-page.css (.sp-badge--business)`: violet `#f5f3ff / #6d28d9` | Supplier profile, search results, supplier cards, package listings | `verification-badges.js` (text `"Business"` with FA icon), `app.js` (text `"Business Verified"`), `supplier-card.js` (text `"Business Verified"`), `suppliers-init.js` (text `"✓ Business"`), `package-list.js` (text `"✓ Business"`) | ⚠️ **Text inconsistency**: `"Business Verified"` vs `"Business"` vs `"✓ Business"` across renderers. |
| **Verified (Generic / Review)** | `✓` (CSS `::before`) | `.badge-verified` (used on review cards and as legacy supplier badge)<br>`.sp-badge.sp-badge--verified` (suppliers browse page) | `badges.css (.badge-verified)`: inherits `.badge` base; only `::before` defined (no background override)<br>`components.css (.badge-verified)`: green `#e8f5e9 / #2e7d32`<br>`supplier-profile.css (.hero-badges .badge-verified)`: green `rgba(16,185,129,0.92)`, text `#fff`<br>`suppliers-page.css (.sp-badge--verified)`: green `#dcfce7 / #15803d` | Supplier profile hero banner (legacy verified state), supplier search results (`suppliers-init.js` legacy `supplier.verified`), review cards (`reviews.js`) | `reviews.js` (text `"Verified Customer"` when `review.verified`; text `"Email Verified"` as fallback), `suppliers-init.js` (text `"✓ Verified"` when `supplier.verified`) | ⚠️ **Dual usage**: badge is applied both to review cards (customer verification) and as a legacy supplier verification badge. ⚠️ **Incomplete base styles**: `badges.css` only defines the `::before` pseudo-element for `.badge-verified`; the actual background/color come from `components.css` or `supplier-profile.css` depending on page context. |
| **Supplier (Review Cards)** | `🏢` (CSS `::before`) | `.badge-supplier` | `badges.css (.badge-supplier)`: indigo gradient `#6366f1→#4f46e5`, text `#fff`, border `#4338ca` | Supplier review cards (when the reviewer is themselves a supplier) | `reviews.js` (text `"Supplier"` when `review.reviewerIsSupplier`) | Used only on review cards. No conflict with other badge systems. |
| **Fast Responder** (auto-awarded) | `⚡` (CSS `::before`) | `.badge-fast-responder` | `badges.css (.badge-fast-responder)`: amber gradient `#fef3c7→#fde68a`, text `#92400e`, border `#f59e0b` | Supplier profile badge section | `verification-badges.js` (rendered from `supplier.badgeDetails` array when `badge.id === 'fast-responder'`) | Auto-awarded server-side (`badgeManagement.js`) when avg response time < 24 h AND ≥ 5 messages. Badge definition: icon `⚡`, color `#F59E0B`. No CSS/definition conflict. |
| **Top Rated** (auto-awarded) | `🌟` (CSS `::before`) | `.badge-top-rated` | `badges.css (.badge-top-rated)`: yellow gradient `#fef9c3→#fde047`, text `#713f12`, border `#eab308` | Supplier profile badge section | `verification-badges.js` (rendered from `supplier.badgeDetails` when `badge.id === 'top-rated'`) | Auto-awarded when avg rating ≥ 4.5 AND ≥ 3 reviews. Badge definition: icon `🌟`, color `#EAB308`. No conflict. |
| **Expert** (auto-awarded) | `🎓` (CSS `::before`) | `.badge-expert` | `badges.css (.badge-expert)`: purple gradient `#ede9fe→#c4b5fd`, text `#4c1d95`, border `#8b5cf6` | Supplier profile badge section | `verification-badges.js` (rendered from `supplier.badgeDetails` when `badge.id === 'expert'`) | Auto-awarded when > 50 completed events. Badge definition: icon `👨‍🎓` (different from CSS `🎓`). Server icon `👨‍🎓` is only used for custom-type badges that include `badge.icon` in text; standard types rely on CSS `::before`. |
| **Test Data** | `🧪` (CSS `::before` in `badges.css`)<br>No icon in `package-list.js` package-level badge | `.badge-test-data` (supplier badge)<br>`.package-card-badge-test` (package-level, inline CSS in `package-list.js`) | `badges.css (.badge-test-data)`: amber `#fef3c7 / #92400e`, border `#f59e0b`<br>`package-list.js` inline: `.package-card-badge-test { background:#fef3c7; color:#b45309; … }` | Supplier cards (when `supplier.isTest`), package cards (when `package.isTest`), search results | `supplier-card.js` (text `"Test data"`), `app.js` (text `"Test data"`), `suppliers-init.js` (text `"⭐ Founding"` — **see note**), `package-list.js` (text `"🧪 Test data"` in package header; `"Test data"` in supplier mini-badge) | The supplier-level test badge is consistently rendered. The package-level `package-card-badge-test` uses inline CSS rather than the shared `badges.css` class. |
| **Distance** | None (text only) | `.badge-distance`<br>`.sp-badge.sp-badge--distance` (suppliers browse) | `badges.css (.badge-distance)`: blue `#e0f2fe / #0369a1`, pill shape (`border-radius:9999px`)<br>`suppliers-page.css (.sp-badge--distance)`: grey `#f3f4f6 / #6b7280` | Supplier search results when geo-distance data is available | `suppliers-init.js` | ⚠️ **Color inconsistency**: `badges.css` uses a blue color scheme while `suppliers-page.css` renders this as a neutral grey. The two classes target the same semantic badge. |
| **Tier Icon (Inline)** | `⭐` for Pro (HTML emoji)<br>`💎` for Pro Plus (HTML emoji) | `.tier-icon` (base)<br>`.tier-icon-pro` (Pro)<br>`.tier-icon-pro-plus` (Pro Plus) | `badges.css (.tier-icon-pro)`: `color: #d97706`<br>`badges.css (.tier-icon-pro-plus)`: `color: #7c3aed` | Anywhere a supplier name is displayed inline (messages, cards, package list breadcrumbs) | `verification-badges.js` (`renderTierIcon()`) — also referenced as `EFTierIcon` helper in `suppliers-init.js` and `package-list.js` | Renders as a single inline `<span>` next to the supplier name, not a full badge pill. Consistent styling; no known conflicts. |
| **Admin Tier Badge (Pro)** | None (text only) | `.tier-badge.tier-badge--pro` | `admin.css`: blue gradient `#2563eb→#3b82f6`, text `#fff` | Admin support-tickets page | `admin-tickets-init.js` (`getTierBadgeHtml()`) | Admin-only. Intentionally blue (different from supplier-facing gold) to distinguish admin context. |
| **Admin Tier Badge (Pro Plus)** | None (text only) | `.tier-badge.tier-badge--pro_plus` | `admin.css`: purple gradient `#7c3aed→#a855f7`, text `#fff` | Admin support-tickets page | `admin-tickets-init.js` (`getTierBadgeHtml()`) | Admin-only. Purple aligns with `badges.css` modern Pro Plus color, but has no `::before` icon. |
| **Admin Tier Badge (Free)** | None (text only) | `.tier-badge.tier-badge--free` | `admin.css`: grey gradient `#6b7280→#9ca3af`, text `#fff` | Admin support-tickets page | `admin-tickets-init.js` (`getTierBadgeHtml()`) | Admin-only. No equivalent supplier-facing "Free" badge exists. |
| **Legacy Pro Ribbon Badge** | `⭐` (CSS `::before` in `subscription.css`) | `.supplier-badge.pro` (subscription/profile context)<br>`.subscription-badge.pro` (subscription page header) | `subscription.css (.supplier-badge.pro)`: purple gradient `#667eea→#764ba2`<br>`subscription.css (.subscription-badge.pro)`: purple gradient `#667eea→#764ba2`<br>`styles.css (.supplier-badge.pro)`: green gradient `#0B8073→#13B6A2` | Supplier dashboard subscription card, subscription management page | `feature-access.js` (`getSupplierBadgeHtml()` returns `"Pro"`) | ⚠️ **Legacy class still active**: `BADGE_LIFECYCLE.md` references these classes as the canonical implementation, but the modern system uses `.badge-pro`. Both exist simultaneously with different colors. |
| **Legacy Pro Plus Ribbon Badge** | `👑` (CSS `::before`) | `.supplier-badge.pro_plus` (subscription/profile context)<br>`.subscription-badge.pro_plus` (subscription page header)<br>`.pro-plus-badge` (old dashboard) | `subscription.css (.supplier-badge.pro_plus)`: pink gradient `#f093fb→#f5576c`<br>`subscription.css (.subscription-badge.pro_plus)`: pink gradient `#f093fb→#f5576c`<br>`styles.css (.supplier-badge.pro_plus)`: pink gradient `#f093fb→#f5576c`<br>`styles.css (.pro-plus-badge)`: pink gradient `#f093fb→#f5576c` | Supplier dashboard subscription card, subscription management page | `feature-access.js` (`getSupplierBadgeHtml()` returns `"Pro+"`) | ⚠️ **Legacy class still active**: renders `"Pro+"` text (not `"Pro Plus"` or `"Professional Plus"`). Pink color conflicts with modern purple in `badges.css`. |

---

## 2. Inconsistencies Summary

### 2.1 Color Inconsistencies

| Badge | File A | Color A | File B | Color B |
|---|---|---|---|---|
| **Pro** | `badges.css` | Gold gradient `#f59e0b→#d97706` | `components.css` | Flat blue `#e3f2fd / #1565c0` |
| **Pro** | `badges.css` | Gold gradient | `styles.css (.supplier-badge.pro)` | Green gradient `#0B8073→#13B6A2` |
| **Pro** | `badges.css` | Gold gradient | `subscription.css (.supplier-badge.pro)` | Purple gradient `#667eea→#764ba2` |
| **Pro Plus** | `badges.css` | Purple gradient `#7c3aed→#5b21b6` | `styles.css / subscription.css` | Pink gradient `#f093fb→#f5576c` |
| **Featured** | `badges.css` | Purple gradient `#a78bfa→#8b5cf6` | `components.css` | Flat orange `#fff3e0 / #e65100` |
| **Distance** | `badges.css` | Blue `#e0f2fe / #0369a1` | `suppliers-page.css (.sp-badge--distance)` | Grey `#f3f4f6 / #6b7280` |
| **Verified** | `components.css` | Green `#e8f5e9 / #2e7d32` | `supplier-profile.css` hero | `rgba(16,185,129,0.92)` white text |

### 2.2 Naming / Text Inconsistencies

| Badge | Renderer | Text Shown |
|---|---|---|
| **Pro** | `verification-badges.js` | `"Pro"` |
| **Pro** | `app.js`, `supplier-card.js` | `"Professional"` |
| **Pro** | `suppliers-init.js`, `package-list.js` | `"Pro"` |
| **Pro** | `feature-access.js` (legacy) | `"Pro"` |
| **Pro Plus** | `verification-badges.js`, `package-list.js` | `"Pro Plus"` |
| **Pro Plus** | `app.js`, `supplier-card.js` | `"Professional Plus"` |
| **Pro Plus** | `suppliers-init.js` | `"✦ Pro Plus"` |
| **Pro Plus** | `feature-access.js` (legacy) | `"Pro+"` |
| **Email Verified** | `app.js`, `supplier-card.js` | `"Email Verified"` |
| **Email Verified** | `verification-badges.js` | `"Email"` (with FA icon) |
| **Email Verified** | `suppliers-init.js`, `package-list.js` | `"✓ Email"` |
| **Email Verified** | `app.js` (legacy fallback) | `"Verified"` (wrong class context) |
| **Phone Verified** | `app.js`, `supplier-card.js` | `"Phone Verified"` |
| **Phone Verified** | `verification-badges.js` | `"Phone"` (with FA icon) |
| **Phone Verified** | `suppliers-init.js`, `package-list.js` | `"✓ Phone"` |
| **Business Verified** | `app.js`, `supplier-card.js` | `"Business Verified"` |
| **Business Verified** | `verification-badges.js` | `"Business"` (with FA icon) |
| **Business Verified** | `suppliers-init.js`, `package-list.js` | `"✓ Business"` |

### 2.3 Icon Inconsistencies

| Badge | Source | Icon Used |
|---|---|---|
| **Founding Supplier** | `badges.css` (`::before`) | `⭐` |
| **Founding Supplier** | `verification-badges.js` (HTML) | `<i class="fas fa-crown">` (Font Awesome crown) |
| **Founding Supplier** | `app.js` (inline HTML) | `⭐` emoji in text |
| **Founding Supplier** | `suppliers-init.js` (inline HTML) | `⭐` emoji in text |
| **Founding Supplier** | `supplier-card.js` | None (plain text `"Founding Supplier"`) |
| **Founding Supplier** | `package-list.js` | None (plain text `"Founding"`) |
| **Founding Supplier** | `badgeManagement.js` (server definition) | `🏆` (trophy emoji, color `#DC2626`) |
| **Pro Plus** | `badges.css` (`::before`) | `💎` |
| **Pro Plus** | `styles.css` / `subscription.css` (`::before`) | `👑` |
| **Expert** | `badges.css` (`::before`) | `🎓` |
| **Expert** | `badgeManagement.js` (server definition) | `👨‍🎓` |

### 2.4 Duplicate / Conflicting Rendering Logic

1. **Featured badge in `supplier-card.js`**: The `renderBadges()` method pushes a Featured badge when `tier === 'featured'` **and also** when `supplier.featured === true` (a separate boolean field). If a supplier has both `subscription.tier = 'featured'` and `featured = true`, two Featured badges render simultaneously.

2. **Featured as tier vs boolean**: `lead-quality-helper.js` and `app.js` treat `featured` as a `subscriptionTier` string value. `verification-badges.js` treats it as a separate `supplier.featured` / `supplier.featuredSupplier` boolean, independent of tier. This leads to inconsistent behavior depending on which renderer handles the supplier object.

3. **`app.js` duplicate badge area**: `app.js` has two separate badge-rendering code paths — one in `supplierCard()` (the main search result card, lines ~563–605) and another in a secondary listing builder (around line ~2931–2995). Both emit slightly different badge HTML for the same badge types.

### 2.5 Legacy vs Modern CSS Classes

| Modern Class | Legacy Class(es) | Where Legacy Is Still Used |
|---|---|---|
| `.badge-pro` | `.supplier-badge.pro`, `.pro-badge` | `feature-access.js` (`getSupplierBadgeHtml()`), `styles.css` profile area |
| `.badge-pro-plus` | `.supplier-badge.pro_plus`, `.pro-plus-badge` | `feature-access.js` (`getSupplierBadgeHtml()`), `styles.css` profile area |
| `.badge-pro`, `.badge-pro-plus` | `.subscription-badge.pro`, `.subscription-badge.pro_plus` | `subscription.css` subscription management page |

`docs/history/BADGE_LIFECYCLE.md` explicitly documents `.supplier-badge.pro` / `.supplier-badge.pro_plus` as the canonical badge CSS classes, but the codebase has since migrated the primary rendering to `.badge-pro` / `.badge-pro-plus` (in `badges.css`). The lifecycle document is **out of date**.

### 2.6 Missing Pro Plus Handling

`getSupplierBadges()` in `public/assets/js/utils/lead-quality-helper.js` has the following branch:

```js
if (supplier.subscription.tier === 'featured') { … }
else if (supplier.subscription.tier === 'pro') { … }
// ← no 'pro_plus' branch
```

Pro Plus suppliers receive no subscription-tier badge from this function. The gap affects any page that uses `lead-quality-helper` to build supplier badge HTML.

### 2.7 CSS Specificity / Load-order Conflict

`.badge-pro` is defined in both `badges.css` (gold gradient) and `components.css` (flat blue). The winner depends entirely on which `<link>` element appears last in the HTML `<head>`. No `!important` rule resolves the conflict, making the final appearance non-deterministic across pages that load both files.

The same applies to `.badge-featured` (`badges.css` purple vs `components.css` flat orange).

### 2.8 Badge ID Spelling Mismatch

The server-side `auth.service.js` awards badge ID `'founder'` (no trailing `ing`). The rest of the codebase checks for `supplier.badges.includes('founding')` (with `ing`). A supplier registered via the auth flow will receive badge ID `'founder'` but most front-end renderers test for `'founding'`, so the founding badge may silently fail to render for newly-registered founding suppliers.

---

## 3. Recommendations

### 3.1 Consolidate Badge CSS into a Single Source of Truth

Remove or alias badge style overrides from `components.css` (`.badge-pro`, `.badge-featured`, `.badge-verified`) and `styles.css` (`.supplier-badge.*`, `.pro-badge`, `.pro-plus-badge`). Route all badge rendering through the modern classes in `badges.css`. Keep the legacy selectors as aliases (same declaration block) until all render sites are updated, then remove them.

### 3.2 Standardise Badge Text Labels

Pick one canonical text per badge and apply it everywhere:

| Badge | Recommended Text |
|---|---|
| Pro | `Pro` |
| Pro Plus | `Pro Plus` |
| Founding Supplier | `Founding Supplier` |
| Email Verified | `Email Verified` |
| Phone Verified | `Phone Verified` |
| Business Verified | `Business Verified` |

Update `app.js`, `supplier-card.js`, and any other renderer that currently outputs `"Professional"` or `"Professional Plus"`.

### 3.3 Standardise Founding Supplier Icon

Choose one icon (the current `badges.css` `::before: ⭐` is the least disruptive since it applies automatically) and remove the inline crown `<i>` in `verification-badges.js` and the inline `⭐` in `app.js` / `suppliers-init.js`. Update the server-side badge definition (`badgeManagement.js`) to reflect the chosen icon.

### 3.4 Fix the `'founder'` vs `'founding'` ID Mismatch

Change `auth.service.js` to push `'founding'` into the badges array (matching every front-end check), or add a normalisation step in the API layer that maps `'founder'` → `'founding'` before the supplier object reaches the client.

### 3.5 Fix the Featured Duplicate Render in `supplier-card.js`

In `renderBadges()`, collapse the two Featured checks into one:

```js
// Before (buggy):
if (tier === 'featured') { badges.push(…Featured…); }
if (supplier.featured || supplier.featuredSupplier) { badges.push(…⭐ Featured…); }

// After:
const isFeatured = tier === 'featured' || supplier.featured || supplier.featuredSupplier;
if (isFeatured) { badges.push('<span class="badge badge-featured">Featured</span>'); }
```

### 3.6 Add Pro Plus to `lead-quality-helper.js`

```js
} else if (supplier.subscription.tier === 'pro_plus') {
  badges.push('<span class="badge badge-pro-plus">Pro Plus</span>');
}
```

### 3.7 Migrate `feature-access.js` to Modern CSS Classes

Replace the two legacy selectors in `getSupplierBadgeHtml()`:

```js
// Old:
return '<span class="supplier-badge pro">Pro</span>';
return '<span class="supplier-badge pro_plus">Pro+</span>';

// New:
return '<span class="badge badge-pro">Pro</span>';
return '<span class="badge badge-pro-plus">Pro Plus</span>';
```

Then remove `.supplier-badge.pro` and `.supplier-badge.pro_plus` from `styles.css` and `subscription.css` once confirmed unused.

### 3.8 Update `docs/history/BADGE_LIFECYCLE.md`

The document references `.supplier-badge.pro` / `.supplier-badge.pro_plus` as the canonical classes and omits all the earned badges, verification badges, and the `badgeDetails` server model. Either update it to reflect the current system or archive it and link to this audit.

### 3.9 Distance Badge — Align Color Across CSS Files

Decide on a single color scheme for `.badge-distance` / `.sp-badge--distance` and apply it consistently in both `badges.css` and `suppliers-page.css`.

### 3.10 Centralise Badge Rendering

Consider routing all badge rendering through `verification-badges.js` (`renderVerificationBadges()`) by having `app.js`, `supplier-card.js`, `suppliers-init.js`, and `package-list.js` import and call it rather than each maintaining their own badge-building logic. This ensures text, icons, and classes stay consistent automatically.
