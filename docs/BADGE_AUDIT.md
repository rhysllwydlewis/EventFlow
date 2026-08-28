# EventFlow Badge Reference

> **Canonical source of truth** for every badge in the EventFlow platform.
> Post-consolidation state — all inconsistencies resolved April 2026.
> Updated August 2026: added the Unclaimed badge and fixed a hero-renderer
> dead-code bug — see the entries below and "Unclaimed Badge" under
> Dual Badge Systems.

---

## Badge Visual Preview

> **Rendered inline on GitHub:** **[docs/BADGES.md](BADGES.md)** — every badge as an SVG image, visible directly in GitHub without downloading anything.
>
> **Full HTML gallery:** **[docs/badges.html](badges.html)** — open in your browser for the live CSS-rendered version.
>
> GitHub strips inline styles from Markdown, so the HTML gallery lives in a standalone file.
> Open `docs/badges.html` directly in your browser, or view it via GitHub's file viewer.

---

## Badge Reference Table

| Badge Name                           | Visual / Rendered HTML | CSS Class                                             | Colours                                                                                 | Pages Used                                                                                                                                                     | Status |
| ------------------------------------ | ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Customer** _(account type)_        | `🎉 Customer`          | `.badge-customer`                                     | Blue gradient `#dbeafe → #bfdbfe` · text `#1e40af` · border `#3b82f6`                   | Admin users table, admin-users list, admin-user-detail, admin search results, messenger contact picker                                                         | ✅     |
| **Supplier** _(account type)_        | `🏪 Supplier`          | `.badge-supplier-account`                             | Green gradient `#d1fae5 → #a7f3d0` · text `#065f46` · border `#10b981`                  | Admin users table, admin-users list, admin-user-detail, admin search results, messenger contact picker                                                         | ✅     |
| **Partner** _(account type)_         | `🤝 Partner`           | `.badge-partner`                                      | Purple gradient `#ede9fe → #c4b5fd` · text `#4c1d95` · border `#8b5cf6`                 | Admin users table, admin-users list, admin-user-detail, admin search results, messenger contact picker                                                         | ✅     |
| **Admin** _(platform administrator)_ | `🛡️ Admin`             | `.badge-admin`                                        | Red gradient `#dc2626 → #991b1b` · text `#ffffff` · border `#7f1d1d`                    | Admin users table, admin-init user list, all ticket views (supplier/customer/admin tickets), shown **instead of** tier badge                                   | ✅     |
| **Starter** _(free tier)_            | `◆ Starter`            | `.badge-starter`                                      | Gradient `#f1f5f9 → #e2e8f0` · text `#475569` · border `#cbd5e1` · subtle shadow        | Supplier profile, search results, suppliers browse, supplier cards, package listings, supplier dashboard, admin suppliers, admin users _(non-admin role only)_ | ✅     |
| **Pro**                              | `⭐ Pro`               | `.badge-pro`                                          | Gold gradient `#f59e0b → #d97706` · text `#78350f`                                      | Supplier profile, search results, suppliers browse, supplier cards, package listings, supplier dashboard, admin suppliers, admin users                         | ✅     |
| **Pro Plus**                         | `💎 Pro Plus`          | `.badge-pro-plus`                                     | Purple gradient `#7c3aed → #5b21b6` · text `#ffffff`                                    | Supplier profile, search results, suppliers browse, supplier cards, package listings, supplier dashboard, admin suppliers, admin users                         | ✅     |
| **Founding Supplier**                | `⭐ Founding Supplier` | `.badge-founding`                                     | Gold gradient `#fbbf24 → #f59e0b` · text `#78350f` · border `#f59e0b`                   | Supplier profile, search results, suppliers browse, supplier cards, package listings, supplier dashboard                                                       | ✅     |
| **Unclaimed** _(bot-sourced)_        | `🔓 Unclaimed`         | `.badge-unclaimed` (`.sp-badge--unclaimed` on browse) | Orange gradient `#fff7ed → #ffedd5` · text `#9a3412` · border `#fdba74`                 | Supplier profile hero + badges panel, suppliers browse cards                                                                                                   | ✅     |
| **Featured**                         | `★ Featured`           | `.badge-featured`                                     | Purple gradient `#a78bfa → #8b5cf6` · text `#ffffff` · border `#7c3aed`                 | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                           | ✅     |
| **Email Verified**                   | `✓ Email Verified`     | `.badge-email-verified`                               | Blue gradient `#dbeafe → #bfdbfe` · text `#1e40af` · border `#3b82f6` · subtle shadow   | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                           | ✅     |
| **Phone Verified**                   | `✓ Phone Verified`     | `.badge-phone-verified`                               | Green gradient `#dcfce7 → #bbf7d0` · text `#14532d` · border `#22c55e` · subtle shadow  | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                           | ✅     |
| **Business Verified**                | `✓ Business Verified`  | `.badge-business-verified`                            | Indigo gradient `#e0e7ff → #c7d2fe` · text `#3730a3` · border `#6366f1` · subtle shadow | Supplier profile, search results, suppliers browse, supplier cards, package listings                                                                           | ✅     |
| **Verified Customer**                | `✓ Verified Customer`  | `.badge-verified`                                     | Teal gradient `#ccfbf1 → #99f6e4` · text `#134e4a` · border `#14b8a6` · subtle shadow   | Review cards (verified customer reviewer), legacy verified fallback                                                                                            | ✅     |
| **Supplier** _(reviewer)_            | `🏢 Verified Supplier` | `.badge-supplier`                                     | Indigo gradient `#6366f1 → #4f46e5` · text `#ffffff` · `border-radius: 12px`            | Review cards when reviewer is a supplier. Intentionally distinct from `.badge-supplier-account` (green profile badge).                                         | ✅     |
| **Fast Responder** _(auto-awarded)_  | `⚡ Fast Responder`    | `.badge-fast-responder`                               | Amber `#fef3c7 → #fde68a` · text `#92400e`                                              | Supplier profile badges panel only                                                                                                                             | ✅     |
| **Top Rated** _(auto-awarded)_       | `🌟 Top Rated`         | `.badge-top-rated`                                    | Yellow `#fef9c3 → #fde047` · text `#713f12`                                             | Supplier profile badges panel only                                                                                                                             | ✅     |
| **Expert** _(auto-awarded)_          | `🎓 Expert`            | `.badge-expert`                                       | Purple `#ede9fe → #c4b5fd` · text `#4c1d95`                                             | Supplier profile badges panel only                                                                                                                             | ✅     |
| **Custom** _(generic earned)_        | _(badge name)_         | `.badge-custom`                                       | Green gradient `#f0fdf4 → #bbf7d0` · text `#14532d` · border `#22c55e`                  | Supplier profile badges panel (fallback for unrecognised earned badges)                                                                                        | ✅     |
| **New Supplier** _(auto, ≤14 days)_  | `🆕 New`               | `.new-badge`                                          | Teal gradient `#13b6a2 → #0b8073` · text `#ffffff` (pulse animation)                    | Supplier cards on browse/marketplace pages                                                                                                                     | ✅     |
| **Test Data**                        | `🧪 Test data`         | `.badge-test-data`                                    | Background `#fef3c7` · text `#92400e` · border `#f59e0b`                                | Supplier cards and package cards when `isTest = true`                                                                                                          | ✅     |
| **Distance**                         | `0.5 mi` _(dynamic)_   | `.badge-distance` (`.sp-badge--distance`)             | Background `#e0f2fe` · text `#0369a1`                                                   | Suppliers browse page when geo-distance data is available                                                                                                      | ✅     |
| **Tier Icon — Pro**                  | `⭐` _(inline)_        | `.tier-icon.tier-icon-pro`                            | Color `#d97706`                                                                         | Inline beside supplier name in messages, cards, breadcrumbs                                                                                                    | ✅     |
| **Tier Icon — Pro Plus**             | `💎` _(inline)_        | `.tier-icon.tier-icon-pro-plus`                       | Color `#7c3aed`                                                                         | Inline beside supplier name in messages, cards, breadcrumbs                                                                                                    | ✅     |
| **Admin Tier — Free**                | `Free`                 | `.tier-badge.tier-badge--free`                        | Grey gradient `#6b7280 → #9ca3af`                                                       | Admin support-tickets view only                                                                                                                                | ✅     |
| **Admin Tier — Pro**                 | `Pro`                  | `.tier-badge.tier-badge--pro`                         | Blue gradient `#2563eb → #3b82f6`                                                       | Admin support-tickets view only                                                                                                                                | ✅     |
| **Admin Tier — Pro Plus**            | `Pro Plus`             | `.tier-badge.tier-badge--pro_plus`                    | Purple gradient `#7c3aed → #a855f7`                                                     | Admin support-tickets view only                                                                                                                                | ✅     |

