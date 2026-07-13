'use strict';

const crypto = require('crypto');

const COLLECTION_NAME = 'behaviour_analytics_events';
const DEFAULT_RETENTION_DAYS = 90;

const ALLOWED_EVENTS = new Set([
  'page_view',
  'page_engagement',
  'scroll_depth',
  'outbound_click',
  'form_submit',
  'web_vital',
  'client_error',
  'search_performed',
  'filter_changed',
  'result_clicked',
  'shortlist_add',
  'shortlist_remove',
  'quote_request_started',
  'quote_request_submitted',
  'supplier_profile_view',
  'package_view',
  'package_add_to_plan',
  'enquiry_started',
  'enquiry_submitted',
  'registration_started',
  'registration_completed',
  'supplier_registration_started',
  'supplier_profile_completed',
  'package_created',
  'package_published',
  'checkout_started',
  'conversion_completed',
  'toc_click',
  'share_click',
]);

const ALLOWED_PROPERTY_KEYS = new Set([
  'activeSeconds',
  'category',
  'channel',
  'column',
  'conversionType',
  'errorName',
  'eventLabel',
  'filterName',
  'filterValue',
  'formAction',
  'formId',
  'guideSlug',
  'itemId',
  'itemType',
  'line',
  'linkText',
  'metricName',
  'metricRating',
  'metricValue',
  'packageId',
  'planId',
  'position',
  'resultId',
  'resultType',
  'resultsCount',
  'scrollDepth',
  'source',
  'supplierId',
  'tocTarget',
]);

const SENSITIVE_KEY_PATTERN = /(email|name|phone|address|password|token|secret|message|query|searchTerm|body|content)/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;

const CONVERSION_EVENTS = new Set([
  'registration_completed',
  'supplier_profile_completed',
  'package_published',
  'quote_request_submitted',
  'enquiry_submitted',
  'conversion_completed',
]);

const FUNNEL_STAGES = [
  {
    key: 'search',
    label: 'Search',
    events: new Set(['search_performed', 'filter_changed', 'result_clicked']),
  },
  {
    key: 'supplier',
    label: 'Supplier profile',
    events: new Set(['supplier_profile_view']),
  },
  {
    key: 'package',
    label: 'Package detail',
    events: new Set(['package_view']),
  },
  {
    key: 'save',
    label: 'Saved or added',
    events: new Set(['shortlist_add', 'package_add_to_plan']),
  },
  {
    key: 'conversion',
    label: 'Enquiry or conversion',
    events: new Set([
      'quote_request_submitted',
      'enquiry_submitted',
      'registration_completed',
      'conversion_completed',
    ]),
  },
];

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(Math.max(parsed, min), max);
}

function cleanString(value, maxLength = 120) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(PHONE_PATTERN, '[redacted-phone]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);

  return cleaned || null;
}

function normalizePagePath(value) {
  const raw = cleanString(value, 300);
  if (!raw) {
    return '/';
  }

  try {
    const parsed = new URL(raw, 'https://event-flow.local');
    const pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    return pathname.startsWith('/') ? pathname.slice(0, 220) : `/${pathname.slice(0, 219)}`;
  } catch (_error) {
    const pathname = raw.split(/[?#]/)[0].replace(/\/{2,}/g, '/');
    return pathname.startsWith('/') ? pathname.slice(0, 220) : `/${pathname.slice(0, 219)}`;
  }
}

function normalizeDomain(value) {
  const raw = cleanString(value, 300);
  if (!raw) {
    return 'direct';
  }

  try {
    const parsed = new URL(raw, 'https://event-flow.local');
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'event-flow.local' ? 'direct' : host.slice(0, 120);
  } catch (_error) {
    return 'direct';
  }
}

function normalizeDeviceType(value) {
  return ['desktop', 'tablet', 'mobile', 'other'].includes(value) ? value : 'other';
}

function normalizePageType(value) {
  const cleaned = cleanString(value, 40);
  return cleaned && /^[a-z0-9_-]+$/i.test(cleaned) ? cleaned.toLowerCase() : 'other';
}

function sanitizePropertyValue(key, value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (key === 'activeSeconds') {
      return clampNumber(value, 0, 3600);
    }
    if (key === 'scrollDepth' || key === 'metricRating') {
      return clampNumber(value, 0, 100);
    }
    if (key === 'metricValue') {
      return clampNumber(value, -1000000, 1000000);
    }
    return clampNumber(value, -1000000, 1000000);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const maxLength = ['itemId', 'resultId', 'supplierId', 'packageId', 'planId'].includes(key)
    ? 120
    : 160;
  return cleanString(value, maxLength);
}

function sanitizeProperties(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return {};
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    const cleanValue = sanitizePropertyValue(key, value);
    if (cleanValue !== null && cleanValue !== '') {
      sanitized[key] = cleanValue;
    }
  }
  return sanitized;
}

function hashIdentifier(value, salt) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return null;
  }
  const safeSalt = String(salt || 'eventflow-analytics');
  return crypto.createHmac('sha256', safeSalt).update(raw).digest('hex');
}

