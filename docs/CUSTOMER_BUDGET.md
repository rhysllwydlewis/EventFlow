# Customer budget (`/budget`)

The customer budget page: a total, what is committed, what is left, a planned-versus-actual
breakdown by category, and an editable list of items. Customer-only (`customerOnlyHtmlPages` in
`server.js`), `noindex`.

## Files

| File                                    | Role                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `public/budget.html`                    | Header, footer and page markup, including the three `<dialog>` forms.                                 |
| `public/assets/css/budget-page.css`     | The only stylesheet written for the page. Every selector is under `.bp`.                              |
| `public/assets/js/pages/budget-page.js` | The page: loading, saving, rendering, dialogs, export.                                                |
| `public/assets/js/budget-calc.js`       | Pure maths (totals, over budget, percentages, CSV, legacy conversion). Also `require`-able for tests. |
| `tests/unit/budget-calc.test.js`        | Edge cases for the maths: zero budget, negative remaining, NaN, pence rounding.                       |
| `tests/unit/budget-page.test.js`        | Page invariants (scoped CSS, one stylesheet, ids the script needs, endpoints).                        |

Removed in the redesign: `assets/js/budget.js` (a `localStorage`-only `BudgetManager`),
`assets/js/pages/budget-init.js`, the Chart.js doughnut (and its CDN script), and the page's links to
`eventflow-17.0.0.css` and `animations.css` (neither changed how the shared header and footer render).

## Where the data lives

Before the redesign the page kept everything in `localStorage` under `ef_budget` and never called
the API, so it could not agree with the dashboard, which reads the event plan. The page now uses the
same fields the dashboard reads:

| Data         | Source                                                                          | Endpoint                                                                                    |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Total budget | `plan.budget` (a string)                                                        | `PATCH /api/me/plans/:id` with `{ budget }`                                                 |
| Items        | `plan.budgetItems` (`category`, `item`, `estimated`, `actual`, `paid`, `notes`) | `POST /api/me/plans/:id/budget` with `{ budgetItems }` (replaces the whole list; see below) |
| Read         | one `GET /api/me/plans`, which returns both                                     |                                                                                             |

No new backend was needed. Writes need a verified account and a CSRF token (the server enforces
both; the page shows the server's message if a save is refused). Nothing is saved optimistically:
a dialog stays open with its message until the server accepts the change.

The list is saved whole, so every save also sends `baseVersion` (the plan's `budgetUpdatedAt`).
If the saved list has changed since the page loaded (a second tab or device), the server answers
409 and the dialog shows "This budget was changed somewhere else. Reload to see the latest."
Clients that send no `baseVersion` are not checked. The server also caps a budget at 500 items and
each amount at £1,000,000,000.

Which plan: `?plan=<id>`, else the last plan picked here, else the first plan with a budget, else
the first plan. A plan switcher appears only when there is more than one.

### No event plan yet

Customers without a plan keep the budget on this device (`ef_budget_v2`, same shape as the plan
fields) and see a notice linking to `/start`. The total is also written to
`eventflow_custom_budget`, the key the dashboard falls back to.

### Data from the old page

`ef_budget` (`{ total, expenses[] }`) is still read, never deleted. With a plan, a notice offers to
move it into the plan (`Move to this plan` writes the items, and the total if the plan has none,
then sets `ef_budget_imported`). Without a plan it is converted on the fly.

What does not carry over, because plan budget items have no field for it: dates, the
pending/overdue distinction, and the supplier name (kept as `Supplier: name` in the notes). A
`paid` expense becomes fully paid; anything else becomes unpaid.

## The numbers

Same rules as the dashboard (`dashboard-customer-module.js`), implemented in `budget-calc.js`:

- A line costs its **actual** amount when there is one, otherwise its **planned** (`estimated`) amount.
- **Committed** is the sum of those costs. **Remaining** is budget minus committed and can go
  negative; the page then says "Over budget by".
- A plan budget is read with `parseFloat`; anything that is not a positive number means "not set".
- Payment status is derived: paid when `paid` covers the cost, part paid when some is paid,
  unpaid otherwise.
- Money is added in whole pence and shown as GBP (`£1,234` or `£1,234.50`).

Not included: the dashboard also adds the listed price of supplier packages saved to the plan. The
page does not load package prices and says so when the plan has packages.

## Design notes

Calm neutral surfaces, one teal accent (`#0b8073`, deep `#064f46`), ink `#17202f`, muted
`#566176`. Red appears only for money over budget and always comes with words ("£700 over"). The
progress bar shows paid, still to pay, and (when over) only the part beyond the budget. Below 720px
the tables become stacked cards (the table roles stay in the markup so assistive technology still
reads them as tables). Type sizes use the site scale; animation and transitions only run under
`prefers-reduced-motion: no-preference`.

Item rows have an Edit button; Delete is inside the edit dialog and asks for confirmation.

With no `?plan=` the page opens on the plan last picked here or on the guest list (shared in
`localStorage` as `ef_customer_plan`), otherwise on the dashboard's focus plan (the next dated
plan). A refused plans request (ended session) offers a log-in link that returns to `/budget`.

The page shares its warm neutral palette, 1152px content width and rounded-rectangle shapes (no
pills) with the guest list and the dashboard, so moving between them does not shift the layout or
the tone. Notes use a textarea (the server keeps 500 characters); the table clamps a long note to
two lines on tablets and the card to three on phones, and the full text is in the edit dialog. On
phones the export menu opens rightwards from the Export button so it stays on screen.
