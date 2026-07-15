'use strict';

const CONVERSION_DEFINITIONS = [
  ['registration_completed', 'Registrations completed'],
  ['supplier_profile_completed', 'Supplier profiles completed'],
  ['package_created', 'Packages created'],
  ['package_published', 'Packages published'],
  ['quote_request_submitted', 'Quote requests sent'],
  ['enquiry_submitted', 'Enquiries sent'],
  ['conversion_completed', 'Other completed conversions'],
];

const CONVERSION_EVENTS = new Set(CONVERSION_DEFINITIONS.map(([eventName]) => eventName));
const LEAD_EVENTS = new Set(['quote_request_submitted', 'enquiry_submitted']);

function round(value, decimalPlaces = 1) {
  const multiplier = 10 ** decimalPlaces;
  return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function sessionKey(event) {
  return event && event.sessionIdHash ? String(event.sessionIdHash) : '';
}

function eventProperties(event) {
  return event && event.properties && typeof event.properties === 'object' ? event.properties : {};
}

function eventTimestamp(event) {
  const timestamp = Date.parse(event && event.timestamp);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function homepageGroup(pagePath) {
  const path = String(pagePath || '/').toLowerCase();
  if (path === '/' || path === '/index.html') {
    return { key: 'live', label: 'Live homepage' };
  }
  if (path.startsWith('/home-v1')) {
    return { key: 'v1-preview', label: 'Homepage 1 preview' };
  }
  if (path.startsWith('/home-v2')) {
    return { key: 'v2-preview', label: 'Homepage 2 preview' };
  }
  if (path.startsWith('/home-v3')) {
    return { key: 'v3-preview', label: 'Homepage 3 preview' };
  }
  return null;
}

function homepageDescriptor(pagePath, pageType) {
  const group = homepageGroup(pagePath);
  if (group) {
    return group;
  }
  if (pageType === 'home') {
    const path = String(pagePath || '/');
    return { key: path, label: path };
  }
  return null;
}

function buildHomepagePerformanceFromSummary(baseSummary) {
  const groups = new Map();

  for (const page of safeArray(baseSummary && baseSummary.pages)) {
    const resolved = homepageDescriptor(page.pagePath, page.pageType);
    if (!resolved) {
      continue;
    }
    if (!groups.has(resolved.key)) {
      groups.set(resolved.key, {
        key: resolved.key,
        label: resolved.label,
        paths: new Set(),
        views: 0,
        sessions: 0,
        activeSeconds: 0,
        engagedSessionEstimate: 0,
        exits: 0,
        bounces: 0,
      });
    }

    const row = groups.get(resolved.key);
    row.paths.add(page.pagePath);
    row.views += Number(page.views) || 0;
    row.sessions += Number(page.sessions) || 0;
    row.activeSeconds += Number(page.totalActiveSeconds) || 0;
    row.engagedSessionEstimate +=
      ((Number(page.engagedRate) || 0) / 100) * (Number(page.sessions) || 0);
    row.exits += ((Number(page.exitRate) || 0) / 100) * (Number(page.views) || 0);
    row.bounces += ((Number(page.bounceRate) || 0) / 100) * (Number(page.sessions) || 0);
  }

  return Array.from(groups.values())
    .map(row => ({
      key: row.key,
      label: row.label,
      paths: Array.from(row.paths),
      views: row.views,
      sessions: row.sessions,
      avgActiveSeconds: round(row.activeSeconds / Math.max(row.sessions, 1), 1),
      engagedRate: round((row.engagedSessionEstimate / Math.max(row.sessions, 1)) * 100, 1),
      exitRate: round((row.exits / Math.max(row.views, 1)) * 100, 1),
      bounceRate: round((row.bounces / Math.max(row.sessions, 1)) * 100, 1),
      isHistoricalVersionExact: row.key !== 'live',
    }))
    .sort((left, right) => right.views - left.views || right.sessions - left.sessions);
}

function ensureHomepageEventGroup(groups, descriptor) {
  if (!groups.has(descriptor.key)) {
    groups.set(descriptor.key, {
      key: descriptor.key,
      label: descriptor.label,
      paths: new Set(),
      views: 0,
      activeSeconds: 0,
      sessions: new Map(),
      exits: 0,
      bounces: 0,
    });
  }
  return groups.get(descriptor.key);
}

function homepageSession(group, key) {
  if (!group.sessions.has(key)) {
    group.sessions.set(key, { views: 0, activeSeconds: 0 });
  }
  return group.sessions.get(key);
}

function buildHomepagePerformanceFromEvents(events) {
  const groups = new Map();
  const sessions = new Map();
  const orderedEvents = safeArray(events)
    .filter(event => event && sessionKey(event))
    .slice()
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));

  for (const event of orderedEvents) {
    const key = sessionKey(event);
    if (!sessions.has(key)) {
      sessions.set(key, {
        pageViews: 0,
        activeSeconds: 0,
        lastPageGroup: null,
        lastPageAt: -1,
      });
    }
    const session = sessions.get(key);
    const descriptor = homepageDescriptor(event.pagePath, event.pageType);
    const timestamp = eventTimestamp(event);

    if (event.event === 'page_view') {
      session.pageViews += 1;
      if (timestamp >= session.lastPageAt) {
        session.lastPageAt = timestamp;
        session.lastPageGroup = descriptor ? descriptor.key : null;
      }
      if (descriptor) {
        const group = ensureHomepageEventGroup(groups, descriptor);
        group.paths.add(String(event.pagePath || '/'));
        group.views += 1;
        homepageSession(group, key).views += 1;
      }
    }

    if (event.event === 'page_engagement') {
      const seconds = Math.min(
        Math.max(Number(eventProperties(event).activeSeconds) || 0, 0),
        3600
      );
      session.activeSeconds += seconds;
      if (descriptor) {
        const group = ensureHomepageEventGroup(groups, descriptor);
        group.paths.add(String(event.pagePath || '/'));
        group.activeSeconds += seconds;
        homepageSession(group, key).activeSeconds += seconds;
      }
    }
  }

  for (const session of sessions.values()) {
    if (!session.lastPageGroup || !groups.has(session.lastPageGroup)) {
      continue;
    }
    const group = groups.get(session.lastPageGroup);
    group.exits += 1;
    if (session.pageViews === 1 && session.activeSeconds < 10) {
      group.bounces += 1;
    }
  }

  return Array.from(groups.values())
    .map(group => {
      const sessionCount = group.sessions.size;
      const engagedSessions = Array.from(group.sessions.values()).filter(
        session => session.activeSeconds >= 10 || session.views >= 2
      ).length;
      return {
        key: group.key,
        label: group.label,
        paths: Array.from(group.paths),
        views: group.views,
        sessions: sessionCount,
        avgActiveSeconds: round(group.activeSeconds / Math.max(sessionCount, 1), 1),
        engagedRate: round((engagedSessions / Math.max(sessionCount, 1)) * 100, 1),
        exitRate: round((group.exits / Math.max(group.views, 1)) * 100, 1),
        bounceRate: round((group.bounces / Math.max(sessionCount, 1)) * 100, 1),
        isHistoricalVersionExact: group.key !== 'live',
      };
    })
    .sort((left, right) => right.views - left.views || right.sessions - left.sessions);
}

