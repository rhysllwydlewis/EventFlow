# Changelog

All notable changes to EventFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [18.2.0] - 2026-03-01

### Added

- **Subscription Plan Change Payment Processing**: `upgradeSubscription` and `downgradeSubscription` now calculate and process pro-rated payment differences via Stripe's proration API. Upgrades apply an immediate prorated charge (`create_prorations`); downgrades are scheduled at period end. Graceful fallback when Stripe is not configured or no Stripe price ID is set for the target plan.
- **Stripe Production Safety Check**: `config/stripe.js` now emits a `warn` log when `STRIPE_SECRET_KEY` starts with `sk_test_` in a production (`NODE_ENV=production`) environment.
- **WebSocket E2E Tests**: Added `e2e/websocket.spec.js` covering connection establishment, endpoint availability, typing-indicator event format, presence API, messenger UI, and network-interruption resilience.
- **Unit Tests — Lead Scoring**: `tests/unit/leadScoring.test.js` covering `calculateLeadScore`, `validateEnquiry`, `isDisposableEmail`, `isBusinessEmail`, `isValidUKPostcode`, `isValidPhone`, and `daysBetween`.
- **Unit Tests — Spam Detection**: `tests/unit/spamDetection.test.js` covering `checkRateLimit`, `checkDuplicate`, `countUrls`, `detectSpamKeywords`, `checkSpam`, and `cleanupCache`.
- **ImageZoom Component**: New `public/assets/js/components/ImageZoom.js` providing zoom-on-hover (desktop) and pinch-to-zoom (mobile) with `prefers-reduced-motion` support and a static `ImageZoom.applyToGallery()` factory helper.
- **Budget Allocation Pie Chart**: New `createBudgetPieChart()` exported from `dashboard-widgets.js`, providing a Chart.js pie chart of event spend by category for the customer dashboard.
- **PWA Install Prompt on More Pages**: Added `pwa-install.js` to `blog.html`, `marketplace.html`, `pricing.html`, `start.html`, `supplier.html`, `for-suppliers.html`, `faq.html`, and `contact.html`.
- **Verification Guide**: Added `docs/VERIFICATION-GUIDE.md` documenting email and phone verification API endpoints, rate limits, security considerations, and frontend integration.
- **`test:debug` Script**: Added `npm run test:debug` to `package.json` which runs Jest with `--detectOpenHandles` to help identify async handles keeping the process alive.

### Changed

- **`jest.config.js` `forceExit` Comment**: Updated to document the known open-handle sources (db-unified timers, middleware) and reference `npm run test:debug` for investigation.
- **Subscription Service Exports**: `processSubscriptionPlanChange` is now exported from `services/subscriptionService.js` for direct use in webhook handlers and admin tools.

## [Unreleased]

### Added

- **Messaging API v2 Complete Feature Parity**: Added 8 missing endpoints to `/api/v2/messages` for full backward compatibility
  - `GET /unread` - Get total unread message count
  - `GET /drafts` - Get all draft messages
  - `GET /sent` - Get all sent messages
  - `GET /conversations` - Alias for `/threads` (backward compatibility)
  - `PUT /:messageId` - Edit messages (currently drafts only, expandable for full edit history)
  - `DELETE /:messageId` - Soft delete messages
  - `POST /threads/:threadId/mark-unread` - Mark thread as unread
  - `POST /threads/:threadId/unarchive` - Unarchive archived threads
- **API Version Configuration**: Created centralized API version constant (`public/assets/js/config/api-version.js`) to prevent future version drift
- **Subscription Email Notifications**: All 5 subscription lifecycle email templates are now wired up
  - `invoice.payment_failed` → `subscription-payment-failed` email with amount, grace period, and update-payment CTA
  - `customer.subscription.trial_will_end` → `subscription-trial-ending` email with days remaining, plan details, and manage-subscription CTA
  - `customer.subscription.created` → `subscription-activated` email with plan features and dashboard CTA
  - `customer.subscription.deleted` → `subscription-cancelled` email with access end date and reactivation CTA
  - `invoice.upcoming` → `subscription-renewal-reminder` email with renewal date, amount, and auto-renew status
