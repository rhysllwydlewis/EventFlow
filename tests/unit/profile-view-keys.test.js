'use strict';

const {
  normaliseAddress,
  anonymousVisitorKey,
  addressKey,
} = require('../../utils/profileViewKeys');

describe('normaliseAddress', () => {
  it('leaves an IPv4 address as it is', () => {
    expect(normaliseAddress('203.0.113.9')).toBe('203.0.113.9');
  });

  it('reduces an IPv6 address to its /64 prefix, whatever notation it arrives in', () => {
    const prefix = '2001:0db8:0001:0002::/64';
    expect(normaliseAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(prefix);
    expect(normaliseAddress('2001:DB8:1:2::1')).toBe(prefix);
    expect(normaliseAddress('2001:db8:1:2:0:0:0:5%eth0')).toBe(prefix);
    expect(normaliseAddress('2001:db8:1:3::1')).not.toBe(prefix);
  });

  it('turns an IPv4-mapped IPv6 address back into the IPv4 address', () => {
    expect(normaliseAddress('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('gives nothing for a missing or malformed address', () => {
    expect(normaliseAddress('')).toBe('');
    expect(normaliseAddress(undefined)).toBe('');
    expect(normaliseAddress('not-an-ip')).toBe('');
  });
});

describe('keys', () => {
  it('are 32 hex characters and the same for the same input', () => {
    expect(anonymousVisitorKey('203.0.113.9', 'chrome/windows')).toMatch(/^a:[0-9a-f]{32}$/);
    expect(addressKey('203.0.113.9')).toMatch(/^[0-9a-f]{32}$/);
    expect(anonymousVisitorKey('203.0.113.9', 'chrome/windows')).toBe(
      anonymousVisitorKey('203.0.113.9', 'chrome/windows')
    );
  });

  it('differ between purposes, so an address key is never a visitor key', () => {
    expect(anonymousVisitorKey('203.0.113.9', '')).not.toBe(`a:${addressKey('203.0.113.9')}`);
  });

  it('are empty when there is no secret (callers then store nothing)', () => {
    const jwt = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(anonymousVisitorKey('203.0.113.9', 'chrome/windows')).toBe('');
      expect(addressKey('203.0.113.9')).toBe('');
    } finally {
      process.env.JWT_SECRET = jwt;
    }
  });

  it('PROFILE_VIEW_SALT, when set, takes the place of JWT_SECRET', () => {
    const before = addressKey('203.0.113.9');
    process.env.PROFILE_VIEW_SALT = 'another-salt-value-for-this-test-only';
    try {
      expect(addressKey('203.0.113.9')).not.toBe(before);
    } finally {
      delete process.env.PROFILE_VIEW_SALT;
    }
  });

  it('an unknown address has no address key', () => {
    expect(addressKey('')).toBe('');
  });
});
