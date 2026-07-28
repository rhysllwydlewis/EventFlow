from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Expected PR1 final-review marker not found in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))


def replace_between(path, start_marker, end_marker, replacement):
    p = Path(path)
    text = p.read_text()
    if replacement in text:
        return
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker)) if start >= 0 else -1
    if start < 0 or end < 0:
        raise SystemExit(f'Expected PR1 final-review block not found in {path}: {start_marker!r}')
    p.write_text(text[:start] + replacement + text[end:])


risk_path = 'services/partnerRegistrationRiskService.js'

# Preserve administrator override evidence after the active override expires.
replace_once(
    risk_path,
    """    appealRetentionDays: numberEnv(
      'PARTNER_ABUSE_APPEAL_RETENTION_DAYS',
      DEFAULT_APPEAL_RETENTION_DAYS,
      30,
      365
    ),
    reviewScore:""",
    """    appealRetentionDays: numberEnv(
      'PARTNER_ABUSE_APPEAL_RETENTION_DAYS',
      DEFAULT_APPEAL_RETENTION_DAYS,
      30,
      365
    ),
    overrideAuditRetentionDays: numberEnv(
      'PARTNER_ABUSE_OVERRIDE_AUDIT_RETENTION_DAYS',
      DEFAULT_APPEAL_RETENTION_DAYS,
      30,
      365
    ),
    reviewScore:""",
)

# Correct IPv6 /64 correlation when compressed IPv6 notation is used.
replace_between(
    risk_path,
    'function subnetForIp(ip) {',
    'function requestIp(req) {',
    """function expandIpv6(ip) {
  const clean = normaliseIp(ip);
  if (net.isIP(clean) !== 6) return [];
  const halves = clean.split('::');
  if (halves.length > 2) return [];
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return [];
  const expanded = [...head, ...Array(missing).fill('0'), ...tail];
  return expanded.map(part => part.padStart(4, '0').toLowerCase());
}

function subnetForIp(ip) {
  const clean = normaliseIp(ip);
  const version = net.isIP(clean);
  if (version === 4) {
    const parts = clean.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (version === 6) {
    const expanded = expandIpv6(clean);
    if (expanded.length !== 8) return '';
    return `${expanded.slice(0, 4).join(':')}::/64`;
  }
  return '';
}

""",
)

# Use indexed bounded queries in production instead of loading the entire abuse ledger on every signup.
replace_between(
    risk_path,
    'async function activeEmailOverride(',
    'function reputationProviderUrl(ip) {',
    """async function activeEmailOverride(canonicalEmailHash, nowIso = new Date().toISOString()) {
  if (!canonicalEmailHash) return null;
  let overrides;
  if (typeof dbUnified.findWithOptions === 'function') {
    overrides = await dbUnified.findWithOptions(
      'partner_abuse_overrides',
      { subjectHash: canonicalEmailHash, scope: 'registration' },
      { limit: 20, sort: { createdAt: -1 } }
    );
  } else {
    overrides = ((await dbUnified.read('partner_abuse_overrides')) || []).filter(
      item => item.subjectHash === canonicalEmailHash && item.scope === 'registration'
    );
  }
  const nowMs = Date.parse(nowIso);
  return (
    (overrides || []).find(item => {
      if (item.revokedAt) return false;
      const expiresAt = Date.parse(item.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    }) || null
  );
}

""",
)

