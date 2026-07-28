'use strict';

const mockCollections = {
  partner_abuse_events: [],
  partner_abuse_overrides: [],
  users: [],
  partner_abuse_appeals: [],
};

function mockMatches(item, query) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

const mockDb = {
  read: jest.fn(async collection => mockCollections[collection] || []),
  insertOne: jest.fn(async (collection, record) => {
    mockCollections[collection].push(record);
    return record;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (mockCollections[collection] || []).find(candidate => mockMatches(candidate, query));
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

function makeReq({
  ip = '203.0.113.10',
  ua = 'Mozilla/5.0 Chrome/126',
  email = 'person@example.com',
  role = 'supplier',
  refCode = 'P_TEST',
  cookie = '',
  body = {},
} = {}) {
  const headers = {
    'user-agent': ua,
    'accept-language': 'en-GB',
    'sec-ch-ua': '"Chromium";v="126"',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-mobile': '?0',
    cookie,
  };
  const res = { cookie: jest.fn() };
  return {
    ip,
    headers,
    body: { email, role, ref: refCode, ...body },
    res,
    get: name => headers[String(name).toLowerCase()] || '',
  };
}

function seedPrimaryEvent({
  email,
  role = 'supplier',
  token = 'stable-device-token-1234567890',
  request,
  body,
  refCode = 'P_TEST',
} = {}) {
  const req = request || makeReq({ email, role, refCode, body });
  req.partnerAbuseDeviceToken = token;
  const signals = service.extractRequestSignals(req, { email, refCode });
  mockCollections.partner_abuse_events.push({
    id: `event_${mockCollections.partner_abuse_events.length + 1}`,
    role,
    outcome: 'attempt',
    createdAt: new Date().toISOString(),
    ...signals,
  });
}

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockId = 0;
  process.env.NODE_ENV = 'test';
  process.env.PARTNER_ABUSE_HASH_SECRET = 'advanced-risk-unit-test-secret';
  process.env.PARTNER_ABUSE_ENFORCEMENT_MODE = 'enforce';
  delete process.env.PARTNER_ABUSE_SUSPICIOUS_EMAIL_DOMAINS;
  delete process.env.PARTNER_ABUSE_IP_REGISTRATION_MAX;
  delete process.env.PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX;
  delete process.env.PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX;
  delete process.env.PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER;
});

afterAll(() => {
  delete process.env.PARTNER_ABUSE_HASH_SECRET;
  delete process.env.PARTNER_ABUSE_ENFORCEMENT_MODE;
});

test('sets a random HttpOnly SameSite first-party device token without persisting the raw token', async () => {
  const req = makeReq();
  const token = service.ensureDeviceToken(req, req.res);

  expect(token).toMatch(/^[A-Za-z0-9_-]{24,128}$/);
  expect(req.res.cookie).toHaveBeenCalledWith(
    'ef_partner_device',
    token,
    expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' })
  );

  const assessment = await service.assessRegistration({
    req,
    email: 'person@example.com',
    role: 'supplier',
  });
  const event = await service.recordRegistrationEvent({ assessment, outcome: 'attempt' });
  expect(event.deviceCookieHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(event)).not.toContain(token);
});

test('reuses an existing first-party device token instead of rotating it on every registration', () => {
  const token = 'existing-device-token-abcdefghijklmnopqrstuvwxyz';
  const req = makeReq({ cookie: `other=x; ef_partner_device=${token}` });
  expect(service.ensureDeviceToken(req, req.res)).toBe(token);
  expect(req.res.cookie).not.toHaveBeenCalled();
});

test('flags multiple account identities created from one stable first-party device token', async () => {
  process.env.PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX = '3';
  const token = 'stable-device-token-abcdefghijklmnopqrstuvwxyz';
  seedPrimaryEvent({ email: 'one@example.com', token });
  seedPrimaryEvent({ email: 'two@example.com', token });
  seedPrimaryEvent({ email: 'three@example.com', token });

  const req = makeReq({ email: 'four@example.com', cookie: `ef_partner_device=${token}` });
  const assessment = await service.assessRegistration({
    req,
    email: 'four@example.com',
    role: 'supplier',
  });
  expect(assessment.signalCodes).toContain('DEVICE_COOKIE_MULTI_ACCOUNT');
});

test('cross-role reuse of a stable device token is a strong partner/supplier signal', async () => {
  const token = 'stable-cross-role-device-token-abcdefghijk';
  seedPrimaryEvent({ email: 'partner@example.com', role: 'partner', token });

  const req = makeReq({
    email: 'supplier@example.net',
    role: 'supplier',
    cookie: `ef_partner_device=${token}`,
    ua: 'Different Browser To Avoid Browser Match',
  });
  const assessment = await service.assessRegistration({
    req,
    email: 'supplier@example.net',
    role: 'supplier',
  });
  expect(assessment.signalCodes).toContain('PARTNER_SUPPLIER_DEVICE_COOKIE_OVERLAP');
});

test('configured suspicious email domains trigger review but are not treated as disposable', async () => {
  process.env.PARTNER_ABUSE_SUSPICIOUS_EMAIL_DOMAINS = 'risk-domain.example';
  const req = makeReq({ email: 'person@risk-domain.example' });
  const assessment = await service.assessRegistration({
    req,
    email: 'person@risk-domain.example',
    role: 'partner',
  });
  expect(assessment.signalCodes).toContain('SUSPICIOUS_EMAIL_DOMAIN');
  expect(assessment.signalCodes).not.toContain('DISPOSABLE_EMAIL_DOMAIN');
  expect(assessment.action).toBe('review');
});

test('pseudonymous phone and website reuse links separate registration identities', async () => {
  const tokenA = 'device-a-abcdefghijklmnopqrstuvwxyz12';
  seedPrimaryEvent({
    email: 'partner@example.com',
    role: 'partner',
    token: tokenA,
    request: makeReq({
      email: 'partner@example.com',
      role: 'partner',
      ip: '203.0.113.11',
      ua: 'Browser A',
      body: { phone: '+44 7700 900123', website: 'https://example-events.co.uk/about' },
    }),
  });
  const req = makeReq({
    email: 'supplier@different.co.uk',
    role: 'supplier',
    ip: '198.51.100.20',
    ua: 'Browser B',
    body: { phoneNumber: '07700 900123', websiteUrl: 'example-events.co.uk/contact' },
  });
  const assessment = await service.assessRegistration({
    req,
    email: 'supplier@different.co.uk',
    role: 'supplier',
  });
  expect(assessment.signalCodes).toEqual(
    expect.arrayContaining(['BUSINESS_IDENTITY_REUSE', 'PARTNER_SUPPLIER_BUSINESS_OVERLAP'])
  );
  expect(JSON.stringify(assessment)).not.toContain('07700 900123');
  expect(JSON.stringify(assessment)).not.toContain('example-events.co.uk');
});

test('company name reuse alone is not enough to become a strong business-identity signal', async () => {
  seedPrimaryEvent({
    email: 'one@example.com',
    body: { company: 'The Wedding Company' },
  });
  const req = makeReq({
    email: 'two@example.net',
    ip: '198.51.100.33',
    ua: 'Other Browser',
    body: { company: 'The Wedding Company' },
  });
  const assessment = await service.assessRegistration({
    req,
    email: 'two@example.net',
    role: 'supplier',
  });
  expect(assessment.signalCodes).not.toContain('BUSINESS_IDENTITY_REUSE');
});

test('sustained same-IP registration velocity reaches a hard abuse limit', async () => {
  process.env.PARTNER_ABUSE_IP_REGISTRATION_MAX = '2';
  process.env.PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER = '2';
  for (let index = 0; index < 4; index += 1) {
    seedPrimaryEvent({
      email: `person${index}@example.com`,
      token: `different-device-token-${index}-abcdefghijklmnop`,
      request: makeReq({
        email: `person${index}@example.com`,
        ip: '203.0.113.90',
        ua: `Browser ${index}`,
      }),
    });
  }
  const assessment = await service.assessRegistration({
    req: makeReq({ ip: '203.0.113.90', email: 'next@example.net', ua: 'Browser next' }),
    email: 'next@example.net',
    role: 'supplier',
  });
  expect(assessment.signalCodes).toContain('REGISTRATION_IP_HARD_LIMIT');
  expect(assessment.action).toBe('block');
});

test('sustained referral-code velocity reaches a hard abuse limit independently of shared IPs', async () => {
  process.env.PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX = '2';
  process.env.PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER = '2';
  for (let index = 0; index < 4; index += 1) {
    seedPrimaryEvent({
      email: `ref${index}@example.com`,
      refCode: 'P_HOT',
      token: `ref-device-token-${index}-abcdefghijklmnopqrst`,
      request: makeReq({
        email: `ref${index}@example.com`,
        refCode: 'P_HOT',
        ip: `203.0.113.${index + 20}`,
        ua: `Referral Browser ${index}`,
      }),
    });
  }
  const assessment = await service.assessRegistration({
    req: makeReq({
      email: 'next@example.net',
      refCode: 'P_HOT',
      ip: '198.51.100.55',
      ua: 'Another Browser',
    }),
    email: 'next@example.net',
    role: 'supplier',
    refCode: 'P_HOT',
  });
  expect(assessment.signalCodes).toContain('REFERRAL_CODE_HARD_LIMIT');
  expect(assessment.action).toBe('block');
});
