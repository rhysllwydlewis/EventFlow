# Skeleton loader consolidation

## Purpose

EventFlow had several overlapping loading systems with different class names, animation definitions, dimensions and accessibility behaviour. That made page loaders drift away from the layouts they represented and left some routes showing raw loading text, generic slabs or blank content regions.

This change establishes one canonical skeleton contract and fixes the clearest low-risk defects without hiding useful server-rendered content or replacing established page renderers.

## Implemented in this PR

### Canonical shared system

- `public/assets/css/skeleton.css` is the shared visual source for skeleton colours, shimmer, dimensions, responsive behaviour and reduced-motion handling.
- Static colour fallbacks are defined before `color-mix()` enhancement so older browsers retain visible placeholders.
- EventFlow remains light-theme-only; skeleton colours do not switch independently from the application when the operating system prefers dark mode.
- `public/assets/js/utils/skeleton-loader.js` is the shared lifecycle and markup source for new loaders.
- Existing named utility exports remain available so current imports do not break during migration.
- Named presets cover supplier cards, package cards, event cards, guide cards, gallery tiles, conversations, tickets, KPIs, tables and supplier-profile layouts.
- Loading regions set `aria-busy` and a deterministic state attribute, then clear those attributes on success, empty or error states.
- User-facing empty and error copy is escaped.
- `?skeletonDebug=1` holds shared-loader states on screen for desktop and mobile visual inspection.

### Compatibility consolidation

- `loading-skeleton.css` preserves the existing homepage skeleton dimensions and animation behaviour, while adding the missing `skeleton-grid` and empty-card contract required by Guides.
- `marketplace-skeleton.css` retains Marketplace-specific layout classes while using canonical skeleton tokens and motion behaviour.
- Existing supplier-profile and dashboard stylesheets remain in their original files. Scoped additions in the canonical stylesheet fill only the missing supplier gallery state and reshape existing dashboard placeholders.
- Existing pages using `.skeleton`, `.skeleton-text`, `.skeleton-card`, `.skeleton-list-item` and related classes inherit the improved shared styling without requiring a flag-day renderer rewrite.

### Priority page fixes

- **Category/package route:** initial HTML reserves title, hero and package-card layout before JavaScript runs, removing the loading-word and blank-results flash. A scoped `:has()` state hides the hero shell after the existing renderer resolves a category without a hero image, so no additional production JavaScript or stale loading attributes are required.
- **Event detail:** initial HTML reserves the hero, media, content, action and organiser layout instead of displaying raw loading text.
- **Guides:** the legacy `skeleton-grid` and empty `skeleton-card` markup now has a complete image-and-copy placeholder shape without changing homepage skeleton dimensions.
- **Marketplace:** existing card markup remains, but its separate shimmer, colour and motion implementation is removed.
- **Public supplier profile:** the missing gallery placeholder is added while the existing package, review, hero and sidebar loading contract remains untouched.
- **Customer dashboard:** countdown, budget KPI and milestone placeholders now reflect their final widget hierarchy.
- **Supplier dashboard:** KPI and availability placeholders now reflect their final widget hierarchy.

## Deliberate exclusions

### Gallery manager and public calendar

The audit identified the Gallery spinner and public-calendar slabs as outdated. An initial implementation replaced their complete stylesheet entry points to add small loading overrides. Pre-merge review found that approach introduced unnecessary import waterfalls and a much larger regression surface, so those changes were removed from this PR. They should be migrated through focused page-level changes with browser visual coverage.

### Community discussion threads

Discussion threads retain useful server-rendered content while client enhancement data loads. Replacing that readable fallback with a skeleton would make the experience worse and reduce resilience, so this PR intentionally leaves it visible.

### Remaining focused migrations

Community homepage/list/member pages, support detail modals and several admin tables still contain page-specific or generic placeholder markup. Complete renderer migration is left for focused follow-up work.

### Dormant components

`LoadingSkeleton.js` and other apparently orphaned loading helpers are not deleted here. Removal should follow a separate usage verification pass so externally referenced scripts or less common routes are not broken by assumption.

## Follow-up priority

1. Replace the Gallery manager spinner with renderer-owned gallery-tile placeholders.
2. Upgrade public-calendar placeholders without routing unrelated admin calendar styles through a new entry point.
3. Add Community-specific featured, discussion-row, profile and sidebar presets while preserving server-rendered thread content.
4. Adopt shared table-row and modal presets across admin pages.
5. Convert support ticket detail modals to the shared ticket and conversation presets.
6. Verify and remove dormant skeleton implementations.
7. Add browser visual snapshots for the most important held skeleton states.
8. Centralise skeleton asset-version references so secondary cosmetic updates cannot remain browser-cached for a week.

## Manual QA

Use `?skeletonDebug=1` on routes that import the shared utility to hold their loading state. Check:

- desktop, tablet and mobile widths;
- no unexpected horizontal scrolling;
- placeholder dimensions closely match completed content;
- no interactive controls appear usable while loading;
- reduced-motion mode removes shimmer;
- empty and error states clear loading semantics;
- the category shell shows no raw loading word or blank package area before JavaScript runs;
- category results with no hero image do not retain a hero skeleton;
- event detail does not show raw loading copy;
- Guides and Marketplace retain their existing grid behaviour;
- supplier-profile gallery loading disappears for valid empty results;
- customer and supplier dashboard loaders do not alter final widget layouts.

## Validation gate

Before merging, the current pull-request head must have EventFlow's GitHub Actions workflows attached and completed. Passing external DeepSource and GitGuardian checks does not replace the repository's clean-install, ESLint, formatting, smoke, full-regression, security and build-verification jobs. The pull request must remain unmerged until this gate is satisfied.
