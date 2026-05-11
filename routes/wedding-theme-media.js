'use strict';

const express = require('express');
const { authRequired, requireVerifiedUser } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { stripHtml } = require('../utils/helpers');

const router = express.Router({ mergeParams: true });
const MAX_IMAGE_CHARS = 900000;
const MAX_GALLERY_ITEMS = 12;
const DEFAULT_PALETTE = {
  accentColor: '#0B8073',
  secondaryColor: '#F4A6C8',
  backgroundColor: '#FFF7FB',
  textColor: '#1E1B4B',
};

const sanitize = (value, max = 5000) =>
  value === null || value === undefined ? null : stripHtml(String(value)).trim().slice(0, max);
const slugify = value =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
const isHex = value => /^#[0-9a-f]{6}$/i.test(String(value || '').trim());

function colour(value, fallback) {
  const cleaned = String(value || '').trim();
  return isHex(cleaned) ? cleaned.toUpperCase() : fallback;
}

function image(value) {
  const cleaned = sanitize(value, MAX_IMAGE_CHARS);
  if (!cleaned || cleaned.length > MAX_IMAGE_CHARS) return '';
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('data:image/')) {
    return cleaned;
  }
  return '';
}

function galleryItem(item, index) {
  const imageUrl = image(item && (item.imageUrl || item.url || item.src));
  if (!imageUrl) return null;
  return {
    id: sanitize((item && item.id) || `gallery_${index}`, 80),
    imageUrl,
    alt: sanitize((item && (item.alt || item.caption)) || '', 160),
    caption: sanitize((item && item.caption) || '', 220),
  };
}

function themeMediaFromBody(body = {}) {
  const galleryInput = Array.isArray(body.galleryImages) ? body.galleryImages : [];
  return {
    accentColor: colour(body.accentColor, DEFAULT_PALETTE.accentColor),
    secondaryColor: colour(body.secondaryColor, DEFAULT_PALETTE.secondaryColor),
    backgroundColor: colour(body.backgroundColor, DEFAULT_PALETTE.backgroundColor),
    textColor: colour(body.textColor, DEFAULT_PALETTE.textColor),
    heroLayout: ['classic', 'editorial', 'full_bleed'].includes(String(body.heroLayout || '')) ? String(body.heroLayout) : 'classic',
    coverImageUrl: image(body.coverImageUrl || body.heroImageUrl),
    galleryImages: galleryInput.map(galleryItem).filter(Boolean).slice(0, MAX_GALLERY_ITEMS),
  };
}

function publicThemeMedia(site = {}) {
  return {
    accentColor: colour(site.accentColor, DEFAULT_PALETTE.accentColor),
    secondaryColor: colour(site.secondaryColor, DEFAULT_PALETTE.secondaryColor),
    backgroundColor: colour(site.backgroundColor, DEFAULT_PALETTE.backgroundColor),
    textColor: colour(site.textColor, DEFAULT_PALETTE.textColor),
    heroLayout: ['classic', 'editorial', 'full_bleed'].includes(String(site.heroLayout || '')) ? site.heroLayout : 'classic',
    coverImageUrl: image(site.coverImageUrl),
    galleryImages: Array.isArray(site.galleryImages) ? site.galleryImages.map(galleryItem).filter(Boolean).slice(0, MAX_GALLERY_ITEMS) : [],
  };
}

async function getOwnedPlan(req, res, next) {
  const plans = await dbUnified.read('plans');
  const plan = plans.find(p => p.id === req.params.planId && p.userId === req.user.id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  if (!plan.weddingWebsite) return res.status(404).json({ error: 'Wedding website not found' });
  req.plan = plan;
  next();
}

router.get('/:planId/wedding-website/theme-media', authRequired, getOwnedPlan, async (req, res) => {
  res.json({ success: true, themeMedia: publicThemeMedia(req.plan.weddingWebsite) });
});

router.patch('/:planId/wedding-website/theme-media', authRequired, requireVerifiedUser, csrfProtection, writeLimiter, getOwnedPlan, async (req, res) => {
  const themeMedia = themeMediaFromBody(req.body || {});
  const now = new Date().toISOString();
  const website = { ...req.plan.weddingWebsite, ...themeMedia, updatedAt: now };
  await dbUnified.updateOne('plans', { id: req.plan.id }, { $set: { weddingWebsite: website, updatedAt: now } });
  const scrubbed = { ...website };
  delete scrubbed.passwordHash;
  res.json({ success: true, themeMedia: publicThemeMedia(website), website: scrubbed });
});

router.get('/public/wedding-websites/:slug/theme-media', async (req, res) => {
  const slug = slugify(req.params.slug);
  const plans = await dbUnified.read('plans');
  const plan = plans.find(p => p.weddingWebsite && p.weddingWebsite.slug === slug);
  if (!plan || plan.weddingWebsite.status !== 'published') return res.status(404).json({ error: 'This wedding website is not available.' });
  if (plan.weddingWebsite.visibility === 'password') return res.status(401).json({ error: 'Password required', passwordRequired: true });
  res.json({ success: true, themeMedia: publicThemeMedia(plan.weddingWebsite) });
});

module.exports = router;
