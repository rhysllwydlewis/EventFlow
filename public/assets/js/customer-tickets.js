/**
 * Customer Ticketing Interface
 * Handles ticket creation and viewing for customers
 */

import ticketingSystem from './ticketing.js?v=18.3.0';
import { getListItemSkeletons, showEmptyState, showErrorState } from './utils/skeleton-loader.js';
import {
  getCurrentUser,
  escapeHtml,
  showToast,
  createModalCloseHandler,
  setupModalCloseHandlers,
} from './utils/common-helpers.js';

let ticketsUnsubscribe = null;

// Render tickets
function renderTickets(tickets) {
  const container = document.getElementById('tickets-cust');
  if (!container) {
    return;
  }

  if (!tickets || tickets.length === 0) {
    showEmptyState(container, {
      icon: '🎫',
      title: 'No support tickets yet',
      description: 'Create one if you need help!',
    });
    return;
  }

  let html = '<div class="ticket-list">';

  tickets.forEach(ticket => {
    // Defensive checks for ticket data
    if (!ticket || typeof ticket !== 'object') {
      console.warn('Skipping invalid ticket:', ticket);
      return;
    }

    if (!ticket.id) {
      console.warn('Skipping ticket without ID:', ticket);
      return;
    }

    const status = ticket?.status || 'open';
    const message = typeof ticket?.message === 'string' ? ticket.message : '';
    const statusClass = ticketingSystem.getStatusClass(status);
    const createdAt = ticketingSystem.formatTimestamp(ticket?.createdAt);
    const responseCount = Array.isArray(ticket?.responses) ? ticket.responses.length : 0;

    html += `
      <div class="customer-ticket-item ticket-item" role="button" tabindex="0" data-ticket-id="${ticket.id}" aria-label="Ticket: ${escapeHtml(ticket.subject || 'No Subject')}">
        <div class="customer-ticket-item__header">
          <strong>${escapeHtml(ticket.subject || 'No Subject')}</strong>
          <div class="customer-ticket-item__badges">
            <span class="badge ${statusClass}">${status.replace('_', ' ')}</span>
          </div>
        </div>
        <p class="small customer-ticket-item__preview">${escapeHtml(message.substring(0, 100))}${message.length > 100 ? '...' : ''}</p>
        <div class="small customer-ticket-item__meta">
          Created ${createdAt} • ${responseCount} response${responseCount !== 1 ? 's' : ''}
        </div>
      </div>
    `;
  });

  html += '</div>';

  // Show "View all support tickets" link when the list is capped at the display limit (5)
  if (tickets.length >= 5) {
    html += '<a href="/support" class="customer-tickets-view-all">View all support tickets →</a>';
  }

  container.innerHTML = html;

  // Add click and keyboard handlers
  container.querySelectorAll('.ticket-item').forEach(item => {
    const open = () => {
      const ticketId = item.getAttribute('data-ticket-id');
      viewTicket(ticketId);
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

// Create ticket modal
function showCreateTicketModal() {
  const titleId = 'ticket-create-modal-title';
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.innerHTML = `
    <div class="modal ticket-create-modal">
      <div class="modal-header">
        <h3 id="${titleId}">Create Support Ticket</h3>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <form id="createTicketForm">
          <div class="form-row">
            <label for="ticketSubject">Subject *</label>
            <input type="text" id="ticketSubject" required placeholder="Brief description of your issue">
          </div>
          <div class="form-row">
            <label for="ticketMessage">Message *</label>
            <textarea id="ticketMessage" rows="6" required placeholder="Describe your issue in detail"></textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Submit Ticket</button>
            <button type="button" class="btn btn-secondary modal-close-btn">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Store the element that opened the modal for focus restoration
  const previouslyFocusedElement = document.activeElement;
  const cleanupCallbacks = [];

  // Close handler with cleanup support
  const closeModal = createModalCloseHandler(modal, cleanupCallbacks, previouslyFocusedElement);

  // Setup all close handlers (button, overlay, Escape key)
  setupModalCloseHandlers(modal, closeModal, cleanupCallbacks);

  // Additional close button for cancel
  const cancelBtn = modal.querySelector('.modal-close-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModal);
  }

  // Form submit
  const form = modal.querySelector('#createTicketForm');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();

      const user = await getCurrentUser();
      if (!user) {
        showToast('Please sign in to create a ticket', 'error');
        return;
      }

      const ticketData = {
        senderId: user.id,
        senderType: 'customer',
        senderName: user.name || user.firstName || user.displayName || user.businessName || 'User',
        senderEmail: user.email,
        subject: modal.querySelector('#ticketSubject')?.value || '',
        message: modal.querySelector('#ticketMessage')?.value || '',
      };

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting...';
        }

        await ticketingSystem.createTicket(ticketData);

        showToast('Ticket created successfully', 'success');
        closeModal();
      } catch (error) {
        console.error('Error creating ticket:', error);
        showToast(`Failed to create ticket: ${error.message}`, 'error');

        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Ticket';
        }
      }
    });
  }

  // Set initial focus to subject input for better UX
  setTimeout(() => {
    const subjectInput = modal.querySelector('#ticketSubject');
    if (subjectInput) {
      subjectInput.focus();
    }
  }, 100);
}

// View ticket modal
function viewTicket(ticketId) {
  const titleId = 'ticket-view-modal-title';
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.innerHTML = `
    <div class="modal ticket-view-modal">
      <div class="modal-header">
        <h3 id="${titleId}">Support Ticket</h3>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div id="ticketDetails"><p class="small">Loading...</p></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Store the element that opened the modal for focus restoration
  const previouslyFocusedElement = document.activeElement;
  const cleanupCallbacks = [];

  // Load ticket details with real-time updates
  let ticketUnsubscribe = null;

  // Close handler with cleanup support
  const closeModal = createModalCloseHandler(modal, cleanupCallbacks, previouslyFocusedElement);

  // Register cleanup for ticket subscription
  cleanupCallbacks.push(() => {
    if (ticketUnsubscribe) {
      ticketUnsubscribe();
    }
  });

  // Setup all close handlers (button, overlay, Escape key)
  setupModalCloseHandlers(modal, closeModal, cleanupCallbacks);

  const renderTicketDetails = ticket => {
    if (!ticket) {
      document.getElementById('ticketDetails').innerHTML = '<p class="small">Ticket not found.</p>';
      return;
    }

    const status = ticket?.status || 'open';
    const message = typeof ticket?.message === 'string' ? ticket.message : '';
    const statusClass = ticketingSystem.getStatusClass(status);
    const createdAt = ticketingSystem.formatTimestamp(ticket?.createdAt);

    // User-friendly status description instead of exposing internal priority
    const statusDescriptions = {
      open: 'Your ticket has been received and is awaiting review.',
      in_progress: 'Our support team is actively working on your ticket.',
      resolved: 'This ticket has been resolved. Reply if you need further help.',
      closed: 'This ticket is closed.',
    };
    const statusDescription = statusDescriptions[status] || '';

    let html = `
      <div class="ticket-detail__header">
        <div class="ticket-detail__status-row">
          <span class="badge ${statusClass}">${status.replace('_', ' ')}</span>
        </div>
        <h4 class="ticket-detail__subject">${escapeHtml(ticket.subject)}</h4>
        <p class="ticket-detail__message">${escapeHtml(message)}</p>
        <p class="small ticket-detail__status-desc">${escapeHtml(statusDescription)}</p>
        <p class="small ticket-detail__timestamp">Created ${createdAt}</p>
      </div>
    `;

    if (ticket.responses && ticket.responses.length > 0) {
      html += '<h4>Conversation</h4>';
      html += '<div class="responses-list">';

      ticket.responses.forEach(response => {
        const respTimestamp = ticketingSystem.formatTimestamp(
          response.createdAt || response.timestamp
        );
        const role = response.userRole || response.responderType || 'customer';
        const isAdmin = role === 'admin';
        const displayName = response.userName || response.responderName || 'Support';

        html += `
          <div class="ticket-response ticket-response--${isAdmin ? 'admin' : 'user'}">
            <div class="ticket-response__header">
              <strong>${escapeHtml(displayName)} ${isAdmin ? '<span class="badge badge-in_progress">Admin</span>' : ''}</strong>
              <span class="small ticket-response__timestamp">${respTimestamp}</span>
            </div>
            <p class="ticket-response__body">${escapeHtml(response.message)}</p>
          </div>
        `;
      });

      html += '</div>';
    } else {
      html +=
        '<p class="small ticket-detail__no-responses">No responses yet. Our team will reply soon.</p>';
    }

    if (status !== 'closed') {
      html += `
        <form id="ticketReplyForm" class="ticket-reply-form">
          <label for="ticketReplyMessage" class="small ticket-reply-form__label">Add a reply</label>
          <textarea id="ticketReplyMessage" class="ticket-reply-form__textarea" rows="4" required placeholder="Add more details for support..."></textarea>
          <div class="ticket-reply-form__actions">
            <button type="submit" class="btn btn-primary">Send Reply</button>
          </div>
        </form>
      `;
    }

    document.getElementById('ticketDetails').innerHTML = html;

    const replyForm = document.getElementById('ticketReplyForm');
    if (replyForm) {
      replyForm.addEventListener('submit', async event => {
        event.preventDefault();
        const field = document.getElementById('ticketReplyMessage');
        const message = field.value.trim();
        if (!message) {
          return;
        }

        const button = replyForm.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Sending...';

        try {
          await ticketingSystem.addResponse(ticket.id, message);
          field.value = '';
          if (typeof Toast !== 'undefined') {
            Toast.success('Reply sent');
          }
        } catch (error) {
          console.error('Error sending reply:', error);
          if (typeof Toast !== 'undefined') {
            Toast.error(error.message || 'Failed to send reply');
          }
        } finally {
          button.disabled = false;
          button.textContent = 'Send Reply';
        }
      });
    }
  };

  // Listen to real-time updates
  ticketUnsubscribe = ticketingSystem.listenToTicket(ticketId, renderTicketDetails);
}

// Initialize
async function init() {
  const container = document.getElementById('tickets-cust');
  if (!container) {
    return;
  }

  // Show skeleton loader
  container.innerHTML = getListItemSkeletons(2);

  const user = await getCurrentUser();
  if (!user) {
    showEmptyState(container, {
      icon: '🔒',
      title: 'Sign in to view tickets',
      description: 'Log in to see your support tickets.',
      actionText: 'Sign In',
      actionHref: '/auth',
    });
    return;
  }

  // Create ticket button handler
  const createBtn = document.getElementById('createTicketBtn');
  if (createBtn) {
    createBtn.addEventListener('click', showCreateTicketModal);
  }

  // Listen to user's tickets with real-time updates (limit to 5 recent tickets on dashboard)
  try {
    if (ticketsUnsubscribe) {
      ticketsUnsubscribe();
    }
    ticketsUnsubscribe = ticketingSystem.listenToUserTickets(user.id, 'customer', renderTickets, 5);
  } catch (error) {
    console.error('Error loading tickets:', error);
    showErrorState(container, {
      title: 'Unable to load tickets',
      description: 'Please try refreshing the page.',
      actionText: 'Refresh',
      onAction: () => window.location.reload(),
    });
  }
}

// Run on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.addEventListener('beforeunload', () => {
  if (ticketsUnsubscribe) {
    ticketsUnsubscribe();
  }
  ticketingSystem.cleanup();
});
