# EventFlow Admin Panel Guide

## Overview

The EventFlow Admin Panel is a comprehensive management system for administrators to oversee all aspects of the platform, including users, suppliers, packages, photos, tickets, reports, and system settings.

## Architecture

### Pages Structure

The admin panel consists of 13 main pages:

1. **Dashboard** (`/admin.html`) - Main overview with statistics and quick actions
2. **User Management** (`/admin-users.html`) - Manage all user accounts
3. **Package Management** (`/admin-packages.html`) - Oversee event packages
4. **Photo Library / Moderation** (`/admin-photos.html`) - Manage supplier photos with auto-approve toggle
5. **Support Tickets** (`/admin-tickets.html`) - Handle customer support requests
6. **Content Reports** (`/admin-reports.html`) - Review user-submitted reports
7. **Audit Log** (`/admin-audit.html`) - View system activity logs
8. **Homepage Management** (`/admin-homepage.html`) - Update homepage content
9. **Payment Analytics** (`/admin-payments.html`) - Monitor payment transactions
10. **Content Management** (`/admin-content.html`) - Manage site content
11. **System Settings** (`/admin-settings.html`) - Configure system parameters
12. **User Detail** (`/admin-user-detail.html`) - Detailed user information
13. **Supplier Detail** (`/admin-supplier-detail.html`) - Detailed supplier information

### Design System

All admin pages follow a consistent design with:

- **Gradient Background**: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
- **Sidebar Navigation**: Fixed left sidebar with gradient (`linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)`)
- **White Cards**: Content cards with `border-radius: 16px` and proper shadows
- **Modern Typography**: Clean, readable fonts with proper hierarchy
- **Responsive Layout**: Mobile-first design with breakpoints at 1024px and 640px

### Core Stylesheets

1. **`/assets/css/admin.css`**
   - Base admin styles
   - Unified sidebar structure
   - Badge styles for status indicators
   - Button variants
   - Form controls

2. **`/assets/css/admin-enhanced.css`**
   - Modern gradient effects
   - Dashboard header styling
   - Stats cards and moderation grids
   - Quick action buttons
   - Data tables and sections
   - Photo moderation queue
   - Responsive utilities

### Core JavaScript Files

1. **`/assets/js/admin-shared.js`**
   - Shared utilities for all admin pages
   - API wrapper with CSRF token support
   - Toast notification system
   - Date/time formatting
   - Sidebar toggle functionality
   - Badge count management
   - HTML sanitization

2. **`/assets/js/pages/admin-init.js`**
   - Main dashboard initialization
   - Quick action button handlers
   - Data table rendering
   - User/supplier/package management
   - Event delegation for dynamic content

3. **`/assets/js/pages/admin-*-init.js`**
   - Page-specific initialization scripts
   - Examples: `admin-users-init.js`, `admin-packages-init.js`, etc.

## API Endpoints

### User Management

```
GET    /api/admin/users                    # List all users
GET    /api/admin/users/:id                # Get single user
PUT    /api/admin/users/:id                # Update user
DELETE /api/admin/users/:id                # Delete user
POST   /api/admin/users/:id/suspend        # Suspend user
POST   /api/admin/users/:id/unsuspend      # Unsuspend user
POST   /api/admin/users/:id/ban            # Ban user
POST   /api/admin/users/:id/verify         # Manually verify user
POST   /api/admin/users/:id/reset-password # Send password reset email
POST   /api/admin/users/:id/grant-admin    # Grant admin role
POST   /api/admin/users/:id/revoke-admin   # Revoke admin role

# Bulk Operations
POST   /api/admin/users/bulk-delete        # Bulk delete users
POST   /api/admin/users/bulk-verify        # Bulk verify users
POST   /api/admin/users/bulk-suspend       # Bulk suspend/unsuspend users
```

### Package Management

```
GET    /api/admin/packages                 # List all packages
GET    /api/admin/packages/:id             # Get single package
PUT    /api/admin/packages/:id             # Update package
DELETE /api/admin/packages/:id             # Delete package
POST   /api/admin/packages/:id/approve     # Approve package
POST   /api/admin/packages/:id/feature     # Feature/unfeature package
```

