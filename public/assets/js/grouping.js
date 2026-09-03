/**
 * EventFlow Grouping - Phase 2
 * Message grouping and organization UI
 *
 * Features:
 * - Group by sender, date, status, label, folder, priority
 * - Expand/collapse groups
 * - Group statistics
 * - Group-level actions
 */

'use strict';
(function () {
  // ==========================================
  // STATE
  // ==========================================

  const state = {
    groupingMethod: localStorage.getItem('ef_grouping_method') || 'none',
    groupedMessages: {},
    expandedGroups: new Set(JSON.parse(localStorage.getItem('ef_expanded_groups') || '[]')),
    isGrouping: false,
  };

  // ==========================================
  // CONSTANTS
  // ==========================================

  const GROUPING_METHODS = {
    none: {
      label: 'No Grouping',
      icon: '📋',
      description: 'Show all messages in a flat list',
    },
    sender: {
      label: 'Group by Sender',
      icon: '👤',
      description: 'Group messages by who sent them',
    },
    date: {
      label: 'Group by Date',
      icon: '📅',
      description: 'Group messages by when they were received',
    },
    status: {
      label: 'Group by Status',
      icon: '🔵',
      description: 'Group by read/unread, starred, etc.',
    },
    label: {
      label: 'Group by Label',
      icon: '🏷️',
      description: 'Group messages by their labels',
    },
    folder: {
      label: 'Group by Folder',
      icon: '📁',
      description: 'Group messages by folder',
    },
    priority: {
      label: 'Group by Priority',
      icon: '⚡',
      description: 'Group by message priority',
    },
  };

  // ==========================================
  // GROUPING LOGIC
  // ==========================================

  function groupMessages(messages, method) {
    if (!messages || messages.length === 0 || method === 'none') {
      return { ungrouped: messages || [] };
    }

    const groups = {};

    messages.forEach(message => {
      let groupKey;

      switch (method) {
        case 'sender':
          groupKey = message.from || message.senderId || 'Unknown Sender';
          break;

        case 'date':
          groupKey = getDateGroup(message.createdAt);
          break;

        case 'status':
          groupKey = getStatusGroup(message);
          break;

        case 'label':
          // Messages can have multiple labels, so add to each label group
          if (message.labels && message.labels.length > 0) {
            message.labels.forEach(label => {
              if (!groups[label]) {
                groups[label] = [];
              }
              groups[label].push(message);
            });
            return; // Skip the default add below
          } else {
            groupKey = 'No Labels';
          }
          break;

        case 'folder':
          groupKey = message.folderName || 'Inbox';
          break;

        case 'priority':
          groupKey = getPriorityGroup(message);
          break;

        default:
          groupKey = 'Other';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(message);
    });

    return groups;
  }

  function getDateGroup(dateString) {
    if (!dateString) {
      return 'Unknown Date';
    }

    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const diffTime = today - messageDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    }
    if (diffDays === 1) {
      return 'Yesterday';
    }
    if (diffDays < 7) {
      return 'This Week';
    }
    if (diffDays < 30) {
      return 'This Month';
    }
    if (diffDays < 365) {
      return 'This Year';
    }

    return date.getFullYear().toString();
  }

  function getStatusGroup(message) {
    if (message.isStarred) {
      return 'Starred';
    }
    if (message.isArchived) {
      return 'Archived';
    }
    if (message.isDraft) {
      return 'Drafts';
    }
    if (!message.isRead) {
      return 'Unread';
    }
    return 'Read';
  }

  function getPriorityGroup(message) {
    if (message.priority === 'high' || message.isUrgent) {
      return 'High Priority';
    }
    if (message.priority === 'low') {
      return 'Low Priority';
    }
    return 'Normal Priority';
  }

  // ==========================================
  // RENDERING
  // ==========================================

  function renderGroupingControls() {
    const container = document.getElementById('grouping-controls');
    if (!container) {
      return;
    }

    const html = `
      <div class="grouping-selector">
        <label for="grouping-method">Group by:</label>
        <select id="grouping-method" onchange="window.EF_Grouping.changeGroupingMethod(this.value)">
          ${Object.entries(GROUPING_METHODS)
            .map(
              ([key, method]) => `
            <option value="${key}" ${state.groupingMethod === key ? 'selected' : ''}>
              ${method.icon} ${method.label}
            </option>
          `
            )
            .join('')}
        </select>
      </div>
      
      ${
        state.groupingMethod !== 'none'
          ? `
        <div class="grouping-actions">
          <button onclick="window.EF_Grouping.expandAll()" class="ef-cta grouping-action-btn" title="Expand all groups">
            ▼ Expand All
          </button>
          <button onclick="window.EF_Grouping.collapseAll()" class="ef-cta grouping-action-btn" title="Collapse all groups">
            ▶ Collapse All
          </button>
        </div>
      `
          : ''
      }
    `;

    container.innerHTML = html;
  }

  function renderGroupedMessages(messages) {
    const container = document.getElementById('messages-container');
    if (!container) {
      // Trigger event for external handler
      const event = new CustomEvent('messagesGrouped', {
        detail: {
          groups: state.groupedMessages,
          method: state.groupingMethod,
        },
      });
      document.dispatchEvent(event);
      return;
    }

    if (state.groupingMethod === 'none') {
      // No grouping - render flat list
      renderFlatMessageList(messages, container);
      return;
    }

    state.groupedMessages = groupMessages(messages, state.groupingMethod);

    const groupKeys = Object.keys(state.groupedMessages);
    if (groupKeys.length === 0) {
      container.innerHTML = '<div class="no-messages">No messages to display</div>';
      return;
    }

    // Sort groups
    const sortedGroupKeys = sortGroupKeys(groupKeys, state.groupingMethod);

    const html = sortedGroupKeys
      .map(groupKey => {
        const groupMessages = state.groupedMessages[groupKey]; // skipcq: JS-0123 - per-group local, unrelated to the groupMessages() function
        const isExpanded = state.expandedGroups.has(groupKey);
        const unreadCount = groupMessages.filter(m => !m.isRead).length;

        return `
        <div class="message-group" data-group-key="${escapeHtml(groupKey)}">
          <div class="message-group-header" onclick="window.EF_Grouping.toggleGroup('${escapeHtml(groupKey)}')">
            <button class="ef-cta group-expand-btn">
              ${isExpanded ? '▼' : '▶'}
            </button>
            <div class="group-header-content">
              <h3 class="group-title">${escapeHtml(groupKey)}</h3>
              <div class="group-stats">
                <span class="group-count">${groupMessages.length} message${groupMessages.length !== 1 ? 's' : ''}</span>
                ${unreadCount > 0 ? `<span class="group-unread">${unreadCount} unread</span>` : ''}
              </div>
            </div>
            <div class="group-actions">
              <button 
                class="ef-cta group-action-btn" 
                onclick="event.stopPropagation(); window.EF_Grouping.markGroupAsRead('${escapeHtml(groupKey)}')"
                title="Mark all as read"
              >
                ✓
              </button>
              <button 
                class="ef-cta group-action-btn" 
                onclick="event.stopPropagation(); window.EF_Grouping.showGroupActions('${escapeHtml(groupKey)}')"
                title="More actions"
              >
                ⋮
              </button>
            </div>
          </div>
          ${
            isExpanded
              ? `
            <div class="message-group-content">
              ${groupMessages.map(message => renderMessage(message)).join('')}
            </div>
          `
              : ''
          }
        </div>
      `;
      })
      .join('');

    container.innerHTML = html;
  }

  function renderFlatMessageList(messages, container) {
    if (!messages || messages.length === 0) {
      container.innerHTML = '<div class="no-messages">No messages to display</div>';
      return;
    }

    const html = `
      <div class="message-list-flat">
        ${messages.map(message => renderMessage(message)).join('')}
      </div>
    `;

    container.innerHTML = html;
  }

  function renderMessage(message) {
    // Simplified message rendering - would integrate with existing message rendering
    return `
      <div class="message-item ${!message.isRead ? 'unread' : ''}" data-message-id="${message._id}">
        <div class="message-sender">${escapeHtml(message.from || 'Unknown')}</div>
        <div class="message-subject">${escapeHtml(message.subject || '(No subject)')}</div>
        <div class="message-date">${formatDate(message.createdAt)}</div>
      </div>
    `;
  }

  function sortGroupKeys(keys, method) {
    if (method === 'date') {
      // Custom date sorting
      const dateOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'This Year'];
      return keys.sort((a, b) => {
        const aIndex = dateOrder.indexOf(a);
        const bIndex = dateOrder.indexOf(b);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) {
          return -1;
        }
        if (bIndex !== -1) {
          return 1;
        }

        // Sort years descending
        return b.localeCompare(a);
      });
    }

    if (method === 'status') {
      const statusOrder = ['Unread', 'Starred', 'Read', 'Drafts', 'Archived'];
      return keys.sort((a, b) => {
        const aIndex = statusOrder.indexOf(a);
        const bIndex = statusOrder.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        return a.localeCompare(b);
      });
    }

    if (method === 'priority') {
      const priorityOrder = ['High Priority', 'Normal Priority', 'Low Priority'];
      return keys.sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a);
        const bIndex = priorityOrder.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        return a.localeCompare(b);
      });
    }

    // Alphabetical for other methods
    return keys.sort((a, b) => a.localeCompare(b));
  }

  // ==========================================
  // GROUP OPERATIONS
  // ==========================================

  function changeGroupingMethod(method) {
    state.groupingMethod = method;
    localStorage.setItem('ef_grouping_method', method);

    // Reset expanded groups when changing method
    state.expandedGroups.clear();
    localStorage.setItem('ef_expanded_groups', JSON.stringify([]));

    renderGroupingControls();

    // Trigger re-render of messages
    const event = new CustomEvent('groupingMethodChanged', {
      detail: { method },
    });
    document.dispatchEvent(event);

    // If there's a global function to reload messages, call it
    if (typeof window.loadMessages === 'function') {
      window.loadMessages();
    }
  }

  function toggleGroup(groupKey) {
    if (state.expandedGroups.has(groupKey)) {
      state.expandedGroups.delete(groupKey);
    } else {
      state.expandedGroups.add(groupKey);
    }

    localStorage.setItem('ef_expanded_groups', JSON.stringify([...state.expandedGroups]));

    // Re-render just this group
    const groupElement = document.querySelector(`[data-group-key="${groupKey}"]`);
    if (groupElement) {
      const isExpanded = state.expandedGroups.has(groupKey);
      const groupMessages = state.groupedMessages[groupKey] || []; // skipcq: JS-0123 - per-group local, unrelated to the groupMessages() function

      const expandBtn = groupElement.querySelector('.group-expand-btn');
      if (expandBtn) {
        expandBtn.textContent = isExpanded ? '▼' : '▶';
      }

      let contentDiv = groupElement.querySelector('.message-group-content');

      if (isExpanded) {
        if (!contentDiv) {
          contentDiv = document.createElement('div');
          contentDiv.className = 'message-group-content';
          groupElement.appendChild(contentDiv);
        }
        contentDiv.innerHTML = groupMessages.map(message => renderMessage(message)).join('');
      } else {
        if (contentDiv) {
          contentDiv.remove();
        }
      }
    }
  }

  function expandAll() {
    const groupKeys = Object.keys(state.groupedMessages);
    state.expandedGroups = new Set(groupKeys);
    localStorage.setItem('ef_expanded_groups', JSON.stringify([...state.expandedGroups]));

    // Trigger re-render
    if (typeof window.loadMessages === 'function') {
      window.loadMessages();
    } else {
      // Re-render groups
      const event = new CustomEvent('expandAllGroups');
      document.dispatchEvent(event);
    }
  }

  function collapseAll() {
    state.expandedGroups.clear();
    localStorage.setItem('ef_expanded_groups', JSON.stringify([]));

    // Trigger re-render
    if (typeof window.loadMessages === 'function') {
      window.loadMessages();
    } else {
      // Re-render groups
      const event = new CustomEvent('collapseAllGroups');
      document.dispatchEvent(event);
    }
  }

  function markGroupAsRead(groupKey) {
    const groupMessages = state.groupedMessages[groupKey]; // skipcq: JS-0123 - per-group local, unrelated to the groupMessages() function
    if (!groupMessages) {
      return;
    }

    const unreadMessages = groupMessages.filter(m => !m.isRead);
    if (unreadMessages.length === 0) {
      showInfo('All messages in this group are already read');
      return;
    }

    const messageIds = unreadMessages.map(m => m._id);

    // Call API to mark messages as read
    if (typeof window.markMessagesAsRead === 'function') {
      window.markMessagesAsRead(messageIds);
      showSuccess(`Marked ${messageIds.length} message(s) as read`);
    } else {
      // Fallback
      showInfo('Mark as read functionality not available');
    }
  }

  function showGroupActions(groupKey) {
    const groupMessages = state.groupedMessages[groupKey]; // skipcq: JS-0123 - per-group local, unrelated to the groupMessages() function
    if (!groupMessages) {
      return;
    }

    // Remove existing menu
    const existing = document.querySelector('.group-context-menu');
    if (existing) {
      existing.remove();
    }

    // Get the group header element to position menu
    const groupHeader = document.querySelector(
      `[data-group-key="${groupKey}"] .message-group-header`
    );
    if (!groupHeader) {
      return;
    }

    const rect = groupHeader.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.className = 'group-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${rect.right - 200}px`;
    menu.style.top = `${rect.bottom}px`;

    menu.innerHTML = `
      <div class="context-menu-item" onclick="window.EF_Grouping.markGroupAsRead('${escapeHtml(groupKey)}')">
        ✓ Mark all as read
      </div>
      <div class="context-menu-item" onclick="window.EF_Grouping.starGroup('${escapeHtml(groupKey)}')">
        ⭐ Star all
      </div>
      <div class="context-menu-item" onclick="window.EF_Grouping.archiveGroup('${escapeHtml(groupKey)}')">
        📦 Archive all
      </div>
      <div class="context-menu-item context-menu-separator"></div>
      <div class="context-menu-item danger" onclick="window.EF_Grouping.deleteGroup('${escapeHtml(groupKey)}')">
        🗑️ Delete all
      </div>
    `;

    document.body.appendChild(menu);

    // Close menu on click outside
    const closeMenu = e => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  function starGroup(groupKey) {
    const groupMessages = state.groupedMessages[groupKey]; // skipcq: JS-0123 - per-group local, unrelated to the groupMessages() function
    if (!groupMessages) {
      return;
    }

    const messageIds = groupMessages.map(m => m._id);

    if (typeof window.starMessages === 'function') {
      window.starMessages(messageIds);
      showSuccess(`Starred ${messageIds.length} message(s)`);
    }
  }

  function archiveGroup(groupKey) {
    const groupMessages = state.groupedMessages[groupKey]; // skipcq: JS-0123 - per-group local, unrelated to the groupMessages() function
    if (!groupMessages) {
      return;
    }

    const messageIds = groupMessages.map(m => m._id);

    if (typeof window.archiveMessages === 'function') {
      window.archiveMessages(messageIds);
      showSuccess(`Archived ${messageIds.length} message(s)`);
    }
  }

  function deleteGroup(groupKey) {
    const groupMessages = state.groupedMessages[groupKey]; // skipcq: JS-0123 - per-group local, unrelated to the groupMessages() function
    if (!groupMessages) {
      return;
    }

    if (!confirm(`Delete all ${groupMessages.length} messages in "${groupKey}"?`)) {
      return;
    }

    const messageIds = groupMessages.map(m => m._id);

    if (typeof window.deleteMessages === 'function') {
      window.deleteMessages(messageIds);
      showSuccess(`Deleted ${messageIds.length} message(s)`);
    }
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function formatDate(dateString) {
    if (!dateString) {
      return '';
    }
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 1) {
      return 'Just now';
    }
    if (hours < 24) {
      return `${hours}h ago`;
    }

    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days}d ago`;
    }

    return date.toLocaleDateString();
  }

  function showSuccess(message) {
    showToast(message, 'success');
  }

  function showInfo(message) {
    showToast(message, 'info');
  }

  function showToast(message, type = 'info') {
    // Use existing toast system if available
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }

    // Fallback simple toast
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  function init() {
    // Render grouping controls
    renderGroupingControls();

    // Auto-expand all groups on first load
    if (state.groupingMethod !== 'none' && state.expandedGroups.size === 0) {
      expandAll();
    }
  }

  // ==========================================
  // PUBLIC API
  // ==========================================

  window.EF_Grouping = {
    init,
    changeGroupingMethod,
    toggleGroup,
    expandAll,
    collapseAll,
    renderGroupedMessages,
    groupMessages,
    markGroupAsRead,
    starGroup,
    archiveGroup,
    deleteGroup,
    showGroupActions,
    getState: () => ({ ...state }),
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
