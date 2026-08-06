'use strict';

const mockCollections = new Map();
const mockRows = name => mockCollections.get(name) || [];

jest.mock('../../db-unified', () => ({
  findOne: jest.fn(
    async (name, filter) => mockRows(name).find(row => row.id === filter.id) || null
  ),
  find: jest.fn(async (name, filter) =>
    mockRows(name).filter(row => !filter.role || row.role === filter.role)
  ),
  read: jest.fn(async name => mockRows(name)),
  insertOne: jest.fn(async (name, document) => {
    if (mockRows(name).some(row => row.id === document.id)) {
      return null;
    }
    mockCollections.set(name, [...mockRows(name), { ...document }]);
    return document;
  }),
  updateOne: jest.fn(async (name, filter, updates) => {
    const index = mockRows(name).findIndex(row => row.id === filter.id);
    if (index < 0) {
      return false;
    }
    mockRows(name)[index] = { ...mockRows(name)[index], ...updates };
    return true;
  }),
}));
jest.mock('../../services/notifyAdmins.service', () => ({ notifyAdmins: jest.fn() }));
jest.mock('../../utils/postmark', () => ({
  sendMail: jest.fn(),
  FROM_SUPPORT: 'support@example.test',
}));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/contentReviewTask.service');

describe('persistent content review tasks', () => {
  beforeEach(() => mockCollections.clear());

  test('creates one article and one policy task per month idempotently', async () => {
    const now = new Date('2026-08-06T12:00:00Z');
    expect((await service.ensureMonthlyTasks(now)).created).toHaveLength(2);
    expect((await service.ensureMonthlyTasks(now)).created).toHaveLength(0);
    expect(await service.listTasks()).toHaveLength(2);
  });

  test('requires a recorded outcome before completion', async () => {
    await service.ensureMonthlyTasks(new Date('2026-08-06T12:00:00Z'));
    await expect(
      service.updateTask('article-review-2026-08', { status: 'completed' }, { id: 'admin-1' })
    ).rejects.toThrow('requires an outcome');
    const task = await service.updateTask(
      'article-review-2026-08',
      { status: 'completed', outcome: 'no_change', note: 'Checked all guides.' },
      { id: 'admin-1' }
    );
    expect(task).toEqual(
      expect.objectContaining({ status: 'completed', outcome: 'no_change', completedBy: 'admin-1' })
    );
  });

  test('stores settings in the database instead of rewriting deployed source files', async () => {
    const settings = await service.updateSettings({ emailDigestEnabled: true }, { id: 'admin-1' });
    expect(settings.emailDigestEnabled).toBe(true);
    expect((await service.getSettings()).emailDigestEnabled).toBe(true);
  });

  test('keeps the deployment comparison baseline server-managed', async () => {
    const attempted = await service.updateSettings(
      { lastInspectedDeploymentSha: 'a'.repeat(40) },
      { id: 'admin-1' }
    );
    expect(attempted.lastInspectedDeploymentSha).toBeNull();
    const recorded = await service.updateSettings(
      { lastInspectedDeploymentSha: 'b'.repeat(40) },
      { id: 'system' }
    );
    expect(recorded.lastInspectedDeploymentSha).toBe('b'.repeat(40));
  });
});
