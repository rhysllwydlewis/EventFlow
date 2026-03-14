# EventFlow 0-90 Day Product Roadmap

## Executive Summary

This roadmap transforms EventFlow from an empty marketplace into a competitive, supplier-friendly platform that differentiates through **trust**, **transparency**, and **lead quality**.

### Core Objectives

1. ✅ **Fix trust signals** — Eliminate empty marketplace perception
2. ✅ **Implement transparent pricing** — Clear tiers and billing terms
3. ✅ **Build lead quality system** — Differentiate from Hitched
4. ⏳ **Create supplier dashboard v1** — Provide ROI visibility
5. ⏳ **Add verification system** — Build trust through badges
6. ⏳ **Improve search reliability** — Prevent silent failures
7. ⏳ **Enable monetization** — Self-serve upgrades

### Success Metrics

**30 Days:**

- Homepage bounce rate < 50%
- 50+ supplier signups
- 200+ customer enquiries
- Average lead quality score > 65/100

**60 Days:**

- 10+ paying suppliers (20% conversion)
- Supplier response rate > 60% in 24h
- Dashboard DAU > 40% of suppliers

**90 Days:**

- £2,000+ MRR
- Average lead quality score > 75/100
- Featured placement ROI proven (2x+ profile views)
- 3+ blog posts indexed in Google top 20

---

## SPRINT 1: Days 1-30 (Fix Trust Signals)

### 1.1 Seed Marketplace Content ⚡ CRITICAL

**Status**: ✅ COMPLETED

**Problem**: Homepage shows "Loading..." or zeros, creating empty marketplace perception.

**Solution Implemented**:

- ✅ Created `/utils/seedFoundingSuppliers.js` script
- ✅ Generates 25-30 realistic founding supplier profiles
- ✅ Includes full data: packages, photos, reviews
- ✅ Geographic distribution: London, Manchester, Birmingham, Edinburgh, Cardiff, etc.
- ✅ Category distribution: Venues, Photography, Catering, Entertainment, Decor, Planning
- ✅ Added `isFounding`, `foundingYear`, and `badges` fields to supplier data

**Files Created**:

- `/utils/seedFoundingSuppliers.js`

**Next Steps**:

- [ ] Run seed script: `node utils/seedFoundingSuppliers.js`
- [ ] Update supplier card templates to display "Founding Supplier" badge
- [ ] Test homepage counters show real numbers

---

### 1.2 Fix Loading States & Add Skeleton UI

**Status**: 🔄 TODO

**Problem**: Server-side counters fail gracefully, but still show empty states on first load.

**Implementation Plan**:

1. Create `/public/assets/css/skeleton.css`
2. Add skeleton loader HTML partials
3. Replace loading spinners with skeleton UI
4. Add fallback content for all dynamic sections
5. Implement error boundaries for failed API calls

**Files to Create**:

- `public/assets/css/skeleton.css`
- `public/assets/js/skeleton-loader.js`

**Effort**: 1-2 days

---

### 1.3 Create Pricing Page 🔥 HIGH PRIORITY

**Status**: ✅ COMPLETED

**Problem**: Suppliers won't sign up without knowing costs upfront.

**Solution Implemented**:

- ✅ Created `/public/pricing.html` with 3 clear tiers
- ✅ **FREE**: £0/month (basic profile, 5 photos, standard listing)
- ✅ **PRO**: £49/month for 3 months, then £99/month (lead scoring, priority placement, badges, analytics)
- ✅ **FEATURED**: £199/month (homepage placement, business verification, VIP support)
- ✅ Included comprehensive FAQ section
- ✅ Added trust signals and testimonials
- ✅ Plain-English cancellation terms

**Files Created**:

- `/public/pricing.html`

**Next Steps**:

- [ ] Add link to pricing page in main navigation
- [ ] Add "Pricing" link to footer
- [ ] Add upgrade CTAs in supplier dashboard (when implemented)

---

### 1.4 Implement Basic Lead Validation 🔥 HIGHEST DIFFERENTIATION

**Status**: ✅ PARTIALLY COMPLETED

**Problem**: Suppliers report junk leads on other platforms. This is EventFlow's #1 competitive advantage.

**Solution Implemented**:

- ✅ Created `/utils/leadScoring.js` with comprehensive scoring algorithm
- ✅ Scores enquiries 0-100 based on:
  - Event date (realistic timeline)
  - Contact completeness (phone, email, budget, guests)
  - Message quality (length, spam detection)
  - Email quality (disposable email detection)
  - Behavior signals (time on page, repeat enquiries)
- ✅ Classifies leads as High (75-100), Medium (50-74), Low (0-49)
- ✅ Validates UK postcodes, phone numbers, email formats
- ✅ Detects disposable email providers (10minutemail, mailinator, etc.)
- ✅ Spam keyword detection

