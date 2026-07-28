'use strict';

const mockCollections = {
  partner_abuse_events: [],
  partner_abuse_overrides: [],
  users: [],
  partner_abuse_appeals: [],
};

function matches(item, query) {
  return Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.$in) return value.$in.includes(item[key]);
      if (value.$gte) return item[key] >= value.$gte;
    }
    return item[key] === value;
  });
}

const mockDb = {
  read: jest.fn(async collection => mockCollections[collection] || []),
  findWithOptions: jest.fn(async (collection, query, options = {}) => {
    const rows = (mockCollections[collection] || []).filter(item => matches(item, query));
    if (options.sort?.createdAt) {
      rows.sort(
        (left, right) =>
          options.sort.createdAt * String(left.createdAt).localeCompare(String(right.createdAt))
      );
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

function makeReq({
  ip = '203.0.113.10',
  email = 'person@example.com',
  role = 'supplier',
  ua = 'Mozilla/5.0 Chrome/126',
} = {}) {
  const headers = {
    'user-agent': ua,
    'accept-language': 'en-GB',
    'sec-ch-ua': 'Chromium',
    'sec-ch-ua-platform': 'Windows',
    'sec-ch-ua-mobile': '?0',
  };
  return {
    ip,
    headers,
    body: { email, role },
    get: name => headers[String(name).toLowerCase()] || '',
  };
}

beforeEach(() => {
  Object.values(mockCollections).forEach(rows => rows.splice(0, rows.length));
  jest.clearAllMocks();
  id = 0;
  process.env.NODE_ENV = 'test';
  process.env.PARTNER_ABUSE_HASH_SECRET = 'final-review-risk-test-secret';
  process.env.PARTNER_ABUSE_ENFORCEMENT_MODE = 'enforce';
  delete process.env.PARTNER_ABUSE_IP_REPUTATION_URL;
  delete process.env.PARTNER_ABUSE_OVERRIDE_AUDIT_RETENTION_DAYS;
  delete process.env.PARTNER_ABUSE_BROWSER_REGISTRATION_MAX;
  delete process.env.PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX;
});

afterAll(() => {
  delete process.env.PARTNER_ABUSE_HASH_SECRET;
  delete process.env.PARTNER_ABUSE_ENFORCEMENT_MODE;
});

test('normalises compressed IPv6 addresses to a stable /64 subnet', () => {
  expect(service.subnetForIp('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd:0012::/64');
  expect(service.subnetForIp('2001:db8:abcd:12:ffff::99')).toBe(
    '2001:0db8:abcd:0012::/64'
  );
});

test('uses bounded indexed event queries when supported by the database', async () => {
  await service.assessRegistration({
    req: makeReq(),
    email: 'person@example.com',
    role: 'supplier',
  });

  expect(mockDb.findWithOptions).toHaveBeenCalledWith(
    'partner_abuse_events',
    expect.objectContaining({ outcome: { $in: ['attempt', 'created', 'blocked'] } }),
    expect.objectContaining({ limit: 10000, sort: { createdAt: -1 } })
  );
  expect(mockDb.read).not.toHaveBeenCalledWith('partner_abuse_events');
});

test('deduplicates historical attempt and created records for one assessment', () => {
  const events = [
    { id: 'a1', assessmentId: 'assessment_1', outcome: 'attempt' },
    { id: 'a2', assessmentId: 'assessment_1', outcome: 'created' },
    { id: 'b1', assessmentId: 'assessment_2', outcome: 'blocked' },
  ];
  const deduped = service._private.dedupeRegistrationEvents(events);
  expect(deduped).toHaveLength(2);
  expect(deduped).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ assessmentId: 'assessment_1', outcome: 'created' }),
      expect.objectContaining({ assessmentId: 'assessment_2', outcome: 'blocked' }),
    ])
  );
});

test('failed registration audit events do not contribute to registration velocity', async () => {
  const req = makeReq({ ip: '203.0.113.44', email: 'next@example.net' });
  const signals = service.extractRequestSignals(req, { email: 'bad@example.com' });
  for (let index = 0; index < 20; index += 1) {
    mockCollections.partner_abuse_events.push({
      id: `failed_${index}`,
      assessmentId: `failed_assessment_${index}`,
      role: 'supplier',
      outcome: 'failed',
      createdAt: new Date().toISOString(),
      ...signals,
    });
  }

  const assessment = await service.assessRegistration({
    req,
    email: 'next@example.net',
    role: 'supplier',
  });
  expect(assessment.signalCodes).not.toContain('REGISTRATION_IP_VELOCITY');
  expect(assessment.signalCodes).not.toContain('REGISTRATION_IP_HARD_LIMIT');
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

test('canonicalises UK national and +44 phone formats to the same identity', () => {
  expect(service._private.normalisePhone('07700 900123')).toBe('447700900123');
  expect(service._private.normalisePhone('+44 7700 900123')).toBe('447700900123');
});

test('public email-domain concentration is not used as a velocity signal', async () => {
  const req = makeReq({ email: 'newperson@gmail.com' });
  const signals = service.extractRequestSignals(req, { email: 'oldperson@gmail.com' });
  for (let index = 0; index < 30; index += 1) {
    mockCollections.partner_abuse_events.push({
      id: `gmail_${index}`,
      assessmentId: `gmail_assessment_${index}`,
      role: 'supplier',
      outcome: 'created',
      createdAt: new Date().toISOString(),
      ...signals,
      ipHash: `ip_${index}`,
      subnetHash: `subnet_${index}`,
      browserHash: `browser_${index}`,
      deviceNetworkHash: `device_${index}`,
    });
  }
  const assessment = await service.assessRegistration({
    req,
    email: 'newperson@gmail.com',
    role: 'supplier',
  });
  expect(assessment.signalCodes).not.toContain('EMAIL_DOMAIN_VELOCITY');
});

test('correlated browser and browser-network evidence cannot self-stack into an automatic block', async () => {
  process.env.PARTNER_ABUSE_BROWSER_REGISTRATION_MAX = '4';
  process.env.PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX = '4';

  for (let index = 1; index <= 4; index += 1) {
    const email = `office${index}@example.com`;
    const priorReq = makeReq({ ip: `203.0.113.${index + 10}`, email });
    const signals = service.extractRequestSignals(priorReq, { email });
    mockCollections.partner_abuse_events.push({
      id: `office_${index}`,
      assessmentId: `office_assessment_${index}`,
      role: 'supplier',
      outcome: 'created',
      createdAt: new Date().toISOString(),
      ...signals,
    });
  }

  const assessment = await service.assessRegistration({
    req: makeReq({ ip: '203.0.113.99', email: 'office-new@example.net' }),
    email: 'office-new@example.net',
    role: 'supplier',
  });

  expect(assessment.signalCodes).toEqual(
    expect.arrayContaining(['BROWSER_MULTI_ACCOUNT', 'DEVICE_NETWORK_MULTI_ACCOUNT'])
  );
  expect(assessment.score).toBeLessThan(70);
  expect(assessment.action).toBe('review');
});
