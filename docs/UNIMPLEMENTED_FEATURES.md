# Planned But Unimplemented Features - Summary

Based on review of FUTURE_IMPROVEMENTS.md, ROADMAP_PROGRESS.md, ADMIN_DASHBOARD_IMPROVEMENTS.md, and docs/90-DAY-ROADMAP.md

## Priority 1: High Impact Features

### 1. Dashboard Analytics & Visualizations 📊

**Status**: ✅ Implemented (Phase 3/4)
**What was shipped**:

- Chart.js integration for metrics visualization
- Supplier analytics chart (`supplier-analytics-chart.js`) with 7/30/90 day views/enquiries graphs
- Lead quality breakdown charts on supplier dashboard
- Backend analytics API: `GET /api/me/suppliers/:id/analytics`

⚠️ Note: Analytics tracking (recording actual view/enquiry events) still needs implementation — the API returns data but requires tracking hooks.

---

### 2. Skeleton Loaders & Better Loading States 💀

**Status**: ✅ Implemented (Phase 3)
**What was shipped**:

- `public/assets/css/skeleton.css` created
- `public/assets/js/skeleton-loader.js` utility used across dashboard pages
- Skeleton UI replaces "Loading..." text during data fetch

---

### 3. Supplier Trust Badges & Verification 🎖️

**Status**: ✅ Implemented (Phase 2/3)
**What was shipped**:

- `public/assets/js/utils/verification-badges.js` renders verification badges
- `renderVerificationBadges()`, `renderVerificationSection()`, `renderTierIcon()` used on supplier profile page
- Founding supplier badges, email/phone/business verification badges displayed
- Badge CSS styles added

---

### 4. ALTCHA Integration for Lead Quality 🤖

**Status**: ✅ Implemented (PR: implement-altcha-integration)
**What was done**:

- ✅ ALTCHA widget added to `public/auth.html` registration form
- ✅ ALTCHA widget added to `public/contact.html` contact form
- ✅ Server-side verification via `verifyHCaptcha()` in `routes/auth.js` (register) and `routes/misc.js` (contact)
- ✅ Lead scoring already penalises `captchaPassed: false` (`-50` pts) in `utils/leadScoring.js`
- ✅ Sitekey read from `ALTCHA_HMAC_KEY` env var via `<meta name="altcha-sitekey">` or `/api/v1/config`
- ✅ Enquiry threads (`routes/threads.js`) already integrate captcha + lead scoring

---

### 5. Lead Quality Display on Supplier Dashboard 📈

**Status**: ✅ Implemented (Phase 3/4)
**What was shipped**:

- Lead quality badges displayed on each inquiry/message in `public/assets/js/supplier-messages.js`
- Lead quality filter (High/Medium/Low) on supplier dashboard
- Lead quality score stored in threads and displayed to suppliers
- `lead-quality-helper.js` utility used on frontend

---

## Priority 2: Medium Impact Features

### 6. Advanced Image Features 🖼️

**Missing Components**:

- Image lightbox for galleries
- Image zoom on hover/click
- Touch gestures for mobile galleries
- Keyboard navigation for images

**Files to Create**:

- `public/assets/js/components/Lightbox.js`
- `public/assets/js/components/ImageZoom.js`
- Enhance existing `Carousel.js`

**Impact**: Medium - Better UX for photo galleries

---

### 7. Faceted Search & Advanced Filters 🔍

**Status**: ⚠️ Partially Implemented (Phase 4)
**What was shipped**:

- Marketplace filter UI with category, price, condition, keyword, and sort controls
- Supplier search API supports: category, location, price range, rating, amenities, guest count, pro/featured/verified flags, and multiple sort options

**Remaining stubs**:

- Distance sort falls back to relevance (no geo data / 2dsphere index) — see `docs/MARKETPLACE_FILTER_STATUS.md`
- Availability date range filter not yet implemented (no availability fields on supplier documents)