---

## Icon & Colour Cheatsheet

| Badge             | Icon (`::before`) | Primary Colour   |
| ----------------- | ----------------- | ---------------- |
| **Admin**         | `🛡️`              | `#dc2626` red    |
| Starter           | `◆` (grey)        | `#f1f5f9`        |
| Pro               | `⭐`              | `#f59e0b` gold   |
| Pro Plus          | `💎`              | `#7c3aed` purple |
| Founding Supplier | `⭐`              | `#fbbf24` gold   |
| Featured          | `★`               | `#a78bfa` purple |
| Email Verified    | `✓`               | `#dbeafe` blue   |
| Phone Verified    | `✓`               | `#d1fae5` green  |
| Business Verified | `✓`               | `#e0e7ff` indigo |
| Verified Customer | `✓`               | `#ccfbf1` teal   |
| Supplier          | `🏢`              | `#6366f1` indigo |
| Fast Responder    | `⚡`              | `#fef3c7` amber  |
| Top Rated         | `🌟`              | `#fef9c3` yellow |
| Expert            | `🎓`              | `#ede9fe` purple |
| Unclaimed         | `🔓`              | `#fff7ed` orange |
| Custom            | _(none)_          | `#f0fdf4` green  |
| New Supplier      | `🆕`              | `#13b6a2` teal   |
| Test Data         | `🧪`              | `#fef3c7` amber  |