- **WebSocket Cookie-First Authentication**: Both v1 and v2 WebSocket servers now authenticate users from the application's HTTP-only JWT cookie at handshake time via `io.use()` middleware, so existing frontend code sending `{ userId }` in the `auth` event works correctly and securely. A token-based fallback is also supported for non-cookie environments.
- **Shared `utils/wsAuth.js` Utility**: Extracts the `userIdFromCookie()` helper (used by both WS servers) into a single tested module
- **Supplier Profile Save-to-Shortlist**: The "Save" button on supplier profile pages now calls `POST /api/shortlist` with full supplier metadata. Handles already-saved (409), unauthenticated (401/403), and error states gracefully.

### Changed

- **Notification Audit Mop-up**:
  - Hardened local ESLint guard to block direct `EventFlowNotifications.show()` and `.clearAll()` calls outside allowlisted fallback files.
  - Extended `NotificationDispatcher` with `show()` and `clearAll()` passthroughs and migrated remaining direct primitive callers to dispatcher usage.
  - Added browser/server enum drift guard test for `NOTIFICATION_TYPES`.
  - Added dated soft-fail expiry gate to `visual-regression.yml` so non-blocking visual/a11y runs cannot silently persist beyond the configured window.
  - Added `check:button-opt-out` CSS exclusion snapshot guard and wired it into CI.
- **Messaging API Standardization**: All frontend messaging code now uses `/api/v2/messages` endpoints exclusively
  - Updated `public/assets/js/messaging.js` (6 endpoints migrated from v1 to v2)
  - Updated `public/assets/js/conversation-handler.js` (7 endpoints migrated from v1 to v2)
  - Zero `/api/v1/messages` references remain in frontend code
  - **Migration Note**: If using messaging API v1 endpoints, change `v1` to `v2` in URLs. Main change: `/threads/:id/mark-read` → `/threads/:id/read`
- **Server Architecture Refactoring**: Modular architecture with 24% reduction in server.js size
  - Extracted inline middleware to dedicated files (`middleware/seo.js`, `middleware/adminPages.js`)
  - Enhanced `middleware/auth.js` with `userExtractionMiddleware()`
  - Enhanced `middleware/cache.js` with API cache control and static caching middleware
  - Extracted route handlers to modular files (`routes/static.js`, `routes/dashboard.js`, `routes/settings.js`)
  - Enhanced `routes/photos.js` with GET /photos/:id endpoint for MongoDB photo serving
  - Removed duplicate route definitions (auth, photos, public stats)
  - Reduced server.js from 4904 lines (152KB) to 3760 lines (117KB)
  - Improved code maintainability and organization
  - Preserved all existing functionality and backward compatibility
  - Maintained deferred middleware patterns for MongoDB initialization
  - Improved logging consistency by replacing console.error with Winston logger in new route files

### Added

- **Documentation**: Created `REFACTORING_SUMMARY.md` documenting architecture improvements

## [18.1.0] - 2026-01-24

### Added

- **Gold Standard Homepage Redesign**: Apple-inspired Liquid Glass UI transformation
  - **Design System Foundation**: New `design-system.css` with 8px grid spacing scale and fluid typography tokens
  - **Liquid Glass Components**: New `liquid-glass.css` with reusable glass effect classes (ef-glass, variants, fallbacks)
  - **Enhanced Glass Effects**: Multi-layer depth with improved backdrop filters, borders, and shadows
  - **Premium Input Styling**: Search input with enhanced glass effect, multi-layer shadows, and GPU acceleration
  - **Liquid Button Effects**: Search button with premium gradient, glass-like depth, and idle glow animation
  - **Uniform CTA Buttons**: Consistent 48px height CTAs with proper alignment and responsive behavior
  - **6-Tier Responsive Design**: Optimized breakpoints (<320px, 320-479px, 480-639px, 640-767px, 768-1023px, 1024px+)
  - **Premium Animations**: Staggered entrance animations (efGlassEnter) with blur and scale effects
  - **Floating Background Blobs**: Organic blob animations for visual depth
  - **Accessibility Enhancements**:
    - Enhanced focus-visible indicators (3px outline with offset)
    - High contrast mode support with solid colors
    - Windows forced colors mode compatibility
    - Comprehensive reduced motion support
  - **Performance Optimizations**:
    - GPU acceleration hints (translateZ, backface-visibility)
    - CSS containment for better paint performance
    - Strategic will-change management on interactions only

### Changed

- **Hero Search Input**: Upgraded to 56px height with enhanced glass effects
- **Hero Search Button**: Upgraded to 56px square with premium gradient and glow
- **CTA Styling**: Modernized with design system tokens and uniform sizing
- **Version**: Bumped to v18.1.0 across all files (package.json, server.js, sw.js)
- **CSS Imports**: Added design-system.css and liquid-glass.css as critical stylesheets

