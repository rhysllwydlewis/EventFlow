# Reduce customer welcome text scale

## Purpose

The customer dashboard welcome card currently reads like a marketing hero rather than an in-app dashboard panel. The heading and supporting copy should be reduced so the card matches the surrounding dashboard cards, stats, and section headings.

## Target file

- `public/assets/css/customer-dashboard-welcome-card.css`

## Required styling adjustments

Apply these values to the customer welcome card typography and spacing:

```css
body.customer-dashboard-page #welcome-section .customer-welcome-kicker {
  min-height: clamp(2rem, 2.35vw, 2.75rem) !important;
  gap: clamp(0.55rem, 0.75vw, 0.85rem) !important;
  margin-bottom: clamp(0.85rem, 1.25vw, 1.25rem) !important;
  padding-inline: clamp(0.75rem, 1vw, 1.05rem) !important;
  font-size: clamp(0.78rem, 0.82vw, 0.88rem) !important;
  font-weight: 800 !important;
  letter-spacing: 0.025em !important;
}

body.customer-dashboard-page #welcome-section .customer-welcome-heading {
  max-width: 590px !important;
  margin-bottom: clamp(0.7rem, 1vw, 1.05rem) !important;
  font-size: clamp(1.75rem, 2.1vw, 2.25rem) !important;
  line-height: 1.12 !important;
  letter-spacing: -0.035em !important;
  font-weight: 800 !important;
}

body.customer-dashboard-page #welcome-section .customer-welcome-intro {
  max-width: 560px !important;
  font-size: clamp(0.98rem, 1.05vw, 1.125rem) !important;
  line-height: 1.55 !important;
}

@media (max-width: 700px) {
  body.customer-dashboard-page #welcome-section .customer-welcome-heading {
    font-size: 1.65rem !important;
    line-height: 1.14 !important;
  }
}
```

## Acceptance criteria

- The welcome heading no longer dominates the dashboard.
- The welcome copy visually matches the scale of the surrounding dashboard cards.
- The badge, heading, and paragraph spacing is tighter and more compact.
- The card still keeps the existing illustration and premium styling.
- Mobile heading should sit around 26px, not the previous oversized hero scale.