---

## Quality Standards

All badges must meet the following minimum standards:

| Property        | Requirement                                                         |
| --------------- | ------------------------------------------------------------------- |
| `border-radius` | ≥ `12px` (pill-shaped)                                              |
| `padding`       | `0.25rem 0.75rem` minimum                                           |
| `font-weight`   | `600` minimum                                                       |
| `font-size`     | `0.75rem` to `0.8125rem`                                            |
| `box-shadow`    | Subtle shadow for depth (tier and verification badges)              |
| Background      | Gradient preferred over flat colour for visual richness             |
| Icon            | CSS `::before` only — **never** inject icon characters inline in JS |
| `white-space`   | `nowrap` to prevent wrapping                                        |
| `transition`    | Smooth hover transition                                             |

**Critical rule:** The CSS `::before` pseudo-element provides the icon for verification badges (`✓`). JavaScript renderers must **not** also include the icon character in the badge text content — that causes the double-icon bug (`✓ ✓ Verified`).

---

## CSS Source of Truth

All badge base styles live in **`public/assets/css/badges.css`**. Do not redefine badge colours elsewhere.

The only permitted overrides are in `supplier-profile.css` under `.hero-badges .badge-*` — these apply backdrop alpha when badges sit over the profile banner image.

The `admin.css` `.tier-badge--*` classes are intentionally different (blue/grey) to distinguish the admin context from supplier-facing badges.

**Admin CSS naming convention:** The `admin.css` `.tier-badge--*` classes use underscores in the Pro Plus modifier (`tier-badge--pro_plus`) to match the database `pro_plus` enum value. This differs from the supplier-facing hyphenated `badge-pro-plus` convention. Both are intentional.

**Suppliers browse page (`.sp-badge--*`):** `public/assets/css/suppliers-page.css` defines a separate `.sp-badge--*` namespace with a compact/muted colour palette optimised for the dense card grid layout. These intentionally differ from the canonical `badges.css` colours:

| Badge    | `badges.css` (canonical)             | `.sp-badge--*` in `suppliers-page.css` (browse grid) |
| -------- | ------------------------------------ | ---------------------------------------------------- |
| Pro      | Gold gradient `#f59e0b → #d97706`    | Amber `#fef3c7 / #92400e`                            |
| Founding | Gold gradient `#fbbf24 → #f59e0b`    | Amber `#fef3c7 / #92400e`                            |
| Featured | Purple gradient `#a78bfa → #8b5cf6`  | Orange `#fff7ed / #c2410c`                           |
| Distance | Blue `#e0f2fe / #0369a1` (canonical) | Grey `#f3f4f6 / #6b7280`                             |

Do **not** remove these differences — they are intentional to avoid visual noise in the dense card grid.

---

## Tier Resolution (JS)

All JS renderers resolve subscription tier in this priority order:

1. `supplier.subscriptionTier` (new field)
2. `supplier.subscription?.tier` (nested object)
3. `supplier.isPro === true` → `'pro'` (legacy boolean)
4. Fall through → `'free'` → renders **Starter** badge

**Never show an empty tier slot** — every supplier gets exactly one tier badge (Starter / Pro / Pro Plus).

---

## Tier Assignment (Server)

Subscription tier is written to the supplier record by two paths:

1. **Stripe webhook** (`webhooks/stripeWebhookHandler.js` → `handleInvoicePaymentSucceeded()`): sets `subscriptionTier` on the supplier document when `invoice.amount_paid > 0`. This is the primary automated write path for tier upgrades and renewals. See `docs/PARTNER_PORTAL.md` for the full Stripe webhook lifecycle.
2. **Admin endpoint** (`POST /api/admin/suppliers/:id/pro`): allows an admin to manually set or override the subscription tier for a supplier.

---

## Dual Badge Systems

The platform has three independent badge evaluation systems. All are legitimate but serve different purposes — "Dual" below is a historical name, kept so existing links to this section don't break.

### 1. `utils/badgeManagement.js` — Supplier-facing earned badges (authoritative for rendering)

These are the badges stored in the `badges` collection and awarded to suppliers. They are rendered as visible badges on supplier profiles.

| Badge             | Auto-award Criteria                               |
| ----------------- | ------------------------------------------------- |
| Fast Responder    | Average response time < 24 h **and** ≥ 5 messages |
| Top Rated         | Average rating ≥ 4.5 **and** ≥ 3 reviews          |
| Expert            | `completedEvents` > 50 (set via admin endpoint)   |
| Verified          | Manual admin award (`autoAssign: false`)          |
| Founding Supplier | Manual admin award (`autoAssign: false`)          |
| Featured          | Manual admin award (`autoAssign: false`)          |

### 2. `reviews.js` `calculateSupplierAnalytics()` — Analytics-only badges

These are computed when review analytics are calculated and stored in the `supplierAnalytics` collection under the `badges` array. They are **not** currently rendered as visible supplier-facing badges — they exist for internal analytics and potential future use.

| Badge             | Criteria                                                |
| ----------------- | ------------------------------------------------------- |
| top-rated         | Average rating ≥ 4.8 **and** ≥ 10 reviews               |
| responsive        | Average response time < 2 h **and** response rate > 80% |
| highly-reviewed   | ≥ 50 reviews                                            |
| customer-favorite | Average rating ≥ 4.7 **and** ≥ 100 reviews              |

**Rule:** Use `badgeManagement.js` as the source of truth for all badge rendering. The analytics badges in `reviews.js` are metadata only.

### 3. `ownershipStatus` — Unclaimed disclosure (not part of the `badges` collection)