**Files Created**:

- `/utils/leadScoring.js`
- `/docs/LEAD-SCORING.md` (comprehensive documentation)

**Next Steps**:

- [ ] Update Thread/Message schema with lead scoring fields
- [ ] Integrate ALTCHA for bot protection
- [ ] Add lead score badge UI components
- [ ] Integrate scoring into enquiry submission endpoint
- [ ] Create supplier dashboard view showing lead quality breakdown

**Effort Remaining**: 3-4 days

---

### 1.5 Add Email Verification Badges

**Status**: 🔄 TODO

**Problem**: No trust signals on supplier profiles.

**Implementation Plan**:

1. Update User schema with verification fields:
   ```javascript
   verifications: {
     email: { verified: Boolean, verifiedAt: Date, method: String },
     phone: { verified: Boolean, verifiedAt: Date },
     business: { verified: Boolean, verifiedAt: Date, documents: [String] }
   }
   ```
2. Create verification email flow (send code, verify within 24 hours)
3. Add "Email Verified ✓" badge to supplier cards and profiles
4. Track verification percentage in supplier dashboard

**Files to Create**:

- `routes/verification.js`
- `utils/emailVerification.js`
- Update `models/index.js` (User schema)

**Effort**: 2-3 days

---

## SPRINT 2: Days 31-60 (Supplier Dashboard v1)

### 2.1 Build Supplier Dashboard - Overview Tab

**Status**: 🔄 TODO

**Problem**: Suppliers need to see ROI to justify staying on platform.

**Dashboard Sections**:

#### A. Overview Tab (Default)

- Profile views (last 7/30/90 days with trend graph)
- Total enquiries received
- Response rate (% responded to within 24h)
- Average response time
- Lead quality breakdown (pie chart: High/Medium/Low)
- Profile completeness progress bar

#### B. Enquiries Tab

- Filterable list with lead score badges
- Sort by: Date, Lead Score, Status
- Quick actions: Mark as contacted, Won/Lost
- Export to CSV

#### C. Messages Tab

- Unified inbox
- Unread count badge
- Quick reply templates

#### D. Profile Tab

- Edit profile shortcut
- Preview as customer sees it
- Profile completeness checklist

**Database Schema**:

- Create `SupplierAnalytics` collection
- Track daily metrics: profileViews, enquiries, responses, avgResponseTime

**API Endpoints**:

```
GET  /api/supplier/dashboard/overview
GET  /api/supplier/dashboard/enquiries?filter=high&sort=date
GET  /api/supplier/dashboard/analytics?period=7d
POST /api/supplier/enquiry/:id/status
```

**Files to Create**:

- `public/dashboard-supplier-v2.html` (enhanced version)
- `public/assets/js/dashboard-supplier.js`
- `public/assets/css/dashboard.css`
- `routes/supplier/dashboard.js`
- `utils/analytics.js`
- `models/SupplierAnalytics` (add to index.js)

**Effort**: 5-7 days

---

### 2.2 Add Phone Verification

**Status**: 🔄 TODO

**Implementation Plan**:

1. Sign up for Twilio account
2. Integrate SMS sending
3. Send 6-digit verification code
4. Add "Phone Verified ✓" badge to profiles
5. Show verification status in dashboard

**Files to Create**:

- `utils/phoneVerification.js`
- Update `routes/verification.js`
- `public/verify-phone.html`

**Environment Variables Needed**:

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

**Effort**: 2-3 days

---

### 2.3 Implement Search Filters & Sort Options 🔥 HIGH PRIORITY

**Status**: 🔄 TODO

**Problem**: Limited discoverability, no sorting options.

**Filters to Add**:

- Distance (5, 10, 25, 50, 100 miles from postcode)
- Price bracket (£, ££, £££, ££££)
- Rating (4+, 4.5+)
- Verified suppliers only (email, phone, business)
- Availability (date range selector)
- Event type

**Sort Options**:

- Relevance (default)
- Distance (nearest first)
- Price (low to high / high to low)
- Rating (highest first)
- Recently joined
- Most reviewed

**Database Indexes**:

```javascript
db.suppliers.createIndex({ location: '2dsphere' });
db.suppliers.createIndex({ rating: -1 });
db.suppliers.createIndex({ createdAt: -1 });
db.suppliers.createIndex({ 'verifications.email.verified': 1 });
```

**Files to Update**:

- `public/suppliers.html` (add filter UI)
- `public/assets/js/suppliers.js` (filter logic)
- `search.js` (backend search with filters)

**Effort**: 4-5 days

---

### 2.4 Add Map Fallback & Error Handling

**Status**: 🔄 TODO

**Problem**: Silent map failures lose conversions.