### Supplier Management

```
GET    /api/admin/suppliers                # List all suppliers
GET    /api/admin/suppliers/:id            # Get single supplier
PUT    /api/admin/suppliers/:id            # Update supplier
DELETE /api/admin/suppliers/:id            # Delete supplier
POST   /api/admin/suppliers/:id/approve    # Approve supplier
POST   /api/admin/suppliers/:id/verify     # Verify supplier
POST   /api/admin/suppliers/:id/pro        # Manage Pro subscription
GET    /api/admin/suppliers/pending-verification # Get suppliers awaiting verification
POST   /api/admin/suppliers/smart-tags     # AI-powered supplier tagging
```

### Photo Library & Moderation

The `/admin-photos` page supports two modes controlled by the **Auto-approve toggle**:

#### Auto-approve ON (default)

- Supplier photo uploads are immediately added to the library — no manual review.
- The page shows a **Photo Library** view with all supplier gallery photos.
- No approve/reject buttons are shown.
- The status banner reads: _"Auto-approval enabled"_.

#### Auto-approve OFF

- New supplier photo uploads are held in a **moderation queue** (`status: pending`).
- The page shows a **Moderation Queue** view with per-photo Approve/Reject buttons.
- A **batch action bar** appears when photos are selected, allowing bulk approve/reject.
- The status banner reads: _"Manual moderation active"_.

#### Toggling auto-approve

The toggle in the admin-photos UI sends a `PUT /api/admin/settings/features` request with
`{ photoAutoApprove: true/false }`. The change takes effect immediately — the page reloads
the correct view without requiring a page refresh.

```
GET    /api/admin/photos/library            # All approved gallery photos (library view)
GET    /api/admin/photos/pending            # Pending photos (queue view); empty when auto-approve ON
POST   /api/admin/photos/:id/approve        # Approve a pending photo
POST   /api/admin/photos/:id/reject         # Reject a pending photo
GET    /api/admin/settings/features         # Includes photoAutoApprove flag
PUT    /api/admin/settings/features         # Update photoAutoApprove (and other flags)
```

**Feature flag:** `photoAutoApprove` (boolean, default `true`). Stored in the `settings`
collection under `settings.features.photoAutoApprove`.

**Upload behaviour:** When `photoAutoApprove` is `false`, supplier photo uploads via
`POST /api/photos/upload?type=supplier` store the photo as a `pending` record in the
`photos` collection rather than adding it directly to the supplier's `photosGallery`.
On approval the record is moved to `photosGallery`. Package photos are not affected.

### Reports Management

```
GET    /api/reports                        # List all reports (requires admin role)
POST   /api/reports                        # Create new report (any authenticated user)
POST   /api/admin/reports/:id/resolve      # Resolve report
POST   /api/admin/reports/:id/dismiss      # Dismiss report
```

### Content Management

```
GET    /api/admin/content/homepage         # Get homepage content
PUT    /api/admin/content/homepage         # Update homepage content
GET    /api/admin/content/announcements    # List announcements
POST   /api/admin/content/announcements    # Create announcement
GET    /api/admin/content/announcements/:id # Get announcement
PUT    /api/admin/content/announcements/:id # Update announcement
DELETE /api/admin/content/announcements/:id # Delete announcement
GET    /api/admin/content/faqs             # List FAQs
POST   /api/admin/content/faqs             # Create FAQ
GET    /api/admin/content/faqs/:id         # Get FAQ
PUT    /api/admin/content/faqs/:id         # Update FAQ
DELETE /api/admin/content/faqs/:id         # Delete FAQ
```

### System Settings

```
GET    /api/admin/settings/site            # Get site settings
PUT    /api/admin/settings/site            # Update site settings
GET    /api/admin/settings/features        # Get feature flags
PUT    /api/admin/settings/features        # Update feature flags
```

### Analytics & Exports

```
GET    /api/admin/metrics                  # Get dashboard metrics
GET    /api/admin/metrics/timeseries       # Get time-series data
GET    /api/admin/badge-counts             # Get sidebar badge counts
GET    /api/admin/marketing-export         # Export marketing opt-in users (CSV)
GET    /api/admin/users-export             # Export all users (CSV)
GET    /api/admin/export/all               # Export all data (JSON)
```

