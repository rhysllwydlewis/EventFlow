'use strict';

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/opsBotHmac');

const mockReviewTasks = {
  listTasks: jest.fn(),
  updateTask: jest.fn(),
};
const mockDbUnified = {
  read: jest.fn(),
};
const mockAudit = {
  getAuditLogs: jest.fn(),
};
const mockSeoInsights = {
  getOverview: jest.fn(),
  getQueryTable: jest.fn(),
  getStrikingDistanceReport: jest.fn(),
  getLowCtrReport: jest.fn(),
  getContentGapReport: jest.fn(),
  getFinancialEstimate: jest.fn(),
};
const mockSeoDataStore = {
  getAllIngestionStatus: jest.fn(),
  getSettings: jest.fn(),
};
const mockEmailLog = {
  getSummary: jest.fn(),
  listLogs: jest.fn(),
};
const mockReviews = {
  getFlaggedReviews: jest.fn(),
};

jest.mock('../../services/contentReviewTask.service', () => mockReviewTasks);
jest.mock('../../db-unified', () => mockDbUnified);
jest.mock('../../middleware/audit', () => mockAudit);
jest.mock('../../services/seoInsights.service', () => mockSeoInsights);
jest.mock('../../services/seoDataStore', () => mockSeoDataStore);
jest.mock('../../services/emailLog.service', () => mockEmailLog);
jest.mock('../../reviews', () => mockReviews);

const opsBotRouter = require('../../routes/ops-bot');

const secret = 'repeatable-ops-bot-test-secret'.repeat(2);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/internal/ops-bot', opsBotRouter);
  return app;
}

function signedRequest(app, method, path, body = {}) {
  const timestamp = String(Date.now());
  const signature = signatureFor(
    secret,
    timestamp,
    method.toUpperCase(),
    path,
    JSON.stringify(body)
  );
  return request(app)
    [method](path)
    .set('x-eventflow-bot-timestamp', timestamp)
    .set('x-eventflow-bot-signature', `sha256=${signature}`)
    .send(body);
}