The Unclaimed badge is neither an earned `badges` collection entry nor an
analytics badge — it's derived directly from `supplier.ownershipStatus ===
'unclaimed'` (set by `services/supplierBotIngestion.service.js` when a
Supplier Bot profile is created, and cleared when the real business claims
it via `services/supplierBotClaim.service.js`). It is computed at render
time in `renderVerificationBadges()` (`verification-badges.js`) as
priority 0 — it always outranks every other badge, including Founding,
because it's the one signal that undercuts all the others. There is no
`autoAssignCriteria` for it and it never appears in `BADGE_DEFINITIONS`;
don't add it there.

---

## Scheduled Evaluation

Badge evaluation runs automatically on a configurable interval (default: every 24 hours). The scheduler is registered in `server.js` during startup and calls `evaluateAllSupplierBadges()` from `utils/badgeManagement.js`.

Configure the interval via environment variable:

```
BADGE_EVAL_INTERVAL_HOURS=24   # default; set to 1 for hourly, 6 for every 6 hours, etc.
```

Badge evaluation also runs:

- When a new review is submitted (via `services/reviewService.js`)
- On demand via `POST /api/admin/badges/evaluate`
- On demand by the supplier via `POST /api/me/suppliers/:id/badges/evaluate`

---

## Manual Badge Assignment

### Founding Supplier badge

Awarded by an admin to early-access partners. There is no automated criteria.

```bash
# Find the founding badge ID from the badges collection, then award:
curl -X POST https://yourapp.com/api/admin/suppliers/{supplierId}/badges/{foundingBadgeId} \
  -H "Cookie: <admin session>" \
  -H "X-CSRF-Token: <token>"
```

### Featured badge

Awarded by an admin to highlight a supplier. Same endpoint as above, using the featured badge ID.

```bash
curl -X POST https://yourapp.com/api/admin/suppliers/{supplierId}/badges/{featuredBadgeId} \
  -H "Cookie: <admin session>" \
  -H "X-CSRF-Token: <token>"
```

Both badges can also be awarded through the Admin → Suppliers → [Supplier] → Badges UI.

---

## Expert Badge — `completedEvents` Write Path

The Expert badge requires `completedEvents > 50`. Since EventFlow does not yet have a formal event-completion workflow that auto-increments this field, admins can set it manually:

```bash
curl -X PUT https://yourapp.com/api/admin/suppliers/{id}/completed-events \
  -H "Cookie: <admin session>" \
  -H "X-CSRF-Token: <token>" \
  -H "Content-Type: application/json" \
  -d '{"count": 55}'
```

**Future work:** A formal event-lifecycle feature should auto-increment `completedEvents` when an event booked through the platform is marked as completed.

---

## Renderers Inventory

| File                                             | Context                    | Badge Types Rendered                                                                                                                                                                           |
| ------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/assets/js/utils/verification-badges.js`  | Shared utility             | All (Unclaimed, Founding, Starter, Pro, Pro Plus, Featured, Earned, Email/Phone/Business Verified) — `renderVerificationBadges()` is the sole hero renderer; there is no fallback path         |
| `public/assets/js/supplier-profile.js`           | Supplier public profile    | Hero: renders via `renderVerificationBadges()` (imported, capped at 3); Panel (`renderBadgesSection`): Subscription, Ownership (Unclaimed), Earned, Recognition, Verification groups, uncapped |
| `public/assets/js/components/supplier-card.js`   | Inline supplier card       | Starter, Pro, Pro Plus, Founding, Featured, Email/Phone/Business Verified                                                                                                                      |
| `public/assets/js/app.js`                        | Search results + dashboard | Starter, Pro, Pro Plus, Founding, Featured, Email/Phone/Business Verified                                                                                                                      |
| `public/assets/js/pages/suppliers-init.js`       | Suppliers browse page      | Starter (sp-badge), Pro, Pro Plus, Founding, Featured, Verified, Email/Phone/Business                                                                                                          |
| `public/assets/js/components/package-list.js`    | Package listings           | Starter, Pro, Pro Plus, Founding, Email/Phone/Business Verified                                                                                                                                |
| `public/assets/js/utils/lead-quality-helper.js`  | Lead inbox                 | Starter, Pro, Pro Plus, Founding, Featured, Email/Phone/Business Verified                                                                                                                      |
| `public/supplier/js/feature-access.js`           | Supplier dashboard         | Starter, Pro, Pro Plus                                                                                                                                                                         |
| `public/assets/js/pages/admin-suppliers-init.js` | Admin suppliers table      | Starter, Pro, Pro Plus                                                                                                                                                                         |
| `public/assets/js/pages/admin-users-init.js`     | Admin users table          | **Admin** (for role=admin users), Starter, Pro, Pro Plus (for non-admin users)                                                                                                                 |
| `public/assets/js/pages/admin-init.js`           | Admin legacy user list     | **Admin** (for role=admin/owner users)                                                                                                                                                         |
| `public/assets/js/supplier-tickets.js`           | Ticket replies (supplier)  | **Admin** (shown next to admin reply author name)                                                                                                                                              |
| `public/assets/js/customer-tickets.js`           | Ticket replies (customer)  | **Admin** (shown next to admin reply author name)                                                                                                                                              |
| `public/assets/js/pages/admin-tickets-init.js`   | Ticket replies (admin)     | **Admin** (shown next to admin reply author name)                                                                                                                                              |
| `public/assets/js/utils/p3-features.js`          | Supplier cards (browse)    | New Supplier (`.new-badge`, auto for suppliers created ≤ 14 days ago)                                                                                                                          |
| `public/assets/js/suppliers-enhancements.js`     | Supplier cards (browse)    | Applies `p3-features.js` new-badge logic to supplier card elements                                                                                                                             |
| `reviews.js` (`calculateSupplierAnalytics()`)    | Analytics (internal only)  | top-rated, responsive, highly-reviewed, customer-favorite (not rendered as visible badges)                                                                                                     |

