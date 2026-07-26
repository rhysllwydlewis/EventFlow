# Supplier Profile Editing Correctness Handoff

## Purpose

This document records the supplier profile editing audit completed after PR #1405, `Harden supplier profile themes and photo viewing`, was merged.

It is the durable handoff for this draft PR. Another engineer or coding agent should be able to continue from this branch without repeating the investigation.

The audit covered:

- supplier creation;
- supplier dashboard editing;
- the dedicated Profile Customisation page;
- public-profile inline editing;
- theme-mode editing;
- banner and gallery uploads;
- public profile serialization;
- post-save client state and rerendering;
- venue and category transitions;
- current unit, integration, Playwright, formatting, lint and CI coverage.

## Current branch status

### Completed

- [x] Stop inventing timestamp IDs for newly uploaded gallery photos.
- [x] Prefer the server-returned `photo` object.
- [x] Use the persisted photo URL as the compatibility identity when no dedicated ID is returned.
- [x] Preserve derivative URLs returned by the server.
- [x] Reject nominally successful upload responses that contain no usable URL.
- [x] Add behavioural unit tests for canonical and legacy upload response shapes.

Changed files:

- `public/assets/js/supplier-photo-upload.js`
- `tests/unit/supplier-photo-upload-response.test.js`

### Remaining

- [ ] Add persistent local banner uploads.
- [ ] Add one server-owned supplier category definition.
- [ ] Fix Venue and non-Venue PATCH transitions.
- [ ] Validate required name and category values on PATCH.
- [ ] Validate website and banner URLs server-side.
- [ ] Persist server-generated gallery photo IDs.
- [ ] Enforce the gallery maximum on the server.
- [ ] Add gallery timestamps, cache invalidation and atomic mutation hardening.
- [ ] Merge canonical supplier responses in every inline editor.
- [ ] Refresh all category-dependent views after category changes.
- [ ] Consolidate dialog behaviour.
- [ ] Remove duplicate customisation and theme controllers.
- [ ] Correct dashboard deep links.
- [ ] Add unsaved-navigation protection.
- [ ] Align create, PATCH and UI field limits.
- [ ] Allow amenities to be cleared.
- [ ] Clarify the different profile-completion measurements.

## Priority

### P0: customer-facing correctness and data integrity

1. Persistent local banner uploads.
2. Venue category transition correctness.
3. Server-owned required-field, category and URL validation.
4. Gallery identity and backend invariants.

### P1: client consistency

1. Canonical response merging.
2. Complete rerender and theme reapplication after category edits.
3. Shared supplier PATCH client.
4. Correct dashboard fragments.
5. Amenities clearing.
6. Aligned field limits.

### P2: consolidation and maintainability

1. Shared accessible dialog helper.
2. Remove the duplicate Profile Customisation controller.
3. Remove the obsolete hero and theme editor path.
4. Present automatic, preset and custom themes consistently.
5. Reduce duplicated category and theme constants.
6. Add dirty-navigation protection.
7. Rename the different completion measurements.

## Confirmed defect: local banner upload

### Severity

Critical customer-facing defect.

### Root cause

The dedicated Profile Customisation page reuses a generic multi-image drop-zone helper for a single banner.

That helper:

- accepts multiple files;
- converts files to data URLs;
- calls the page callback;
- appends its own preview after the page callback has already rebuilt the preview.

The customisation controller stores the data URL in the hidden `bannerUrl` field and sends it through the ordinary supplier PATCH route.

The PATCH route truncates `bannerUrl` to 500 characters. The public serializer excludes data-image URLs. The supplier can therefore see a preview and a successful save while the banner does not persist or render publicly.

The helper can also leave duplicate or multiple banner previews even though the model supports one banner.

### Files to inspect

- `public/supplier/profile-customization.html`
- `public/supplier/js/profile-customization.js`
- the shared photo drop-zone helper used by that page
- `routes/supplier-management.js`
- `photo-upload.js`
- `utils/supplierPublicProfile.js`

### Required implementation

Add an authenticated supplier banner upload route that:

1. verifies authentication, supplier role, verified-user status, CSRF and ownership;
2. accepts exactly one image;
3. uses `photoUpload.processAndSaveImage` with supplier context;
4. stores an EventFlow-hosted `/api/photos/...` URL;
5. updates `bannerUrl` and `updatedAt` atomically;
6. invalidates the catalogue cache;
7. returns the canonical updated supplier.

Replace the generic multi-image drop-zone behaviour with a dedicated single-image banner uploader.

Do not store base64 or data URLs in supplier documents.

### Acceptance tests

