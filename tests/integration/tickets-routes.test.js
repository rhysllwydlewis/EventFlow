const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = req.user || {
      id: 'user-1',
      role: 'customer',
      email: 'customer@example.com',
      name: 'Customer One',
    };
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/features', () => ({
  featureRequired: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn(),
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  write: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
}));

jest.mock('../../db', () => ({
  getDb: jest.fn().mockRejectedValue(new Error('MongoDB not available in test')),
}));

jest.mock('../../utils/postmark', () => ({
  sendEmail: jest.fn().mockResolvedValue({ MessageID: 'mock-id' }),
}));

const dbUnified = require('../../db-unified');
const ticketsRoutes = require('../../routes/tickets');

describe('Tickets Routes Integration', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        id: req.headers['x-test-user-id'] || 'user-1',
        role: req.headers['x-test-user-role'] || 'customer',
        email: 'user@example.com',
        name: 'Test User',
      };
      next();
    });
    app.use('/api/tickets', ticketsRoutes);

    dbUnified.read.mockReset();
    dbUnified.write.mockReset();
    dbUnified.insertOne.mockReset();
    dbUnified.updateOne.mockReset();
    dbUnified.deleteOne.mockReset();

    // Default mock implementations
    dbUnified.insertOne.mockResolvedValue(true);
    dbUnified.updateOne.mockResolvedValue(true);
    dbUnified.deleteOne.mockResolvedValue(true);
  });

  it('rejects ticket creation when senderType does not match account role', async () => {
    const response = await request(app)
      .post('/api/tickets')
      .set('x-test-user-role', 'customer')
      .send({
        senderType: 'supplier',
        subject: 'Need help with booking',
        message: 'I need help with booking and payment issue',
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/Sender type does not match/i);
  });

  it('creates ticket with normalized priority and trimmed content', async () => {
    dbUnified.read.mockResolvedValue([]);
    dbUnified.write.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/tickets')
      .set('x-test-user-role', 'customer')
      .send({
        senderType: 'customer',
        subject: '  Help with invoice  ',
        message: '  I cannot download my invoice for order #1001.  ',
        priority: 'invalid-priority',
      });

    expect(response.status).toBe(201);
    expect(response.body.ticket.priority).toBe('medium');
    expect(response.body.ticket.subject).toBe('Help with invoice');
    expect(response.body.ticket.message).toBe('I cannot download my invoice for order #1001.');
    expect(dbUnified.insertOne).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized subject/message payloads', async () => {
    dbUnified.read.mockResolvedValue([]);

    const longSubject = 'S'.repeat(220);
    const longMessage = 'M'.repeat(5200);

    const subjectResponse = await request(app)
      .post('/api/tickets')
      .set('x-test-user-role', 'customer')
      .send({
        senderType: 'customer',
        subject: longSubject,
        message: 'Valid message that passes minimum length',
      });

    expect(subjectResponse.status).toBe(400);
    expect(subjectResponse.body.error).toMatch(/Subject is too long/i);

    const messageResponse = await request(app)
      .post('/api/tickets')
      .set('x-test-user-role', 'customer')
      .send({
        senderType: 'customer',
        subject: 'Valid subject',
        message: longMessage,
      });

    expect(messageResponse.status).toBe(400);
    expect(messageResponse.body.error).toMatch(/Message is too long/i);
  });

  it('normalizes legacy ticket fields for owner access and response rendering', async () => {
    dbUnified.read.mockResolvedValue([
      {
        _id: 'legacy-ticket-1',
        userId: 'user-1',
        userType: 'supplier',
        userEmail: 'legacy@example.com',
        subject: 'Legacy ticket',
        description: 'Legacy description body',
        status: 'in-progress',
        replies: [{ id: 'r1', message: 'Legacy reply', createdAt: new Date().toISOString() }],
        createdAt: new Date().toISOString(),
      },
    ]);

    const response = await request(app)
      .get('/api/tickets')
      .set('x-test-user-id', 'user-1')
      .set('x-test-user-role', 'supplier');

    expect(response.status).toBe(200);
    expect(response.body.tickets).toHaveLength(1);
    expect(response.body.tickets[0].id).toBe('legacy-ticket-1');
    expect(response.body.tickets[0].status).toBe('in_progress');
    expect(response.body.tickets[0].message).toBe('Legacy description body');
    expect(response.body.tickets[0].responses).toHaveLength(1);
  });

  it('supports filtering metadata and summary in ticket listing', async () => {
    dbUnified.read.mockResolvedValue([
      {
        id: 'ticket-open',
        senderId: 'user-1',
        senderType: 'customer',
        subject: 'Payment failed',
        message: 'Card was charged but booking failed',
        status: 'open',
        createdAt: '2026-02-10T10:00:00.000Z',
        updatedAt: '2026-02-10T10:00:00.000Z',
      },
      {
        id: 'ticket-resolved',
        senderId: 'user-1',
        senderType: 'customer',
        subject: 'Resolved inquiry',
        message: 'Everything is fixed now',
        status: 'resolved',
        createdAt: '2026-02-11T10:00:00.000Z',
        updatedAt: '2026-02-12T10:00:00.000Z',
      },
    ]);

    const response = await request(app)
      .get('/api/tickets?q=payment&sort=updated&limit=10')
      .set('x-test-user-id', 'user-1')
      .set('x-test-user-role', 'customer');

    expect(response.status).toBe(200);
    expect(response.body.tickets).toHaveLength(1);
    expect(response.body.tickets[0].id).toBe('ticket-open');
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        sort: 'updated',
        query: 'payment',
        returned: 1,
        limit: 10,
      })
    );
    expect(response.body.summary).toEqual(
      expect.objectContaining({
        total: 1,
        byStatus: expect.objectContaining({ open: 1 }),
      })
    );
  });

  it('reopens resolved tickets when owner replies and lets admin update priority', async () => {
    const existing = [
      {
        id: 'ticket-reopen',
        senderId: 'user-1',
        senderType: 'customer',
        senderEmail: 'customer@example.com',
        subject: 'Issue',
        message: 'Original issue message',
        status: 'resolved',
        priority: 'medium',
        responses: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    dbUnified.read.mockResolvedValue(existing);
    dbUnified.write.mockResolvedValue(true);

    const replyResponse = await request(app)
      .post('/api/tickets/ticket-reopen/reply')
      .set('x-test-user-id', 'user-1')
      .set('x-test-user-role', 'customer')
      .send({ message: 'Issue came back after yesterday update' });

    expect(replyResponse.status).toBe(200);
    expect(replyResponse.body.ticket.status).toBe('in_progress');

    const adminUpdateResponse = await request(app)
      .put('/api/tickets/ticket-reopen')
      .set('x-test-user-id', 'admin-1')
      .set('x-test-user-role', 'admin')
      .send({
        priority: 'urgent',
        assignedTo: 'agent-42',
        status: 'resolved',
        resolutionNote: 'Provided workaround and confirmed by user.',
      });

    expect(adminUpdateResponse.status).toBe(200);
    expect(adminUpdateResponse.body.ticket.priority).toBe('urgent');
    expect(adminUpdateResponse.body.ticket.assignedTo).toBe('agent-42');
    expect(adminUpdateResponse.body.ticket.resolutionNote).toMatch(/workaround/i);
  });
  it('allows owner to reply and keeps status consistent', async () => {
    const existing = [
      {
        id: 'ticket-1',
        senderId: 'user-1',
        senderType: 'customer',
        senderEmail: 'customer@example.com',
        subject: 'Issue',
        message: 'Original issue message',
        status: 'open',
        priority: 'medium',
        responses: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    dbUnified.read.mockResolvedValue(existing);
    dbUnified.write.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/tickets/ticket-1/reply')
      .set('x-test-user-id', 'user-1')
      .set('x-test-user-role', 'customer')
      .send({ message: 'Adding more context for support team' });

    expect(response.status).toBe(200);
    expect(response.body.ticket.responses).toHaveLength(1);
    expect(response.body.ticket.responses[0].message).toBe('Adding more context for support team');
    expect(response.body.ticket.status).toBe('open');
  });

  describe('Tier-based auto-priority', () => {
    it('ignores user-supplied priority for customer tickets and defaults to medium', async () => {
      // customers collection returns empty; tickets read returns empty
      dbUnified.read.mockResolvedValue([]);
      dbUnified.insertOne.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/tickets')
        .set('x-test-user-role', 'customer')
        .send({
          senderType: 'customer',
          subject: 'Invoice question',
          message: 'I cannot access my invoice for the last booking.',
          priority: 'urgent', // should be ignored
        });

      expect(response.status).toBe(201);
      // Customer always gets medium (free-tier default); user-supplied 'urgent' is ignored
      expect(response.body.ticket.priority).toBe('medium');
      expect(response.body.ticket.accountTier).toBe('free');
      expect(response.body.ticket.prioritySource).toBe('auto');
    });

    it('assigns urgent priority to a pro_plus supplier without reading user-supplied priority', async () => {
      // First read → tickets collection (empty), second read → suppliers with pro_plus tier
      dbUnified.read
        .mockResolvedValueOnce([]) // tickets read in POST handler
        .mockResolvedValueOnce([
          {
            userId: 'sup-user-1',
            subscription: { tier: 'pro_plus', status: 'active' },
          },
        ]); // suppliers read in deriveTicketPriority

      dbUnified.insertOne.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/tickets')
        .set('x-test-user-id', 'sup-user-1')
        .set('x-test-user-role', 'supplier')
        .send({
          senderType: 'supplier',
          subject: 'Booking issue',
          message: 'My booking dashboard is not loading any events.',
          priority: 'low', // should be ignored in favour of tier-derived value
        });

      expect(response.status).toBe(201);
      expect(response.body.ticket.priority).toBe('urgent');
      expect(response.body.ticket.accountTier).toBe('pro_plus');
      expect(response.body.ticket.prioritySource).toBe('auto');
    });

    it('assigns high priority to a pro supplier', async () => {
      dbUnified.read
        .mockResolvedValueOnce([]) // tickets
        .mockResolvedValueOnce([
          {
            userId: 'sup-user-2',
            subscription: { tier: 'pro', status: 'active' },
          },
        ]); // suppliers

      dbUnified.insertOne.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/tickets')
        .set('x-test-user-id', 'sup-user-2')
        .set('x-test-user-role', 'supplier')
        .send({
          senderType: 'supplier',
          subject: 'Profile photo not showing',
          message: 'My profile photo has disappeared from the marketplace listing.',
        });

      expect(response.status).toBe(201);
      expect(response.body.ticket.priority).toBe('high');
      expect(response.body.ticket.accountTier).toBe('pro');
      expect(response.body.ticket.prioritySource).toBe('auto');
    });

    it('assigns medium priority to a free supplier', async () => {
      dbUnified.read
        .mockResolvedValueOnce([]) // tickets
        .mockResolvedValueOnce([
          {
            userId: 'sup-user-3',
            subscription: { tier: 'free', status: 'active' },
          },
        ]); // suppliers

      dbUnified.insertOne.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/tickets')
        .set('x-test-user-id', 'sup-user-3')
        .set('x-test-user-role', 'supplier')
        .send({
          senderType: 'supplier',
          subject: 'Cannot log in',
          message: 'I keep getting an error when I try to log into my supplier account.',
        });

      expect(response.status).toBe(201);
      expect(response.body.ticket.priority).toBe('medium');
      expect(response.body.ticket.accountTier).toBe('free');
      expect(response.body.ticket.prioritySource).toBe('auto');
    });

    it('falls back to medium priority when supplier record cannot be found', async () => {
      dbUnified.read
        .mockResolvedValueOnce([]) // tickets
        .mockResolvedValueOnce([]); // suppliers — no matching record

      dbUnified.insertOne.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/tickets')
        .set('x-test-user-id', 'unknown-supplier')
        .set('x-test-user-role', 'supplier')
        .send({
          senderType: 'supplier',
          subject: 'Billing question',
          message: 'I was charged but cannot see the subscription in my account.',
        });

      expect(response.status).toBe(201);
      expect(response.body.ticket.priority).toBe('medium');
      expect(response.body.ticket.accountTier).toBe('free');
      expect(response.body.ticket.prioritySource).toBe('auto');
    });
  });

  describe('Backward compatibility — normalization of legacy tickets', () => {
    it('sets accountTier to null and prioritySource to "auto" for legacy tickets without those fields', async () => {
      dbUnified.read.mockResolvedValue([
        {
          id: 'legacy-ticket-2',
          senderId: 'user-1',
          senderType: 'customer',
          subject: 'Old ticket',
          message: 'An old ticket without triage metadata',
          status: 'open',
          priority: 'medium',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // No accountTier or prioritySource fields
        },
      ]);

      const response = await request(app)
        .get('/api/tickets')
        .set('x-test-user-id', 'user-1')
        .set('x-test-user-role', 'customer');

      expect(response.status).toBe(200);
      const ticket = response.body.tickets[0];
      expect(ticket.accountTier).toBeNull();
      expect(ticket.prioritySource).toBe('auto');
      expect(typeof ticket.priorityRank).toBe('number');
    });
  });

  describe('Admin priority override records prioritySource as "admin"', () => {
    it('marks prioritySource as "admin" when an admin changes ticket priority', async () => {
      const existing = [
        {
          id: 'ticket-admin-pri',
          senderId: 'user-1',
          senderType: 'customer',
          senderEmail: 'user@example.com',
          subject: 'Need help',
          message: 'Detailed message here',
          status: 'open',
          priority: 'medium',
          accountTier: 'free',
          prioritySource: 'auto',
          responses: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      dbUnified.read.mockResolvedValue(existing);

      const response = await request(app)
        .put('/api/tickets/ticket-admin-pri')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-user-role', 'admin')
        .send({ priority: 'urgent' });

      expect(response.status).toBe(200);
      expect(response.body.ticket.priority).toBe('urgent');
      expect(response.body.ticket.prioritySource).toBe('admin');
    });
  });
});