replace_once(
    risk_path,
    'async function assessRegistration({ req, email, role, refCode = null, now = new Date() }) {',
    """async function loadRegistrationEvents({ now, config, canonicalEmailHash }) {
  const retentionCutoffIso = new Date(now.getTime() - config.retentionDays * 86400000).toISOString();
  const primaryOutcomes = ['attempt', 'created', 'blocked'];
  if (typeof dbUnified.findWithOptions === 'function') {
    const primaryEvents = await dbUnified.findWithOptions(
      'partner_abuse_events',
      { outcome: { $in: primaryOutcomes }, createdAt: { $gte: retentionCutoffIso } },
      { limit: 10000, sort: { createdAt: -1 } }
    );
    const canonicalEvents = canonicalEmailHash
      ? await dbUnified.findWithOptions(
          'partner_abuse_events',
          { canonicalEmailHash, createdAt: { $gte: retentionCutoffIso } },
          { limit: 50, sort: { createdAt: -1 } }
        )
      : [];
    return { primaryEvents: primaryEvents || [], canonicalEvents: canonicalEvents || [] };
  }

  const allEvents = (await dbUnified.read('partner_abuse_events')) || [];
  const cutoffMs = Date.parse(retentionCutoffIso);
  const retained = allEvents.filter(event => {
    const createdAt = Date.parse(event.createdAt);
    return Number.isFinite(createdAt) && createdAt >= cutoffMs;
  });
  return {
    primaryEvents: retained.filter(event => primaryOutcomes.includes(event.outcome)),
    canonicalEvents: canonicalEmailHash
      ? retained.filter(event => event.canonicalEmailHash === canonicalEmailHash)
      : [],
  };
}

async function assessRegistration({ req, email, role, refCode = null, now = new Date() }) {""",
)

replace_once(
    risk_path,
    """  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const allEvents = (await dbUnified.read('partner_abuse_events')) || [];
  const primaryEvents = allEvents.filter(event => ['attempt', 'blocked'].includes(event.outcome));
  const windowEvents = recentEvents(primaryEvents, config.ipWindowHours, nowMs);""",
    """  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const { primaryEvents, canonicalEvents } = await loadRegistrationEvents({
    now,
    config,
    canonicalEmailHash: signals.canonicalEmailHash,
  });
  const windowEvents = recentEvents(primaryEvents, config.ipWindowHours, nowMs);""",
)
replace_once(
    risk_path,
    """  const matchingCanonical = signals.canonicalEmailHash
    ? allEvents.filter(event => event.canonicalEmailHash === signals.canonicalEmailHash)
    : [];""",
    """  const matchingCanonical = signals.canonicalEmailHash ? canonicalEvents : [];""",
)

# Keep one final audit event per allowed registration so failed validation/CAPTCHA requests do not
# permanently inflate velocity counters.
replace_between(
    risk_path,
    'function registrationRiskGuard({ roleResolver } = {}) {',
    'async function createRegistrationOverride(',
    """function registrationRiskGuard({ roleResolver } = {}) {
  return async (req, res, next) => {
    try {
      const resolvedRole = roleResolver ? roleResolver(req) : req.body?.role;
      if (!['partner', 'supplier'].includes(resolvedRole)) return next();
      const assessment = await assessRegistration({
        req,
        email: req.body?.email,
        role: resolvedRole,
        refCode: req.body?.ref,
      });
      req.partnerRegistrationRisk = assessment;
      req.partnerRegistrationRiskFinalized = false;
      if (assessment.action === 'block') {
        req.partnerRegistrationRiskFinalized = true;
        await recordRegistrationEvent({ assessment, outcome: 'blocked' });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(403).json({
          error: 'We could not complete this registration automatically.',
          code: 'REGISTRATION_RISK_BLOCKED',
          message:
            'Please contact Partner Programme support if you believe this registration was blocked in error.',
          appealPath: '/api/partner/abuse-appeals',
        });
      }

      const attemptEvent = await recordRegistrationEvent({ assessment, outcome: 'attempt' });
      req.partnerRegistrationRiskEventId = attemptEvent.id;
      res.once('finish', () => {
        if (req.partnerRegistrationRiskFinalized) return;
        req.partnerRegistrationRiskFinalized = true;
        const finalOutcome = res.statusCode >= 400 ? 'failed' : 'completed_without_user';
        dbUnified
          .updateOne(
            'partner_abuse_events',
            { id: attemptEvent.id },
            { $set: { outcome: finalOutcome, finalizedAt: new Date().toISOString() } }
          )
          .catch(error =>
            logger.warn('[PARTNER-IDENTITY-RISK] Registration audit finalization failed', {
              error: error.message,
            })
          );
      });
      return next();
    } catch (error) {
      logger.error('[PARTNER-IDENTITY-RISK] Registration assessment failed', {
        error: error.message,
      });
      if (process.env.PARTNER_ABUSE_FAIL_OPEN === 'true') return next();
      return res.status(503).json({
        error: 'Registration is temporarily unavailable. Please try again shortly.',
        code: 'REGISTRATION_RISK_UNAVAILABLE',
      });
    }
  };
}

async function completeRegistrationRisk(req, userId) {
  const assessment = req.partnerRegistrationRisk;
  if (!assessment) return null;
  await persistUserRegistrationRisk(userId, assessment);

  if (req.partnerRegistrationRiskEventId) {
    const finalizedAt = new Date().toISOString();
    const updated = await dbUnified.updateOne(
      'partner_abuse_events',
      { id: req.partnerRegistrationRiskEventId },
      { $set: { outcome: 'created', userId, finalizedAt } }
    );
    if (updated) {
      req.partnerRegistrationRiskFinalized = true;
      return { id: req.partnerRegistrationRiskEventId, outcome: 'created', userId, finalizedAt };
    }
  }

  const event = await recordRegistrationEvent({ assessment, outcome: 'created', userId });
  req.partnerRegistrationRiskFinalized = true;
  return event;
}

""",
)