describe('Ops Assistant worker API', () => {
  const originalEnabled = process.env.OPS_ASSISTANT_ENABLED;
  const originalSecret = process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = secret;
  });

  afterAll(() => {
    if (originalEnabled === undefined) {
      delete process.env.OPS_ASSISTANT_ENABLED;
    } else {
      process.env.OPS_ASSISTANT_ENABLED = originalEnabled;
    }
    if (originalSecret === undefined) {
      delete process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;
    } else {
      process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = originalSecret;
    }
  });

  it('rejects requests with no signature at all', async () => {
    const app = createApp();
    const res = await request(app).get('/internal/ops-bot/content-review-tasks');
    expect(res.status).toBe(401);
  });

  it('lists content review tasks for a correctly signed request', async () => {
    mockReviewTasks.listTasks.mockResolvedValue([{ id: 'article-review-2026-09', status: 'open' }]);
    const app = createApp();

    const res = await signedRequest(app, 'get', '/internal/ops-bot/content-review-tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      tasks: [{ id: 'article-review-2026-09', status: 'open' }],
    });
  });

  it('updates a content review task as the ops-bot actor', async () => {
    mockReviewTasks.updateTask.mockResolvedValue({
      id: 'article-review-2026-09',
      status: 'completed',
      outcome: 'no_change',
    });
    const app = createApp();
    const body = { status: 'completed', outcome: 'no_change' };

    const res = await signedRequest(
      app,
      'patch',
      '/internal/ops-bot/content-review-tasks/article-review-2026-09',
      body
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockReviewTasks.updateTask).toHaveBeenCalledWith('article-review-2026-09', body, {
      id: 'ops-bot',
    });
  });

  it('returns 404 when the task does not exist', async () => {
    mockReviewTasks.updateTask.mockResolvedValue(null);
    const app = createApp();

    const res = await signedRequest(
      app,
      'patch',
      '/internal/ops-bot/content-review-tasks/missing',
      {
        status: 'completed',
        outcome: 'no_change',
      }
    );

    expect(res.status).toBe(404);
  });

  it('rejects a validly signed request replayed against a different task id', async () => {
    const app = createApp();
    const body = { status: 'completed', outcome: 'no_change' };
    const timestamp = String(Date.now());
    const signature = signatureFor(
      secret,
      timestamp,
      'PATCH',
      '/internal/ops-bot/content-review-tasks/article-review-2026-09',
      JSON.stringify(body)
    );

    const res = await request(app)
      .patch('/internal/ops-bot/content-review-tasks/a-different-task')
      .set('x-eventflow-bot-timestamp', timestamp)
      .set('x-eventflow-bot-signature', `sha256=${signature}`)
      .send(body);

    expect(res.status).toBe(401);
    expect(mockReviewTasks.updateTask).not.toHaveBeenCalled();
  });

  it('is disabled entirely when OPS_ASSISTANT_ENABLED is not true', async () => {
    process.env.OPS_ASSISTANT_ENABLED = 'false';
    const app = createApp();

    const res = await signedRequest(app, 'get', '/internal/ops-bot/content-review-tasks');

    expect(res.status).toBe(503);
  });

  describe('read-only reporting endpoints', () => {
    it('returns audit log entries', async () => {
      mockAudit.getAuditLogs.mockResolvedValue([{ id: 'log-1', action: 'user.suspend' }]);
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/audit-log');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        logs: [{ id: 'log-1', action: 'user.suspend' }],
        count: 1,
      });
    });

    it('returns an SEO insights report by name', async () => {
      mockSeoInsights.getOverview.mockResolvedValue({ clicks: 100 });
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/seo-insights/overview');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: { clicks: 100 } });
    });

    it('rejects an unknown SEO report name', async () => {
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/seo-insights/not-a-report');

      expect(res.status).toBe(404);
    });

    it.each([
      ['status', () => mockSeoDataStore.getAllIngestionStatus.mockResolvedValue({ ok: true })],
      [
        'striking-distance',
        () => mockSeoInsights.getStrikingDistanceReport.mockResolvedValue({ rows: [] }),
      ],
      ['low-ctr', () => mockSeoInsights.getLowCtrReport.mockResolvedValue({ rows: [] })],
      ['content-gaps', () => mockSeoInsights.getContentGapReport.mockResolvedValue({ rows: [] })],
      [
        'financial-estimate',
        () => mockSeoInsights.getFinancialEstimate.mockResolvedValue({ value: 0 }),
      ],
    ])('returns the %s SEO report', async (report, primeMock) => {
      primeMock();
      const app = createApp();

      const res = await signedRequest(app, 'get', `/internal/ops-bot/seo-insights/${report}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns a 500 when an SEO report throws', async () => {
      mockSeoInsights.getOverview.mockRejectedValue(new Error('seo service down'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/seo-insights/overview');

      expect(res.status).toBe(500);
    });

    it('returns a 500 when the audit log read throws', async () => {
      mockAudit.getAuditLogs.mockRejectedValue(new Error('audit store down'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/audit-log');

      expect(res.status).toBe(500);
    });

    it('returns the email summary', async () => {
      mockEmailLog.getSummary.mockResolvedValue({ bounceRate: 0.01 });
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/email-summary');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, summary: { bounceRate: 0.01 } });
    });

    it('returns a 500 when the email summary throws', async () => {
      mockEmailLog.getSummary.mockRejectedValue(new Error('postmark down'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/email-summary');

      expect(res.status).toBe(500);
    });

    it('lists email logs', async () => {
      mockEmailLog.listLogs.mockResolvedValue({
        items: [{ id: 'email-1', status: 'delivered' }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/email-logs?status=delivered');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ id: 'email-1', status: 'delivered' }]);
      expect(mockEmailLog.listLogs).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'delivered' })
      );
    });

    it('returns a 500 when email logs throw', async () => {
      mockEmailLog.listLogs.mockRejectedValue(new Error('email log store down'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/email-logs');

      expect(res.status).toBe(500);
    });

    it('returns flagged reviews', async () => {
      mockReviews.getFlaggedReviews.mockResolvedValue([{ id: 'review-1', flagged: true }]);
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/reviews/flagged');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, reviews: [{ id: 'review-1', flagged: true }] });
    });

    it('returns a 500 when flagged reviews throw', async () => {
      mockReviews.getFlaggedReviews.mockRejectedValue(new Error('reviews module down'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/reviews/flagged');

      expect(res.status).toBe(500);
    });

    it('filters content reports by status', async () => {
      mockDbUnified.read.mockResolvedValue([
        { id: 'r1', status: 'pending', createdAt: '2026-09-01' },
        { id: 'r2', status: 'resolved', createdAt: '2026-09-02' },
      ]);
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/content-reports');

      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([{ id: 'r1', status: 'pending', createdAt: '2026-09-01' }]);
      expect(mockDbUnified.read).toHaveBeenCalledWith('reports');
    });

    it('returns every report when status=all is requested', async () => {
      mockDbUnified.read.mockResolvedValue([
        { id: 'r1', status: 'pending', type: 'listing', createdAt: '2026-09-01' },
        { id: 'r2', status: 'resolved', type: 'review', createdAt: '2026-09-02' },
      ]);
      const app = createApp();

      const res = await signedRequest(
        app,
        'get',
        '/internal/ops-bot/content-reports?status=all&type=review'
      );

      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([
        { id: 'r2', status: 'resolved', type: 'review', createdAt: '2026-09-02' },
      ]);
    });

    it('lists suppliers pending verification', async () => {
      mockDbUnified.read.mockResolvedValue([
        { id: 's1', name: 'Verified Co', verified: true },
        { id: 's2', name: 'Pending Co', verified: false, verificationStatus: 'pending' },
      ]);
      const app = createApp();

      const res = await signedRequest(
        app,
        'get',
        '/internal/ops-bot/suppliers/pending-verification'
      );

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.suppliers[0].id).toBe('s2');
    });

    it('returns a 500 when the pending-verification read throws', async () => {
      mockDbUnified.read.mockRejectedValue(new Error('db exploded'));
      const app = createApp();

      const res = await signedRequest(
        app,
        'get',
        '/internal/ops-bot/suppliers/pending-verification'
      );

      expect(res.status).toBe(500);
    });

    it('groups suppliers sharing an owner as duplicate candidates', async () => {
      mockDbUnified.read.mockResolvedValue([
        { id: 's1', name: 'A', ownerUserId: 'owner-1' },
        { id: 's2', name: 'B', ownerUserId: 'owner-1' },
        { id: 's3', name: 'C', ownerUserId: 'owner-2' },
      ]);
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/suppliers/duplicates');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.duplicateGroups[0].ownerUserId).toBe('owner-1');
      expect(res.body.duplicateGroups[0].suppliers).toHaveLength(2);
    });

    it('returns a 500 when the duplicates read throws', async () => {
      mockDbUnified.read.mockRejectedValue(new Error('db exploded'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/suppliers/duplicates');

      expect(res.status).toBe(500);
    });

    it('lists partner abuse events filtered by risk level', async () => {
      mockDbUnified.read.mockResolvedValue([
        { id: 'e1', riskLevel: 'high', createdAt: '2026-09-02' },
        { id: 'e2', riskLevel: 'low', createdAt: '2026-09-01' },
      ]);
      const app = createApp();

      const res = await signedRequest(
        app,
        'get',
        '/internal/ops-bot/partner-abuse/events?riskLevel=high'
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ id: 'e1', riskLevel: 'high', createdAt: '2026-09-02' }]);
    });

    it('lists partner abuse events filtered by outcome', async () => {
      mockDbUnified.read.mockResolvedValue([
        { id: 'e1', outcome: 'blocked', createdAt: '2026-09-02' },
        { id: 'e2', outcome: 'allowed', createdAt: '2026-09-01' },
      ]);
      const app = createApp();

      const res = await signedRequest(
        app,
        'get',
        '/internal/ops-bot/partner-abuse/events?outcome=blocked'
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ id: 'e1', outcome: 'blocked', createdAt: '2026-09-02' }]);
    });

    it('returns a 500 when the partner abuse events read throws', async () => {
      mockDbUnified.read.mockRejectedValue(new Error('db exploded'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/partner-abuse/events');

      expect(res.status).toBe(500);
    });

    it('lists partner abuse appeals filtered by status', async () => {
      mockDbUnified.read.mockResolvedValue([
        { id: 'a1', status: 'open', createdAt: '2026-09-02' },
        { id: 'a2', status: 'resolved', createdAt: '2026-09-01' },
      ]);
      const app = createApp();

      const res = await signedRequest(
        app,
        'get',
        '/internal/ops-bot/partner-abuse/appeals?status=open'
      );

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([{ id: 'a1', status: 'open', createdAt: '2026-09-02' }]);
    });

    it('returns a 500 when the partner abuse appeals read throws', async () => {
      mockDbUnified.read.mockRejectedValue(new Error('db exploded'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/partner-abuse/appeals');

      expect(res.status).toBe(500);
    });

    it('returns a read error as a 500 without leaking internals', async () => {
      mockDbUnified.read.mockRejectedValue(new Error('db exploded'));
      const app = createApp();

      const res = await signedRequest(app, 'get', '/internal/ops-bot/content-reports');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ ok: false, error: 'Internal server error' });
    });
  });
});
