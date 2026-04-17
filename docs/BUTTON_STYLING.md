# Button Styling (Part B2)

## Background

Historically, every `<button>` on the site was opted into a site-wide
"CTA" style via a negated selector in `public/assets/css/styles.css`:

```css
button:not(.auth-tab):not(.role-pill)...(~30 exclusions), .cta {
  border-radius: 12px !important;
  padding: 10px 18px !important;
  ...
}
```

Every time a new non-CTA control was added, it had to be appended to the
`:not(...)` list or it would inherit the chunky padding / shadow. The
`!important` rider made the style nearly impossible to override at the
component level without stacking more `!important` declarations.

## Current state (this PR)

We have started the migration to an **opt-in** model. The opt-out rule
is still present (for backward compatibility with every existing page),
but:

1. The opt-in `.ef-cta` class is now a synonym for the opt-out rule.
   New code should add `class="ef-cta"` (or `class="ef-cta ..."`) to
   buttons that want the CTA treatment, instead of relying on the
   opt-out.
2. `.cta` continues to work (so existing markup is not affected).
3. The `!important` declarations on `.ef-notification__close` have been
   removed — the class was already in the opt-out rule's exclusion list,
   so those `!important`s were historical cruft.

## How to adopt `.ef-cta` on a new feature

```html
<button class="ef-cta">Save</button> <button class="ef-cta ef-cta--primary">Save</button>
```

No opt-out entry is needed.

## Removing the opt-out rule (follow-up)

To fully complete B2, a follow-up PR must:

1. Grep every HTML file under `public/` and every JS template string for
   `<button` occurrences.
2. For each button that relies on the opt-out rule for its styling (i.e.
   does not already have a specific class), add `class="ef-cta"`.
3. Once every CTA-styled button has `class="ef-cta"`, remove the
   `button:not(...)` rule from `styles.css` entirely. The opt-in
   `.ef-cta` rule will take over without any visual change.

That work is out of scope for the notification-audit PR because it
requires a visual diff on every page of the site, which is exactly what
the new visual regression suite (B4) is designed to support. The
intended workflow:

1. Land the visual regression suite (this PR).
2. Wait for baselines to stabilise (2-week soft-fail window).
3. Open a follow-up PR that migrates every button + removes the
   opt-out rule. Visual regression will catch any page that was
   relying on the opt-out rule without a class marker.