replace_once(
    risk_path,
    """  const now = new Date();
  const subjectHash = hmac('email-canonical', canonical);
  const override = {
    id: uid('pao'),
    subjectHash,
    scope: 'registration',
    reason: note.slice(0, 1000),
    adminUserId,
    createdAt: now.toISOString(),
    expiresAt: eventExpiry(now, days),
    expiresAtDate: new Date(eventExpiry(now, days)),
  };""",
    """  const config = getConfig();
  const now = new Date();
  const subjectHash = hmac('email-canonical', canonical);
  const expiresAt = eventExpiry(now, days);
  const retentionExpiresAt = eventExpiry(now, config.overrideAuditRetentionDays);
  const override = {
    id: uid('pao'),
    subjectHash,
    scope: 'registration',
    reason: note.slice(0, 1000),
    adminUserId,
    createdAt: now.toISOString(),
    expiresAt,
    retentionExpiresAt,
    retentionExpiresAtDate: new Date(retentionExpiresAt),
  };""",
)

# Expose the IPv6 helper for focused regression tests.
replace_once(
    risk_path,
    """    browserSignature,
    requestCookie,
    requestIp,""",
    """    browserSignature,
    requestCookie,
    requestIp,
    expandIpv6,""",
)

# Registration feature flag and validation parity for the dedicated partner signup route.
secure_route = 'routes/partner-registration-secure.js'
replace_once(
    secure_route,
    "const { registrationLimiter } = require('../middleware/rateLimits');",
    """const { registrationLimiter } = require('../middleware/rateLimits');
const { featureRequired } = require('../middleware/features');""",
)
replace_once(
    secure_route,
    """  '/register',
  registrationLimiter,
  csrfProtection,
  partnerRegistrationRiskGuard,""",
    """  '/register',
  featureRequired('registration'),
  csrfProtection,
  registrationLimiter,
  partnerRegistrationRiskGuard,""",
)
replace_once(
    secure_route,
    """      if (!cleanFirstName || !cleanLastName) {
        return res.status(400).json({ error: 'First name and last name are required' });
      }
      if (!validator.isEmail(cleanEmail)) {""",
    """      if (!cleanFirstName || !cleanLastName) {
        return res.status(400).json({ error: 'First name and last name are required' });
      }
      if (!/\\p{L}/u.test(cleanFirstName) || !/\\p{L}/u.test(cleanLastName)) {
        return res
          .status(400)
          .json({ error: 'First and last name must contain at least one letter' });
      }
      if (!validator.isEmail(cleanEmail)) {""",
)
replace_once(
    secure_route,
    """      if (!password || !passwordOk(password)) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters and include letters and numbers',
        });
      }""",
    """      if (typeof password !== 'string' || password.length > 1024) {
        return res.status(400).json({ error: 'Password is too long (maximum 1,024 characters)' });
      }
      if (!password || !passwordOk(password)) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters and include letters and numbers',
        });
      }""",
)

