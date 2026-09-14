'use strict';

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/opsBotHmac');

const mockReviewTasks = {
  listTasks: jest.fn(),
  updateTask: jest.fn(),
};

jest.mock('../../services/contentReviewTask.service', () => mockReviewTasks);

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
  const signature = signatureFor(secret, timestamp, JSON.stringify(body));
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

  it('is disabled entirely when OPS_ASSISTANT_ENABLED is not true', async () => {
    process.env.OPS_ASSISTANT_ENABLED = 'false';
    const app = createApp();

    const res = await signedRequest(app, 'get', '/internal/ops-bot/content-review-tasks');

    expect(res.status).toBe(503);
  });
});
