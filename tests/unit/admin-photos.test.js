/**
 * Unit tests for admin photos endpoints and page
 * Validates route structure, auth/role guards, CSRF enforcement,
 * and that the admin-photos JS page uses the shared API helper.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
const PHOTOS_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-photos-init.js');
const PHOTOS_HTML = path.join(__dirname, '../../public/admin-photos.html');

let adminContent;
let photosInitContent;

beforeAll(() => {
  adminContent = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  photosInitContent = fs.readFileSync(PHOTOS_INIT, 'utf8');
});

describe('Admin Photos — Route Structure', () => {
  it('GET /photos/pending route exists', () => {
    expect(adminContent).toContain("router.get('/photos/pending'");
  });

  it('GET /photos/pending requires authRequired', () => {
    const match = adminContent.match(/router\.get\(['"]\/photos\/pending['"][^)]*\)/s);
    expect(match).toBeTruthy();
    expect(match[0]).toContain('authRequired');
  });

  it("GET /photos/pending requires roleRequired('admin')", () => {
    const match = adminContent.match(/router\.get\(['"]\/photos\/pending['"][^)]*\)/s);
    expect(match).toBeTruthy();
    expect(match[0]).toContain("roleRequired('admin')");
  });

  it('POST /photos/:id/approve route exists with CSRF protection', () => {
    expect(adminContent).toContain("'/photos/:id/approve'");
    const idx = adminContent.indexOf("'/photos/:id/approve'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('authRequired');
    expect(block).toContain("roleRequired('admin')");
    expect(block).toContain('csrfProtection');
  });

  it('POST /photos/:id/reject route exists with CSRF protection', () => {
    expect(adminContent).toContain("'/photos/:id/reject'");
    const idx = adminContent.indexOf("'/photos/:id/reject'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('authRequired');
    expect(block).toContain('csrfProtection');
  });

  it('GET /photos/pending uses dbUnified.read for photos', () => {
    const pendingIdx = adminContent.indexOf("router.get('/photos/pending'");
    const pendingSection = adminContent.substring(pendingIdx, pendingIdx + 800);
    expect(pendingSection).toContain("dbUnified.read('photos')");
  });

  it('GET /photos/pending enriches with supplier information', () => {
    const pendingIdx = adminContent.indexOf("router.get('/photos/pending'");
    const pendingSection = adminContent.substring(pendingIdx, pendingIdx + 800);
    expect(pendingSection).toContain("dbUnified.read('suppliers')");
    expect(pendingSection).toContain('supplierName');
  });
});

describe('Admin Photos — Empty-State Handling', () => {
  it('pending photos response wraps in photos field', () => {
    const pendingIdx = adminContent.indexOf("router.get('/photos/pending'");
    const pendingSection = adminContent.substring(pendingIdx, pendingIdx + 800);
    expect(pendingSection).toContain('photos:');
  });

  it('photos filter handles empty pending list', () => {
    // pendingPhotos = photos.filter(p => p.status === 'pending')
    const pendingIdx = adminContent.indexOf("router.get('/photos/pending'");
    const pendingSection = adminContent.substring(pendingIdx, pendingIdx + 800);
    expect(pendingSection).toContain('.filter(');
    expect(pendingSection).toContain("status === 'pending'");
  });
});

describe('Admin Photos — Page JS (admin-photos-init.js)', () => {
  it('uses AdminShared for authentication', () => {
    expect(photosInitContent).toContain('AdminShared');
  });

  it('uses AdminShared.api or AdminShared.adminFetch for API calls', () => {
    expect(photosInitContent).toMatch(/AdminShared\.(api|adminFetch)/);
  });

  it('handles empty photos array (data.photos || [])', () => {
    expect(photosInitContent).toMatch(/data\.photos\s*\|\|/);
  });

  it('uses AdminShared.escapeHtml for XSS safety', () => {
    expect(photosInitContent).toContain('escapeHtml');
  });

  it('does not call native browser dialogs', () => {
    const NATIVE_DIALOG = /\b(window\.)?(alert|confirm|prompt)\s*\(/;
    const lines = photosInitContent.split('\n');
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

  it('shows toast on error instead of native alert', () => {
    expect(photosInitContent).toContain('showToast');
  });

  it('rejectPhoto function calls /reject endpoint (not /approve)', () => {
    // Critical bug fix: rejectPhoto must call the /reject endpoint, not /approve.
    // Calling /approve with {approved:false} was silently approving photos.
    const rejectFnStart = photosInitContent.indexOf('window.rejectPhoto');
    expect(rejectFnStart).toBeGreaterThan(-1);
    const rejectFnBody = photosInitContent.substring(rejectFnStart, rejectFnStart + 500);
    expect(rejectFnBody).toContain('/reject');
    expect(rejectFnBody).not.toContain('/approve');
  });

  it('batch reject uses /reject endpoint for each photo (not /approve)', () => {
    // batchRejectBtn must call /reject, not /approve with {approved:false}
    const batchRejectStart = photosInitContent.indexOf('batchRejectBtn.addEventListener');
    expect(batchRejectStart).toBeGreaterThan(-1);
    const batchBody = photosInitContent.substring(batchRejectStart, batchRejectStart + 600);
    expect(batchBody).toContain('/reject');
    expect(batchBody).not.toContain('/approve');
  });
});

describe('Admin Photos — HTML Page exists', () => {
  it('admin-photos.html exists on disk', () => {
    expect(fs.existsSync(PHOTOS_HTML)).toBe(true);
  });
});
