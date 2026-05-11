# Wedding Website & RSVPs

## Completed

- Customer dashboard card + in-dashboard module entrypoint.
- Plan-scoped wedding website APIs (create/get/patch/publish/unpublish/regenerate slug).
- Public wedding website route (`/wedding/:slug`) and public API.
- Public RSVP submission with duplicate-match behavior (email first, fallback to normalized name).
- RSVP dashboard basics in customer module (summary tiles, table, add/delete, export button).
- Guest CSV export endpoint.
- Seating foundation APIs (table CRUD, assign/unassign, seating summary).
- Public page default robots `noindex,nofollow`.

## Partially Implemented

- Public website design quality has been upgraded to a premium, sectioned, mobile-first wedding layout with hero, venue cards, timeline, travel cards, party cards, and styled RSVP form.
- Seating dashboard UI is usable (modal add/edit + assign/unassign) but remains compact versus a full planner UX.
- Custom RSVP questions editor is basic (repeatable row editor), but public rendering/submission is now supported for text/textarea/select/checkbox question types.

## Not Yet Implemented

- Password visibility mode (`visibility=password`) end-to-end flow with hashed-password gate and short-lived access cookie/token.
- Full drag-and-drop seating planner.
- Advanced custom RSVP schema validation and analytics reporting on answers.

## Known Limitations

- Legacy data model conflict (`plan.guests` number vs guest array) still exists historically. New code avoids worsening it by writing guest records to `guestList` unless `guests` is already an array.
- Customer-side builder currently uses compact controls to keep first-pass manageable.
- Dashboard builder UX is improved, but still not yet a full drag-and-drop or deeply guided wizard experience.

## Future Enhancements

- Full card editors for accommodation/taxis/local info/wedding party/custom questions with richer inline previews.
- RSVP dashboard: deeper analytics/reporting, grouping presets, and richer triage workflows.
- Password-protected public page mode.

## How customers use it

1. Open Customer Dashboard → Wedding Website & RSVPs.
2. Choose quick-start website workspace, full plan flow, or existing plan connection.
3. Create website draft, edit sections, and manage repeatable cards.
4. Save and publish, then share `/wedding/:slug`.
5. Monitor RSVPs with filters, edit guests, export CSV, and manage seating tables.

## Recent Improvements Delivered in PR #1052

PR #1052 shipped focused dashboard and quality upgrades without expanding into password mode or drag-and-drop seating.

- Added a CSRF-safe dashboard API helper for mutating wedding website actions.
- Upgraded RSVP dashboard list handling with search, sorting, pagination, and attention filtering.
- Improved RSVP clarity with stronger status badges plus clearer dietary/accessibility triage signals.
- Polished seating dashboard cards with capacity indicators, unseated panel visibility, and all-seated state feedback.
- Added Playwright smoke coverage for public wedding page rendering and quick-start dashboard shell behavior.
- Expanded liquid-glass styling in the customer wedding dashboard module.

## API Summary

- Website: `GET/POST/PATCH /api/me/plans/:planId/wedding-website`, publish/unpublish/regenerate-slug
- Public: `GET /api/public/wedding-websites/:slug`, `POST /api/public/wedding-websites/:slug/rsvp`
- RSVP: `GET /api/me/plans/:planId/guests`, `GET /rsvp-summary`, `GET /guests/export.csv`, `POST/PATCH/DELETE /guests`
- Seating: `GET/POST/PATCH/DELETE /api/me/plans/:planId/tables`, assign/unassign + seating-summary

## Privacy & Security Notes

- Public website endpoint only exposes safe public fields.
- Draft websites are blocked publicly.
- RSVP write path includes rate limit, field validation, sanitization, and honeypot rejection.
- Password mode decision: hard-disabled for now. API rejects `visibility=password` and public endpoints block password visibility records.

## Completion Matrix (Current)

| Area                             | Status  | Notes                                                                                                                                                      |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard card                   | Done    | Live in customer dashboard module.                                                                                                                         |
| Quick-start website workspace    | Done    | Users can start wedding website flow without creating a full plan first.                                                                                   |
| Sectioned website builder        | Done    | Section-based editor in dashboard.                                                                                                                         |
| Repeatable card editors          | Done    | Accommodation/taxi/local/wedding party/FAQ/meal/custom questions editor rows.                                                                              |
| Public website route             | Done    | `/wedding/:slug` serves public page.                                                                                                                       |
| Public website all sections      | Done    | Premium hero, timeline, venues, guest info, travel cards, party cards, stories, FAQ, RSVP.                                                                 |
| Public RSVP                      | Done    | Published-only + enabled/deadline checks + honeypot + validation + duplicate update.                                                                       |
| RSVP dashboard                   | Partial | Summary/table/add-edit-delete plus search, sort, pagination, attention filter, and clearer badges are live; deeper analytics/grouping remains future work. |
| RSVP filters                     | Done    | all/attending/declined/awaiting/dietary/unseated/manual/public_rsvp.                                                                                       |
| Guest add/edit/delete            | Done    | Includes modal edit flow.                                                                                                                                  |
| CSV export                       | Done    | `/guests/export.csv`.                                                                                                                                      |
| Seating backend                  | Done    | CRUD + assign/unassign + summary APIs.                                                                                                                     |
| Seating dashboard UI             | Partial | Non-drag-and-drop seating UI is improved (capacity/unseated/all-seated clarity); full drag-and-drop planner remains future work.                           |
| Privacy/noindex/public-safe data | Done    | Safe public serialization and noindex defaults.                                                                                                            |
| Password mode                    | Pending | Explicitly not implemented yet; password-protected public mode remains future work.                                                                        |
| plan.guests conflict mitigation  | Done    | guestList-first compatibility logic maintained.                                                                                                            |
| Tests                            | Partial | Route/unit coverage plus browser smoke coverage exists; broader visual regression and deeper E2E coverage are future work.                                 |
| Docs                             | Done    | Updated with usage, API, security, limitations, and matrix.                                                                                                |

## Merge Readiness

Current implementation is merge-ready for MVP release:

- Core customer workflow works end-to-end (create, publish, share, RSVP, manage, export, seat).
- Public safety constraints are enforced (published-only, safe-field shaping, RSVP validation/honeypot/rate-limit).
- Password mode is intentionally hard-disabled until a full secure implementation is added.

Post-merge enhancements can improve UX depth (advanced theming, richer table planner interactions) without blocking MVP release.
