# Admin Accessibility Guide

> **Audience:** Contributors adding or modifying admin dashboard pages.
> **Phase:** Phase 2 (implemented 2026-03).

This document describes the accessibility standards and patterns used in
EventFlow's admin dashboard. Follow these patterns to ensure the admin UI is
usable by keyboard-only users and screen-reader users.

---

## 1. Navigation

### Skip-to-Content Link

Every admin page **must** open its `<body>` with a skip-to-content link so
keyboard users can bypass the navigation bar and reach the main content
immediately:

```html
<body class="has-admin-navbar admin">
  <a href="#main-content" class="skip-to-content">Skip to main content</a>

  <nav ...>…</nav>

  <main id="main-content">…</main>
</body>
```

The `.skip-to-content` class is defined in `admin.css`. The link is visually
hidden until it receives keyboard focus (`:focus` reveals it in the top-left
corner as a teal button).

### Top Navbar (`<nav>`)

Every admin page wraps the top navbar in a `<nav>` with a descriptive label:

```html
<nav class="admin-top-navbar" aria-label="Admin navigation"></nav>
```

### Hamburger / Mobile Toggle

The mobile hamburger must convey its expanded state and control relationship:

```html
<button
  class="admin-hamburger"
  id="adminHamburger"
  aria-label="Toggle navigation menu"
  aria-expanded="false"
  aria-controls="adminNavbarNav"
></button>
```

JavaScript must toggle `aria-expanded` between `"true"` and `"false"` when
the menu opens or closes.

### Current Page Indicator

The nav link for the current page must carry `aria-current="page"`:

```html
<a href="/admin-users" class="admin-nav-btn" aria-current="page">Users</a>
```

### User Dropdown

```html
<button
  id="adminUserBtn"
  aria-haspopup="true"
  aria-expanded="false"
  aria-controls="adminDropdownMenu"
>
  Admin
</button>

<div id="adminDropdownMenu" role="menu" aria-labelledby="adminUserBtn">
  <a href="/admin-settings" class="admin-dropdown-item" role="menuitem">Settings</a>
  <div class="admin-dropdown-divider" role="separator"></div>
  <button class="admin-dropdown-item" role="menuitem">Sign Out</button>
</div>
```

JavaScript must toggle `aria-expanded` on `adminUserBtn` when the dropdown
opens or closes.

### Decorative Icons / Emoji

All emoji and inline SVG icons that are purely decorative must be hidden from
assistive technology:

```html
<span class="nav-icon" aria-hidden="true">📊</span> <svg aria-hidden="true" ...>…</svg>
```

---

## 2. Status & Live Regions

Dynamic content that updates without a page reload should use `aria-live`
regions so screen readers announce the change.

### Database Status Badge

```html
<div
  id="dbStatusBadge"
  class="db-status-badge db-loading"
  aria-live="polite"
  aria-label="Database status: Loading"
>
  <span class="db-status-dot" aria-hidden="true"></span>
  Loading...
</div>
```

The `aria-label` should be updated by JavaScript to reflect the actual status
(e.g. `"Database status: Connected to MongoDB"`).

### Loading / Count Summaries

```html
<div id="user-summary" role="status" aria-live="polite">Loading…</div>
```

For selected-item counts in bulk-action bars:

```html
<span id="selectedCount" aria-live="polite">0 users selected</span>
```

### Pagination Info

```html
<div id="paginationInfo" aria-live="polite">Showing 0 of 0 suppliers</div>
```

---

## 3. Tables

All data tables must have:

- An `aria-label` describing the table contents.
- `scope="col"` on column header cells.
- `scope="row"` on row header cells (if any).

```html
<table class="table" aria-label="Users list">
  <thead>
    <tr>
      <th scope="col"><input type="checkbox" aria-label="Select all users" /></th>
      <th scope="col">Name</th>
      <th scope="col">Email</th>
      …
    </tr>
  </thead>
</table>
```

### Select-All Checkbox

```html
<input type="checkbox" id="selectAll" class="table-checkbox" aria-label="Select all users" />
```

---

## 4. Forms

### Required Fields

Mark required fields with both the HTML `required` attribute and `aria-required`:

```html
<input type="text" id="packageTitle" name="title" required aria-required="true" />
```

Use `<abbr>` to visually indicate required fields without relying solely on
the `*` character (which may be read as "asterisk" by some screen readers):

```html
<label for="packageTitle"> Package Title <abbr title="required">*</abbr> </label>
```

### Fieldsets and Groups

Group related form controls with `<fieldset>` and `<legend>` where appropriate.

### Search / Filter Toolbars

Filter toolbars must have `role="search"` and an `aria-label`. Each filter
control must have either a visible `<label>` or an `aria-label`. Use `.sr-only`
labels when space is limited:

