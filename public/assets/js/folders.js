/**
 * EventFlow Folders - Phase 2
 * Custom message folder management UI
 *
 * Features:
 * - Folder tree with nesting (up to 5 levels)
 * - Create/edit/delete folders
 * - Drag-and-drop messages to folders
 * - System folders (Inbox, Sent, Drafts, etc.)
 * - Folder statistics
 * - Context menu
 */

'use strict';
(function () {
  // ==========================================
  // STATE
  // ==========================================

  const state = {
    folders: [],
    systemFolders: [],
    customFolders: [],
    activeFolderId: null,
    isLoading: false,
    draggedMessageIds: [],
    expandedFolders: new Set(JSON.parse(localStorage.getItem('ef_expanded_folders') || '[]')),
  };

  // ==========================================
  // CONSTANTS
  // ==========================================

  const SYSTEM_FOLDER_ICONS = {
    inbox: '📥',
    sent: '📤',
    drafts: '📝',
    starred: '⭐',
    archived: '📦',
    trash: '🗑️',
  };

  const API_BASE = '/api/v2/folders';

  // ==========================================
  // API CALLS
  // ==========================================

  async function apiFetch(url, options = {}) {
    // Check if CSRF handler is available
    if (!window.csrfHandler) {
      console.error('CSRF handler not initialized');
      throw new Error('CSRF handler not available');
    }

    try {
      // Add Content-Type header if not present
      const fetchOptions = {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      };

      // Use CSRF handler's fetch method (includes automatic token handling and retry)
      const response = await window.csrfHandler.fetch(url, fetchOptions);

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: `HTTP ${response.status}`,
        }));
        throw new Error(error.error || error.message || `Request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  async function loadFolders(retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        state.isLoading = true;
        renderFolderList();

        // Ensure CSRF token before API call
        if (window.csrfHandler) {
          await window.csrfHandler.ensureToken();
        }

        const data = await apiFetch(API_BASE);

        if (data.success && Array.isArray(data.folders)) {
          state.folders = data.folders;
          state.systemFolders = data.folders.filter(f => f.isSystemFolder);
          state.customFolders = data.folders.filter(f => !f.isSystemFolder);
          renderFolderList();
        }

        // Success - break out of retry loop
        state.isLoading = false;
        return;
      } catch (error) {
        if (attempt < retries) {
          // Exponential backoff: delay * 2^(attempt-1)
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
        } else {
          // All retries exhausted
          showError('Could not load folders. Please refresh the page.');
        }
      } finally {
        if (attempt === retries) {
          state.isLoading = false;
          renderFolderList();
        }
      }
    }
  }

  async function createFolder(folderData) {
    try {
      const data = await apiFetch(API_BASE, {
        method: 'POST',
        body: JSON.stringify(folderData),
      });

      if (data.success && data.folder) {
        state.folders.push(data.folder);
        state.customFolders.push(data.folder);
        renderFolderList();
        showSuccess('Folder created successfully');
        return data.folder;
      }
    } catch (error) {
      showError(`Failed to create folder: ${error.message}`);
      throw error;
    }
  }

  async function updateFolder(folderId, updates) {
    try {
      const data = await apiFetch(`${API_BASE}/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });

      if (data.success && data.folder) {
        const index = state.folders.findIndex(f => f._id === folderId);
        if (index !== -1) {
          state.folders[index] = data.folder;
          renderFolderList();
          showSuccess('Folder updated successfully');
        }
        return data.folder;
      }
    } catch (error) {
      showError(`Failed to update folder: ${error.message}`);
      throw error;
    }
  }

  async function deleteFolder(folderId) {
    try {
      const data = await apiFetch(`${API_BASE}/${folderId}`, {
        method: 'DELETE',
      });

      if (data.success) {
        state.folders = state.folders.filter(f => f._id !== folderId);
        state.customFolders = state.customFolders.filter(f => f._id !== folderId);
        renderFolderList();
        showSuccess('Folder deleted successfully');
      }
    } catch (error) {
      showError(`Failed to delete folder: ${error.message}`);
      throw error;
    }
  }

  async function moveMessagesToFolder(folderId, messageIds) {
    try {
      const data = await apiFetch(`${API_BASE}/${folderId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ messageIds }),
      });

      if (data.success) {
        showSuccess(`Moved ${messageIds.length} message(s) to folder`);
        // Reload messages if there's a reload function
        if (typeof window.loadMessages === 'function') {
          window.loadMessages();
        }
        // Refresh folder stats
        await loadFolders();
      }
    } catch (error) {
      showError(`Failed to move messages: ${error.message}`);
      throw error;
    }
  }

  async function initializeSystemFolders(retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Ensure CSRF token before API call
        if (window.csrfHandler) {
          await window.csrfHandler.ensureToken();
        }

        const data = await apiFetch(`${API_BASE}/initialize`, {
          method: 'POST',
        });

        if (data.success) {
          await loadFolders();
          showSuccess('System folders initialized');
          return;
        }
      } catch (error) {
        if (attempt < retries) {
          // Exponential backoff: delay * 2^(attempt-1)
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
        } else {
          console.error('Failed to initialize system folders after all retries:', error);
        }
      }
    }
  }

  // ==========================================
  // RENDERING
  // ==========================================

  function renderFolderList() {
    const container = document.getElementById('folder-list');
    if (!container) {
      return;
    }

    if (state.isLoading) {
      container.innerHTML = `
        <div class="folder-loading">
          <div class="spinner"></div>
          <div>Loading folders...</div>
        </div>
      `;
      return;
    }

    if (state.folders.length === 0) {
      container.innerHTML = `
        <div class="folder-empty">
          <p>No folders yet</p>
          <button onclick="window.EF_Folders.showCreateFolderModal()" class="ef-cta btn-primary">
            Create Folder
          </button>
        </div>
      `;
      return;
    }

    const html = `
      <div class="folder-section">
        <div class="folder-section-header">System Folders</div>
        ${state.systemFolders.map(folder => renderFolder(folder)).join('')}
      </div>
      ${
        state.customFolders.length > 0
          ? `
        <div class="folder-section">
          <div class="folder-section-header">
            Custom Folders
            <button onclick="window.EF_Folders.showCreateFolderModal()" class="ef-cta folder-add-btn" title="Add folder">
              +
            </button>
          </div>
          ${renderFolderTree(state.customFolders.filter(f => !f.parentId))}
        </div>
      `
          : `
        <div class="folder-section">
          <div class="folder-section-header">Custom Folders</div>
          <button onclick="window.EF_Folders.showCreateFolderModal()" class="ef-cta folder-create-first">
            + Create your first folder
          </button>
        </div>
      `
      }
    `;

    container.innerHTML = html;
  }

  function renderFolderTree(folders, level = 0) {
    if (!folders || folders.length === 0) {
      return '';
    }

    return folders
      .map(folder => {
        const children = state.customFolders.filter(f => f.parentId === folder._id);
        const hasChildren = children.length > 0;
        const isExpanded = state.expandedFolders.has(folder._id);

        return `
        <div class="folder-item" data-folder-id="${folder._id}" style="padding-left: ${level * 20}px">
          ${
            hasChildren
              ? `
            <button class="ef-cta folder-expand-btn" onclick="window.EF_Folders.toggleFolder('${folder._id}')">
              ${isExpanded ? '▼' : '▶'}
            </button>
          `
              : '<span class="folder-no-expand"></span>'
          }
          <div 
            class="folder-item-content ${state.activeFolderId === folder._id ? 'active' : ''}"
            onclick="window.EF_Folders.selectFolder('${folder._id}')"
            oncontextmenu="window.EF_Folders.showFolderContextMenu(event, '${folder._id}'); return false;"
            data-folder-drop-target="${folder._id}"
          >
            <span class="folder-icon">${folder.icon || '📁'}</span>
            <span class="folder-name">${escapeHtml(folder.name)}</span>
            ${folder.unreadCount > 0 ? `<span class="folder-unread">${folder.unreadCount}</span>` : ''}
            ${folder.messageCount > 0 ? `<span class="folder-count">${folder.messageCount}</span>` : ''}
          </div>
          <button class="ef-cta folder-menu-btn" onclick="window.EF_Folders.showFolderContextMenu(event, '${folder._id}')">
            ⋮
          </button>
        </div>
        ${hasChildren && isExpanded ? renderFolderTree(children, level + 1) : ''}
      `;
      })
      .join('');
  }

  function renderFolder(folder) {
    const isActive = state.activeFolderId === folder._id;
    const icon = folder.isSystemFolder
      ? SYSTEM_FOLDER_ICONS[folder.systemType] || folder.icon
      : folder.icon;

    return `
      <div 
        class="folder-item ${isActive ? 'active' : ''}" 
        data-folder-id="${folder._id}"
        onclick="window.EF_Folders.selectFolder('${folder._id}')"
        data-folder-drop-target="${folder._id}"
      >
        <span class="folder-icon">${icon || '📁'}</span>
        <span class="folder-name">${escapeHtml(folder.name)}</span>
        ${folder.unreadCount > 0 ? `<span class="folder-unread">${folder.unreadCount}</span>` : ''}
        ${folder.messageCount > 0 ? `<span class="folder-count">${folder.messageCount}</span>` : ''}
      </div>
    `;
  }

  // ==========================================
  // MODALS
  // ==========================================

  function showCreateFolderModal(parentId = null) {
    createModal(
      'Create Folder',
      `
      <form id="create-folder-form" class="folder-form">
        <div class="form-group">
          <label for="folder-name">Folder Name *</label>
          <input type="text" id="folder-name" name="name" required maxlength="100" placeholder="e.g., Work, Personal">
        </div>
        
        ${
          parentId
            ? ''
            : `
          <div class="form-group">
            <label for="folder-parent">Parent Folder (optional)</label>
            <select id="folder-parent" name="parentId">
              <option value="">None (top level)</option>
              ${state.customFolders
                .filter(f => !f.parentId)
                .map(
                  f => `
                <option value="${f._id}">${escapeHtml(f.name)}</option>
              `
                )
                .join('')}
            </select>
          </div>
        `
        }
        
        <div class="form-group">
          <label for="folder-icon">Icon (emoji)</label>
          <input type="text" id="folder-icon" name="icon" maxlength="2" placeholder="📁">
        </div>
        
        <div class="form-group">
          <label for="folder-color">Color</label>
          <input type="color" id="folder-color" name="color" value="#3B82F6">
        </div>
        
        <div class="modal-actions">
          <button type="button" onclick="window.EF_Folders.closeModal()" class="ef-cta btn-secondary">Cancel</button>
          <button type="submit" class="ef-cta btn-primary">Create Folder</button>
        </div>
      </form>
    `
    );

    document.getElementById('create-folder-form').addEventListener('submit', async e => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const folderData = {
        name: formData.get('name'),
        parentId: parentId || formData.get('parentId') || null,
        icon: formData.get('icon') || '📁',
        color: formData.get('color') || '#3B82F6',
      };

      try {
        await createFolder(folderData);
        closeModal();
      } catch (error) {
        // Error already shown by createFolder
      }
    });
  }

  function showEditFolderModal(folderId) {
    const folder = state.folders.find(f => f._id === folderId);
    if (!folder || folder.isSystemFolder) {
      return;
    }

    createModal(
      'Edit Folder',
      `
      <form id="edit-folder-form" class="folder-form">
        <div class="form-group">
          <label for="edit-folder-name">Folder Name *</label>
          <input type="text" id="edit-folder-name" name="name" required maxlength="100" value="${escapeHtml(folder.name)}">
        </div>
        
        <div class="form-group">
          <label for="edit-folder-icon">Icon (emoji)</label>
          <input type="text" id="edit-folder-icon" name="icon" maxlength="2" value="${escapeHtml(folder.icon || '')}">
        </div>
        
        <div class="form-group">
          <label for="edit-folder-color">Color</label>
          <input type="color" id="edit-folder-color" name="color" value="${folder.color || '#3B82F6'}">
        </div>
        
        <div class="modal-actions">
          <button type="button" onclick="window.EF_Folders.closeModal()" class="ef-cta btn-secondary">Cancel</button>
          <button type="submit" class="ef-cta btn-primary">Update Folder</button>
        </div>
      </form>
    `
    );

    document.getElementById('edit-folder-form').addEventListener('submit', async e => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const updates = {
        name: formData.get('name'),
        icon: formData.get('icon'),
        color: formData.get('color'),
      };

      try {
        await updateFolder(folderId, updates);
        closeModal();
      } catch (error) {
        // Error already shown
      }
    });
  }

  function showDeleteFolderModal(folderId) {
    const folder = state.folders.find(f => f._id === folderId);
    if (!folder || folder.isSystemFolder) {
      return;
    }

    createModal(
      'Delete Folder',
      `
      <div class="folder-delete-warning">
        <p>Are you sure you want to delete "${escapeHtml(folder.name)}"?</p>
        <p class="warning-text">Messages in this folder will be moved to Inbox.</p>
      </div>
      <div class="modal-actions">
        <button type="button" onclick="window.EF_Folders.closeModal()" class="ef-cta btn-secondary">Cancel</button>
        <button type="button" onclick="window.EF_Folders.confirmDelete('${folderId}')" class="ef-cta btn-danger">Delete Folder</button>
      </div>
    `
    );
  }

  async function confirmDelete(folderId) {
    try {
      await deleteFolder(folderId);
      closeModal();
    } catch (error) {
      // Error already shown
    }
  }

  // ==========================================
  // CONTEXT MENU
  // ==========================================

  function showFolderContextMenu(event, folderId) {
    event.preventDefault();
    event.stopPropagation();

    const folder = state.folders.find(f => f._id === folderId);
    if (!folder) {
      return;
    }

    // Remove existing context menu
    const existing = document.querySelector('.folder-context-menu');
    if (existing) {
      existing.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'folder-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;

    const menuItems = [];

    if (!folder.isSystemFolder) {
      menuItems.push(
        `<div class="context-menu-item" onclick="window.EF_Folders.showEditFolderModal('${folderId}')">✏️ Edit</div>`
      );
      menuItems.push(
        `<div class="context-menu-item" onclick="window.EF_Folders.showCreateFolderModal('${folderId}')">➕ Add Subfolder</div>`
      );
      menuItems.push(`<div class="context-menu-item context-menu-separator"></div>`);
      menuItems.push(
        `<div class="context-menu-item danger" onclick="window.EF_Folders.showDeleteFolderModal('${folderId}')">🗑️ Delete</div>`
      );
    } else {
      menuItems.push(`<div class="context-menu-item disabled">System folder</div>`);
    }

    menu.innerHTML = menuItems.join('');
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

  // ==========================================
  // FOLDER OPERATIONS
  // ==========================================

  function selectFolder(folderId) {
    state.activeFolderId = folderId;
    renderFolderList();

    // Trigger folder change event
    const event = new CustomEvent('folderChanged', { detail: { folderId } });
    document.dispatchEvent(event);

    // If there's a global function to load messages by folder, call it
    if (typeof window.loadMessagesByFolder === 'function') {
      window.loadMessagesByFolder(folderId);
    }
  }

  function toggleFolder(folderId) {
    if (state.expandedFolders.has(folderId)) {
      state.expandedFolders.delete(folderId);
    } else {
      state.expandedFolders.add(folderId);
    }

    // Save to localStorage
    localStorage.setItem('ef_expanded_folders', JSON.stringify([...state.expandedFolders]));

    renderFolderList();
  }

  // ==========================================
  // DRAG AND DROP
  // ==========================================

  function initDragAndDrop() {
    // Message items become draggable
    document.addEventListener('dragstart', e => {
      if (e.target.closest('.message-item')) {
        const messageItem = e.target.closest('.message-item');
        const messageId = messageItem.dataset.messageId;

        // Check if multiple messages are selected
        const selectedMessages = document.querySelectorAll('.message-item.selected');
        if (selectedMessages.length > 1 && messageItem.classList.contains('selected')) {
          state.draggedMessageIds = Array.from(selectedMessages).map(m => m.dataset.messageId);
        } else {
          state.draggedMessageIds = [messageId];
        }

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', state.draggedMessageIds.join(','));
      }
    });

    // Folder items as drop targets
    document.addEventListener('dragover', e => {
      const dropTarget = e.target.closest('[data-folder-drop-target]');
      if (dropTarget && state.draggedMessageIds.length > 0) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dropTarget.classList.add('folder-drop-hover');
      }
    });

    document.addEventListener('dragleave', e => {
      const dropTarget = e.target.closest('[data-folder-drop-target]');
      if (dropTarget) {
        dropTarget.classList.remove('folder-drop-hover');
      }
    });

    document.addEventListener('drop', async e => {
      e.preventDefault();
      const dropTarget = e.target.closest('[data-folder-drop-target]');

      if (dropTarget && state.draggedMessageIds.length > 0) {
        dropTarget.classList.remove('folder-drop-hover');
        const folderId = dropTarget.dataset.folderDropTarget;

        try {
          await moveMessagesToFolder(folderId, state.draggedMessageIds);
        } catch (error) {
          // Error already shown
        }

        state.draggedMessageIds = [];
      }
    });

    document.addEventListener('dragend', () => {
      document.querySelectorAll('.folder-drop-hover').forEach(el => {
        el.classList.remove('folder-drop-hover');
      });
      state.draggedMessageIds = [];
    });
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  function createModal(title, content) {
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${escapeHtml(title)}</h3>
          <button onclick="window.EF_Folders.closeModal()" class="ef-cta modal-close">&times;</button>
        </div>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Close on overlay click
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Close on Escape key
    const escapeHandler = e => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);

    return modal;
  }

  function closeModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
      modal.remove();
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function showSuccess(message) {
    showToast(message, 'success');
  }

  function showError(message) {
    showToast(message, 'error');
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
    // Load folders
    loadFolders();

    // Initialize drag and drop
    initDragAndDrop();

    // Initialize system folders if needed (only on first load)
    if (state.folders.length === 0) {
      setTimeout(() => {
        initializeSystemFolders();
      }, 1000);
    }
  }

  // ==========================================
  // PUBLIC API
  // ==========================================

  window.EF_Folders = {
    init,
    loadFolders,
    selectFolder,
    toggleFolder,
    showCreateFolderModal,
    showEditFolderModal,
    showDeleteFolderModal,
    confirmDelete,
    showFolderContextMenu,
    closeModal,
    moveMessagesToFolder,
    getState: () => ({ ...state }),
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