function sanitizeEvent(input, context = {}) {
  if (!input || typeof input !== 'object' || !ALLOWED_EVENTS.has(input.event)) {
    return null;
  }

  const salt = context.hashSalt || process.env.ANALYTICS_HASH_SALT || process.env.JWT_SECRET;
  const now = context.now instanceof Date ? context.now : new Date();
  const requestedTimestamp = new Date(input.timestamp || now);
  const timestamp = Number.isNaN(requestedTimestamp.getTime()) ? now : requestedTimestamp;
  const maxFuture = now.getTime() + 5 * 60 * 1000;
  const minPast = now.getTime() - 24 * 60 * 60 * 1000;
  const boundedTimestamp = new Date(
    Math.min(Math.max(timestamp.getTime(), minPast), maxFuture)
  ).toISOString();

  return {
    event: input.event,
    sessionIdHash: hashIdentifier(input.sessionId, salt),
    userIdHash: hashIdentifier(context.userId, salt),
    userRole: ['customer', 'supplier', 'admin'].includes(context.userRole)
      ? context.userRole
      : 'anonymous',
    pagePath: normalizePagePath(input.pagePath),
    pageType: normalizePageType(input.pageType),
    referrerDomain: normalizeDomain(input.referrerDomain),
    deviceType: normalizeDeviceType(input.deviceType),
    properties: sanitizeProperties(input.properties),
    timestamp: boundedTimestamp,
    createdAt: now,
    schemaVersion: 1,
  };
}

