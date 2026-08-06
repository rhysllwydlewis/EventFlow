'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const postmark = require('../utils/postmark');
const { notifyAdmins } = require('./notifyAdmins.service');

const TASK_COLLECTION = 'content_review_tasks';
const SETTINGS_COLLECTION = 'content_review_settings';
const SETTINGS_ID = 'content-review-automation';
const ALLOWED_STATUSES = new Set([
  'open',
  'in_review',
  'completed',
  'needs_changes',
  'legal_review',
]);
const ALLOWED_OUTCOMES = new Set([
  'no_change',
  'content_update_required',
  'policy_update_required',
  'operational_change_required',
  'solicitor_review_required',
]);

const DEFAULT_SETTINGS = Object.freeze({
  id: SETTINGS_ID,
  enabled: true,
  emailDigestEnabled: false,
});

function reviewPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Europe/London',
  }).formatToParts(now);
  const value = name => parts.find(part => part.type === name)?.value;
  return `${value('year')}-${value('month')}`;
}

function periodLabel(period) {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(`${period}-15T12:00:00Z`));
}

async function getSettings() {
  return {
    ...DEFAULT_SETTINGS,
    ...(await dbUnified.findOne(SETTINGS_COLLECTION, { id: SETTINGS_ID })),
  };
}

async function updateSettings(updates, actor) {
  const current = await dbUnified.findOne(SETTINGS_COLLECTION, { id: SETTINGS_ID });
  const systemUpdate = actor?.id === 'system';
  const next = {
    ...DEFAULT_SETTINGS,
    ...current,
    enabled: updates.enabled === undefined ? (current?.enabled ?? true) : Boolean(updates.enabled),
    emailDigestEnabled:
      updates.emailDigestEnabled === undefined
        ? (current?.emailDigestEnabled ?? false)
        : Boolean(updates.emailDigestEnabled),
    lastInspectedDeploymentSha:
      !systemUpdate || updates.lastInspectedDeploymentSha === undefined
        ? current?.lastInspectedDeploymentSha || null
        : String(updates.lastInspectedDeploymentSha || '') || null,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.id || actor?.email || 'system',
  };
  if (current) {
    await dbUnified.updateOne(SETTINGS_COLLECTION, { id: SETTINGS_ID }, next);
  } else {
    await dbUnified.insertOne(SETTINGS_COLLECTION, next);
  }
  return next;
}

function taskDefinitions(period) {
  const label = periodLabel(period);
  return [
    {
      id: `article-review-${period}`,
      type: 'article_monthly_review',
      title: `Confirm article content review — ${label}`,
      description:
        'Confirm that the article library remains accurate. Publication and material-update SEO dates are not changed by this task.',
    },
    {
      id: `policy-review-${period}`,
      type: 'policy_monthly_triage',
      title: `Policy and product-change triage — ${label}`,
      description:
        'Review material product, provider, privacy, Community, payment, location, messaging and upload changes for policy impact.',
    },
  ];
}

async function sendDigest(created, settings) {
  if (!created.length) {
    return;
  }
  const actionUrl = '/admin-content?tab=legalDates';
  await notifyAdmins({
    type: 'reminder',
    title: `${created.length} content review task${created.length === 1 ? '' : 's'} due`,
    message: created.map(task => task.title).join('; '),
    actionUrl,
    actionText: 'Review tasks',
    priority: 'high',
    metadata: { category: 'content_review', taskIds: created.map(task => task.id) },
  });
  if (!settings.emailDigestEnabled) {
    return;
  }
  const admins = await dbUnified.find('users', { role: 'admin' });
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://event-flow.co.uk';
  await Promise.all(
    admins
      .filter(admin => admin.email)
      .map(admin =>
        postmark
          .sendMail({
            to: admin.email,
            subject: 'EventFlow content and policy reviews are due',
            text: `${created.map(task => `- ${task.title}`).join('\n')}\n\nReview: ${baseUrl}${actionUrl}`,
            tags: ['admin', 'content-review'],
          })
          .catch(error => logger.warn('[content-review] email digest failed:', error.message))
      )
  );
}

async function ensureMonthlyTasks(now = new Date()) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { created: [], settings, skipped: true };
  }
  const period = reviewPeriod(now);
  const created = [];
  for (const definition of taskDefinitions(period)) {
    if (await dbUnified.findOne(TASK_COLLECTION, { id: definition.id })) {
      continue;
    }
    const timestamp = now.toISOString();
    const task = {
      ...definition,
      period,
      status: 'open',
      outcome: null,
      note: '',
      assignedTo: null,
      dueAt: `${period}-07T17:00:00.000Z`,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      completedBy: null,
    };
    if (await dbUnified.insertOne(TASK_COLLECTION, task)) {
      created.push(task);
    }
  }
  await sendDigest(created, settings);
  return { created, settings, skipped: false };
}

async function listTasks() {
  const tasks = await dbUnified.read(TASK_COLLECTION);
  return (Array.isArray(tasks) ? tasks : []).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
}

async function updateTask(id, updates, actor) {
  const task = await dbUnified.findOne(TASK_COLLECTION, { id });
  if (!task) {
    return null;
  }
  const status = updates.status || task.status;
  const outcome = updates.outcome === undefined ? task.outcome : updates.outcome;
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error('Unsupported review status');
  }
  if (outcome && !ALLOWED_OUTCOMES.has(outcome)) {
    throw new Error('Unsupported review outcome');
  }
  if (status === 'completed' && !outcome) {
    throw new Error('A completed review requires an outcome');
  }
  const now = new Date().toISOString();
  const next = {
    status,
    outcome,
    note: typeof updates.note === 'string' ? updates.note.trim().slice(0, 4000) : task.note || '',
    assignedTo: updates.assignedTo === undefined ? task.assignedTo : updates.assignedTo || null,
    updatedAt: now,
    completedAt: status === 'completed' ? now : null,
    completedBy: status === 'completed' ? actor?.id || actor?.email || 'admin' : null,
  };
  await dbUnified.updateOne(TASK_COLLECTION, { id }, next);
  return { ...task, ...next };
}

async function createProductChangeTask({ headSha, baseSha, files }) {
  const id = `product-policy-review-${String(headSha).slice(0, 16)}`;
  const existing = await dbUnified.findOne(TASK_COLLECTION, { id });
  if (existing) {
    return { task: existing, created: false };
  }
  const now = new Date().toISOString();
  const task = {
    id,
    type: 'product_policy_impact',
    title: 'Product changes may require a policy review',
    description: `${files.length} relevant file${files.length === 1 ? '' : 's'} changed between deployments. Review the affected features and record whether policy wording or operational controls need to change.`,
    source: { headSha, baseSha, files: files.slice(0, 100) },
    period: reviewPeriod(),
    status: 'open',
    outcome: null,
    note: '',
    assignedTo: null,
    dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    completedBy: null,
  };
  const inserted = await dbUnified.insertOne(TASK_COLLECTION, task);
  if (inserted) {
    await sendDigest([task], await getSettings());
  }
  return { task, created: Boolean(inserted) };
}

module.exports = {
  ALLOWED_OUTCOMES,
  ALLOWED_STATUSES,
  DEFAULT_SETTINGS,
  SETTINGS_COLLECTION,
  TASK_COLLECTION,
  ensureMonthlyTasks,
  createProductChangeTask,
  getSettings,
  listTasks,
  periodLabel,
  reviewPeriod,
  updateSettings,
  updateTask,
};
