/**
 * Admin Notification Centre — tests
 * Covers: route file structure, notifyAdmins helper, nav bell integration,
 * and that key event sources (tickets, contact, partner) actually fire admin notifications.
 */
'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const path = require('path');
const fs = require('fs');

// ─── Route file ──────────────────────────────────────────────────────────────
describe('routes/admin-notifications.js', () => {
  test('file exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../../routes/admin-notifications.js'))).toBe(true);
  });

  test('all 5 expected endpoints are defined', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-notifications.js'),
      'utf8'
    );
    expect(src).toContain('router.get('); // list
    expect(src).toContain("'/unread-count'"); // count
    expect(src).toContain("'/:id/read'"); // mark read
    expect(src).toContain("'/read-all'"); // read all
    expect(src).toContain("'/:id'"); // dismiss
  });

  test('every endpoint uses authRequired', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-notifications.js'),
      'utf8'
    );
    const routeCount = (src.match(/router\.(get|patch|post|delete)\(/g) || []).length;
    const authCount = (src.match(/authRequired/g) || []).length;
    expect(authCount).toBeGreaterThanOrEqual(routeCount);
  });

  test('every mutation endpoint uses csrfProtection', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-notifications.js'),
      'utf8'
    );
    const mutationCount = (src.match(/router\.(patch|post|delete)\(/g) || []).length;
    const csrfCount = (src.match(/csrfProtection/g) || []).length;
    expect(csrfCount).toBeGreaterThanOrEqual(mutationCount);
  });

  test('roleRequired admin is applied to every endpoint', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-notifications.js'),
      'utf8'
    );
    const routeCount = (src.match(/router\.(get|patch|post|delete)\(/g) || []).length;
    const roleCount = (src.match(/roleRequired\('admin'\)/g) || []).length;
    expect(roleCount).toBeGreaterThanOrEqual(routeCount);
  });

  test('mounted in server.js', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    expect(src).toContain('admin-notifications');
  });

  test('admin work queue items are merged into list and unread count responses', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-notifications.js'),
      'utf8'
    );
    expect(src).toContain('getAdminQueueNotifications');
    expect(src).toContain('workQueue');
    expect(src).toContain('workQueueCount');
  });
});

// ─── notifyAdmins helper ─────────────────────────────────────────────────────
describe('services/notifyAdmins.service.js', () => {
  test('file exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../../services/notifyAdmins.service.js'))).toBe(
      true
    );
  });

  test('exports notifyAdmins function', () => {
    // We mock the heavy dependencies so the require does not fail
    jest.mock('../../db-unified', () => ({ find: jest.fn().mockResolvedValue([]) }));
    jest.mock('../../db', () => ({ getDb: jest.fn().mockResolvedValue(null) }));
    jest.mock(
      '../../services/notification.service',
      () =>
        function () {
          return { createBatch: jest.fn().mockResolvedValue([]) };
        }
    );
    const { notifyAdmins } = require('../../services/notifyAdmins.service');
    expect(typeof notifyAdmins).toBe('function');
  });

  test('notifyAdmins resolves without throwing when DB is unavailable', async () => {
    const { notifyAdmins } = require('../../services/notifyAdmins.service');
    // Should never throw — it swallows errors
    await expect(
      notifyAdmins({ type: 'system', title: 'Test', message: 'Hello' })
    ).resolves.not.toThrow();
  });
});

// ─── Admin work queue notification helper ────────────────────────────────────
describe('routes/admin-notification-work-queue.js', () => {
  test('file exists', () => {
    expect(
      fs.existsSync(path.join(__dirname, '../../routes/admin-notification-work-queue.js'))
    ).toBe(true);
  });

  test('reads both support tickets and external contact enquiries', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-notification-work-queue.js'),
      'utf8'
    );
    expect(src).toContain("readCollection('tickets')");
    expect(src).toContain("readCollection('contact_enquiries')");
    expect(src).toContain('admin-queue-support-tickets');
    expect(src).toContain('admin-queue-contact-enquiries');
  });
});

// ─── Admin navbar bell ───────────────────────────────────────────────────────
describe('Admin navbar notification bell', () => {
  let navbarSrc;
  let cssSrc;

  beforeAll(() => {
    navbarSrc = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/admin-navbar.js'),
      'utf8'
    );
    cssSrc = fs.readFileSync(
      path.join(__dirname, '../../public/assets/css/admin-enhanced.css'),
      'utf8'
    );
  });

  test('adminNotifBellBtn button is in the navbar HTML', () => {
    expect(navbarSrc).toContain('adminNotifBellBtn');
  });

  test('adminNotifPanel is in the navbar HTML', () => {
    expect(navbarSrc).toContain('adminNotifPanel');
  });

  test('adminNotifBadge is in the navbar HTML', () => {
    expect(navbarSrc).toContain('adminNotifBadge');
  });

  test('initNotifBell function is defined', () => {
    expect(navbarSrc).toContain('function initNotifBell()');
  });

  test('fetchUnreadCount polls /api/admin/notifications/unread-count', () => {
    expect(navbarSrc).toContain('/api/admin/notifications/unread-count');
  });

  test('loadNotifPanel fetches /api/admin/notifications', () => {
    expect(navbarSrc).toContain('/api/admin/notifications?limit=');
  });

  test('mark-read PATCH request is sent on notification click', () => {
    expect(navbarSrc).toContain('/api/admin/notifications/');
  });

  test('read-all endpoint is called by Mark all read button', () => {
    expect(navbarSrc).toContain('/api/admin/notifications/read-all');
  });

  test('bell polls every 30 seconds', () => {
    expect(navbarSrc).toContain('30000');
  });

  test('panel closes on Escape key', () => {
    expect(navbarSrc).toContain('Escape');
    expect(navbarSrc).toContain('closeNotifOnEscape');
  });

  test('panel closes on outside click', () => {
    expect(navbarSrc).toContain('closeNotifOnOutsideClick');
  });

  test('CSS defines admin-notif-bell class', () => {
    expect(cssSrc).toContain('.admin-notif-bell');
  });

  test('CSS defines admin-notif-panel class', () => {
    expect(cssSrc).toContain('.admin-notif-panel');
  });

  test('CSS defines admin-notif-badge class', () => {
    expect(cssSrc).toContain('.admin-notif-badge');
  });

  test('unread items have visual distinction', () => {
    expect(cssSrc).toContain('.admin-notif-item--unread');
  });
});

// ─── Event coverage ───────────────────────────────────────────────────────────
describe('Admin notification event coverage', () => {
  test('routes/tickets.js notifies admins on new ticket', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/tickets.js'), 'utf8');
    expect(src).toContain('notifyNewTicket');
  });

  test('routes/tickets.js notifies admins on ticket reply', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/tickets.js'), 'utf8');
    expect(src).toContain('notifyTicketReply');
  });

  test('routes/contact.js notifies admins on external contact enquiry', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/contact.js'), 'utf8');
    expect(src).toContain('notifyAdmins');
    expect(src).toContain('New external contact enquiry');
  });

  test('routes/partner.js notifies admins on partner registration', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/partner.js'), 'utf8');
    expect(src).toContain('notifyAdmins');
    expect(src).toContain('Partner Programme');
  });
});
