/**
 * Unit tests for db-unified updateOne – verifies both calling conventions:
 *   1. Legacy:  updateOne(collection, idString, plainObject)
 *   2. Modern:  updateOne(collection, {id:...}, {$set:{...}})
 *   3. $unset:  updateOne(collection, {id:...}, {$set:{...}, $unset:{...}})
 */

'use strict';

describe('db-unified – updateOne calling conventions (local storage)', () => {
  let dbUnified;
  let storeData;

  beforeEach(() => {
    jest.resetModules();

    // Minimal in-memory store mock
    storeData = {};

    const mockStore = {
      uid: jest.fn(p => `${p}_123`),
      read: jest.fn(name => (storeData[name] ? [...storeData[name]] : [])),
      write: jest.fn((name, data) => {
        storeData[name] = [...data];
      }),
    };

    jest.mock('../../db', () => ({
      isMongoAvailable: jest.fn(() => false),
      connect: jest.fn(),
    }));
    jest.mock('../../store', () => mockStore);

    dbUnified = require('../../db-unified');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const seed = async row => {
    await dbUnified.initializeDatabase();
    storeData['users'] = [{ ...row }];
  };

  it('legacy: string id + plain object updates a field', async () => {
    await seed({ id: 'u1', name: 'Alice', role: 'customer' });
    const result = await dbUnified.updateOne('users', 'u1', { name: 'AliceNew' });
    expect(result).toBe(true);
    expect(storeData['users'][0].name).toBe('AliceNew');
  });

  it('legacy: string id returns false when document not found', async () => {
    await seed({ id: 'u1', name: 'Alice', role: 'customer' });
    const result = await dbUnified.updateOne('users', 'u999', { name: 'Ghost' });
    expect(result).toBe(false);
    // original record unchanged
    expect(storeData['users'][0].name).toBe('Alice');
  });

  it('modern: {id} filter + $set updates a field', async () => {
    await seed({ id: 'u2', name: 'Bob', role: 'supplier' });
    const result = await dbUnified.updateOne('users', { id: 'u2' }, { $set: { name: 'BobNew' } });
    expect(result).toBe(true);
    expect(storeData['users'][0].name).toBe('BobNew');
    // other fields preserved
    expect(storeData['users'][0].role).toBe('supplier');
  });

  it('modern: {id} filter + $set returns false when document not found', async () => {
    await seed({ id: 'u2', name: 'Bob', role: 'supplier' });
    const result = await dbUnified.updateOne('users', { id: 'u999' }, { $set: { name: 'Ghost' } });
    expect(result).toBe(false);
    expect(storeData['users'][0].name).toBe('Bob');
  });

  it('$set + $unset removes keys and sets new values', async () => {
    await seed({ id: 'u3', name: 'Carol', phone: '07700900000', role: 'customer' });
    const result = await dbUnified.updateOne(
      'users',
      { id: 'u3' },
      {
        $set: { name: 'CarolNew' },
        $unset: { phone: '' },
      }
    );
    expect(result).toBe(true);
    expect(storeData['users'][0].name).toBe('CarolNew');
    expect(storeData['users'][0].phone).toBeUndefined();
    // other fields preserved
    expect(storeData['users'][0].role).toBe('customer');
  });

  it('multi-key $unset removes all listed keys', async () => {
    await seed({
      id: 'u4',
      name: 'Dave',
      twoFactorSecret: 'secret',
      twoFactorBackupCodes: ['a', 'b'],
      twoFactorEnabled: true,
    });
    const result = await dbUnified.updateOne(
      'users',
      { id: 'u4' },
      {
        $set: { twoFactorEnabled: false },
        $unset: { twoFactorSecret: '', twoFactorBackupCodes: '' },
      }
    );
    expect(result).toBe(true);
    const doc = storeData['users'][0];
    expect(doc.twoFactorEnabled).toBe(false);
    expect(doc.twoFactorSecret).toBeUndefined();
    expect(doc.twoFactorBackupCodes).toBeUndefined();
  });

  it('$set with multiple fields updates all of them', async () => {
    await seed({ id: 'u5', name: 'Eve', phone: null, emailVerified: false });
    await dbUnified.updateOne(
      'users',
      { id: 'u5' },
      {
        $set: {
          emailVerified: true,
          emailVerifiedAt: '2026-01-01T00:00:00.000Z',
        },
      }
    );
    const doc = storeData['users'][0];
    expect(doc.emailVerified).toBe(true);
    expect(doc.emailVerifiedAt).toBe('2026-01-01T00:00:00.000Z');
    // original fields preserved
    expect(doc.name).toBe('Eve');
  });

  // Regression: the local-store branch used to shallow-spread $set fields
  // directly onto the document, so a dotted key like
  // 'emailPrefs.actionPrompts.enabled' was written as a literal top-level
  // property named "emailPrefs.actionPrompts.enabled" instead of nesting —
  // silently breaking every dot-path update in local/dev/test (MongoDB
  // handles these natively via its own $set semantics).
  it('a dotted $set key nests into the object instead of a literal flat key', async () => {
    await seed({ id: 'u6', name: 'Frank', emailPrefs: { actionPrompts: { enabled: true } } });
    const result = await dbUnified.updateOne(
      'users',
      { id: 'u6' },
      { $set: { 'emailPrefs.actionPrompts.enabled': false } }
    );
    expect(result).toBe(true);
    const doc = storeData['users'][0];
    expect(doc.emailPrefs.actionPrompts.enabled).toBe(false);
    expect(doc['emailPrefs.actionPrompts.enabled']).toBeUndefined();
  });

  it('a dotted $set key creates intermediate objects when none exist yet', async () => {
    await seed({ id: 'u7', name: 'Grace' });
    await dbUnified.updateOne(
      'users',
      { id: 'u7' },
      { $set: { 'communityNotificationPreferences.email': 'daily' } }
    );
    const doc = storeData['users'][0];
    expect(doc.communityNotificationPreferences).toEqual({ email: 'daily' });
  });

  it('a dotted $set key preserves sibling keys already nested at that path', async () => {
    await seed({
      id: 'u8',
      name: 'Heidi',
      emailPrefs: { actionPrompts: { enabled: true, missingPackages: false } },
    });
    await dbUnified.updateOne(
      'users',
      { id: 'u8' },
      { $set: { 'emailPrefs.actionPrompts.enabled': false } }
    );
    const doc = storeData['users'][0];
    expect(doc.emailPrefs.actionPrompts).toEqual({ enabled: false, missingPackages: false });
  });

  // Regression for a CodeQL "remote property injection" finding: unlike the
  // object-spread this replaced, `cursor[segment] = value` for
  // segment === '__proto__' invokes the real accessor rather than copying a
  // value. applyDotPathSet now builds its write tree out of
  // Object.create(null) nodes (see toNullProtoTree/toPlainObject in
  // db-unified.js) so a dotted key can never reach Object.prototype
  // regardless of its segments — a __proto__/constructor/prototype segment
  // is stored as an ordinary, inert data field rather than rejected, which
  // also matches real MongoDB (no special handling of those names either).
  it('stores a __proto__ path segment as an inert field instead of polluting the prototype', async () => {
    await seed({ id: 'u9', name: 'Ivan' });
    const result = await dbUnified.updateOne(
      'users',
      { id: 'u9' },
      { $set: { '__proto__.polluted': true } }
    );
    expect(result).toBe(true);
    expect({}.polluted).toBeUndefined();
    expect(storeData['users'][0].polluted).toBeUndefined();
    expect(storeData['users'][0].__proto__).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(storeData['users'][0])).toBe(Object.prototype);
  });

  it('does not pollute the prototype via a genuine own __proto__ property in $set', async () => {
    // Object-literal syntax (`{ __proto__: {...} }`) sets the prototype at
    // creation time rather than creating an own enumerable property, so it
    // wouldn't exercise this path at all — JSON.parse does create a real
    // own "__proto__" property, which is also the actual real-world vector
    // (a JSON request body parsed by express.json()).
    await seed({ id: 'u10', name: 'Judy' });
    const maliciousSet = JSON.parse('{"__proto__": {"polluted": true}}');
    const doc = await dbUnified.updateOne('users', { id: 'u10' }, { $set: maliciousSet });
    expect(doc).toBe(true);
    expect({}.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(storeData['users'][0])).toBe(Object.prototype);
  });

  it('does not pollute the prototype via a constructor.prototype segment', async () => {
    await seed({ id: 'u11', name: 'Kevin' });
    await dbUnified.updateOne(
      'users',
      { id: 'u11' },
      { $set: { 'constructor.prototype.polluted': true } }
    );
    expect({}.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(storeData['users'][0])).toBe(Object.prototype);
  });

  it('returns an ordinary, JSON-serialisable document rather than a null-prototype object', async () => {
    await seed({ id: 'u12', name: 'Laura' });
    await dbUnified.updateOne('users', { id: 'u12' }, { $set: { 'a.b.c': 1 } });
    const doc = storeData['users'][0];
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(doc.a)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(doc.a.b)).toBe(Object.prototype);
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(typeof doc.hasOwnProperty).toBe('function');
  });
});

