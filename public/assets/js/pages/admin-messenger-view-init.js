/**
 * Admin Conversation Viewer — read-only moderation view
 * Uses admin-only endpoints so the admin can view any conversation
 * regardless of participant status.  Read states are never modified.
 */
'use strict';
(function () {
  // Earliest cursor seen so far — used for "load earlier" pagination.
  let oldestCursor = null;
  let hasMore = false;
  let loadedCount = 0;
  let isLoading = false;

  function escapeHtml(s) {
    return AdminShared.escapeHtml(String(s || ''));
  }

  function formatDate(ts) {
    if (!ts) {
      return '—';
    }
    const d = new Date(ts);
    return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  }

  /**
   * Read `?conversation=<id>` from the current URL.
   * Returns the id string or null if missing / obviously invalid.
   */
  function getConversationId() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('conversation');
    if (!id || !/^[0-9a-f]{24}$/i.test(id)) {
      return null;
    }
    return id;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ────────────────────────────────────────────────────────────────────────────

  function renderMetaCard(conv) {
    const metaEl = document.getElementById('convMeta');
    if (!metaEl) {
      return;
    }

    const participants = (conv.participants || [])
      .map(
        p =>
          `<li class="amv-participant-chip">${escapeHtml(
            p.displayName || p.businessName || p.userId || '?'
          )}</li>`
      )
      .join('');

    const contextType = (conv.context && conv.context.type) || '';
    const contextTitle =
      (conv.context && (conv.context.referenceTitle || conv.context.title)) || '';

    metaEl.innerHTML = `
      <div class="amv-meta-grid">
        <div class="amv-meta-item">
          <span class="amv-meta-label">ID</span>
          <span class="amv-meta-value ef-msg-code">${escapeHtml(conv._id || '')}</span>
        </div>
        <div class="amv-meta-item">
          <span class="amv-meta-label">Type</span>
          <span class="amv-meta-value">${escapeHtml(conv.type || '—')}</span>
        </div>
        <div class="amv-meta-item">
          <span class="amv-meta-label">Status</span>
          <span class="amv-meta-value">${escapeHtml(conv.status || '—')}</span>
        </div>
        <div class="amv-meta-item">
          <span class="amv-meta-label">Created</span>
          <span class="amv-meta-value">${formatDate(conv.createdAt)}</span>
        </div>
        <div class="amv-meta-item">
          <span class="amv-meta-label">Last message</span>
          <span class="amv-meta-value">${formatDate(conv.updatedAt)}</span>
        </div>
        ${
          contextType
            ? `<div class="amv-meta-item">
          <span class="amv-meta-label">Context type</span>
          <span class="amv-meta-value">${escapeHtml(contextType)}</span>
        </div>`
            : ''
        }
        ${
          contextTitle
            ? `<div class="amv-meta-item">
          <span class="amv-meta-label">Context</span>
          <span class="amv-meta-value">${escapeHtml(contextTitle)}</span>
        </div>`
            : ''
        }
      </div>
      <div style="margin-top:0.75rem">
        <span class="amv-meta-label">Participants</span>
        <ul class="amv-participants-list" aria-label="Participants">${participants}</ul>
      </div>`;
  }

  function buildMessageHtml(msg) {
    const sender = escapeHtml(msg.senderName || msg.senderId || 'Unknown');
    const time = formatDate(msg.createdAt);
    const content = escapeHtml(msg.content || '');

    const attachments = (msg.attachments || [])
      .map(
        a =>
          `<span class="amv-attachment-chip">📎 ${escapeHtml(a.filename || a.name || 'file')}</span>`
      )
      .join('');

    const deletedNote = msg.isDeleted ? '<em class="amv-msg-deleted">[deleted]</em>' : '';

    return `<div class="amv-msg${msg.isDeleted ? ' amv-msg-deleted' : ''}" role="article">
      <div class="amv-msg-meta">
        <span class="amv-msg-sender">${sender}</span>
        <span class="amv-msg-time">${time}</span>
      </div>
      ${deletedNote || `<div class="amv-msg-content">${content}</div>`}
      ${attachments ? `<div class="amv-msg-attachments">${attachments}</div>` : ''}
    </div>`;
  }

  function prependMessages(messages) {
    const list = document.getElementById('messagesList');
    if (!list) {
      return;
    }
    const html = messages.map(buildMessageHtml).join('');
    list.insertAdjacentHTML('afterbegin', html);
  }

  function appendMessages(messages) {
    const list = document.getElementById('messagesList');
    if (!list) {
      return;
    }
    const html = messages.map(buildMessageHtml).join('');
    list.insertAdjacentHTML('beforeend', html);
  }

  function updatePaginationRow() {
    const row = document.getElementById('paginationRow');
    const btn = document.getElementById('loadMoreBtn');
    const info = document.getElementById('paginationInfo');
    if (!row || !btn || !info) {
      return;
    }
    row.style.display = hasMore ? '' : 'none';
    btn.disabled = isLoading;
    info.textContent = hasMore ? 'More messages available' : '';
  }

  function updateMsgCount() {
    const el = document.getElementById('msgCount');
    if (el) {
      el.textContent =
        loadedCount > 0 ? `${loadedCount} message${loadedCount === 1 ? '' : 's'} loaded` : '';
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // API calls
  // ────────────────────────────────────────────────────────────────────────────

  async function fetchConversation(id) {
    const data = await AdminShared.api(`/api/v4/messenger/admin/conversations/${id}`);
    return data.conversation;
  }

  async function fetchMessages(id, cursor) {
    const params = new URLSearchParams({ limit: 50 });
    if (cursor) {
      params.set('cursor', cursor);
    }
    return AdminShared.api(
      `/api/v4/messenger/admin/conversations/${id}/messages?${params.toString()}`
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Page init
  // ────────────────────────────────────────────────────────────────────────────

  async function init() {
    const convId = getConversationId();

    if (!convId) {
      document.getElementById('convMeta').innerHTML =
        '<p class="amv-state amv-state--error">No valid conversation ID supplied. Return to <a href="/admin-messenger">Messenger Moderation</a>.</p>';
      document.getElementById('messagesList').innerHTML = '';
      return;
    }

    // Update page title with id
    document.title = `Conversation ${convId.slice(-6)} — EventFlow admin`;

    // Load metadata
    try {
      const conv = await fetchConversation(convId);
      renderMetaCard(conv);
    } catch (err) {
      AdminShared.debugError('Admin viewer: failed to load conversation', err);
      document.getElementById('convMeta').innerHTML =
        '<p class="amv-state amv-state--error">Failed to load conversation metadata.</p>';
    }

    // Load initial messages
    try {
      isLoading = true;
      document.getElementById('messagesList').innerHTML =
        '<p class="amv-state">Loading messages…</p>';

      const result = await fetchMessages(convId, null);
      const messages = result.messages || [];

      if (messages.length === 0) {
        document.getElementById('messagesList').innerHTML =
          '<p class="amv-state">No messages in this conversation.</p>';
      } else {
        document.getElementById('messagesList').innerHTML = '';
        appendMessages(messages);
        loadedCount = messages.length;

        // The API returns messages oldest-first. The first element is the oldest,
        // and its _id is used as the cursor for "load earlier" pagination.
        if (result.hasMore && result.nextCursor) {
          oldestCursor = result.nextCursor;
          hasMore = true;
        }
      }
    } catch (err) {
      AdminShared.debugError('Admin viewer: failed to load messages', err);
      document.getElementById('messagesList').innerHTML =
        '<p class="amv-state amv-state--error">Failed to load messages. Please try refreshing.</p>';
    } finally {
      isLoading = false;
      updatePaginationRow();
      updateMsgCount();
    }
  }

  // "Load earlier messages" button
  document.addEventListener('DOMContentLoaded', () => {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        const convId = getConversationId();
        if (!convId || isLoading) {
          return;
        }

        isLoading = true;
        loadMoreBtn.disabled = true;

        try {
          const result = await fetchMessages(convId, oldestCursor);
          const messages = result.messages || [];

          if (messages.length > 0) {
            prependMessages(messages);
            loadedCount += messages.length;

            if (result.hasMore && result.nextCursor) {
              oldestCursor = result.nextCursor;
              hasMore = true;
            } else {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        } catch (err) {
          AdminShared.debugError('Admin viewer: failed to load earlier messages', err);
        } finally {
          isLoading = false;
          updatePaginationRow();
          updateMsgCount();
        }
      });
    }

    init();
  });
})();
