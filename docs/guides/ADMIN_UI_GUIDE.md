# Admin UI Guide — CSS Architecture & Conventions

> **Audience:** Contributors working on admin dashboard pages.
> **Phase:** Phase 2 (implemented 2026-03).

---

## 1. CSS Layer Order

Every admin page loads its stylesheets in the following order. Each layer builds
on the previous one; later layers may override earlier layers but must not
duplicate rules already established by an earlier layer.

| #   | File                        | Purpose                                                                                                              |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `admin-tokens.css`          | CSS custom properties (design tokens) — colours, spacing, shadows, typography, transitions                           |
| 2   | `admin.css`                 | Base primitives: body, headings, tables, global buttons, page-level layout, utility classes (`sr-only`, `hidden`, …) |
| 3   | `admin-enhanced.css`        | Notification toasts, modal dialogs, stat/metric cards                                                                |
| 4   | `admin-navbar.css`          | Top navigation bar and all its child elements                                                                        |
| 5   | `admin-cards.css`           | Reusable `admin-card`, `stat-card`, and grid components                                                              |
| 6   | `admin-ui-improvements.css` | Table/form checkboxes, toggle switches, bulk-action bar, small interactive component refinements                     |

Additional page-specific CSS files (e.g. `admin-packages-enhanced.css`,
`admin-supplier-detail.css`) are appended **after** layer 6 in the pages that
need them.

### What goes where

| Type of rule                                   | Correct layer                                                 |
| ---------------------------------------------- | ------------------------------------------------------------- |
| New colour, spacing, or shadow value           | `admin-tokens.css` — add a CSS variable                       |
| Base HTML element style (table, button, td, …) | `admin.css`                                                   |
| Notification or modal pattern                  | `admin-enhanced.css`                                          |
| Navbar or sub-navigation element               | `admin-navbar.css`                                            |
| Card or grid component                         | `admin-cards.css`                                             |
| Checkbox, toggle, or bulk-action bar           | `admin-ui-improvements.css`                                   |
| Page-specific rule                             | Dedicated page CSS file (e.g. `admin-packages-enhanced.css`)  |
| Inline `<style>` block                         | **Not allowed** — move to `admin.css` or a page-specific file |

---

## 2. Design Tokens (`admin-tokens.css`)

All hardcoded values that appear in multiple places **must** be expressed as
CSS custom properties defined in `admin-tokens.css`.

### Colour tokens

```css
/* Brand */
--admin-brand: #0b8073;
--admin-brand-light: #13b6a2;
--admin-brand-tint: rgba(11, 128, 115, 0.1);

/* Status */
--admin-success: #10b981;
--admin-warning: #f59e0b;
--admin-danger: #ef4444;
--admin-info: #3b82f6;

/* Neutral */
--admin-text-primary: #1f2937;
--admin-text-secondary: #374151;
--admin-text-muted: #6b7280;
--admin-border: #e5e7eb;
--admin-surface: #ffffff;
--admin-bg: #f8f9fa;
```

### Spacing tokens

```css
--admin-space-1: 4px;
--admin-space-2: 8px;
--admin-space-3: 12px;
--admin-space-4: 16px;
--admin-space-5: 20px;
--admin-space-6: 24px;
--admin-space-8: 32px;
```

### Shadow tokens

```css
--admin-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05);
--admin-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
--admin-shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.1);
```

### Focus ring

Always use the token for interactive element focus rings:

```css
.my-interactive-element:focus-visible {
  outline: var(--admin-focus-outline); /* 2px solid #0B8073 */
  box-shadow: var(--admin-focus-ring); /* 0 0 0 3px rgba(11,128,115,0.30) */
}
```

---

## 3. Reduced-Motion Support

The global reduced-motion rule in `admin-tokens.css` suppresses all CSS
animations and transitions site-wide when the OS "Reduce motion" preference
is active. Individual layers add their own targeted `@media (prefers-reduced-motion: reduce)`
overrides for any element-level transitions that need explicit opt-out.

**Rule:** If you add a `transition` or `animation` to an admin component, add a
corresponding `prefers-reduced-motion` override in the same file.

---

## 4. Inline Styles Policy

Inline `style` attributes and `<style>` blocks in admin HTML files are
**not allowed** except for dynamic values set by JavaScript.

If you need a one-off style:

1. Check whether an existing CSS class already covers it.
2. If the style is reused across pages → add to `admin.css` or the appropriate layer.
3. If the style is truly page-specific → add a page-specific CSS file.

---

## 5. Empty / Loading / Error State Conventions

Use the following patterns consistently:

```html
<!-- Loading placeholder -->
<td colspan="N" class="small">Loading…</td>

<!-- Status/count with live region -->
<div id="user-summary" role="status" aria-live="polite">Loading…</div>

<!-- Error message -->
<div class="error-message" role="alert">An error occurred. Please refresh.</div>
```

---

## 6. Button Conventions

> ⚠️ `admin.css` has a **global** `button { color: #fff; background: #3b82f6; }`
> rule (line ~49). Any class-based button style that needs a different colour
> **must** explicitly set both `color` and `background`.

| Class                | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `.btn.btn-primary`   | Primary action (teal/brand)                     |
| `.btn.btn-secondary` | Secondary/cancel action                         |
| `.btn.btn-danger`    | Destructive action (red)                        |
| `.btn-sm`            | Small variant                                   |
| `.btn-brand`         | Accent-purple brand button (Import Demo etc.)   |
| `.btn-bulk-*`        | Bulk-action bar buttons (white on coloured bar) |

---

## 7. Adding a New Admin Page

When adding a new admin page:

1. Include the CSS in this exact order in `<head>`:

   ```html
   <link rel="stylesheet" href="/assets/css/tokens.css?v=X" />
   <link rel="stylesheet" href="/assets/css/admin-tokens.css?v=X" />
   <link rel="stylesheet" href="/assets/css/styles.css?v=X" />
   <link rel="stylesheet" href="/assets/css/eventflow-17.0.0.css?v=X" />
   <link rel="stylesheet" href="/assets/css/utilities.css?v=X" />
   <link rel="stylesheet" href="/assets/css/components.css?v=X" />
   <link rel="stylesheet" href="/assets/css/animations.css?v=X" />
   <link rel="stylesheet" href="/assets/css/mobile-optimizations.css?v=X" />
   <link rel="stylesheet" href="/assets/css/admin.css?v=X" />
   <link rel="stylesheet" href="/assets/css/admin-enhanced.css?v=X" />
   <link rel="stylesheet" href="/assets/css/admin-navbar.css?v=X" />
   <link rel="stylesheet" href="/assets/css/admin-cards.css?v=X" />
   <link rel="stylesheet" href="/assets/css/ui-ux-fixes.css?v=X" />
   <link rel="stylesheet" href="/assets/css/admin-ui-improvements.css?v=X" />
   <!-- Page-specific last -->
   <link rel="stylesheet" href="/assets/css/admin-MY-PAGE.css?v=X" />
   ```

2. Copy the standard navbar block from any existing admin page.
3. Add `aria-current="page"` to the current page's nav link.
4. Open `<body>` with `<a href="#main-content" class="skip-to-content">Skip to main content</a>`.
5. Ensure the page's main content area has `id="main-content"`.
6. Follow the accessibility checklist in `ADMIN_ACCESSIBILITY.md`.
