/**
 * Schema/service enum drift guard.
 *
 * The `notifications.type` enum was once missing `ticket` and `announcement`
 * even though `NotificationService` was constructing documents with those
 * values, producing silent Mongo insert failures. This test codifies the
 * invariant that every enum value produced by the service is accepted by the
 * shared enum constants (which back the `$jsonSchema` validator).
 *
 * If you add a new notification `type` or `priority` in `notification.service.js`,
 * you MUST also add it to the matching constant in `models/index.js`. This
 * test is what fails the PR when you forget.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
  USER_ROLES,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  BILLING_INTERVALS,
  BADGE_TYPES,
  REVIEW_VOTE_TYPES,
  REVIEW_MODERATION_ACTIONS,
} = require('../../models/index');

describe('Schema enum constants — drift guards', () => {
  describe('Exported enum constants', () => {
    it('are all frozen arrays of strings', () => {
      const all = {
        NOTIFICATION_TYPES,
        NOTIFICATION_PRIORITIES,
        USER_ROLES,
        PAYMENT_STATUSES,
        PAYMENT_TYPES,
        BILLING_INTERVALS,
        BADGE_TYPES,
        REVIEW_VOTE_TYPES,
        REVIEW_MODERATION_ACTIONS,
      };
      for (const [name, values] of Object.entries(all)) {
        expect(Array.isArray(values)).toBe(true);
        expect(Object.isFrozen(values)).toBe(true);
        expect(values.length).toBeGreaterThan(0);
        values.forEach(v => expect(typeof v).toBe('string'));
      }
    });
  });

  describe('notifications.type — service vs schema', () => {
    let serviceSource;

    beforeAll(() => {
      serviceSource = fs.readFileSync(
        path.join(__dirname, '../../services/notification.service.js'),
        'utf8'
      );
    });

    /**
     * Extracts every string literal used as a `type:` key in object literals
     * inside notification.service.js. This is a heuristic but sufficient to
     * catch the class of bugs we care about (hard-coded type strings that
     * drift from the schema).
     */
    function extractHardcodedTypes(src) {
      const types = new Set();
      const re = /type:\s*'([a-z_-]+)'/gi;
      let m;
      while ((m = re.exec(src)) !== null) {
        types.add(m[1]);
      }
      return [...types];
    }

    function extractHardcodedPriorities(src) {
      const priorities = new Set();
      const re = /priority:\s*'([a-z_-]+)'/gi;
      let m;
      while ((m = re.exec(src)) !== null) {
        priorities.add(m[1]);
      }
      return [...priorities];
    }

    it('every hard-coded `type` in notification.service.js is in NOTIFICATION_TYPES', () => {
      const hardcoded = extractHardcodedTypes(serviceSource);
      expect(hardcoded.length).toBeGreaterThan(0);
      const missing = hardcoded.filter(t => !NOTIFICATION_TYPES.includes(t));
      expect(missing).toEqual([]);
    });

    it('every hard-coded `priority` in notification.service.js is in NOTIFICATION_PRIORITIES', () => {
      const hardcoded = extractHardcodedPriorities(serviceSource);
      expect(hardcoded.length).toBeGreaterThan(0);
      const missing = hardcoded.filter(p => !NOTIFICATION_PRIORITIES.includes(p));
      expect(missing).toEqual([]);
    });
  });

  describe('NotificationService — runtime enum validation', () => {
    const NotificationService = require('../../services/notification.service');

    // Minimal stub db that captures `collection().insertOne` calls.
    function makeStubDb() {
      return {
        collection: () => ({
          insertOne: async doc => ({ insertedId: doc.id }),
          insertMany: async docs => ({ insertedCount: docs.length }),
        }),
      };
    }

    it('create() throws a clear error for an invalid type', async () => {
      const svc = new NotificationService(makeStubDb(), null);
      await expect(
        svc.create({
          userId: 'u1',
          type: 'not-a-real-type',
          title: 't',
          message: 'm',
        })
      ).rejects.toThrow(/invalid type "not-a-real-type"/);
    });

    it('create() throws a clear error for an invalid priority', async () => {
      const svc = new NotificationService(makeStubDb(), null);
      await expect(
        svc.create({
          userId: 'u1',
          type: 'system',
          priority: 'super-urgent',
          title: 't',
          message: 'm',
        })
      ).rejects.toThrow(/invalid priority "super-urgent"/);
    });

    it('create() accepts every NOTIFICATION_TYPES value', async () => {
      const svc = new NotificationService(makeStubDb(), null);
      for (const type of NOTIFICATION_TYPES) {
        await expect(
          svc.create({
            userId: 'u1',
            type,
            title: 't',
            message: 'm',
          })
        ).resolves.toMatchObject({ type });
      }
    });

    it('create() accepts every NOTIFICATION_PRIORITIES value', async () => {
      const svc = new NotificationService(makeStubDb(), null);
      for (const priority of NOTIFICATION_PRIORITIES) {
        await expect(
          svc.create({
            userId: 'u1',
            type: 'system',
            priority,
            title: 't',
            message: 'm',
          })
        ).resolves.toMatchObject({ priority });
      }
    });
  });
});
