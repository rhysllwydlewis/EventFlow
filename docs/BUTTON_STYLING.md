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

## Current state

Part B2 is now complete:

1. Buttons that should receive CTA styling use explicit opt-in classes
   (`.ef-cta` or `.cta`).
2. The legacy `button:not(...)` opt-out selector has been removed from
   `public/assets/css/styles.css`.
3. `.cta` and `.ef-cta` continue to share the same CTA styling for
   backward compatibility.

## How to adopt `.ef-cta` on a new feature

```html
<button class="ef-cta">Save</button> <button class="ef-cta ef-cta--primary">Save</button>
```

No opt-out entry is needed.

## Removing the opt-out rule (follow-up)

✅ Completed: all known CTA-styled buttons were migrated to explicit
`ef-cta` markers and the legacy opt-out selector was removed.