```html
<div class="admin-toolbar" role="search" aria-label="Filter users">
  <label for="userSearch" class="sr-only">Search users by name or email</label>
  <input type="text" id="userSearch" aria-label="Search users by name or email" … />

  <label for="roleFilter" class="sr-only">Filter by role</label>
  <select id="roleFilter" aria-label="Filter by role">
    …
  </select>
</div>
```

### File Upload Zone

Clickable upload zones that are not `<button>` or `<input>` elements need an
explicit role and keyboard access:

```html
<div id="imageUploadZone" role="button" tabindex="0" aria-labelledby="packageImageLabel">…</div>
```

### Progress Bar

Upload progress bars should communicate state to screen readers:

```html
<div
  role="progressbar"
  aria-label="Upload progress"
  aria-valuenow="0"
  aria-valuemin="0"
  aria-valuemax="100"
>
  <div id="progressBar" style="width:0;…"></div>
</div>
<p id="uploadStatus" aria-live="polite">Uploading...</p>
```

---

## 5. Modals / Dialogs

Every modal overlay must be a proper dialog:

```html
<div
  id="subscriptionModal"
  class="modal-overlay"
  role="dialog"
  aria-modal="true"
  aria-labelledby="subscriptionModalTitle"
>
  <div class="modal-dialog">
    <div class="modal-header">
      <h3 class="modal-title" id="subscriptionModalTitle">Manage Subscription</h3>
      <button class="modal-close" aria-label="Close subscription modal">&times;</button>
    </div>
    …
  </div>
</div>
```

JavaScript must:

- Move focus into the modal when it opens (to the heading or first interactive element).
- Trap focus inside the modal while it is open.
- Return focus to the trigger element when the modal closes.

---

## 6. Bulk Actions

Bulk-action toolbars must have `role="toolbar"` and a label:

```html
<div id="bulkActionsBar" class="bulk-actions-bar" role="toolbar" aria-label="Bulk actions">
  …
  <label for="bulkActionSelect" class="sr-only">Choose bulk action</label>
  <select id="bulkActionSelect" aria-label="Choose bulk action">
    …
  </select>
</div>
```

---

## 7. Pagination

Pagination containers should use `role="navigation"` with a label:

```html
<div class="pagination" role="navigation" aria-label="Suppliers pagination">
  <button id="prevPageBtn" aria-label="Previous page" …>← Previous</button>
  <button id="nextPageBtn" aria-label="Next page" …>Next →</button>
</div>
```

---

## 8. Focus Styles

Admin CSS defines visible focus rings via `:focus-visible` in
`admin-ui-improvements.css`. Do not suppress these with `outline: none`
unless an equivalent custom focus indicator is provided.

Focus ring colour: `#0B8073` (brand teal) — defined in `admin-tokens.css` as
`--admin-brand`.

For custom interactive elements:

```css
.my-element:focus-visible {
  outline: var(--admin-focus-outline); /* 2px solid #0B8073 */
  box-shadow: var(--admin-focus-ring); /* 0 0 0 3px rgba(11,128,115,0.30) */
  outline-offset: 2px;
}
```

---

## 9. Reduced Motion

The `@media (prefers-reduced-motion: reduce)` reset in `admin-tokens.css`
automatically disables all CSS transitions and animations for users who have
enabled the OS "Reduce motion" setting. Individual CSS layers add targeted
overrides as needed.

Do not add JS-driven animations without checking this preference first:

```js
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
  // Run animation
}
```

---

## 10. Checklist for New Admin Pages

Before merging a new or updated admin page, verify:

- [ ] `<body>` opens with `<a href="#main-content" class="skip-to-content">Skip to main content</a>`
- [ ] Page has `<main id="main-content">` to match the skip link target
- [ ] `<nav>` has `aria-label="Admin navigation"`
- [ ] Hamburger button has `aria-label`, `aria-expanded`, `aria-controls`
- [ ] Current page nav link has `aria-current="page"`
- [ ] User dropdown button has `aria-haspopup`, `aria-expanded`, `aria-controls`
- [ ] Dropdown menu has `role="menu"` and items have `role="menuitem"`
- [ ] Decorative icons/emoji have `aria-hidden="true"`
- [ ] DB status badge has `aria-live="polite"` and a descriptive `aria-label`
- [ ] All data tables have `aria-label` and `scope` attributes on headers
- [ ] Select-all checkbox has a descriptive `aria-label`
- [ ] Filter/search toolbars have `role="search"` and `aria-label`
- [ ] Filter inputs/selects have visible labels or `aria-label`
- [ ] Required form fields have `required` and `aria-required="true"`
- [ ] Modals have `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- [ ] Modal close button has a descriptive `aria-label`
- [ ] Bulk-action bar has `role="toolbar"` and `aria-label`
- [ ] Pagination has `role="navigation"` and button `aria-label` values
- [ ] No `outline: none` without an equivalent visible focus indicator
- [ ] No `<style>` blocks in HTML (use CSS files)
