/**
 * Advanced Admin Dashboard Features
 * Real-time updates, charts, notifications, and more
 */

(function () {
  'use strict';

  // HTML escaping utility
  function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
  }

  // Notification System - Use Centralized EventFlowNotifications
  // This maintains backward compatibility for existing admin panel code
  // that uses window.Notifications
  window.Notifications = {
    show: function (message, type, duration) {
      // Ensure EventFlowNotifications is loaded
      if (typeof window.EventFlowNotifications === 'undefined') {
        console.error('EventFlowNotifications not loaded. Please include notification-system.js');
        return null;
      }
      return window.EventFlowNotifications.show(message, type || 'info', duration);
    },
    success: function (message, duration) {
      if (typeof window.EventFlowNotifications === 'undefined') {
        console.error('EventFlowNotifications not loaded. Please include notification-system.js');
        return null;
      }
      return window.EventFlowNotifications.success(message, duration);
    },
    error: function (message, duration) {
      if (typeof window.EventFlowNotifications === 'undefined') {
        console.error('EventFlowNotifications not loaded. Please include notification-system.js');
        return null;
      }
      return window.EventFlowNotifications.error(message, duration);
    },
    warning: function (message, duration) {
      if (typeof window.EventFlowNotifications === 'undefined') {
        console.error('EventFlowNotifications not loaded. Please include notification-system.js');
        return null;
      }
      return window.EventFlowNotifications.warning(message, duration);
    },
    info: function (message, duration) {
      if (typeof window.EventFlowNotifications === 'undefined') {
        console.error('EventFlowNotifications not loaded. Please include notification-system.js');
        return null;
      }
      return window.EventFlowNotifications.info(message, duration);
    },
  };

  // Keyboard Shortcuts
  class KeyboardShortcuts {
    constructor() {
      this.shortcuts = new Map();
      this.setup();
    }

    setup() {
      document.addEventListener('keydown', e => {
        // Don't intercept typing in form fields
        const tag = (e.target.tagName || '').toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable) {
          return;
        }
        const key = this.getKeyCombo(e);
        const handler = this.shortcuts.get(key);
        if (handler) {
          e.preventDefault();
          handler(e);
        }
      });

      // Register default shortcuts
      this.register('ctrl+k', () => this.showCommandPalette());
      this.register('ctrl+/', () => this.showShortcutsHelp());
      this.register('r', () => window.location.reload());
      this.register('h', () => (window.location.href = '/admin'));
      this.register('u', () => (window.location.href = '/admin-users'));
      this.register('p', () => (window.location.href = '/admin-packages'));
      this.register('s', () => (window.location.href = '/admin-settings'));
    }

    getKeyCombo(e) {
      const parts = [];
      if (e.ctrlKey) {
        parts.push('ctrl');
      }
      if (e.altKey) {
        parts.push('alt');
      }
      if (e.shiftKey) {
        parts.push('shift');
      }
      if (e.metaKey) {
        parts.push('meta');
      }

      const key = (e.key || '').toLowerCase();
      if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
        parts.push(key);
      }

      return parts.join('+');
    }

    register(combo, handler) {
      this.shortcuts.set(combo, handler);
    }

    showCommandPalette() {
      Notifications.info('Command Palette (Coming Soon)<br>Search for actions, pages, and more...');
    }

    showShortcutsHelp() {
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
      `;
      modal.innerHTML = `
        <div style="background: white; padding: 2rem; border-radius: 16px; max-width: 600px; max-height: 80vh; overflow: auto;">
          <h2 style="margin: 0 0 1.5rem 0;">Keyboard Shortcuts</h2>
          <div style="display: grid; gap: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Command Palette</span>
              <kbd style="padding: 4px 8px; background: #f3f4f6; border-radius: 4px; font-size: 12px;">Ctrl+K</kbd>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Show Shortcuts</span>
              <kbd style="padding: 4px 8px; background: #f3f4f6; border-radius: 4px; font-size: 12px;">Ctrl+/</kbd>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Refresh Page</span>
              <kbd style="padding: 4px 8px; background: #f3f4f6; border-radius: 4px; font-size: 12px;">R</kbd>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Go to Dashboard</span>
              <kbd style="padding: 4px 8px; background: #f3f4f6; border-radius: 4px; font-size: 12px;">H</kbd>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Go to Users</span>
              <kbd style="padding: 4px 8px; background: #f3f4f6; border-radius: 4px; font-size: 12px;">U</kbd>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Go to Packages</span>
              <kbd style="padding: 4px 8px; background: #f3f4f6; border-radius: 4px; font-size: 12px;">P</kbd>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>Go to Settings</span>
              <kbd style="padding: 4px 8px; background: #f3f4f6; border-radius: 4px; font-size: 12px;">S</kbd>
            </div>
          </div>
          <button class="modal-close-button" style="margin-top: 1.5rem; width: 100%; padding: 0.75rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Close</button>
        </div>
      `;

      // Add close button handler
      const closeBtn = modal.querySelector('.modal-close-button');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          modal.remove();
        });
      }

      modal.addEventListener('click', e => {
        if (e.target === modal) {
          modal.remove();
        }
      });
      document.body.appendChild(modal);
    }
  }

  window.Shortcuts = new KeyboardShortcuts();

  // Real-time Dashboard Updates
  class DashboardUpdater {
    constructor() {
      this.interval = null;
      this.updateFrequency = 30000; // 30 seconds
    }

    start() {
      this.update();
      this.interval = setInterval(() => this.update(), this.updateFrequency);
    }

    stop() {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
    }

    async update() {
      try {
        // Update badge counts
        const response = await fetch('/api/v1/admin/badge-counts');
        if (response.ok) {
          const counts = await response.json();
          this.updateBadges(counts);
        }
      } catch (err) {
        console.error('Failed to update dashboard:', err);
      }
    }

    updateBadges(counts) {
      const badges = {
        newUsersCount: counts.newUsers || 0,
        pendingPhotosCount: counts.pendingPhotos || 0,
        openTicketsCount: counts.openTickets || 0,
      };

      Object.entries(badges).forEach(([id, count]) => {
        const el = document.getElementById(id);
        if (el) {
          const oldCount = parseInt(el.textContent) || 0;
          el.textContent = count;

          // Animate if count changed
          if (count !== oldCount && count > 0) {
            el.style.animation = 'pulse 0.5s ease';
            setTimeout(() => {
              el.style.animation = '';
            }, 500);
          }
        }
      });

      // Update open tickets nav badge
      const openTicketsBadge = document.getElementById('openTicketsBadge');
      if (openTicketsBadge) {
        const count = (counts.pending && counts.pending.tickets) || counts.openTickets || 0;
        if (count > 0) {
          openTicketsBadge.textContent = count;
          openTicketsBadge.style.display = 'flex';
        } else {
          openTicketsBadge.style.display = 'none';
        }
      }
    }
  }

  window.DashboardUpdater = new DashboardUpdater();

  // Activity Feed
  class ActivityFeed {
    constructor() {
      this.activities = [];
      this.maxActivities = 50;
    }

    add(activity) {
      this.activities.unshift({
        ...activity,
        timestamp: new Date(),
        id: Date.now(),
      });

      if (this.activities.length > this.maxActivities) {
        this.activities = this.activities.slice(0, this.maxActivities);
      }

      this.render();
    }

    render() {
      const container = document.getElementById('activity-feed');
      if (!container) {
        return;
      }

      container.innerHTML = this.activities
        .map(
          activity => `
        <div class="activity-item" style="padding: 12px; border-bottom: 1px solid #f3f4f6; display: flex; gap: 12px; align-items: start;">
          <div class="activity-icon" style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; flex-shrink: 0;">
            ${activity.icon || '•'}
          </div>
          <div style="flex: 1;">
            <div style="font-size: 14px; color: #1f2937; font-weight: 500;">${escapeHtml(activity.message)}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${this.formatTime(activity.timestamp)}</div>
          </div>
        </div>
      `
        )
        .join('');
    }

    formatTime(date) {
      const diff = Date.now() - date.getTime();
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 60) {
        return 'Just now';
      }
      if (minutes < 60) {
        return `${minutes}m ago`;
      }
      if (hours < 24) {
        return `${hours}h ago`;
      }
      return `${days}d ago`;
    }
  }

  window.ActivityFeed = new ActivityFeed();

  // Chart Generator
  class ChartGenerator {
    createBarChart(elementId, data, options = {}) {
      const el = document.getElementById(elementId);
      if (!el) {
        return;
      }

      const maxValue = Math.max(...data.map(d => d.value));
      const colors = options.colors || ['#667eea', '#764ba2', '#f093fb', '#f5576c'];

      el.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${data
            .map(
              (item, i) => `
            <div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-size: 14px; color: #6b7280; font-weight: 500;">${escapeHtml(String(item.label))}</span>
                <span style="font-size: 14px; color: #1f2937; font-weight: 700;">${escapeHtml(String(item.value))}</span>
              </div>
              <div style="background: #f3f4f6; height: 8px; border-radius: 999px; overflow: hidden;">
                <div style="height: 100%; background: ${colors[i % colors.length]}; width: ${(item.value / maxValue) * 100}%; transition: width 1s ease;"></div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    createDonutChart(elementId, data, options = {}) {
      const el = document.getElementById(elementId);
      if (!el) {
        return;
      }

      const total = data.reduce((sum, item) => sum + item.value, 0);
      const colors = options.colors || ['#667eea', '#10b981', '#f59e0b', '#ef4444'];

      let currentAngle = 0;
      const segments = data.map((item, i) => {
        const percentage = (item.value / total) * 100;
        const angle = (item.value / total) * 360;
        const segment = {
          ...item,
          percentage: percentage.toFixed(1),
          startAngle: currentAngle,
          endAngle: currentAngle + angle,
          color: colors[i % colors.length],
        };
        currentAngle += angle;
        return segment;
      });

      el.innerHTML = `
        <div style="display: flex; align-items: center; gap: 32px;">
          <div style="position: relative; width: 120px; height: 120px;">
            <svg viewBox="0 0 100 100" style="transform: rotate(-90deg);">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" stroke-width="20"/>
              ${segments
                .map((seg, i) => {
                  const circumference = 2 * Math.PI * 40;
                  const dashArray = `${(seg.percentage / 100) * circumference} ${circumference}`;
                  return `<circle cx="50" cy="50" r="40" fill="none" stroke="${seg.color}" stroke-width="20" stroke-dasharray="${dashArray}" stroke-dashoffset="${-segments.slice(0, i).reduce((sum, s) => sum + (s.percentage / 100) * circumference, 0)}" style="transition: stroke-dashoffset 1s ease;"/>`;
                })
                .join('')}
            </svg>
            <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; color: #1f2937;">${total}</div>
          </div>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
            ${segments
              .map(
                seg => `
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 12px; height: 12px; border-radius: 2px; background: ${seg.color};"></div>
                <span style="flex: 1; font-size: 14px; color: #6b7280;">${escapeHtml(String(seg.label))}</span>
                <span style="font-size: 14px; color: #1f2937; font-weight: 600;">${escapeHtml(String(seg.value))} (${escapeHtml(String(seg.percentage))}%)</span>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }
  }

  window.Charts = new ChartGenerator();

  // Search Enhancement
  class EnhancedSearch {
    constructor(inputId, dataSource, renderCallback) {
      this.input = document.getElementById(inputId);
      this.dataSource = dataSource;
      this.renderCallback = renderCallback;
      this.debounceTimer = null;

      if (this.input) {
        this.setup();
      }
    }

    setup() {
      this.input.addEventListener('input', e => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.search(e.target.value);
        }, 300);
      });

      // Add search icon and clear button
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';

      this.input.parentNode.insertBefore(wrapper, this.input);
      wrapper.appendChild(this.input);

      const clearBtn = document.createElement('button');
      clearBtn.textContent = '×';
      clearBtn.style.cssText = `
        position: absolute;
        right: 8px;
        background: none;
        border: none;
        font-size: 20px;
        color: #9ca3af;
        cursor: pointer;
        display: none;
      `;
      clearBtn.addEventListener('click', () => {
        this.input.value = '';
        clearBtn.style.display = 'none';
        this.search('');
      });
      wrapper.appendChild(clearBtn);

      this.input.addEventListener('input', () => {
        clearBtn.style.display = this.input.value ? 'block' : 'none';
      });
    }

    search(query) {
      const results = this.dataSource(query);
      this.renderCallback(results);
    }
  }

  window.EnhancedSearch = EnhancedSearch;

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', () => {
    // Start dashboard updates if on admin page
    if (
      window.location.pathname === '/admin' &&
      window.DashboardUpdater &&
      typeof window.DashboardUpdater.start === 'function'
    ) {
      window.DashboardUpdater.start();
    }

    // Show keyboard shortcut hint
    setTimeout(() => {
      const hint = document.createElement('div');
      hint.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 13px;
        z-index: 9999;
        animation: slideIn 0.3s ease;
      `;
      hint.innerHTML =
        'Press <kbd style="background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 4px;">Ctrl+/</kbd> for shortcuts';
      document.body.appendChild(hint);

      setTimeout(() => {
        hint.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => hint.remove(), 300);
      }, 5000);
    }, 2000);
  });
})();
