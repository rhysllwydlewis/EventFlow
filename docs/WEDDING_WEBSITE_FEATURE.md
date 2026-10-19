# Wedding Website & RSVPs

## Current Status

Wedding Website & RSVPs is now a production feature area for customer wedding planning. Customers can create a wedding website workspace, edit a public guest-facing website, set visibility/privacy, publish, collect RSVPs, manage guests, export guest data, and manage a basic seating plan.

## Completed

- Customer dashboard card and in-dashboard Wedding Website & RSVPs module entrypoint.
- Quick-start wedding website workspace for users who do not want to create a full plan first.
- Plan-scoped wedding website APIs for create, get, patch, publish, unpublish and slug regeneration.
- Public wedding website route at `/wedding/:slug`.
- Public API for safe public website data.
- Public RSVP submission with duplicate matching by email first, then normalised name fallback.
- RSVP dashboard summary tiles, table, filters, search, sorting, pagination, add/edit/delete and CSV export.
- Seating foundation APIs and compact dashboard seating UI for table CRUD plus assign/unassign.
- Publish readiness checks for couple names, event date, venue details, RSVP state, slug and password state.
- Password-protected wedding websites with hashed password storage, short-lived access cookie/token behaviour, password gate and RSVP blocking until access is proven.
- Privacy modes: `private_link`, `public` and `password`.
- Theme customisation with colour presets, colour pickers, hero layout, hero photo and gallery photos.
- Guest-facing page (`/wedding/:slug`) rendered by one script and one stylesheet: three hero layouts (classic, editorial, full bleed), the couple's palette with automatic contrast correction, photo gallery with a lightbox, add-to-calendar, and a shorter RSVP form that only asks the attendance questions of guests who are coming.
- The password page, the owner's draft preview and the unavailable/error pages are part of the same script (no fetch patching or DOM observers).
- Public page default robots `noindex,nofollow`.

## Partially Implemented

- Public website design is premium and mobile-conscious, but typography choices and section ordering remain future work.
- Seating supports drag-and-drop between the unseated list and tables, auto-seat and table diagrams, but there is no free-form floor plan (positioning tables on a canvas).
- Custom RSVP questions support text, textarea, select and checkbox flows, but deeper analytics and schema controls remain future work.
- Theme/media currently stores selected image values within the wedding website record. This works for the current feature but should be moved to the durable media/upload pipeline in a future hardening PR.
- Mobile optimisation has a dedicated stabilisation layer, but should continue to be covered by Playwright mobile smoke tests as UI changes are made.

## Not Yet Implemented

- Free-form floor-plan seating (positioning tables on a canvas).
- Dedicated wedding media object-storage/upload pipeline.
- Invite links and email sending (QR codes, WhatsApp and mailto sharing are done).
- Advanced custom RSVP analytics/reporting.
- Image crop/focal-point controls.
- Typography choices and section ordering on the public page.

## Known Limitations

- Legacy data model conflict (`plan.guests` number vs guest array) still exists historically. Current code avoids worsening it by writing guest records to `guestList` unless `guests` is already an array.
- Theme/gallery media is stored as data URLs on the website record. The dashboard app shrinks each photo in the browser to about 600,000 characters (the server drops any single image over 900,000, and the JSON body limit for `/api/me/plans` is 10 MB, enough for the 12-photo gallery plus the cover). `tests/unit/wedding-widget-contract.test.js` ties those numbers together. This should be replaced with durable uploaded image URLs.
- Seating integrity: only attending guests hold seats. Deleting a guest, or changing a seated guest to declined/pending/maybe, frees the seat; renaming a table updates the table name stored on its guests.
- The dashboard app is one module (`public/assets/js/pages/customer-wedding-website.js`) and one stylesheet (`public/assets/css/customer-wedding-website.css`). It renders every view from in-memory state and does not rely on other scripts patching its DOM; keep it that way rather than adding enhancer layers.
- The public page is likewise one module (`public/assets/js/pages/public-wedding-site.js`) and one stylesheet (`public/assets/css/public-wedding-site.css`). `GET /api/public/wedding-websites/:slug` returns the validated palette, hero layout, cover photo and gallery (via `publicThemeMedia` in `routes/wedding-theme-media.js`), so the page needs one request. Before this, those fields were left out of the public response and guests only saw the accent colour and cover photo. The page derives readable text, link and button colours from the couple's four picks, so a low-contrast palette still passes WCAG AA.
- Visual regression and accessibility coverage should be kept in sync with the intentional UI changes.

## Homepage showcase

The homepage advertises this feature in a section with its own illustrations (`#wedding-website-rsvp`):

