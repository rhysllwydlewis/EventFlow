# Skeleton loader consolidation

## Purpose

EventFlow had several overlapping loading systems with different class names, animation definitions, dimensions and accessibility behaviour. That made page loaders drift away from the layouts they represented and left some routes showing raw loading text or blank content regions.

This change establishes one canonical skeleton contract and fixes the clearest broken or mismatched routes without hiding useful server-rendered content or turning the work into a full dashboard redesign.

## Implemented in this PR

### Canonical shared system

- `public/assets/css/skeleton.css` is the single visual source for skeleton colours, shimmer, dimensions, responsive behaviour and reduced-motion handling.
- `public/assets/js/utils/skeleton-loader.js` is the single lifecycle and markup source for new loaders.
- Existing named utility exports remain available so current imports do not break during migration.
- Named presets now cover supplier cards, package cards, event cards, guide cards, gallery tiles, conversations, tickets, KPIs, tables and supplier-profile layouts.
- Loading regions set `aria-busy` and a deterministic state attribute, then clear those attributes on success, empty or error states.
- User-facing empty and error copy is escaped.
- `?skeletonDebug=1` holds shared loaders on screen for desktop and mobile visual inspection.

### Compatibility consolidation

- `loading-skeleton.css` now delegates to the canonical stylesheet while preserving legacy wrappers used by Guides and older homepage code.
- `marketplace-skeleton.css` now delegates animation, colour and motion behaviour to the canonical stylesheet while preserving Marketplace-specific layout classes.
- Existing dashboards and supplier pages that already use `.skeleton`, `.skeleton-text`, `.skeleton-card`, `.skeleton-list-item` and related classes inherit the improved shared styling without requiring simultaneous renderer rewrites.

### Priority page fixes

- The category/package route no longer exposes a raw loading heading with a blank results area. It now renders title, hero and package-card placeholders and has distinct missing-category and retryable error states.
- The event-detail route no longer displays `Loading event…` and a plain `Loading…` body. Its initial HTML now reserves the real hero, media, content, action and organiser layout.
- The Guides loader mismatch is resolved by making its legacy `skeleton-grid` and empty `skeleton-card` markup participate in the canonical layout contract.

## Deliberate exclusions

### Community discussion threads

Discussion threads retain useful server-rendered content while client enhancement data loads. Replacing that readable fallback with a skeleton would make the experience worse and reduce resilience, so this PR intentionally leaves it visible.

### Full renderer migrations

The supplier profile, customer dashboard, supplier dashboard, Community homepage/list/member pages, public calendar, gallery manager, support modals and admin tables still contain page-specific or generic placeholder markup. Their current placeholders benefit from the canonical styling where class names overlap, but converting every renderer to named presets is left for focused follow-up work.

This boundary keeps the current PR reviewable and reduces the risk of mixing loading-state work with unrelated layout or data-flow changes.

### Dormant components

`LoadingSkeleton.js` and other apparently orphaned loading helpers are not deleted here. Removal should follow a separate usage verification pass so externally referenced scripts or less common routes are not broken by assumption.

## Follow-up priority

1. Complete the public supplier-profile page skeleton: hero media, avatar, gallery, packages, reviews and sidebar.
2. Replace customer and supplier dashboard rectangles with widget-shaped KPI, calendar, budget, availability, conversation and ticket presets.
3. Replace the gallery manager spinner with responsive gallery-tile placeholders.
4. Upgrade public-calendar placeholders to match event-card image, metadata and actions.
5. Add Community-specific featured, discussion-row, profile and sidebar presets while preserving server-rendered thread content.
6. Adopt shared table-row and modal presets across admin pages.
7. Verify and remove dormant skeleton implementations.

## Manual QA

Use `?skeletonDebug=1` on a route that imports the shared utility to hold its loading state. Check:

- desktop, tablet and mobile widths;
- no unexpected horizontal scrolling;
- placeholder dimensions closely match completed content;
- no interactive controls appear usable while loading;
- reduced-motion mode removes shimmer;
- empty and error states clear loading semantics;
- category retry performs a fresh request;
- event detail does not show raw loading copy;
- Guides and Marketplace retain their existing grid behaviour.
