/**
 * Unit tests for routes/admin-campaigns.js collectRecipients()
 *
 * Regression coverage for a bug where account-level marketing consent
 * (`users.notify_marketing`/`marketingOptIn`) and newsletter consent
 * (`newsletterSubscribers.status`) were checked independently — so
 * unsubscribing via one store did not suppress sends sourced from the
 * other store for the same email address.
 */

'use strict';

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const { collectRecipients } = require('../../routes/admin-campaigns');

function setupDb({ users = [], newsletterSubscribers = [] }) {
  dbUnified.read.mockImplementation(async collection => {
    if (collection === 'users') {
      return users;
    }
    if (collection === 'newsletterSubscribers') {
      return newsletterSubscribers;
    }
    return [];
  });
}

describe('collectRecipients', () => {
  afterEach(() => jest.clearAllMocks());

  it('excludes a newsletter-unsubscribed address from the marketing audience', async () => {
    setupDb({
      users: [{ id: 'u1', email: 'dual@example.com', name: 'Dual', notify_marketing: true }],
      newsletterSubscribers: [{ email: 'dual@example.com', status: 'unsubscribed' }],
    });

    const recipients = await collectRecipients('marketing');
    expect(recipients).toHaveLength(0);
  });

  it('excludes an account-unsubscribed address from the newsletter audience', async () => {
    setupDb({
      users: [{ id: 'u1', email: 'dual@example.com', emailUnsubscribed: true }],
      newsletterSubscribers: [{ email: 'dual@example.com', status: 'active' }],
    });

    const recipients = await collectRecipients('newsletter');
    expect(recipients).toHaveLength(0);
  });

  it('still includes an address that opted in on one store and has no record in the other', async () => {
    setupDb({
      users: [{ id: 'u1', email: 'marketing-only@example.com', notify_marketing: true }],
      newsletterSubscribers: [],
    });

    const recipients = await collectRecipients('both');
    expect(recipients.map(r => r.email)).toEqual(['marketing-only@example.com']);
  });

  it('deduplicates an address opted in on both stores without double-suppressing it', async () => {
    setupDb({
      users: [{ id: 'u1', email: 'both@example.com', notify_marketing: true }],
      newsletterSubscribers: [{ email: 'both@example.com', status: 'active' }],
    });

    const recipients = await collectRecipients('both');
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe('both@example.com');
  });
});
