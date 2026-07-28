'use strict';

const mockCollections = {
  partner_abuse_events: [],
  partner_abuse_overrides: [],
  users: [],
  partner_abuse_appeals: [],
};

const mockDb = {
  read: jest.fn(async collection => mockCollections[collection] || []),
  insertOne: jest.fn(async (collection, record) => {
    mockCollections[collection].push(record);
    return record;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate =>
      Object.entries(query).every(([key, value]) => candidate[key] === value)
    );
    if (!item) return null;
    Object.assign(item, update.$set || update);
    return item;
  }),
};

let mockId = 0;
jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_${++mockId}` }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRegistrationRiskService');

function req({ ip = '203.0.113.10', ua = 'Mozilla/5.0 Chrome/126', language = 'en-GB' } = {}) {
  const headers = {
    'user-agent': ua,
    'accept-language': language,
    'sec-ch-ua': '"Chromium";v="126"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-mobile': '?0',
  };
  return {
    ip,
    headers,
    body: {},
    get: name => headers[String(name).toLowerCase()] || '',
  };
}

function seedEvent({
  email,
  role = 'supplier',
  request = req(),
  refCode = 'P_TEST',
  createdAt,
} = {}) {
  const hashes = service.extractRequestSignals(request, { email, refCode });
  mockCollections.partner_abuse_events.push({
    id: `existing_${mockCollections.partner_abuse_events.length + 1}`,
    role,
    outcome: 'attempt',
    createdAt: createdAt || new Date().toISOString(),
    ...hashes,
  });
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockId = 0;
  process.env.NODE_ENV = 'test';
  process.env.PARTNER_ABUSE_HASH_SECRET = 'unit-test-secret';
  process.env.PARTNER_ABUSE_ENFORCEMENT_MODE = 'enforce';
  delete process.env.PARTNER_ABUSE_IP_REPUTATION_URL;
  delete process.env.PARTNER_ABUSE_DISPOSABLE_EMAIL_DOMAINS;
});

afterAll(() => {
  delete process.env.PARTNER_ABUSE_HASH_SECRET;
  delete process.env.PARTNER_ABUSE_ENFORCEMENT_MODE;
});

test('canonicalises Gmail dots and plus aliases for identity matching', () => {
  expect(service.canonicalIdentityEmail('First.Last+promo@googlemail.com')).toBe(
    'firstlast@gmail.com'
  );
});

test('detects disposable email services and blocks them in enforcement mode', async () => {
  const assessment = await service.assessRegistration({
    req: req(),
    email: 'person@mailinator.com',
    role: 'supplier',
  });
  expect(assessment.action).toBe('block');
  expect(assessment.signalCodes).toContain('DISPOSABLE_EMAIL_DOMAIN');
  expect(assessment.score).toBeGreaterThanOrEqual(70);
});

test('does not store raw IP, user agent, or email in registration events', async () => {
  const request = req({ ip: '203.0.113.42', ua: 'Private Browser String' });
  const assessment = await service.assessRegistration({
    req: request,
    email: 'private@example.com',
    role: 'partner',
  });
  const event = await service.recordRegistrationEvent({ assessment, outcome: 'attempt' });
  const serialised = JSON.stringify(event);
  expect(serialised).not.toContain('203.0.113.42');
  expect(serialised).not.toContain('Private Browser String');
  expect(serialised).not.toContain('private@example.com');
  expect(event.ipHash).toMatch(/^[a-f0-9]{64}$/);
  expect(event.browserHash).toMatch(/^[a-f0-9]{64}$/);
});

test('flags several identities created from the same browser/device signature', async () => {
  process.env.PARTNER_ABUSE_BROWSER_REGISTRATION_MAX = '3';
  process.env.PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX = '3';
  seedEvent({ email: 'one@example.com' });
  seedEvent({ email: 'two@example.com' });
  seedEvent({ email: 'three@example.com' });

  const assessment = await service.assessRegistration({
    req: req(),
    email: 'four@example.com',
    role: 'supplier',
  });
  expect(assessment.signalCodes).toEqual(
    expect.arrayContaining(['BROWSER_MULTI_ACCOUNT', 'DEVICE_NETWORK_MULTI_ACCOUNT'])
  );
  delete process.env.PARTNER_ABUSE_BROWSER_REGISTRATION_MAX;
  delete process.env.PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX;
});

test('flags partner/supplier cross-role reuse of the same device-network identity', async () => {
  seedEvent({ email: 'partner@example.com', role: 'partner' });
  const assessment = await service.assessRegistration({
    req: req(),
    email: 'supplier@example.net',
    role: 'supplier',
  });
  expect(assessment.signalCodes).toContain('PARTNER_SUPPLIER_DEVICE_OVERLAP');
});

test('does not treat a shared public email domain alone as fraud', async () => {
  seedEvent({ email: 'one@gmail.com', request: req({ ip: '203.0.113.11' }) });
  seedEvent({ email: 'two@gmail.com', request: req({ ip: '203.0.113.12' }) });
  const assessment = await service.assessRegistration({
    req: req({ ip: '203.0.113.13', ua: 'Different Browser' }),
    email: 'three@gmail.com',
    role: 'supplier',
  });
  expect(assessment.signalCodes).not.toContain('DISPOSABLE_EMAIL_DOMAIN');
  expect(assessment.action).toBe('allow');
});

test('detects Gmail alias reuse without changing the account login email', async () => {
  seedEvent({ email: 'first.last+one@gmail.com' });
  const assessment = await service.assessRegistration({
    req: req({ ip: '198.51.100.2', ua: 'Different Browser' }),
    email: 'firstlast+two@gmail.com',
    role: 'supplier',
  });
  expect(assessment.signalCodes).toContain('EMAIL_ALIAS_REUSE');
  expect(assessment.action).toBe('review');
});

test('an administrator override permits a registration while preserving risk evidence', async () => {
  const email = 'appeal@mailinator.com';
  await service.createRegistrationOverride({
    email,
    reason: 'Identity was independently checked by the partner operations team.',
    adminUserId: 'admin_1',
    expiresInDays: 5,
  });
  const assessment = await service.assessRegistration({ req: req(), email, role: 'partner' });
  expect(assessment.signalCodes).toContain('DISPOSABLE_EMAIL_DOMAIN');
  expect(assessment.overrideApplied).toEqual(expect.objectContaining({ scope: 'registration' }));
  expect(assessment.action).toBe('allow');
});

test('monitor mode records high risk without blocking registration', async () => {
  process.env.PARTNER_ABUSE_ENFORCEMENT_MODE = 'monitor';
  const assessment = await service.assessRegistration({
    req: req(),
    email: 'person@yopmail.com',
    role: 'supplier',
  });
  expect(assessment.riskLevel).toBe('high');
  expect(assessment.action).toBe('review');
});

test('configured IP reputation signals VPN/Tor/hosting risk without storing the IP', async () => {
  process.env.NODE_ENV = 'test';
  process.env.PARTNER_ABUSE_IP_REPUTATION_URL = 'http://risk.local/check?ip={ip}';
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ riskScore: 95, vpn: true, tor: true, datacenter: true }),
  }));
  const assessment = await service.assessRegistration({
    req: req({ ip: '198.51.100.9' }),
    email: 'person@example.com',
    role: 'partner',
  });
  expect(assessment.signalCodes).toEqual(
    expect.arrayContaining([
      'TOR_EXIT_NETWORK',
      'VPN_OR_PROXY_NETWORK',
      'DATACENTRE_NETWORK',
      'HIGH_IP_REPUTATION_RISK',
    ])
  );
  expect(JSON.stringify(assessment)).not.toContain('198.51.100.9');
  delete global.fetch;
  delete process.env.PARTNER_ABUSE_IP_REPUTATION_URL;
});

test('only primary attempt/blocked events count toward velocity thresholds', async () => {
  process.env.PARTNER_ABUSE_IP_REGISTRATION_MAX = '2';
  const hashes = service.extractRequestSignals(req(), { email: 'one@example.com' });
  mockCollections.partner_abuse_events.push(
    { ...hashes, role: 'supplier', outcome: 'created', createdAt: new Date().toISOString() },
    { ...hashes, role: 'supplier', outcome: 'failed', createdAt: new Date().toISOString() }
  );
  const assessment = await service.assessRegistration({
    req: req(),
    email: 'new@example.com',
    role: 'supplier',
  });
  expect(assessment.signalCodes).not.toContain('REGISTRATION_IP_VELOCITY');
  delete process.env.PARTNER_ABUSE_IP_REGISTRATION_MAX;
});

test('completeRegistrationRisk persists risk metadata and a created audit event', async () => {
  mockCollections.users.push({ id: 'usr_1', email: 'person@example.com' });
  const request = req();
  request.partnerRegistrationRisk = await service.assessRegistration({
    req: request,
    email: 'person@example.com',
    role: 'partner',
  });
  const event = await service.completeRegistrationRisk(request, 'usr_1');
  expect(event).toEqual(expect.objectContaining({ outcome: 'created', userId: 'usr_1' }));
  expect(mockCollections.users[0]).toEqual(
    expect.objectContaining({ registrationRiskLevel: 'low', registrationRiskReviewRequired: false })
  );
});

test('creates retained appeals without exposing identity hashes as the contact address', async () => {
  const appeal = await service.createAppeal({
    email: 'person@example.com',
    name: 'Person Example',
    message: 'I believe this registration was incorrectly blocked and would like it reviewed.',
  });
  expect(appeal.email).toBe('person@example.com');
  expect(appeal.emailIdentityHash).toMatch(/^[a-f0-9]{64}$/);
  expect(Date.parse(appeal.expiresAt)).toBeGreaterThan(Date.parse(appeal.createdAt));
});