- Markup: the block between `<!-- hws:start -->` and `<!-- hws:end -->` in `public/index.html` (homepage v1 and v3) and `public/home-v2.html` (v2). The admin can switch the live homepage version, so the two copies must stay identical; `tests/unit/home-wedding-showcase.test.js` fails if they drift. Edit one, then copy it to the other.
- Styles: `public/assets/css/home-wedding-showcase.css`, every selector prefixed `.hws` so it cannot restyle (or be restyled by) the rest of either homepage. Bump the `?v=` on both pages when it changes.
- Graphics: HTML, CSS and inline SVG only (a guest wedding website on a phone, an RSVP tracker, a seating plan, a QR chip). They are decorative and hidden from assistive technology; one `role="img"` label describes them. They use sample names and numbers and are captioned as an illustrative preview. Do not add testimonials, ratings or usage numbers (the anonymous-page sanitizer and a test both guard against that).
- SEO: keyword-led heading and copy, visible FAQ with matching `FAQPage` JSON-LD, a `Service` JSON-LD block (free for customers), and internal links to `/articles/wedding-website-on-eventflow-guide`, `/auth?tab=create&role=customer` and `/faq`. Keep the FAQ text and the JSON-LD identical (the test checks it). The homepage `<title>` and meta description were deliberately left unchanged.
- Copy must describe only what the feature does today (free for customers, no account needed for guests to RSVP, hidden from search engines by default, only attending guests hold seats).

## How customers use it

1. Open Customer Dashboard → Wedding Website & RSVPs.
2. Choose quick-start website workspace, full plan flow or an existing plan connection.
3. Create a website draft.
4. Expand the builder sections they want to edit.
5. Complete Essentials, Privacy & password protection, Theme colours & photos, Travel & Accommodation, Wedding Party, FAQ and RSVP settings.
6. Save and publish.
7. Share `/wedding/:slug` with guests.
8. Monitor RSVPs with filters, edit guests, export CSV and manage seating tables.

## API Summary

- Website owner API: `GET/POST/PATCH /api/me/plans/:planId/wedding-website`
- Publish: `POST /api/me/plans/:planId/wedding-website/publish`
- Unpublish: `POST /api/me/plans/:planId/wedding-website/unpublish`
- Slug repair: `POST /api/me/plans/:planId/wedding-website/regenerate-slug`
- Theme/media owner API: `GET/PATCH /api/me/plans/:planId/wedding-website/theme-media`
- Public website: `GET /api/public/wedding-websites/:slug`
- Public password access: `POST /api/public/wedding-websites/:slug/access`
- Public theme/media: `GET /api/public/wedding-websites/:slug/theme-media`
- Public RSVP: `POST /api/public/wedding-websites/:slug/rsvp`
- RSVP dashboard: `GET /api/me/plans/:planId/guests`, `GET /api/me/plans/:planId/rsvp-summary`, `GET /api/me/plans/:planId/guests/export.csv`, `POST/PATCH/DELETE /api/me/plans/:planId/guests`
- Seating: `GET/POST/PATCH/DELETE /api/me/plans/:planId/tables`, assign/unassign and seating-summary endpoints.

## Privacy & Security Notes

- Public website endpoint only exposes safe public fields.
- Draft and unpublished websites are blocked publicly.
- Password visibility stores a password hash, never plaintext.
- Password-protected websites require access before guests can view the site or submit RSVP.
- Public theme/media access follows the same password-access convention for protected websites.
- RSVP write path includes rate limiting, field validation, sanitisation and honeypot rejection.
- Public pages remain `noindex,nofollow` by default.

## Completion Matrix

| Area                             | Status  | Notes                                                                                       |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| Dashboard card                   | Done    | Live in customer dashboard module.                                                          |
| Quick-start website workspace    | Done    | Users can start without creating a full plan first.                                         |
| Sectioned website builder        | Done    | Sections are collapsed by default so users expand what they need.                           |
| Repeatable card editors          | Done    | Accommodation, taxi, local, wedding party, FAQ, meal and custom question rows.              |
| Public website route             | Done    | `/wedding/:slug` serves the public page.                                                    |
| Public website sections          | Done    | Hero, timeline, venues, guest info, travel cards, party cards, stories, FAQ and RSVP.       |
| Public RSVP                      | Done    | Published-only, enabled/deadline checks, honeypot, validation and duplicate update.         |
| Password mode                    | Done    | Hashed password, password gate, access cookie/token and protected RSVP.                     |
| Theme colours                    | Done    | Presets and colour pickers.                                                                 |
| Hero and gallery photos          | Partial | Works with current data URL storage; object-storage pipeline remains future hardening.      |
| Mobile dashboard polish          | Done    | Mobile-first override layer added for dashboard and builder.                                |
| Mobile public page polish        | Done    | Public wedding page has mobile responsive overrides and safe-area handling.                 |
| RSVP dashboard                   | Partial | Summary/table/add-edit-delete/search/sort/filter/pagination live; deeper analytics future.  |
| CSV export                       | Done    | `/guests/export.csv`.                                                                       |
| Seating backend                  | Done    | CRUD plus assign/unassign and summary APIs.                                                 |
| Seating dashboard UI             | Done    | Drag-and-drop, auto-seat, table diagrams. Free-form floor plan remains future work.         |
| Privacy/noindex/public-safe data | Done    | Safe public serialisation and noindex defaults.                                             |
| plan.guests conflict mitigation  | Done    | guestList-first compatibility logic maintained.                                             |
| Tests                            | Partial | Route/unit and browser smoke coverage exists; more mobile, visual and a11y coverage needed. |
| Docs                             | Done    | This document reflects current implemented state.                                           |

## Recommended Next Enhancements

1. Move wedding media from data URLs into the durable upload/object-storage pipeline.
2. Add invite links, QR codes and email sending.
3. Add a free-form floor-plan seating view.
4. Add RSVP analytics/reporting.
5. Add public template, typography and section ordering controls.