### System Administration

```
POST   /api/admin/reset-demo               # Reset demo data and re-seed
```

## Authentication

All admin endpoints require:

1. Valid session (authenticated user)
2. Admin role (`role: 'admin'`)

Authentication is handled by middleware:

- `authRequired` - Ensures user is logged in
- `roleRequired('admin')` - Ensures user has admin role

## Security Features

### CSRF Protection

All state-changing requests (POST, PUT, DELETE) require a CSRF token:

```javascript
// Token is automatically fetched and stored in window.__CSRF_TOKEN__
// Admin-shared.js handles token injection in API requests
```

### Audit Logging

Admin actions are automatically logged to the audit log:

```javascript
auditLog({
  adminId: req.user.id,
  adminEmail: req.user.email,
  action: AUDIT_ACTIONS.USER_SUSPENDED,
  targetType: 'user',
  targetId: userId,
  details: { reason, email },
});
```

Available audit actions:

- `USER_SUSPENDED`, `USER_UNSUSPENDED`
- `USER_BANNED`, `USER_UNBANNED`
- `USER_VERIFIED`
- `SUPPLIER_VERIFIED`, `SUPPLIER_APPROVED`
- `PACKAGE_APPROVED`, `PACKAGE_DELETED`
- And more...

### Input Sanitization

- All user input is sanitized using `escapeHtml()` helper
- HTML entities are encoded to prevent XSS attacks
- MongoDB injection protection via express-mongo-sanitize

## Sidebar Navigation

### Structure

```html
<aside class="admin-sidebar" id="adminSidebar">
  <div class="admin-sidebar-header">
    <h3>Admin Panel</h3>
    <button id="sidebarToggle" class="sidebar-toggle">☰</button>
  </div>
  <nav class="admin-sidebar-nav">
    <!-- Navigation links with badges -->
  </nav>
</aside>
```

### Responsive Behavior

- **Desktop (>1024px)**: Sidebar always visible, no toggle needed
- **Mobile (≤1024px)**: Sidebar hidden by default, toggle button appears
- **State Persistence**: Sidebar state saved in localStorage

### Badge System

Badge counts are automatically updated every 60 seconds:

- **Users**: New users in last 7 days
- **Photos**: Pending photo approvals (only non-zero when auto-approve is OFF)
- **Tickets**: Open support tickets

## Common Patterns

### Data Table Rendering

```javascript
function renderTable(items) {
  const tbody = document.querySelector('tbody');
  tbody.innerHTML = items
    .map(
      item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.email)}</td>
      <td><span class="badge">${escapeHtml(item.status)}</span></td>
    </tr>
  `
    )
    .join('');
}
```

### API Calls with Error Handling

```javascript
try {
  const data = await AdminShared.api('/api/admin/users', 'GET');
  renderTable(data.items);
} catch (err) {
  AdminShared.showToast(err.message, 'error');
  console.error('Failed to load users:', err);
}
```

### Toast Notifications

```javascript
AdminShared.showToast('Operation successful!', 'success');
AdminShared.showToast('Something went wrong', 'error');
AdminShared.showToast('Please wait...', 'info');
AdminShared.showToast('Are you sure?', 'warning');
```

## Adding New Admin Pages

### 1. Create HTML File

```html
<!DOCTYPE html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page Title — EventFlow Admin</title>

    <!-- Required stylesheets -->
    <link rel="stylesheet" href="/assets/css/styles.css" />
    <link rel="stylesheet" href="/assets/css/eventflow-17.0.0.css" />
    <link rel="stylesheet" href="/assets/css/utilities.css" />
    <link rel="stylesheet" href="/assets/css/components.css" />
    <link rel="stylesheet" href="/assets/css/animations.css" />
    <link rel="stylesheet" href="/assets/css/admin.css" />
    <link rel="stylesheet" href="/assets/css/admin-enhanced.css" />
    <link rel="icon" href="/favicon.svg" />
  </head>
  <body>
    <!-- Include standard sidebar -->
    <aside class="admin-sidebar" id="adminSidebar">
      <!-- Copy sidebar structure from admin.html -->
    </aside>

    <main class="section">
      <!-- Dashboard Header -->
      <div class="dashboard-header">
        <div class="header-content">
          <div>
            <h1 class="dashboard-title">Page Title</h1>
            <p class="dashboard-subtitle">Page description</p>
          </div>
          <div class="header-actions">
            <!-- Action buttons -->
          </div>
        </div>
      </div>

      <!-- Page Content -->
      <div class="container">
        <!-- Your content here -->
      </div>
    </main>

    <!-- Required scripts -->
    <script src="/assets/js/admin-shared.js"></script>
    <script src="/assets/js/pages/your-page-init.js"></script>
  </body>