---

## Pre-Merge Checklist

- [x] **New `.badge-starter`** — added to `badges.css`, all 10 renderers emit it for free tier
- [x] **Colour consolidation** — Pro: gold everywhere; Pro Plus: purple everywhere; no more teal/pink/blue variants
- [x] **Text standardisation** — "Professional" / "Professional Plus" / "Pro+" / "PRO+" / "FREE" all replaced with "Starter" / "Pro" / "Pro Plus"
- [x] **Icon standardisation** — `⭐` Pro, `💎` Pro Plus, `◆` Starter, `⭐` Founding Supplier; no more `👑`, `🏆`, `✦`, `○` icons
- [x] **Founding text** — "Founding" → "Founding Supplier" in all 7 renderers
- [x] **Duplicate Featured badge** — collapsed in `supplier-card.js`
- [x] **Missing Pro Plus branch** — added in `lead-quality-helper.js`
- [x] **`auth.service.js` ID mismatch** — `'founder'` → `'founding'`
- [x] **`badgeManagement.js`** — Founding: icon `🏆`→`⭐`, colour red→gold, type `'founder'`→`'founding'`
- [x] **`admin-enhanced.css`** — `.badge-pro` teal→gold, `.badge-pro-plus` pink→purple
- [x] **`components.css` conflicts** — removed overriding `.badge-pro` / `.badge-featured` / `.badge-verified`
- [x] **`supplier-profile.js`** — hero + panel: Starter badge, "Pro Plus" text, "Founding Supplier" text, SKIP_TYPES includes `'founding'`
- [x] **`admin-users-init.js`** — "Pro+" → "Pro Plus" (3 locations), `badge-free` → `badge-starter`, tier icons `⭐/✦/○` → `💎/⭐/◆`, `tierLabel` returns "Pro Plus" / "Starter"
- [x] **`admin-suppliers-init.js`** — `subscription-badge badge-free/pro/pro-plus` → `badge badge-starter/pro/pro-plus`, "FREE"/"PRO"/"PRO+" → "Starter"/"Pro"/"Pro Plus"
- [x] **Test updated** — `admin-regression.test.js` assertion updated from "PRO+" to "Pro Plus"
- [x] **Hover animations** — subtle `translateY(-1px)` + glow box-shadow on tier/recognition badges; `prefers-reduced-motion` respected
- [x] **`ui-ux-fixes.css` badge overrides removed** — `.badge-verified`, `.badge-fast-responder`, `.badge-top-rated`, `.badge-expert` block deleted; single source of truth in `badges.css` restored
- [x] **`seed.js` updated** — `seedBadges()` now imports and iterates `BADGE_DEFINITIONS` from `badgeManagement.js`; stale hardcoded data removed
- [x] **`verification-badges.js` icon** — Founding Supplier `👑` → `⭐` in `renderVerificationSection`
- [x] **`badgeManagement.js` Expert icon** — `👨‍🎓` → `🎓` to match `badges.css` and cheatsheet
- [x] **`verification-badges.js` priority comments** — corrected throughout (3a Featured, 3b Earned, 4 Verification)
- [x] **Badge scheduler** — `server.js` now runs `evaluateAllSupplierBadges()` on a configurable interval (default 24 h, `BADGE_EVAL_INTERVAL_HOURS` env var)
- [x] **`completedEvents` write path** — `PUT /api/admin/suppliers/:id/completed-events` endpoint added to `supplier-admin.js`
- [x] **Earned badge visual polish** — `box-shadow` + hover effects added to `.badge-fast-responder`, `.badge-top-rated`, `.badge-expert`, `.badge-custom` in `badges.css` (matching tier badge quality)
- [x] **`ui-ux-fixes.css` blank line cleanup** — extra blank line after badge block removal resolved
- [x] **`REVIEWS_SYSTEM.md` cross-reference** — badge section updated with note clarifying analytics-only badges vs. supplier-facing badges, linking to `BADGE_AUDIT.md`
- [x] **`admin-enhanced.css` `.badge-starter` fix** — admin pages were rendering unstyled Starter badges; `.badge-starter` added alongside `.badge-free` so all admin tables show correct styling
- [x] **`reviews.css` stale badge overrides removed** — conflicting colour definitions for `.badge-verified`, `.badge-email-verified`, `.badge-supplier` removed; `badges.css` is sole colour source
- [x] **`styles.css` `.card-badge` legacy colours updated** — `.card-badge.badge-pro/featured/verified` updated from `#FFD700`/`#13B6A2`/`#28a745` to canonical values matching `badges.css`
- [x] **Admin badge `.badge-admin`** — new class in `badges.css` and `admin-enhanced.css`: red gradient (`#dc2626→#991b1b`), `🛡️` icon, bold white text, `box-shadow`, hover lift, `prefers-reduced-motion` respected
- [x] **Admin badge — `admin-users-init.js`** — admin-role users display `🛡️ Admin` badge instead of a tier badge; `_updateTableSubscriptionBadge` guards against overwriting it on subscription changes
- [x] **Admin badge — `admin-init.js`** — role column uses `.badge-admin` for admin and owner users (owner also gets a small `OWNER` pill)
- [x] **Admin badge — ticket views** — `supplier-tickets.js`, `customer-tickets.js`, `admin-tickets-init.js`: replaced incorrect `badge-in_progress` (a ticket-status class) with `badge-admin` for admin reply attribution
- [x] **Account type role badges** — new `.badge-customer` (blue), `.badge-supplier-account` (green), `.badge-partner` (purple) classes added to `badges.css` and `admin-enhanced.css` (loaded on all 27 admin pages)
- [x] **Role badges in `admin-init.js`** — all roles (customer/supplier/partner/admin) now show a styled badge; previously only admin users got a badge
- [x] **Role badges in `admin-users-init.js`** — Role column now renders role badge via `AdminShared.getRoleBadge()`; admin users show `—` in subscription column instead of admin badge to reduce duplication
- [x] **Role badges in `admin-user-detail-init.js`** — removed `badge-${user.role}` dynamic class (had no CSS); replaced with `getRoleBadge()` helper delegating to `AdminShared.getRoleBadge()`
- [x] **Role badges in `admin-search-init.js`** — user search results now include a role badge alongside the email
- [x] **`AdminShared.getRoleBadge(role)`** — new shared utility method in `admin-shared.js` for consistent role badge rendering across all admin pages
- [x] **Messenger role badges** — `.messenger-v4__role-badge--*` upgraded from flat 4px-corner boxes to pill-shaped (`border-radius: 12px`) gradient badges matching the gold standard; `.badge-partner` variant added
- [x] **Double-tick bug fixed** — inline `✓` removed from JS badge text in `suppliers-init.js`, `supplier-profile.js`, `package-list.js`; CSS `::before` handles the icon
- [x] **`reviews.css` overrides scoped** — `.badge-verified/.badge-email-verified/.badge-supplier` overrides now scoped to `.review-badges-inline` context
- [x] **`components.css` `.badge` base** — upgraded from `display:inline-block / border-radius:4px / font-weight:500` to `display:inline-flex / border-radius:12px / font-weight:600`
- [x] **All 18 badge integration tests pass** — confirmed after all changes (0 failures)
- [x] **CodeQL security scan** — 0 alerts
- [x] **`reviews.js` supplier reviewer badge label** — `'Supplier'` → `'Verified Supplier'`; explanatory comment added clarifying `.badge-supplier` vs `.badge-supplier-account`
- [x] **`.badge-verified` colour update** — shifted from green (`#d1fae5→#a7f3d0`) to teal (`#ccfbf1→#99f6e4`, text `#134e4a`, border `#14b8a6`) to visually distinguish Verified Customer from Supplier account badge
- [x] **`.badge-featured` section grouping fixed** — moved from Section 3 (Verification) to Section 2 (Subscription Tier) in `BADGES.md`, `badges.html`, and `BADGE_AUDIT.md`
- [x] **`.badge-pro` / `.badge-founding` shared icon note** — documented in `BADGES.md` and `BADGE_AUDIT.md` that both intentionally use `⭐` but are distinct badge types
- [x] **Two Supplier badges note** — added annotation in `BADGES.md`, `badges.html`, and `BADGE_AUDIT.md` explaining `.badge-supplier` (reviewer, indigo) vs `.badge-supplier-account` (profile, green)
- [x] **SVG images regenerated** — `badge-verified.svg` updated to teal colours; `badge-supplier.svg` updated to "Verified Supplier" label
- [x] **Unclaimed badge added** (August 2026) — `renderVerificationBadges()`, `renderBadgesSection()`, marketplace card renderer; priority 0, outranks Founding
- [x] **Hero dead-code bug fixed** (August 2026) — `supplier-profile.js`'s hero badge block had `if (typeof renderVerificationBadges === 'function') {...} else { _buildHeroBadges(...) }`. `renderVerificationBadges` is a static import in the same file, so that condition was always true and `_buildHeroBadges` was unreachable from the moment it was written — any edit made to it (including the initial Unclaimed badge addition) silently had no effect on the live page. Removed the dead branch and the function entirely; the hero now always renders through `renderVerificationBadges()`, the same function every other consumer uses. If you're about to edit hero badge logic and land in a function named `_buildHeroBadges`, that function no longer exists — you want `renderVerificationBadges()` in `verification-badges.js`.
- [x] **`verification-badges.js` import versioned** — it was imported at a bare, unversioned URL from `supplier-profile.js`, so editing its content didn't bust returning visitors' 7-day JS cache even after `supplier-profile.js`'s own `?v=` was bumped (ES module imports are cached independently of their importer). Now `import ... from '/assets/js/utils/verification-badges.js?v=1.0.0'` — bump this query string whenever this file's content changes, same as any other cache-busted asset.

---

## Colour Consolidation Summary

| Badge               | Before (inconsistent)                  | After (canonical)                                                                         |
| ------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Pro                 | 4 schemes: gold / teal / blue / purple | Gold gradient `#f59e0b → #d97706`                                                         |
| Pro Plus            | 3 schemes: pink/red / indigo / purple  | Purple gradient `#7c3aed → #5b21b6`                                                       |
| Featured            | Purple vs orange (load-order conflict) | Purple gradient `#a78bfa → #8b5cf6`                                                       |
| Verified Customer   | Green (identical to Supplier account)  | Teal `#ccfbf1 / #134e4a` — shifted to visually distinguish from `.badge-supplier-account` |
| Distance (sp-badge) | Grey                                   | Blue `#e0f2fe / #0369a1`                                                                  |
