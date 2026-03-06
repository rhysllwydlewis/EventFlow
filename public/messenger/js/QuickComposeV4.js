/**
 * QuickComposeV4 Component
 * Slide-up panel for initiating new conversations from any page.
 * Supports auth gating, draft restoration, and context attachment.
 *
 * Usage:
 *   QuickComposeV4.attachAll()   – scan DOM for [data-quick-compose] buttons.
 *   QuickComposeV4.open(opts)    – open programmatically.
 *
 * Button attributes:
 *   data-quick-compose="true"
 *   data-recipient-id="..."
 *   data-context-type="package|supplier_profile|marketplace_listing"
 *   data-context-id="..."
 *   data-context-title="..."
 *   data-context-image="..."  (optional)
 *   data-prefill="..."        (optional)
 */

'use strict';

(function () {
  const DRAFT_KEY = 'ef_qc_draft';
  const CHAR_LIMIT = 2000;

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    if (typeof s !== 'string') {
      return '';
    }
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function getCsrfToken() {
    // Try cookie (primary method – Double-Submit Cookie pattern)
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }
      const name = trimmed.substring(0, eqIndex);
      if (name === 'csrf' || name === 'csrfToken') {
        try {
          const val = decodeURIComponent(trimmed.substring(eqIndex + 1));
          if (val) {
            return val;
          }
        } catch (_) {
          continue;
        }
      }
    }
    // Fallback to globals set by csrf-handler.js
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    if (window.csrfToken) {
      return window.csrfToken;
    }
    return '';
  }

  function saveDraft(payload) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (_) {
      /* ignore storage errors */
    }
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (_) {
      /* ignore storage errors */
    }
  }

  async function checkAuth() {
    // AuthStateManager (primary global in EventFlow)
    if (window.AuthStateManager && typeof window.AuthStateManager.isAuthenticated === 'function') {
      if (window.AuthStateManager.isAuthenticated()) {
        return true;
      }
    }
    try {
      const res = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  // ─── Panel DOM ──────────────────────────────────────────────────────────────

  let _panel = null;
  let _backdrop = null;
  let _isOpen = false;

  function _ensurePanel() {
    if (_panel) {
      return;
    }

    // Inject styles once
    if (!document.getElementById('qcv4-styles')) {
      const style = document.createElement('style');
      style.id = 'qcv4-styles';
      style.textContent = `
        .qcv4-backdrop {
          position: fixed; inset: 0; z-index: 9998;
          background: rgba(0,0,0,0.45);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          opacity: 0; transition: opacity 0.25s ease;
          pointer-events: none;
        }
        .qcv4-backdrop--visible { opacity: 1; pointer-events: auto; }

        .qcv4-panel {
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
          background: rgba(255,255,255,0.96);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid rgba(11,128,115,0.15);
          border-radius: 20px 20px 0 0;
          box-shadow: 0 -8px 40px rgba(11,128,115,0.14);
          padding: 0;
          max-height: 90vh;
          overflow-y: auto;
          transform: translateY(100%);
          transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
          font-family: inherit;
        }
        @media (min-width: 768px) {
          .qcv4-panel {
            max-width: 540px;
            left: 50%; transform: translateX(-50%) translateY(100%);
            border-radius: 20px 20px 0 0;
          }
          .qcv4-panel--visible {
            transform: translateX(-50%) translateY(0) !important;
          }
        }
        .qcv4-panel--visible { transform: translateY(0); }

        .qcv4-drag-handle {
          width: 40px; height: 4px;
          background: rgba(11,128,115,0.25);
          border-radius: 2px;
          margin: 12px auto 0;
        }
        .qcv4-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 12px;
          border-bottom: 1px solid rgba(11,128,115,0.08);
        }
        .qcv4-title {
          font-size: 1rem; font-weight: 700; color: #0b8073; margin: 0;
        }
        .qcv4-close {
          background: transparent; border: none; cursor: pointer;
          color: #6b7280; display: flex; align-items: center; justify-content: center;
          padding: 6px; border-radius: 6px; transition: background 0.15s;
        }
        .qcv4-close:hover { background: rgba(0,0,0,0.06); }

        .qcv4-body { padding: 16px 20px 20px; }

        .qcv4-context-card {
          display: flex; align-items: center; gap: 12px;
          background: rgba(11,128,115,0.05);
          border: 1px solid rgba(11,128,115,0.12);
          border-radius: 10px;
          padding: 10px 14px;
          margin-bottom: 16px;
        }
        .qcv4-context-img {
          width: 44px; height: 44px; border-radius: 8px;
          object-fit: cover; flex-shrink: 0;
        }
        .qcv4-context-placeholder {
          width: 44px; height: 44px; border-radius: 8px;
          background: linear-gradient(135deg,#0b8073,#0d9488);
          display: flex; align-items: center; justify-content: center;
          font-size: 1.3rem; flex-shrink: 0;
        }
        .qcv4-context-info { flex: 1; min-width: 0; }
        .qcv4-context-label {
          font-size: 0.72rem; color: #0b8073; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .qcv4-context-title {
          font-size: 0.88rem; font-weight: 600; color: #1f2937;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .qcv4-field { margin-bottom: 14px; }
        .qcv4-label {
          display: block; font-size: 0.82rem; font-weight: 600;
          color: #374151; margin-bottom: 5px;
        }
        .qcv4-recipient {
          width: 100%; padding: 9px 12px;
          border: 1px solid rgba(11,128,115,0.25); border-radius: 8px;
          font-size: 0.88rem; font-family: inherit;
          background: rgba(255,255,255,0.9);
          box-sizing: border-box;
        }
        .qcv4-recipient:read-only { background: rgba(240,253,244,0.6); color: #374151; }
        .qcv4-recipient:focus { outline: none; border-color: #0b8073; box-shadow: 0 0 0 3px rgba(11,128,115,0.15); }

        .qcv4-textarea {
          width: 100%; min-height: 90px; max-height: 220px;
          padding: 10px 12px;
          border: 1px solid rgba(11,128,115,0.25); border-radius: 8px;
          font-size: 0.88rem; font-family: inherit;
          resize: vertical;
          box-sizing: border-box;
          background: rgba(255,255,255,0.9);
          transition: border-color 0.15s;
        }
        .qcv4-textarea:focus { outline: none; border-color: #0b8073; box-shadow: 0 0 0 3px rgba(11,128,115,0.15); }

        .qcv4-char-indicator {
          text-align: right; font-size: 0.75rem; color: #9ca3af; margin-top: 4px;
        }
        .qcv4-char-indicator--warn { color: #f59e0b; }
        .qcv4-char-indicator--over { color: #ef4444; }

        .qcv4-actions {
          display: flex; gap: 10px; margin-top: 18px;
        }
        .qcv4-submit {
          flex: 1; padding: 11px 20px;
          background: linear-gradient(135deg,#0b8073,#0d9488);
          color: #fff; border: none; border-radius: 10px;
          font-size: 0.92rem; font-weight: 700; cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .qcv4-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .qcv4-submit:not(:disabled):hover { opacity: 0.9; transform: translateY(-1px); }

        .qcv4-cancel-btn {
          padding: 11px 18px;
          background: transparent;
          color: #6b7280;
          border: 1px solid rgba(107,114,128,0.3);
          border-radius: 10px; font-size: 0.88rem; cursor: pointer;
          transition: background 0.15s;
        }
        .qcv4-cancel-btn:hover { background: rgba(107,114,128,0.08); }

        .qcv4-error {
          font-size: 0.82rem; color: #dc2626;
          margin-top: 8px; padding: 8px 12px;
          background: rgba(220,38,38,0.06); border-radius: 6px;
          display: none;
        }
        .qcv4-error--visible { display: block; }
      `;
      document.head.appendChild(style);
    }

    // Backdrop
    _backdrop = document.createElement('div');
    _backdrop.className = 'qcv4-backdrop';
    _backdrop.setAttribute('aria-hidden', 'true');
    _backdrop.addEventListener('click', _close);
    document.body.appendChild(_backdrop);

    // Panel
    _panel = document.createElement('div');
    _panel.className = 'qcv4-panel';
    _panel.setAttribute('role', 'dialog');
    _panel.setAttribute('aria-modal', 'true');
    _panel.setAttribute('aria-labelledby', 'qcv4-title');
    document.body.appendChild(_panel);
  }

  function _buildPanelContent(opts) {
    const {
      recipientId = '',
      recipientName = '',
      contextType = '',
      contextTitle = '',
      contextImage = '',
      prefill = '',
    } = opts;

    const contextEmoji =
      {
        supplier_profile: '🏢',
        package: '📦',
        marketplace_listing: '🛒',
      }[contextType] || '💬';

    const contextLabelText =
      {
        supplier_profile: 'Supplier',
        package: 'Package',
        marketplace_listing: 'Listing',
      }[contextType] || 'Context';

    const contextCardHtml =
      contextType && contextTitle
        ? `<div class="qcv4-context-card" aria-label="Context: ${escapeHtml(contextTitle)}">
           ${
             contextImage
               ? `<img src="${escapeHtml(contextImage)}" alt="" class="qcv4-context-img" loading="lazy" onerror="this.style.display='none'">`
               : `<div class="qcv4-context-placeholder">${contextEmoji}</div>`
           }
           <div class="qcv4-context-info">
             <div class="qcv4-context-label">${escapeHtml(contextLabelText)}</div>
             <div class="qcv4-context-title">${escapeHtml(contextTitle)}</div>
           </div>
         </div>`
        : '';

    _panel.innerHTML = `
      <div class="qcv4-drag-handle" aria-hidden="true"></div>
      <div class="qcv4-header">
        <h2 class="qcv4-title" id="qcv4-title">New Message</h2>
        <button class="qcv4-close" id="qcv4-close-btn" aria-label="Close compose panel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="qcv4-body">
        ${contextCardHtml}
        ${
          !recipientId
            ? `<div class="qcv4-field">
          <label class="qcv4-label" for="qcv4-recipient">To</label>
          <input type="text" id="qcv4-recipient" class="qcv4-recipient"
                 placeholder="Recipient name or ID" value="${escapeHtml(recipientName)}"
                 autocomplete="off">
        </div>`
            : `<input type="hidden" id="qcv4-recipient" value="${escapeHtml(recipientId)}">`
        }
        <div class="qcv4-field">
          <label class="qcv4-label" for="qcv4-message">Message</label>
          <textarea id="qcv4-message" class="qcv4-textarea"
                    placeholder="Write your message…"
                    maxlength="${CHAR_LIMIT}"
                    aria-describedby="qcv4-chars">${escapeHtml(prefill)}</textarea>
          <div class="qcv4-char-indicator" id="qcv4-chars">${CHAR_LIMIT} characters remaining</div>
        </div>
        <div class="qcv4-error" id="qcv4-error" role="alert" aria-live="polite"></div>
        <div class="qcv4-actions">
          <button class="qcv4-cancel-btn" id="qcv4-cancel-btn">Cancel</button>
          <button class="qcv4-submit" id="qcv4-submit-btn">Send Message</button>
        </div>
      </div>`;

    // Store opts on panel for submit handler
    _panel._opts = opts;

    // Wire close
    document.getElementById('qcv4-close-btn').addEventListener('click', _close);
    document.getElementById('qcv4-cancel-btn').addEventListener('click', _close);

    // Char counter
    const ta = document.getElementById('qcv4-message');
    const charEl = document.getElementById('qcv4-chars');
    ta.addEventListener('input', () => {
      const remaining = CHAR_LIMIT - ta.value.length;
      charEl.textContent = `${remaining} characters remaining`;
      charEl.className = `qcv4-char-indicator${
        remaining < 0
          ? ' qcv4-char-indicator--over'
          : remaining < 100
            ? ' qcv4-char-indicator--warn'
            : ''
      }`;
      document.getElementById('qcv4-submit-btn').disabled =
        ta.value.trim().length === 0 || remaining < 0;
    });
    // Initial state
    if (ta.value.trim().length === 0) {
      document.getElementById('qcv4-submit-btn').disabled = true;
    }

    // Submit
    document.getElementById('qcv4-submit-btn').addEventListener('click', () => _handleSubmit(opts));

    // Keyboard close
    _panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        _close();
      }
    });
  }

  // ─── Open / Close ────────────────────────────────────────────────────────────

  /**
   * Open the compose panel.
   * @param {Object} opts
   */
  async function open(opts = {}) {
    _ensurePanel();

    // Auth gate
    const authed = await checkAuth();
    if (!authed) {
      const draft = {
        recipientId: opts.recipientId || '',
        recipientName: opts.recipientName || '',
        contextType: opts.contextType || '',
        contextId: opts.contextId || '',
        contextTitle: opts.contextTitle || '',
        contextImage: opts.contextImage || '',
        prefill: opts.prefill || '',
        returnUrl: window.location.href,
      };
      saveDraft(draft);
      window.location.href = `/auth?redirect=${encodeURIComponent(window.location.href)}`;
      return;
    }

    _buildPanelContent(opts);
    _isOpen = true;

    // Animate in (next frame)
    requestAnimationFrame(() => {
      _backdrop.classList.add('qcv4-backdrop--visible');
      _panel.classList.add('qcv4-panel--visible');
    });

    // Focus textarea
    setTimeout(() => {
      const ta = document.getElementById('qcv4-message');
      if (ta) {
        ta.focus();
      }
    }, 320);

    // Trap scroll
    document.body.style.overflow = 'hidden';
  }

  function _close() {
    if (!_isOpen) {
      return;
    }
    _backdrop.classList.remove('qcv4-backdrop--visible');
    _panel.classList.remove('qcv4-panel--visible');
    _isOpen = false;
    document.body.style.overflow = '';
    setTimeout(() => {
      if (_panel) {
        _panel.innerHTML = '';
      }
    }, 300);
  }

  // ─── Submit logic ─────────────────────────────────────────────────────────────

  async function _handleSubmit(opts) {
    const ta = document.getElementById('qcv4-message');
    const errorEl = document.getElementById('qcv4-error');
    const submitBtn = document.getElementById('qcv4-submit-btn');

    const messageText = ta ? ta.value.trim() : '';
    if (!messageText) {
      return;
    }

    // Determine recipientId
    let recipientId = opts.recipientId;
    if (!recipientId) {
      const recipientInput = document.getElementById('qcv4-recipient');
      recipientId = recipientInput ? recipientInput.value.trim() : '';
    }

    if (!recipientId) {
      _showError(errorEl, 'Please enter a recipient.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    _hideError(errorEl);

    try {
      // participantIds must only include OTHER participants - the backend adds the current user automatically
      const participantIds = [recipientId];

      // Build context object
      const context = {};
      if (opts.contextType) {
        context.type = opts.contextType;
      }
      if (opts.contextId) {
        context.referenceId = opts.contextId;
      }
      if (opts.contextTitle) {
        context.title = opts.contextTitle;
      }

      // Step 1: Create (or find existing) conversation
      const createRes = await fetch('/api/v4/messenger/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({
          type:
            opts.contextType === 'marketplace_listing'
              ? 'marketplace'
              : opts.contextType === 'package'
                ? 'enquiry'
                : 'direct',
          participantIds,
          context: Object.keys(context).length ? context : undefined,
        }),
      });

      let conversationId;
      if (createRes.ok) {
        const createData = await createRes.json();
        conversationId =
          (createData.conversation &&
            (createData.conversation._id || createData.conversation.id)) ||
          createData._id ||
          createData.id;
      } else if (createRes.status === 409) {
        // Conversation already exists
        const conflictData = await createRes.json();
        conversationId =
          (conflictData.conversation &&
            (conflictData.conversation._id || conflictData.conversation.id)) ||
          conflictData.conversationId;
      } else {
        const errBody = await createRes.json().catch(() => ({}));
        throw new Error(
          `Failed to create conversation (${createRes.status}): ${errBody.error || errBody.message || 'Unknown error'}`
        );
      }

      if (!conversationId) {
        throw new Error('No conversation ID returned');
      }

      // Step 2: Send initial message
      const msgRes = await fetch(
        `/api/v4/messenger/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify({ content: messageText }),
        }
      );

      if (!msgRes.ok) {
        const errBody = await msgRes.json().catch(() => ({}));
        throw new Error(
          `Failed to send message (${msgRes.status}): ${errBody.error || errBody.message || 'Unknown error'}`
        );
      }

      // Clear draft and redirect
      clearDraft();
      _close();
      window.location.href = `/messenger/?conversation=${encodeURIComponent(conversationId)}`;
    } catch (err) {
      console.error('QuickComposeV4: submit failed', err);
      _showError(errorEl, 'Failed to send message. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Message';
    }
  }

  function _showError(el, msg) {
    if (!el) {
      return;
    }
    el.textContent = msg;
    el.classList.add('qcv4-error--visible');
  }

  function _hideError(el) {
    if (!el) {
      return;
    }
    el.textContent = '';
    el.classList.remove('qcv4-error--visible');
  }

  // ─── Auto-attach ─────────────────────────────────────────────────────────────

  /**
   * Scan DOM for [data-quick-compose="true"] buttons and attach click handlers.
   */
  function attachAll() {
    const triggers = document.querySelectorAll('[data-quick-compose="true"]');
    triggers.forEach(btn => {
      // Avoid double-binding
      if (btn._qcv4Attached) {
        return;
      }
      btn._qcv4Attached = true;
      btn.addEventListener('click', e => {
        e.preventDefault();
        open({
          recipientId: btn.dataset.recipientId || '',
          recipientName: btn.dataset.recipientName || '',
          contextType: btn.dataset.contextType || '',
          contextId: btn.dataset.contextId || '',
          contextTitle: btn.dataset.contextTitle || '',
          contextImage: btn.dataset.contextImage || '',
          prefill: btn.dataset.prefill || '',
        });
      });
    });
  }

  // ─── Draft restoration ────────────────────────────────────────────────────────

  /**
   * Check for a saved draft (after login redirect) and restore it.
   */
  function restoreDraftIfPresent() {
    const draft = loadDraft();
    if (!draft) {
      return;
    }

    // Only restore if we just returned from a login redirect
    const returnUrl = draft.returnUrl || '';
    const currentUrl = window.location.href;
    const onReturnPage = currentUrl === returnUrl || currentUrl.startsWith(returnUrl.split('?')[0]);

    if (!onReturnPage) {
      return;
    }

    clearDraft();
    // Delay to let page settle
    setTimeout(() => {
      open(draft);
    }, 600);
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  const QuickComposeV4 = { open, attachAll, restoreDraftIfPresent };

  window.QuickComposeV4 = QuickComposeV4;

  // Auto-attach after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      attachAll();
      restoreDraftIfPresent();
    });
  } else {
    attachAll();
    restoreDraftIfPresent();
  }
})();