function buildHomepagePerformance(baseSummary, events) {
  return Array.isArray(events)
    ? buildHomepagePerformanceFromEvents(events)
    : buildHomepagePerformanceFromSummary(baseSummary);
}

function ensureEntity(map, id, type) {
  if (!id) {
    return null;
  }
  const key = String(id).slice(0, 120);
  if (!map.has(key)) {
    map.set(key, {
      id: key,
      type,
      views: 0,
      resultClicks: 0,
      saves: 0,
      leads: 0,
      conversions: 0,
      sessions: new Set(),
      leadSessions: new Set(),
    });
  }
  return map.get(key);
}

function entityIds(event) {
  const properties = eventProperties(event);
  let supplierId = properties.supplierId || '';
  let packageId = properties.packageId || '';

  if (event.event === 'result_clicked') {
    if (properties.resultType === 'supplier') {
      supplierId = supplierId || properties.resultId;
    }
    if (properties.resultType === 'package') {
      packageId = packageId || properties.resultId;
    }
  }

  if (event.event === 'shortlist_add') {
    if (properties.itemType === 'supplier') {
      supplierId = supplierId || properties.itemId;
    }
    if (properties.itemType === 'package') {
      packageId = packageId || properties.itemId;
    }
  }

  return { supplierId, packageId };
}

function updateEntity(entity, event) {
  if (!entity) {
    return;
  }
  const key = sessionKey(event);
  if (key) {
    entity.sessions.add(key);
  }

  const isEntityView =
    (entity.type === 'supplier' && event.event === 'supplier_profile_view') ||
    (entity.type === 'package' && event.event === 'package_view');
  if (isEntityView) {
    entity.views += 1;
  }
  if (event.event === 'result_clicked') {
    entity.resultClicks += 1;
  }
  if (event.event === 'shortlist_add' || event.event === 'package_add_to_plan') {
    entity.saves += 1;
  }
  if (LEAD_EVENTS.has(event.event)) {
    entity.leads += 1;
    if (key) {
      entity.leadSessions.add(key);
    }
  }
  if (CONVERSION_EVENTS.has(event.event)) {
    entity.conversions += 1;
  }
}

