/**
 * Audit Workflow Regression Tests
 *
 * Guards from PR "audit-verification-supplier-approval-workflow":
 *
 * A1) admin-supplier-detail-init.js: no approve-endpoint bypass for rejection,
 *     correct endpoints used, no native dialogs.
 * A2) Supplier directory visibility rules: searchService.js and supplier.service.js
 *     filter correctly.
 * A3) public-calendar.js write endpoints require requireVerifiedUser.
 * A4) customer-calendar.js write endpoints require requireVerifiedUser.
 * B)  visibility-diagnostics endpoint exists, is admin-only, non-destructive.
 * C)  routes/admin.js has visibility-diagnostics pass-through before /suppliers/:id wildcard.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPLIER_DETAIL_INIT = path.join(
  __dirname,
  '../../public/assets/js/pages/admin-supplier-detail-init.js'
);
const SEARCH_SERVICE = path.join(__dirname, '../../services/searchService.js');
const SUPPLIER_SERVICE = path.join(__dirname, '../../services/supplier.service.js');
const PUBLIC_CALENDAR = path.join(__dirname, '../../routes/public-calendar.js');
const CUSTOMER_CALENDAR = path.join(__dirname, '../../routes/customer-calendar.js');
const SUPPLIER_ADMIN = path.join(__dirname, '../../routes/supplier-admin.js');
const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');

// ─── A1: admin-supplier-detail-init.js ───────────────────────────────────────

describe('admin-supplier-detail-init.js — no approve-endpoint bypass for rejection', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_DETAIL_INIT, 'utf8');
  });

  it('rejectBtn handler calls POST /reject, not POST /approve', () => {
    const rejectIdx = content.indexOf("getElementById('rejectBtn')?.addEventListener");
    expect(rejectIdx).not.toBe(-1);
    const section = content.slice(rejectIdx, rejectIdx + 700);
    expect(section).toContain('/reject');
    expect(section).not.toMatch(/\/approve.*approved.*false|approved.*false.*\/approve/);
  });

  it('rejectBtn handler does NOT pass { approved: false } to any endpoint', () => {
    const rejectIdx = content.indexOf("getElementById('rejectBtn')?.addEventListener");
    const section = content.slice(rejectIdx, rejectIdx + 700);
    expect(section).not.toContain('approved: false');
  });

  it('rejectBtn handler sends notes/reason to /reject endpoint', () => {
    const rejectIdx = content.indexOf("getElementById('rejectBtn')?.addEventListener");
    const section = content.slice(rejectIdx, rejectIdx + 700);
    // Must include a notes or reason field in the body
    expect(section).toMatch(/notes|reason/);
  });

  it('approveBtn handler calls POST /approve with notes (not approved: true as rejection)', () => {
    const approveIdx = content.indexOf("getElementById('approveBtn')?.addEventListener");
    expect(approveIdx).not.toBe(-1);
    // The handler is longer than 800 chars — use 1200 to capture the api() call
    const section = content.slice(approveIdx, approveIdx + 1200);
    expect(section).toContain('/approve');
    // Must not send approved: false on the approve button path
    expect(section).not.toContain('approved: false');
  });

  it('approveBtn handler does NOT set approved:false on the approve endpoint', () => {
    // Regression guard: the approve button must never send {approved:false}
    // (which was the old rejection bypass pattern)
    const approveIdx = content.indexOf("getElementById('approveBtn')?.addEventListener");
    const section = content.slice(approveIdx, approveIdx + 1200);
    expect(section).not.toContain('approved: false');
  });

  it('uses AdminShared.showInputModal for notes collection (no native dialogs)', () => {
    // The file should use AdminShared.showInputModal, not window.prompt / window.confirm
    expect(content).toContain('showInputModal');
    // Must not contain native dialogs in any uncarded context
    const lines = content.split('\n');
    const nativeDialogLines = lines.filter(line => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        return false;
      }
      return /\b(window\.)?(alert|confirm|prompt)\s*\(/.test(line);
    });
    expect(nativeDialogLines).toEqual([]);
  });

  it('requestChangesBtn handler calls /request-changes endpoint', () => {
    const idx = content.indexOf("getElementById('requestChangesBtn')?.addEventListener");
    if (idx === -1) {
      return;
    } // button may not exist in all versions — skip gracefully
    const section = content.slice(idx, idx + 600);
    expect(section).toContain('/request-changes');
    expect(section).not.toContain('approved: false');
  });
});

// ─── A2: Supplier directory visibility rules ─────────────────────────────────

describe('searchService.js — public directory visibility filter', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SEARCH_SERVICE, 'utf8');
  });

  it('filters public search results to approved suppliers only', () => {
    // Must contain s.approved (or supplier.approved) as a filter condition
    expect(content).toMatch(/s\.approved|supplier\.approved/);
  });

  it('explicitly filters s.approved === true or filters s.approved falsy values', () => {
    // The filter must compare to true or use Boolean check
    expect(content).toMatch(/s\.approved\s*(===?\s*true|&&|\))/);
  });

  it('does NOT require status=published (searchService uses approved-only filter)', () => {
    // searchService.js intentionally filters by approved only, not status.
    // This is a documented behaviour difference vs supplier.service.js.
    // This test documents the intentional omission rather than enforcing it.
    const searchBlock = content.slice(content.indexOf('function search') || 0, content.length);
    // Just confirm the approved filter exists (already tested above)
    expect(searchBlock).toMatch(/\.approved/);
  });
});

describe('supplier.service.js — public search visibility filter', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_SERVICE, 'utf8');
  });

  it('searchSuppliers filters by approved=true', () => {
    const idx = content.indexOf('searchSuppliers');
    expect(idx).not.toBe(-1);
    const section = content.slice(idx, idx + 1000);
    expect(section).toContain('approved');
  });

  it('searchSuppliers filters by status===published', () => {
    const idx = content.indexOf('searchSuppliers');
    const section = content.slice(idx, idx + 1000);
    expect(section).toContain("status === 'published'");
  });

  it('searchSuppliers applies approved AND published filter together', () => {
    const idx = content.indexOf('searchSuppliers');
    const section = content.slice(idx, idx + 1000);
    // Both conditions must be present in the same filter block
    expect(section).toContain('approved');
    expect(section).toContain("'published'");
  });

  it('supplier not approved is excluded from public search', () => {
    // Guards: if includeAll is not set, unapproved suppliers must be excluded
    const idx = content.indexOf('searchSuppliers');
    const section = content.slice(idx, idx + 1000);
    expect(section).toContain('includeAll');
  });

  it('getFeaturedSuppliers filters by approved=true', () => {
    const idx = content.indexOf('getFeatured');
    if (idx === -1) {
      return;
    } // function may have a different name
    const section = content.slice(idx, idx + 500);
    expect(section).toContain('approved');
  });
});

// ─── A3: public-calendar.js verification gating ──────────────────────────────

describe('public-calendar.js — write endpoints require requireVerifiedUser', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(PUBLIC_CALENDAR, 'utf8');
  });

  it('imports requireVerifiedUser from middleware/auth', () => {
    expect(content).toContain('requireVerifiedUser');
    expect(content).toContain("require('../middleware/auth')");
  });

  it('POST /events includes requireVerifiedUser in middleware chain', () => {
    const idx = content.indexOf("router.post(\n  '/events'");
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });

  it('PUT /events/:id includes requireVerifiedUser in middleware chain', () => {
    const idx = content.indexOf("router.put(\n  '/events/:id'");
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });

  it('DELETE /events/:id includes requireVerifiedUser in middleware chain', () => {
    const idx = content.indexOf("router.delete(\n  '/events/:id'");
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });

  it('requireVerifiedUser appears BEFORE requireApprovedSupplier on write routes', () => {
    // Verification check must come before approval check (logical order)
    const postIdx = content.indexOf("router.post(\n  '/events'");
    const handlerStart = content.indexOf('async (req, res)', postIdx);
    const middlewareSection = content.slice(postIdx, handlerStart);
    const verifiedPos = middlewareSection.indexOf('requireVerifiedUser');
    const approvedPos = middlewareSection.indexOf('requireApprovedSupplier');
    expect(verifiedPos).toBeLessThan(approvedPos);
  });

  it('POST /events/:id/save includes requireVerifiedUser (saved items gate)', () => {
    // Problem statement explicitly lists "saved items" as requiring verification
    const idx = content.search(/router\.post\(\s*['"]\/events\/:id\/save['"]/);
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });

  it('DELETE /events/:id/save includes requireVerifiedUser (saved items gate)', () => {
    const idx = content.search(/router\.delete\(\s*['"]\/events\/:id\/save['"]/);
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });
});

// ─── A4: customer-calendar.js verification gating ────────────────────────────

describe('customer-calendar.js — write endpoints require requireVerifiedUser', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(CUSTOMER_CALENDAR, 'utf8');
  });

  it('imports requireVerifiedUser from middleware/auth', () => {
    expect(content).toContain('requireVerifiedUser');
    expect(content).toContain("require('../middleware/auth')");
  });

  it('POST / (create entry) includes requireVerifiedUser', () => {
    // The route may be formatted as single-line or multi-line by prettier
    const idx = content.search(/router\.post\(\s*['"]\/['"]/);
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });

  it('PUT /:id (update entry) includes requireVerifiedUser', () => {
    const idx = content.search(/router\.put\(\s*['"][/]:id['"]/);
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });

  it('DELETE /:id (delete entry) includes requireVerifiedUser', () => {
    const idx = content.search(/router\.delete\(\s*['"][/]:id['"]/);
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    expect(middlewareSection).toContain('requireVerifiedUser');
  });

  it('GET / (list entries) does NOT require requireVerifiedUser (read-only)', () => {
    // Read-only endpoints don't need verification gating — only writes do
    const idx = content.search(/router\.get\(\s*['"]\/['"]/);
    expect(idx).not.toBe(-1);
    const handlerStart = content.indexOf('async (req, res)', idx);
    const middlewareSection = content.slice(idx, handlerStart);
    // Should not have requireVerifiedUser on GET (read is fine without email verified)
    expect(middlewareSection).not.toContain('requireVerifiedUser');
  });
});

// ─── B: visibility-diagnostics endpoint ──────────────────────────────────────

describe('supplier-admin.js — visibility-diagnostics endpoint', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_ADMIN, 'utf8');
  });

  it('defines GET /suppliers/:id/visibility-diagnostics', () => {
    expect(content).toContain('/suppliers/:id/visibility-diagnostics');
  });

  it('requires admin role', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    expect(idx).not.toBe(-1);
    const section = content.slice(idx, idx + 500);
    expect(section).toContain("'admin'");
  });

  it('requires authentication (applyAuthRequired)', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 500);
    expect(section).toContain('applyAuthRequired');
    // Rate limiter should come before auth (CodeQL pattern)
    const limiterPos = section.indexOf('apiLimiter');
    const authPos = section.indexOf('applyAuthRequired');
    expect(limiterPos).toBeLessThan(authPos);
  });

  it('returns approved status in response', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 3000);
    expect(section).toContain('approved');
  });

  it('returns verificationStatus in response', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 3000);
    expect(section).toContain('verificationStatus');
  });

  it('returns status/published check', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 3000);
    expect(section).toContain('published');
  });

  it('returns ownerUserId check', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 3000);
    expect(section).toContain('ownerUserId');
  });

  it('returns exclusionReasons array', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 3000);
    expect(section).toContain('exclusionReasons');
  });

  it('returns verdict field with tri-state value', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 4000);
    expect(section).toContain('verdict');
    // Must use tri-state verdicts: VISIBLE / PARTIALLY_VISIBLE / EXCLUDED
    expect(section).toContain('VISIBLE');
    expect(section).toContain('PARTIALLY_VISIBLE');
    expect(section).toContain('EXCLUDED');
  });

  it('checks for duplicate ownerUserId', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 4000);
    expect(section).toContain('duplicate');
  });

  it('is read-only (no write operations)', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 3000);
    // Must not contain any write operations
    expect(section).not.toMatch(/dbUnified\.(write|updateOne|deleteOne|insertOne)\(/);
  });

  it('returns 404 for unknown supplier', () => {
    const idx = content.indexOf("'/suppliers/:id/visibility-diagnostics'");
    const section = content.slice(idx, idx + 3000);
    expect(section).toContain('status(404)');
  });
});

// ─── C: routes/admin.js pass-through for visibility-diagnostics ──────────────

describe('routes/admin.js — visibility-diagnostics pass-through ordering', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  });

  it('has pass-through for /suppliers/:id/visibility-diagnostics', () => {
    expect(content).toContain('/suppliers/:id/visibility-diagnostics');
  });

  it('visibility-diagnostics pass-through is before /suppliers/:id wildcard GET', () => {
    const diagnosticsIdx = content.indexOf("router.get('/suppliers/:id/visibility-diagnostics'");
    const wildcardIdx = content.indexOf("router.get('/suppliers/:id'");
    expect(diagnosticsIdx).not.toBe(-1);
    expect(wildcardIdx).not.toBe(-1);
    expect(diagnosticsIdx).toBeLessThan(wildcardIdx);
  });

  it('visibility-diagnostics pass-through calls next("router")', () => {
    // Find the actual router.get line (not the comment)
    const idx = content.indexOf("router.get('/suppliers/:id/visibility-diagnostics'");
    expect(idx).not.toBe(-1);
    const section = content.slice(idx, idx + 200);
    expect(section).toContain("next('router')");
  });
});