# Mongo startup indexes: db-init is not the only production index path.
utils_path = 'utils/database.js'
utils_text = Path(utils_path).read_text()
if "partner_abuse_events" not in utils_text:
    marker = """    logger.info('Database indexes created successfully');"""
    block = """    try {
      const abuseEvents = db.collection('partner_abuse_events');
      await abuseEvents.createIndex({ id: 1 }, { unique: true });
      await abuseEvents.createIndex({ outcome: 1, createdAt: -1 });
      await abuseEvents.createIndex({ canonicalEmailHash: 1, createdAt: -1 });
      await abuseEvents.createIndex({ ipHash: 1, createdAt: -1 });
      await abuseEvents.createIndex({ subnetHash: 1, createdAt: -1 });
      await abuseEvents.createIndex({ browserHash: 1, createdAt: -1 });
      await abuseEvents.createIndex({ deviceNetworkHash: 1, createdAt: -1 });
      await abuseEvents.createIndex({ deviceCookieHash: 1, createdAt: -1 });
      await abuseEvents.createIndex({ referralCodeHash: 1, createdAt: -1 });
      await abuseEvents.createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });

      const overrides = db.collection('partner_abuse_overrides');
      await overrides.createIndex({ id: 1 }, { unique: true });
      await overrides.createIndex({ subjectHash: 1, scope: 1, createdAt: -1 });
      await overrides.createIndex({ retentionExpiresAtDate: 1 }, { expireAfterSeconds: 0 });

      const appeals = db.collection('partner_abuse_appeals');
      await appeals.createIndex({ id: 1 }, { unique: true });
      await appeals.createIndex({ status: 1, createdAt: -1 });
      await appeals.createIndex({ emailIdentityHash: 1 });
      await appeals.createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
      logger.debug('Partner registration anti-abuse indexes created');
    } catch (error) {
      logger.warn('Partner registration anti-abuse indexes could not be fully created:', error.message);
    }

"""
    if marker not in utils_text:
        raise SystemExit('Expected utils/database.js index marker not found')
    Path(utils_path).write_text(utils_text.replace(marker, block + marker, 1))

# Keep migration/index declarations aligned with the runtime index path.
replace_once(
    'db-init.js',
    """      { keys: { createdAt: -1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
      { keys: { ipHash: 1, createdAt: -1 }, options: {} },""",
    """      { keys: { createdAt: -1 }, options: {} },
      { keys: { outcome: 1, createdAt: -1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
      { keys: { ipHash: 1, createdAt: -1 }, options: {} },""",
)
replace_once(
    'db-init.js',
    """      { keys: { subjectHash: 1, scope: 1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },""",
    """      { keys: { subjectHash: 1, scope: 1, createdAt: -1 }, options: {} },
      { keys: { retentionExpiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },""",
)

# Document the audit-retention distinction and bounded indexed reads.
replace_once(
    'docs/PARTNER_ANTI_ABUSE_PR1.md',
    """- `PARTNER_ABUSE_APPEAL_RETENTION_DAYS` — appeal retention, default 180 days.
- `PARTNER_ABUSE_REVIEW_SCORE`""",
    """- `PARTNER_ABUSE_APPEAL_RETENTION_DAYS` — appeal retention, default 180 days.
- `PARTNER_ABUSE_OVERRIDE_AUDIT_RETENTION_DAYS` — retention for expired/revoked administrator override evidence, default 180 days. The active override itself remains limited to 1–30 days.
- `PARTNER_ABUSE_REVIEW_SCORE`""",
)
replace_once(
    'docs/PARTNER_ANTI_ABUSE_PR1.md',
    """Overrides:

- are scoped to one canonical email identity;""",
    """Overrides:

- are scoped to one canonical email identity;
- remain auditable after their active period ends, until the configured audit-retention expiry;""",
)