- A JPEG, PNG or WebP upload stores a usable EventFlow URL.
- Reloading Profile Customisation preserves the banner.
- The public supplier API returns the saved banner.
- Multiple file selection is impossible or clearly reduced to one file.
- Invalid file type and oversize uploads return useful errors.
- A supplier cannot upload a banner for another supplier.
- Catalogue cache invalidation runs after success.

## Confirmed defect: Venue transitions

### Severity

High data-integrity defect.

### Root cause

The supplier PATCH route validates `venuePostcode` against the supplier's existing category, then applies the requested category afterward.

### Failure modes

#### Non-Venue to Venues

The postcode branch is skipped because the old category is not `Venues`. The category can still change, leaving a Venue without validated or geocoded venue data.

#### Venues to non-Venue

The dashboard removes `venuePostcode` from the request, but the server does not unset:

- `venuePostcode`;
- `latitude`;
- `longitude`.

Stale venue-only location data remains stored after the category changes.

### Required implementation

Compute the intended next category before validation.

Rules:

- Entering Venues requires a valid postcode.
- Remaining a Venue may preserve the current valid postcode or update it.
- Leaving Venues must unset postcode and coordinates.
- Validation and geocoding must use the intended next category.
- The response must reflect both set and unset operations.

### Acceptance tests

- Non-Venue to Venues without postcode returns 400.
- Non-Venue to Venues with invalid postcode returns 400.
- Non-Venue to Venues with valid postcode stores normalized postcode and coordinates.
- Venues to Venues without a new postcode preserves valid venue data.
- Venues to Venues with a new postcode updates and geocodes it.
- Venues to another category removes postcode and coordinates.

## Confirmed defect: category and required-field validation

### Severity

High data-integrity defect.

### Current behaviour

- The dashboard uses a controlled category select.
- The public inline name and category modal uses unrestricted text.
- Create checks only whether name and category are truthy.
- PATCH allows explicitly supplied name or category values to trim to an empty string.
- PATCH accepts arbitrary category strings up to the field limit.

Automatic theme resolution relies on known normalized categories, so unsupported values fall back silently.

### Required implementation

Create one server-owned category module, for example `utils/supplierCategories.js`.

It should export:

- canonical stored values;
- aliases and normalization where required;
- a category validation function;
- labels suitable for client generation or API delivery.

Use the same rules in:

- supplier creation;
- supplier PATCH;
- dashboard editing;
- public inline editing;
- automatic theme resolution;
- package category validation where the same taxonomy is intended.

Reject explicitly empty names and unsupported or empty categories with 400 responses.

Replace the inline free-text category input with canonical choices.

### Acceptance tests

- Empty PATCH name returns 400 and does not write.
- Empty PATCH category returns 400 and does not write.
- Unsupported category returns 400.
- Supported aliases normalize consistently if aliases remain allowed.
- Create and PATCH enforce the same category rules.
- Automatic themes use the canonical category.

## Confirmed defect: website and banner URL validation

### Severity

High correctness problem.

### Root cause

The PATCH route truncates `website` and `bannerUrl` but does not validate protocol or shape. The public serializer is stricter and removes unsupported values.

A save can therefore report success while the value disappears after reload.

### Required implementation

Add shared server-side normalization and validation.

Rules:

- Empty string clears an optional field.
- Website supports only HTTP and HTTPS.
- Scheme-less websites may normalize to HTTPS if that remains product policy.
- Banner URLs support approved EventFlow paths and HTTP or HTTPS images.
- Data URLs, JavaScript URLs, malformed values and unsupported schemes return 400.
- Writer and serializer rules must remain compatible.

### Acceptance tests

- Valid HTTPS website saves and renders.
- A valid scheme-less domain normalizes consistently.
- JavaScript and malformed URLs return 400.
- Valid EventFlow and HTTPS banner URLs save and render.
- Data-image and malformed banner URLs return 400.

## Confirmed defect: gallery identity and backend invariants

### Severity

High editing defect.

### Compatibility fix completed here

The upload client now:

- reads `data.photo` when present;
- preserves derivative URLs;
- prefers a real server ID;
- uses the persisted URL for legacy identity fallback;
- rejects responses with no usable URL;
- no longer creates timestamp-only IDs.

The current delete and reorder routes accept the stored URL, so immediate operations can use the same identity before the backend migration is complete.

### Remaining backend implementation

Persist a canonical gallery record with:

- a server-generated photo ID;
- optimized URL;
- thumbnail URL;
- large URL;
- original URL;
- approval state;
- upload timestamp.

Also enforce:

