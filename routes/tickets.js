/**
 * Tickets Routes
 * Handles support ticket functionality
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const { featureRequired } = require('../middleware/features');
const { auditLog } = require('../middleware/audit');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const {
  normalizeTicketRecord,
  canUserAccessTicket,
  normalizePriority: normalizeTicketPriority,
} = require('../utils/ticketNormalization');
const { deriveTicketPriority } = require('../utils/tierPriority');

const router = express.Router();

const ALLOWED_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const TICKET_ROLES = ['customer', 'supplier'];
const TICKET_SORTS = ['newest', 'oldest', 'updated'];
const MAX_SUBJECT_LENGTH = 180;
const MAX_MESSAGE_LENGTH = 5000;

function normalizeLimit(rawLimit, defaultValue = 50, maxValue = 200) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

function canTransitionStatus(currentStatus, nextStatus, role) {
  if (role === 'admin') {
    return true;
  }

  // Non-admin users can only reopen their own resolved/closed tickets.
  if (nextStatus === 'in_progress' && ['resolved', 'closed'].includes(currentStatus)) {
    return true;
  }

  return false;
}

function summarizeTickets(tickets) {
  return tickets.reduce(
    (acc, ticket) => {
      const status = ALLOWED_STATUSES.includes(ticket.status) ? ticket.status : 'open';
      acc.byStatus[status] += 1;
      acc.total += 1;
      return acc;
    },
    {
      total: 0,
      byStatus: {
        open: 0,
        in_progress: 0,
        resolved: 0,
        closed: 0,
      },
    }
  );
}

/**
 * POST /api/tickets
 * Create a new support ticket
 */
router.post(
  '/',
  featureRequired('supportTickets'),
  authRequired,
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { senderType, senderName, senderEmail, subject, message } = req.body;

      // Validation
      if (!subject || !message) {
        return res.status(400).json({ error: 'Subject and message are required' });
      }

      if (typeof subject !== 'string' || subject.trim().length < 3) {
        return res.status(400).json({ error: 'Subject must be at least 3 characters' });
      }

      if (subject.trim().length > MAX_SUBJECT_LENGTH) {
        return res
          .status(400)
          .json({ error: `Subject is too long (max ${MAX_SUBJECT_LENGTH} characters)` });
      }

      if (typeof message !== 'string' || message.trim().length < 10) {
        return res.status(400).json({ error: 'Message must be at least 10 characters' });
      }

      if (message.trim().length > MAX_MESSAGE_LENGTH) {
        return res
          .status(400)
          .json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      }

      if (!senderType || !TICKET_ROLES.includes(senderType)) {
        return res.status(400).json({ error: 'Invalid sender type' });
      }

      if (req.user.role !== senderType) {
        return res.status(403).json({ error: 'Sender type does not match your account role' });
      }

      // Create ticket
      const now = new Date().toISOString();
      const tickets = (await dbUnified.read('tickets')).map(ticket =>
        normalizeTicketRecord(ticket, { generateId: uid })
      );

      // Auto-derive priority from the sender's subscription tier.
      // User-supplied priority values are intentionally ignored.
      const { priority, accountTier, prioritySource } = await deriveTicketPriority(
        senderType,
        userId,
        dbUnified
      );

      const newTicket = {
        id: uid(),
        senderId: userId,
        senderType: senderType,
        senderName:
          senderName || req.user.name || req.user.firstName || req.user.displayName || 'User',
        senderEmail: senderEmail || req.user.email,
        subject: subject.trim(),
        message: message.trim(),
        status: 'open',
        priority,
        accountTier,
        prioritySource,
        assignedTo: null,
        lastReplyAt: now,
        lastReplyBy: senderType,
        responses: [],
        createdAt: now,
        updatedAt: now,
      };

      tickets.push(newTicket);
      await dbUnified.insertOne('tickets', newTicket);

      // Audit log
      auditLog({
        adminId: userId,
        adminEmail: req.user.email,
        action: 'TICKET_CREATED',
        targetType: 'ticket',
        targetId: newTicket.id,
        details: { subject, priority, accountTier, prioritySource },
      });

      res.status(201).json({ ticketId: newTicket.id, ticket: newTicket });
    } catch (error) {
      logger.error('Error creating ticket:', error);
      res.status(500).json({ error: 'Failed to create ticket', details: error.message });
    }
  }
);

