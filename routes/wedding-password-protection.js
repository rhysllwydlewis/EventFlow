'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { authRequired, requireVerifiedUser } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { stripHtml } = require('../utils/helpers');

const router = express.Router({ mergeParams: true });
const ALLOWED_VISIBILITY = new Set(['private_link', 'public', 'password']);
const ACCESS_COOKIE_PREFIX = 'ewp_';
const ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
const HASH_ITERATIONS = 210000;
const HASH_KEYLEN = 32;
const HASH_DIGEST = 'sha256';

const passwordAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password attempts. Please try again later.' },
});

const sanitize = (v, n = 5000) =>
  v === null || v === undefined ? null : stripHtml(String(v)).trim().slice(0, n);

function accessSecret() {
  return String(process.env.JWT_SECRET || process.env.SESSION_SECRET || 'change_me_wedding_access');
}

function cookieName(slug) {
  return `${ACCESS_COOKIE_PREFIX}${String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 90)}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(String(password), salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
    .toString('hex');
  return `pbkdf2:${HASH_DIGEST}:${HASH_ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') {
    return false;
  }
  const [, digest, iterationsRaw, salt, expected] = parts;
  const actual = crypto
    .pbkdf2Sync(String(password), salt, Number(iterationsRaw), expected.length / 2, digest)
    .toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', accessSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyAccessToken(token, slug) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) {
    return false;
  }
  const expected = crypto.createHmac('sha256', accessSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.slug === slug && Number(payload.exp || 0) > Date.now();
  } catch (_err) {
    return false;
  }
}

function hasPasswordAccess(req, site) {
  if (site.visibility !== 'password') {
    return true;
  }
  const token = req.cookies?.[cookieName(site.slug)] || req.get('x-wedding-access-token');
  return verifyAccessToken(token, site.slug);
}

function scrubWebsite(site) {
  if (!site) {
    return null;
  }
  const copy = { ...site };
  delete copy.passwordHash;
  copy.passwordSet = !!site.passwordHash;
  copy.passwordProtected = site.visibility === 'password';
  return copy;
}

function safePublic(site) {
  const publicSite = scrubWebsite(site);
  delete publicSite.id;
  delete publicSite.planId;
  delete publicSite.userId;
  delete publicSite.createdAt;
  delete publicSite.updatedAt;
  delete publicSite.publishedAt;
  delete publicSite.passwordSet;
  delete publicSite.passwordProtected;
  return publicSite;
}

async function findPlanBySlug(slug) {
  const plans = await dbUnified.read('plans');
  return plans.find(p => p.weddingWebsite && p.weddingWebsite.slug === slug);
}

async function getOwnedPlan(req, res, next) {
  const plans = await dbUnified.read('plans');
  const plan = plans.find(p => p.id === req.params.planId && p.userId === req.user.id);
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  req.plan = plan;
  next();
}

router.get('/:planId/wedding-website', authRequired, getOwnedPlan, (req, res, next) => {
  if (!req.plan.weddingWebsite) {
    return next();
  }
  return res.json({ success: true, website: scrubWebsite(req.plan.weddingWebsite) });
});

router.patch(
  '/:planId/wedding-website/privacy',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    const site = req.plan.weddingWebsite;
    if (!site) {
      return res.status(404).json({ error: 'Wedding website not found' });
    }
    const visibility = String(req.body.visibility || '').trim();
    if (!ALLOWED_VISIBILITY.has(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility mode.' });
    }
    const nextSite = { ...site, visibility, updatedAt: new Date().toISOString() };
    const suppliedPassword = sanitize(req.body.password || req.body.weddingPassword, 300);
    if (visibility === 'password') {
      if (!nextSite.passwordHash && !suppliedPassword) {
        return res.status(400).json({ error: 'Please set a password before enabling password protection.' });
      }
      if (suppliedPassword) {
        if (suppliedPassword.length < 6) {
          return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }
        nextSite.passwordHash = hashPassword(suppliedPassword);
        nextSite.passwordUpdatedAt = nextSite.updatedAt;
      }
    } else {
      delete nextSite.passwordHash;
      delete nextSite.passwordUpdatedAt;
    }
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: nextSite, updatedAt: nextSite.updatedAt } }
    );
    return res.json({ success: true, website: scrubWebsite(nextSite) });
  }
);

router.get('/public/wedding-websites/:slug', async (req, res, next) => {
  const plan = await findPlanBySlug(req.params.slug);
  if (!plan || !plan.weddingWebsite || plan.weddingWebsite.status !== 'published') {
    return next();
  }
  const site = plan.weddingWebsite;
  if (site.visibility !== 'password') {
    return next();
  }
  if (!hasPasswordAccess(req, site)) {
    return res.status(401).json({
      error: 'Password required',
      passwordRequired: true,
      noindex: true,
    });
  }
  return res.json({ success: true, website: safePublic(site) });
});

router.post('/public/wedding-websites/:slug/access', passwordAccessLimiter, async (req, res) => {
  const plan = await findPlanBySlug(req.params.slug);
  if (!plan || !plan.weddingWebsite || plan.weddingWebsite.status !== 'published') {
    return res.status(404).json({ error: 'Wedding website not found' });
  }
  const site = plan.weddingWebsite;
  if (site.visibility !== 'password') {
    return res.json({ success: true, passwordRequired: false });
  }
  const password = sanitize(req.body.password, 300);
  if (!password || !site.passwordHash || !verifyPassword(password, site.passwordHash)) {
    return res.status(403).json({ error: 'The password was not recognised.', passwordRequired: true });
  }
  const token = signPayload({ slug: site.slug, exp: Date.now() + ACCESS_TTL_MS });
  res.cookie(cookieName(site.slug), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ACCESS_TTL_MS,
    path: '/',
  });
  return res.json({ success: true, expiresInSeconds: Math.floor(ACCESS_TTL_MS / 1000) });
});

router.post('/public/wedding-websites/:slug/rsvp', async (req, res, next) => {
  const plan = await findPlanBySlug(req.params.slug);
  if (!plan || !plan.weddingWebsite || plan.weddingWebsite.status !== 'published') {
    return next();
  }
  const site = plan.weddingWebsite;
  if (site.visibility !== 'password') {
    return next();
  }
  if (!hasPasswordAccess(req, site)) {
    return res.status(403).json({ error: 'Password access is required before RSVP.', passwordRequired: true });
  }
  return next();
});

module.exports = router;
