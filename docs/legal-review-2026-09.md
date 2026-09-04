# Legal review record — 3 September 2026

This is an engineering review of the public product and policy wording. It records what was
checked and why wording changed; it is not legal advice or a substitute for review by a
solicitor. It follows the review recorded in [`legal-review-2026-08.md`](./legal-review-2026-08.md)
and covers what changed in the product since then.

## Product changes reviewed

The review covered the changes merged to `main` between 6 August 2026 and 3 September 2026.

| Change                                                                                                                                                                                                                                          | Public pages or behaviour                                       | Legal assessment                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1595](https://github.com/rhysllwydlewis/EventFlow/pull/1595) Google Ads conversion tag installed site-wide                                                                                                                                    | Every non-admin page                                            | **Material.** The site now loads a third-party advertising tag. The Cookie Policy said the opposite ("We do not use advertising cookies") and the consent UI had no advertising category. Both are fixed below.                                                           |
| [#1594](https://github.com/rhysllwydlewis/EventFlow/pull/1594) SEO Insights dashboard (Search Console + Google Ads keyword gaps)                                                                                                                | `/admin-seo` only                                               | Admin-only aggregate search and keyword data. No new public-facing processing of personal data was identified, so no policy wording was added.                                                                                                                            |
| [#1561](https://github.com/rhysllwydlewis/EventFlow/pull/1561)–[#1570](https://github.com/rhysllwydlewis/EventFlow/pull/1570) Supplier Bot unclaimed listings: published public profiles, marketplace parity, bot media as avatars, claim links | `/suppliers`, supplier profiles, `/marketplace`, location pages | **Material.** EventFlow now publishes supplier listings built from businesses' own public websites, for businesses that never signed up. Nothing in the policies disclosed the sourcing, the lawful basis, or how to get a listing corrected or removed. Addressed below. |
| [#1589](https://github.com/rhysllwydlewis/EventFlow/pull/1589) Cookie consent banner standardised across all pages                                                                                                                              | Site-wide                                                       | The banner is now consistent, which made two long-standing defects visible on every page rather than some: "Accept All" did not grant analytics, and the preferences dialog described analytics as unused. Both are fixed below.                                          |
| [#1598](https://github.com/rhysllwydlewis/EventFlow/pull/1598), backend Sentry repair, CSP narrowing, messenger authorisation fixes                                                                                                             | Server-side                                                     | Security hardening. The Sentry repair makes an existing disclosure accurate rather than aspirational; no wording change was needed.                                                                                                                                       |
| [#1590](https://github.com/rhysllwydlewis/EventFlow/pull/1590)–[#1593](https://github.com/rhysllwydlewis/EventFlow/pull/1593) footer, mobile nav, FAQ overhaul                                                                                  | Customer-facing pages                                           | Presentation only. No policy effect.                                                                                                                                                                                                                                      |

## Implementation checks

Rather than reading the policies against each other, each claim was checked against the code:

- **Advertising.** `public/assets/js/google-ads-tag.js` loads `gtag.js` for `AW-16705708195` on every
  non-admin page, injected by `injectGlobalAnalyticsScripts` in `utils/template-renderer.js`. It was
  gated on the **analytics** consent category, so a visitor consenting to measurement was also
  consenting to advertising technology without being told.
- **Consent categories.** `public/assets/js/cookie-consent.js` offered essential, functional and
  analytics. Its "Accept All" button wrote `analytics: false`, so neither PostHog nor the Google Ads
  tag could ever start from the banner, and the preferences dialog described analytics as "currently
  unused".
- **Unclaimed listings.** `services/supplierBotIngestion.service.js` builds supplier records from a
  crawled business website — trading name, description, category, a published phone number or email
  address, location, and images taken from that site with the source recorded.
  `services/supplierBotClaim.service.js` verifies control of the business, normally through an email
  address on the business's own domain, before handing the listing over.
- **Analytics and diagnostics.** PostHog gating, replay masking and Sentry filtering were re-checked
  and continue to match the existing disclosures.

## Policies changed

- **Cookie Policy (`/legal#cookies`, v1.2):** removes the incorrect "We do not use advertising
  cookies" statement and adds an Advertising category describing the Google Ads tag, the data Google
  receives, the Consent Mode defaults, and that advertising is a separate choice from analytics. The
  "Accept All / Reject / Manage Preferences" descriptions now match what those buttons do.
- **Privacy Notice (`/privacy`, v1.4):** adds Google Ads to §7.5 (retitled "Analytics, Advertising
  and Service Reliability"), a Google Ads row to the §8.3 transfer table, and an advertising entry to
  §9.2. Adds **§2.9 Supplier Information Collected From Public Sources**, the Article 14 transparency
  information for unclaimed listings — source, categories, lawful basis, objection and removal route,
  and retention — and records the directory in the §3.3 legitimate-interests list.
- **Legal Hub (`/legal`, v1.2):** adds a standalone **Unclaimed Listings** section so a business owner
  arriving to remove a listing can find the route without reading the supplier terms, and cross-links
  it from the supplier terms and the overview.
- **Terms of Use (`/terms`, v1.2):** adds §2(c), which states that an unclaimed listing creates no
  contract, no User relationship and no fee, that it is not an endorsement, and how to claim or remove
  it. Nothing in the Terms binds a business that has not registered.
- **Supplier-Specific Terms (`/legal#supplier-terms`, v1.2):** cross-references the unclaimed listings
  route.
- **Unclaimed Listings Policy (`/legal#unclaimed-listings`, v1.0):** new.
- **Alternative Dispute Resolution:** the EU ODR platform ceased operating on 20 July 2025 and was in
  any event unavailable to UK traders after the transition period. The page directed consumers to it
  as a live route; it now says the platform is closed and points to the UK routes.
- **Company Information:** the platform was classified as an information society service provider
  "as defined by Digital Services Act". The DSA is EU law and does not classify a UK sole trader;
  the reference is now to the Electronic Commerce (EC Directive) Regulations 2002 as they apply in
  the UK.

## Implementation changes made alongside the wording

Policy wording is only accurate if the code matches it, so three code defects were fixed in the same
change:

1. **Advertising is now its own consent category.** `cookie-consent.js` gained a `marketing`
   category, and `google-ads-tag.js` is gated on it rather than on `analytics`. Consent records
   written by an earlier version carry no marketing decision, which is treated as denied until the
   visitor makes one.
2. **"Accept All" now accepts all.** Both the banner and the preferences dialog previously wrote
   `analytics: false` from their Accept All buttons, so the label was misleading and no consented
   analytics or advertising service could start.
3. **Withdrawal now takes effect.** `gtag.js` cannot be unloaded once it is on the page, so the tag
   declares Google Consent Mode v2 defaults of `denied` for `ad_storage`, `ad_user_data` and
   `ad_personalization`, and updates them in both directions on `cookieConsentChanged`.

Fixing the first two at source made two workarounds in `analytics-consent-upgrade.js` not just
redundant but harmful, so they were removed with them:

- It intercepted clicks on both Accept All buttons in the capture phase and wrote the consent
  cookie itself, to compensate for `analytics: false`. That write was a fixed three-field record,
  so it silently discarded the visitor's advertising decision and downgraded every "Accept All"
  back to a pre-advertising consent version. `cookie-consent.js` is now the only writer of the
  cookie, and a test holds it there.
- It rewrote the banner and dialog copy at runtime, matching the banner on the phrase "functional
  cookies". The corrected banner text still contains that phrase, so the override kept replacing a
  message naming analytics and advertising with one that mentioned neither — the change would have
  been invisible to visitors.

One further behavioural gap came out of the category split. The sensitive-page guard
(`installSensitivePageConsentGuard`) forced `analytics: false` on messages, payments, dashboard and
settings pages, which also suppressed the ads tag while it read the analytics category. Now that it
reads `marketing`, the guard forces both off, so no third-party tag runs on those pages.

The preferences dialog also no longer describes analytics as unused, and the cached-asset URLs for
`cookie-consent.js` and `analytics-consent-upgrade.js` were bumped so a browser holding the old
pair cannot keep writing records with no advertising decision.

## Front-end work

The policies were also unreadable at length: the Terms run to 24 sections and the Privacy Notice to
16, and neither offered any way to reach a section without scrolling. A shared enhancement
(`public/assets/css/legal-pages.css`, `public/assets/js/legal-pages.js`) now builds a contents
navigation from the headings already in the markup — sticky sidebar on desktop, a collapsed
disclosure on narrow screens, a filter box where there are more than a dozen sections, scroll-spy
highlighting, heading anchors, a reading-progress bar and a back-to-top control. It is a
progressive enhancement: with JavaScript off, every page keeps its plain document layout.

Two defects turned up while building it:

- The Legal Hub's sidebar was declared `position: sticky` but never stuck, because
  `ui-ux-fixes.css` sets `overflow-x: hidden` on the root and so turns it into a scroll container.
  `overflow-x: clip` prevents the same horizontal overflow without that side effect; it is declared
  after the `hidden` fallback and scoped to the pages that load `legal-pages.css`.
- The hub's twenty-one-entry sidebar had no height limit, so it ran off the bottom of a laptop
  viewport. The list now scrolls inside the sidebar.
- `mobile-optimizations.css` clamps `.card p` to three lines below 768px — a rule written for
  supplier and package cards. The policy documents are a single `.card`, so on a phone every clause
  in the Terms, the Privacy Notice and the Data Subject Rights page was cut off mid-sentence with an
  ellipsis. That is a worse defect than any stale wording found in this review: the documents did not
  show their own text. The clamp is now overridden for legal content.

The hub's decorative emoji were also hidden from assistive technology, and its sidebar became a
`<nav>` landmark rather than a bare `<aside>`.

## Policies reviewed without material wording changes

- **Data Subject Rights, Community Guidelines, Community Help and Appeals, Acceptable Use,
  Copyright/IP, Marketplace Terms:** re-read against current behaviour. Their review dates changed;
  their material-update dates and versions did not.
- **Venue terms:** still no standalone venue route or document. Venue-type providers use the supplier
  flow, so the supplier and unclaimed-listing wording applies.

## Solicitor and operational follow-up

The follow-up list in the August review still stands. This review adds:

1. confirm the Google Ads configuration in production — whether enhanced conversions or customer
   data are in use, since either would need further disclosure and possibly a different lawful basis;
2. confirm Google Ads data retention and the transfer mechanism relied on for Google as an
   independent controller;
3. have a solicitor confirm the legitimate-interests balancing for unclaimed listings, and record a
   legitimate interests assessment (LIA) for it, including the position on images taken from a
   business's own website;
4. decide and document a retention period for unclaimed listings that are never claimed, and for the
   minimum suppression record kept after a removal request; and
5. confirm the operational route for the "Unclaimed listing" mailbox subject line, so removal
   requests are handled within the one-calendar-month response commitment.
