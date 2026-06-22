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
- Public theme/media enhancement for colours, hero image, layout and gallery rendering.
- Mobile-first stabilisation styles for dashboard cards, builder panels, tables, modals, theme/media controls and public wedding pages.
- Public page default robots `noindex,nofollow`.

## Partially Implemented

- Public website design is premium and mobile-conscious, but further template/typography choices remain future work.
- Seating dashboard UI is usable but remains compact versus a full drag-and-drop seating planner.
- Custom RSVP questions support text, textarea, select and checkbox flows, but deeper analytics and schema controls remain future work.
- Theme/media currently stores selected image values within the wedding website record. This works for the current feature but should be moved to the durable media/upload pipeline in a future hardening PR.
- Mobile optimisation has a dedicated stabilisation layer, but should continue to be covered by Playwright mobile smoke tests as UI changes are made.

## Not Yet Implemented

- Full drag-and-drop seating planner.
- Dedicated wedding media object-storage/upload pipeline.
- Invite links, QR codes and email sending.
- Advanced custom RSVP analytics/reporting.
- Image crop/focal-point controls.
- Full public template system with typography and section ordering.

## Known Limitations

- Legacy data model conflict (`plan.guests` number vs guest array) still exists historically. Current code avoids worsening it by writing guest records to `guestList` unless `guests` is already an array.
- Theme/gallery media currently uses conservative data URL storage and gallery limits. This should be replaced with durable uploaded image URLs.
- Dashboard feature code has grown through layered enhancement scripts. A future refactor should consolidate the Wedding Website dashboard loader/module.
- Visual regression and accessibility coverage should be kept in sync with the intentional UI changes.

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
| Seating dashboard UI             | Partial | Compact non-drag-and-drop UI. Full planner remains future work.                             |
| Privacy/noindex/public-safe data | Done    | Safe public serialisation and noindex defaults.                                             |
| plan.guests conflict mitigation  | Done    | guestList-first compatibility logic maintained.                                             |
| Tests                            | Partial | Route/unit and browser smoke coverage exists; more mobile, visual and a11y coverage needed. |
| Docs                             | Done    | This document reflects current implemented state.                                           |

## Recommended Next Enhancements

1. Move wedding media from data URLs into the durable upload/object-storage pipeline.
2. Add invite links, QR codes and email sending.
3. Add full drag-and-drop seating planner.
4. Add RSVP analytics/reporting.
5. Add public template, typography and section ordering controls.
6. Consolidate layered wedding dashboard enhancement scripts into a single loader/module.
