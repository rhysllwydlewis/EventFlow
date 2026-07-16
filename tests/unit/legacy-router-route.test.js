'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { removeLoadedRouterRoute, removeRouterRoute } = require('../../utils/legacyRouterRoute');

describe('legacy router route removal', () => {
  test('removes only the exact obsolete method and path', async () => {
    const router = express.Router();
    router.post('/request-review', (_req, res) => res.json({ handler: 'legacy' }));
    router.get('/request-review', (_req, res) => res.json({ handler: 'legacy-get' }));
    router.post('/availability', (_req, res) => res.json({ handler: 'availability' }));

    expect(removeRouterRoute(router, '/request-review', 'post')).toBe(1);

    const app = express();
    app.use('/api/v1/supplier', router);

    await request(app).post('/api/v1/supplier/request-review').expect(404);
    await request(app)
      .get('/api/v1/supplier/request-review')
      .expect(200, { handler: 'legacy-get' });
    await request(app)
      .post('/api/v1/supplier/availability')
      .expect(200, { handler: 'availability' });
  });

  test('allows a later canonical router to receive a formerly shadowed request', async () => {
    const legacyRouter = express.Router();
    legacyRouter.post('/request-review', (_req, res) => {
      res.json({ handler: 'false-success' });
    });

    expect(removeRouterRoute(legacyRouter, '/request-review', 'post')).toBe(1);

    const canonicalRouter = express.Router();
    canonicalRouter.post('/api/v1/supplier/request-review', (_req, res) => {
      res.json({ handler: 'canonical' });
    });

    const app = express();
    app.use('/api/v1/supplier', legacyRouter);
    app.use(canonicalRouter);

    await request(app)
      .post('/api/v1/supplier/request-review')
      .expect(200, { handler: 'canonical' });
  });

  test('does not load a missing module merely to patch it', () => {
    const missingModulePath = path.join(__dirname, '__missing-legacy-router.js');

    expect(require.cache[missingModulePath]).toBeUndefined();
    expect(removeLoadedRouterRoute(missingModulePath, '/postmark', 'post')).toBe(0);
    expect(require.cache[missingModulePath]).toBeUndefined();
  });

  test('canonical review and Postmark modules disable their obsolete predecessors', () => {
    const reviewSource = fs.readFileSync(
      path.join(__dirname, '../../routes/review-requests.js'),
      'utf8'
    );
    const postmarkSource = fs.readFileSync(
      path.join(__dirname, '../../routes/postmark-webhook.js'),
      'utf8'
    );

    expect(reviewSource).toContain("require.resolve('./supplier')");
    expect(reviewSource).toContain("'/request-review'");
    expect(postmarkSource).toContain("require.resolve('./webhooks')");
    expect(postmarkSource).toContain("'/postmark'");
  });
});
