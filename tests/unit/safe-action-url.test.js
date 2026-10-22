'use strict';

/**
 * A notification's address is followed by the browser when it is clicked, so only a page on this
 * site is ever stored.
 */

const { safeActionUrl, MAX_ACTION_URL_LENGTH } = require('../../utils/safeActionUrl');

describe('safeActionUrl', () => {
  test.each([
    '/dashboard/supplier#sdh-enquiries',
    '/messenger/?conversation=abc123',
    '/admin-tickets#contacts',
    '/community/discussions/some-thread#reply-5',
    '/',
  ])('keeps the site page %s', path => {
    expect(safeActionUrl(path)).toBe(path);
  });

  test('trims the surrounding space', () => {
    expect(safeActionUrl('  /plan  ')).toBe('/plan');
  });

  test.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'https://evil.example/phish',
    'http://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example/phish',
    '\\\\evil.example',
    '/path with space',
    '/line\nbreak',
    '/tab\there',
    'dashboard/supplier',
    '',
    '   ',
    null,
    undefined,
    42,
    {},
    ['/plan'],
  ])('refuses %p', value => {
    expect(safeActionUrl(value)).toBeNull();
  });

  test('refuses an address that is too long', () => {
    expect(safeActionUrl(`/${'a'.repeat(MAX_ACTION_URL_LENGTH)}`)).toBeNull();
    expect(safeActionUrl(`/${'a'.repeat(MAX_ACTION_URL_LENGTH - 1)}`)).not.toBeNull();
  });
});

describe('NotificationService stores only safe addresses', () => {
  const NotificationService = require('../../services/notification.service');

  function serviceWithStore() {
    const stored = [];
    const db = {
      collection: () => ({
        insertOne: async doc => {
          stored.push(doc);
        },
        insertMany: async docs => {
          stored.push(...docs);
        },
      }),
    };
    return { service: new NotificationService(db, null), stored };
  }

  test('create keeps a site page and drops anything else', async () => {
    const { service, stored } = serviceWithStore();
    await service.create({ userId: 'u1', title: 'a', message: 'a', actionUrl: '/plan' });
    await service.create({
      userId: 'u1',
      title: 'b',
      message: 'b',
      actionUrl: 'javascript:alert(1)',
    });
    await service.create({
      userId: 'u1',
      title: 'c',
      message: 'c',
      actionUrl: 'https://evil.example/',
    });
    expect(stored.map(n => n.actionUrl)).toEqual(['/plan', null, null]);
  });

  test('createBatch does the same', async () => {
    const { service, stored } = serviceWithStore();
    await service.createBatch([
      { userId: 'u1', title: 'a', message: 'a', actionUrl: '/admin-tickets' },
      { userId: 'u2', title: 'b', message: 'b', actionUrl: '//evil.example' },
    ]);
    expect(stored.map(n => n.actionUrl)).toEqual(['/admin-tickets', null]);
  });
});
