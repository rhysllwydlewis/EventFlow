/**
 * EventFlow Timeline Builder Component
 * Interactive drag-and-drop timeline for event planning
 */

class TimelineBuilder {
  constructor(options = {}) {
    this.options = {
      container: options.container || '#timeline-builder',
      events: options.events || [],
      editable: options.editable !== false,
      onEventAdd: options.onEventAdd || null,
      onEventUpdate: options.onEventUpdate || null,
      onEventDelete: options.onEventDelete || null,
      onEventMove: options.onEventMove || null,
    };

    this.container = null;
    this.timeline = null;
    this.draggedElement = null;
    this.timelineData = this.options.events;

    this.init();
  }

  init() {
    const containerEl =
      typeof this.options.container === 'string'
        ? document.querySelector(this.options.container)
        : this.options.container;

    if (!containerEl) {
      console.error('Timeline container not found');
      return;
    }

    this.container = containerEl;
    this.render();
    this.attachEventListeners();
    this.injectStyles();
  }

  render() {
    this.container.innerHTML = `
      <div class="timeline-builder">
        <div class="timeline-header">
          <h2>Event Timeline</h2>
          ${
            this.options.editable
              ? `
            <button class="btn btn-primary" id="add-timeline-event">
              <span>+ Add Event</span>
            </button>
          `
              : ''
          }
        </div>
        <div class="timeline-container">
          <div class="timeline-line"></div>
          <div class="timeline-events" id="timeline-events">
            ${this.renderEvents()}
          </div>
        </div>
      </div>
    `;

    this.timeline = this.container.querySelector('.timeline-events');
  }

  renderEvents() {
    if (!this.timelineData || this.timelineData.length === 0) {
      return `
        <div class="timeline-empty">
          <p>No events scheduled yet. Add your first event to get started!</p>
        </div>
      `;
    }

    // Sort events by time
    const sortedEvents = [...this.timelineData].sort((a, b) => {
      const timeA = new Date(a.time || a.date).getTime();
      const timeB = new Date(b.time || b.date).getTime();
      return timeA - timeB;
    });

    return sortedEvents.map((event, index) => this.renderEvent(event, index)).join('');
  }

  renderEvent(event, index) {
    const time = this.formatTime(event.time || event.date);
    const duration = event.duration || '1h';
    const category = event.category || 'general';
    const color = this.getCategoryColor(category);

    return `
      <div class="timeline-event ${this.options.editable ? 'draggable' : ''}" 
           data-id="${event.id || index}" 
           data-category="${category}"
           draggable="${this.options.editable}"
           style="border-left-color: ${color}">
        <div class="timeline-event-time">${time}</div>
        <div class="timeline-event-content">
          <div class="timeline-event-header">
            <h3 class="timeline-event-title">${this.escapeHtml(event.title)}</h3>
            <span class="timeline-event-duration">${duration}</span>
          </div>
          ${
            event.description
              ? `
            <p class="timeline-event-description">${this.escapeHtml(event.description)}</p>
          `
              : ''
          }
          ${
            event.supplier
              ? `
            <div class="timeline-event-supplier">
              <span class="supplier-badge">${this.escapeHtml(event.supplier)}</span>
            </div>
          `
              : ''
          }
        </div>
        ${
          this.options.editable
            ? `
          <div class="timeline-event-actions">
            <button class="btn-icon" data-action="edit" data-id="${event.id || index}" title="Edit">
              ✏️
            </button>
            <button class="btn-icon" data-action="delete" data-id="${event.id || index}" title="Delete">
              🗑️
            </button>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  attachEventListeners() {
    // Add event button
    const addBtn = this.container.querySelector('#add-timeline-event');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.showEventModal());
    }

    // Event actions (edit, delete)
    this.container.addEventListener('click', e => {
      const action = e.target.closest('[data-action]');
      if (action) {
        const eventId = action.dataset.id;
        const actionType = action.dataset.action;

        if (actionType === 'edit') {
          this.editEvent(eventId);
        } else if (actionType === 'delete') {
          this.deleteEvent(eventId);
        }
      }
    });