---

### 8. Phone Verification System 📱

**Status**: Not implemented

**Needs**:

- Twilio integration for SMS
- Phone verification flow
- Verification badge display
- Phone number management in settings

**Impact**: Medium - Increases trust, reduces fake accounts

---

### 9. Stripe Payment Integration 💳

**Status**: ⚠️ Partially Implemented (Phase 4 improved Stripe upgrade flow)
**What was shipped**:

- Self-serve subscription upgrade flow fixed
- Stripe webhook handlers present in `webhooks.js`
- Subscription management in `routes/subscriptions-v2.js`

**Still missing**:

- Full billing history page
- Invoice/receipt generation
- Subscription cancellation flow (UI only)

---

## Priority 3: Nice-to-Have Features

### 10. Blog Infrastructure 📝

**Status**: Blog page exists but empty

**Missing**:

- Blog post CMS/editor
- Blog post storage (MongoDB collection)
- Blog listing page
- Blog detail page
- SEO optimization for posts
- Social sharing

---

### 11. Email Templates & Transactional Emails 📧

**Status**: Postmark integrated, templates exist

**Enhancement Needs**:

- Email template editor in admin
- More email types (welcome, verification reminders, lead notifications)
- Email preview before send
- Email analytics

---

### 12. Bulk Operations (Admin) 📦

**Status**: Partially implemented

**Missing**:

- Bulk package operations
- Bulk user operations
- Bulk message sending
- Better selection UI
- Progress indicators for bulk operations

---

### 13. PWA Install Prompt 📲

**Status**: ✅ Implemented (Phase 3/4)
**What was shipped**:

- PWA install prompt added to HTML pages
- "Add to Home Screen" banner implemented
- Service worker and manifest configured

---

### 14. Export Enhancements 📊

**Status**: Basic exports exist

**Missing**:

- PDF export for reports
- Email delivery of exports
- Scheduled exports
- Custom export templates

---

## Priority 4: Infrastructure Improvements

### 15. Sentry Integration (Frontend) 🔍

**Status**: Backend integrated, frontend missing

**Needs**:

- Add `@sentry/browser` to frontend
- Configure source maps
- Add custom error context
- Test error reporting

---

### 16. API Documentation Updates 📚

**Status**: Swagger exists but incomplete

**Needs**:

- Document new v1/v2 API routes
- Add pagination docs
- Update authentication docs
- Add code examples

---

### 17. More Comprehensive Tests 🧪

**Status**: Basic tests exist

**Missing**:

- E2E tests for supplier dashboard
- E2E tests for messaging system
- E2E tests for payment flow
- Load testing for API endpoints
- Visual regression tests

---

## Quick Wins (Can Implement Immediately)

Items previously listed as quick wins that have now been completed:

- ✅ Skeleton loaders (shipped Phase 3)
- ✅ Founding supplier / trust badges (shipped Phase 2/3)
- ✅ Lead quality display on supplier dashboard (shipped Phase 3/4)
- ✅ ALTCHA integration (shipped Phase 2)
- ✅ Dashboard charts / Chart.js visualizations (shipped Phase 3/4)
- ✅ PWA install prompt (shipped Phase 3/4)

Remaining quick wins:

1. Lightbox for photo galleries (1-2 days)
2. Distance sort — requires geo index + postcode lookup (3-5 days)
3. Availability filter — requires schema changes + UI date picker (3-5 days)

---

## Recommendations

### For Next Sprint:

1. Complete analytics tracking (record view/enquiry events for real chart data)
2. Distance sort — add 2dsphere index + postcodes.io lookup
3. Availability filter — add availability fields to supplier documents + UI
4. Advanced image features (lightbox, zoom)

### For Following Sprint:

1. Phone verification — reduces fraud
2. Stripe billing history & invoices
3. Blog infrastructure

---

**Last Updated**: February 2026
**Maintained By**: EventFlow Development Team
