/**
 * Unit tests for verification gating on reviews and messenger write endpoints
 *
 * Verifies that high-impact write routes require a verified email address
 * (requireVerifiedUser / applyRequireVerifiedUser) in addition to authentication,
 * so that unverified users receive EMAIL_NOT_VERIFIED errors instead of being
 * able to post reviews or send messages.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REVIEWS_V2 = path.join(__dirname, '../../routes/reviews-v2.js');
const REVIEWS = path.join(__dirname, '../../routes/reviews.js');
const MESSENGER_V4 = path.join(__dirname, '../../routes/messenger-v4.js');

// ---------------------------------------------------------------------------
// reviews-v2.js
// ---------------------------------------------------------------------------
describe('reviews-v2.js — verification gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(REVIEWS_V2, 'utf8');
  });

  it('imports requireVerifiedUser from middleware/auth', () => {
    expect(content).toContain('requireVerifiedUser');
    expect(content).toContain("require('../middleware/auth')");
  });

  it('POST /with-verification route requires verified user', () => {
    // Find the route definition for the review creation endpoint (multi-line)
    const routeIdx = content.indexOf("'/with-verification'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('requireVerifiedUser');
  });

  it('POST /with-verification route also requires authRequired', () => {
    const routeIdx = content.indexOf("'/with-verification'");
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('authRequired');
  });
});

// ---------------------------------------------------------------------------
// reviews.js
// ---------------------------------------------------------------------------
describe('reviews.js — verification gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(REVIEWS, 'utf8');
  });

  it('declares requireVerifiedUser as an injected dependency variable', () => {
    expect(content).toContain('let requireVerifiedUser');
  });

  it('includes requireVerifiedUser in the list of required dependencies', () => {
    // The required deps array inside initializeDependencies must include it
    const initIdx = content.indexOf('function initializeDependencies');
    const initSection = content.slice(initIdx, initIdx + 800);
    expect(initSection).toContain("'requireVerifiedUser'");
  });

  it('defines applyRequireVerifiedUser deferred wrapper', () => {
    expect(content).toContain('function applyRequireVerifiedUser');
  });

  it('POST /suppliers/:supplierId/reviews requires verified user', () => {
    const routeIdx = content.indexOf("'/suppliers/:supplierId/reviews'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('applyRequireVerifiedUser');
  });

  it('POST /reviews (legacy endpoint) requires verified user', () => {
    // Find the legacy /reviews POST route
    const routeIdx = content.indexOf("'/reviews',\n  applyFeatureRequired");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('applyRequireVerifiedUser');
  });
});

// ---------------------------------------------------------------------------
// messenger-v4.js
// ---------------------------------------------------------------------------
describe('messenger-v4.js — verification gating', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(MESSENGER_V4, 'utf8');
  });

  it('declares requireVerifiedUser as a module-level variable', () => {
    expect(content).toContain('let requireVerifiedUser');
  });

  it('defines applyRequireVerifiedUser deferred wrapper', () => {
    expect(content).toContain('function applyRequireVerifiedUser');
  });

  it('stores requireVerifiedUser from dependencies in initialize()', () => {
    const initIdx = content.indexOf('function initialize(dependencies)');
    const initSection = content.slice(initIdx, initIdx + 600);
    expect(initSection).toContain('requireVerifiedUser');
  });

  it('POST /conversations requires verified user', () => {
    const routeIdx = content.indexOf("'/conversations',\n  applyAuthRequired");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('applyRequireVerifiedUser');
  });

  it('POST /conversations/:id/messages requires verified user', () => {
    const routeIdx = content.indexOf("'/conversations/:id/messages'");
    expect(routeIdx).not.toBe(-1);
    const routeSection = content.slice(routeIdx, routeIdx + 300);
    expect(routeSection).toContain('applyRequireVerifiedUser');
  });
});
