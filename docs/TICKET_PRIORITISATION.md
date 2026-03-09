# Ticket Prioritisation — Tier-Based Auto-Priority

## Overview

Support tickets in EventFlow are now assigned a priority automatically at creation time based on the submitting account's subscription tier. Users can no longer choose a priority when submitting a ticket; the system derives it from their account plan so that higher-value customers receive proportionally faster triage.

Admins retain full override capability and can adjust the priority of any ticket at any time via the admin panel.

---

## Tier → Priority Mapping

| Account Tier | Ticket Priority | Notes                                   |
| ------------ | --------------- | --------------------------------------- |
| Pro Plus     | `urgent`        | Highest — triaged immediately           |
| Pro          | `high`          | Second tier — prioritised over free     |
| Free         | `medium`        | Default for free suppliers              |
| Customer     | `medium`        | Customers have no paid support tier yet |

The mapping is defined in `utils/tierPriority.js` (`TIER_TO_PRIORITY`).

---

## Supplier Tier Resolution

Supplier tier is resolved by inspecting the supplier's database record in the `suppliers` collection:

1. `supplier.subscription.tier` — most authoritative; only accepted when `status` is `active` or `trial`/`trialing`
2. `supplier.subscriptionTier` — denormalised fallback written by the Stripe webhook
3. `supplier.isPro` — legacy boolean fallback (maps to `pro`)

If none of these are set, or if the subscription has expired/been cancelled, the supplier is treated as `free`.

---

## Customer Tier Policy

Customers currently have no paid support tier. All customer tickets receive `medium` priority by default. This can be overridden manually by an admin if required.

---

## Triage Metadata Fields

Each ticket now carries the following triage metadata fields:

| Field            | Type           | Description                                                                                         |
| ---------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `accountTier`    | `string\|null` | The account's tier at ticket creation (`free`, `pro`, `pro_plus`). `null` for legacy tickets.       |
| `prioritySource` | `string`       | `auto` (derived from tier) or `admin` (manually overridden). Defaults to `auto` for legacy tickets. |
| `priorityRank`   | `number`       | Computed numeric rank (urgent=4, high=3, medium=2, low=1). Used for queue sorting. Not persisted.   |

### Backward Compatibility

Existing tickets that pre-date this change will have:

- `accountTier: null` — tier was unknown at creation
- `prioritySource: 'auto'` — assumed auto-assigned

---

## Admin Queue Sort Order

The admin ticket listing (`GET /api/admin/tickets`) now sorts tickets using a **queue-oriented order** designed to surface the highest-priority work first:

1. **Active tickets first** — `open` and `in_progress` tickets appear before `resolved`/`closed`
2. **Highest priority first** — `urgent` → `high` → `medium` → `low`
3. **Unassigned before assigned** — unassigned tickets need attention sooner
4. **Oldest first within the same bucket** — FIFO within the same urgency level

---

## Admin Filters and Summary Cards

The admin tickets page (`/admin-tickets`) includes the following enhancements:

### Summary Cards

- Open / In Progress / Resolved
- Urgent ticket count
- Unassigned active ticket count
- Stale ticket count (active tickets with no admin reply in >48 hours)
- Pro Plus ticket count
- Pro ticket count

### Filters

- **Status** — filter by open / in_progress / resolved / closed
- **Priority** — filter by low / medium / high / urgent
- **Assignment** — filter by unassigned / assigned
- **Tier** — filter by Free / Pro / Pro Plus

### Per-Ticket Display

- Account tier badge shown alongside sender name
- Stale indicator (⚠ stale) shown for tickets waiting >48 hours
- Manage modal shows account tier, tier label, and priority source

---

## Customer/Supplier UI Changes

### What was removed

- The **Priority** dropdown has been removed from the Create Ticket modal for both customers and suppliers. Users cannot choose their own priority.
- The internal **priority badge** has been removed from ticket list and detail views for customers and suppliers.

### What was added

- A **status description** is shown in the ticket detail modal so users understand what their ticket's current status means (e.g. "Our support team is actively working on your ticket.").

---

## Implementation Files

| File                                           | Change                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `utils/tierPriority.js`                        | **New** — Tier→priority mapping, `deriveTicketPriority()`, `resolveSupplierTierFromRecord()`                                       |
| `utils/ticketNormalization.js`                 | Added `accountTier`, `prioritySource`, `priorityRank` normalisation with backward compat                                           |
| `routes/tickets.js`                            | POST no longer accepts `priority` from body; calls `deriveTicketPriority()`; PUT marks `prioritySource: 'admin'` on admin override |
| `routes/admin.js`                              | GET `/tickets` uses queue-oriented sort; PUT `/tickets/:id` persists `prioritySource: 'admin'`                                     |
| `public/assets/js/customer-tickets.js`         | Removed priority dropdown and priority badge; added status description                                                             |
| `public/assets/js/supplier-tickets.js`         | Same as customer                                                                                                                   |
| `public/assets/js/pages/admin-tickets-init.js` | Tier filter, new summary cards, tier badge in table, priority source in manage modal, stale indicator                              |
| `public/admin-tickets.html`                    | Added Tier filter `<select>` to toolbar                                                                                            |

---

## Tests

| File                                       | Coverage                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/tierPriority.test.js`          | **New** — unit tests for `TIER_TO_PRIORITY`, `PRIORITY_RANK`, `tierDisplayLabel`, `resolveSupplierTierFromRecord`, `deriveTicketPriority`     |
| `tests/integration/tickets-routes.test.js` | Extended — tier-based auto-priority, ignored user-supplied priority, backward compatibility, admin override records `prioritySource: 'admin'` |

---

## Support Tier Wording Reference

| Tier Code  | Display Label | Support Description    |
| ---------- | ------------- | ---------------------- |
| `free`     | Free          | Community support      |
| `pro`      | Pro           | Email support          |
| `pro_plus` | Pro Plus      | Priority phone support |
