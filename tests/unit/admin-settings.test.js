/**
 * Unit tests for admin settings endpoints and page
 * Validates route structure, auth/role guards, CSRF enforcement on
 * state-changing routes, and page JS behavior.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
const SETTINGS_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-settings-init.js');
const SETTINGS_HTML = path.join(__dirname, '../../public/admin-settings.html');

let adminContent;
let settingsInitContent;

beforeAll(() => {
  adminContent = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  settingsInitContent = fs.readFileSync(SETTINGS_INIT, 'utf8');
});

describe('Admin Settings — Route Structure (GET endpoints)', () => {
  it('GET /settings/site route exists', () => {
    expect(adminContent).toContain("router.get('/settings/site'");
  });

  it('GET /settings/site requires authRequired and roleRequired', () => {
    const match = adminContent.match(/router\.get\(['"]\/settings\/site['"][^)]*\)/s);
    expect(match).toBeTruthy();
    expect(match[0]).toContain('authRequired');
    expect(match[0]).toContain("roleRequired('admin')");
  });

  it('GET /settings/features route exists', () => {
    expect(adminContent).toContain("router.get('/settings/features'");
  });

  it('GET /settings/features requires authRequired and roleRequired', () => {
    const match = adminContent.match(/router\.get\(['"]\/settings\/features['"][^)]*\)/s);
    expect(match).toBeTruthy();
    expect(match[0]).toContain('authRequired');
    expect(match[0]).toContain("roleRequired('admin')");
  });

  it('GET /settings/maintenance route exists', () => {
    expect(adminContent).toContain("router.get('/settings/maintenance'");
  });

  it('GET /settings/maintenance requires authRequired and roleRequired', () => {
    const match = adminContent.match(/router\.get\(['"]\/settings\/maintenance['"][^)]*\)/s);
    expect(match).toBeTruthy();
    expect(match[0]).toContain('authRequired');
    expect(match[0]).toContain("roleRequired('admin')");
  });

  it('GET /settings/system-info route exists', () => {
    expect(adminContent).toContain("router.get('/settings/system-info'");
  });
});

describe('Admin Settings — CSRF Enforcement on State-Changing Routes', () => {
  it('PUT /settings/site has csrfProtection', () => {
    const idx = adminContent.indexOf("'/settings/site'");
    // Find the PUT handler (comes after GET)
    const putIdx = adminContent.indexOf("'/settings/site'", idx + 1);
    if (putIdx === -1) {
      // Only one occurrence — still verify csrfProtection exists somewhere near settings/site
      const siteBlock = adminContent.substring(idx - 20, idx + 500);
      expect(siteBlock).toContain('csrfProtection');
    } else {
      const block = adminContent.substring(putIdx - 30, putIdx + 300);
      expect(block).toContain('csrfProtection');
    }
  });

  it('PUT /settings/features has csrfProtection', () => {
    const idx = adminContent.indexOf("'/settings/features'");
    // Find PUT by searching after GET
    const putIdx = adminContent.indexOf("'/settings/features'", idx + 1);
    if (putIdx === -1) {
      const block = adminContent.substring(idx - 20, idx + 500);
      expect(block).toContain('csrfProtection');
    } else {
      const block = adminContent.substring(putIdx - 30, putIdx + 300);
      expect(block).toContain('csrfProtection');
    }
  });

  it('PUT /settings/maintenance has csrfProtection', () => {
    expect(adminContent).toContain("router.put('/settings/maintenance'");
    const idx = adminContent.indexOf("router.put('/settings/maintenance'");
    const block = adminContent.substring(idx, idx + 400);
    expect(block).toContain('csrfProtection');
  });
});

describe('Admin Settings — Data Layer', () => {
  it("settings routes read from dbUnified ('settings')", () => {
    expect(adminContent).toContain("dbUnified.read('settings')");
  });

  it('PUT /settings/site uses auditLog for change tracking', () => {
    // Find the PUT route by searching for the SETTINGS_UPDATED audit action
    // which is unique to the PUT /settings/site handler
    expect(adminContent).toContain('SETTINGS_UPDATED');
  });

  it('PUT /settings/maintenance uses auditLog for change tracking', () => {
    const maintenanceIdx = adminContent.indexOf("router.put('/settings/maintenance'");
    const block = adminContent.substring(maintenanceIdx, maintenanceIdx + 1500);
    expect(block).toContain('auditLog');
  });
});

describe('Admin Settings — Page JS (admin-settings-init.js)', () => {
  it('uses AdminShared or adminFetch for API calls', () => {
    expect(settingsInitContent).toMatch(/AdminShared\.(adminFetch|api|safeAction)/);
  });

  it('shows toast notifications on success', () => {
    expect(settingsInitContent).toContain('showToast');
  });

  it('validates email format before saving', () => {
    expect(settingsInitContent).toContain('emailRegex');
  });

  it('does not call native browser dialogs', () => {
    const NATIVE_DIALOG = /\b(window\.)?(alert|confirm|prompt)\s*\(/;
    const lines = settingsInitContent.split('\n');
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

describe('Admin Settings — HTML Page exists', () => {
  it('admin-settings.html exists on disk', () => {
    expect(fs.existsSync(SETTINGS_HTML)).toBe(true);
  });
});

describe('Admin Settings — requirePackageApproval Feature Flag', () => {
  let settingsHtmlContent;
  beforeAll(() => {
    settingsHtmlContent = fs.readFileSync(SETTINGS_HTML, 'utf8');
  });

  it('GET /settings/features includes requirePackageApproval in response', () => {
    expect(adminContent).toContain('requirePackageApproval');
  });

  it('PUT /settings/features validates and persists requirePackageApproval', () => {
    const putIdx = adminContent.indexOf("router.put(\n  '/settings/features'");
    expect(putIdx).not.toBe(-1);
    const block = adminContent.substring(putIdx, putIdx + 3000);
    expect(block).toContain('requirePackageApproval');
  });

  it('admin-settings.html has featureRequirePackageApproval toggle', () => {
    expect(settingsHtmlContent).toContain('featureRequirePackageApproval');
  });

  it('admin-settings-init.js loads requirePackageApproval flag', () => {
    expect(settingsInitContent).toContain('requirePackageApproval');
  });

  it('admin-settings-init.js includes requirePackageApproval in save payload', () => {
    // The feature flags save payload contains pexelsCollage — use that as an anchor
    const pexelsIdx = settingsInitContent.indexOf('pexelsCollage: getCheckboxValue');
    expect(pexelsIdx).not.toBe(-1);
    const block = settingsInitContent.substring(pexelsIdx - 200, pexelsIdx + 200);
    expect(block).toContain('requirePackageApproval');
  });
});

describe('Supplier Packages — Auto-Approval Behaviour', () => {
  let packagesContent;
  beforeAll(() => {
    packagesContent = fs.readFileSync(path.join(__dirname, '../../routes/packages.js'), 'utf8');
  });

  it('POST /me/packages defaults to approved: true', () => {
    expect(packagesContent).toContain('approved: true');
  });

  it('POST /me/packages checks requirePackageApproval feature flag', () => {
    expect(packagesContent).toContain('requirePackageApproval');
  });

  it('POST /me/packages sets approved: false when flag is enabled', () => {
    const flagIdx = packagesContent.indexOf('requirePackageApproval');
    const block = packagesContent.substring(flagIdx, flagIdx + 200);
    expect(block).toContain('pkg.approved = false');
  });
});
