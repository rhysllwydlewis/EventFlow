/**
 * Tests for thread metadata updates when messages are sent
 * Ensures lastMessageAt and lastMessagePreview are properly maintained
 */

const fs = require('fs');
const path = require('path');

const threadsRoutePath = path.join(process.cwd(), 'routes/threads.js');
(fs.existsSync(threadsRoutePath) ? describe : describe.skip)(
  'Thread metadata updates on message send',
  () => {
    const threadsRouteJs = fs.existsSync(threadsRoutePath)
      ? fs.readFileSync(threadsRoutePath, 'utf8')
      : '';

    describe('POST /:id/messages endpoint metadata updates', () => {
      // Extract the POST messages endpoint code
      const postMessagesHandler =
        threadsRouteJs && threadsRouteJs.includes("router.post(\n  '/:id/messages'")
          ? threadsRouteJs.split("router.post(\n  '/:id/messages'")[1].split('router.')[0]
          : '';

      it('updates thread updatedAt timestamp when message is sent', () => {
        expect(postMessagesHandler).toContain('updatedAt: entry.createdAt');
      });

      it('updates thread lastMessageAt with message createdAt', () => {
        expect(postMessagesHandler).toContain('lastMessageAt: entry.createdAt');
      });

      it('updates thread lastMessagePreview with first 100 chars of message text', () => {
        expect(postMessagesHandler).toContain(
          "lastMessagePreview: entry.text?.substring(0, 100) || ''"
        );
      });

      it('updates MongoDB thread record after updating metadata', () => {
        // After updating the thread metadata, should also dual-write to MongoDB
        expect(postMessagesHandler).toContain('writeThreadToMongoDB');
      });
    });

    describe('POST /start endpoint with initial message metadata', () => {
      // Extract the POST start endpoint code section that handles initial messages
      const postStartHandler =
        threadsRouteJs && threadsRouteJs.includes("router.post(\n  '/start'")
          ? threadsRouteJs.split("router.post(\n  '/start'")[1].split('router.')[0]
          : '';

      const initialMessageSection =
        postStartHandler && postStartHandler.includes('If an initial message was included')
          ? postStartHandler
              .split('If an initial message was included')[1]
              .split('Email notify supplier')[0]
          : '';

      it('updates thread updatedAt when initial message is sent', () => {
        expect(initialMessageSection).toContain('updatedAt: entry.createdAt');
      });

      it('updates thread lastMessageAt when initial message is sent', () => {
        expect(initialMessageSection).toContain('lastMessageAt: entry.createdAt');
      });

      it('updates thread lastMessagePreview when initial message is sent', () => {
        expect(initialMessageSection).toContain(
          "lastMessagePreview: entry.text?.substring(0, 100) || ''"
        );
      });

      it('updates MongoDB thread record after initial message metadata', () => {
        // After updating the thread metadata, should also dual-write to MongoDB
        expect(initialMessageSection).toContain('writeThreadToMongoDB');
      });
    });

    describe('Thread metadata field consistency', () => {
      it('uses same preview length (100 chars) in both endpoints', () => {
        // Both endpoints should use substring(0, 100) for consistency
        const postMessagesHandler = threadsRouteJs
          .split("router.post(\n  '/:id/messages'")[1]
          .split('router.')[0];

        const postStartHandler = threadsRouteJs
          .split("router.post(\n  '/start'")[1]
          .split('router.')[0];

        expect(postMessagesHandler).toContain('.substring(0, 100)');
        expect(postStartHandler).toContain('.substring(0, 100)');
      });

      it('sets lastMessageAt to message createdAt in both endpoints', () => {
        // Both should use entry.createdAt as the timestamp
        const postMessagesHandler = threadsRouteJs
          .split("router.post(\n  '/:id/messages'")[1]
          .split('router.')[0];

        const postStartHandler = threadsRouteJs
          .split("router.post(\n  '/start'")[1]
          .split('router.')[0];

        expect(postMessagesHandler).toContain('lastMessageAt: entry.createdAt');
        expect(postStartHandler).toContain('lastMessageAt: entry.createdAt');
      });

      it('sets lastMessagePreview to message text in both endpoints', () => {
        // Both should use entry.text for the preview
        const postMessagesHandler = threadsRouteJs
          .split("router.post(\n  '/:id/messages'")[1]
          .split('router.')[0];

        const postStartHandler = threadsRouteJs
          .split("router.post(\n  '/start'")[1]
          .split('router.')[0];

        expect(postMessagesHandler).toContain('lastMessagePreview');
        expect(postStartHandler).toContain('lastMessagePreview');
      });
    });

    describe('Lead scoring fields on thread creation', () => {
      const postStartHandler =
        threadsRouteJs && threadsRouteJs.includes("router.post(\n  '/start'")
          ? threadsRouteJs.split("router.post(\n  '/start'")[1].split('router.')[0]
          : '';

      it('stores leadScore (rating string) on thread', () => {
        expect(postStartHandler).toContain('leadScore: leadScoreResult.rating');
      });

      it('stores leadScoreRaw (numeric 0-100) on thread', () => {
        expect(postStartHandler).toContain('leadScoreRaw: leadScoreResult.score');
      });

      it('stores leadScoreBreakdown (detailed breakdown) on thread', () => {
        expect(postStartHandler).toContain('leadScoreBreakdown: leadScoreResult.breakdown');
      });

      it('stores scoredAt timestamp on thread', () => {
        expect(postStartHandler).toContain('scoredAt:');
        expect(postStartHandler).toContain('new Date().toISOString()');
      });

      it('tracks enquiry analytics after thread creation', () => {
        expect(postStartHandler).toContain('supplierAnalytics');
        expect(postStartHandler).toContain('trackEnquirySent');
      });
    });
  }
);
