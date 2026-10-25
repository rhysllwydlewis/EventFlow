// Message Moderation panel
'use strict';
(function () {

  const PAGE_SIZE = 20;
  let currentSkip = 0;
  let currentTotal = 0;
  let currentSearch = '';
  let currentStatus = '';

  function escapeHtml(str) {
    return AdminShared.escapeHtml(str);
  }

  function formatDate(iso) {
    return AdminShared.formatDate(iso);
  }

  function contextChips(conv) {
    const chips = [];
    const ctx = conv.context || {};
    if (ctx.type) {
      chips.push(`<span class="adh-chip">${escapeHtml(ctx.type)}</span>`);
    }
    if (ctx.packageId) {
      chips.push('<span class="adh-chip">package</span>');
    }
    if (ctx.supplierId) {
      chips.push('<span class="adh-chip">supplier</span>');
    }
    return chips.join('');
  }

  function participantNames(conv) {
    const parts = conv.participants || [];
    return (
      parts
        .map(p => {
          return escapeHtml(p.displayName || p.businessName || p.userId || '?');
        })
        .join(', ') || '—'
    );
  }

  function unreadTotal(conv) {
    const parts = conv.participants || [];
    return parts.reduce((sum, p) => {
      return sum + (p.unreadCount || 0);
    }, 0);
  }

  // Build a single conversation row. The page's own stylesheet turns it into a small card on
  // narrow screens, so one markup serves both.
  function buildRow(conv) {
    const id = escapeHtml(conv._id || '');
    const unread = unreadTotal(conv);
    const dateStr = formatDate(conv.updatedAt || (conv.lastMessage && conv.lastMessage.sentAt));
    const openLink = `<a href="/admin-messenger-view?conversation=${id}" class="adh-btn adh-btn--sm" target="_blank" rel="noopener">Open</a>`;
    return (
      `<tr>` +
      `<td data-label="Participants"><div class="adh-msg__names">${participantNames(conv)}</div></td>` +
      `<td data-label="Context">${contextChips(conv) || '—'}</td>` +
      `<td data-label="Last message" class="adh-msg__date">${dateStr}</td>` +
      `<td data-label="Unread" class="adh-msg__center">${unread > 0 ? `<span class="adh-unread">${unread}</span>` : '—'}</td>` +
      `<td data-label="Action" class="adh-msg__center">${openLink}</td>` +
      `</tr>`
    );
  }

  function renderTable(conversations) {
    const tbody = document.getElementById('msgModerationBody');
    if (!tbody) {
      return;
    }
    if (!conversations || conversations.length === 0) {
      showMessageState('No conversations found.', 'empty');
      return;
    }
    tbody.innerHTML = conversations.map(buildRow).join('');
  }

  function updatePager() {
    const info = document.getElementById('msgModerationPageInfo');
    const prev = document.getElementById('msgModerationPrev');
    const next = document.getElementById('msgModerationNext');
    if (!info) {
      return;
    }
    const page = Math.floor(currentSkip / PAGE_SIZE) + 1;
    const totalPages = Math.ceil(currentTotal / PAGE_SIZE) || 1;
    info.textContent = `Page ${page} of ${totalPages} (${currentTotal} total)`;
    prev.disabled = currentSkip === 0;
    next.disabled = currentSkip + PAGE_SIZE >= currentTotal;
  }

  const LOAD_TIMEOUT_MS = 15000;
  let loadSeq = 0;

  function showMessageState(html, modifier) {
    const tbody = document.getElementById('msgModerationBody');
    if (tbody) {
      const cls = `admin-messenger-state${modifier ? ` admin-messenger-state--${modifier}` : ''}`;
      tbody.innerHTML = `<tr><td colspan="5" class="${cls}">${html}</td></tr>`;
    }
  }

  function describeLoadError(err) {
    if (typeof err === 'number') {
      if (err === 401 || err === 403) {
        return 'You do not have access to message moderation. Sign in again as an admin.';
      }
      return `The server could not load conversations (error ${err}).`;
    }
    const text = err?.message ? String(err.message) : '';
    if (/timed out/i.test(text)) {
      return 'Loading conversations took too long.';
    }
    return text || 'Conversations could not be loaded.';
  }

  function loadConversations() {
    const params = new URLSearchParams({ limit: PAGE_SIZE, skip: currentSkip });
    if (currentSearch) {
      params.set('search', currentSearch);
    }
    if (currentStatus) {
      params.set('status', currentStatus);
    }
    // Only the newest request may draw: a slow answer to an earlier search must not replace it.
    loadSeq += 1;
    const seq = loadSeq;
    showMessageState('Loading conversations…', 'loading');
    const url = `/api/v4/messenger/admin/conversations?${params.toString()}`;
    const request = window.AdminShared?.fetchWithTimeout
      ? window.AdminShared.fetchWithTimeout(url, { credentials: 'include' }, LOAD_TIMEOUT_MS)
      : fetch(url, { credentials: 'include' });
    request
      .then(r => {
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(data => {
        if (seq !== loadSeq) {
          return;
        }
        currentTotal = data.total || 0;
        renderTable(data.conversations || []);
        updatePager();
      })
      .catch(err => {
        if (seq !== loadSeq) {
          return;
        }
        showMessageState(
          `${escapeHtml(describeLoadError(err))} ` +
            '<button type="button" class="ef-cta btn-sm" id="msgModerationRetry">Try again</button>',
          'error'
        );
        const retry = document.getElementById('msgModerationRetry');
        if (retry) {
          retry.addEventListener('click', loadConversations);
        }
      });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('msgModerationSearch');
    const statusSelect = document.getElementById('msgModerationStatus');
    const searchBtn = document.getElementById('msgModerationSearchBtn');
    const prevBtn = document.getElementById('msgModerationPrev');
    const nextBtn = document.getElementById('msgModerationNext');

    function doSearch() {
      currentSearch = searchInput ? searchInput.value.trim() : '';
      currentStatus = statusSelect ? statusSelect.value : '';
      currentSkip = 0;
      loadConversations();
    }

    if (searchBtn) {
      searchBtn.addEventListener('click', doSearch);
    }
    if (searchInput) {
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          doSearch();
        }
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentSkip >= PAGE_SIZE) {
          currentSkip -= PAGE_SIZE;
          loadConversations();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentSkip + PAGE_SIZE < currentTotal) {
          currentSkip += PAGE_SIZE;
          loadConversations();
        }
      });
    }

    loadConversations();
  });
})();
