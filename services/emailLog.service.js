'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const COLLECTION = 'email_logs';
const STATUS_VALUES = new Set([
  'attempted',
  'sent',
  'failed',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'suppressed',
  'unknown',
]);

const SAFE_TEMPLATE_KEYS = new Set([
  'template',
  'category',
  'audience',
  'isTest',
  'test',
  'campaign',
  'campaignId',
  'title',
  'role',
  'source',
]);

function nowIso() {
  return new Date().toISOString();
}

function normaliseRecipients(to) {
  if (Array.isArray(to)) {
    return to
      .map(String)
      .flatMap(value => value.split(','))
      .map(v => v.trim())
      .filter(Boolean);
  }
  return String(to || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function normaliseTags(tags) {
  if (!tags) {
    return [];
  }
  if (Array.isArray(tags)) {
    return tags
      .map(String)
      .map(v => v.trim())
      .filter(Boolean)
      .slice(0, 10);
  }
  return String(tags)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function safeString(value, max = 500) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value).slice(0, max);
}

function summariseTemplateData(templateData = {}) {
  if (!templateData || typeof templateData !== 'object' || Array.isArray(templateData)) {
    return null;
  }
  const summary = {};
  for (const [key, value] of Object.entries(templateData)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('link') ||
      lower.includes('url') ||
      lower.includes('body') ||
      lower.includes('message') ||
      lower.includes('html') ||
      lower.includes('text')
    ) {
      continue;
    }
    if (!SAFE_TEMPLATE_KEYS.has(key) && !SAFE_TEMPLATE_KEYS.has(lower)) {
      continue;
    }
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      summary[key] = typeof value === 'string' ? value.slice(0, 160) : value;
    }
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

function toPublicLog(log, includeEvents = false) {
  if (!log) {
    return null;
  }
  const safe = {
    id: log.id,
    to: log.to,
    recipients: log.recipients || [],
    from: log.from || null,
    subject: log.subject || '(from template)',
    template: log.template || null,
    templateDataSummary: log.templateDataSummary || null,
    messageStream: log.messageStream || 'outbound',
    tags: log.tags || [],
    provider: log.provider || 'postmark',
    status: log.status || 'unknown',
    postmarkMessageId: log.postmarkMessageId || null,
    attemptedAt: log.attemptedAt || null,
    sentAt: log.sentAt || null,
    lastEventAt: log.lastEventAt || null,
    errorMessage: log.errorMessage || null,
    createdAt: log.createdAt || null,
    updatedAt: log.updatedAt || null,
  };
  if (includeEvents) {
    safe.events = Array.isArray(log.events) ? log.events : [];
  }
  return safe;
}

function createAttempt(options = {}) {
  const timestamp = nowIso();
  const recipients = normaliseRecipients(options.to);
  const log = {
    id: dbUnified.uid('email_log'),
    to: recipients.join(', '),
    recipients,
    from: safeString(options.from, 320),
    subject: safeString(options.subject || '(from template)', 500),
    template: safeString(options.template, 120),
    templateDataSummary: summariseTemplateData(options.templateData),
    messageStream: safeString(options.messageStream || 'outbound', 120),
    tags: normaliseTags(options.tags),
    provider: options.provider || 'postmark',
    status: 'attempted',
    postmarkMessageId: null,
    attemptedAt: timestamp,
    sentAt: null,
    lastEventAt: null,
    errorMessage: null,
    events: [
      {
        type: 'Attempted',
        timestamp,
        recipient: recipients[0] || null,
        summary: 'Send attempted',
        details: null,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return dbUnified.insertOne(COLLECTION, log);
}

function updateStatus(id, updates = {}) {
  if (!id) {
    return false;
  }
  const set = { ...updates, updatedAt: nowIso() };
  if (set.status && !STATUS_VALUES.has(set.status)) {
    set.status = 'unknown';
  }
  return dbUnified.updateOne(COLLECTION, id, set);
}

function buildFilter(query = {}) {
  const filter = {};
  const like = field => {
    const value = typeof query[field] === 'string' ? query[field].trim() : '';
    return value ? value.slice(0, 160).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  };

  const recipient = like('recipient');
  if (recipient) {
    filter.recipients = { $regex: recipient, $options: 'i' };
  }
  const subject = like('subject');
  if (subject) {
    filter.subject = { $regex: subject, $options: 'i' };
  }
  const template = like('template');
  if (template) {
    filter.template = { $regex: template, $options: 'i' };
  }
  const messageStream = like('messageStream');
  if (messageStream) {
    filter.messageStream = { $regex: messageStream, $options: 'i' };
  }
  const tag = like('tag');
  if (tag) {
    filter.tags = { $regex: tag, $options: 'i' };
  }
  const status = typeof query.status === 'string' ? query.status.trim().toLowerCase() : '';
  if (status && STATUS_VALUES.has(status)) {
    filter.status = status;
  }
  const dateFilter = {};
  if (query.fromDate && !Number.isNaN(Date.parse(query.fromDate))) {
    dateFilter.$gte = new Date(query.fromDate).toISOString();
  }
  if (query.toDate && !Number.isNaN(Date.parse(query.toDate))) {
    dateFilter.$lte = new Date(query.toDate).toISOString();
  }
  if (Object.keys(dateFilter).length > 0) {
    filter.createdAt = dateFilter;
  }
  return filter;
}

async function listLogs(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const requestedLimit = parseInt(query.limit, 10) || 25;
  const limit = Math.min(Math.max(requestedLimit, 1), 100);
  const skip = (page - 1) * limit;
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    dbUnified.findWithOptions(COLLECTION, filter, { sort: { createdAt: -1 }, skip, limit }),
    dbUnified.count(COLLECTION, filter),
  ]);
  return {
    items: items.map(item => toPublicLog(item, false)),
    pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
  };
}

async function getLog(id) {
  const log = await dbUnified.findOne(COLLECTION, { id: String(id || '') });
  return toPublicLog(log, true);
}

async function getSummary() {
  // Previously loaded the entire email_logs collection into memory on every
  // dashboard request to compute counts by hand. Delegates to dbUnified's
  // aggregation pipeline instead — a real database-side aggregation on
  // MongoDB, and an equivalent in-memory computation on the local-store
  // fallback (dev/test only, where the collection is small by construction).
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff24h = new Date(now - dayMs).toISOString();
  const cutoff7d = new Date(now - 7 * dayMs).toISOString();

  const [statusGroups, last24hResult, last7dResult, totalResult, lastWebhookResult] =
    await Promise.all([
      dbUnified.aggregate(COLLECTION, [{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      dbUnified.aggregate(COLLECTION, [
        { $match: { createdAt: { $gte: cutoff24h } } },
        { $count: 'count' },
      ]),
      dbUnified.aggregate(COLLECTION, [
        { $match: { createdAt: { $gte: cutoff7d } } },
        { $count: 'count' },
      ]),
      dbUnified.aggregate(COLLECTION, [{ $count: 'count' }]),
      dbUnified.aggregate(COLLECTION, [
        { $match: { lastEventAt: { $ne: null } } },
        { $sort: { lastEventAt: -1 } },
        { $limit: 1 },
        { $project: { lastEventAt: 1 } },
      ]),
    ]);

  const summary = {
    sent: 0,
    failed: 0,
    delivered: 0,
    bounced: 0,
    opened: 0,
    clicked: 0,
    complained: 0,
    suppressed: 0,
    last24h: last24hResult[0]?.count || 0,
    last7d: last7dResult[0]?.count || 0,
  };
  for (const group of statusGroups) {
    if (Object.prototype.hasOwnProperty.call(summary, group._id)) {
      summary[group._id] = group.count;
    }
  }

  const total = totalResult[0]?.count || 0;
  const bounceRate = total > 0 ? Math.round((summary.bounced / total) * 10000) / 100 : 0;
  const complaintRate = total > 0 ? Math.round((summary.complained / total) * 10000) / 100 : 0;
  const lastWebhookAt = lastWebhookResult[0]?.lastEventAt || null;

  return { summary, total, bounceRate, complaintRate, lastWebhookAt };
}

function mapPostmarkEventToStatus(type) {
  switch (type) {
    case 'Delivered':
      return 'delivered';
    case 'Opened':
      return 'opened';
    case 'LinkClicked':
      return 'clicked';
    case 'Bounced':
      return 'bounced';
    case 'SpamComplaint':
      return 'complained';
    case 'SubscriptionChanged':
      return 'suppressed';
    default:
      return 'unknown';
  }
}

function normaliseEventTimestamp(value) {
  const parsed = Date.parse(value || '');
  if (Number.isNaN(parsed)) {
    return nowIso();
  }
  return new Date(parsed).toISOString();
}

function summariseWebhookEvent(payload = {}) {
  const type = payload.RecordType || payload.Type || 'Unknown';
  if (type === 'Bounced') {
    return payload.Description || payload.Details || payload.Type || 'Bounce event received';
  }
  if (type === 'LinkClicked') {
    return 'Link click event received';
  }
  return `${type} event received`;
}

async function appendWebhookEvent(payload = {}) {
  const messageId = payload.MessageID || payload.MessageId || payload.MessageIDRaw;
  const type = payload.RecordType || payload.Type || 'Unknown';
  const timestamp =
    payload.ReceivedAt || payload.DeliveredAt || payload.BouncedAt || payload.Timestamp || nowIso();
  const event = {
    type,
    timestamp: normaliseEventTimestamp(timestamp),
    recipient: payload.Recipient || payload.Email || null,
    summary: summariseWebhookEvent(payload),
    details: {
      recordType: type,
      tag: payload.Tag || null,
      messageStream: payload.MessageStream || null,
      bounceType: payload.Type && type === 'Bounced' ? payload.Type : null,
    },
  };

  if (!messageId) {
    return { matched: false, reason: 'missing_message_id' };
  }

  const existing = await dbUnified.findOne(COLLECTION, { postmarkMessageId: messageId });
  if (!existing) {
    logger.warn('[postmark-webhook] Unknown MessageID received for email log update');
    return { matched: false, reason: 'unknown_message_id' };
  }

  const events = Array.isArray(existing.events) ? existing.events.concat(event) : [event];
  await updateStatus(existing.id, {
    status: mapPostmarkEventToStatus(type),
    lastEventAt: event.timestamp,
    events,
  });
  return { matched: true, id: existing.id };
}

module.exports = {
  COLLECTION,
  createAttempt,
  updateStatus,
  listLogs,
  getLog,
  getSummary,
  appendWebhookEvent,
  normaliseRecipients,
  normaliseTags,
  summariseTemplateData,
  toPublicLog,
};
