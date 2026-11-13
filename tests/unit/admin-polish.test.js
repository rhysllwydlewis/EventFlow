/**
 * Admin "polish and accessibility" pass: labels, keyboard access, readable text,
 * wrapping tables, the quieter demo-import tool and the styled sign-out dialog.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('form controls have names a screen reader can announce', () => {
  test('Payments filters', () => {
    const html = read('public/admin-analytics.html');
    expect(html).toMatch(/<select id="statusFilter"[^>]*aria-label="Filter by payment status"/);
    expect(html).toMatch(/<select id="planFilter"[^>]*aria-label="Filter by plan"/);
    expect(html).toMatch(/<select id="dateFilter"[^>]*aria-label="Filter by date range"/);
  });

  test('Reports filters', () => {
    const html = read('public/admin-moderation.html');
    expect(html).toMatch(/<select id="statusFilter"[^>]*aria-label="Filter by status"/);
    expect(html).toMatch(/<select id="typeFilter"[^>]*aria-label="Filter by type"/);
  });

  test('Marketplace category filter', () => {
    expect(read('public/admin-marketplace.html')).toMatch(
      /<select id="categoryFilter"[^>]*aria-label="Filter by category"/
    );
  });

  test('Homepage category checkboxes say which category they show', () => {
    expect(read('public/assets/js/pages/admin-homepage-rebuild.js')).toMatch(
      /<input type="checkbox" aria-label="Show \$\{escapeHtml\(category\.name\)\} on the homepage" data-category-visible=/
    );
  });

  test('Homepage hero image upload inputs say which category they are for', () => {
    expect(read('public/assets/js/pages/admin-homepage-rebuild.js')).toContain(
      'aria-label="Upload a hero image for ${escapeHtml(category.name)}" data-hero-upload='
    );
  });

  test('the Settings audit log scroll box can be reached by keyboard', () => {
    expect(read('public/admin-settings.html')).toMatch(
      /id="auditLogContainer"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Recent audit log"/
    );
  });
});

describe('Settings audit log shows plain text, not raw JSON', () => {
  const source = read('public/assets/js/pages/admin-settings-init.js');

  test('uses the plain-text describer', () => {
    expect(source).toContain('function describeAuditDetails(details)');
    expect(source).toContain('describeAuditDetails(log.details)');
    expect(source).not.toContain('JSON.stringify(log.details)');
  });

  test('describer turns keys into readable labels', () => {
    const start = source.indexOf('function describeAuditDetails');
    const end = source.indexOf('// Load audit logs');
    // eslint-disable-next-line no-new-func
    const describe = new Function(`${source.slice(start, end)}; return describeAuditDetails;`)();
    expect(describe(null)).toBe('');
    expect(describe({ maintenanceMode: true, reason_text: 'upgrade' })).toBe(
      'maintenance mode: true, reason text: upgrade'
    );
    expect(describe('plain')).toBe('plain');
  });
});

describe('Users list', () => {
  test('a name made only of spaces falls back to "(no name)"', () => {
    const source = read('public/assets/js/pages/admin-users-init.js');
    expect(source).toContain("const displayName = String(user.name || '').trim() || '(no name)';");
    expect(source).not.toContain("esc(user.name || '(no name)')");
  });
});

describe('Sign out', () => {
  test('uses the styled dialog and never the browser pop-up', () => {
    const source = read('public/assets/js/admin-navbar.js');
    expect(source).toContain('shared.showConfirmModal({');
    expect(source).toContain("title: 'Sign out'");
    expect(source).not.toMatch(/\bconfirm\(['"]Are you sure you want to sign out/);
  });
});

describe('leftover code for removed buttons is gone', () => {
  test('dashboard script no longer handles bulk supplier/package buttons or smart tagging', () => {
    const source = read('public/assets/js/pages/admin-init.js');
    for (const id of [
      'setupBulkOperations',
      'bulkApproveSuppliers',
      'bulkDeletePackages',
      'smartTagSuppliersBtn',
    ]) {
      expect(source).not.toContain(id);
    }
  });

  test('Marketplace has no sign-out handler for a button that is not there', () => {
    expect(read('public/assets/js/pages/admin-marketplace-init.js')).not.toContain('signoutBtn');
    expect(read('public/admin-marketplace.html')).not.toContain('signoutBtn');
  });
});

describe('Suppliers page', () => {
  const html = read('public/admin-suppliers.html');

  test('demo import sits in a collapsed "Developer tools" area, not the main toolbar', () => {
    const toolbar = html.slice(
      html.indexOf('<div class="button-group">'),
      html.indexOf('</div>', html.indexOf('<div class="button-group">'))
    );
    expect(toolbar).not.toContain('importDemoSuppliersBtn');
    expect(toolbar).toContain('exportSuppliersBtn');
    expect(html).toMatch(/<details class="dev-tools[^"]*">\s*<summary>Developer tools<\/summary>/);
    expect(html).toContain('id="importDemoSuppliersBtn"');
  });

  test('the import handler is still wired up', () => {
    const source = read('public/assets/js/pages/admin-suppliers-init.js');
    expect(source).toContain("getElementById('importDemoSuppliersBtn')");
  });

  test('long names and emails wrap instead of stretching the table', () => {
    const source = read('public/assets/js/pages/admin-suppliers-init.js');
    expect(source).toContain('class="col-wrap"');
    expect(read('public/assets/css/admin-workspace.css')).toMatch(
      /td\.col-wrap \{[^}]*overflow-wrap: anywhere/
    );
  });
});

describe('Reports table', () => {
  const source = read('public/assets/js/pages/admin-reports-init.js');

  test('keeps the Actions column pinned and wraps long text', () => {
    expect(source).toContain('table-wrapper table-wrapper--sticky-actions');
    expect(source).toContain('class="col-wrap"');
  });
});

describe('supplier detail help text uses plain words', () => {
  test('no "null =" developer wording', () => {
    const source = read('public/assets/js/pages/admin-supplier-detail-init.js');
    expect(source).not.toContain('<strong>null</strong>');
    expect(source).toContain('<strong>Auto</strong>');
  });
});

describe('Community page title', () => {
  test('both /admin/community and /admin-community are served with a title', () => {
    expect(read('routes/community-pages.js')).toMatch(
      /router\.get\(\['\/admin\/community', '\/admin-community'\]/
    );
  });
});

describe('text colours that were too faint to read are darker', () => {
  const FAINT = ['#9ca3af', '#94a3b8', '#888888'];

  test('no admin page script or stylesheet sets text in the faintest greys', () => {
    const files = [
      'public/assets/js/pages/admin-partners-init.js',
      'public/assets/js/pages/admin-suppliers-init.js',
      'public/assets/css/admin-cards.css',
      'public/assets/css/admin-supplier-detail.css',
    ];
    for (const file of files) {
      const source = read(file);
      for (const colour of FAINT) {
        expect(source).not.toMatch(new RegExp(`(?<![-\\w])color:\\s*${colour}\\b`, 'i'));
      }
    }
  });

  test('Photos Approve and Reject buttons pass the 4.5:1 contrast needed with white text', () => {
    const css = read('public/assets/css/admin-enhanced.css');
    expect(css).toMatch(/\.photo-queue__btn--approve\s*\{[^}]*background:\s*#15803d/);
    expect(css).toMatch(/\.photo-queue__btn--reject\s*\{[^}]*background:\s*#dc2626/);
  });
});
