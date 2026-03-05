const fs = require('fs');
const path = require('path');

const threadsRoutePath = path.join(process.cwd(), 'routes/threads.js');
(fs.existsSync(threadsRoutePath) ? describe : describe.skip)(
  'Marketplace v2 dual-write functionality',
  () => {
    (fs.existsSync(threadsRoutePath) ? describe : describe.skip)(
      'routes/threads.js dual-write implementation',
      () => {
        const threadsJs = fs.existsSync(threadsRoutePath)
          ? fs.readFileSync(threadsRoutePath, 'utf8')
          : '';

        it('includes mongoDb in dependencies', () => {
          expect(threadsJs).toContain('let mongoDb;');
          expect(threadsJs).toContain("'mongoDb',");
          expect(threadsJs).toContain('mongoDb = deps.mongoDb;');
        });

        it('has writeThreadToMongoDB helper function', () => {
          expect(threadsJs).toContain('async function writeThreadToMongoDB(thread, db)');
          expect(threadsJs).toContain("const threadsCollection = db.collection('threads')");
        });

        it('writeThreadToMongoDB builds participants array', () => {
          const writeThreadFn = threadsJs
            .split('async function writeThreadToMongoDB')[1]
            .split('async function')[0];
          expect(writeThreadFn).toContain('const participants = []');
          expect(writeThreadFn).toContain('thread.customerId');
          expect(writeThreadFn).toContain('thread.recipientId');
        });

        it('writeThreadToMongoDB uses upsert', () => {
          const writeThreadFn = threadsJs
            .split('async function writeThreadToMongoDB')[1]
            .split('async function')[0];
          expect(writeThreadFn).toContain('updateOne');
          expect(writeThreadFn).toContain('upsert: true');
        });

        it('has writeMessageToMongoDB helper function', () => {
          expect(threadsJs).toContain('async function writeMessageToMongoDB(message, db)');
          expect(threadsJs).toContain("const messagesCollection = db.collection('messages')");
        });

        it('writeMessageToMongoDB maps v1 to v2 fields', () => {
          const writeMessageFn = threadsJs
            .split('async function writeMessageToMongoDB')[1]
            .split('async function')[0];
          expect(writeMessageFn).toContain('senderId: message.fromUserId');
          expect(writeMessageFn).toContain('content: message.text');
          expect(writeMessageFn).toContain('sentAt: message.createdAt');
        });

        it('POST /start calls writeThreadToMongoDB', () => {
          const postStartRoute = threadsJs.split("router.post(\n  '/start'")[1].split('router.')[0];
          expect(postStartRoute).toContain('await writeThreadToMongoDB(thread, db)');
        });

        it('POST /start calls writeMessageToMongoDB for initial message', () => {
          const postStartRoute = threadsJs.split("router.post(\n  '/start'")[1].split('router.')[0];
          expect(postStartRoute).toContain('await writeMessageToMongoDB(entry, db)');
        });

        it('POST /:id/messages calls writeMessageToMongoDB', () => {
          const postMessagesRoute = threadsJs
            .split("router.post(\n  '/:id/messages'")[1]
            .split('router.')[0];
          expect(postMessagesRoute).toContain('await writeMessageToMongoDB(entry, db)');
        });
      }
    );

    describe('conversation-handler.js client-side normalization', () => {
      const conversationHandlerJs = fs.readFileSync(
        path.join(process.cwd(), 'public/assets/js/conversation-handler.js'),
        'utf8'
      );

      it('normalizes participants array in loadThread', () => {
        const loadThreadFn = conversationHandlerJs
          .split('async function loadThread()')[1]
          .split('async function')[0];
        expect(loadThreadFn).toContain('Normalize participants array for v1 threads');
        expect(loadThreadFn).toContain(
          'if (!thread.participants || !Array.isArray(thread.participants))'
        );
        expect(loadThreadFn).toContain('thread.participants = participants.filter(Boolean)');
      });

      it('synthesizes participants from customerId and recipientId', () => {
        const loadThreadFn = conversationHandlerJs
          .split('async function loadThread()')[1]
          .split('async function')[0];
        expect(loadThreadFn).toContain('if (thread.customerId)');
        expect(loadThreadFn).toContain('participants.push(thread.customerId)');
        expect(loadThreadFn).toContain('if (thread.recipientId');
        expect(loadThreadFn).toContain('participants.push(thread.recipientId)');
      });

      it('resolveOtherPartyName checks recipientId instead of supplierId', () => {
        const resolveOtherPartyNameFn = conversationHandlerJs
          .split('function resolveOtherPartyName()')[1]
          .split('function ')[0];
        // Should check recipientId, not supplierId (supplierId is supplier DB ID, not user ID)
        expect(resolveOtherPartyNameFn).toContain('thread.recipientId === currentUserId');
        expect(resolveOtherPartyNameFn).not.toContain('thread.supplierId === currentUserId');
      });
    });
  }
);
