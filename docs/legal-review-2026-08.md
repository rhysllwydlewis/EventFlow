# Legal review record — 6 August 2026

This is an engineering review of the public product and policy wording. It records what was checked and why wording changed; it is not legal advice or a substitute for review by a solicitor.

## Product changes reviewed

The review covered the ten most recently merged pull requests at the time of review:

| PR                                                             | Product change                                                                                        | Public pages or behaviour considered                                       | Legal assessment                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1438](https://github.com/rhysllwydlewis/EventFlow/pull/1438) | Guides can be pinned to named cities and both guide catalogues are read                               | `/locations/:citySlug`                                                     | Discovery/editorial change; no additional user data or contract term identified.                                                                                                                                                   |
| [#1437](https://github.com/rhysllwydlewis/EventFlow/pull/1437) | Automatic composition, publication and homepage linking of UK city pages                              | `/`, `/locations`, `/locations/:citySlug`                                  | Privacy and Terms now explain aggregated city discovery and that page availability/content is not a supplier endorsement or availability guarantee.                                                                                |
| [#1436](https://github.com/rhysllwydlewis/EventFlow/pull/1436) | Supplier base/service-area geography, postcode-derived coordinates, city discovery and Pexels imagery | `/suppliers`, supplier profiles, `/locations`, `/locations/:citySlug`      | Privacy now covers supplier/venue postcode, derived coordinates and service areas, Postcodes.io processing, and Pexels web-request data. Supplier terms require accurate location and coverage information.                        |
| [#1435](https://github.com/rhysllwydlewis/EventFlow/pull/1435) | City-page editor and safer supplier-location migration                                                | `/admin-locations`, supplier/location records                              | Administrative and migration controls did not require a new public policy. The location disclosures above cover the underlying processing.                                                                                         |
| [#1434](https://github.com/rhysllwydlewis/EventFlow/pull/1434) | UK city hub-and-spoke pages                                                                           | `/locations`, `/locations/:citySlug`; category route remains feature-gated | Addressed with the city/location wording above.                                                                                                                                                                                    |
| [#1433](https://github.com/rhysllwydlewis/EventFlow/pull/1433) | Community composer layout and modal publishing flow                                                   | `/community`, `/community/new`                                             | The publishing surface does not change the underlying processing, but it confirmed that Community content and the adult declaration needed explicit policy treatment.                                                              |
| [#1432](https://github.com/rhysllwydlewis/EventFlow/pull/1432) | Supplier pricing toggle, site-wide text wrapping and accessibility fixes                              | `/pricing` and shared UI                                                   | The layout work was mainly cosmetic. The underlying recurring plans were checked against Stripe and plan configuration and are now stated in the Terms.                                                                            |
| [#1431](https://github.com/rhysllwydlewis/EventFlow/pull/1431) | Community homepage redesign                                                                           | `/community`                                                               | No separate legal effect from the Community service, covered below.                                                                                                                                                                |
| [#1430](https://github.com/rhysllwydlewis/EventFlow/pull/1430) | Supplier pricing UI and canonical monthly/annual plan metadata                                        | `/pricing`, `/supplier/subscription`                                       | Terms now describe recurring monthly/annual supplier subscriptions, cancellation at period end, prorated upgrades and period-end downgrades. Checkout remains the source for the price and billing interval accepted for an order. |
| [#1429](https://github.com/rhysllwydlewis/EventFlow/pull/1429) | Community accessibility, responsive and moderation/query follow-ups                                   | Community pages, reports and moderation APIs                               | Community Guidelines, Terms and Privacy now cover public user-generated content, search/indexing, reports, moderation reasons, restrictions and appeals.                                                                           |

## Current features checked

- Community routes and models: public handles/profiles, discussions and replies; bookmarks, follows, drafts and reactions; broad optional region/event context; reports; moderation records, restrictions and appeals; a 24-hour pseudonymous view key; and the 18+ self-declaration required before Community posting.
- Supplier discovery and profiles: public supplier information, portfolios/media, base and service-area location data, postcode geocoding, location matching and public city pages.
- Messaging and media uploads: no material feature change appeared in the ten-PR window, but the implementation review found and corrected a stale claim that uploaded media used AWS S3. The current code stores processed image data in MongoDB collections.
- Pricing and subscriptions: the configured supplier plans and Stripe subscription lifecycle were checked in code rather than inferred from the visual pricing page.
- Analytics and diagnostics: consent-gated first-party behaviour analytics, PostHog analytics/session replay and attribution storage were active but the old policies said analytics was unused. The Cookie Policy and Privacy Notice now disclose this. Configurable Sentry error/performance reporting is also disclosed.
- Search and public visibility: supplier, city and Community discovery were reviewed. Terms and Community Guidelines now warn that published Community content is public and may be indexed.

## Policies changed

- **Legal Hub:** links the standalone Terms, Privacy Notice, data-rights page, Community Guidelines and Community Help/appeals page; its embedded summaries cover the current Community, city/location, supplier and analytics behaviour.
- **Terms of Use:** adds Community publishing/moderation terms, a limited operational content licence, location-discovery disclaimers, supplier subscription lifecycle terms, and proportionate suspension/removal language. It removes categorical DSA/Online Safety Act compliance wording and unsupported universal response deadlines.
- **Privacy Notice:** adds Community data and retention, location/geocoding, Pexels, PostHog, Sentry, analytics storage and public indexing. It also aligns the core processor/storage inventory with the code: Postmark for email, MongoDB for application and image data, Stripe for subscriptions and optional Google sign-in; stale AWS SES, SendGrid, custom SMTP and AWS S3 statements were removed.
- **Data Subject Rights:** corrects the UK response period to one calendar month (with a possible further two-month extension where permitted) and removes the contradictory promise of immediate permanent deletion during a recovery period.
- **Cookie Policy:** replaces the incorrect “analytics unused” statement with the consent-gated EventFlow/PostHog behaviour, storage and masked replay disclosures.
- **Community Guidelines:** states the public nature of posts, content ownership/licence, prohibited conduct, report handling, moderation outcomes and appeals.
- **Supplier-Specific Terms:** requires accurate base/service-area information and explains location-page aggregation.

## Policies reviewed without material wording changes

- **Community Help and Appeals:** already matches the implemented report and appeal routes. Its review date changed but its material-update date and version did not.
- **Acceptable Use and Copyright/IP sections:** existing prohibited-use and notice process remain applicable; the more specific Community rules and limited licence were added to the Community Guidelines and Terms.
- **Marketplace Terms:** no marketplace behaviour changed in the ten reviewed PRs.
- **Venue terms:** no standalone venue-terms route or document exists. Venue-type providers use the supplier flow, so the Supplier-Specific Terms and supplier/location wording apply; a separate document should only be introduced following a product/legal decision.

## Policy date and version controls

`config/policyMetadata.js` is the source of truth for each policy's version, last material update, effective date and last review. Public placeholders are rendered server-side using fixed editorial metadata, so the output is SSR-safe and does not change merely because a month has passed.

The monthly scheduled job is now a review reminder only. Git history is used as a diagnostic signal where available; it never supplies or rewrites a public date. Runtime/admin mutation of legal dates is refused because source-file changes would be unreliable in an ephemeral deployment and would create an inaccurate legal record.

Both legacy admin write endpoints now return a refusal for every payload. Their former file-rewrite branches were removed so an omitted or renamed request field cannot bypass the version-controlled review process.

## Solicitor and operational follow-up

Before treating these documents as final legal advice, the operator should:

1. confirm the contracting entity and trading-name/address wording, which is inconsistent elsewhere in repository configuration;
2. assess whether the Community is an in-scope user-to-user service under the UK Online Safety Act, complete and retain the required risk assessment if so, appoint operational ownership, and confirm the reporting/complaints and CSEA-reporting processes;
3. verify the production cookie/storage inventory, PostHog region and retention, Sentry configuration, processor agreements and international-transfer safeguards;
4. decide and implement Community-specific account deletion/export and moderation-record retention rules rather than relying only on general account workflows;
5. validate operational response targets before publishing any fixed service-level promise; and
6. have a UK solicitor review consumer/subscription cancellation and refund language, liability exclusions, content licensing and territorial coverage.

Useful primary guidance: [Ofcom's illegal-content duties](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act), [Ofcom's CSEA reporting guidance](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/duty-to-report-child-sexual-exploitation-and-abuse-csea-content-know-the-rules-and-how-to-comply), and [ICO guidance on cookies and similar technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/).
