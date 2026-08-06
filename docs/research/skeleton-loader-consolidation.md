# Skeleton loader consolidation

## Purpose

EventFlow had several overlapping loading systems with different class names, animation definitions, dimensions and accessibility behaviour. That made page loaders drift away from the layouts they represented and left some routes showing raw loading text, generic slabs or blank content regions.

This change establishes one canonical skeleton contract and fixes the clearest broken or mismatched routes without hiding useful server-rendered content or changing page data flows.

## Implemented in this PR

### Canonical shared system

- `public/assets/css/skeleton.css` is the shared visual source for skeleton colours, shimmer, dimensions, responsive behaviour and reduced-motion handling.
- `public/assets/js/utils/skeleton-loader.js` is the shared lifecycle and markup source for new loaders.
- Existing named utility exports remain available so current imports do not break during migration.
- Named presets cover supplier cards, package cards, event cards, guide cards, gallery tiles, conversations, tickets, KPIs, tables and supplier-profile layouts.
- Loading regions set `aria-busy` and a deterministic state attribute, then clear those attributes on success, empty or error states.
- User-facing empty and error copy is escaped.
- `?skeletonDebug=1` holds shared-loader states on screen for desktop and mobile visual inspection.

### Compatibility consolidation

- `loading-skeleton.css` delegates to the canonical stylesheet while preserving legacy wrappers used by Guides and older homepage code.
- `marketplace-skeleton.css` delegates animation, colour and motion behaviour to the canonical stylesheet while preserving Marketplace-specific layout classes.
- Gallery, Calendar, supplier-profile commercial polish and dashboard overhaul retain their established rules in base stylesheets, while their public entry stylesheets add canonical loading treatment.
- Existing pages using `.skeleton`, `.skeleton-text`, `.skeleton-card`, `.skeleton-list-item` and related classes inherit the improved shared styling without requiring a flag-day renderer rewrite.

### Priority page fixes

- **Category/package route:** the initial HTML now reserves title, hero and package-card layout before JavaScript runs, removing the legacy loading-word and blank-results flash. Its existing category data and error renderer remains unchanged.
- **Event detail:** the initial HTML reserves the real hero, media, content, action and organiser layout instead of displaying raw loading text.
- **Guides:** the legacy `skeleton-grid` and empty `skeleton-card` markup now participates in the canonical layout contract.
- **Marketplace:** existing card markup remains, but its separate shimmer, colour and motion implementation is removed.
- **Gallery manager:** the centred spinner now presents as four responsive gallery-tile placeholders without changing upload or photo-management JavaScript.
- **Public calendar:** generic grey blocks now present as event-card-shaped placeholders with media, category/title and metadata regions.
- **Public supplier profile:** gallery, package, review, enquiry, trust and details mounts reserve their rendered layout. Existing renderer logic continues to hide valid empty gallery/package sections.
- **Customer dashboard:** countdown, budget KPIs and milestones now show widget-shaped loading states.
- **Supplier dashboard:** KPI and availability loading states now contain the hierarchy of the rendered widgets rather than plain rectangles.

## Deliberate exclusions

### Community discussion threads

Discussion threads retain useful server-rendered content while client enhancement data loads. Replacing that readable fallback with a skeleton would make the experience worse and reduce resilience, so this PR intentionally leaves it visible.

### Remaining focused migrations

Community homepage/list/member pages, support detail modals and several admin tables still contain page-specific or generic placeholder markup. They benefit from canonical base classes where those are already used, but complete renderer migration is left for focused follow-up work.

### Dormant components

`LoadingSkeleton.js` and other apparently orphaned loading helpers are not deleted here. Removal should follow a separate usage verification pass so externally referenced scripts or less common routes are not broken by assumption.

## Follow-up priority

1. Add Community-specific featured, discussion-row, profile and sidebar presets while preserving server-rendered thread content.
2. Adopt shared table-row and modal presets across admin pages.
3. Convert support ticket detail modals to the shared ticket and conversation presets.
4. Verify and remove dormant skeleton implementations.
5. Add browser visual snapshots for the most important held skeleton states.

## Manual QA

Use `?skeletonDebug=1` on routes that import the shared utility to hold their loading state. Check:

- desktop, tablet and mobile widths;
- no unexpected horizontal scrolling;
- placeholder dimensions closely match completed content;
- no interactive controls appear usable while loading;
- reduced-motion mode removes shimmer;
- empty and error states clear loading semantics;
- the category shell shows no raw loading word or blank package area before JavaScript runs;
- event detail does not show raw loading copy;
- Guides and Marketplace retain their existing grid behaviour;
- Gallery shows tile placeholders rather than a centred spinner;
- public-calendar placeholders match the event-card grid;
- supplier-profile sections disappear correctly for valid empty results;
- customer and supplier dashboard loaders do not alter the final widget layouts.