/**
 * GET /api/tickets
 * Get all tickets for the current user
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, limit, q, sort = 'newest' } = req.query;

    let tickets = (await dbUnified.read('tickets')).map(ticket =>
      normalizeTicketRecord(ticket, { generateId: uid })
    );

    // Filter based on user role
    if (userRole === 'customer') {
      tickets = tickets.filter(t => t.senderId === userId && t.senderType === 'customer');
    } else if (userRole === 'supplier') {
      tickets = tickets.filter(t => t.senderId === userId && t.senderType === 'supplier');
    } else if (userRole === 'admin') {
      // Admins can see all tickets
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Filter by status if provided
    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      tickets = tickets.filter(t => t.status === status);
    }

    // Optional free-text search (subject/message/sender)
    const queryText = typeof q === 'string' ? q.trim().toLowerCase() : '';
    if (queryText) {
      tickets = tickets.filter(ticket => {
        const searchable = [ticket.subject, ticket.message, ticket.senderName, ticket.senderEmail]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(queryText);
      });
    }

    if (!TICKET_SORTS.includes(sort)) {
      return res.status(400).json({ error: 'Invalid sort option' });
    }

    // Sort list
    tickets.sort((a, b) => {
      const aCreated = new Date(a.createdAt).getTime();
      const bCreated = new Date(b.createdAt).getTime();
      const aUpdated = new Date(a.updatedAt || a.createdAt).getTime();
      const bUpdated = new Date(b.updatedAt || b.createdAt).getTime();

      if (sort === 'oldest') {
        return aCreated - bCreated;
      }
      if (sort === 'updated') {
        return bUpdated - aUpdated;
      }
      return bCreated - aCreated;
    });

    const summary = summarizeTickets(tickets);

    // Apply limit
    const limitNum = normalizeLimit(limit, 50, 200);
    tickets = tickets.slice(0, limitNum);

    res.json({
      tickets,
      meta: {
        limit: limitNum,
        sort,
        query: queryText,
        returned: tickets.length,
      },
      summary,
    });
  } catch (error) {
    logger.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets', details: error.message });
  }
});

/**
 * GET /api/tickets/:id
 * Get a specific ticket by ID
 */
router.get('/:id', authRequired, async (req, res) => {
  try {
    const { id } = req.params;

    const tickets = (await dbUnified.read('tickets')).map(ticket =>
      normalizeTicketRecord(ticket, { generateId: uid })
    );
    const ticket = tickets.find(t => t.id === id);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Check access permissions
    if (!canUserAccessTicket(req.user, ticket)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ ticket });
  } catch (error) {
    logger.error('Error fetching ticket:', error);
    res.status(500).json({ error: 'Failed to fetch ticket', details: error.message });
  }
});

/**
 * PUT /api/tickets/:id
 * Update a ticket (status, add responses)
 */
router.put('/:id', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { status, response, priority, assignedTo, resolutionNote } = req.body;

    const tickets = (await dbUnified.read('tickets')).map(ticket =>
      normalizeTicketRecord(ticket, { generateId: uid })
    );
    const ticketIndex = tickets.findIndex(t => t.id === id);

    if (ticketIndex === -1) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = tickets[ticketIndex];

    // Check access permissions
    if (!canUserAccessTicket(req.user, ticket)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const now = new Date().toISOString();

    // Update status
    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      if (!canTransitionStatus(ticket.status, status, userRole)) {
        return res.status(403).json({ error: 'You cannot update ticket status to that value' });
      }

      ticket.status = status;

      if (status === 'resolved' || status === 'closed') {
        ticket.resolutionNote =
          typeof resolutionNote === 'string' && resolutionNote.trim()
            ? resolutionNote.trim().slice(0, MAX_MESSAGE_LENGTH)
            : ticket.resolutionNote || null;
      }
    }

    // Priority can only be changed by admins.
    if (priority !== undefined) {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Only admins can update ticket priority' });
      }

      ticket.priority = normalizeTicketPriority(priority);
      ticket.prioritySource = 'admin';
    }

    // Ticket assignment is admin-only.
    if (assignedTo !== undefined) {
      if (userRole !== 'admin') {
        return res.status(403).json({ error: 'Only admins can assign tickets' });
      }

      ticket.assignedTo = typeof assignedTo === 'string' && assignedTo.trim() ? assignedTo : null;
    }

    // Add response if provided
    if (response && response.trim()) {
      if (!ticket.responses) {
        ticket.responses = [];
      }
      ticket.responses.push({
        id: uid(),
        userId: userId,
        userName: req.user.name || req.user.firstName || req.user.displayName || 'User',
        userRole: userRole,
        message: response.trim(),
        createdAt: now,
      });

      // Customer/supplier response re-opens closed loops for triage.
      if (userRole !== 'admin' && ['resolved', 'closed'].includes(ticket.status)) {
        ticket.status = 'in_progress';
        ticket.resolutionNote = null;
      }

      ticket.lastReplyAt = now;
      ticket.lastReplyBy = userRole;
    }

    ticket.updatedAt = now;
    tickets[ticketIndex] = ticket;
    await dbUnified.updateOne('tickets', { id: ticket.id }, { $set: ticket });

    // Audit log
    auditLog({
      adminId: userId,
      adminEmail: req.user.email,
      action: 'TICKET_UPDATED',
      targetType: 'ticket',
      targetId: ticket.id,
      details: { status, hasResponse: !!response, priority, assignedTo },
    });

    res.json({ ticket });
  } catch (error) {
    logger.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Failed to update ticket', details: error.message });
  }
});

