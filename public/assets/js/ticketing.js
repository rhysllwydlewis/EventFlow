/**
 * Ticketing System for EventFlow
 * Handles ticket creation, viewing, status updates, and replies
 */

/**
 * Show a toast notification if Toast library is available
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 * @param {string} message - Message to display
 */
function showToastIfAvailable(type, message) {
  if (typeof Toast !== 'undefined' && Toast[type]) {
    Toast[type](message);
  }
}

class TicketingError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'TicketingError';
    this.status = status;
  }
}

class TicketingSystem {
  constructor() {
    this.activePollers = new Set();
    this.apiBase = '/api';
    this._pollingNotificationShown = false;
    this.defaultPollIntervalMs = 5000;
    this.maxPollIntervalMs = 30000;
    this.hiddenPollIntervalMs = 300000;
  }

  getCsrfTokenFromCookie() {
    if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
      return null;
    }

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf' || name === 'csrfToken') {
        const token = decodeURIComponent(value || '');
        return token || null;
      }
    }

    return null;
  }

  async ensureCsrfToken(forceRefresh = false) {
    if (typeof window.ensureCsrfToken === 'function') {
      return window.ensureCsrfToken(forceRefresh);
    }

    if (forceRefresh) {
      window.__CSRF_TOKEN__ = null;
      window.csrfToken = null;
    }

    if (!forceRefresh) {
      const cookieToken = this.getCsrfTokenFromCookie();
      if (cookieToken) {
        window.__CSRF_TOKEN__ = cookieToken;
        window.csrfToken = cookieToken;
        return cookieToken;
      }
    }

    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }

    const csrfEndpoints = ['/api/v1/csrf-token', '/api/csrf-token'];
    let token = null;

    for (const endpoint of csrfEndpoints) {
      try {
        const response = await fetch(endpoint, {
          credentials: 'include',
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        token = data?.csrfToken || data?.token || this.getCsrfTokenFromCookie();
        if (token) {
          break;
        }
      } catch (_error) {
        // Try the next endpoint before failing
      }
    }

    if (!token) {
      throw new Error('CSRF token missing from response');
    }

    window.__CSRF_TOKEN__ = token;
    window.csrfToken = token;
    return token;
  }

  async request(url, options = {}) {
    const isWriteMethod =
      options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase());

    const opts = {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };

    if (isWriteMethod) {
      const csrfToken = await this.ensureCsrfToken();
      opts.headers['X-CSRF-Token'] = csrfToken;
    }

    let response = await fetch(url, opts);
    let rawBody = await response.text();
    let data;

    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch (_error) {
      data = {};
    }

    const csrfHint = `${data?.error || ''} ${data?.message || ''} ${rawBody || ''}`;
    const csrfError = response.status === 403 && /csrf/i.test(csrfHint) && isWriteMethod;

    // CSRF tokens can expire/rotate; refresh once and retry automatically.
    if (csrfError) {
      window.__CSRF_TOKEN__ = null;
      window.csrfToken = null;
      const freshToken = await this.ensureCsrfToken(true);
      response = await fetch(url, {
        ...opts,
        headers: {
          ...opts.headers,
          'X-CSRF-Token': freshToken,
        },
      });
      rawBody = await response.text();
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch (_error) {
        data = {};
      }
    }

    if (!response.ok) {
      throw new TicketingError(
        data.error || data.message || 'Ticket request failed',
        response.status
      );
    }

    return data;
  }

  normalizeTicket(rawTicket = {}) {
    const ticket = rawTicket && typeof rawTicket === 'object' ? { ...rawTicket } : {};

    const fallbackMessage =
      typeof ticket.description === 'string' && ticket.description.trim().length > 0
        ? ticket.description
        : '';

    ticket.id = typeof ticket.id === 'string' && ticket.id ? ticket.id : ticket.ticketId || null;
    ticket.status = typeof ticket.status === 'string' && ticket.status ? ticket.status : 'open';
    ticket.priority =
      typeof ticket.priority === 'string' && ticket.priority ? ticket.priority : 'medium';
    ticket.subject = typeof ticket.subject === 'string' ? ticket.subject : 'No subject';
    ticket.message = typeof ticket.message === 'string' ? ticket.message : fallbackMessage;

    if (Array.isArray(ticket.responses)) {
      // keep as-is
    } else if (Array.isArray(ticket.replies)) {
      ticket.responses = ticket.replies;
    } else {
      ticket.responses = [];
    }

    return ticket;
  }

  createPoller(
    task,
    callback,
    {
      silentOnAuthError = true,
      onAuthError = null,
      intervalMs: preferredIntervalMs = this.defaultPollIntervalMs,
      hiddenIntervalMs = this.hiddenPollIntervalMs,
      pauseWhenHidden = true,
    } = {}
  ) {
    let cancelled = false;
    let timer = null;
    let intervalMs = preferredIntervalMs;
    let inFlight = false;
    let removeVisibilityListener = null;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const stop = () => {
      cancelled = true;
      clearTimer();
      if (typeof removeVisibilityListener === 'function') {
        removeVisibilityListener();
        removeVisibilityListener = null;
      }
      this.activePollers.delete(stop);
    };

    const getNextIntervalMs = currentInterval => {
      const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      if (pauseWhenHidden && isHidden) {
        return hiddenIntervalMs;
      }
      return currentInterval;
    };

    const run = async () => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const result = await task();
        callback(result);
        intervalMs = preferredIntervalMs;
      } catch (error) {
        const isAuthError = error instanceof TicketingError && [401, 403].includes(error.status);

        if (isAuthError && silentOnAuthError) {
          if (typeof onAuthError === 'function') {
            onAuthError();
          }
          stop();
          return;
        }

        console.error('Ticket polling failed:', error);
        intervalMs = Math.min(intervalMs * 2, this.maxPollIntervalMs);
      } finally {
        inFlight = false;
      }

      timer = setTimeout(run, getNextIntervalMs(intervalMs));
    };

    const handleVisibilityChange = () => {
      if (cancelled || !pauseWhenHidden || typeof document === 'undefined') {
        return;
      }

      if (document.visibilityState === 'visible') {
        clearTimer();
        intervalMs = preferredIntervalMs;
        if (!inFlight) {
          run();
        }
      }
    };

    if (typeof document !== 'undefined' && pauseWhenHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      removeVisibilityListener = () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    this.activePollers.add(stop);
    run();

    return stop;
  }

  async createTicket(ticketData) {
    const data = await this.request(`${this.apiBase}/tickets`, {
      method: 'POST',
      body: JSON.stringify(ticketData),
    });
    return this.normalizeTicket(data.ticket);
  }

  async getUserTickets(_userId, _userType, limit = null, options = {}) {
    const params = new URLSearchParams();
    if (limit) {
      params.set('limit', String(limit));
    }
    if (typeof options.status === 'string' && options.status) {
      params.set('status', options.status);
    }
    if (typeof options.sort === 'string' && options.sort) {
      params.set('sort', options.sort);
    }
    if (typeof options.query === 'string' && options.query.trim()) {
      params.set('q', options.query.trim());
    }

    let url = `${this.apiBase}/tickets`;
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const data = await this.request(url);
    return (data.tickets || []).map(ticket => this.normalizeTicket(ticket));
  }

  async getTicket(ticketId) {
    const data = await this.request(`${this.apiBase}/tickets/${ticketId}`);
    return this.normalizeTicket(data.ticket);
  }

  async addResponse(ticketId, message) {
    const data = await this.request(`${this.apiBase}/tickets/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    return this.normalizeTicket(data.ticket);
  }

  async updateTicket(ticketId, updates) {
    const data = await this.request(`${this.apiBase}/tickets/${ticketId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return this.normalizeTicket(data.ticket);
  }

  updateStatus(ticketId, status) {
    return this.updateTicket(ticketId, { status });
  }

  updatePriority(ticketId, priority) {
    return this.updateTicket(ticketId, { priority });
  }

  closeTicket(ticketId) {
    return this.updateStatus(ticketId, 'closed');
  }

  reopenTicket(ticketId) {
    return this.updateStatus(ticketId, 'open');
  }

  listenToTicket(ticketId, callback) {
    if (!this._pollingNotificationShown) {
      this._pollingNotificationShown = true;
      showToastIfAvailable('info', 'Ticket updates refresh automatically every 5 seconds.');
    }

    return this.createPoller(() => this.getTicket(ticketId), callback, {
      silentOnAuthError: true,
      onAuthError: () => callback(null),
    });
  }

  listenToUserTickets(userId, userType, callback, limit = null, options = {}) {
    return this.createPoller(
      () => this.getUserTickets(userId, userType, limit, options),
      callback,
      {
        silentOnAuthError: true,
        onAuthError: () => callback([]),
        intervalMs: 60000,
        hiddenIntervalMs: 600000,
        pauseWhenHidden: true,
      }
    );
  }

  cleanup() {
    this.activePollers.forEach(stop => stop());
    this.activePollers.clear();
  }

  getStatusClass(status) {
    const statusClasses = {
      open: 'badge-open',
      in_progress: 'badge-in_progress',
      resolved: 'badge-resolved',
      closed: 'badge-closed',
    };
    return statusClasses[status] || 'badge-default';
  }

  getPriorityClass(priority) {
    const priorityClasses = {
      low: 'badge-priority-low',
      medium: 'badge-priority-medium',
      high: 'badge-priority-high',
      urgent: 'badge-priority-urgent',
    };
    return priorityClasses[priority] || 'badge-priority-medium';
  }

  formatTimestamp(timestamp) {
    if (!timestamp) {
      return '';
    }
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

const ticketingSystem = new TicketingSystem();

export { ticketingSystem, showToastIfAvailable };
export default ticketingSystem;
