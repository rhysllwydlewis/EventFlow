# EventFlow Admin Guide

## Overview

This guide covers all administrative operations available in the EventFlow admin dashboard.

## Accessing the Admin Dashboard

### Requirements

- Admin role privileges
- Valid authentication cookie
- Access to `/admin.html`

### Owner Account

The owner account (`admin@event-flow.co.uk`) has special protections:

- Cannot be deleted
- Cannot have admin privileges revoked
- Always maintains admin status

## Admin Dashboard Features

### 1. User Management

#### Viewing Users

- Navigate to the **Users** section on the admin dashboard
- All users are displayed with:
  - Name
  - Email
  - Role (customer, supplier, admin)
  - Verification status
  - Join date
  - Last login date

#### User Actions

**Edit User**

- Click "Edit" button next to any user
- Update name and email address
- Changes are logged in audit trail

**Delete User**

- Click "Delete" button next to any user
- Confirmation required
- Cannot delete:
  - Your own account
  - Owner account (admin@event-flow.co.uk)
- Deletes user permanently from the system

**Grant Admin Privileges**

- Click "Grant Admin" button next to non-admin users
- User gains full admin access
- Action is logged in audit trail

**Revoke Admin Privileges**

- Click "Revoke Admin" button next to admin users
- Select new role (customer or supplier)
- Cannot revoke from:
  - Your own account
  - Owner account
- Action is logged in audit trail

**Resend Verification Email**

- Available for unverified users only
- Click "Resend Verification" button in the Actions column
- Confirmation dialog appears before sending
- Generates new verification token (24-hour expiry)
- Previous token is invalidated
- User receives email with new verification link
- Action is logged in audit trail
- Toast notification shows success/failure

**When to Use:**

