# Supplier Profile Editing Correctness — Independent Review Addendum

## Purpose

This addendum records the independent review performed after the initial draft of PR #1407 was opened. Read it together with `SUPPLIER_PROFILE_EDITING_CORRECTNESS_HANDOFF.md`.

The original handoff remains the full system audit and remaining roadmap. This addendum is authoritative for work completed after that document was first committed.

## Review outcome

The original compatibility direction was valid: the current gallery backend stores URL-addressable photo records, and its delete and reorder routes accept a stored URL when a dedicated photo ID is absent.

The review found two gaps in the initial implementation:

1. `SupplierPhotoUpload.deletePhoto()` interpolated the fallback URL directly into a route path instead of encoding it.
2. `SupplierPhotoUpload.getSupplierPhotos()` treated the backend's wrapped `{ photos: [...] }` response as though it were the array itself.

Both have been corrected.

## Current completed scope

### Upload response normalization

- Consume the server-returned `photo` object when it is a plain object.
- Preserve derivative URLs in the uploader result.
- Prefer a server-generated ID when present.
- Use the persisted URL as the temporary legacy identity when no dedicated ID is returned.
- Reject successful responses that contain no usable URL.
- Never invent timestamp-only photo IDs.

### API transport hardening

- Encode supplier IDs in upload, list and delete URLs.
- Encode photo IDs and legacy URL identities in delete URLs.
- Normalize both a direct photo array and the current wrapped `{ photos: [...] }` list response.
- Correct stale comments that described filesystem storage rather than the MongoDB-backed pipeline.

### Behavioural coverage

Unit tests execute the browser upload class and cover:

- canonical server IDs;
- derivative URL preservation;
- legacy URL fallback;
- encoded supplier identifiers;
- encoded URL-shaped delete identifiers;
- wrapped list-response normalization;
- missing-URL rejection.

Integration tests execute the real Express router and cover:

- deleting a gallery item addressed by an encoded stored URL;
- reordering gallery items addressed by stored URLs.

### Production dependency audit correction

The repository's production dependency audit initially failed on two high-severity findings in the `filelist` dependency subtree.

The root cause was the override configuration and stale lockfile entries:

- `filelist` was held on an old dependency arrangement;
- a global `brace-expansion` override forced an incompatible legacy version into newer `minimatch` consumers;
- the lockfile retained orphaned nested `filelist` packages that were no longer required by the resolved graph.

The correction:

- upgrades `filelist` to `2.0.2`;
- pins its `minimatch` dependency to `10.2.5`;
- removes the incompatible global `brace-expansion` override;
- regenerates and normalizes `package-lock.json`;
- removes only the guarded orphan nodes proven to belong to the obsolete `filelist` subtree;
- keeps the production audit blocking;
- uploads both text and machine-readable audit diagnostics when the dedicated audit workflow runs.

The resulting dependency graph was required to pass:

- package-lock metadata validation;
- a clean `npm ci`;
- `npm ls filelist minimatch brace-expansion --omit=dev`;
- `npm audit --omit=dev --audit-level=high`;
- the full repository CI and browser workflow matrix.

A temporary workflow used to generate and verify the lockfile was removed after the verified lockfile was committed. No branch-writing helper remains in the final PR diff.

## What this does not complete

The URL identity remains a compatibility bridge, not the desired final schema. The backend work in the main handoff is still required:

- generate and persist a stable photo ID at upload time;
- return one canonical photo record;
- enforce the ten-photo maximum server-side;
- update timestamps and invalidate the catalogue cache on all gallery mutations;
- retain temporary URL compatibility during migration.

The banner, category, venue-transition, URL-validation, canonical-response, rerender, modal and controller-consolidation work remains unchanged from the main handoff.

## CI interpretation

Every code change triggers the full repository workflows. Do not treat a passing narrow unit workflow as sufficient.

After the dependency correction, the branch passed the production dependency audit and aggregate Build Verification as well as unit tests, full regression, smoke tests, lint, formatting, type checks, CodeQL, dependency review, changed-code coverage, backend E2E, browser E2E, visual/a11y checks, Lighthouse, analytics validations, the weekly deep-quality workflow and the go-live audit.

Future changes must re-run that complete matrix. A red or pending required check means the branch is not ready to merge.

## Continuation point for another coding agent

Start with the P0 items in the main handoff. Do not replace the URL compatibility work unless the same commit also introduces canonical server-generated photo IDs and migrates every delete/reorder consumer safely.