### Design System

- **Spacing Scale**: 8px-based grid system (--space-1 through --space-10)
- **Typography Scale**: Fluid clamp() values for responsive text sizing
- **Color Tokens**: Glass backgrounds, borders, shadows, and brand gradients
- **Animation Tokens**: Cubic-bezier easing functions and duration constants

## [18.0.2] - 2026-01-24

### Added

- **Search Rating Sorting**: Supplier search now uses actual review data for rating-based sorting
  - Reviews fetched and aggregated in real-time
  - `calculatedRating` and `reviewCount` added to search results
- **Photo Management Endpoints**: Complete photo gallery API
  - `GET /api/me/suppliers/:id/photos` - List supplier photos
  - `DELETE /api/me/suppliers/:id/photos/:photoId` - Delete specific photo
  - Automatic file cleanup on deletion
- **Analytics Service**: Track supplier profile views and enquiries
  - `services/analyticsService.js` - New service for analytics tracking
  - Daily aggregation with detailed tracking
  - 7/30/90 day period support
- **Pagination Utilities**: Standardized pagination across all list endpoints
  - `utils/pagination.js` - Reusable pagination helpers
  - Consistent response format with `hasNextPage`, `hasPrevPage`, etc.
- **Push Notification Infrastructure**: Firebase Cloud Messaging support
  - FCM integration in notificationService
  - Device token management
  - Automatic invalid token cleanup

### Changed

- **Gallery Page**: Now uses actual photos API instead of empty state
  - Delete functionality wired up
  - Proper error handling
- **Security Documentation**: CSP inline handler risk documented with remediation plan

### Fixed

- **Pricing Page Visual Overhaul**: Second pass on `/pricing`, replacing decoration with structure and making the page argue for the plans
  - Removed the decorative layer entirely — the gradient ground, blurred brand blobs, frosted-glass hero, layered drop shadows and the teal glow around the featured plan. With every element emphasised there was no hierarchy left; structure now comes from hairlines and space
  - The three plans read as one panel divided by rules rather than three floating cards, and the recommended plan is marked by a tint and a label instead of a ring, a gradient and a glow
  - Call to action moved up beside the price, so the buttons line up because the column heads share a shape rather than because a grid forces them to
  - Every feature now carries a line saying what it does for the supplier, not just what it is called — a feature name alone does not answer the only question the page exists to answer
  - Renders the `upgradePrompt` copy the plans endpoint has served since it was built and nothing had ever displayed
  - Comparison table grouped by what a supplier is buying (getting found, what you can publish, earning trust, handling enquiries, understanding performance, support) instead of a flat list
  - Billing control is a segmented control naming both options rather than an iOS switch whose state had to be inferred from a thumb position
  - Weight, size and colour pulled back to the site scale; the accent is now used only for the primary button, the recommended column and the feature ticks
- **Per-Plan Photo Allowances Are Now Enforced**: `maxPhotos` (10 / 500 / unlimited) had never been wired to anything
  - `routes/photos.js` now rejects gallery uploads past the owner's allowance on both the single and batch paths, returning `PHOTO_LIMIT_REACHED` with the limit and current count. The allowance resolves from the supplier's owner, so an admin uploading on someone's behalf gets that supplier's limit
  - `supplier-gallery.js` reads the allowance from `/api/v2/subscriptions/me` instead of hard-coding ten for every tier, and the dead `maxPhotos` field on `supplier-photo-upload.js` is gone
  - `GET /api/v2/subscriptions/me` now returns the viewer's `limits`, so clients stop inventing their own ceilings
- **Supplier Analytics History Is Now a Plan Entitlement**: added `analyticsWindowDays` (7 / 90 / 365) to the plan matrix
  - `GET /api/supplier/analytics` clamps the requested window to the plan's, and returns a `window` object so the dashboard can explain a shortened range. Nothing is taken away from free — its default was already seven days
- **Homepage Featured Placement Is Now Delivered by Subscribing**: it was driven only by an editorial `featured` flag someone had to set by hand, so buying Professional Plus did not actually buy the benefit
  - `GET /api/packages/featured` now includes packages from suppliers whose plan carries homepage placement, alongside editorially featured ones. The entitlement is re-resolved on each cache refresh, so a lapsed subscription drops out on its own
  - New `supplierPlanTier()` helper in `utils/helpers.js` resolves a supplier's live tier, where `supplierIsProActive()` could only answer "paying for anything"