function finaliseEntities(map) {
  return Array.from(map.values())
    .map(entity => {
      const leadSessionRate = round(
        (entity.leadSessions.size / Math.max(entity.sessions.size, 1)) * 100,
        1
      );
      return {
        id: entity.id,
        type: entity.type,
        views: entity.views,
        resultClicks: entity.resultClicks,
        saves: entity.saves,
        leads: entity.leads,
        enquiries: entity.leads,
        conversions: entity.conversions,
        sessions: entity.sessions.size,
        leadSessions: entity.leadSessions.size,
        leadSessionRate,
        enquiryRate: leadSessionRate,
      };
    })
    .sort(
      (left, right) =>
        right.leads - left.leads || right.saves - left.saves || right.views - left.views
    )
    .slice(0, 12);
}

function buildEntityPerformance(events) {
  const suppliers = new Map();
  const packages = new Map();

  for (const event of safeArray(events)) {
    const ids = entityIds(event);
    updateEntity(ensureEntity(suppliers, ids.supplierId, 'supplier'), event);
    updateEntity(ensureEntity(packages, ids.packageId, 'package'), event);
  }

  return {
    suppliers: finaliseEntities(suppliers),
    packages: finaliseEntities(packages),
  };
}

function buildConversionBreakdown(events, baseSummary) {
  const counts = new Map(CONVERSION_DEFINITIONS.map(([eventName]) => [eventName, 0]));
  const conversionSessions = new Set();

  for (const event of safeArray(events)) {
    if (!CONVERSION_EVENTS.has(event.event)) {
      continue;
    }
    counts.set(event.event, (counts.get(event.event) || 0) + 1);
    const key = sessionKey(event);
    if (key) {
      conversionSessions.add(key);
    }
  }

  const totalSessions =
    Number(baseSummary && baseSummary.totals && baseSummary.totals.sessions) || 0;
  return {
    actionCount: Array.from(counts.values()).reduce((sum, count) => sum + count, 0),
    uniqueSessions: conversionSessions.size,
    sessionRate: round((conversionSessions.size / Math.max(totalSessions, 1)) * 100, 1),
    byType: CONVERSION_DEFINITIONS.map(([eventName, label]) => ({
      event: eventName,
      label,
      count: counts.get(eventName) || 0,
    })),
  };
}

function buildRoleCoverage(events) {
  const sessionsByRole = new Map();
  for (const event of safeArray(events)) {
    const key = sessionKey(event);
    if (!key) {
      continue;
    }
    const role = ['customer', 'supplier'].includes(event.userRole) ? event.userRole : 'anonymous';
    if (!sessionsByRole.has(role)) {
      sessionsByRole.set(role, new Set());
    }
    sessionsByRole.get(role).add(key);
  }
  return Array.from(sessionsByRole.entries())
    .map(([role, sessions]) => ({ role, sessions: sessions.size }))
    .sort((left, right) => right.sessions - left.sessions);
}

function buildDecisionSummary(events, baseSummary) {
  const sourceEvents = safeArray(events);
  return {
    definitions: {
      conversions:
        'Conversion totals are completed analytics actions. Unique conversion sessions are shown separately and are not unique people.',
      sessions:
        'A session is an anonymous browser-tab session. It is not a persistent cross-visit visitor identity.',
      homepage:
        'Preview paths can be attributed to a version. Historical traffic to the live root path cannot be reassigned after the active homepage changes.',
      consent:
        'First-party behaviour analytics contains only traffic where Analytics Cookies consent was active.',
      marketplace:
        'Marketplace rate is the share of measured entity sessions that sent an enquiry or quote request. Starts and repeated page views do not inflate the rate.',
    },
    conversions: buildConversionBreakdown(sourceEvents, baseSummary || {}),
    homepagePerformance: buildHomepagePerformance(baseSummary || {}, sourceEvents),
    entities: buildEntityPerformance(sourceEvents),
    sessionsByRole: buildRoleCoverage(sourceEvents),
  };
}

module.exports = {
  CONVERSION_DEFINITIONS,
  buildDecisionSummary,
  buildHomepagePerformance,
  buildEntityPerformance,
  buildConversionBreakdown,
};