/**
 * DELETE /api/tickets/:id
 * Delete a ticket (admins only)
 */
router.delete('/:id', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userRole = req.user.role;
    const { id } = req.params;

    // Only admins can delete tickets
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete tickets' });
    }

    const tickets = (await dbUnified.read('tickets')).map(ticket =>
      normalizeTicketRecord(ticket, { generateId: uid })
    );
    const ticketIndex = tickets.findIndex(t => t.id === id);

    if (ticketIndex === -1) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = tickets[ticketIndex];
    await dbUnified.deleteOne('tickets', ticket.id);

    // Audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'TICKET_DELETED',
      targetType: 'ticket',
      targetId: ticket.id,
      details: { subject: ticket.subject },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting ticket:', error);
    res.status(500).json({ error: 'Failed to delete ticket', details: error.message });
  }
});

/**
 * POST /api/tickets/:id/reply
 * Add a reply to a support ticket
 * Body: { message }
 */
router.post('/:id/reply', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { id } = req.params;
    const { message } = req.body;

    // Validation
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Reply message is required' });
    }

    const trimmedMessage = message.trim();

    if (trimmedMessage.length > 5000) {
      return res.status(400).json({ error: 'Reply message is too long (max 5000 characters)' });
    }

    const tickets = (await dbUnified.read('tickets')).map(ticket =>
      normalizeTicketRecord(ticket, { generateId: uid })
    );
    const ticketIndex = tickets.findIndex(t => t.id === id);

    if (ticketIndex === -1) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = tickets[ticketIndex];

    // Check access: admins can reply to any ticket, users can only reply to their own
    if (!canUserAccessTicket(req.user, ticket)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const now = new Date().toISOString();

    // Create reply object
    const reply = {
      id: uid('reply'),
      userId: req.user.id,
      userName: req.user.name || req.user.firstName || req.user.displayName || 'User',
      userRole,
      message: trimmedMessage,
      createdAt: now,
    };

    // Add reply to responses array
    if (!ticket.responses) {
      ticket.responses = [];
    }
    ticket.responses.push(reply);

    // Update ticket metadata
    ticket.updatedAt = now;
    if (ticket.status === 'open' && userRole === 'admin') {
      ticket.status = 'in_progress';
    } else if (userRole !== 'admin' && ['resolved', 'closed'].includes(ticket.status)) {
      ticket.status = 'in_progress';
      ticket.resolutionNote = null;
    }
    ticket.lastReplyAt = now;
    ticket.lastReplyBy = userRole;

    tickets[ticketIndex] = ticket;
    await dbUnified.updateOne('tickets', { id: ticket.id }, { $set: ticket });

    // Send email notification to ticket creator (if reply is from admin)
    if (userRole === 'admin' && ticket.senderEmail) {
      try {
        const postmark = require('../utils/postmark');
        await postmark.sendEmail({
          to: ticket.senderEmail,
          subject: `Reply to your support ticket: ${ticket.subject}`,
          text: `You have received a reply to your support ticket.\n\nTicket: ${ticket.subject}\n\nReply: ${message}\n\nView your ticket at: ${process.env.BASE_URL || 'https://event-flow.co.uk'}/tickets/${ticket.id}`,
          html: `
            <h2>Reply to Your Support Ticket</h2>
            <p><strong>Ticket:</strong> ${ticket.subject}</p>
            <p><strong>Reply:</strong></p>
            <p>${message.replace(/\n/g, '<br>')}</p>
            <p><a href="${process.env.BASE_URL || 'https://event-flow.co.uk'}/tickets/${ticket.id}">View Ticket</a></p>
          `,
        });
      } catch (emailError) {
        logger.error('Failed to send reply notification email:', emailError);
      }
    }

    // Audit log
    auditLog({
      adminId: userId,
      adminEmail: req.user.email,
      action: 'TICKET_REPLIED',
      targetType: 'ticket',
      targetId: ticket.id,
      details: { subject: ticket.subject, replyBy: userRole },
    });

    res.json({
      success: true,
      reply,
      ticket,
    });
  } catch (error) {
    logger.error('Error adding ticket reply:', error);
    res.status(500).json({ error: 'Failed to add reply', details: error.message });
  }
});

module.exports = router;
