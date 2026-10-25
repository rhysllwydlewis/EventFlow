/**
 * utils/devMailbox.js and the test-only GET /__e2e/mail route that reads it.
 *
 * The local outbox files hold metadata only; where the browser tests need the link in the
 * verification email, the full copy is kept in memory and handed back by this route, which answers
 * 404 outside NODE_ENV=test and 403 without the private suite header.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

const devMailbox = require('../../utils/devMailbox');

jest.mock('../../db-unified', () => ({}));
jest.mock('../../services/catalogCache', () => ({ invalidate: jest.fn() }));
jest.mock('../../middleware/searchCache', () => ({ clearSearchCache: jest.fn() }));

const HEADERS = { 'x-eventflow-e2e': 'backend-suite' };

function appWithRoute() {
  const app = express();
  app.use('/__e2e', require('../../routes/e2e-test-support'));
  return app;
}

describe('devMailbox', () => {
  beforeEach(() => devMailbox.clear());

  test('finds the newest message to an address, whatever the case or display name', () => {
    devMailbox.remember({ to: 'Jane <jane@example.com>', subject: 'first', html: '<p>1</p>' });
    devMailbox.remember({ to: 'jane@example.com', subject: 'second', html: '<p>2</p>' });
    devMailbox.remember({ to: 'other@example.com', subject: 'third', html: '<p>3</p>' });
    expect(devMailbox.findNewestTo('JANE@example.com').subject).toBe('second');
    expect(devMailbox.findNewestTo('nobody@example.com')).toBeNull();
    expect(devMailbox.findNewestTo('')).toBeNull();
  });

  test('ignores messages older than the `since` moment', () => {
    devMailbox.remember({ to: 'jane@example.com', subject: 'old' });
    expect(devMailbox.findNewestTo('jane@example.com', Date.now() + 60000)).toBeNull();
  });

  test('keeps at most MAX_MESSAGES and clips huge fields', () => {
    for (let i = 0; i < devMailbox.MAX_MESSAGES + 5; i++) {
      devMailbox.remember({ to: `u${i}@example.com`, subject: 's' });
    }
    expect(devMailbox.findNewestTo('u0@example.com')).toBeNull();
    expect(devMailbox.findNewestTo(`u${devMailbox.MAX_MESSAGES + 4}@example.com`)).not.toBeNull();
    devMailbox.remember({ to: 'big@example.com', html: 'x'.repeat(500000) });
    expect(devMailbox.findNewestTo('big@example.com').html.length).toBe(200000);
  });
});

describe('GET /__e2e/mail', () => {
  const savedEnv = process.env.NODE_ENV;

  beforeEach(() => {
    devMailbox.clear();
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env.NODE_ENV = savedEnv;
  });

  test('returns the newest message for the address', async () => {
    devMailbox.remember({
      to: 'jane@example.com',
      subject: 'Confirm your EventFlow account',
      html: '<a href="https://x.test/verify?token=abc">verify</a>',
    });
    const res = await request(appWithRoute())
      .get('/__e2e/mail?to=jane%40example.com&since=0')
      .set(HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Confirm your EventFlow account');
    expect(res.body.html).toContain('token=abc');
  });

  test('404 while no message has arrived', async () => {
    const res = await request(appWithRoute()).get('/__e2e/mail?to=jane%40example.com').set(HEADERS);
    expect(res.status).toBe(404);
  });

  test('403 without the private suite header', async () => {
    devMailbox.remember({ to: 'jane@example.com', subject: 's' });
    const res = await request(appWithRoute()).get('/__e2e/mail?to=jane%40example.com');
    expect(res.status).toBe(403);
  });

  test('404 outside NODE_ENV=test, even with the header', async () => {
    devMailbox.remember({ to: 'jane@example.com', subject: 's' });
    process.env.NODE_ENV = 'production';
    const res = await request(appWithRoute()).get('/__e2e/mail?to=jane%40example.com').set(HEADERS);
    expect(res.status).toBe(404);
  });
});
