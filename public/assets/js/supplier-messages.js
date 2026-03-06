/**
 * Supplier Messages
 * Handles supplier conversation list rendering, lead quality badges,
 * filter/sort controls, and messaging system integration.
 */

import messagingSystem from './messaging.js';
import { logMessageState } from './utils/dashboard-logger.js';

// ─── Utility helpers ──────────────────────────────────────────────────────────

function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = unsafe;
  return div.innerHTML;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) {
    return '';
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.substring(0, maxLength)}...`;
}

/**
 * Extract text from a message object that may use different field names.
 */
function extractMessageText(message) {
  if (typeof message === 'string') {
    return message;
  }
  if (!message) {
    return '[No message content]';
  }
  return (
    message.message ||
    message.content ||
    message.text ||
    message.body ||
    message.value ||
    '[No message content]'
  );
}

// ─── Lead quality helpers ─────────────────────────────────────────────────────

const QUALITY_MAP = {
  High: { label: 'High', color: '#10b981', emoji: '⭐' },
  Medium: { label: 'Medium', color: '#f59e0b', emoji: '●' },
  Low: { label: 'Low', color: '#ef4444', emoji: '◯' },
  Hot: { label: 'Hot', color: '#ef4444', emoji: '🔥' },
  Good: { label: 'Good', color: '#10b981', emoji: '✓' },
};

function getLeadQualityMeta(conv) {
  if (conv.leadScore && QUALITY_MAP[conv.leadScore]) {
    return QUALITY_MAP[conv.leadScore];
  }
  if (typeof conv.leadScoreRaw === 'number') {
    if (conv.leadScoreRaw >= 80) {
      return QUALITY_MAP.Hot;
    }
    if (conv.leadScoreRaw >= 60) {
      return QUALITY_MAP.High;
    }
    if (conv.leadScoreRaw >= 40) {
      return QUALITY_MAP.Good;
    }
    return QUALITY_MAP.Low;
  }
  return null;
}

function renderLeadQualityBadge(conv) {
  const meta = getLeadQualityMeta(conv);
  if (!meta) {
    return '';
  }
  const label = escapeHtml(meta.label);
  const emoji = escapeHtml(meta.emoji);
  const color = escapeHtml(meta.color);
  const scoreHtml =
    typeof conv.leadScoreRaw === 'number'
      ? ` <span style="opacity:0.8;font-size:0.7rem;">(${conv.leadScoreRaw})</span>`
      : '';
  return `<span class="lead-badge" role="status" aria-label="Lead quality: ${label}" style="background:${color};color:white;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:0.25rem;">${emoji} ${label}${scoreHtml}</span>`;
}

/**
 * Compute summary stats from an array of conversations.
 */
function getLeadQualitySummary(conversations) {
  if (!conversations || conversations.length === 0) {
    return { total: 0, high: 0, medium: 0, low: 0, highPercent: 0 };
  }
  let high = 0;
  let medium = 0;
  let low = 0;
  conversations.forEach(conv => {
    const meta = getLeadQualityMeta(conv);
    if (!meta) {
      return;
    }
    if (meta.label === 'High' || meta.label === 'Hot') {
      high++;
    } else if (meta.label === 'Medium' || meta.label === 'Good') {
      medium++;
    } else {
      low++;
    }
  });
  const total = conversations.length;
  const highPercent = total > 0 ? Math.round((high / total) * 100) : 0;
  return { total, high, medium, low, highPercent };
}

// ─── Render conversations ─────────────────────────────────────────────────────

/**
 * Render conversation list HTML for the supplier dashboard.
 * @param {Array}  conversations    - Array of conversation objects
 * @param {object} supplierProfile  - Supplier profile
 * @param {object} [user]           - Current user
 * @returns {string} HTML string
 */
function renderConversations(conversations, supplierProfile, user) { // eslint-disable-line no-unused-vars
  if (!conversations || conversations.length === 0) {
    return '<p class="small" style="color:#6b7280;padding:1rem;">No conversations yet.</p>';
  }

  return conversations
    .map(conversation => {
      // Validate conversation object
      if (!conversation || typeof conversation !== 'object') {
        console.warn('Skipping invalid conversation');
        return '';
      }
      if (!conversation.id && !conversation._id) {
        console.warn('Skipping conversation without ID');
        return '';
      }

      const name = escapeHtml(
        conversation.customerName ||
          conversation.senderName ||
          conversation.otherPartyName ||
          'Customer'
      );
      const preview = escapeHtml(
        truncate(conversation.lastMessage || conversation.preview || '', 80)
      );
      // Use formatTimeAgo(conversation.lastMessageTime) for relative timestamps
      const time = escapeHtml(formatTimeAgo(conversation.lastMessageTime));
      const attachmentCount = conversation.attachmentCount || 0;
      const attachmentHtml =
        attachmentCount > 0
          ? `<span class="small" style="color:#6b7280;display:inline-flex;align-items:center;gap:0.25rem;">
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                 <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
               </svg>
               ${attachmentCount} ${attachmentCount === 1 ? 'file' : 'files'}
             </span>`
          : '';

      const badgeHtml = renderLeadQualityBadge(conversation);
      const unread = conversation.unreadCount || 0;
      const convId = escapeHtml(conversation._id || conversation.id || '');

      return `
        <div class="supplier-conv-item${unread > 0 ? ' supplier-conv-item--unread' : ''}"
             data-conversation-id="${convId}"
             style="padding:0.75rem 1rem;border-bottom:1px solid #f3f4f6;display:flex;align-items:flex-start;gap:0.75rem;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <span style="font-weight:${unread > 0 ? '700' : '500'};color:#0b1220;">${name}</span>
              ${badgeHtml}
              ${unread > 0 ? `<span class="lead-badge" style="background:#3b82f6;color:white;padding:0.15rem 0.4rem;border-radius:4px;font-size:0.7rem;">${unread} new</span>` : ''}
            </div>
            <div style="color:#6b7280;font-size:0.875rem;overflow:hidden;text-overflow:ellipsis;">${preview}</div>
            ${attachmentHtml ? `<div style="margin-top:0.25rem;">${attachmentHtml}</div>` : ''}
          </div>
          <div style="font-size:0.75rem;color:#9ca3af;white-space:nowrap;">${time}</div>
        </div>`;
    })
    .join('');
}

// ─── Filter + sort ────────────────────────────────────────────────────────────

/**
 * Apply filter, sort, and search to supplier conversations.
 */
function applyFiltersSupplier(conversations, supplierProfile, user) { // eslint-disable-line no-unused-vars
  if (!conversations || !Array.isArray(conversations)) {
    return [];
  }

  const searchEl = document.getElementById('widget-search-input-supplier');
  const filterEl = document.getElementById('widget-filter-select-supplier');
  const sortEl = document.getElementById('widget-sort-select-supplier');

  const searchQuery = searchEl ? searchEl.value.toLowerCase().trim() : '';
  const filterValue = filterEl ? filterEl.value : 'all';
  const sortValue = sortEl ? sortEl.value : 'newest';

  // 1. Search filter
  let result = conversations.filter(conv => {
    if (!searchQuery) {
      return true;
    }
    const name = (conv.customerName || conv.senderName || '').toLowerCase();
    const msg = (conv.lastMessage || conv.preview || '').toLowerCase();
    return name.includes(searchQuery) || msg.includes(searchQuery);
  });

  // 2. Status / quality filter
  if (filterValue === 'unread') {
    result = result.filter(conv => (conv.unreadCount || 0) > 0);
  } else if (filterValue === 'starred') {
    result = result.filter(conv => conv.isStarred === true);
  } else if (filterValue === 'high') {
    result = result.filter(conv => {
      const meta = getLeadQualityMeta(conv);
      return meta && (meta.label === 'High' || meta.label === 'Hot');
    });
  } else if (filterValue === 'medium') {
    result = result.filter(conv => {
      const meta = getLeadQualityMeta(conv);
      return meta && (meta.label === 'Medium' || meta.label === 'Good');
    });
  } else if (filterValue === 'low') {
    result = result.filter(conv => {
      const meta = getLeadQualityMeta(conv);
      return meta && meta.label === 'Low';
    });
  }

  // 3. Sort
  const QUALITY_SCORE_MAP = { Hot: 4, High: 3, Good: 2, Medium: 2, Low: 1 };

  result.sort((a, b) => {
    if (sortValue === 'oldest') {
      return (
        new Date(a.lastMessageTime || a.updatedAt || a.createdAt) -
        new Date(b.lastMessageTime || b.updatedAt || b.createdAt)
      );
    }
    if (sortValue === 'score-high') {
      const scoreA = a.leadScoreRaw || QUALITY_SCORE_MAP[a.leadScore] || 0;
      const scoreB = b.leadScoreRaw || QUALITY_SCORE_MAP[b.leadScore] || 0;
      return scoreB - scoreA;
    }
    if (sortValue === 'score-low') {
      const scoreA = a.leadScoreRaw || QUALITY_SCORE_MAP[a.leadScore] || 0;
      const scoreB = b.leadScoreRaw || QUALITY_SCORE_MAP[b.leadScore] || 0;
      return scoreA - scoreB;
    }
    // Default: newest first
    return (
      new Date(b.lastMessageTime || b.updatedAt || b.createdAt) -
      new Date(a.lastMessageTime || a.updatedAt || a.createdAt)
    );
  });

  return result;
}

/**
 * Set up search, filter, and sort event listeners for the supplier messages widget.
 */
function setupSearchAndFilterSupplier(getConversations, supplierProfile, user) {
  const searchEl = document.getElementById('widget-search-input-supplier');
  const filterEl = document.getElementById('widget-filter-select-supplier');
  const sortEl = document.getElementById('widget-sort-select-supplier');
  const listEl = document.getElementById('supplier-conv-list');

  const refresh = () => {
    if (!listEl) {
      return;
    }
    const all = getConversations ? getConversations() : [];
    const filtered = applyFiltersSupplier(all, supplierProfile, user);
    listEl.innerHTML = renderConversations(filtered, supplierProfile, user);
  };

  if (searchEl) {
    searchEl.addEventListener('input', refresh);
  }
  if (filterEl) {
    filterEl.addEventListener('change', refresh);
  }
  if (sortEl) {
    sortEl.addEventListener('change', refresh);
  }
}

// ─── HTTP fallback for message loading ───────────────────────────────────────

async function loadMessagesHTTPFallback(conversationId) {
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      const v4Url = `/api/v4/messenger/conversations/${conversationId}/messages`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(v4Url, {
        credentials: 'include',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        return data.messages || data.items || [];
      }

      // Don't retry on 4xx client errors — they're permanent failures
      if (res.status >= 400 && res.status < 500) {
        console.warn(`[supplier-messages] HTTP ${res.status} — not retrying (client error)`);
        return [];
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      retryCount++;
      if (retryCount >= maxRetries) {
        console.error('HTTP fallback failed:', err);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
    }
  }
  return null;
}

// ─── Conversation open / messaging system integration ─────────────────────────

let messagesUnsubscribe = null;

/**
 * Open a conversation modal and load messages.
 */
async function openConversation(conversationId, user, supplierProfile) { // eslint-disable-line no-unused-vars
  logMessageState('INIT', { conversationId });

  if (!conversationId) {
    console.error('Cannot open conversation: conversationId is missing');
    return;
  }

  if (!user) {
    console.error('Please sign in to view messages');
    return;
  }

  // Validate messaging system
  if (!messagingSystem || typeof messagingSystem.listenToMessages !== 'function') {
    console.error('System not ready: messaging system initialization failed');
    return;
  }

  if (messagesUnsubscribe) {
    messagesUnsubscribe();
    messagesUnsubscribe = null;
  }

  const renderMessages = messages => {
    try {
      const container = document.getElementById('supplier-messages-list');
      if (!container) {
        return;
      }
      const parts = [];
      messages.forEach((message, index) => {
        try {
          const text = extractMessageText(message);
          parts.push(`<div class="message-item" data-index="${index}">${escapeHtml(text)}</div>`);
        } catch (msgError) {
          console.warn('Skipping invalid message', index, msgError);
          // Continue with next message
        }
      });
      container.innerHTML = parts.join('');
      logMessageState('RENDER_COMPLETE', { count: messages.length });
    } catch (error) {
      console.error('Error displaying messages', error);
      const container = document.getElementById('supplier-messages-list');
      if (container) {
        container.innerHTML = '<p>Unable to load messages. Please refresh</p>';
      }
    }
  };

  try {
    logMessageState('LISTENER_SETUP', { conversationId });
    messagesUnsubscribe = messagingSystem.listenToMessages(conversationId, messages => {
      logMessageState('MESSAGES_RECEIVED', { count: messages ? messages.length : 0 });
      renderMessages(messages || []);
    });
  } catch (error) {
    console.error('Unable to load messages', error);
    // Attempt HTTP fallback
    logMessageState('FALLBACK_TRIGGERED', { conversationId });
    const msgs = await loadMessagesHTTPFallback(conversationId);
    if (msgs) {
      renderMessages(msgs);
    }
  }

  // Mark messages as read
  const _readP = messagingSystem.markMessagesAsRead(conversationId);
  _readP.catch(err => console.warn('markMessagesAsRead failed:', err));
}

/**
 * Send a message in the current conversation.
 */
async function sendSupplierMessage(conversationId, messageText) {
  if (!conversationId || !messageText) {
    return;
  }
  await messagingSystem.sendMessage(conversationId, {
    message: messageText,
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Validate and render conversations, skipping invalid entries.
 */
function validateAndRenderConversations(conversations, supplierProfile, user) {
  const valid = (conversations || []).filter(conversation => {
    if (!conversation || typeof conversation !== 'object') {
      console.warn('Skipping invalid conversation');
      return false;
    }
    if (!conversation.id && !conversation._id) {
      console.warn('Skipping conversation without ID');
      return false;
    }
    return true;
  });
  return renderConversations(valid, supplierProfile, user);
}

export {
  escapeHtml,
  formatTimeAgo,
  truncate,
  extractMessageText,
  getLeadQualityMeta,
  renderLeadQualityBadge,
  getLeadQualitySummary,
  renderConversations,
  applyFiltersSupplier,
  setupSearchAndFilterSupplier,
  loadMessagesHTTPFallback,
  openConversation,
  sendSupplierMessage,
  validateAndRenderConversations,
};

export default {
  escapeHtml,
  formatTimeAgo,
  truncate,
  extractMessageText,
  getLeadQualityMeta,
  renderLeadQualityBadge,
  getLeadQualitySummary,
  renderConversations,
  applyFiltersSupplier,
  setupSearchAndFilterSupplier,
  loadMessagesHTTPFallback,
  openConversation,
  sendSupplierMessage,
  validateAndRenderConversations,
};
