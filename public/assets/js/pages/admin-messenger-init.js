(function () {
  'use strict';

  const PAGE_SIZE = 20;
  let currentPage = 0;
  let currentSearch = '';
  let currentStatus = '';
  let totalConversations = 0;

  const TYPE_LABELS = {
    marketplace_listing: 'Marketplace Listing',
    supplier_profile: 'Supplier Profile',
    direct: 'Direct',
  };

  const STATUS_BADGE_CLASS = {
    active: 'admin-messenger-status-badge--active',
    archived: 'admin-messenger-status-badge--archived',
    deleted: 'admin-messenger-status-badge--deleted',
  };

  function escapeHtml(s) {
    return AdminShared.escapeHtml(s);
  }

  function formatDate(ts) {
    if (!ts) {
      return '—';
    }
    const d = new Date(ts);
    return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  }

  function getParticipantNames(participants) {
    if (!Array.isArray(participants) || participants.length === 0) {
      return 'Unknown';
    }
    return participants
      .map(p => escapeHtml(p.displayName || p.businessName || p.email || p.userId || 'Unknown'))
      .join(', ');
  }

  function formatType(rawType) {
    const label = TYPE_LABELS[rawType] || rawType;
    return escapeHtml(label);
  }

  function formatStatus(rawStatus) {
    const s = rawStatus || 'active';
    const modClass = STATUS_BADGE_CLASS[s] || '';
    return `<span class="admin-messenger-status-badge ${modClass}">${escapeHtml(s)}</span>`;
  }

  async function fetchConversations() {
    const tbody = document.getElementById('conversationsBody');
    const summary = document.getElementById('resultsSummary');
    tbody.innerHTML =
      '<tr><td colspan="6" class="admin-messenger-state admin-messenger-state--loading">Loading…</td></tr>';

    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        skip: currentPage * PAGE_SIZE,
      });
      if (currentSearch.trim()) {
        params.set('search', currentSearch.trim());
      }
      if (currentStatus) {
        params.set('status', currentStatus);
      }

      const data = await AdminShared.api(
        `/api/v4/messenger/admin/conversations?${params.toString()}`
      );

      totalConversations = data.total || 0;
      const conversations = data.conversations || [];

      summary.textContent =
        totalConversations === 0
          ? 'No conversations found.'
          : `Showing ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, totalConversations)} of ${totalConversations} conversations`;

      if (conversations.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="6" class="admin-messenger-state admin-messenger-state--empty">No conversations found.</td></tr>';
        updatePagination();
        return;
      }

      tbody.innerHTML = conversations
        .map(conv => {
          const names = getParticipantNames(conv.participants);
          const type = formatType(conv.type || '—');
          const lastMsg =
            (conv.lastMessage && (conv.lastMessage.content || conv.lastMessage.text)) || '—';
          const preview = escapeHtml(
            lastMsg.length > 80 ? `${lastMsg.substring(0, 80)}…` : lastMsg
          );
          const updated = formatDate(conv.updatedAt);
          const statusHtml = formatStatus(conv.status);
          const id = escapeHtml(conv._id || conv.id || '');
          return `<tr class="admin-messenger-row">
          <td class="admin-messenger-cell admin-messenger-cell--participants" title="${names}">${names}</td>
          <td class="admin-messenger-cell"><span class="admin-messenger-type-badge">${type}</span></td>
          <td class="admin-messenger-cell admin-messenger-cell--preview" title="${preview}">${preview}</td>
          <td class="admin-messenger-cell admin-messenger-cell--meta">${updated}</td>
          <td class="admin-messenger-cell">${statusHtml}</td>
          <td class="admin-messenger-cell">
            ${
              id
                ? `<a href="/messenger/?conversation=${id}" target="_blank" rel="noopener"
                      class="admin-messenger-link">Open ↗</a>`
                : '—'
            }
          </td>
        </tr>`;
        })
        .join('');

      updatePagination();
    } catch (err) {
      AdminShared.debugError('Admin messenger: fetch failed', err);
      tbody.innerHTML =
        '<tr><td colspan="6" class="admin-messenger-state admin-messenger-state--error">Failed to load conversations. Please try again.</td></tr>';
    }
  }

  function updatePagination() {
    const totalPages = Math.ceil(totalConversations / PAGE_SIZE) || 1;
    document.getElementById('pageInfo').textContent = `Page ${currentPage + 1} of ${totalPages}`;
    document.getElementById('prevPageBtn').disabled = currentPage === 0;
    document.getElementById('nextPageBtn').disabled = currentPage + 1 >= totalPages;
  }

  // Wire up controls
  document.getElementById('searchBtn').addEventListener('click', () => {
    currentPage = 0;
    currentSearch = document.getElementById('messengerSearch').value;
    currentStatus = document.getElementById('statusFilter').value;
    fetchConversations();
  });

  document.getElementById('messengerSearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      document.getElementById('searchBtn').click();
    }
  });

  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      fetchConversations();
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    currentPage++;
    fetchConversations();
  });

  document.getElementById('navRefreshBtn').addEventListener('click', fetchConversations);

  // Initial load – use readyState check since script is at bottom of body
  // (DOMContentLoaded may have already fired by the time this script runs)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchConversations);
  } else {
    fetchConversations();
  }
})();