- **Messaging Allowances Surfaced on the Pricing Page**: `config/messagingLimits.js` has always enforced 10 replies a day and 500-character messages on free against unlimited replies and 5,000 / 10,000 characters on the paid plans. None of it was ever advertised, despite being one of the strongest differences between the plans
- **Pricing Claims Matched to Enforced Entitlements**: The page was advertising allowances the platform does not grant
  - "Unlimited photos" on Professional was false: every tier was capped at ten regardless of plan. Rather than drop the claim, the allowance is now enforced (see above) and the page states 10 / 500 / unlimited
  - Stopped selling email and phone verification and response-time tracking as Professional features. Neither is tier-gated — every supplier has both — so listing them under a paid plan implied a difference that is not there. They now appear in an "Included on every plan" group
  - Softened "Top of category pages — the first supplier customers see" to describe a ranking boost. `supplierRanking.service.js` gives Professional +3 and Plus +5 against a cap of 5 in search, which lifts a profile but does not guarantee the top slot
  - Added package listings (3 / 50 / unlimited) to the cards and the table. These limits are genuinely enforced in `routes/packages.js` and unwound on downgrade by `subscriptionService`, and were the clearest real difference between the plans — the page had never mentioned them
  - Added a regression test pinning the marketing copy to `PLAN_FEATURES` so the two cannot drift apart again
- **Pricing Page Layout and Logic**: Rebuilt `/pricing` so the three plan columns line up and the figures on it come from one source
  - `pricing-redesign.css` was three stacked layers of overrides fighting each other; it is now a single pass. The plan cards subgrid onto one row track list, so heading, price, value line, feature list and button share a baseline across all three columns whatever the copy length — previously every card laid out independently and nothing lined up
  - Fixed the single-column fallback shrinking the call-to-action buttons to their text and pushing them off-centre
  - The "Most popular" pill now straddles the featured card's top edge instead of taking a band out of it, so that column no longer needs extra padding that knocked it out of alignment
  - The billing switch now reads grey when monthly and teal when annual; it was teal in both states, so it never showed which side was selected
  - Feature lists show every listed feature instead of hiding everything past the fifth, and hydrated highlights are reduced to the feature they name rather than a full sentence per bullet
  - Call-to-action labels no longer carry hard-coded prices, which went stale as soon as the billing registry changed since only the price element was hydrated
  - The comparison table gained a price row that follows the monthly/annual switch, plus `scope` on its header cells
  - The free plan no longer posts a Stripe checkout session only to be redirected back, and a signed-in supplier sees "Manage your plan" rather than "Create a free profile"
  - Auth state is resolved before plan copy is hydrated, so a signed-out visitor's button is never briefly aimed at checkout
  - Disabled call-to-action states are styled from the stylesheet rather than inline, and stay in the tab order so `aria-disabled` is announced
  - The billing switch is labelled "Pay annually" instead of being labelled by both side labels, which made screen readers announce "Monthly Annual switch"
- **Search Sorting**: Rating sort now uses live review data instead of stale supplier field
- **MOP_UP Items**: Addressed all items from MOP_UP_REVIEW_COMPREHENSIVE.md

### Security

- **CSRF Protection**: Verified all state-changing routes have CSRF middleware
- **CSP Documentation**: Documented inline handler risks and remediation plan
- **Path Traversal Protection**: Photo deletion validates resolved paths stay within public directory

## [18.0.1] - 2026-01-24

### Added

- **Complete Auth Navigation System**: Full-featured auth-nav.js implementation
  - `handleLogout()` function with proper verification
  - Duplicate event handler prevention using cloneNode pattern
  - Cache-busting on /api/auth/me calls with timestamp and headers
  - Periodic auth state validation every 30 seconds
  - Cross-tab logout synchronization via localStorage events
  - Immediate navbar update on logout before redirect
- **WebSocket v2 E2E Tests**: End-to-end tests for real-time features
  - Connection and endpoint availability tests
  - Messaging UI load tests
  - Documentation verification tests
- **Email Webhook Handlers**: Complete implementation of Postmark webhook handlers
  - Delivery tracking in `email_logs` collection
  - Bounce logging in `email_bounces` collection with user marking for hard bounces
  - Spam complaint handling with automatic unsubscribe in `email_complaints` collection
  - Subscription change tracking via link tracker
  - Email open tracking in `email_opens` collection
  - Link click tracking in `email_clicks` collection