- maximum ten photos on the server;
- `updatedAt` on upload, delete and reorder;
- catalogue cache invalidation on every mutation;
- an atomic update strategy where supported;
- one consistent response shape;
- temporary support for legacy URL identity.

### Acceptance tests

- Upload returns a real ID and derivative URLs.
- Upload then immediate delete succeeds without reload.
- Upload then immediate reorder succeeds without reload.
- An eleventh photo is rejected server-side.
- Canonical IDs work for delete and reorder.
- Legacy URL identifiers remain accepted during migration.
- Every mutation updates `updatedAt` and invalidates cache.

## Confirmed defect: category rerendering

### Severity

Medium-high client consistency defect.

### Root cause

The public inline name and category editor merges the outbound patch and rerenders only the hero.

The sidebar separately renders category, and the effective automatic theme also depends on category.

### Failure mode

Without a reload, the supplier can see:

- the new category in the hero;
- the old category in the sidebar;
- the old automatic theme family or accent.

### Required implementation

After a successful category save:

1. merge `response.supplier`, not the outbound request;
2. rerender all category-dependent sections;
3. reapply the full supplier theme;
4. reinsert owner controls exactly once.

Prefer one shared update helper or event rather than hand-selecting sections in every editor.

### Acceptance test

A browser test should edit category and verify, without reload:

- hero category updates;
- sidebar category updates;
- automatic theme updates;
- owner controls remain available once.

## Confirmed defect: canonical response is discarded

### Severity

Medium-high state correctness defect.

### Root cause

The general inline editor receives response JSON but most callers merge the outbound patch instead of `response.supplier`.

### Lost information

This can lose:

- server trimming and truncation;
- normalized categories and URLs;
- fields removed through unset operations;
- derived values;
- future canonicalization.

### Required implementation

Create one shared supplier PATCH client that:

- resolves and refreshes CSRF using the application pattern;
- reports structured errors;
- returns the canonical supplier;
- updates shared supplier state;
- triggers the appropriate rerender or update event.

Use it for every inline supplier edit.

## Confirmed defect: legacy modal keyboard handling

### Severity

Medium accessibility defect.

### Root cause

The legacy modal registers its document keydown listener with `once: true`.

Pressing Tab consumes the one listener invocation, so Escape no longer closes the dialog.

The modal also lacks:

- a focus trap;
- scroll locking;
- trigger focus restoration.

### Required implementation

Extract or reuse one accessible dialog helper with:

- labelled dialog semantics;
- initial focus;
- Tab and Shift+Tab trapping;
- Escape close at any time;
- optional backdrop close;
- body scroll restoration;
- trigger focus restoration;
- complete listener cleanup.

The newer theme editor already demonstrates the preferred pattern.

## Confirmed duplication: Profile Customisation controllers

### Severity

Medium-high maintenance risk.

### Current behaviour

The Profile Customisation page loads an external controller and also contains an inline controller implementing overlapping:

- colour controls;
- live preview;
- completion scoring;
- dirty state;
- save and discard actions;
- input listeners.

The external controller clones controls to remove competing listeners. That is a workaround for duplicate ownership.

### Required implementation

Remove the inline controller after confirming one external module owns:

- initialization;
- supplier selection;
- dirty state;
- preview rendering;
- save and discard;
- banner upload;
- theme controls;
- unsaved navigation protection.

Every interaction and save must execute once.

## Confirmed inconsistency: theme editing models

### Severity

Medium UX inconsistency.

### Current behaviour

The public-profile editor understands:

- automatic mode;
- named preset mode;
- custom colour mode.

The dedicated customisation page displays only a colour picker. Automatic and preset suppliers can therefore appear as default teal even though their stored effective theme differs.

The recent safeguard prevents unrelated saves from writing teal, but the preview remains misleading.

### Required implementation

Use the same explicit mode model in both editing surfaces and use the shared effective-theme resolver for previews.

Unrelated saves must not change theme mode.

## Confirmed duplication: theme and category mappings

Category and preset definitions exist in several server and browser files.

Choose one source of truth through one of these approaches:

- generate browser constants from a server-owned module;
- return resolved category family and theme data from the API;
- use one environment-neutral shared module.

Adding a category or preset should require one authoritative edit.

## Additional confirmed issue: field limits differ

The dashboard, create route and PATCH route currently allow different maximum lengths for several fields, including:

- business name;
- location;
- short description;
- long description;
- website.

The create route can silently truncate values that the UI permits.

### Required implementation

Define shared field limits and use them in HTML, browser validation, create and PATCH.

