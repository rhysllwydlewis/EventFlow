'use strict';

const { cleanHistory, findHistoriesToClean } = require('../../scripts/strip-user-history-secrets');

const dirtyEntry = () => ({
  timestamp: '2026-01-01T00:00:00Z',
  editedBy: 'admin-1',
  previousState: {
    id: 'u1',
    name: 'Ada',
    passwordHash: '$2a$10$hash',
    verificationToken: 'verify_live',
    twoFactorBackupCodes: ['code'],
    nested: { resetToken: 'reset_live', keep: 1 },
  },
});

describe('cleanHistory', () => {
  it('removes credentials from every snapshot and keeps the rest', () => {
    const cleaned = cleanHistory([dirtyEntry(), dirtyEntry()]);
    expect(JSON.stringify(cleaned)).not.toMatch(/hash|verify_live|reset_live|code/);
    expect(cleaned[0]).toEqual({
      timestamp: '2026-01-01T00:00:00Z',
      editedBy: 'admin-1',
      previousState: { id: 'u1', name: 'Ada', nested: { keep: 1 } },
    });
  });

  it('leaves entries without a snapshot alone and does not change its input', () => {
    const history = [dirtyEntry(), { timestamp: 'x' }, null];
    const cleaned = cleanHistory(history);
    expect(cleaned[1]).toEqual({ timestamp: 'x' });
    expect(cleaned[2]).toBeNull();
    expect(history[0].previousState.passwordHash).toBe('$2a$10$hash');
  });
});

describe('findHistoriesToClean', () => {
  it('returns only users whose history holds credentials, with the cleaned history', () => {
    const users = [
      { id: 'dirty', versionHistory: [dirtyEntry()] },
      { id: 'clean', versionHistory: [{ previousState: { id: 'c', name: 'Cy' } }] },
      { id: 'none' },
      { id: 'empty', versionHistory: [] },
      null,
    ];
    const found = findHistoriesToClean(users);
    expect(found.map(item => item.id)).toEqual(['dirty']);
    expect(JSON.stringify(found[0].versionHistory)).not.toMatch(/passwordHash/);
  });

  it('is idempotent: cleaning twice finds nothing the second time', () => {
    const [first] = findHistoriesToClean([{ id: 'u', versionHistory: [dirtyEntry()] }]);
    expect(findHistoriesToClean([{ id: 'u', versionHistory: first.versionHistory }])).toEqual([]);
  });
});