# Permanent focused regressions for issues found in the final source review.
final_test = Path('tests/unit/partner-registration-final-review.test.js')
if not final_test.exists():
    final_test.write_text("""'use strict';

const mockCollections = {
  partner_abuse_events: [],
  partner_abuse_overrides: [],
  users: [],
  partner_abuse_appeals: [],
};

const matches = (item, query) =>
  Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.$in) return value.$in.includes(item[key]);
      if (value.$gte) return item[key] >= value.$gte;
    }
    return item[key] === value;
  });

const mockDb = {
  read: jest.fn(async collection => mockCollections[collection] || []),
  findWithOptions: jest.fn(async (collection, query, options = {}) => {
    const rows = (mockCollections[collection] || []).filter(item => matches(item, query));
    if (options.sort?.createdAt) {
      rows.sort((a, b) => options.sort.createdAt * String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    return rows.slice(0, options.limit || rows.length);
  }),
  insertOne: jest.fn(async (collection, record) => {
    mockCollections[collection].push(record);
    return record;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const row = (mockCollections[collection] || []).find(item => matches(item, query));
    if (!row) return false;
    Object.assign(row, update.$set || update);
    return true;
  }),
};

let id = 0;
jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_${++id}` }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRegistrationRiskService');

function request(ip = '2001:db8:abcd:12::1') {
  const headers = {
    'user-agent': 'Mozilla/5.0 Chrome/126',
    'accept-language': 'en-GB',
    'sec-ch-ua': 'Chromium',
    'sec-ch-ua-platform': 'Windows',
    'sec-ch-ua-mobile': '?0',
  };
  return { ip, headers, body: {}, get: name => headers[String(name).toLowerCase()] || '' };
}

beforeEach(() => {
  Object.values(mockCollections).forEach(rows => rows.splice(0, rows.length));
  jest.clearAllMocks();
  id = 0;
  process.env.NODE_ENV = 'test';
  process.env.PARTNER_ABUSE_HASH_SECRET = 'final-review-risk-test-secret';
  process.env.PARTNER_ABUSE_ENFORCEMENT_MODE = 'enforce';
  delete process.env.PARTNER_ABUSE_OVERRIDE_AUDIT_RETENTION_DAYS;
});

afterAll(() => {
  delete process.env.PARTNER_ABUSE_HASH_SECRET;
  delete process.env.PARTNER_ABUSE_ENFORCEMENT_MODE;
});

test('normalises compressed IPv6 addresses to a stable /64 subnet', () => {
  expect(service.subnetForIp('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd:0012::/64');
  expect(service.subnetForIp('2001:db8:abcd:12:ffff::99')).toBe('2001:0db8:abcd:0012::/64');
});

test('uses bounded indexed event queries when the database supports them', async () => {
  await service.assessRegistration({
    req: request('203.0.113.10'),
    email: 'person@example.com',
    role: 'supplier',
  });
  expect(mockDb.findWithOptions).toHaveBeenCalledWith(
    'partner_abuse_events',
    expect.objectContaining({ outcome: { $in: ['attempt', 'created', 'blocked'] } }),
    expect.objectContaining({ limit: 10000 })
  );
  expect(mockDb.read).not.toHaveBeenCalledWith('partner_abuse_events');
});

test('failed registration finalisation removes the attempt from future velocity counting', async () => {
  const req = request('203.0.113.44');
  req.body = { email: 'bad@example.com', role: 'supplier' };
  const listeners = {};
  const res = {
    statusCode: 400,
    once: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    setHeader: jest.fn(),
  };
  req.res = res;
  const guard = service.registrationRiskGuard({ roleResolver: () => 'supplier' });
  await guard(req, res, jest.fn());
  expect(mockCollections.partner_abuse_events[0].outcome).toBe('attempt');
  listeners.finish();
  await new Promise(resolve => setImmediate(resolve));
  expect(mockCollections.partner_abuse_events[0].outcome).toBe('failed');
});

test('administrator override evidence outlives the active override window', async () => {
  const override = await service.createRegistrationOverride({
    email: 'reviewed@example.com',
    reason: 'Identity reviewed manually with sufficient independent evidence.',
    adminUserId: 'admin_1',
    expiresInDays: 2,
  });
  expect(Date.parse(override.retentionExpiresAt)).toBeGreaterThan(Date.parse(override.expiresAt));
  expect(override.retentionExpiresAtDate).toBeInstanceOf(Date);
  expect(override.expiresAtDate).toBeUndefined();
});
""")

# Put the new final-review regression in the permanent smoke gate.
package_path = Path('package.json')
package_text = package_path.read_text()
needle = 'tests/unit/partner-registration-final-review.test.js'
if needle not in package_text:
    import json
    package = json.loads(package_text)
    package['scripts']['test:smoke'] += f' {needle}'
    package_path.write_text(json.dumps(package, indent=2) + '\n')
