'use strict';

const dbUnified = require('../db-unified');

const ACTIVE_TICKET_STATUSES = new Set(['open', 'in_progress']);
const NEW_CONTACT_STATUSES = new Set(['new']);

function timestamp(item) {
  const raw = item.updatedAt || item.lastReplyAt || item.createdAt || 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

function newestFirst(a, b) {
  return timestamp(b) - timestamp(a);
}

async function readCollection(name) {
  try {
    const rows = await dbUnified.read(name);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function notification(id, title, message, url, createdAt, meta) {
  return {
    id,
    type: 'ticket',
    title,
    message,
    actionUrl: url,
    actionText: 'View queue',
    icon: meta.icon,
    priority: meta.priority || 'normal',
    category: 'admin_queue',
    metadata: { synthetic: true, ...meta },
    isRead: false,
    isDismissed: false,
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: createdAt || new Date().toISOString(),
  };
}

async function getAdminQueueNotifications() {
  const [tickets, contacts] = await Promise.all([
    readCollection('tickets'),
    readCollection('contact_enquiries'),
  ]);

  const activeTickets = tickets
    .filter(ticket => ACTIVE_TICKET_STATUSES.has(ticket.status || 'open'))
    .sort(newestFirst);
  const newContacts = contacts
    .filter(enquiry => NEW_CONTACT_STATUSES.has(enquiry.status || 'new'))
    .sort(newestFirst);

  const items = [];

  if (activeTickets.length) {
    const latest = activeTickets[0];
    const openCount = activeTickets.filter(ticket => (ticket.status || 'open') === 'open').length;
    const inProgressCount = activeTickets.filter(ticket => ticket.status === 'in_progress').length;
    const urgentCount = activeTickets.filter(ticket => ticket.priority === 'urgent').length;
    items.push(
      notification(
        'admin-queue-support-tickets',
        `${activeTickets.length} active support ticket${activeTickets.length === 1 ? '' : 's'}`,
        `${openCount} open, ${inProgressCount} in progress. Latest: ${latest.subject || 'No subject'}`,
        '/admin-tickets',
        latest.updatedAt || latest.lastReplyAt || latest.createdAt,
        { icon: '🎫', queueType: 'support_tickets', count: activeTickets.length, urgent: urgentCount, priority: urgentCount ? 'high' : 'normal' }
      )
    );
  }

  if (newContacts.length) {
    const latest = newContacts[0];
    items.push(
      notification(
        'admin-queue-contact-enquiries',
        `${newContacts.length} new external enquir${newContacts.length === 1 ? 'y' : 'ies'}`,
        `Latest from ${latest.senderName || latest.senderEmail || 'unknown'}: ${latest.subject || 'No subject'}`,
        '/admin-tickets#contacts',
        latest.updatedAt || latest.createdAt,
        { icon: '📬', queueType: 'contact_enquiries', count: newContacts.length }
      )
    );
  }

  return items.sort((a, b) => timestamp(b) - timestamp(a));
}

module.exports = { getAdminQueueNotifications };
