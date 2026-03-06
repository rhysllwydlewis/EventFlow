/**
 * Supplier Dashboard Export Functionality
 * Handles exporting enquiries to CSV format
 * Extracted from inline script to comply with CSP directive
 */

(function () {
  function sanitizeCsvCell(value) {
    if (!value) {
      return '';
    }

    const str = String(value);
    // Prevent CSV injection by prefixing dangerous characters
    if (/^[=+\-@]/.test(str)) {
      return `'${str.replace(/"/g, '""')}`;
    }

    return str.replace(/"/g, '""');
  }

  const exportBtn = document.getElementById('export-enquiries-btn');

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        // Show loading state with proper spinner icon
        exportBtn.disabled = true;
        exportBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><span>Exporting...</span>';

        // Fetch enquiries/conversations
        const response = await fetch('/api/v4/messenger/conversations', { credentials: 'include' });
        if (!response.ok) {
          throw new Error('Failed to fetch enquiries');
        }

        const data = await response.json();
        const conversations = data.conversations || [];

        // Resolve current user ID for per-participant unread counts
        let currentUserId = null;
        try {
          const authRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
          if (authRes.ok) {
            const authData = await authRes.json();
            currentUserId = authData?.user?.id || null;
          }
        } catch (_e) {
          /* ignore */
        }

        // Map v4 conversations to thread-like shape for CSV export
        const threads = conversations.map(conv => {
          let otherParticipant = null;
          let myParticipant = null;
          for (const p of conv.participants || []) {
            if (String(p.userId) === String(currentUserId)) {
              myParticipant = p;
            } else {
              otherParticipant = p;
            }
          }
          return {
            customerName:
              otherParticipant?.displayName || otherParticipant?.name || 'Unknown',
            lastMessage:
              conv.lastMessagePreview || conv.lastMessage?.content || 'No messages',
            status: conv.status || 'Open',
            unreadCount: myParticipant?.unreadCount || 0,
            createdAt: conv.createdAt,
          };
        });

        if (threads.length === 0) {
          if (typeof Toast !== 'undefined') {
            Toast.info('No enquiries to export');
          } else {
            alert('No enquiries to export');
          }
          return;
        }

        // Generate CSV
        const csvRows = [];
        csvRows.push(['Date', 'Customer', 'Status', 'Last Message', 'Unread'].join(','));

        threads.forEach(thread => {
          const date = thread.createdAt
            ? new Date(thread.createdAt).toISOString().split('T')[0]
            : 'N/A';
          const customer = sanitizeCsvCell(thread.customerName || 'Unknown');
          const status = sanitizeCsvCell(thread.status || 'Open');
          const lastMessage = sanitizeCsvCell(
            (thread.lastMessage || 'No messages').substring(0, 100)
          );
          const unread = thread.unreadCount || 0;

          csvRows.push(
            [`"${date}"`, `"${customer}"`, `"${status}"`, `"${lastMessage}"`, unread].join(',')
          );
        });

        const csvContent = csvRows.join('\n');

        // Create download with consistent UTC-based filename
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `enquiries-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Clean up object URL

        if (typeof Toast !== 'undefined') {
          Toast.success(`Exported ${threads.length} enquiries to CSV`);
        }
      } catch (error) {
        console.error('Error exporting enquiries:', error);
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to export enquiries');
        } else {
          alert('Failed to export enquiries');
        }
      } finally {
        // Reset button
        exportBtn.disabled = false;
        exportBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Export CSV</span>';
      }
    });
  }

  // Add spinning animation for loading state
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
})();
