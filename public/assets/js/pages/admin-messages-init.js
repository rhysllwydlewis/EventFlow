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
      chips.push(
        `<span class="mod-badge" style="font-size:0.7rem;padding:0.1rem 0.4rem">${escapeHtml(ctx.type)}</span>`
      );
    }
    if (ctx.packageId) {
      chips.push(
        '<span class="mod-badge" style="font-size:0.7rem;padding:0.1rem 0.4rem;background:rgba(99,102,241,.15)">pkg</span>'
      );
    }
    if (ctx.supplierId) {
      chips.push(
        '<span class="mod-badge" style="font-size:0.7rem;padding:0.1rem 0.4rem;background:rgba(16,185,129,.15)">supplier</span>'
      );
    }
    return chips.join(' ');
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

  // Build a single conversation row — either as a standard <tr> for wider
  // viewports, or as a stacked card <tr> for mobile (≤ 600 px).
  function buildRow(conv) {
    const id = escapeHtml(conv._id || '');
    const unread = unreadTotal(conv);
    const names = participantNames(conv);
    const chips = contextChips(conv);
    const dateStr = formatDate(conv.updatedAt || (conv.lastMessage && conv.lastMessage.sentAt));
    const snippet = conv.lastMessage && conv.lastMessage.content
      ? escapeHtml(conv.lastMessage.content.substring(0, 80))
      : '—';
    const openLink = `<a href="/admin-messenger-view?conversation=${id}" class="btn-sm" style="text-decoration:none" target="_blank">Open</a>`;

    // On narrow screens render as a self-contained card row so nothing is
    // clipped or pushed off-screen.
    if (window.innerWidth <= 600) {
      return (
        `<tr class="admin-messenger-card-row" style="border-top:1px solid rgba(0,0,0,.07);display:block;padding:0.75rem 0">` +
        `<td style="display:block;padding:0.25rem 0.75rem">` +
          `<strong style="font-size:0.85rem">${names}</strong>${ 
          chips ? ` <span style="margin-left:4px">${chips}</span>` : '' 
        }</td>` +
        `<td style="display:block;padding:0.15rem 0.75rem;font-size:0.8rem;opacity:0.7">${snippet}</td>` +
        `<td style="display:block;padding:0.15rem 0.75rem;font-size:0.75rem;opacity:0.55">${dateStr}${ 
          unread > 0 ? ` · <span style="color:#dc2626;font-weight:600">${unread} unread</span>` : '' 
        }</td>` +
        `<td style="display:block;padding:0.25rem 0.75rem">${openLink}</td>` +
        `</tr>`
      );
    }

    // Desktop: standard table row
    return (
      `<tr style="border-top:1px solid rgba(0,0,0,.07)">` +
      `<td style="padding:0.5rem 0.75rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${names}</td>` +
      `<td style="padding:0.5rem 0.75rem">${chips || '—'}</td>` +
      `<td style="padding:0.5rem 0.75rem;font-size:0.85rem;opacity:0.8">${dateStr}</td>` +
      `<td style="padding:0.5rem 0.75rem;text-align:center">${unread > 0 ? `<span class="mod-badge" style="background:rgba(239,68,68,.15);color:#dc2626">${unread}</span>` : '—'}</td>` +
      `<td style="padding:0.5rem 0.75rem;text-align:center">${openLink}</td>` +
      `</tr>`
    );
  }

  function renderTable(conversations) {
    const tbody = document.getElementById('msgModerationBody');
    if (!tbody) {
      return;
    }
    if (!conversations || conversations.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="padding:1rem;text-align:center;opacity:0.6">No conversations found.</td></tr>';
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

  function loadConversations() {
    const params = new URLSearchParams({ limit: PAGE_SIZE, skip: currentSkip });
    if (currentSearch) {
      params.set('search', currentSearch);
    }
    if (currentStatus) {
      params.set('status', currentStatus);
    }
    fetch(`/api/v4/messenger/admin/conversations?${params.toString()}`, { credentials: 'include' })
      .then(r => {
        return r.ok ? r.json() : Promise.reject(r.status);
      })
      .then(data => {
        currentTotal = data.total || 0;
        renderTable(data.conversations || []);
        updatePager();
      })
      .catch(err => {
        const tbody = document.getElementById('msgModerationBody');
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="5" style="padding:1rem;text-align:center;color:#dc2626">Failed to load conversations (error: ${escapeHtml(String(err))})</td></tr>`;
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
