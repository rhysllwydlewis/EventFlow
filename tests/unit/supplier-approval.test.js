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
    const patchStart = content.indexOf("PATCH /api/me/suppliers/:id");
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

// ─── D2) Verification request endpoint ─────────────────────────────────────

describe('supplier-management.js — verification-request endpoint', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SUPPLIER_MANAGEMENT, 'utf8');
  });

  it('has POST /verification-request endpoint', () => {
    expect(content).toContain("'/verification-request'");
  });

  it('creates a support ticket with ticketType supplier_verification', () => {
    const section = content.slice(content.indexOf("'/verification-request'"));
    expect(section.slice(0, 3000)).toContain("ticketType: 'supplier_verification'");
  });

  it('prevents duplicate tickets with 409 and VERIFICATION_REQUEST_PENDING code', () => {
    const section = content.slice(content.indexOf("'/verification-request'"));
    expect(section.slice(0, 3000)).toContain('status(409)');
    expect(section.slice(0, 3000)).toContain('VERIFICATION_REQUEST_PENDING');
  });

  it('does NOT require approval (unapproved suppliers can submit)', () => {
    const section = content.slice(content.indexOf("'/verification-request'"));
    // Must NOT include applyRequireApprovedSupplier in this route
    const routeSection = section.slice(0, section.indexOf('async (req, res)'));
    expect(routeSection).not.toContain('applyRequireApprovedSupplier');
  });

  it('requires verified user and supplier role', () => {
    const section = content.slice(content.indexOf("'/verification-request'"));
    const routeSection = section.slice(0, section.indexOf('async (req, res)'));
    expect(routeSection).toContain('applyRequireVerifiedUser');
    expect(routeSection).toContain("applyRoleRequired('supplier')");
  });

  it('inserts the ticket into the tickets collection', () => {
    const section = content.slice(content.indexOf("'/verification-request'"));
    expect(section.slice(0, 3500)).toContain("insertOne('tickets'");
  });

  it('does NOT use inline require() for uid — uses injected uid dependency', () => {
    const section = content.slice(content.indexOf("'/verification-request'"));
    // Bug guard: must not do require('../store') inside the handler
    expect(section.slice(0, 4000)).not.toContain("require('../store')");
  });
});

// ─── D3) Admin verification-requests endpoint ───────────────────────────────

describe('routes/admin.js — GET /suppliers/verification-requests', () => {
  const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  });

  it('has GET /suppliers/verification-requests endpoint', () => {
    expect(content).toContain("'/suppliers/verification-requests'");
  });

  it('filters tickets by ticketType supplier_verification', () => {
    const section = content.slice(content.indexOf("'/suppliers/verification-requests'"));
    expect(section.slice(0, 800)).toContain("ticketType === 'supplier_verification'");
  });

  it('filters tickets by open or in_progress status', () => {
    const section = content.slice(content.indexOf("'/suppliers/verification-requests'"));
    expect(section.slice(0, 800)).toContain("status === 'open'");
    expect(section.slice(0, 800)).toContain("status === 'in_progress'");
  });

  it('returns pendingByUserId object', () => {
    const section = content.slice(content.indexOf("'/suppliers/verification-requests'"));
    expect(section.slice(0, 800)).toContain('pendingByUserId');
  });

  it('requires admin role', () => {
    const section = content.slice(content.indexOf("'/suppliers/verification-requests'"));
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

  it('includes live character counter for note textarea', () => {
    expect(content).toContain('sv-note-counter');
    expect(content).toContain('noteEl.value.length');
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