</html>
```

### 2. Create Initialization Script

```javascript
// /assets/js/pages/your-page-init.js
(function () {
  'use strict';

  async function init() {
    try {
      // Check authentication
      const response = await fetch('/api/auth/me');
      const data = await response.json();
      if (!data.user || data.user.role !== 'admin') {
        window.location.href = '/auth.html';
        return;
      }

      // Load your data
      await loadData();
    } catch (err) {
      console.error('Page init error:', err);
      AdminShared.showToast('Failed to load page', 'error');
    }
  }

  async function loadData() {
    const data = await AdminShared.api('/api/admin/your-endpoint');
    // Process and render data
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

### 3. Add Sidebar Link

Update the sidebar in all admin pages:

```html
<a href="/admin-your-page.html" class="admin-nav-link">
  <span class="nav-icon">★</span>
  <span class="nav-label">Your Page</span>
  <span class="nav-badge" id="yourPageCount"></span>
</a>
```

### 4. Add API Endpoint (if needed)

```javascript
// /routes/admin.js
router.get('/your-endpoint', authRequired, roleRequired('admin'), (req, res) => {
  // Your logic here
  res.json({ items: [] });
});
```

## Troubleshooting

### Sidebar Not Appearing

- Check that all required CSS files are loaded
- Verify sidebar HTML structure matches template
- Ensure `admin-shared.js` is loaded before page-specific scripts

### Badge Counts Not Updating

- Verify `/api/admin/badge-counts` endpoint is accessible
- Check browser console for API errors
- Ensure user has admin role

### API Calls Failing

- Check browser console for CSRF token errors
- Verify user is authenticated and has admin role
- Confirm endpoint exists in `/routes/admin.js`

### Inline Styles Breaking CSP

- Move all `<style>` blocks to CSS files
- Use classes from `admin.css` or `admin-enhanced.css`
- Never use inline `style=""` attributes

### Mobile Sidebar Not Toggling

- Ensure `sidebarToggle` button has correct ID
- Verify JavaScript is not throwing errors
- Check that `admin-shared.js` is loaded

## Best Practices

### 1. Always Use HTML Escaping

```javascript
// ✅ Good
td.innerHTML = AdminShared.escapeHtml(user.name);

// ❌ Bad - XSS vulnerability
td.innerHTML = user.name;
```

### 2. Handle Errors Gracefully

```javascript
try {
  await AdminShared.api('/api/admin/users', 'DELETE', { id });
  AdminShared.showToast('User deleted', 'success');
  await reload();
} catch (err) {
  AdminShared.showToast(err.message || 'Delete failed', 'error');
}
```

### 3. Confirm Destructive Actions

```javascript
if (!AdminShared.confirm('Are you sure you want to delete this user?')) {
  return;
}
// Proceed with deletion
```

### 4. Provide Loading States

```javascript
button.disabled = true;
button.textContent = 'Loading...';
try {
  await performAction();
} finally {
  button.disabled = false;
  button.textContent = 'Submit';
}
```

### 5. Use Semantic HTML

```html
<!-- ✅ Good -->
<button class="btn btn-primary">Submit</button>

<!-- ❌ Bad -->
<div onclick="submit()">Submit</div>
```

## Performance Considerations

### 1. Pagination

For large data sets, implement pagination:

```javascript
const PER_PAGE = 50;
let currentPage = 1;

function renderPage(page) {
  const start = (page - 1) * PER_PAGE;
  const end = start + PER_PAGE;
  const items = allItems.slice(start, end);
  renderTable(items);
}
```

### 2. Debounce Search

```javascript
let searchTimeout;
searchInput.addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    performSearch(e.target.value);
  }, 300);
});
```

### 3. Lazy Load Images

```html
<img src="..." loading="lazy" alt="..." />
```

## Accessibility

### 1. ARIA Labels

```html
<button aria-label="Toggle sidebar" aria-expanded="false">☰</button>
```

### 2. Keyboard Navigation

All interactive elements should be keyboard accessible:

```javascript
button.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    performAction();
  }
});
```

### 3. Focus Management

```javascript
// Return focus after modal close
modal.addEventListener('close', () => {
  triggerButton.focus();
});
```

## Bulk User Actions

The User Management page (`/admin-users.html`) supports bulk operations for efficiently managing multiple users at once.

### Features

1. **Selection**
   - Individual checkboxes on each user row
   - "Select All" checkbox in table header with indeterminate state support
   - Selected count display
   - Clear selection button

2. **Actions Available**
   - **Verify**: Bulk verify user email addresses
   - **Suspend**: Suspend multiple users with reason and optional duration
   - **Unsuspend**: Remove suspension from multiple users
   - **Delete**: Delete multiple users (with protections)
   - **Export**: Export selected users to CSV file

3. **Safety Features**
   - Confirmation dialogs before all destructive actions
   - Cannot delete/suspend own account
   - Cannot delete owner account
   - Progress indicators during processing
   - Success/error count summaries

### Usage Example

```javascript
// Select users using checkboxes
// 1. Check individual boxes or use "Select All"
// 2. Choose action from "Bulk Actions" dropdown
// 3. Click "Execute" button
// 4. Confirm in modal dialog
// 5. View progress and results

// Bulk Delete Implementation
async function bulkDeleteUsers(userIds) {
  const confirmed = await AdminShared.showConfirmModal({
    title: 'Delete Users',
    message: `Delete ${userIds.length} users? This cannot be undone.`,
    confirmText: 'Delete',
    type: 'danger',
  });

  if (!confirmed) return;

  let successCount = 0;
  for (const userId of userIds) {
    try {
      await AdminShared.adminFetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      });
      successCount++;
    } catch (error) {
      console.error(`Failed to delete ${userId}:`, error);
    }
  }

  AdminShared.showToast(`Deleted ${successCount} users successfully`, 'success');
  await loadAdminUsers(); // Refresh list
}
```

### API Endpoints for Bulk Operations

```javascript
// Bulk Verify
POST /api/admin/users/bulk-verify
Body: { userIds: string[] }
Response: { success, verifiedCount, alreadyVerifiedCount, totalRequested }

// Bulk Suspend
POST /api/admin/users/bulk-suspend
Body: { userIds: string[], suspended: boolean, reason: string, duration?: string }
Response: { success, updatedCount, totalRequested }

// Bulk Delete
POST /api/admin/users/bulk-delete
Body: { userIds: string[] }
Response: { success, deletedCount, totalRequested }
```

### CSV Export Format

Exported CSV includes these columns:

- Name
- Email
- Role
- Subscription
- Verified (Yes/No)
- Marketing Opt-In (Yes/No)
- Joined (ISO date)
- Last Login (ISO date)

## Testing Checklist

Before deploying admin changes:

- [ ] Test on Chrome, Firefox, Safari, and Edge
- [ ] Test responsive design at 320px, 768px, 1024px, and 1920px
- [ ] Verify all buttons and links work
- [ ] Test keyboard navigation
- [ ] Check for console errors
- [ ] Validate no CSP violations
- [ ] Test with screen reader (basic check)
- [ ] Verify CSRF protection on state-changing actions
- [ ] Test role-based access (try accessing as non-admin)
- [ ] Check audit log entries are created correctly

## Support

For questions or issues:

- Check console for errors
- Review audit logs for admin actions
- Consult API documentation in `/routes/admin.js`
- Review existing implementation in working pages

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Maintained By**: EventFlow Team
