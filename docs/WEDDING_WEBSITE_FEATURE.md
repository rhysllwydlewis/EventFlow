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
- RSVP dashboard: pagination/grouping, deeper dietary/accessibility triage views.
- Password-protected public page mode.

## How customers use it

1. Open Customer Dashboard → Wedding Website & RSVPs.
2. Choose quick-start website workspace, full plan flow, or existing plan connection.
3. Create website draft, edit sections, and manage repeatable cards.
4. Save and publish, then share `/wedding/:slug`.
5. Monitor RSVPs with filters, edit guests, export CSV, and manage seating tables.

## Recommended Next PR Scope (PR #1052)

Focus PR #1052 on dashboard-side product polish rather than another public-page redesign.

1. **Customer dashboard builder UX (primary)**
   - Stronger section navigation and more obvious current-step context.
   - Higher-contrast section cards with clearer completion/progress state.
   - Richer repeatable-card editing controls (less dense/"form-like" layout).
   - Improved save/publish surface with clearer draft vs published state and actions.

2. **RSVP dashboard at real event scale (80-150 guests)**
   - Search across name/email/household.
   - Better compound filters and explicit sort controls.
   - Pagination or grouping to handle long guest lists.
   - Clearer status badges and stronger dietary/accessibility triage.
   - Optional “attention needed” preset view for unresolved items.

3. **Seating dashboard UI polish (non-DnD first pass)**
   - Better table cards with capacity indicators and warning states.
   - Dedicated unseated panel and obvious “all guests seated” success state.
   - Clearer assign/unassign controls and conflict feedback.

4. **Keep password-protected websites as a separate security PR**
   - Do not bundle into UX polish.
   - Implement later with hashed password verification, access gating, short-lived access token/cookie behavior, rate limiting, and dedicated tests.

5. **Testing follow-up expected in this cycle**
   - Add at least browser smoke coverage for quick-start flow.
   - Add browser smoke coverage for public `/wedding/:slug` rendering.
   - Keep route/unit tests, but raise confidence with end-to-end rendering checks.

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

| Area                             | Status  | Notes                                                                                      |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| Dashboard card                   | Done    | Live in customer dashboard module.                                                         |
| Quick-start website workspace    | Done    | Users can start wedding website flow without creating a full plan first.                   |
| Sectioned website builder        | Done    | Section-based editor in dashboard.                                                         |
| Repeatable card editors          | Done    | Accommodation/taxi/local/wedding party/FAQ/meal/custom questions editor rows.              |
| Public website route             | Done    | `/wedding/:slug` serves public page.                                                       |
| Public website all sections      | Done    | Premium hero, timeline, venues, guest info, travel cards, party cards, stories, FAQ, RSVP. |
| Public RSVP                      | Done    | Published-only + enabled/deadline checks + honeypot + validation + duplicate update.       |
| RSVP dashboard                   | Partial | Summary + table + filters + add/edit/delete; additional large-list UX still pending.       |
| RSVP filters                     | Done    | all/attending/declined/awaiting/dietary/unseated/manual/public_rsvp.                       |
| Guest add/edit/delete            | Done    | Includes modal edit flow.                                                                  |
| CSV export                       | Done    | `/guests/export.csv`.                                                                      |
| Seating backend                  | Done    | CRUD + assign/unassign + summary APIs.                                                     |
| Seating dashboard UI             | Partial | Usable controls implemented; advanced UX remains future enhancement.                       |
| Privacy/noindex/public-safe data | Done    | Safe public serialization and noindex defaults.                                            |
| Password mode                    | Partial | Explicitly pending; not exposed as complete feature.                                       |
| plan.guests conflict mitigation  | Done    | guestList-first compatibility logic maintained.                                            |
| Tests                            | Partial | Meaningful route tests added; broader integration/e2e still pending.                       |
| Docs                             | Done    | Updated with usage, API, security, limitations, and matrix.                                |

## Merge Readiness

Current implementation is merge-ready for MVP release:

- Core customer workflow works end-to-end (create, publish, share, RSVP, manage, export, seat).
- Public safety constraints are enforced (published-only, safe-field shaping, RSVP validation/honeypot/rate-limit).
- Password mode is intentionally hard-disabled until a full secure implementation is added.

Post-merge enhancements can improve UX depth (advanced theming, richer table planner interactions) without blocking MVP release.
