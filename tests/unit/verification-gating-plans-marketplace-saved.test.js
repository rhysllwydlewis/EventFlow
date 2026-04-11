/**
 * Unit tests for verification gating on plans, marketplace, and saved-items write endpoints
 *
 * Verifies that high-impact write routes require a verified email address
 * (requireVerifiedUser) in addition to authentication, so that unverified users
 * receive EMAIL_NOT_VERIFIED errors instead of being able to create plans,
 * marketplace listings, or save items.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PLANS = path.join(__dirname, '../../routes/plans.js');
const MARKETPLACE = path.join(__dirname, '../../routes/marketplace.js');
const SAVED = path.join(__dirname, '../../routes/saved.js');

// ---------------------------------------------------------------------------
// plans.js
// ---------------------------------------------------------------------------
describe('plans.js — verification gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(PLANS, 'utf8');
  });

  it('imports requireVerifiedUser from middleware/auth', () => {
    expect(content).toContain('requireVerifiedUser');
    expect(content).toContain("require('../middleware/auth')");
  });

  it('POST / (create plan) requires verified user', () => {
    // Find the create-plan route definition
    const routeIdx = content.indexOf("router.post('/', authRequired, requireVerifiedUser");
    expect(routeIdx).not.toBe(-1);
  });

  it('PATCH /:id (update plan) requires verified user', () => {
    const routeIdx = content.indexOf("router.patch('/:id', authRequired, requireVerifiedUser");
    expect(routeIdx).not.toBe(-1);
  });

  it('DELETE /:id (delete plan) requires verified user', () => {
    const routeIdx = content.indexOf("router.delete('/:id', authRequired, requireVerifiedUser");
    expect(routeIdx).not.toBe(-1);
  });

  it('POST /:planId/budget requires verified user', () => {
    const routeIdx = content.indexOf(
      "router.post('/:planId/budget', authRequired, requireVerifiedUser"
    );
    expect(routeIdx).not.toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// marketplace.js
// ---------------------------------------------------------------------------
describe('marketplace.js — verification gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(MARKETPLACE, 'utf8');
  });

  it('declares requireVerifiedUser as an injected dependency variable', () => {
    expect(content).toContain('let requireVerifiedUser');
  });

  it('includes requireVerifiedUser in the list of required dependencies', () => {
    const initIdx = content.indexOf('function initializeDependencies');
    const initSection = content.slice(initIdx, initIdx + 600);
    expect(initSection).toContain("'requireVerifiedUser'");
  });

  it('assigns requireVerifiedUser from injected deps', () => {
    expect(content).toContain('requireVerifiedUser = deps.requireVerifiedUser');
  });

  it('defines applyRequireVerifiedUser deferred wrapper', () => {
    expect(content).toContain('function applyRequireVerifiedUser');
  });

  it('POST /listings (create listing) requires verified user', () => {
    // Find the router.post( for /listings (not the GET)
    const routerPostIdx = content.indexOf("router.post(\n  '/listings'");
    expect(routerPostIdx).not.toBe(-1);
    const routeSection = content.slice(routerPostIdx, routerPostIdx + 200);
    expect(routeSection).toContain('applyRequireVerifiedUser');
  });

  it('PUT /listings/:id (update listing) requires verified user', () => {
    const routerPutIdx = content.indexOf("router.put(\n  '/listings/:id'");
    expect(routerPutIdx).not.toBe(-1);
    const routeSection = content.slice(routerPutIdx, routerPutIdx + 200);
    expect(routeSection).toContain('applyRequireVerifiedUser');
  });

  it('DELETE /listings/:id (delete listing) requires verified user', () => {
    // Find 'Delete marketplace listing' comment and get the router.delete after it
    const commentIdx = content.indexOf('// Delete marketplace listing');
    expect(commentIdx).not.toBe(-1);
    const routeSection = content.slice(commentIdx, commentIdx + 300);
    expect(routeSection).toContain('applyRequireVerifiedUser');
  });
});

// ---------------------------------------------------------------------------
// saved.js
// ---------------------------------------------------------------------------
describe('saved.js — verification gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(SAVED, 'utf8');
  });

  it('imports requireVerifiedUser from middleware/auth', () => {
    expect(content).toContain('requireVerifiedUser');
    expect(content).toContain("require('../middleware/auth')");
  });

  it('POST / (save item) requires verified user', () => {
    const routeIdx = content.indexOf('router.post');
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 150);
    expect(routeSection).toContain('requireVerifiedUser');
  });

  it('DELETE /by-item (unsave by item) requires verified user', () => {
    const routeIdx = content.indexOf("router.delete('/by-item'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 150);
    expect(routeSection).toContain('requireVerifiedUser');
  });

  it('DELETE /:id (unsave by id) requires verified user', () => {
    const routeIdx = content.indexOf("router.delete('/:id'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 150);
    expect(routeSection).toContain('requireVerifiedUser');
  });
});