### Fixed

- **Auth State Tests**: All 8 auth-state-fixes integration tests now pass
  - `handleLogout` function properly defined and exported
  - cloneNode pattern for duplicate handler prevention
  - Cache-Control headers on auth API calls
  - Logout verification before redirect
  - Periodic validation with setInterval
  - Cross-tab synchronization with storage events

### Changed

- **Version Bump**: Updated to v18.0.1 across all version references
  - package.json version
  - server.js APP_VERSION
  - home-init.js version label
  - sw.js CACHE_VERSION

### Security

- **Email Bounce Handling**: Hard bounces now mark user emails as invalid to prevent repeated delivery attempts
- **Spam Complaint Response**: Automatic unsubscription on spam complaints to maintain sender reputation
- **Auth State Verification**: Logout now verifies completion before redirect to prevent stale sessions

## [18.0.0] - 2026-01-23

### Added

- **Subscription-Based Messaging Limits**: Message and thread creation limits based on subscription tier
  - Free tier: 10 messages/day, 3 threads/day, 500 char limit
  - Starter tier: 50 messages/day, 10 threads/day, 2000 char limit
  - Pro tier: Unlimited messages, unlimited threads, 10000 char limit
  - Enterprise tier: Unlimited messages, unlimited threads, 50000 char limit
  - New `/api/v2/messages/limits` endpoint to check remaining limits
  - 429 status code responses with upgrade prompts when limits reached
- **Subscription Audit Logging**: Complete audit trail for subscription lifecycle
  - SUBSCRIPTION_CREATED: New subscription creation tracking
  - SUBSCRIPTION_UPGRADED: Plan upgrade tracking with before/after comparison
  - SUBSCRIPTION_DOWNGRADED: Plan downgrade tracking with scheduling details
  - SUBSCRIPTION_CANCELLED: Cancellation tracking with reason and timing
  - All events include Stripe subscription IDs, timestamps, and user details
- **WebSocket v1 Deprecation Notice**: Added deprecation warnings
  - JSDoc deprecation notice in websocket-server.js
  - Console warning when v1 mode is initialized
  - Migration guide reference to REALTIME_MESSAGING.md
- **Release Tagging Script**: Automated version tagging
  - npm script: `npm run release:tag`
  - Bash script: `scripts/create-release-tag.sh`

### Changed

- **Version Bump**: Updated to v18.0.0 across the project
- **MessagingService**: Enhanced with subscription tier support
  - `sendMessage()` now accepts optional subscriptionTier parameter
  - `createThread()` now accepts optional subscriptionTier parameter
  - New `checkMessageLimit()` method for rate limit validation
  - New `checkThreadLimit()` method for creation limit validation
- **Messaging Routes**: Enhanced with limit enforcement
  - POST `/api/v2/messages/:threadId` enforces message limits
  - POST `/api/v2/messages/threads` enforces thread creation limits
  - Both routes return 429 with upgrade URL when limits reached

### Removed

- **Unused Code Cleanup**: Removed unused variables and functions
  - navbar.js: Removed unused mobile menu functions (toggleMobileMenu, openMobileMenu, closeMobileMenu)
  - reviewService.js: Removed unused `_metadata` parameter
  - websocket-server-v2.js: Removed unused `_data` parameter

### Fixed

- **Linting Warnings**: Resolved unused variable/function warnings
  - Fixed 3 linting warnings related to unused code
  - All code follows ESLint best practices

### Security

- **Audit Trail Enhancements**: Complete subscription lifecycle tracking
  - All subscription changes now logged with full context
  - IP addresses and user agents tracked for security analysis
  - Changes tracked with before/after comparisons
- **Rate Limiting**: Message spam prevention through tier-based limits
  - Prevents abuse of messaging system
  - Encourages subscription upgrades for power users
  - Graceful error handling on limit errors

### Migration Notes

- **WebSocket v1 Users**: Plan migration to WebSocket v2
  - v1 will be removed in a future major version
  - Set `WEBSOCKET_MODE=v2` to use enhanced WebSocket server
  - See REALTIME_MESSAGING.md for migration guide
- **Messaging Service Consumers**: Update method signatures if needed
  - `sendMessage()` and `createThread()` now accept optional subscriptionTier
  - Existing code works without changes (defaults to 'free' tier)
  - Update callers to pass user's actual subscription tier for proper limits

## [v5.2.0] - Previous Version

Earlier changes are documented in individual PR summaries and documentation files.