    // Drag and drop
    if (this.options.editable) {
      this.setupDragAndDrop();
    }
  }

  setupDragAndDrop() {
    this.container.addEventListener('dragstart', e => {
      if (e.target.classList.contains('timeline-event')) {
        this.draggedElement = e.target;
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    this.container.addEventListener('dragend', e => {
      if (e.target.classList.contains('timeline-event')) {
        e.target.classList.remove('dragging');
        this.draggedElement = null;
      }
    });

    this.container.addEventListener('dragover', e => {
      e.preventDefault();
      const afterElement = this.getDragAfterElement(e.clientY);
      const dragging = this.container.querySelector('.dragging');

      if (dragging && this.timeline) {
        if (afterElement === null) {
          this.timeline.appendChild(dragging);
        } else {
          this.timeline.insertBefore(dragging, afterElement);
        }
      }
    });

    this.container.addEventListener('drop', e => {
      e.preventDefault();
      this.reorderEvents();
    });
  }

  getDragAfterElement(y) {
    const draggableElements = [...this.timeline.querySelectorAll('.timeline-event:not(.dragging)')];

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  }

  reorderEvents() {
    const eventElements = [...this.timeline.querySelectorAll('.timeline-event')];
    const newOrder = eventElements.map(el => el.dataset.id);

    // Reorder timelineData based on new DOM order
    this.timelineData = newOrder
      .map(id => {
        return this.timelineData.find(
          e => String(e.id) === id || String(this.timelineData.indexOf(e)) === id
        );
      })
      .filter(Boolean);

    if (this.options.onEventMove) {
      this.options.onEventMove(this.timelineData);
    }
  }

  showEventModal(event = null) {
    const isEdit = !!event;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit Event' : 'Add Event'}</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <form id="event-form" class="modal-body">
          <div class="form-group">
            <label for="event-title">Event Title *</label>
            <input type="text" id="event-title" name="title" required value="${event ? this.escapeHtml(event.title) : ''}">
          </div>
          <div class="form-group">
            <label for="event-time">Time *</label>
            <input type="datetime-local" id="event-time" name="time" required value="${event ? this.formatDateTimeLocal(event.time) : ''}">
          </div>
          <div class="form-group">
            <label for="event-duration">Duration</label>
            <input type="text" id="event-duration" name="duration" placeholder="e.g., 2h, 30min" value="${event ? event.duration : ''}">
          </div>
          <div class="form-group">
            <label for="event-category">Category</label>
            <select id="event-category" name="category">
              <option value="general" ${event?.category === 'general' ? 'selected' : ''}>General</option>
              <option value="ceremony" ${event?.category === 'ceremony' ? 'selected' : ''}>Ceremony</option>
              <option value="reception" ${event?.category === 'reception' ? 'selected' : ''}>Reception</option>
              <option value="catering" ${event?.category === 'catering' ? 'selected' : ''}>Catering</option>
              <option value="entertainment" ${event?.category === 'entertainment' ? 'selected' : ''}>Entertainment</option>
              <option value="photography" ${event?.category === 'photography' ? 'selected' : ''}>Photography</option>
              <option value="other" ${event?.category === 'other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="form-group">
            <label for="event-description">Description</label>
            <textarea id="event-description" name="description" rows="3">${event ? this.escapeHtml(event.description || '') : ''}</textarea>
          </div>
          <div class="form-group">
            <label for="event-supplier">Supplier (optional)</label>
            <input type="text" id="event-supplier" name="supplier" value="${event ? this.escapeHtml(event.supplier || '') : ''}">
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Add'} Event</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle form submission
    const form = modal.querySelector('#event-form');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const formData = new FormData(form);
      const eventData = {
        id: event?.id || Date.now().toString(),
        title: formData.get('title'),
        time: formData.get('time'),
        duration: formData.get('duration'),
        category: formData.get('category'),
        description: formData.get('description'),
        supplier: formData.get('supplier'),
      };

      if (isEdit) {
        this.updateEvent(event.id, eventData);
      } else {
        this.addEvent(eventData);
      }

      modal.remove();
    });

    // Close on overlay click
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  addEvent(eventData) {
    this.timelineData.push(eventData);
    this.render();
    this.attachEventListeners();

    if (this.options.onEventAdd) {
      this.options.onEventAdd(eventData);
    }
  }

  updateEvent(eventId, eventData) {
    const index = this.timelineData.findIndex(e => e.id === eventId);
    if (index !== -1) {
      this.timelineData[index] = { ...this.timelineData[index], ...eventData };
      this.render();
      this.attachEventListeners();

      if (this.options.onEventUpdate) {
        this.options.onEventUpdate(eventData);
      }
    }
  }

  editEvent(eventId) {
    const event = this.timelineData.find(
      e =>
        String(e.id) === String(eventId) || String(this.timelineData.indexOf(e)) === String(eventId)
    );
    if (event) {
      this.showEventModal(event);
    }
  }

  deleteEvent(eventId) {
    if (confirm('Are you sure you want to delete this event?')) {
      this.timelineData = this.timelineData.filter(
        e =>
          String(e.id) !== String(eventId) &&
          String(this.timelineData.indexOf(e)) !== String(eventId)
      );
      this.render();
      this.attachEventListeners();

      if (this.options.onEventDelete) {
        this.options.onEventDelete(eventId);
      }
    }
  }

  formatTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatDateTimeLocal(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  getCategoryColor(category) {
    const colors = {
      general: '#94A3B8',
      ceremony: '#0B8073',
      reception: '#13B6A2',
      catering: '#F59E0B',
      entertainment: '#8B5CF6',
      photography: '#EC4899',
      other: '#6B7280',
    };
    return colors[category] || colors.general;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  injectStyles() {
    if (document.getElementById('timeline-builder-styles')) {
      return;
    }

    const styles = document.createElement('style');
    styles.id = 'timeline-builder-styles';
    styles.textContent = `
      .timeline-builder {
        max-width: 900px;
        margin: 0 auto;
        padding: 20px;
      }

      .timeline-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
      }

      .timeline-header h2 {
        margin: 0;
      }

      .timeline-container {
        position: relative;
        padding-left: 40px;
      }

      .timeline-line {
        position: absolute;
        left: 15px;
        top: 0;
        bottom: 0;
        width: 2px;
        background: linear-gradient(to bottom, var(--ink, #0B8073), var(--accent, #13B6A2));
      }

      .timeline-events {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .timeline-event {

      .timeline-event::before {

      .timeline-event.draggable {
        cursor: move;
      }

      .timeline-event.dragging {
        opacity: 0.5;
      }

      .timeline-event:hover {
        transform: translateX(4px);
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
      }

      .timeline-event-time {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--ink, #0B8073);
        margin-bottom: 8px;
      }

      .timeline-event-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 8px;
      }

      .timeline-event-title {

      .timeline-event-duration {
        font-size: 0.875rem;
        color: #64748B;
        white-space: nowrap;
      }

      .timeline-event-description {

      .timeline-event-supplier {
        margin-top: 12px;
      }

      .supplier-badge {
        display: inline-block;
        padding: 4px 12px;
        background: rgba(11, 128, 115, 0.1);
        color: var(--ink, #0B8073);
        border-radius: 12px;
        font-size: 0.875rem;
        font-weight: 500;
      }

      .timeline-event-actions {
        position: absolute;
        top: 16px;
        right: 16px;
        display: flex;
        gap: 8px;
      }

      .btn-icon {
        background: none;
        border: none;
        padding: 6px;
        cursor: pointer;
        border-radius: 6px;
        transition: background 0.2s;
        font-size: 1rem;
      }

      .btn-icon:hover {
        background: rgba(148, 163, 184, 0.1);
      }

      .timeline-empty {
        text-align: center;
        padding: 60px 20px;
        color: #64748B;
      }

      @media (max-width: 640px) {
        .timeline-container {
          padding-left: 30px;
        }

        .timeline-line {
          left: 10px;
        }

        .timeline-event::before {
          left: -34px;
        }

        .timeline-event {
          padding: 16px;
        }

        .timeline-event-actions {
          position: static;
          margin-top: 12px;
          justify-content: flex-end;
        }
      }
    `;
    document.head.appendChild(styles);
  }

  getData() {
    return this.timelineData;
  }

  setData(events) {
    this.timelineData = events;
    this.render();
    this.attachEventListeners();
  }

  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TimelineBuilder;
}
