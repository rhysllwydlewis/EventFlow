/**
 * Unit tests for supplier manual approval feature
 *
 * Verifies that:
 *   - New supplier profiles always default to approved: false
 *   - PATCH route does NOT modify approved field (profile edits preserve approval)
 *   - Auto-approve at creation respects settings.features.autoApproveSupplierVerification
 *   - requireApprovedSupplier middleware blocks unapproved suppliers with SUPPLIER_NOT_APPROVED
 *   - requireApprovedSupplier middleware passes through for approved suppliers
 *   - requireApprovedSupplier middleware is applied to package write routes
 *   - Messaging write routes are gated with requireApprovedSupplier
 *   - Calendar write routes are gated with requireApprovedSupplier
 *   - Admin approve endpoint sets approved: true
 *   - Public search/directory only includes approved suppliers
 *   - Verification request endpoint creates support ticket and prevents duplicates
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPLIER_SERVICE = path.join(__dirname, '../../services/supplier.service.js');
const AUTH_MIDDLEWARE = path.join(__dirname, '../../middleware/auth.js');
const PACKAGES_ROUTES = path.join(__dirname, '../../routes/packages.js');
const SUPPLIER_ADMIN_ROUTES = path.join(__dirname, '../../routes/supplier-admin.js');
const SUPPLIER_MANAGEMENT = path.join(__dirname, '../../routes/supplier-management.js');
const MESSENGER_V4_ROUTES = path.join(__dirname, '../../routes/messenger-v4.js');
const PUBLIC_CALENDAR_ROUTES = path.join(__dirname, '../../routes/public-calendar.js');

// ─── A) Default approved: false on creation ────────────────────────────────

describe('supplier.service.js — createSupplier defaults', () => {
  it('explicitly sets approved: false on new supplier profile creation', () => {
    const content = fs.readFileSync(SUPPLIER_SERVICE, 'utf8');
    // Should contain approved: false in the creation block (Admin approval section)
    expect(content).toContain('approved: false,');
  });

  it('sets approved in the Admin approval section (not user-modifiable block)', () => {
    const content = fs.readFileSync(SUPPLIER_SERVICE, 'utf8');
    const approvalSection = content.slice(content.indexOf('// Admin approval'));
    // approved: false must appear in this section
    expect(approvalSection.slice(0, 200)).toContain('approved: false,');
  });
});

describe('supplier-management.js — createSupplier defaults', () => {
  it('sets approved: false on inline supplier profile creation', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    expect(content).toContain('approved: false,');
  });

  it('checks autoApproveSupplierVerification setting and sets approved: true when ON', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    expect(content).toContain('autoApproveSupplierVerification');
    expect(content).toContain('s.approved = true');
    expect(content).toContain('s.approvedAt');
    expect(content).toContain("s.approvedBy = 'system'");
  });
});

// ─── A2) PATCH must not touch approved ────────────────────────────────────────

describe('supplier-management.js — PATCH must not revoke approval', () => {
  it('does NOT assign approved in the PATCH route body', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    // Find the PATCH handler block
    const patchStart = content.indexOf('PATCH /api/me/suppliers/:id');
    const patchSection = content.slice(patchStart, patchStart + 2000);
    // Should not contain unconditional supplierPatch.approved = false
    expect(patchSection).not.toContain('supplierPatch.approved = false');
  });

  it('has a comment noting that approved must not be touched on edit', () => {
    const content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
    expect(content).toContain('must never revoke approval');
  });
});

// ─── B) requireApprovedSupplier middleware ──────────────────────────────────

describe('middleware/auth.js — requireApprovedSupplier', () => {
  it('exports requireApprovedSupplier function', () => {
    const content = fs.readFileSync(AUTH_MIDDLEWARE, 'utf8');
    expect(content).toContain('requireApprovedSupplier');
    expect(content).toContain('module.exports');
  });

  it('returns 403 with SUPPLIER_NOT_APPROVED code for unapproved suppliers', () => {
    const content = fs.readFileSync(AUTH_MIDDLEWARE, 'utf8');
    expect(content).toContain('SUPPLIER_NOT_APPROVED');
    expect(content).toContain('status(403)');
  });

  it('only enforces approval for supplier-role users', () => {
    const content = fs.readFileSync(AUTH_MIDDLEWARE, 'utf8');
    // Should short-circuit (call next()) for non-supplier roles
    const middlewareSection = content.slice(
      content.indexOf('async function requireApprovedSupplier')
    );
    expect(middlewareSection.slice(0, 600)).toContain("req.user.role !== 'supplier'");
    expect(middlewareSection.slice(0, 600)).toContain('return next()');
  });

  it('checks approved === true on the supplier profile document', () => {
    const content = fs.readFileSync(AUTH_MIDDLEWARE, 'utf8');
    const middlewareSection = content.slice(
      content.indexOf('async function requireApprovedSupplier')
    );
    expect(middlewareSection.slice(0, 1000)).toContain('approved !== true');
  });

  it('returns 403 when supplier profile is not found', () => {
    const content = fs.readFileSync(AUTH_MIDDLEWARE, 'utf8');
    const middlewareSection = content.slice(
      content.indexOf('async function requireApprovedSupplier')
    );
    expect(middlewareSection.slice(0, 1000)).toContain('!supplier');
  });
});

// ─── B) requireApprovedSupplier runtime behaviour ──────────────────────────

describe('requireApprovedSupplier middleware — runtime behaviour', () => {
  const mockFindOne = jest.fn();

  jest.mock('../../db-unified', () => ({
    findOne: mockFindOne,
  }));

  // Reimport auth middleware after mock is registered
  let requireApprovedSupplier;
  beforeAll(() => {
    ({ requireApprovedSupplier } = require('../../middleware/auth'));
  });

  let req, res, next;
  beforeEach(() => {
    req = {
      user: { id: 'user-1', email: 'test@example.com', role: 'supplier' },
      path: '/test',
      method: 'POST',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    mockFindOne.mockReset();
  });

  it('calls next() for an approved supplier', async () => {
    mockFindOne.mockResolvedValue({ id: 'sup-1', ownerUserId: 'user-1', approved: true });
    await requireApprovedSupplier(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 SUPPLIER_NOT_APPROVED for unapproved supplier', async () => {
    mockFindOne.mockResolvedValue({ id: 'sup-1', ownerUserId: 'user-1', approved: false });
    await requireApprovedSupplier(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SUPPLIER_NOT_APPROVED' })
    );
  });

  it('returns 403 SUPPLIER_NOT_APPROVED when approved field is missing', async () => {
    mockFindOne.mockResolvedValue({ id: 'sup-1', ownerUserId: 'user-1' });
    await requireApprovedSupplier(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SUPPLIER_NOT_APPROVED' })
    );
  });

  it('returns 403 when supplier profile is not found', async () => {
    mockFindOne.mockResolvedValue(null);
    await requireApprovedSupplier(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SUPPLIER_NOT_APPROVED' })
    );
  });

  it('calls next() for non-supplier users (no profile check needed)', async () => {
    req.user.role = 'customer';
    await requireApprovedSupplier(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it('calls next() for admin users (no profile check needed)', async () => {
    req.user.role = 'admin';
    await requireApprovedSupplier(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user is missing', async () => {
    req.user = undefined;
    await requireApprovedSupplier(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 503 when db throws an error', async () => {
    mockFindOne.mockRejectedValue(new Error('DB unavailable'));
    await requireApprovedSupplier(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

// ─── C) Approval gating on packages write routes ───────────────────────────

describe('packages.js — approval gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
  });

  it('declares requireApprovedSupplier as an injected dependency', () => {
    expect(content).toContain('let requireApprovedSupplier');
    expect(content).toContain("'requireApprovedSupplier'");
  });

  it('defines applyRequireApprovedSupplier deferred wrapper', () => {
    expect(content).toContain('function applyRequireApprovedSupplier');
  });

  it('requires approved supplier for package creation (POST /me/packages)', () => {
    const postSection = content.slice(content.indexOf("'/me/packages',\n  applyWriteLimiter"));
    expect(postSection.slice(0, 400)).toContain('applyRequireApprovedSupplier');
  });

  it('requires approved supplier for package update (PUT /me/packages/:id)', () => {
    const putIdx = content.indexOf('PUT /api/me/packages/:id\n * Update a package');
    const putSection = content.slice(putIdx, putIdx + 500);
    expect(putSection).toContain('applyRequireApprovedSupplier');
  });

  it('requires approved supplier for package deletion (DELETE /me/packages/:id)', () => {
    const deleteIdx = content.indexOf('DELETE /api/me/packages/:id');
    const deleteSection = content.slice(deleteIdx, deleteIdx + 500);
    expect(deleteSection).toContain('applyRequireApprovedSupplier');
  });

  it('requires approved supplier for package photo upload (POST /me/packages/:id/photos)', () => {
    const photoIdx = content.indexOf('POST /api/me/packages/:id/photos');
    const photoSection = content.slice(photoIdx, photoIdx + 500);
    expect(photoSection).toContain('applyRequireApprovedSupplier');
  });

  it('requires approved supplier for package photo delete (DELETE /me/packages/:id/photos)', () => {
    const photoDeleteIdx = content.indexOf('DELETE /api/me/packages/:id/photos');
    const photoDeleteSection = content.slice(photoDeleteIdx, photoDeleteIdx + 500);
    expect(photoDeleteSection).toContain('applyRequireApprovedSupplier');
  });

  it('requires approved supplier for package pause (PUT /me/packages/:id/pause)', () => {
    const pauseIdx = content.indexOf('PUT /api/me/packages/:id/pause');
    const pauseSection = content.slice(pauseIdx, pauseIdx + 500);
    expect(pauseSection).toContain('applyRequireApprovedSupplier');
  });

  it('requires approved supplier for package unpause (PUT /me/packages/:id/unpause)', () => {
    const unpauseIdx = content.indexOf('PUT /api/me/packages/:id/unpause');
    const unpauseSection = content.slice(unpauseIdx, unpauseIdx + 500);
    expect(unpauseSection).toContain('applyRequireApprovedSupplier');
  });

  it('requires approved supplier for gallery reorder (PUT /me/packages/:id/gallery/order)', () => {
    const galleryIdx = content.indexOf('PUT /api/me/packages/:id/gallery/order');
    const gallerySection = content.slice(galleryIdx, galleryIdx + 600);
    expect(gallerySection).toContain('applyRequireApprovedSupplier');
  });

  it('requires role=supplier for package photo upload (POST /me/packages/:id/photos)', () => {
    const photoIdx = content.indexOf('POST /api/me/packages/:id/photos');
    const photoSection = content.slice(photoIdx, photoIdx + 600);
    expect(photoSection).toContain("applyRoleRequired('supplier')");
  });

  it('requires role=supplier for package photo delete (DELETE /me/packages/:id/photos)', () => {
    const photoDeleteIdx = content.indexOf('DELETE /api/me/packages/:id/photos');
    const photoDeleteSection = content.slice(photoDeleteIdx, photoDeleteIdx + 600);
    expect(photoDeleteSection).toContain("applyRoleRequired('supplier')");
  });
});

// ─── C2) Approval gating on messenger write routes ─────────────────────────

describe('messenger-v4.js — approval gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(MESSENGER_V4_ROUTES, 'utf8');
  });

  it('accepts requireApprovedSupplier as injected dependency', () => {
    expect(content).toContain('requireApprovedSupplier');
  });

  it('defines applyRequireApprovedSupplier wrapper', () => {
    expect(content).toContain('function applyRequireApprovedSupplier');
  });

  it('gates POST /conversations with applyRequireApprovedSupplier', () => {
    // Find the route definition itself (the array of middleware), not the comment
    const routeIdx = content.indexOf("router.post(\n  '/conversations'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('applyRequireApprovedSupplier');
  });

  it('gates POST /conversations/:id/messages with applyRequireApprovedSupplier', () => {
    const routeIdx = content.indexOf("router.post(\n  '/conversations/:id/messages'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('applyRequireApprovedSupplier');
  });
});

// ─── C3) Approval gating on public calendar write routes ───────────────────

describe('public-calendar.js — approval gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(PUBLIC_CALENDAR_ROUTES, 'utf8');
  });

  it('imports requireApprovedSupplier from middleware/auth', () => {
    expect(content).toContain('requireApprovedSupplier');
  });

  it('gates POST /events with requireApprovedSupplier', () => {
    const routeIdx = content.indexOf("router.post(\n  '/events'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 250);
    expect(routeSection).toContain('requireApprovedSupplier');
  });

  it('gates PUT /events/:id with requireApprovedSupplier', () => {
    const routeIdx = content.indexOf("router.put(\n  '/events/:id'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 250);
    expect(routeSection).toContain('requireApprovedSupplier');
  });

  it('gates DELETE /events/:id with requireApprovedSupplier', () => {
    const routeIdx = content.indexOf("router.delete(\n  '/events/:id'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 250);
    expect(routeSection).toContain('requireApprovedSupplier');
  });
});

// ─── D) Admin approval endpoint ─────────────────────────────────────────────
describe('supplier-admin.js — admin approve endpoint', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_ADMIN_ROUTES, 'utf8');
  });

  it('has POST /suppliers/:id/approve endpoint', () => {
    expect(content).toContain("'/suppliers/:id/approve'");
  });

  it('sets approved: true when approving', () => {
    const approveSection = content.slice(content.indexOf("'/suppliers/:id/approve'"));
    expect(approveSection.slice(0, 1200)).toContain('approved: true');
  });

  it('sets approved: false when rejecting', () => {
    const rejectSection = content.slice(content.indexOf("'/suppliers/:id/reject'"));
    expect(rejectSection.slice(0, 1200)).toContain('approved: false');
  });

  it('requires admin role for approval', () => {
    const approveSection = content.slice(content.indexOf("'/suppliers/:id/approve'"));
    expect(approveSection.slice(0, 300)).toContain("'admin'");
  });

  it('writes an audit log entry when approving', () => {
    const approveSection = content.slice(content.indexOf("'/suppliers/:id/approve'"));
    expect(approveSection.slice(0, 1200)).toContain('auditLog');
  });
});

// ─── D2) verification-request endpoint removed; state-machine submit exists ──

describe('supplier-management.js — legacy verification-request endpoint returns 410', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
  });

  it('has the /verification-request route returning 410 (removed)', () => {
    expect(content).toContain("'/verification-request'");
    // The route must return 410 Gone (endpoint removed)
    const section = content.slice(content.indexOf("'/verification-request'"));
    expect(section.slice(0, 400)).toContain('410');
  });

  it('does NOT create support tickets for supplier verification', () => {
    expect(content).not.toContain("ticketType: 'supplier_verification'");
  });

  it('does NOT insert into the tickets collection for verification', () => {
    // The old ticket insertion must be absent
    const section = content.slice(content.indexOf("'/verification-request'"));
    expect(section.slice(0, 500)).not.toContain("insertOne('tickets'");
  });
});

// ─── D3) State-machine verification submit endpoint in routes/supplier.js ────

describe('routes/supplier.js — POST /verification/submit uses state machine', () => {
  const SUPPLIER_ROUTE = path.join(__dirname, '../../routes/supplier.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_ROUTE, 'utf8');
  });

  it('has POST /verification/submit endpoint', () => {
    expect(content).toContain("'/verification/submit'");
  });

  it('transitions supplier to pending_review state', () => {
    const section = content.slice(content.indexOf("'/verification/submit'"));
    expect(section.slice(0, 2000)).toContain('PENDING_REVIEW');
  });

  it('checks the state machine canTransition before updating', () => {
    const section = content.slice(content.indexOf("'/verification/submit'"));
    expect(section.slice(0, 2000)).toContain('canTransition');
  });

  it('returns 409 when transition is not allowed (e.g. already pending)', () => {
    const section = content.slice(content.indexOf("'/verification/submit'"));
    expect(section.slice(0, 2000)).toContain('status(409)');
  });

  it('auto-approves when autoApproveSupplierVerification is enabled', () => {
    const section = content.slice(content.indexOf("'/verification/submit'"));
    expect(section.slice(0, 5500)).toContain('autoApproveSupplierVerification');
    expect(section.slice(0, 5500)).toContain('APPROVED');
    expect(section.slice(0, 5500)).toContain('autoApproved');
  });

  it('does NOT create support tickets', () => {
    const section = content.slice(content.indexOf("'/verification/submit'"));
    expect(section.slice(0, 5500)).not.toContain("ticketType: 'supplier_verification'");
    expect(section.slice(0, 5500)).not.toContain("insertOne('tickets'");
  });
});

// ─── D4) Admin verification-requests endpoint returns 410 ───────────────────

describe('routes/admin.js — GET /suppliers/verification-requests returns 410', () => {
  const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  });

  it('still has the /suppliers/verification-requests route (returns 410)', () => {
    expect(content).toContain("'/suppliers/verification-requests'");
  });

  it('returns 410 Gone (endpoint removed)', () => {
    const section = content.slice(content.indexOf("'/suppliers/verification-requests'"));
    expect(section.slice(0, 400)).toContain('410');
  });

  it('does NOT scan tickets for supplier_verification ticketType', () => {
    const section = content.slice(content.indexOf("'/suppliers/verification-requests'"));
    expect(section.slice(0, 600)).not.toContain("ticketType === 'supplier_verification'");
  });

  it('requires admin role', () => {
    const section = content.slice(content.indexOf("'/suppliers/verification-requests'"));
    expect(section.slice(0, 300)).toContain("'admin'");
  });
});

// ─── D5) Admin pending-verification endpoint uses state machine ─────────────

describe('routes/admin.js — GET /suppliers/pending-verification uses verificationStatus', () => {
  const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  });

  it('has GET /suppliers/pending-verification endpoint', () => {
    expect(content).toContain("'/suppliers/pending-verification'");
  });

  it('filters by verificationStatus (state-machine states)', () => {
    const section = content.slice(content.indexOf("'/suppliers/pending-verification'"));
    expect(section.slice(0, 800)).toContain('verificationStatus');
  });

  it('requires admin role', () => {
    const section = content.slice(content.indexOf("'/suppliers/pending-verification'"));
    expect(section.slice(0, 200)).toContain("'admin'");
  });
});

// ─── E) supplierApproved in /api/auth/me ────────────────────────────────────

describe('routes/auth.js — /api/auth/me includes supplierApproved', () => {
  const AUTH_ROUTES = path.join(__dirname, '../../routes/auth.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(AUTH_ROUTES, 'utf8');
  });

  it('includes supplierApproved in /me response for supplier users', () => {
    const meSection = content.slice(content.indexOf("router.get('/me'"));
    expect(meSection.slice(0, 2000)).toContain('supplierApproved');
  });

  it('fetches supplier profile to determine approval status', () => {
    const meSection = content.slice(content.indexOf("router.get('/me'"));
    expect(meSection.slice(0, 2000)).toContain("u.role === 'supplier'");
    expect(meSection.slice(0, 2000)).toContain('ownerUserId: u.id');
  });

  it('returns null supplierApproved for non-supplier users', () => {
    const meSection = content.slice(content.indexOf("router.get('/me'"));
    expect(meSection.slice(0, 2000)).toContain('supplierApproved = null');
  });
});

describe('server.js — /api/auth/me includes supplierApproved', () => {
  const SERVER_JS = path.join(__dirname, '../../server.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SERVER_JS, 'utf8');
  });

  it('includes supplierApproved in /api/auth/me response', () => {
    const meSection = content.slice(content.indexOf("app.get('/api/auth/me'"));
    expect(meSection.slice(0, 2000)).toContain('supplierApproved');
  });

  it('fetches supplier profile only for supplier-role users', () => {
    const meSection = content.slice(content.indexOf("app.get('/api/auth/me'"));
    expect(meSection.slice(0, 2000)).toContain("u.role === 'supplier'");
  });
});

// ─── E2) dashboard-supplier-verification.js reads data.user correctly ────────

describe('dashboard-supplier-verification.js — banner reads data.user.*', () => {
  const BANNER_JS = path.join(
    __dirname,
    '../../public/assets/js/pages/dashboard-supplier-verification.js'
  );
  let content;

  beforeAll(() => {
    content = fs.readFileSync(BANNER_JS, 'utf8');
  });

  it('reads role from data.user not data directly', () => {
    // Bug guard: must use data.user.role, not data.role
    expect(content).toContain('user.role');
    expect(content).not.toMatch(/\bdata\.role\b/);
  });

  it('reads supplierApproved from data.user not data directly', () => {
    // Bug guard: must use user.supplierApproved, not data.supplierApproved
    expect(content).toContain('user.supplierApproved');
    expect(content).not.toMatch(/\bdata\.supplierApproved\b/);
  });

  it('uses state-machine submit endpoint, not the removed ticket endpoint', () => {
    expect(content).toContain('/api/supplier/verification/submit');
    expect(content).not.toContain('/api/me/suppliers/verification-request');
  });

  it('shows pending state message when supplier is already in pending_review', () => {
    expect(content).toContain('pending_review');
  });
});

// ─── F) Public directory only shows approved suppliers ───────────────────────

describe('routes/suppliers.js — public directory filters unapproved', () => {
  const SUPPLIERS_ROUTES = path.join(__dirname, '../../routes/suppliers.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIERS_ROUTES, 'utf8');
  });

  it('filters list endpoint to only return approved suppliers', () => {
    // GET /api/suppliers should filter by approved
    const listSection = content.slice(content.indexOf("router.get('/suppliers'"));
    expect(listSection.slice(0, 500)).toContain('s.approved');
  });

  it('hides unapproved supplier profiles from non-admin/non-owner public access', () => {
    // GET /api/suppliers/:id should check approval
    expect(content).toContain('!sRaw.approved');
    expect(content).toContain("status(404).json({ error: 'Supplier not found' })");
  });
});

// ─── G) Migration defaults approved: true for existing suppliers ─────────────

describe('db-utils.js — migration preserves approved for existing suppliers', () => {
  const DB_UTILS = path.join(__dirname, '../../db-utils.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(DB_UTILS, 'utf8');
  });

  it('migration sets approved field defaulting existing suppliers to true', () => {
    const migrationSection = content.slice(content.indexOf('// Admin approval'));
    // Should use s.approved !== false (not just preserve undefined)
    expect(migrationSection.slice(0, 200)).toContain('approved:');
  });

  it('migration does not hard-code approved: false for existing suppliers', () => {
    const migrationSection = content.slice(content.indexOf('migrateSuppliers_AddNewFields'));
    // Must not unconditionally set approved to false (that would break live suppliers)
    // Should use approved: s.approved !== false pattern instead
    const approvedTruePos = migrationSection.indexOf('approved: s.approved');
    expect(approvedTruePos).not.toBe(-1);
  });
});

// ─── H) Admin suppliers UI calls /reject (not /approve with approved:false) ──

describe('admin-suppliers-init.js — rejectSupplier calls correct endpoint', () => {
  const ADMIN_SUPPLIERS_INIT = path.join(
    __dirname,
    '../../public/assets/js/pages/admin-suppliers-init.js'
  );
  let content;

  beforeAll(() => {
    content = fs.readFileSync(ADMIN_SUPPLIERS_INIT, 'utf8');
  });

  it('rejectSupplier calls POST /api/admin/suppliers/:id/reject', () => {
    const rejectFnIdx = content.indexOf('window.rejectSupplier = async function');
    expect(rejectFnIdx).not.toBe(-1);
    const rejectFnSection = content.slice(rejectFnIdx, rejectFnIdx + 700);
    expect(rejectFnSection).toContain('/reject');
  });

  it('rejectSupplier does NOT call the approve endpoint with approved:false', () => {
    const rejectFnIdx = content.indexOf('window.rejectSupplier = async function');
    const rejectFnSection = content.slice(rejectFnIdx, rejectFnIdx + 700);
    // Must not use the approve endpoint as a workaround
    expect(rejectFnSection).not.toContain('/approve');
  });

  it('rejectSupplier prompts for rejection notes via input modal', () => {
    const rejectFnIdx = content.indexOf('window.rejectSupplier = async function');
    const rejectFnSection = content.slice(rejectFnIdx, rejectFnIdx + 700);
    expect(rejectFnSection).toContain('showInputModal');
  });

  it('rejectSupplier sends notes field in request body', () => {
    const rejectFnIdx = content.indexOf('window.rejectSupplier = async function');
    const rejectFnSection = content.slice(rejectFnIdx, rejectFnIdx + 700);
    expect(rejectFnSection).toContain('notes');
  });
});

// ─── I) Admin reject endpoint increments verificationRejectionCount ──────────

describe('supplier-admin.js — reject endpoint increments rejection counter', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_ADMIN_ROUTES, 'utf8');
  });

  it('stores verificationRejectionCount in reject endpoint updates', () => {
    const rejectSection = content.slice(content.indexOf("'/suppliers/:id/reject'"));
    expect(rejectSection.slice(0, 1500)).toContain('verificationRejectionCount');
  });

  it('increments the existing rejection count (not hardcoded)', () => {
    const rejectSection = content.slice(content.indexOf("'/suppliers/:id/reject'"));
    // Should read the existing count and add 1
    expect(rejectSection.slice(0, 1500)).toContain('verificationRejectionCount || 0');
  });

  it('stores rejection notes in verificationNotes field', () => {
    const rejectSection = content.slice(content.indexOf("'/suppliers/:id/reject'"));
    expect(rejectSection.slice(0, 1500)).toContain('verificationNotes');
  });

  it('accepts notes field from request body', () => {
    const rejectSection = content.slice(content.indexOf("'/suppliers/:id/reject'"));
    expect(rejectSection.slice(0, 1000)).toContain('req.body.notes');
  });
});

// ─── J) Submit endpoint blocks after 5 rejections ────────────────────────────

describe('routes/supplier.js — submit blocks after 5 rejections', () => {
  const SUPPLIER_ROUTE = path.join(__dirname, '../../routes/supplier.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_ROUTE, 'utf8');
  });

  it('checks verificationRejectionCount before allowing resubmission', () => {
    const submitSection = content.slice(content.indexOf("'/verification/submit'"));
    expect(submitSection.slice(0, 3000)).toContain('verificationRejectionCount');
  });

  it('returns 403 when rejection count >= 5', () => {
    const submitSection = content.slice(content.indexOf("'/verification/submit'"));
    expect(submitSection.slice(0, 3000)).toContain('status(403)');
    expect(submitSection.slice(0, 3000)).toContain('VERIFICATION_MAX_REJECTIONS');
  });

  it('uses >= 5 as the blocking threshold', () => {
    const submitSection = content.slice(content.indexOf("'/verification/submit'"));
    expect(submitSection.slice(0, 3000)).toMatch(/>= *5/);
  });
});

// ─── K) Status endpoint includes verificationRejectionCount ──────────────────

describe('routes/supplier.js — status endpoint includes rejection count', () => {
  const SUPPLIER_ROUTE = path.join(__dirname, '../../routes/supplier.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_ROUTE, 'utf8');
  });

  it('status endpoint returns verificationRejectionCount field', () => {
    const statusSection = content.slice(content.indexOf("'/verification/status'"));
    expect(statusSection.slice(0, 1500)).toContain('verificationRejectionCount');
  });
});

// ─── L) Supplier dashboard widget handles rejected/blocked states ─────────────

describe('dashboard-supplier-verification.js — rejection and blocked state handling', () => {
  const BANNER_JS = path.join(
    __dirname,
    '../../public/assets/js/pages/dashboard-supplier-verification.js'
  );
  let content;

  beforeAll(() => {
    content = fs.readFileSync(BANNER_JS, 'utf8');
  });

  it('handles rejected verificationStatus state', () => {
    expect(content).toContain("verificationStatus === 'rejected'");
  });

  it('handles needs_changes verificationStatus state', () => {
    expect(content).toContain("verificationStatus === 'needs_changes'");
  });

  it('shows blocked banner when verificationRejectionCount >= 5', () => {
    expect(content).toContain('verificationRejectionCount >= 5');
  });

  it('displays admin rejection notes in the banner for rejected state', () => {
    expect(content).toContain('verificationNotes');
  });

  it('shows rejection notes in modal when resubmitting', () => {
    expect(content).toContain('sv-rejection-notes-block');
    expect(content).toContain('rejectionNotes');
  });

  it('shows supplier notes textarea in resubmit modal', () => {
    expect(content).toContain('sv-supplier-note-block');
    expect(content).toContain('sv-supplier-note');
  });

  it('handles VERIFICATION_MAX_REJECTIONS error from submit endpoint', () => {
    expect(content).toContain('VERIFICATION_MAX_REJECTIONS');
  });

  it('uses distinct CSS class for amber (get-verified) button hover', () => {
    expect(content).toContain('sv-open-widget-btn--amber');
  });

  it('uses distinct CSS class for red (resubmit) button hover', () => {
    expect(content).toContain('sv-open-widget-btn--red');
  });

  it('uses correct red hover colour for resubmit button (not amber)', () => {
    // The amber hover must not apply to red resubmit button
    expect(content).toContain('sv-open-widget-btn--red:hover');
    // Must NOT use a single #sv-open-widget-btn:hover that applies to both
    expect(content).not.toContain('#sv-open-widget-btn:hover');
  });

  it('shows rejection notes in blocked banner', () => {
    const blockedIdx = content.indexOf('verificationRejectionCount >= 5');
    const blockedSection = content.slice(blockedIdx, blockedIdx + 1500);
    expect(blockedSection).toContain('verificationNotes');
  });

  it('uses data-mode on submit button to preserve label during async retry', () => {
    expect(content).toContain("dataset.mode = 'resubmit'");
    expect(content).toContain("dataset.mode === 'resubmit'");
  });

  it('uses ⚠️ emoji for unverified (not submitted) state instead of ⏳', () => {
    // The unverified "Get Verified" banner should use ⚠️ (warning) not ⏳ (hourglass)
    // ⏳ is reserved for the pending_review state
    expect(content).toContain('⚠️');
    expect(content).toContain('⏳');
  });
});