function round(value, decimals = 1) {
  const multiplier = 10 ** decimals;
  return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

function eventTime(event) {
  const time = Date.parse(event && event.timestamp);
  return Number.isNaN(time) ? 0 : time;
}

function getSessionKey(event, index) {
  return event.sessionIdHash || `unknown-${index}`;
}

function buildSummary(rawEvents, days = 30, now = new Date()) {
  const safeDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const cutoff = now.getTime() - safeDays * 24 * 60 * 60 * 1000;
  const events = (Array.isArray(rawEvents) ? rawEvents : [])
    .filter(event => event && ALLOWED_EVENTS.has(event.event) && eventTime(event) >= cutoff)
    .sort((a, b) => eventTime(a) - eventTime(b));

  const sessionStats = new Map();
  const pageStats = new Map();
  const daily = new Map();
  const eventCounts = new Map();
  const deviceCounts = new Map();
  const referrerCounts = new Map();
  const funnelSets = new Map(FUNNEL_STAGES.map(stage => [stage.key, new Set()]));

  let pageViews = 0;
  let activeSeconds = 0;
  let conversions = 0;
  let clientErrors = 0;

  events.forEach((event, index) => {
    const sessionKey = getSessionKey(event, index);
    if (!sessionStats.has(sessionKey)) {
      sessionStats.set(sessionKey, {
        activeSeconds: 0,
        pageViews: 0,
        pages: [],
      });
    }
    const session = sessionStats.get(sessionKey);
    const props = event.properties || {};
    const dayKey = new Date(event.timestamp).toISOString().slice(0, 10);
    if (!daily.has(dayKey)) {
      daily.set(dayKey, { date: dayKey, pageViews: 0, sessions: new Set(), activeSeconds: 0 });
    }
    const dailyRow = daily.get(dayKey);
    dailyRow.sessions.add(sessionKey);

    eventCounts.set(event.event, (eventCounts.get(event.event) || 0) + 1);

    for (const stage of FUNNEL_STAGES) {
      if (stage.events.has(event.event)) {
        funnelSets.get(stage.key).add(sessionKey);
      }
    }

    if (event.event === 'page_view') {
      pageViews += 1;
      session.pageViews += 1;
      session.pages.push(event.pagePath);
      dailyRow.pageViews += 1;

      deviceCounts.set(event.deviceType, (deviceCounts.get(event.deviceType) || 0) + 1);
      referrerCounts.set(
        event.referrerDomain || 'direct',
        (referrerCounts.get(event.referrerDomain || 'direct') || 0) + 1
      );

      if (!pageStats.has(event.pagePath)) {
        pageStats.set(event.pagePath, {
          pagePath: event.pagePath,
          pageType: event.pageType || 'other',
          views: 0,
          activeSeconds: 0,
          sessions: new Set(),
          exits: 0,
          bounces: 0,
        });
      }
      const page = pageStats.get(event.pagePath);
      page.views += 1;
      page.sessions.add(sessionKey);
    }

    if (event.event === 'page_engagement') {
      const seconds = clampNumber(props.activeSeconds, 0, 3600) || 0;
      activeSeconds += seconds;
      session.activeSeconds += seconds;
      dailyRow.activeSeconds += seconds;
      if (!pageStats.has(event.pagePath)) {
        pageStats.set(event.pagePath, {
          pagePath: event.pagePath,
          pageType: event.pageType || 'other',
          views: 0,
          activeSeconds: 0,
          sessions: new Set([sessionKey]),
          exits: 0,
          bounces: 0,
        });
      }
      const page = pageStats.get(event.pagePath);
      page.activeSeconds += seconds;
      page.sessions.add(sessionKey);
    }

    if (CONVERSION_EVENTS.has(event.event)) {
      conversions += 1;
    }
    if (event.event === 'client_error') {
      clientErrors += 1;
    }
  });

  for (const [sessionKey, session] of sessionStats.entries()) {
    if (session.pages.length === 0) {
      continue;
    }
    const lastPath = session.pages[session.pages.length - 1];
    const lastPage = pageStats.get(lastPath);
    if (lastPage) {
      lastPage.exits += 1;
      if (session.pageViews === 1 && session.activeSeconds < 10) {
        lastPage.bounces += 1;
      }
    }
    if (!lastPage || !lastPage.sessions.has(sessionKey)) {
      continue;
    }
  }

  const sessions = sessionStats.size;
  const engagedSessions = Array.from(sessionStats.values()).filter(
    session => session.activeSeconds >= 10 || session.pageViews >= 2
  ).length;

  const pages = Array.from(pageStats.values())
    .map(page => ({
      pagePath: page.pagePath,
      pageType: page.pageType,
      views: page.views,
      sessions: page.sessions.size,
      totalActiveSeconds: round(page.activeSeconds, 0),
      avgActiveSeconds: round(page.activeSeconds / Math.max(page.sessions.size, 1), 1),
      engagedRate: round(
        (Array.from(page.sessions).filter(key => {
          const session = sessionStats.get(key);
          return session && (session.activeSeconds >= 10 || session.pageViews >= 2);
        }).length /
          Math.max(page.sessions.size, 1)) *
          100,
        1
      ),
      exitRate: round((page.exits / Math.max(page.views, 1)) * 100, 1),
      bounceRate: round((page.bounces / Math.max(page.sessions.size, 1)) * 100, 1),
    }))
    .sort((a, b) => b.views - a.views || b.totalActiveSeconds - a.totalActiveSeconds)
    .slice(0, 50);

  const funnelBase = Math.max(funnelSets.get(FUNNEL_STAGES[0].key).size, 1);
  const funnel = FUNNEL_STAGES.map(stage => {
    const count = funnelSets.get(stage.key).size;
    return {
      key: stage.key,
      label: stage.label,
      sessions: count,
      rateFromSearch: round((count / funnelBase) * 100, 1),
    };
  });

  const mapCounts = map =>
    Array.from(map.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

  const recommendations = [];
  for (const page of pages) {
    if (page.views >= 5 && page.avgActiveSeconds < 12 && page.exitRate >= 50) {
      recommendations.push({
        severity: 'high',
        title: `Review ${page.pagePath}`,
        detail: `Visitors average ${page.avgActiveSeconds}s of active time and ${page.exitRate}% exit here. Check the opening content, next action and mobile layout.`,
      });
    } else if (page.views >= 5 && page.bounceRate >= 60) {
      recommendations.push({
        severity: 'medium',
        title: `High bounce rate on ${page.pagePath}`,
        detail: `${page.bounceRate}% of measured sessions leave quickly. Confirm the page matches the link or search intent that brought visitors there.`,
      });
    }
    if (recommendations.length >= 6) {
      break;
    }
  }

  if (clientErrors > 0) {
    recommendations.unshift({
      severity: 'high',
      title: 'Investigate client-side errors',
      detail: `${clientErrors} browser error${clientErrors === 1 ? '' : 's'} were captured in this period. Review recent deployments and affected page paths.`,
    });
  }
  if (pageViews === 0) {
    recommendations.push({
      severity: 'info',
      title: 'No consented behaviour data yet',
      detail: 'Data will appear after visitors consent to analytics and browse the deployed site.',
    });
  }

  return {
    periodDays: safeDays,
    generatedAt: now.toISOString(),
    totals: {
      pageViews,
      sessions,
      activeSeconds: round(activeSeconds, 0),
      avgActiveSecondsPerSession: round(activeSeconds / Math.max(sessions, 1), 1),
      engagedSessions,
      engagedSessionRate: round((engagedSessions / Math.max(sessions, 1)) * 100, 1),
      conversions,
      clientErrors,
    },
    pages,
    funnel,
    devices: mapCounts(deviceCounts),
    referrers: mapCounts(referrerCounts),
    events: mapCounts(eventCounts),
    daily: Array.from(daily.values())
      .map(row => ({
        date: row.date,
        pageViews: row.pageViews,
        sessions: row.sessions.size,
        activeSeconds: round(row.activeSeconds, 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    recommendations: recommendations.slice(0, 8),
  };
}

module.exports = {
  COLLECTION_NAME,
  DEFAULT_RETENTION_DAYS,
  ALLOWED_EVENTS,
  ALLOWED_PROPERTY_KEYS,
  CONVERSION_EVENTS,
  normalizePagePath,
  normalizeDomain,
  sanitizeProperties,
  sanitizeEvent,
  hashIdentifier,
  buildSummary,
};