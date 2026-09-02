/**
 * Shared data access for the SEO Insights dashboard collections.
 *
 * dbUnified.updateOne has no upsert option (it's a plain conditional
 * update), so every ingestion path needs the same find-then-write dance —
 * centralised here rather than repeated in each ingestion service.
 */

'use strict';

const dbUnified = require('../db-unified');
const {
  COLLECTIONS,
  SEO_SETTINGS_DOC_ID,
  DEFAULT_SEO_SETTINGS,
  normaliseKeyword,
} = require('../models/SeoInsights');

async function upsertById(collectionName, id, fields) {
  const existing = await dbUnified.findOne(collectionName, { id });
  if (existing) {
    await dbUnified.updateOne(collectionName, { id }, { $set: fields });
  } else {
    await dbUnified.insertOne(collectionName, { id, ...fields });
  }
}

async function recordIngestionStatus(source, status, extra = {}) {
  await upsertById(COLLECTIONS.seoIngestionStatus, source, {
    status,
    lastRunAt: new Date().toISOString(),
    ...extra,
  });
}

function getIngestionStatus(source) {
  return dbUnified.findOne(COLLECTIONS.seoIngestionStatus, { id: source });
}

function getAllIngestionStatus() {
  return dbUnified.find(COLLECTIONS.seoIngestionStatus, {});
}

async function getSettings() {
  const existing = await dbUnified.findOne(COLLECTIONS.seoSettings, { id: SEO_SETTINGS_DOC_ID });
  return existing || DEFAULT_SEO_SETTINGS;
}

async function setSettings(fields) {
  await upsertById(COLLECTIONS.seoSettings, SEO_SETTINGS_DOC_ID, fields);
  return getSettings();
}

async function isNoiseKeyword(keyword) {
  const normalised = normaliseKeyword(keyword);
  const flagged = await dbUnified.findOne(COLLECTIONS.seoNoiseKeywords, { id: normalised });
  return Boolean(flagged);
}

function listNoiseKeywords() {
  return dbUnified.find(COLLECTIONS.seoNoiseKeywords, {});
}

async function markNoiseKeyword(keyword, { markedBy, reason } = {}) {
  const normalised = normaliseKeyword(keyword);
  if (!normalised) {
    return null;
  }
  await upsertById(COLLECTIONS.seoNoiseKeywords, normalised, {
    query: normalised,
    markedBy: markedBy || 'admin',
    reason: reason || null,
    markedAt: new Date().toISOString(),
  });
  return normalised;
}

async function unmarkNoiseKeyword(keyword) {
  const normalised = normaliseKeyword(keyword);
  await dbUnified.deleteOne(COLLECTIONS.seoNoiseKeywords, normalised);
  return normalised;
}

module.exports = {
  upsertById,
  recordIngestionStatus,
  getIngestionStatus,
  getAllIngestionStatus,
  getSettings,
  setSettings,
  isNoiseKeyword,
  listNoiseKeywords,
  markNoiseKeyword,
  unmarkNoiseKeyword,
};
