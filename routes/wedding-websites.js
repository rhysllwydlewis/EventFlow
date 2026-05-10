'use strict';

const express = require('express');
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
]);

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
const ALLOWED_VISIBILITY = new Set(['private_link', 'public']);

const slugify = str =>
  String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);

async function isSlugTaken(slug, planId) {
  const plans = await dbUnified.read('plans');
  return plans.some(p => p.id !== planId && p.weddingWebsite && p.weddingWebsite.slug === slug);
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
    { key: 'slug', ok: !!sanitize(site.slug, 80) },
  ];
  return {
    ready: checks.every(c => c.ok),
    missing: checks.filter(c => !c.ok).map(c => c.key),
  };
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
    rsvpEnabled: site.rsvpEnabled !== false,
    rsvpDeadline: site.rsvpDeadline || null,
    rsvpIntroText: site.rsvpIntroText || '',
    mealOptions: site.mealOptions || [],
    customRsvpQuestions: site.customRsvpQuestions || [],
  };
}

router.get('/:planId/wedding-website', authRequired, getOwnedPlan, async (req, res) => {
  res.json({ success: true, website: req.plan.weddingWebsite || null });
});

router.post(
  '/wedding-workspace',
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    const plans = await dbUnified.read('plans');
    const existing = plans.find(
      p =>
        p.userId === req.user.id &&
        p.isWebsiteWorkspace &&
        p.source === 'wedding_website_quick_start'
    );
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
    await dbUnified.insertOne('plans', plan);
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
    const seed = req.plan.name || req.plan.eventName || 'our-wedding';
    const website = {
      id: uid('wedsite'),
      planId: req.plan.id,
      userId: req.user.id,
      slug: slugify(seed),
      status: 'draft',
      visibility: 'private_link',
      noindex: true,
      template: 'classic',
      accentColor: '#0B8073',
      coupleNames: sanitize(req.body.coupleNames || seed, 200),
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
    res.status(201).json({ success: true, website });
  }
);

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
    if (req.body.slug !== undefined) {
      const s = slugify(req.body.slug);
      if (!s || PUBLIC_SLUGS.has(s)) {
        return res.status(400).json({ error: 'Invalid slug' });
      }
      if (await isSlugTaken(s, req.plan.id)) {
        return res.status(409).json({ error: 'Slug is already in use.' });
      }
      patch.slug = s;
    }
    [
      'accommodationRecommendations',
      'taxiRecommendations',
      'localInfo',
      'faq',
      'weddingParty',
      'mealOptions',
      'customRsvpQuestions',
    ].forEach(k => {
      if (Array.isArray(req.body[k])) {
        patch[k] = req.body[k];
      }
    });
    if (req.body.rsvpEnabled !== undefined) {
      patch.rsvpEnabled = !!req.body.rsvpEnabled;
    }
    if (req.body.rsvpDeadline !== undefined) {
      patch.rsvpDeadline = req.body.rsvpDeadline || null;
    }
    if (req.body.visibility !== undefined) {
      if (!ALLOWED_VISIBILITY.has(String(req.body.visibility))) {
        return res
          .status(400)
          .json({ error: 'Password protected visibility is not yet available.' });
      }
      patch.visibility = String(req.body.visibility);
    }
    patch.updatedAt = new Date().toISOString();
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: patch, updatedAt: patch.updatedAt } }
    );
    res.json({ success: true, website: patch });
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
    const readiness = getPublishReadiness(req.plan.weddingWebsite);
    if (!readiness.ready) {
      return res.status(400).json({
        error: 'Website is not ready to publish yet.',
        checklist: readiness,
      });
    }
    const now = new Date().toISOString();
    const website = {
      ...req.plan.weddingWebsite,
      status: 'published',
      publishedAt: now,
      updatedAt: now,
    };
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: website, updatedAt: now } }
    );
    res.json({ success: true, website });
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
    res.json({ success: true, website });
  }
);

router.get('/public/wedding-websites/:slug', async (req, res) => {
  const plans = await dbUnified.read('plans');
  const plan = plans.find(p => p.weddingWebsite && p.weddingWebsite.slug === req.params.slug);
  if (
    !plan ||
    plan.weddingWebsite.status !== 'published' ||
    plan.weddingWebsite.visibility === 'password'
  ) {
    return res.status(404).json({ error: 'Wedding website not found' });
  }
  res.json({ success: true, website: safePublic(plan.weddingWebsite) });
});
router.post('/public/wedding-websites/:slug/rsvp', writeLimiter, async (req, res) => {
  const plans = await dbUnified.read('plans');
  const plan = plans.find(p => p.weddingWebsite && p.weddingWebsite.slug === req.params.slug);
  if (
    !plan ||
    plan.weddingWebsite.status !== 'published' ||
    plan.weddingWebsite.visibility === 'password'
  ) {
    return res.status(404).json({ error: 'Wedding website not found' });
  }
  const site = plan.weddingWebsite;
  if (site.visibility === 'password') {
    return res.status(403).json({ error: 'This wedding website is not currently available.' });
  }
  if (site.rsvpEnabled === false) {
    return res.status(400).json({ error: 'RSVPs are not currently open.' });
  }
  if (site.rsvpDeadline && new Date(site.rsvpDeadline) < new Date()) {
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
  if (
    !(attending === true || attending === false || attending === 'true' || attending === 'false')
  ) {
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
    customAnswers: Array.isArray(req.body.customAnswers) ? req.body.customAnswers.slice(0, 20) : [],
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
    const plans = await dbUnified.read('plans');
    const base = slugify(req.plan.weddingWebsite.coupleNames || req.plan.name || 'our-wedding');
    let slug = base || 'our-wedding';
    let i = 2;
    while (
      PUBLIC_SLUGS.has(slug) ||
      plans.some(p => p.id !== req.plan.id && p.weddingWebsite && p.weddingWebsite.slug === slug)
    ) {
      slug = `${base}-${i++}`;
    }
    const website = { ...req.plan.weddingWebsite, slug, updatedAt: new Date().toISOString() };
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { weddingWebsite: website, updatedAt: website.updatedAt } }
    );
    res.json({ success: true, website });
  }
);

function getTables(plan) {
  return Array.isArray(plan.tables) ? plan.tables : [];
}
router.get('/:planId/tables', authRequired, getOwnedPlan, async (req, res) =>
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
      {
        $set: {
          tables,
          ...setGuestList(req.plan, guests),
          updatedAt: now,
        },
      }
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
router.get('/:planId/seating-summary', authRequired, getOwnedPlan, async (req, res) => {
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