Prefer clear 400 responses where silent truncation would surprise the supplier.

## Additional confirmed issue: amenities cannot be cleared

The PATCH route processes amenities only when the incoming value is truthy. Sending an empty string therefore leaves the old amenities unchanged.

Check for field presence rather than truthiness and write an empty array when the field is explicitly cleared.

Add a route test for clearing amenities.

## Additional confirmed issue: dashboard fragments

The public owner editor links to `#photos` and `#packages`, but the dashboard uses different element IDs and no reliable translation was found.

Use real target fragments or add one explicit dashboard hash router.

Browser coverage should verify the correct section expands, scrolls into view and receives focus where appropriate.

## Additional confirmed issue: completion measurements

The product currently has at least three different completion concepts:

- core listing data;
- profile quality and presentation;
- growth actions such as packages and photos.

Use distinct labels such as:

- Core listing completeness
- Profile quality score
- Growth checklist

Do not present all three as the same percentage.

## Additional confirmed issue: unsaved navigation

Dirty state controls the save bar but does not reliably guard browser reload, navigation away or legacy multiple-profile switching.

Add a `beforeunload` handler only while dirty and remove it after save or discard. Prompt before changing legacy profile selection while dirty.

## Existing strengths to preserve

### Supplier PATCH security

The current route already uses:

- write limiting;
- authentication;
- supplier-role enforcement;
- verified-user enforcement;
- CSRF protection;
- owner-scoped lookup.

Do not bypass these controls for new upload routes.

### Theme mutation contract

`utils/supplierTheme.js` provides:

- explicit automatic, preset and custom modes;
- validation;
- legacy inference;
- mutually exclusive preset and colour storage;
- set and unset mutation output.

Do not replace this with browser-only inference.

### Public profile security

The safe public route correctly:

- hides unapproved suppliers except authorized preview;
- exposes owner identity only when required;
- returns owner state;
- serializes through the safe public supplier function.

### Newer theme editor behaviour

The newer editor demonstrates the preferred client pattern:

- app-compatible CSRF resolution;
- canonical response merging;
- focus trapping;
- Escape and backdrop close;
- scroll locking;
- focus restoration;
- complete theme reapplication.

Reuse or extract this behaviour.

## Test strategy

Some existing tests validate source strings rather than executing complete behaviour. Keep useful contract smoke tests, but favour behavioural coverage for new work.

Use:

- Supertest for route mutations;
- pure helper tests for normalization and validation;
- VM or jsdom tests for isolated browser modules;
- Playwright for integrated editing flows.

### Required route coverage

- Venue transition matrix.
- Required name and category validation.
- Category normalization and rejection.
- Website and banner URL validation.
- Amenities clearing.
- Gallery maximum enforcement.
- Gallery canonical upload response.
- Cache invalidation and timestamps.
- Banner ownership and security.

### Required browser coverage

- Local banner upload persists after reload.
- Category edits update hero, sidebar and automatic theme without reload.
- Gallery upload followed by immediate delete.
- Gallery upload followed by immediate reorder.
- Accessible modal keyboard cycle.
- Correct dashboard deep links.
- Unsaved-navigation guard.
- Automatic, preset and custom mode parity across editing surfaces.

## Suggested remaining commit sequence

1. `Add shared supplier category and field validation`
2. `Fix venue category transitions`
3. `Add persistent supplier banner uploads`
4. `Harden gallery photo records and limits`
5. `Merge canonical supplier responses in editors`
6. `Refresh dependent profile views after edits`
7. `Consolidate supplier profile dialogs`
8. `Remove duplicate customisation controllers`
9. `Align theme editors and shared constants`
10. `Add supplier editing browser regressions`

## Agent handoff instructions

1. Read this document before changing code.
2. Inspect the current branch diff.
3. Preserve the completed gallery compatibility fix.
4. Start with P0 backend rules before UI polish.
5. Add behavioural tests with each fix.
6. Update the PR body as completed and remaining work changes.

## Regression guardrails

Do not:

- write `themeColor` during unrelated saves;
- expose `ownerUserId` to general public profile responses;
- revoke `approved` on ordinary supplier edits;
- store banner data URLs;
- reintroduce timestamp-only gallery IDs;
- rely only on browser validation;
- accept values that the public serializer silently removes.

## Definition of done

Keep this PR in draft until:

- all P0 items are implemented;
- their behavioural tests pass;
- no customer-visible save reports success while storing unusable data;
- category changes produce one coherent page without reload;
- banner and gallery uploads persist with stable server identity;
- the PR description accurately reflects completed and remaining work;
- normal repository CI is green.