**Implementation Plan**:

1. Detect Google Maps API failures
2. Show fallback list view with message
3. Add retry button
4. Log errors to Sentry
5. Add error boundaries around map component

**Files to Update**:

- `public/assets/js/map.js`
- `public/suppliers.html`

**Effort**: 1-2 days

---

### 2.5 Launch Blog Content Plan

**Status**: 🔄 TODO

**Content Formats** (3 repeatable templates):

#### A. Real Events (monthly)

- Template: "Emma & James' Rustic Barn Wedding in the Cotswolds"
- Featured suppliers with profile links
- Budget breakdown
- Photos from photographer supplier
- SEO: [Event Type] + [Location] + [Year]

#### B. Supplier Spotlight (bi-weekly)

- Template: "Meet Sarah Jones: London's Top Wedding Photographer"
- Q&A format
- Behind-the-scenes
- Link to supplier profile
- SEO: [Category] + [Location]

#### C. Regional Cost Guides (quarterly)

- Template: "How Much Does a Wedding Cost in Manchester? [2025 Guide]"
- Average costs by category
- Price comparison table
- Link to suppliers in region
- SEO: "wedding cost" + [location] + [year]

**Files to Create**:

- `public/blog-post.html`
- `public/assets/css/blog.css`
- `routes/blog.js` (if not exists)
- Admin interface to create blog posts

**Effort**: 3-4 days (infrastructure) + ongoing content creation

---

## SPRINT 3: Days 61-90 (Monetization Groundwork)

### 3.1 Launch Self-Serve Featured Placement Trials

**Status**: 🔄 TODO

**Problem**: No revenue stream, need to test willingness to pay.

**Implementation Plan**:

1. Sign up for Stripe account
2. Create subscription products in Stripe:
   - Pro Trial: £49/month (3 cycles)
   - Pro Standard: £99/month
   - Featured: £199/month
3. Build self-serve upgrade flow
4. Integrate Stripe Checkout
5. Handle webhooks for subscription events
6. Show upgrade CTAs in dashboard

**Database Schema Updates**:

```javascript
// Add to Supplier model
subscription: {
  tier: String,                    // 'free', 'pro', 'featured'
  status: String,                  // 'active', 'trialing', 'canceled'
  trialEndsAt: Date,
  currentPeriodEnd: Date,
  stripeSubscriptionId: String,
  pricePerMonth: Number
}
```

**Files to Create**:

- `routes/subscriptions.js`
- `public/upgrade.html`
- `utils/stripe.js`
- `middleware/subscriptionCheck.js`
- `utils/webhooks/stripe.js`

**Environment Variables Needed**:

```bash
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_TRIAL=
STRIPE_PRICE_PRO=
STRIPE_PRICE_FEATURED=
```

**Effort**: 5-6 days

---

### 3.2 Add Business Verification (Manual Review)

**Status**: 🔄 TODO

**Problem**: No way to verify legitimate businesses vs. scams.

**Verification Requirements**:

- Upload business registration document (Companies House, VAT cert, or insurance)
- Or: Public liability insurance certificate
- Manual review by admin within 48 hours
- Add "Business Verified ✓" badge (most prestigious)

**Admin Review Interface**:

- Queue of pending verifications
- Document viewer
- Approve/Reject buttons
- Request more info option

**Files to Create**:

- `public/business-verification.html`
- `public/admin-verification-queue.html`
- `routes/admin/verifications.js`
- `utils/documentUpload.js`
- Add `VerificationRequest` to models

**Effort**: 3-4 days

---

### 3.3 Build Budget Tracker Planner Tool (If Retention is Low)

**Status**: 🔄 CONDITIONAL

**Problem**: Low repeat visits, need sticky feature.

**⚠️ Only build if analytics show < 2 average sessions per user in first 60 days**

**Budget Tracker Features**:

- Category-based budget template
- Link saved suppliers to budget categories
- Track actual vs. budgeted costs
- Progress bar visual
- Export to PDF
- Mobile-friendly

**Files to Create**:

- `public/budget-tracker.html` (may already exist)
- `public/assets/js/budget-tracker.js`
- `routes/planner.js`
- Add `Budget` model to index.js

**Effort**: 4-5 days (if needed)

---

### 3.4 Test Promoted Supplier Posts in Search

**Status**: 🔄 TODO

**Monetization Experiment**:

- Allow suppliers to boost individual search result placement
- Pricing: £10/week, £18/fortnight, £30/month
- Show "Promoted" label
- Appear in top 2 slots for specific search queries
- Track CTR, conversion rate, supplier satisfaction

**Files to Create**:

- `routes/promotions.js`
- Update search algorithm to prioritize promoted listings
- Add "Promote This Listing" button in supplier dashboard

