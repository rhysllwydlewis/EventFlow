/**
 * EventFlow Labels - Phase 2
 * Message label/tag management UI
 *
 * Features:
 * - Label picker dropdown
 * - Create/edit/delete labels
 * - Multi-label support
 * - Color customization
 * - Bulk operations
 * - Label filtering
 */

'use strict';
(function () {
  // ==========================================
  // STATE
  // ==========================================

  const state = {
    labels: [],
    selectedMessageIds: [],
    activeFilter: null,
    isLoading: false,
    isPickerOpen: false,
  };

  // ==========================================
  // CONSTANTS
  // ==========================================

  const API_BASE = '/api/v2/labels';

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

  async function loadLabels(retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        state.isLoading = true;
        renderLabelList();

        // Ensure CSRF token before API call
        if (window.csrfHandler) {
          await window.csrfHandler.ensureToken();
        }

        const data = await apiFetch(API_BASE);

        if (data.success && Array.isArray(data.labels)) {
          state.labels = data.labels;
          renderLabelList();
          renderLabelPicker();
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
          showError('Could not load labels. Please refresh the page.');
        }
      } finally {
        if (attempt === retries) {
          state.isLoading = false;
          renderLabelList();
        }
      }
    }
  }

  async function createLabel(labelData) {
    try {
      const data = await apiFetch(API_BASE, {
        method: 'POST',
        body: JSON.stringify(labelData),
      });

      if (data.success && data.label) {
        state.labels.push(data.label);
        renderLabelList();
        renderLabelPicker();
        showSuccess('Label created successfully');
        return data.label;
      }
    } catch (error) {
      showError(`Failed to create label: ${error.message}`);
      throw error;
    }
  }

  async function updateLabel(labelId, updates) {
    try {
      const data = await apiFetch(`${API_BASE}/${labelId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });

      if (data.success && data.label) {
        const index = state.labels.findIndex(l => l._id === labelId);
        if (index !== -1) {
          state.labels[index] = data.label;
          renderLabelList();
          renderLabelPicker();
          showSuccess('Label updated successfully');
        }
        return data.label;
      }
    } catch (error) {
      showError(`Failed to update label: ${error.message}`);
      throw error;
    }
  }

  async function deleteLabel(labelId) {
    try {
      const data = await apiFetch(`${API_BASE}/${labelId}`, {
        method: 'DELETE',
      });

      if (data.success) {
        state.labels = state.labels.filter(l => l._id !== labelId);
        renderLabelList();
        renderLabelPicker();
        showSuccess('Label deleted successfully');
      }
    } catch (error) {
      showError(`Failed to delete label: ${error.message}`);
      throw error;
    }
  }

  async function applyLabelToMessage(labelId, messageId) {
    try {
      const data = await apiFetch(`${API_BASE}/${labelId}/messages/${messageId}`, {
        method: 'POST',
      });

      if (data.success) {
        showSuccess('Label applied');
        // Reload messages
        if (typeof window.loadMessages === 'function') {
          window.loadMessages();
        }
      }
    } catch (error) {
      showError(`Failed to apply label: ${error.message}`);
      throw error;
    }
  }

  async function removeLabelFromMessage(labelId, messageId) {
    try {
      const data = await apiFetch(`${API_BASE}/${labelId}/messages/${messageId}`, {
        method: 'DELETE',
      });

      if (data.success) {
        showSuccess('Label removed');
        // Reload messages
        if (typeof window.loadMessages === 'function') {
          window.loadMessages();
        }
      }
    } catch (error) {
      showError(`Failed to remove label: ${error.message}`);
      throw error;
    }
  }

  async function applyLabelToMessages(labelId, messageIds) {
    try {
      const data = await apiFetch(`${API_BASE}/${labelId}/apply-to-messages`, {
        method: 'POST',
        body: JSON.stringify({ messageIds }),
      });

      if (data.success) {
        showSuccess(`Label applied to ${messageIds.length} message(s)`);
        // Reload messages
        if (typeof window.loadMessages === 'function') {
          window.loadMessages();
        }
        await loadLabels(); // Refresh label stats
      }
    } catch (error) {
      showError(`Failed to apply labels: ${error.message}`);
      throw error;
    }
  }

  async function removeLabelFromMessages(labelId, messageIds) {
    try {
      const data = await apiFetch(`${API_BASE}/${labelId}/remove-from-messages`, {
        method: 'POST',
        body: JSON.stringify({ messageIds }),
      });

      if (data.success) {
        showSuccess(`Label removed from ${messageIds.length} message(s)`);
        // Reload messages
        if (typeof window.loadMessages === 'function') {
          window.loadMessages();
        }
        await loadLabels(); // Refresh label stats
      }
    } catch (error) {
      showError(`Failed to remove labels: ${error.message}`);
      throw error;
    }
  }

  async function initializeDefaultLabels() {
    try {
      const data = await apiFetch(`${API_BASE}/initialize`, {
        method: 'POST',
      });

      if (data.success) {
        await loadLabels();
        showSuccess('Default labels initialized');
      }
    } catch (error) {
      console.error('Failed to initialize default labels:', error);
    }
  }

  // ==========================================
  // RENDERING
  // ==========================================

  function renderLabelList() {
    const container = document.getElementById('label-list');
    if (!container) {
      return;
    }

    if (state.isLoading) {
      container.innerHTML = `
        <div class="label-loading">
          <div class="spinner"></div>
          <div>Loading labels...</div>
        </div>
      `;
      return;
    }

    if (state.labels.length === 0) {
      container.innerHTML = `
        <div class="label-empty">
          <p>No labels yet</p>
          <button onclick="window.EF_Labels.showCreateLabelModal()" class="ef-cta btn-primary">
            Create Label
          </button>
        </div>
      `;
      return;
    }

    const html = `
      <div class="label-filter-header">
        <h3>Filter by Label</h3>
        <button onclick="window.EF_Labels.showCreateLabelModal()" class="ef-cta label-add-btn" title="Add label">
          +
        </button>
      </div>
      <div class="label-filter-list">
        <div 
          class="label-filter-item ${state.activeFilter === null ? 'active' : ''}"
          onclick="window.EF_Labels.filterByLabel(null)"
        >
          <span class="label-filter-icon">📋</span>
          <span class="label-filter-name">All Messages</span>
        </div>
        ${state.labels.map(label => renderLabelFilter(label)).join('')}
      </div>
    `;

    container.innerHTML = html;
  }

  function renderLabelFilter(label) {
    const isActive = state.activeFilter === label._id;
    const bgColor = label.backgroundColor || '#E5E7EB';
    const textColor = label.color || '#1F2937';

    return `
      <div 
        class="label-filter-item ${isActive ? 'active' : ''}"
        onclick="window.EF_Labels.filterByLabel('${label._id}')"
        oncontextmenu="window.EF_Labels.showLabelContextMenu(event, '${label._id}'); return false;"
      >
        <span class="label-filter-badge" style="background: ${bgColor}; color: ${textColor};">
          ${label.icon ? `${label.icon} ` : ''}${escapeHtml(label.name)}
        </span>
        ${label.messageCount > 0 ? `<span class="label-filter-count">${label.messageCount}</span>` : ''}
        <button class="ef-cta label-menu-btn" onclick="event.stopPropagation(); window.EF_Labels.showLabelContextMenu(event, '${label._id}')">
          ⋮
        </button>
      </div>
    `;
  }

  function renderLabelPicker() {
    const picker = document.getElementById('label-picker-dropdown');
    if (!picker) {
      return;
    }

    const html = `
      <div class="label-picker-search">
        <input type="text" id="label-search" placeholder="Search labels..." oninput="window.EF_Labels.filterLabelPicker(this.value)">
      </div>
      <div class="label-picker-list" id="label-picker-list">
        ${state.labels.map(label => renderLabelPickerItem(label)).join('')}
      </div>
      <div class="label-picker-footer">
        <button onclick="window.EF_Labels.showCreateLabelModal(); window.EF_Labels.closeLabelPicker();" class="ef-cta label-picker-create">
          + Create New Label
        </button>
      </div>
    `;

    picker.innerHTML = html;
  }

  function renderLabelPickerItem(label) {
    const bgColor = label.backgroundColor || '#E5E7EB';
    const textColor = label.color || '#1F2937';

    return `
      <div class="label-picker-item" data-label-id="${label._id}" data-label-name="${escapeHtml(label.name).toLowerCase()}">
        <label class="label-picker-checkbox">
          <input 
            type="checkbox" 
            value="${label._id}"
            onchange="window.EF_Labels.toggleLabel('${label._id}', this.checked)"
          >
          <span class="label-badge" style="background: ${bgColor}; color: ${textColor};">
            ${label.icon ? `${label.icon} ` : ''}${escapeHtml(label.name)}
          </span>
        </label>
      </div>
    `;
  }

  function renderMessageLabels(labels, messageId) {
    if (!labels || labels.length === 0) {
      return '';
    }

    return `
      <div class="message-labels">
        ${labels
          .map(labelId => {
            const label = state.labels.find(l => l._id === labelId);
            if (!label) {
              return '';
            }
            const bgColor = label.backgroundColor || '#E5E7EB';
            const textColor = label.color || '#1F2937';
            return `
            <span class="message-label" style="background: ${bgColor}; color: ${textColor};">
              ${label.icon ? `${label.icon} ` : ''}${escapeHtml(label.name)}
              <button 
                class="ef-cta message-label-remove" 
                onclick="event.stopPropagation(); window.EF_Labels.removeLabelFromMessage('${labelId}', '${messageId}')"
                title="Remove label"
              >
                ×
              </button>
            </span>
          `;
          })
          .join('')}
      </div>
    `;
  }

  // ==========================================
  // LABEL PICKER
  // ==========================================

  function openLabelPicker(messageIds) {
    state.selectedMessageIds = Array.isArray(messageIds) ? messageIds : [messageIds];
    state.isPickerOpen = true;

    const picker = document.getElementById('label-picker');
    if (picker) {
      picker.style.display = 'block';
      renderLabelPicker();

      // Mark currently applied labels
      if (state.selectedMessageIds.length === 1) {
        // Get message labels and check them
        // This would require message data - simplified for now
      }
    }
  }

  function closeLabelPicker() {
    state.isPickerOpen = false;
    const picker = document.getElementById('label-picker');
    if (picker) {
      picker.style.display = 'none';
    }
    state.selectedMessageIds = [];
  }

  function filterLabelPicker(searchText) {
    const items = document.querySelectorAll('.label-picker-item');
    const search = searchText.toLowerCase();

    items.forEach(item => {
      const name = item.dataset.labelName;
      item.style.display = name.includes(search) ? 'block' : 'none';
    });
  }

  function toggleLabel(labelId, checked) {
    if (state.selectedMessageIds.length === 0) {
      return;
    }

    if (checked) {
      applyLabelToMessages(labelId, state.selectedMessageIds);
    } else {
      removeLabelFromMessages(labelId, state.selectedMessageIds);
    }
  }

  // ==========================================
  // MODALS
  // ==========================================

  function showCreateLabelModal() {
    createModal(
      'Create Label',
      `
      <form id="create-label-form" class="label-form">
        <div class="form-group">
          <label for="label-name">Label Name *</label>
          <input type="text" id="label-name" name="name" required maxlength="100" placeholder="e.g., Urgent, Important">
        </div>
        
        <div class="form-group">
          <label for="label-icon">Icon (emoji)</label>
          <input type="text" id="label-icon" name="icon" maxlength="2" placeholder="🏷️">
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label for="label-bg-color">Background Color</label>
            <input type="color" id="label-bg-color" name="backgroundColor" value="#E5E7EB">
          </div>
          
          <div class="form-group">
            <label for="label-text-color">Text Color</label>
            <input type="color" id="label-text-color" name="color" value="#1F2937">
          </div>
        </div>
        
        <div class="label-preview">
          <span id="label-preview-badge" class="label-badge" style="background: #E5E7EB; color: #1F2937;">
            <span id="preview-icon"></span><span id="preview-name">Preview</span>
          </span>
        </div>
        
        <div class="modal-actions">
          <button type="button" onclick="window.EF_Labels.closeModal()" class="ef-cta btn-secondary">Cancel</button>
          <button type="submit" class="ef-cta btn-primary">Create Label</button>
        </div>
      </form>
    `
    );

    // Live preview
    const form = document.getElementById('create-label-form');
    const previewBadge = document.getElementById('label-preview-badge');
    const previewIcon = document.getElementById('preview-icon');
    const previewName = document.getElementById('preview-name');

    form.addEventListener('input', _e => {
      const name = document.getElementById('label-name').value || 'Preview';
      const icon = document.getElementById('label-icon').value;
      const bgColor = document.getElementById('label-bg-color').value;
      const textColor = document.getElementById('label-text-color').value;

      previewBadge.style.background = bgColor;
      previewBadge.style.color = textColor;
      previewIcon.textContent = icon ? `${icon} ` : '';
      previewName.textContent = name;
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const labelData = {
        name: formData.get('name'),
        icon: formData.get('icon') || '',
        backgroundColor: formData.get('backgroundColor'),
        color: formData.get('color'),
      };

      try {
        await createLabel(labelData);
        closeModal();
      } catch (error) {
        // Error already shown
      }
    });
  }

  function showEditLabelModal(labelId) {
    const label = state.labels.find(l => l._id === labelId);
    if (!label) {
      return;
    }

    createModal(
      'Edit Label',
      `
      <form id="edit-label-form" class="label-form">
        <div class="form-group">
          <label for="edit-label-name">Label Name *</label>
          <input type="text" id="edit-label-name" name="name" required maxlength="100" value="${escapeHtml(label.name)}">
        </div>
        
        <div class="form-group">
          <label for="edit-label-icon">Icon (emoji)</label>
          <input type="text" id="edit-label-icon" name="icon" maxlength="2" value="${escapeHtml(label.icon || '')}">
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label for="edit-label-bg-color">Background Color</label>
            <input type="color" id="edit-label-bg-color" name="backgroundColor" value="${label.backgroundColor || '#E5E7EB'}">
          </div>
          
          <div class="form-group">
            <label for="edit-label-text-color">Text Color</label>
            <input type="color" id="edit-label-text-color" name="color" value="${label.color || '#1F2937'}">
          </div>
        </div>
        
        <div class="label-preview">
          <span id="edit-label-preview-badge" class="label-badge" style="background: ${label.backgroundColor || '#E5E7EB'}; color: ${label.color || '#1F2937'};">
            <span id="edit-preview-icon">${label.icon ? `${label.icon} ` : ''}</span><span id="edit-preview-name">${escapeHtml(label.name)}</span>
          </span>
        </div>
        
        <div class="modal-actions">
          <button type="button" onclick="window.EF_Labels.closeModal()" class="ef-cta btn-secondary">Cancel</button>
          <button type="submit" class="ef-cta btn-primary">Update Label</button>
        </div>
      </form>
    `
    );

    // Live preview
    const form = document.getElementById('edit-label-form');
    const previewBadge = document.getElementById('edit-label-preview-badge');
    const previewIcon = document.getElementById('edit-preview-icon');
    const previewName = document.getElementById('edit-preview-name');

    form.addEventListener('input', _e => {
      const name = document.getElementById('edit-label-name').value;
      const icon = document.getElementById('edit-label-icon').value;
      const bgColor = document.getElementById('edit-label-bg-color').value;
      const textColor = document.getElementById('edit-label-text-color').value;

      previewBadge.style.background = bgColor;
      previewBadge.style.color = textColor;
      previewIcon.textContent = icon ? `${icon} ` : '';
      previewName.textContent = name;
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const updates = {
        name: formData.get('name'),
        icon: formData.get('icon'),
        backgroundColor: formData.get('backgroundColor'),
        color: formData.get('color'),
      };

      try {
        await updateLabel(labelId, updates);
        closeModal();
      } catch (error) {
        // Error already shown
      }
    });
  }

  function showDeleteLabelModal(labelId) {
    const label = state.labels.find(l => l._id === labelId);
    if (!label) {
      return;
    }

    createModal(
      'Delete Label',
      `
      <div class="label-delete-warning">
        <p>Are you sure you want to delete the label "${escapeHtml(label.name)}"?</p>
        <p class="warning-text">This label will be removed from all messages.</p>
      </div>
      <div class="modal-actions">
        <button type="button" onclick="window.EF_Labels.closeModal()" class="ef-cta btn-secondary">Cancel</button>
        <button type="button" onclick="window.EF_Labels.confirmDelete('${labelId}')" class="ef-cta btn-danger">Delete Label</button>
      </div>
    `
    );
  }

  async function confirmDelete(labelId) {
    try {
      await deleteLabel(labelId);
      closeModal();
    } catch (error) {
      // Error already shown
    }
  }

  // ==========================================
  // CONTEXT MENU
  // ==========================================

  function showLabelContextMenu(event, labelId) {
    event.preventDefault();
    event.stopPropagation();

    const label = state.labels.find(l => l._id === labelId);
    if (!label) {
      return;
    }

    // Remove existing context menu
    const existing = document.querySelector('.label-context-menu');
    if (existing) {
      existing.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'label-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;

    menu.innerHTML = `
      <div class="context-menu-item" onclick="window.EF_Labels.showEditLabelModal('${labelId}')">✏️ Edit</div>
      <div class="context-menu-item context-menu-separator"></div>
      <div class="context-menu-item danger" onclick="window.EF_Labels.showDeleteLabelModal('${labelId}')">🗑️ Delete</div>
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

  // ==========================================
  // LABEL OPERATIONS
  // ==========================================

  function filterByLabel(labelId) {
    state.activeFilter = labelId;
    renderLabelList();

    // Trigger label filter event
    const event = new CustomEvent('labelFilterChanged', { detail: { labelId } });
    document.dispatchEvent(event);

    // If there's a global function to filter messages by label, call it
    if (typeof window.filterMessagesByLabel === 'function') {
      window.filterMessagesByLabel(labelId);
    }
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
          <button onclick="window.EF_Labels.closeModal()" class="ef-cta modal-close">&times;</button>
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
    // Load labels
    loadLabels();

    // Initialize default labels if needed
    if (state.labels.length === 0) {
      setTimeout(() => {
        initializeDefaultLabels();
      }, 1000);
    }

    // Close label picker when clicking outside
    document.addEventListener('click', e => {
      const picker = document.getElementById('label-picker');
      const pickerBtn = document.querySelector('[data-label-picker-trigger]');

      if (
        state.isPickerOpen &&
        picker &&
        !picker.contains(e.target) &&
        !pickerBtn?.contains(e.target)
      ) {
        closeLabelPicker();
      }
    });
  }

  // ==========================================
  // PUBLIC API
  // ==========================================

  window.EF_Labels = {
    init,
    loadLabels,
    filterByLabel,
    openLabelPicker,
    closeLabelPicker,
    filterLabelPicker,
    toggleLabel,
    showCreateLabelModal,
    showEditLabelModal,
    showDeleteLabelModal,
    confirmDelete,
    showLabelContextMenu,
    closeModal,
    applyLabelToMessage,
    removeLabelFromMessage,
    renderMessageLabels,
    getState: () => ({ ...state }),
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
