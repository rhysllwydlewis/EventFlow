'use strict';

class ReadByModal {
  constructor() {
    this.el = null;
    this.previouslyFocused = null;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  open({ message, participants = [] }) {
    this.close();
    this.previouslyFocused = document.activeElement;

    const byUser = new Map((participants || []).map(p => [String(p.userId), p]));
    const readBy = Array.isArray(message?.readBy) ? message.readBy : [];
    const deliveredTo = Array.isArray(message?.deliveredTo) ? message.deliveredTo : [];
    const senderId = String(message?.senderId || '');

    const readSet = new Set(readBy.map(r => String(r.userId)));
    const deliveredSet = new Set(deliveredTo.map(d => String(d.userId)));
    readSet.delete(senderId);
    deliveredSet.delete(senderId);

    const others = participants.filter(p => String(p.userId) !== senderId);
    const notDelivered = others.filter(p => !deliveredSet.has(String(p.userId)));

    const titleId = `readByTitle-${Date.now()}`;
    this.el = document.createElement('div');
    this.el.className = 'messenger-v4__readby-overlay';
    this.el.innerHTML = `
      <div class="messenger-v4__readby-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="messenger-v4__readby-header">
          <h3 id="${titleId}" class="messenger-v4__readby-title">Message status</h3>
          <button class="ef-cta messenger-v4__readby-close" aria-label="Close">×</button>
        </div>
        ${this._section(
          'Read by',
          readBy.filter(r => String(r.userId) !== senderId),
          byUser,
          'readAt'
        )}
        ${this._section(
          'Delivered to',
          deliveredTo.filter(d => String(d.userId) !== senderId && !readSet.has(String(d.userId))),
          byUser,
          'deliveredAt'
        )}
        <div class="messenger-v4__readby-section">
          <h4>Not yet delivered</h4>
          <ul>${notDelivered.map(p => this._personRow(p, null, 'Pending')).join('')}</ul>
        </div>
      </div>
    `;

    document.body.appendChild(this.el);
    this.el.addEventListener('click', e => {
      if (e.target === this.el || e.target.closest('.messenger-v4__readby-close')) {
        this.close();
      }
    });
    document.addEventListener('keydown', this._onKeyDown);
    this.el.querySelector('.messenger-v4__readby-close')?.focus();
  }

  close() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    document.removeEventListener('keydown', this._onKeyDown);
    this.previouslyFocused?.focus?.();
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
    if (e.key === 'Tab' && this.el) {
      const nodes = this.el.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])');
      if (!nodes.length) {
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  _section(title, rows, byUser, tsKey) {
    return `<div class="messenger-v4__readby-section"><h4>${title}</h4><ul>${rows
      .map(r => this._personRow(byUser.get(String(r.userId)) || { userId: r.userId }, r[tsKey], ''))
      .join('')}</ul></div>`;
  }

  _personRow(participant, ts, fallbackText) {
    const name = participant?.displayName || participant?.userId || 'Unknown';
    const avatar = (name || 'U').charAt(0).toUpperCase();
    const relative = ts ? this._relative(ts) : fallbackText;
    const full = ts ? new Date(ts).toLocaleString() : '';
    return `<li class="messenger-v4__readby-row">
      <span class="messenger-v4__readby-avatar" aria-hidden="true">${this._esc(avatar)}</span>
      <span class="messenger-v4__readby-name">${this._esc(name)}</span>
      <time class="messenger-v4__readby-time" title="${this._esc(full)}">${this._esc(relative)}</time>
    </li>`;
  }

  _relative(ts) {
    const diff = Math.max(0, Date.now() - new Date(ts).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) {
      return 'just now';
    }
    if (mins < 60) {
      return `${mins}m ago`;
    }
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) {
      return `${hrs}h ago`;
    }
    return `${Math.floor(hrs / 24)}d ago`;
  }

  _esc(v) {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

if (typeof window !== 'undefined') {
  window.ReadByModal = ReadByModal;
}