**Effort**: 2-3 days

---

### 3.5 Set Up Analytics & KPI Tracking

**Status**: 🔄 TODO

**KPIs to Track**:

1. Supplier signups (weekly)
2. Paying suppliers (#, %)
3. Customer enquiries (weekly)
4. Lead quality score average
5. Supplier response rate
6. Homepage bounce rate
7. Search-to-enquiry conversion
8. Trial-to-paid conversion
9. Churn rate
10. Revenue (MRR, ARR)

**Tools**:

- Google Analytics 4 (already configured — verify events)
- Internal admin dashboard showing KPIs
- Weekly automated email report

**Files to Create**:

- `public/admin-analytics-v2.html` (enhanced)
- `public/assets/js/admin-analytics.js`
- `routes/admin/kpis.js`
- `utils/tracking.js`

**Effort**: 3-4 days

---

## Additional Critical Work

### 3.6 Error Monitoring & Logging

**Status**: ✅ COMPLETED (Sentry already configured)

- ✅ Sentry integrated
- [ ] Log all lead validation failures for analysis
- [ ] Monitor API response times
- [ ] Alert on high error rates

---

### 3.7 Email Infrastructure

**Status**: ✅ COMPLETED (Postmark already configured)

Ensure Postmark configured for:

- ✅ Welcome emails
- ✅ Email verification
- [ ] Enquiry notifications
- [ ] Trial ending reminders
- [ ] Response time nudges

---

### 3.8 Testing

**Status**: 🔄 TODO

**Integration Tests**:

- Lead scoring logic
- Subscription upgrades/downgrades
- Verification flows

**E2E Tests**:

- Supplier signup → profile creation
- Customer search → enquiry flow
- Upgrade to Featured tier

**Files to Create**:

- `tests/unit/lead-scoring.test.js`
- `tests/integration/subscriptions.test.js`
- `e2e/supplier-onboarding.spec.js`
- `e2e/upgrade-flow.spec.js`

**Effort**: 3-4 days

---

## Implementation Priority Order

### Week 1-2

- [x] 1.1 Seed marketplace ✅
- [x] 1.3 Create pricing page ✅
- [x] 1.4 Start lead validation ✅
- [ ] 1.2 Fix loading states
- [ ] 1.4 Complete lead validation integration

### Week 3-4

- [ ] 1.5 Email verification
- [ ] 2.1 Start dashboard Overview tab
- [ ] 2.1 Complete dashboard (all tabs)

### Week 5-6

- [ ] 2.2 Phone verification
- [ ] 2.3 Search filters
- [ ] 2.4 Map fallback

### Week 7-8

- [ ] 2.5 Blog infrastructure + 2 posts
- [ ] 3.1 Self-serve upgrade flow
- [ ] 3.1 Complete Featured placement

### Week 9-10

- [ ] 3.2 Business verification
- [ ] 3.5 Analytics dashboard
- [ ] 3.8 Testing

### Week 11-12

- [ ] 3.3 Budget tracker (if needed)
- [ ] 3.4 Promoted posts experiment
- [ ] Bug fixes and polish

---

## Deferred to Future (Not in 90-Day Scope)

Documented in `/FUTURE_IMPROVEMENTS.md`:

- Account manager program (delay until 100+ paying suppliers)
- Calendar sync integrations (delay until top 3 supplier request)
- PWA mobile app (delay until 40%+ mobile traffic)
- Success fee model (too complex for MVP)
- Seasonal boost ads (need seasonal traffic data first)
- Advanced integrations (Zapier, etc.)

---

## Questions for Product Team

1. **Stripe Account**: Do we have Stripe account set up for production? ✅ (Yes, already configured)
2. **Twilio**: Approved for SMS verification flow?
3. **Founding Suppliers**: Do we have 25-30 real suppliers willing to be "founding suppliers" or should these be realistic demos? → **Decision: Use realistic demo data**
4. **Pricing**: Confirm trial price (£49 vs £39)? → **Confirmed: £49**
5. **Manual Verification**: Who will handle business verification reviews? → **Admin team**

---

## Documentation Status

- [x] `/docs/90-DAY-ROADMAP.md` — This file
- [x] `/docs/LEAD-SCORING.md` — Complete lead scoring documentation
- [x] `/docs/SUBSCRIPTION-TIERS.md` — Pricing and tier details
- [ ] `/docs/VERIFICATION-GUIDE.md` — Email, phone, business verification
- [ ] Update `README.md` — Add roadmap reference
- [ ] Update `FUTURE_IMPROVEMENTS.md` — Document deferred features

---

**Last Updated**: December 2025
**Version**: 1.0
**Status**: Days 1-5 COMPLETED, Days 6-90 IN PROGRESS
**Owner**: Product Team
