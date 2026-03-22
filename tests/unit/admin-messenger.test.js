/**
 * Unit tests for admin messenger/communication surfaces
 * Validates:
 * - admin-messenger.html page exists
 * - admin-messenger-init.js uses AdminShared, escapes HTML, and shows no native dialogs
 * - admin-messenger-view.html and admin-messenger-view-init.js exist (admin conversation viewer)
 * - admin-tickets.html page exists and admin-tickets-init.js follows safe patterns
 * - contact-enquiries routes in admin.js have proper auth/CSRF guards
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
const MESSENGER_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-messenger-init.js');
const MESSAGES_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-messages-init.js');
const VIEW_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-messenger-view-init.js');
const TICKETS_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-tickets-init.js');
const MESSENGER_HTML = path.join(__dirname, '../../public/admin-messenger.html');
const MESSENGER_VIEW_HTML = path.join(__dirname, '../../public/admin-messenger-view.html');
const TICKETS_HTML = path.join(__dirname, '../../public/admin-tickets.html');
const MESSENGER_V4_ROUTES = path.join(__dirname, '../../routes/messenger-v4.js');

let adminContent;
let messengerInitContent;
let messagesInitContent;
let viewInitContent;
let ticketsInitContent;
let messengerV4RoutesContent;

beforeAll(() => {
  adminContent = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  messengerInitContent = fs.readFileSync(MESSENGER_INIT, 'utf8');
  messagesInitContent = fs.readFileSync(MESSAGES_INIT, 'utf8');
  viewInitContent = fs.readFileSync(VIEW_INIT, 'utf8');
  ticketsInitContent = fs.readFileSync(TICKETS_INIT, 'utf8');
  messengerV4RoutesContent = fs.readFileSync(MESSENGER_V4_ROUTES, 'utf8');
});

// ─── HTML pages exist ─────────────────────────────────────────────────────────

describe('Admin Messenger — HTML Pages Exist', () => {
  it('admin-messenger.html exists on disk', () => {
    expect(fs.existsSync(MESSENGER_HTML)).toBe(true);
  });

  it('admin-messenger-view.html exists on disk', () => {
    expect(fs.existsSync(MESSENGER_VIEW_HTML)).toBe(true);
  });

  it('admin-tickets.html exists on disk', () => {
    expect(fs.existsSync(TICKETS_HTML)).toBe(true);
  });
});

// ─── Messenger init JS ────────────────────────────────────────────────────────

describe('Admin Messenger Init (admin-messenger-init.js)', () => {
  it('uses AdminShared.api for fetching conversations', () => {
    expect(messengerInitContent).toContain('AdminShared.api');
  });

  it('uses AdminShared.escapeHtml for XSS safety', () => {
    expect(messengerInitContent).toContain('AdminShared.escapeHtml');
  });

  it('handles empty conversations array (data.conversations || [])', () => {
    expect(messengerInitContent).toMatch(/data\.conversations\s*\|\|/);
  });

  it('shows empty-state row when no conversations found', () => {
    expect(messengerInitContent).toContain('No conversations found');
  });

  it('shows error state when fetch fails (no native dialog)', () => {
    expect(messengerInitContent).toContain('Failed to load conversations');
    // Should NOT use native alert
    const NATIVE_DIALOG = /\b(window\.)?alert\s*\(/;
    expect(NATIVE_DIALOG.test(messengerInitContent)).toBe(false);
  });

  it('does not call native browser dialogs', () => {
    const NATIVE_DIALOG = /\b(window\.)?(alert|confirm|prompt)\s*\(/;
    const lines = messengerInitContent.split('\n');
    const violations = lines.filter(line => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        return false;
      }
      if (/_adminConfirm|_adminToast|AdminShared/.test(line)) {
        return false;
      }
      return NATIVE_DIALOG.test(line);
    });
    expect(violations).toEqual([]);
  });

  it('Open link navigates to admin viewer page, not /messenger/', () => {
    // The "Open" action must use /admin-messenger-view?conversation=<id>
    // so admins can view conversations they are not a participant of.
    expect(messengerInitContent).toContain('/admin-messenger-view?conversation=');
    expect(messengerInitContent).not.toContain('/messenger/?conversation=');
  });

  it('paginates conversations (uses PAGE_SIZE and skip)', () => {
    expect(messengerInitContent).toContain('PAGE_SIZE');
    expect(messengerInitContent).toContain('skip');
  });

  it('debounces/guards search button click', () => {
    expect(messengerInitContent).toContain("getElementById('searchBtn')");
    expect(messengerInitContent).toContain("addEventListener('click'");
  });
});

// ─── Contact-Enquiries routes (admin communication surface) ───────────────────

describe('Admin Contact Enquiries — Route Structure', () => {
  it('GET /contact-enquiries route exists', () => {
    expect(adminContent).toContain("router.get('/contact-enquiries'");
  });

  it('GET /contact-enquiries requires authRequired and roleRequired', () => {
    const match = adminContent.match(/router\.get\(['"]\/contact-enquiries['"][^)]*\)/s);
    expect(match).toBeTruthy();
    expect(match[0]).toContain('authRequired');
    expect(match[0]).toContain("roleRequired('admin')");
  });

  it('PUT /contact-enquiries/:id has csrfProtection', () => {
    expect(adminContent).toContain("'/contact-enquiries/:id'");
    const idx = adminContent.indexOf("'/contact-enquiries/:id'");
    const block = adminContent.substring(idx - 30, idx + 400);
    expect(block).toContain('authRequired');
    expect(block).toContain('csrfProtection');
  });

  it('POST /contact-enquiries/:id/reply has csrfProtection', () => {
    expect(adminContent).toContain("'/contact-enquiries/:id/reply'");
    const idx = adminContent.indexOf("'/contact-enquiries/:id/reply'");
    const block = adminContent.substring(idx - 30, idx + 400);
    expect(block).toContain('authRequired');
    expect(block).toContain('csrfProtection');
  });

  it('GET /contact-enquiries returns items array', () => {
    const idx = adminContent.indexOf("router.get('/contact-enquiries'");
    const section = adminContent.substring(idx, idx + 600);
    expect(section).toContain('items:');
  });

  it('PUT /contact-enquiries/:id validates status against allowed values', () => {
    expect(adminContent).toContain('CONTACT_ENQUIRY_STATUSES');
  });
});

// ─── Tickets admin surface ─────────────────────────────────────────────────────

describe('Admin Tickets — Route Structure', () => {
  it('GET /tickets route exists with auth guard', () => {
    expect(adminContent).toContain("router.get('/tickets'");
    const match = adminContent.match(/router\.get\(['"]\/tickets['"][^)]*\)/s);
    expect(match).toBeTruthy();
    expect(match[0]).toContain('authRequired');
    expect(match[0]).toContain("roleRequired('admin')");
  });

  it('POST /tickets/:id/reply has csrfProtection', () => {
    expect(adminContent).toContain("'/tickets/:id/reply'");
    const idx = adminContent.indexOf("'/tickets/:id/reply'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('csrfProtection');
  });
});

describe('Admin Tickets Init (admin-tickets-init.js)', () => {
  it('does not call native browser dialogs', () => {
    const NATIVE_DIALOG = /\b(window\.)?(alert|confirm|prompt)\s*\(/;
    const lines = ticketsInitContent.split('\n');
    const violations = lines.filter(line => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        return false;
      }
      if (/_adminConfirm|_adminToast|AdminShared/.test(line)) {
        return false;
      }
      return NATIVE_DIALOG.test(line);
    });
    expect(violations).toEqual([]);
  });
});

// ─── Admin Messenger View (read-only conversation viewer) ─────────────────────

describe('Admin Messenger View — HTML page', () => {
  it('loads admin-messenger-view-init.js', () => {
    const html = fs.readFileSync(MESSENGER_VIEW_HTML, 'utf8');
    expect(html).toContain('admin-messenger-view-init.js');
  });

  it('has noindex robots meta tag', () => {
    const html = fs.readFileSync(MESSENGER_VIEW_HTML, 'utf8');
    expect(html).toContain('noindex');
  });

  it('has a back link to /admin-messenger', () => {
    const html = fs.readFileSync(MESSENGER_VIEW_HTML, 'utf8');
    expect(html).toContain('/admin-messenger');
  });
});

describe('Admin Messenger View Init (admin-messenger-view-init.js)', () => {
  it('uses AdminShared.api for fetching data', () => {
    expect(viewInitContent).toContain('AdminShared.api');
  });

  it('uses AdminShared.escapeHtml for XSS safety', () => {
    expect(viewInitContent).toContain('AdminShared.escapeHtml');
  });

  it('calls the admin conversations/:id endpoint for metadata', () => {
    expect(viewInitContent).toContain('/api/v4/messenger/admin/conversations/');
  });

  it('calls the admin conversations/:id/messages endpoint for messages', () => {
    expect(viewInitContent).toContain('/messages');
  });

  it('does not call the mark-as-read endpoint', () => {
    expect(viewInitContent).not.toContain('/read');
  });

  it('does not call native browser dialogs', () => {
    const NATIVE_DIALOG = /\b(window\.)?(alert|confirm|prompt)\s*\(/;
    const lines = viewInitContent.split('\n');
    const violations = lines.filter(line => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        return false;
      }
      if (/_adminConfirm|_adminToast|AdminShared/.test(line)) {
        return false;
      }
      return NATIVE_DIALOG.test(line);
    });
    expect(violations).toEqual([]);
  });
});

// ─── admin-messages-init.js (inline admin panel "Open" link) ─────────────────

describe('Admin Messages Init (admin-messages-init.js)', () => {
  it('Open link uses /admin-messenger-view, not /messenger/', () => {
    expect(messagesInitContent).toContain('/admin-messenger-view?conversation=');
    expect(messagesInitContent).not.toContain('/messenger/?conversation=');
  });
});

// ─── Admin Pages middleware allowlist ─────────────────────────────────────────

describe('Admin Pages Middleware — allowlist', () => {
  // The middleware derives its allowlist dynamically from the admin registry.
  // Verify that admin-messenger-view is registered (which means it will be
  // included in the runtime allowlist) rather than checking for a hardcoded string.
  it('includes /admin-messenger-view', () => {
    const { getAdminPagesAllowlist } = require('../../config/adminRegistry');
    expect(getAdminPagesAllowlist()).toContain('/admin-messenger-view');
  });

  it('includes /admin-messenger-view.html', () => {
    const { getAdminPagesAllowlist } = require('../../config/adminRegistry');
    expect(getAdminPagesAllowlist()).toContain('/admin-messenger-view.html');
  });
});

// ─── Admin messenger v4 routes ────────────────────────────────────────────────

describe('Messenger v4 Routes — admin endpoints', () => {
  it('GET /admin/conversations/:id route exists', () => {
    expect(messengerV4RoutesContent).toContain("'/admin/conversations/:id'");
  });

  it('GET /admin/conversations/:id/messages route exists', () => {
    expect(messengerV4RoutesContent).toContain("'/admin/conversations/:id/messages'");
  });

  it('admin conversation route checks req.user.role === admin', () => {
    // Both routes must enforce the admin role check — count occurrences of the check
    const roleCheckCount = (
      messengerV4RoutesContent.match(/req\.user\.role\s*!==\s*['"]admin['"]/g) || []
    ).length;
    // Expect at least 2 (one for each of the two new admin routes)
    expect(roleCheckCount).toBeGreaterThanOrEqual(2);
  });

  it('admin routes validate ObjectId before calling service', () => {
    expect(messengerV4RoutesContent).toContain('isValidObjectId');
  });

  it('admin routes call getConversationAsAdmin', () => {
    expect(messengerV4RoutesContent).toContain('getConversationAsAdmin');
  });

  it('admin routes call getMessagesAsAdmin', () => {
    expect(messengerV4RoutesContent).toContain('getMessagesAsAdmin');
  });
});
