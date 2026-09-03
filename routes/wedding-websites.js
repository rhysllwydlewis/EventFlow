'use strict';

const crypto = require('crypto');
const express = require('express');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const { authRequired, requireVerifiedUser } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { stripHtml } = require('../utils/helpers');

const router = express.Router({ mergeParams: true });
const PUBLIC_SLUGS = new Set([
  'admin',
  'api',
  'auth',
  'dashboard',
  'settings',
  'supplier',
  'suppliers',
  'pricing',
  'guides',
  'public-calendar',
  'marketplace',
  'wedding',
  'events',
  'static',
  'assets',
  'website',
  'wedding-website',
  'preview',
  'share',
  'guest',
  'guests',
  'rsvp',
  'password',
]);
const SLUG_BASE_MAX_LENGTH = 64;
const SECURE_SLUG_TOKEN_LENGTH = 5;
const SLUG_TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const sanitize = (v, n = 5000) =>
  v === null || v === undefined ? null : stripHtml(String(v)).trim().slice(0, n);
const guestListForPlan = plan =>
  Array.isArray(plan.guestList) ? plan.guestList : Array.isArray(plan.guests) ? plan.guests : [];
const setGuestList = (plan, list) => {
  if (Array.isArray(plan.guests)) {
    return { guests: list };
  }
  return { guestList: list };
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = { name: 200, email: 200, phone: 30, text: 1000, note: 2000 };
const MAX_IMAGE_CHARS = 1200000;
const ALLOWED_VISIBILITY = new Set(['private_link', 'public', 'password']);
const isDeadlinePassed = value => {
  if (!value) {
    return false;
  }
  const raw = String(value);
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T23:59:59.999Z`)
    : new Date(raw);
  return !Number.isNaN(deadline.getTime()) && deadline < new Date();
};

const sanitizeImageUrl = value => {
  const cleaned = sanitize(value, MAX_IMAGE_CHARS) || '';
  if (!cleaned) {
    return '';
  }
  const lower = cleaned.toLowerCase();
  if (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(cleaned)
  ) {
    return cleaned;
  }
  return '';
};
const PASSWORD_ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
const PASSWORD_HASH_ITERATIONS = 210000;
const PASSWORD_HASH_KEYLEN = 32;
const PASSWORD_HASH_DIGEST = 'sha256';
const PASSWORD_COOKIE_PREFIX = 'ewp_';

const passwordAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password attempts. Please try again later.' },
});

const slugify = str =>
  String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

const isReservedSlug = slug => !slug || PUBLIC_SLUGS.has(String(slug).toLowerCase());

function accessSecret() {
  return String(process.env.JWT_SECRET || process.env.SESSION_SECRET || 'change_me_wedding_access');
}

function randomSlugToken(length = SECURE_SLUG_TOKEN_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let token = '';
  for (const byte of bytes) {
    token += SLUG_TOKEN_ALPHABET[byte % SLUG_TOKEN_ALPHABET.length];
  }
  return token;
}

function readableSlugBase(seed) {
  let base = slugify(seed);
  if (isReservedSlug(base)) {
    base = 'our-wedding';
  }
  base = base.slice(0, SLUG_BASE_MAX_LENGTH).replace(/-+$/g, '');
  return base || 'our-wedding';
}

function passwordCookieName(slug) {
  return `${PASSWORD_COOKIE_PREFIX}${String(slug || '')
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(0, 90)}`;
}

function readCookie(req, name) {
  if (req.cookies && Object.prototype.hasOwnProperty.call(req.cookies, name)) {
    return req.cookies[name];
  }
  const cookieHeader = String(req.headers?.cookie || '');
  if (!cookieHeader) {
    return '';
  }
  const target = `${name}=`;
  const found = cookieHeader
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(target));
  return found ? decodeURIComponent(found.slice(target.length)) : '';
}

function hashWeddingPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(
      String(password),
      salt,
      PASSWORD_HASH_ITERATIONS,
      PASSWORD_HASH_KEYLEN,
      PASSWORD_HASH_DIGEST
    )
    .toString('hex');
  return `pbkdf2:${PASSWORD_HASH_DIGEST}:${PASSWORD_HASH_ITERATIONS}:${salt}:${hash}`;
}

function verifyWeddingPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') {
    return false;
  }
  const [, digest, iterationsRaw, salt, expected] = parts;
  const actual = crypto
    .pbkdf2Sync(String(password), salt, Number(iterationsRaw), expected.length / 2, digest)
    .toString('hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function signAccessToken(slug) {
  const body = Buffer.from(
    JSON.stringify({ slug, exp: Date.now() + PASSWORD_ACCESS_TTL_MS })
  ).toString('base64url');
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

function hasWeddingPasswordAccess(req, site) {
  if (site.visibility !== 'password') {
    return true;
  }
  const token = readCookie(req, passwordCookieName(site.slug)) || req.get('x-wedding-access-token');
  return verifyAccessToken(token, site.slug);
}

async function isSlugTaken(slug, planId) {
  // Dotted-path filter — uses 'weddingWebsite.slug' sparse index
  const match = await dbUnified.findOne('plans', { 'weddingWebsite.slug': slug });
  return match !== null && match.id !== planId;
}

async function generateUniqueSlug(seed, planId) {
  const base = readableSlugBase(seed);
  for (let i = 0; i < 28; i += 1) {
    const slug = `${base}-${randomSlugToken()}`;
    if (!isReservedSlug(slug) && !(await isSlugTaken(slug, planId))) {
      return slug;
    }
  }
  const fallback = `${base}-${Date.now().toString(36).slice(-5)}-${randomSlugToken(3)}`;
  return fallback.slice(0, 80).replace(/-+$/g, '');
}

function getPublishReadiness(site) {
  const checks = [
    { key: 'coupleNames', ok: !!sanitize(site.coupleNames, 200) },
    { key: 'eventDate', ok: !!sanitize(site.eventDate, 100) },
    {
      key: 'venue',
      ok: !!(sanitize(site.ceremonyVenueName, 200) || sanitize(site.receptionVenueName, 200)),
    },
    { key: 'rsvpEnabled', ok: site.rsvpEnabled !== false },
    { key: 'slug', ok: !!sanitize(site.slug, 80) && !isReservedSlug(site.slug) },
    { key: 'password', ok: site.visibility !== 'password' || !!site.passwordHash },
  ];
  return {
    ready: checks.every(c => c.ok),
    missing: checks.filter(c => !c.ok).map(c => c.key),
  };
}

async function getOwnedPlan(req, res, next) {
  const plan = await dbUnified.findOne('plans', { id: req.params.planId, userId: req.user.id });
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  req.plan = plan;
  next();
}

function scrubCustomerWebsite(site) {
  if (!site) {
    return null;
  }
  const copy = { ...site };
  delete copy.passwordHash;
  copy.passwordSet = !!site.passwordHash;
  copy.passwordProtected = site.visibility === 'password';
  copy.shareable = site.status === 'published' && !!site.slug && !isReservedSlug(site.slug);
  copy.privateLinkMessage =
    site.visibility === 'private_link'
      ? 'Anyone with this exact link can view it. Use password protection for restricted access.'
      : '';
  return copy;
}

function safePublic(site) {
  return {
    slug: site.slug,
    coupleNames: site.coupleNames,
    welcomeMessage: site.welcomeMessage,
    eventDate: site.eventDate || null,
    template: site.template,
    accentColor: site.accentColor,
    ceremonyVenueName: site.ceremonyVenueName,
    ceremonyVenueAddress: site.ceremonyVenueAddress,
    receptionVenueName: site.receptionVenueName,
    receptionVenueAddress: site.receptionVenueAddress,
    arrivalTime: site.arrivalTime,
    ceremonyTime: site.ceremonyTime,
    receptionTime: site.receptionTime,
    finishTime: site.finishTime,
    dressCode: site.dressCode,
    childrenPolicy: site.childrenPolicy,
    plusOnePolicy: site.plusOnePolicy,
    giftInfo: site.giftInfo,
    parkingInfo: site.parkingInfo,
    accessibilityInfo: site.accessibilityInfo,
    accommodationRecommendations: site.accommodationRecommendations || [],
    taxiRecommendations: site.taxiRecommendations || [],
    localInfo: site.localInfo || [],
    faq: site.faq || [],
    weddingParty: site.weddingParty || [],
    loveStory: site.loveStory,
    proposalStory: site.proposalStory,
    coverImageUrl: site.coverImageUrl,
    rsvpEnabled: site.rsvpEnabled !== false,
    rsvpDeadline: site.rsvpDeadline || null,
    rsvpIntroText: site.rsvpIntroText || '',
    mealOptions: site.mealOptions || [],
    customRsvpQuestions: site.customRsvpQuestions || [],
  };
}

router.get('/:planId/wedding-website', authRequired, getOwnedPlan, (req, res) => {
  res.json({ success: true, website: scrubCustomerWebsite(req.plan.weddingWebsite) || null });
});

router.post(
  '/wedding-workspace',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    const existing = await dbUnified.findOne('plans', {
      userId: req.user.id,
      isWebsiteWorkspace: true,
      source: 'wedding_website_quick_start',
    });
    if (existing) {
      return res.status(200).json({ success: true, plan: existing, reused: true });
    }
    const now = new Date().toISOString();
    const plan = {
      id: uid('plan'),
      userId: req.user.id,
      name: 'Wedding Website',
      eventType: 'wedding',
      source: 'wedding_website_quick_start',
      isWebsiteWorkspace: true,
      guestCount: null,
      guestList: [],
      tables: [],
      createdAt: now,
      updatedAt: now,
    };
    const weddingPlanInserted = await dbUnified.insertOne('plans', plan);
    if (!weddingPlanInserted) {
      logger.error('[WEDDING] plan insertOne failed', { planId: plan.id });
      return res.status(500).json({ error: 'Failed to create wedding plan. Please try again.' });
    }
    return res.status(201).json({ success: true, plan, reused: false });
  }
);

router.post(
  '/:planId/wedding-website',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    if (req.plan.weddingWebsite) {
      return res.status(409).json({ error: 'Wedding website already exists' });
    }
    const now = new Date().toISOString();
    const seed =
      req.body.slug || req.body.coupleNames || req.plan.name || req.plan.eventName || 'our-wedding';
    const slug = await generateUniqueSlug(seed, req.plan.id);
    const website = {
      id: uid('wedsite'),
      planId: req.plan.id,
      userId: req.user.id,
      slug,
      status: 'draft',
      visibility: 'private_link',
      noindex: true,
      template: 'classic',
      accentColor: '#0B8073',
      coupleNames: sanitize(req.body.coupleNames || req.plan.name || 'Our Wedding', 200),
      eventDate: req.plan.eventDate || req.plan.date || new Date().toISOString().slice(0, 10),
      ceremonyVenueName: sanitize(
        req.body.ceremonyVenueName ||
          req.plan.venueName ||
          req.plan.location ||
          'Venue to be confirmed',
        200
      ),
      welcomeMessage: '',
      rsvpEnabled: true,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: website, updatedAt: now } }
    );
    res.status(201).json({ success: true, website: scrubCustomerWebsite(website) });
  }
);

function sanitizeWebsiteList(items, mapper, max = 25) {
  return items.slice(0, max).map(raw => mapper(raw && typeof raw === 'object' ? raw : {}));
}

function sanitizeCustomRsvpQuestions(items) {
  const allowedTypes = new Set(['text', 'textarea', 'select', 'checkbox']);
  return sanitizeWebsiteList(
    items,
    item => {
      const type = allowedTypes.has(String(item.type || '').toLowerCase())
        ? String(item.type).toLowerCase()
        : 'text';
      return {
        id: sanitize(item.id, 80) || uid('question'),
        label: sanitize(item.label, 300),
        type,
        required: !!item.required,
        options: Array.isArray(item.options)
          ? item.options
              .slice(0, 20)
              .map(option => sanitize(option, 120))
              .filter(Boolean)
          : [],
      };
    },
    20
  ).filter(item => item.label);
}

function sanitizeCustomAnswers(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, 20).map(raw => {
    const answer = raw && typeof raw === 'object' ? raw : {};
    const value = Array.isArray(answer.value)
      ? answer.value
          .slice(0, 20)
          .map(item => sanitize(item, 300))
          .filter(Boolean)
      : sanitize(answer.value, 1000);
    return { id: sanitize(answer.id, 80), label: sanitize(answer.label, 300), value };
  });
}

router.patch(
  '/:planId/wedding-website',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    if (!req.plan.weddingWebsite) {
      return res.status(404).json({ error: 'Wedding website not found' });
    }
    const patch = { ...req.plan.weddingWebsite };
    const fields = [
      'coupleNames',
      'eventDate',
      'welcomeMessage',
      'loveStory',
      'proposalStory',
      'ceremonyVenueName',
      'ceremonyVenueAddress',
      'receptionVenueName',
      'receptionVenueAddress',
      'arrivalTime',
      'ceremonyTime',
      'receptionTime',
      'finishTime',
      'dressCode',
      'childrenPolicy',
      'plusOnePolicy',
      'giftInfo',
      'parkingInfo',
      'accessibilityInfo',
      'rsvpIntroText',
      'template',
      'accentColor',
    ];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        patch[f] = sanitize(req.body[f]);
      }
    });
    if (req.body.coverImageUrl !== undefined) {
      patch.coverImageUrl = sanitizeImageUrl(req.body.coverImageUrl);
    }
    if (req.body.slug !== undefined) {
      const s = slugify(req.body.slug);
      if (isReservedSlug(s)) {
        return res.status(400).json({ error: 'Please choose a more personal website link.' });
      }
      if (await isSlugTaken(s, req.plan.id)) {
        return res.status(409).json({ error: 'Slug is already in use.' });
      }
      patch.slug = s;
    } else if (isReservedSlug(patch.slug)) {
      patch.slug = await generateUniqueSlug(
        patch.coupleNames || req.plan.name || 'our-wedding',
        req.plan.id
      );
    }
    if (Array.isArray(req.body.accommodationRecommendations)) {
      patch.accommodationRecommendations = sanitizeWebsiteList(
        req.body.accommodationRecommendations,
        item => ({
          id: sanitize(item.id, 80) || uid('acc'),
          name: sanitize(item.name, 160),
          description: sanitize(item.description, 500),
          address: sanitize(item.address, 500),
          phone: sanitize(item.phone, MAX.phone),
          websiteUrl: sanitize(item.websiteUrl, 500),
          distance: sanitize(item.distance, 120),
          notes: sanitize(item.notes, 500),
        })
      );
    }
    if (Array.isArray(req.body.taxiRecommendations)) {
      patch.taxiRecommendations = sanitizeWebsiteList(req.body.taxiRecommendations, item => ({
        id: sanitize(item.id, 80) || uid('taxi'),
        name: sanitize(item.name, 160),
        phone: sanitize(item.phone, MAX.phone),
        websiteUrl: sanitize(item.websiteUrl, 500),
        notes: sanitize(item.notes, 500),
      }));
    }
    if (Array.isArray(req.body.localInfo)) {
      patch.localInfo = sanitizeWebsiteList(req.body.localInfo, item => ({
        id: sanitize(item.id, 80) || uid('local'),
        title: sanitize(item.title, 160),
        description: sanitize(item.description, 700),
        url: sanitize(item.url, 500),
        type: sanitize(item.type, 80),
      }));
    }
    if (Array.isArray(req.body.faq)) {
      patch.faq = sanitizeWebsiteList(
        req.body.faq,
        item => ({
          id: sanitize(item.id, 80) || uid('faq'),
          question: sanitize(item.question, 300),
          answer: sanitize(item.answer, 1000),
        }),
        40
      );
    }
    if (Array.isArray(req.body.weddingParty)) {
      patch.weddingParty = sanitizeWebsiteList(
        req.body.weddingParty,
        item => ({
          id: sanitize(item.id, 80) || uid('party'),
          name: sanitize(item.name, 160),
          role: sanitize(item.role, 120),
          bio: sanitize(item.bio, 1000),
          imageUrl: sanitize(item.imageUrl, 500),
        }),
        30
      );
    }
    if (Array.isArray(req.body.mealOptions)) {
      patch.mealOptions = req.body.mealOptions
        .slice(0, 30)
        .map(item => sanitize(item, 120))
        .filter(Boolean);
    }
    if (Array.isArray(req.body.customRsvpQuestions)) {
      patch.customRsvpQuestions = sanitizeCustomRsvpQuestions(req.body.customRsvpQuestions);
    }
    if (req.body.rsvpEnabled !== undefined) {
      patch.rsvpEnabled = !!req.body.rsvpEnabled;
    }
    if (req.body.rsvpDeadline !== undefined) {
      patch.rsvpDeadline = req.body.rsvpDeadline || null;
    }
    if (req.body.visibility !== undefined) {
      const visibility = String(req.body.visibility);
      if (!ALLOWED_VISIBILITY.has(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility mode.' });
      }
      patch.visibility = visibility;
      const suppliedPassword = sanitize(req.body.password || req.body.weddingPassword, 300);
      if (visibility === 'password') {
        if (!patch.passwordHash && !suppliedPassword) {
          return res
            .status(400)
            .json({ error: 'Please set a password before enabling password protection.' });
        }
        if (suppliedPassword) {
          if (suppliedPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });
          }
          patch.passwordHash = hashWeddingPassword(suppliedPassword);
          patch.passwordUpdatedAt = new Date().toISOString();
        }
      } else {
        delete patch.passwordHash;
        delete patch.passwordUpdatedAt;
      }
    }
    patch.updatedAt = new Date().toISOString();
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: patch, updatedAt: patch.updatedAt } }
    );
    res.json({ success: true, website: scrubCustomerWebsite(patch) });
  }
);

router.post(
  '/:planId/wedding-website/publish',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    if (!req.plan.weddingWebsite) {
      return res.status(404).json({ error: 'Wedding website not found' });
    }
    let website = { ...req.plan.weddingWebsite };
    if (isReservedSlug(website.slug)) {
      website.slug = await generateUniqueSlug(
        website.coupleNames || req.plan.name || 'our-wedding',
        req.plan.id
      );
    }
    const readiness = getPublishReadiness(website);
    if (!readiness.ready) {
      return res
        .status(400)
        .json({ error: 'Website is not ready to publish yet.', checklist: readiness });
    }
    const now = new Date().toISOString();
    website = { ...website, status: 'published', publishedAt: now, updatedAt: now };
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: website, updatedAt: now } }
    );
    res.json({ success: true, website: scrubCustomerWebsite(website) });
  }
);

router.post(
  '/:planId/wedding-website/unpublish',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    if (!req.plan.weddingWebsite) {
      return res.status(404).json({ error: 'Wedding website not found' });
    }
    const now = new Date().toISOString();
    const website = { ...req.plan.weddingWebsite, status: 'draft', updatedAt: now };
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: website, updatedAt: now } }
    );
    res.json({ success: true });
  }
);

router.get('/public/wedding-websites/:slug', async (req, res) => {
  const slug = slugify(req.params.slug);
  if (isReservedSlug(slug)) {
    return res.status(404).json({ error: 'This wedding website is not available.' });
  }
  const plan = await dbUnified.findOne('plans', { 'weddingWebsite.slug': slug });
  if (!plan || plan.weddingWebsite.status !== 'published') {
    return res.status(404).json({ error: 'This wedding website is not available.' });
  }
  const site = plan.weddingWebsite;
  if (site.visibility === 'password' && !hasWeddingPasswordAccess(req, site)) {
    return res
      .status(401)
      .json({ error: 'Password required', passwordRequired: true, noindex: true });
  }
  res.json({ success: true, website: safePublic(site) });
});

router.post('/public/wedding-websites/:slug/access', passwordAccessLimiter, async (req, res) => {
  const slug = slugify(req.params.slug);
  if (isReservedSlug(slug)) {
    return res.status(404).json({ error: 'This wedding website is not available.' });
  }
  const plan = await dbUnified.findOne('plans', { 'weddingWebsite.slug': slug });
  if (!plan || plan.weddingWebsite.status !== 'published') {
    return res.status(404).json({ error: 'This wedding website is not available.' });
  }
  const site = plan.weddingWebsite;
  if (site.visibility !== 'password') {
    return res.json({ success: true, passwordRequired: false });
  }
  const password = sanitize(req.body.password, 300);
  if (!password || !site.passwordHash || !verifyWeddingPassword(password, site.passwordHash)) {
    return res
      .status(403)
      .json({ error: 'That password was not recognised.', passwordRequired: true });
  }
  const token = signAccessToken(site.slug);
  res.cookie(passwordCookieName(site.slug), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: PASSWORD_ACCESS_TTL_MS,
    path: '/',
  });
  return res.json({ success: true, expiresInSeconds: Math.floor(PASSWORD_ACCESS_TTL_MS / 1000) });
});

router.post('/public/wedding-websites/:slug/rsvp', writeLimiter, async (req, res) => {
  const slug = slugify(req.params.slug);
  if (isReservedSlug(slug)) {
    return res.status(404).json({ error: 'This wedding website is not available.' });
  }
  const plan = await dbUnified.findOne('plans', { 'weddingWebsite.slug': slug });
  if (!plan || plan.weddingWebsite.status !== 'published') {
    return res.status(404).json({ error: 'This wedding website is not available.' });
  }
  const site = plan.weddingWebsite;
  if (site.visibility === 'password' && !hasWeddingPasswordAccess(req, site)) {
    return res
      .status(403)
      .json({ error: 'Password access is required before RSVP.', passwordRequired: true });
  }
  if (site.rsvpEnabled === false) {
    return res.status(400).json({ error: 'RSVPs are not currently open.' });
  }
  if (isDeadlinePassed(site.rsvpDeadline)) {
    return res.status(400).json({ error: 'RSVPs are now closed.' });
  }
  if (req.body.website) {
    return res.status(400).json({ error: 'Invalid submission.' });
  }
  const name = sanitize(req.body.guestName, MAX.name);
  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Please provide your name.' });
  }
  const email = sanitize(req.body.email, MAX.email);
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email.' });
  }
  const attending = req.body.attending;
  if (!(
    attending === true ||
    attending === false ||
    attending === 'true' ||
    attending === 'false'
  )) {
    return res.status(400).json({ error: 'Invalid RSVP status.' });
  }
  const isAttending = attending === true || attending === 'true';
  const partySize = Math.max(1, Math.min(20, Number(req.body.partySize) || 1));
  const childrenCount = Math.max(0, Math.min(10, Number(req.body.childrenCount) || 0));
  const now = new Date().toISOString();
  const normalized = v =>
    String(v || '')
      .toLowerCase()
      .trim();
  const list = guestListForPlan(plan);
  let guest = list.find(g => email && normalized(g.email) === normalized(email));
  if (!guest) {
    guest = list.find(g => normalized(g.name) === normalized(name));
  }
  const patch = {
    name,
    email,
    phone: sanitize(req.body.phone, MAX.phone),
    rsvpStatus: isAttending ? 'attending' : 'declined',
    source: guest?.source || 'public_rsvp',
    partySize,
    plusOneName: sanitize(req.body.plusOneName, MAX.name),
    childrenCount,
    mealChoice: sanitize(req.body.mealChoice, 100),
    dietaryRequirements: sanitize(req.body.dietaryRequirements, 500),
    accessibilityRequirements: sanitize(req.body.accessibilityRequirements, 500),
    songRequest: sanitize(req.body.songRequest, 200),
    notes: sanitize(req.body.notes, MAX.note),
    customAnswers: sanitizeCustomAnswers(req.body.customAnswers),
    rsvpUpdatedAt: now,
    updatedAt: now,
  };
  if (guest) {
    Object.assign(guest, patch);
  } else {
    list.push({
      id: uid('guest'),
      planId: plan.id,
      userId: plan.userId,
      ...patch,
      rsvpSubmittedAt: now,
      createdAt: now,
    });
  }
  await dbUnified.updateOne(
    'plans',
    { id: plan.id },
    { $set: { ...setGuestList(plan, list), updatedAt: now } }
  );
  return res.json({ success: true, message: 'Thank you — your RSVP has been received.' });
});

router.post(
  '/:planId/wedding-website/regenerate-slug',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    if (!req.plan.weddingWebsite) {
      return res.status(404).json({ error: 'Wedding website not found' });
    }
    const seed =
      req.body.seed || req.plan.weddingWebsite.coupleNames || req.plan.name || 'our-wedding';
    const slug = await generateUniqueSlug(seed, req.plan.id);
    const website = { ...req.plan.weddingWebsite, slug, updatedAt: new Date().toISOString() };
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: website, updatedAt: website.updatedAt } }
    );
    res.json({ success: true, website: scrubCustomerWebsite(website) });
  }
);

function getTables(plan) {
  return Array.isArray(plan.tables) ? plan.tables : [];
}
router.get('/:planId/tables', authRequired, getOwnedPlan, (req, res) =>
  res.json({ success: true, tables: getTables(req.plan) })
);
router.post(
  '/:planId/tables',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    const now = new Date().toISOString();
    const t = {
      id: uid('table'),
      planId: req.plan.id,
      name: sanitize(req.body.name || 'Table', 80),
      type: req.body.type || 'round',
      capacity: Math.max(1, Math.min(30, Number(req.body.capacity) || 10)),
      guestIds: [],
      notes: sanitize(req.body.notes, 500),
      createdAt: now,
      updatedAt: now,
    };
    const tables = getTables(req.plan);
    tables.push(t);
    await dbUnified.updateOne('plans', { id: req.plan.id }, { $set: { tables, updatedAt: now } });
    res.status(201).json({ success: true, table: t });
  }
);
router.patch(
  '/:planId/tables/:tableId',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    const tables = getTables(req.plan);
    const i = tables.findIndex(t => t.id === req.params.tableId);
    if (i < 0) {
      return res.status(404).json({ error: 'Table not found' });
    }
    const now = new Date().toISOString();
    const t = { ...tables[i] };
    if (req.body.name !== undefined) {
      t.name = sanitize(req.body.name, 80);
    }
    if (req.body.type !== undefined) {
      t.type = sanitize(req.body.type, 40);
    }
    if (req.body.capacity !== undefined) {
      t.capacity = Math.max(1, Math.min(30, Number(req.body.capacity) || 10));
    }
    if (req.body.notes !== undefined) {
      t.notes = sanitize(req.body.notes, 500);
    }
    t.updatedAt = now;
    tables[i] = t;
    await dbUnified.updateOne('plans', { id: req.plan.id }, { $set: { tables, updatedAt: now } });
    res.json({ success: true, table: t });
  }
);
router.delete(
  '/:planId/tables/:tableId',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    const tableId = req.params.tableId;
    const currentTables = getTables(req.plan);
    const deletedTable = currentTables.find(t => t.id === tableId);
    const tables = currentTables.filter(t => t.id !== tableId);
    const deletedTableName = String(deletedTable?.name || '').trim();
    const guests = guestListForPlan(req.plan).map(g => {
      const matchesTableId = g.tableId === tableId;
      const matchesTableName =
        deletedTableName && String(g.tableName || '').trim() === deletedTableName;
      const matchesLegacyTableField =
        (deletedTableName && String(g.table || '').trim() === deletedTableName) ||
        g.table === tableId;
      if (!matchesTableId && !matchesTableName && !matchesLegacyTableField) {
        return g;
      }
      return {
        ...g,
        tableId: null,
        tableName: null,
        table: null,
        updatedAt: new Date().toISOString(),
      };
    });
    const now = new Date().toISOString();
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { tables, ...setGuestList(req.plan, guests), updatedAt: now } }
    );
    res.json({ success: true });
  }
);
router.post(
  '/:planId/tables/:tableId/assign-guest',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    const tableId = req.params.tableId;
    const guestId = req.body.guestId;
    const tables = getTables(req.plan);
    const t = tables.find(x => x.id === tableId);
    if (!t) {
      return res.status(404).json({ error: 'Table not found' });
    }
    const guests = guestListForPlan(req.plan);
    const gi = guests.findIndex(g => g.id === guestId && g.rsvpStatus === 'attending');
    if (gi < 0) {
      return res.status(400).json({ error: 'Attending guest not found' });
    }
    tables.forEach(tb => (tb.guestIds = (tb.guestIds || []).filter(id => id !== guestId)));
    t.guestIds = [...(t.guestIds || []), guestId];
    guests[gi] = {
      ...guests[gi],
      tableId: t.id,
      tableName: t.name,
      updatedAt: new Date().toISOString(),
    };
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      {
        $set: {
          tables,
          [Array.isArray(req.plan.guests) ? 'guests' : 'guestList']: guests,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    res.json({ success: true });
  }
);
router.post(
  '/:planId/tables/unassign-guest',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  getOwnedPlan,
  async (req, res) => {
    const guestId = req.body.guestId;
    const tables = getTables(req.plan);
    tables.forEach(tb => (tb.guestIds = (tb.guestIds || []).filter(id => id !== guestId)));
    const guests = guestListForPlan(req.plan).map(g =>
      g.id === guestId
        ? { ...g, tableId: null, tableName: null, updatedAt: new Date().toISOString() }
        : g
    );
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      {
        $set: {
          tables,
          [Array.isArray(req.plan.guests) ? 'guests' : 'guestList']: guests,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    res.json({ success: true });
  }
);
router.get('/:planId/seating-summary', authRequired, getOwnedPlan, (req, res) => {
  const guests = guestListForPlan(req.plan);
  const attending = guests.filter(g => g.rsvpStatus === 'attending');
  const tables = getTables(req.plan);
  res.json({
    success: true,
    summary: {
      tables: tables.length,
      seated: attending.filter(g => g.tableId || g.tableName || g.table).length,
      unseated: attending.filter(g => !(g.tableId || g.tableName || g.table)).length,
      overCapacity: tables.filter(t => (t.guestIds || []).length > Number(t.capacity || 0)).length,
    },
  });
});

module.exports = router;
