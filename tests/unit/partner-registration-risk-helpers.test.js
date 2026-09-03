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
    if (!item) {
      return null;
    }
    Object.assign(item, update.$set || update);
    return item;
  }),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_1` }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRegistrationRiskService');
const { expandIpv6, activeEmailOverride, normalisePhone, requestCookie } = service._private;

beforeEach(() => {
  Object.values(mockCollections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  process.env.PARTNER_ABUSE_HASH_SECRET = 'unit-test-secret';
  delete process.env.PARTNER_ABUSE_IP_REPUTATION_URL;
});

afterAll(() => {
  delete process.env.PARTNER_ABUSE_HASH_SECRET;
});

describe('canonicalIdentityEmail / emailDomain edge cases', () => {
  test('returns empty string for an email with no local part', () => {
    expect(service.canonicalIdentityEmail('@example.com')).toBe('');
  });

  test('returns empty string for an email with no domain part', () => {
    expect(service.canonicalIdentityEmail('someone@')).toBe('');
  });

  test('emailDomain extracts the domain of a valid address', () => {
    expect(service.emailDomain('user@example.com')).toBe('example.com');
  });
});

describe('normaliseIp', () => {
  test('returns empty string for a blank value', () => {
    expect(service.normaliseIp('   ')).toBe('');
  });

  test('strips the IPv4-mapped IPv6 prefix', () => {
    expect(service.normaliseIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });

  test('strips brackets around an IPv6 address', () => {
    expect(service.normaliseIp('[2001:db8::1]')).toBe('2001:db8::1');
  });

  test('strips a zone index suffix', () => {
    expect(service.normaliseIp('fe80::1%eth0')).toBe('fe80::1');
  });

  test('returns empty string for an invalid address', () => {
    expect(service.normaliseIp('not-an-ip')).toBe('');
  });
});

describe('expandIpv6', () => {
  test('returns an empty array for a non-IPv6 address', () => {
    expect(expandIpv6('203.0.113.5')).toEqual([]);
  });

  test('returns an empty array for a malformed address with multiple "::"', () => {
    expect(expandIpv6('2001::db8::1')).toEqual([]);
  });

  test('expands and zero-pads a compressed IPv6 address to 8 groups', () => {
    expect(expandIpv6('2001:db8::1')).toEqual([
      '2001',
      '0db8',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0001',
    ]);
  });
});

describe('subnetForIp', () => {
  test('derives a /24 subnet for an IPv4 address', () => {
    expect(service.subnetForIp('203.0.113.42')).toBe('203.0.113.0/24');
  });

  test('derives a /64 subnet for an IPv6 address', () => {
    expect(service.subnetForIp('2001:db8::1')).toBe('2001:0db8:0000:0000::/64');
  });
});

describe('requestCookie', () => {
  test('reads from req.cookies when present', () => {
    const req = { cookies: { ef_partner_device: 'abc123' }, get: () => '' };
    expect(requestCookie(req, 'ef_partner_device')).toBe('abc123');
  });

  test('falls back to parsing the raw Cookie header', () => {
    const req = { get: name => (name === 'cookie' ? 'foo=bar; ef_partner_device=xyz789' : '') };
    expect(requestCookie(req, 'ef_partner_device')).toBe('xyz789');
  });

  test('returns empty string when the cookie is absent', () => {
    const req = { get: () => 'foo=bar' };
    expect(requestCookie(req, 'ef_partner_device')).toBe('');
  });
});

describe('normalisePhone', () => {
  test('strips a leading international 00 prefix', () => {
    expect(normalisePhone('0044 7700 900123')).toBe('447700900123');
  });

  test('converts a UK trunk-prefixed number to E.164 digits', () => {
    expect(normalisePhone('07700 900123')).toBe('447700900123');
  });

  test('returns empty string for a value too short to be a phone number', () => {
    expect(normalisePhone('123')).toBe('');
  });
});

describe('activeEmailOverride', () => {
  test('returns null when no hash is provided', async () => {
    await expect(service._private.activeEmailOverride('')).resolves.toBeNull();
  });

  test('ignores a revoked override and returns null', async () => {
    mockCollections.partner_abuse_overrides.push({
      subjectHash: 'hash1',
      scope: 'registration',
      revokedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await expect(activeEmailOverride('hash1')).resolves.toBeNull();
  });

  test('returns the override when it is active and unexpired', async () => {
    const override = {
      subjectHash: 'hash2',
      scope: 'registration',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    mockCollections.partner_abuse_overrides.push(override);
    await expect(activeEmailOverride('hash2')).resolves.toEqual(override);
  });
});

describe('lookupIpReputation', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('returns unavailable when no provider URL is configured', async () => {
    await expect(service.lookupIpReputation('203.0.113.5', 500)).resolves.toEqual({
      available: false,
    });
  });

  test('reports the status code when the provider responds with an error', async () => {
    process.env.PARTNER_ABUSE_IP_REPUTATION_URL = 'https://reputation.example.com/{ip}';
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
    await expect(service.lookupIpReputation('203.0.113.5', 500)).resolves.toEqual({
      available: false,
      status: 503,
    });
  });
});
