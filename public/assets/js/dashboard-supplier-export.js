/**
 * Supplier dashboard: export conversations to CSV.
 *
 * Builds the file in the browser from GET /api/v4/messenger/conversations. The server caps a
 * page at 100 conversations (middleware/pagination.js), so the file holds the 100 most recent;
 * the button says so.
 */
(function () {
  const EXPORT_LIMIT = 100;
  const LABEL = 'Export latest 100 conversations (CSV)';

  /** Escapes one CSV cell: doubles quotes and defuses formulas that a spreadsheet would run. */
  function sanitizeCsvCell(value) {
    if (!value) {
      return '';
    }
    const text = String(value);
    // Prevent CSV injection by prefixing dangerous characters
    if (/^[=+\-@]/.test(text)) {
      return `'${text.replace(/"/g, '""')}`;
    }
    return text.replace(/"/g, '""');
  }

  /** Tells the supplier something through the page's single toast. */
  function say(message, type) {
    const home = window.SupplierDashboardHome;
    if (home && typeof home.toast === 'function') {
      home.toast(message, type);
    }
  }

  /** The signed-in user's id, so the other participant and the unread count can be found. */
  async function currentUserId() {
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
      const data = response.ok ? await response.json() : null;
      return data?.user?.id || null;
    } catch {
      return null;
    }
  }

  /** One row of the file per conversation: date, customer, status, last message, unread count. */
  function toRow(conversation, userId) {
    let other = null;
    let mine = null;
    for (const person of conversation.participants || []) {
      if (String(person.userId) === String(userId)) {
        mine = person;
      } else {
        other = person;
      }
    }
    const date = conversation.createdAt
      ? new Date(conversation.createdAt).toISOString().split('T')[0]
      : 'N/A';
    const customer = sanitizeCsvCell(other?.displayName || other?.name || 'Unknown');
    const status = sanitizeCsvCell(conversation.status || 'Open');
    const lastMessage = sanitizeCsvCell(
      String(
        conversation.lastMessagePreview || conversation.lastMessage?.content || 'No messages'
      ).substring(0, 100)
    );
    return [
      `"${date}"`,
      `"${customer}"`,
      `"${status}"`,
      `"${lastMessage}"`,
      mine?.unreadCount || 0,
    ].join(',');
  }

  /** Downloads the CSV text as a file named for today. */
  function download(csvContent) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `conversations-${new Date().toISOString().split('T')[0]}.csv`);
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /** Fetches the latest conversations and downloads them. */
  async function exportConversations(button) {
    const label = button.querySelector('.sd-export-label');
    button.disabled = true;
    if (label) {
      label.textContent = 'Exporting…';
    }
    try {
      const response = await fetch(`/api/v4/messenger/conversations?limit=${EXPORT_LIMIT}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch conversations');
      }
      const data = await response.json();
      const conversations = data.conversations || [];
      if (conversations.length === 0) {
        say('There are no conversations to export yet.', 'info');
        return;
      }
      const userId = await currentUserId();
      const rows = ['Date,Customer,Status,Last Message,Unread'].concat(
        conversations.map(item => toRow(item, userId))
      );
      download(rows.join('\n'));
      say(
        `Exported ${conversations.length} conversation${conversations.length === 1 ? '' : 's'}.`,
        'success'
      );
    } catch (error) {
      console.error('Error exporting conversations:', error);
      say('Could not export your conversations. Please try again.', 'error');
    } finally {
      button.disabled = false;
      if (label) {
        label.textContent = LABEL;
      }
    }
  }

  /** Wires the export button once the page is parsed. */
  function init() {
    const button = document.getElementById('export-enquiries-btn');
    if (button) {
      button.addEventListener('click', () => exportConversations(button));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