describe('db-unified – updateMany dot-path $set (local storage)', () => {
  let dbUnified;
  let storeData;

  beforeEach(() => {
    jest.resetModules();
    storeData = {};
    const mockStore = {
      uid: jest.fn(p => `${p}_123`),
      read: jest.fn(name => (storeData[name] ? [...storeData[name]] : [])),
      write: jest.fn((name, data) => {
        storeData[name] = [...data];
      }),
    };
    jest.mock('../../db', () => ({ isMongoAvailable: jest.fn(() => false), connect: jest.fn() }));
    jest.mock('../../store', () => mockStore);
    dbUnified = require('../../db-unified');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('nests a dotted $set key across every matched document instead of a literal flat key', async () => {
    await dbUnified.initializeDatabase();
    storeData['users'] = [
      { id: 'u1', role: 'customer', communityNotificationPreferences: { email: 'weekly' } },
      { id: 'u2', role: 'supplier', communityNotificationPreferences: { email: 'weekly' } },
    ];

    const modified = await dbUnified.updateMany(
      'users',
      { role: 'customer' },
      { $set: { 'communityNotificationPreferences.email': 'none' } }
    );

    expect(modified).toBe(1);
    expect(storeData['users'][0].communityNotificationPreferences).toEqual({ email: 'none' });
    expect(storeData['users'][0]['communityNotificationPreferences.email']).toBeUndefined();
    // Untouched sibling document is unaffected
    expect(storeData['users'][1].communityNotificationPreferences).toEqual({ email: 'weekly' });
  });
});