- User reports not receiving verification email
- Verification link has expired
- User accidentally deleted verification email
- Email was sent to wrong address (must first edit user's email)

### 2. Supplier Management

**Access:** Navigate to `/admin-suppliers`.

#### Auto-approve Supplier Verification Toggle

At the top of the Supplier Management page there is an **Auto-approve supplier verification** toggle:

| Setting       | Effect                                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OFF (default) | Suppliers who submit for verification enter the pending verification queue. Admins must manually approve, reject, or request changes.                                            |
| ON            | When a supplier submits their profile for verification it is automatically approved and they become a verified supplier immediately. Audit trail records the system attribution. |

#### Viewing Suppliers

- All suppliers displayed with:
  - Name
  - Approval status
  - Pro plan status
  - Health score
  - Tags

#### Supplier Actions

**Edit Supplier**

- Click "Edit" button (currently prompts for future implementation)
- Full edit modal coming in future update

**Approve/Reject Supplier**

- Click "Approve" or "Reject" buttons
- Controls supplier visibility on platform

**Delete Supplier**

- Click "Delete" button
- Removes supplier and all associated packages
- Confirmation required
- Action cannot be undone

**Manage Pro Plan**

- Select duration from dropdown (1 day, 7 days, 1 month, 1 year)
- Click "Set" to activate Pro trial
- Click "Cancel" to remove Pro status
- Changes are logged

### 3. Package Management

#### Package Actions

**Edit Package**

- Click "Edit" button (currently prompts for future implementation)
- Full edit modal coming in future update

**Approve/Unapprove Package**

- Click "Approve" or "Unapprove" buttons
- Controls package visibility

**Feature/Unfeature Package**

- Click "Feature" or "Unfeature" buttons
- Featured packages appear prominently on platform

**Delete Package**

- Click "Delete" button
- Removes package permanently
- Confirmation required

### 4. Photo Moderation

Photos are now **auto-approved on upload** — the manual approval workflow has been removed. All photos uploaded by suppliers are immediately visible to users without requiring admin action.

**Access:** Navigate to `/admin-photos` to browse uploaded photos by supplier.

**Features:**

- View all uploaded photos in grid layout
- Filter by supplier name
- Photos are automatically approved when uploaded

### 5. Review Moderation

**Access:** Click "Review Reviews" from admin dashboard, or navigate directly to `/admin-reviews`.

**Features:**

- **Auto-approve toggle** — When ON (default), reviews with a verified booking, no spam detected, and neutral/positive sentiment are published automatically. When OFF, all new reviews are held in the queue below for manual moderation.
- View all pending and flagged reviews with rating, title, and content
- Approve or reject individual reviews
- Batch approve/reject multiple reviews at once
- Rejection reason recorded for audit trail

**Auto-approve behaviour:**

| Setting      | Effect                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ON (default) | Qualifying reviews (verified booking + no spam + sentiment ≥ -0.3) are approved immediately by the system. Only borderline/flagged reviews enter the queue. |
| OFF          | Every new review is held in the pending queue regardless of quality signals. Admins must manually approve or reject each one.                               |

### 6. Reports Queue

**Access:** Click "Review Reports" or navigate to `/admin-reports.html`

**Features:**

- View reported content
- Resolve or dismiss reports
- Track report status

### 7. Audit Log

**Access:** Click "Audit Log" or navigate to `/admin-audit.html`

**Tracked Actions:**

- User deletions
- Admin privilege grants/revocations
- Supplier deletions
- Package deletions
- User suspensions/bans
- Supplier verifications
- All moderation actions

Each log entry includes:

- Admin who performed action
- Timestamp
- Action type
- Target resource
- Additional details

## Data Export

### User Export (CSV)

- Click "Download users CSV"
- Contains all user data except passwords
- Includes: name, email, role, verified status, marketing opt-in

### Marketing Export (CSV)

- Click "Download marketing CSV"
- Contains only users who opted into marketing
- Useful for email campaigns

### Full Export (JSON)

- Click "Download full export (JSON)"
- Complete database export
- Includes: users, suppliers, packages, plans, notes, events, messages

## Search and Filtering

### User Search

- Search by name or email
- Filter by join date (last 7 days, last 30 days, all time)
- Results update in real-time

### Photo Filtering

- Filter by status (pending, approved, rejected)
- Search by supplier name
- Batch selection for bulk operations

## System Administration

### Demo Reset

- Click "Reset demo data"
- Clears all collections
- Re-seeds with fresh demo data
- **WARNING:** Destroys all existing data

### Smart Tagging (Beta)

- Click "Run smart tagging (beta)"
- Automatically tags suppliers based on their profiles
- Experimental feature

## Security Best Practices

1. **Regular Audits**
   - Review audit logs weekly
   - Monitor for suspicious activity
   - Track admin privilege changes

2. **Data Protection**
   - Only export data when necessary
   - Securely store exported files
   - Delete exports after use

3. **User Privacy**
   - Respect GDPR requirements
   - Only access user data when required
   - Document reasons for account modifications

4. **Admin Privileges**
   - Grant admin access sparingly
   - Regularly review admin users
   - Revoke access when no longer needed

## Admin Architecture

This section describes the technical conventions used across the admin frontend and backend. Follow these patterns when contributing to or extending admin pages.

### Route Structure

All admin API endpoints are mounted under `/api/admin/` and handled in `routes/admin.js`. Data access is done through the `dbUnified` abstraction (see `utils/dbUnified.js`), which supports both the legacy flat-file store and MongoDB without requiring changes at the route level.

```
GET  /api/admin/users              # list users
PUT  /api/admin/users/:id          # update a user
POST /api/admin/users/:id/ban      # ban action
GET  /api/admin/suppliers          # list suppliers
...
```

All admin routes apply the `applyAuthRequired` middleware and then check `req.user.role === 'admin'` before proceeding.

### Frontend API Convention: `AdminShared.api()`

Admin pages **must** use `AdminShared.api()` for API calls instead of raw `fetch()`. This shared wrapper:

- Attaches `credentials: 'include'` automatically
- Attaches the `X-CSRF-Token` header for state-changing methods (POST, PUT, DELETE)
- Parses the JSON response and throws a descriptive `Error` on non-2xx status
- Redirects to `/auth` on 401 responses

**Usage:**

```javascript
// GET request
const data = await AdminShared.api('/api/admin/packages');

// POST request (CSRF token attached automatically)
await AdminShared.api('/api/admin/packages/123/approve', 'POST');

// PUT with body
await AdminShared.api('/api/admin/users/456', 'PUT', { name: 'New Name' });
```

### CSRF Handling

EventFlow implements CSRF protection using the **Double-Submit Cookie** pattern:

1. On page load the server sets two cookies: `csrf` and `csrfToken` (both non-HttpOnly).
2. `AdminShared.api()` reads `window.__CSRF_TOKEN__` (populated by `admin-shared.js` on init) and sends it as the `X-CSRF-Token` request header on write operations.
3. Server-side `middleware/csrf.js` validates that the header value matches the cookie.

This is handled transparently by `AdminShared.api()`. If you ever need to make a raw `fetch()` call in an admin page (avoid this where possible), attach the token manually:

```javascript
const token = window.__CSRF_TOKEN__ || '';
fetch('/api/admin/...', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
  credentials: 'include',
  body: JSON.stringify(payload),
});
```

### Avoiding Inline Styles

Inline `style="..."` attributes and `<style>` blocks inside admin HTML files are **not permitted** for new code. All visual styling must live in the scoped admin CSS files:

| CSS file                                        | Purpose                          |
| ----------------------------------------------- | -------------------------------- |
| `public/assets/css/admin.css`                   | Core admin layout and typography |
| `public/assets/css/admin-enhanced.css`          | Enhanced admin components        |
| `public/assets/css/admin-navbar.css`            | Top navigation bar               |
| `public/assets/css/admin-cards.css`             | Card and panel components        |
| `public/assets/css/admin-packages-enhanced.css` | Package management page          |
| `public/assets/css/admin-ui-improvements.css`   | Misc UI improvements             |

When a JS-rendered table row or element needs styling, add a class to the relevant CSS file and apply it via `className` in the template string — **do not** set `style` attributes in JS.

## API Endpoints

All admin endpoints require authentication and admin role.

### User Management

- `GET /api/admin/users` - List all users
- `PUT /api/admin/users/:id` - Edit user profile
- `DELETE /api/admin/users/:id` - Delete user
- `POST /api/admin/users/:id/grant-admin` - Grant admin privileges
- `POST /api/admin/users/:id/revoke-admin` - Revoke admin privileges
- `POST /api/admin/users/:id/suspend` - Suspend user
- `POST /api/admin/users/:id/ban` - Ban user
- `POST /api/admin/users/:id/verify` - Verify user email
- `POST /api/admin/users/:userId/resend-verification` - Resend verification email

### Supplier Management

- `GET /api/admin/suppliers` - List all suppliers
- `PUT /api/admin/suppliers/:id` - Edit supplier profile
- `DELETE /api/admin/suppliers/:id` - Delete supplier
- `POST /api/admin/suppliers/:id/approve` - Approve/reject supplier
- `POST /api/admin/suppliers/:id/verify` - Verify supplier
- `POST /api/admin/suppliers/:id/pro` - Manage Pro plan
- `GET /api/admin/suppliers/pending-verification` - Get pending suppliers

### Package Management

- `GET /api/admin/packages` - List all packages
- `PUT /api/admin/packages/:id` - Edit package
- `DELETE /api/admin/packages/:id` - Delete package
- `POST /api/admin/packages/:id/approve` - Approve package
- `POST /api/admin/packages/:id/feature` - Feature package

### Data Export

- `GET /api/admin/users-export` - Export users as CSV
- `GET /api/admin/marketing-export` - Export marketing list as CSV
- `GET /api/admin/export/all` - Export all data as JSON

### Metrics

- `GET /api/admin/metrics` - Get dashboard metrics
- `GET /api/admin/metrics/timeseries` - Get time-series data

## Troubleshooting

### "Review Photos" Link Not Working

- Ensure you're logged in as admin
- Clear browser cache
- Check browser console for errors
- Verify admin role in user profile

### Cannot Delete User

- Cannot delete your own account
- Cannot delete owner account
- Ensure proper admin privileges

### Exports Not Downloading

- Check popup blocker settings
- Verify admin authentication
- Try different browser

---

## Supplier Action-Prompt Email Automation

### Overview

EventFlow automatically sends reminder emails to verified suppliers who have
outstanding actions (missing packages, incomplete profile, missing photos). The
system uses a daily → weekly → monthly cadence and respects individual supplier
preferences.

### Global Controls (Admin Settings page)

Navigate to **Admin Settings → Email Automation — Supplier Action Prompts**.

| Control                     | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| Enable Action-Prompt Emails | Master switch. **Off by default.** Must be turned on to send any reminders.  |
| Remind: Missing Packages    | Send reminders to suppliers with 0 packages.                                 |
| Remind: Incomplete Profile  | Send reminders to suppliers with missing profile fields.                     |
| Remind: Missing Photos      | Send reminders to suppliers who have no gallery photos.                      |
| Cron Schedule               | When the daily job runs (default: `0 9 * * *` = 9 am).                       |
| **Dry Run**                 | Simulate a run — shows how many suppliers would be emailed, without sending. |
| **Send Now…**               | Immediately send emails to all eligible suppliers (with confirmation).       |

### Last Run & Run History

After every real send, the **Last run** chip updates automatically on the Admin
Settings page. Scroll down to the **Action Prompt Run History** table to see the
last 20 runs, including scanned/sent/skipped/error counts.

### Per-Supplier Controls (Admin Supplier Detail page)

1. Open **Admin → Suppliers** and click on a supplier.
2. Click the **📧 Action Prompts** tab.

The panel shows (in plain English):

- Whether global settings and per-type toggles are on/off.
- Whether the supplier's email is verified.
- Whether the supplier has opted out of reminders in their own settings.
- Current outstanding actions with severity badges.
- The full cadence state: current stage (daily/weekly/monthly), sends to date, last
  sent time, and next scheduled send time.
- The last global run summary.
- Any warnings (e.g. missing secret key, user unverified).

**Admin actions available on the tab:**

| Button                    | What it does                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enable Reminders**      | Sets `emailPrefs.actionPrompts.enabled = true` for this supplier's user account.                                                                                                   |
| **Disable Reminders**     | Sets `emailPrefs.actionPrompts.enabled = false` — no further emails until re-enabled.                                                                                              |
| **Reset Cadence**         | Clears `actionPromptState` — the daily→weekly→monthly cycle restarts from scratch on the next scheduled run. Useful after a supplier has fixed all issues and fallen behind again. |
| **📋 Copy Debug Summary** | Copies a plain-text diagnostics block to the clipboard. Paste this into a support ticket or Slack message for quick investigation.                                                 |

All write actions are logged to the Audit Log.

### Email Preview Tool (Admin Settings page)

Scroll to the **Email Preview — Action Prompts** card.

1. Enter the supplier's user ID (e.g. `user_abc123`) or email address.
2. Click **Preview** — the rendered email HTML appears in a sandboxed iframe.
3. Optionally click **Send Preview to Me** — the email is sent to **your** admin
   email address (not the supplier). Requires confirmation.

> **Security note:** The preview iframe uses `sandbox="allow-same-origin"` to
> prevent script execution. The email HTML is rendered server-side using the
> same template pipeline as production.

### Cadence Explained

| Stage       | Interval       | Max sends  |
| ----------- | -------------- | ---------- |
| **Daily**   | Every 24 hours | 7 sends    |
| **Weekly**  | Every 7 days   | 4 sends    |
| **Monthly** | Every 30 days  | Indefinite |

The cadence resets automatically when a supplier fixes all outstanding actions.

### Unsubscribe Links

Each action-prompt email contains an unsubscribe link. Clicking it disables
reminders for that supplier (`emailPrefs.actionPrompts.enabled = false`). They
can re-enable it from their **Account → Notification Preferences** page.

> If `UNSUBSCRIBE_SECRET` (or `JWT_SECRET`) is not set in production, unsubscribe
> links are omitted from emails. A warning will appear on the Action Prompts
> diagnostics tab for affected suppliers.

### Environment Variables

| Variable                              | Purpose                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| `ACTION_PROMPTS_CRON`                 | Override the cron expression (bypasses DB setting).                  |
| `ACTION_PROMPTS_ENABLED`              | Set to `false` or `0` to disable the scheduler outside production.   |
| `ACTION_PROMPTS_MAX_SEND_PER_RUN`     | Hard cap on emails sent per run (default: 500 prod / 50 dev).        |
| `ACTION_PROMPTS_UNSUBSCRIBE_TTL_DAYS` | Unsubscribe link expiry in days (default: 30).                       |
| `UNSUBSCRIBE_SECRET`                  | Secret used to sign unsubscribe tokens (falls back to `JWT_SECRET`). |

---

## Support

For additional help or to report issues:

- Check audit logs for action history
- Review browser console for errors
- Contact system administrator
