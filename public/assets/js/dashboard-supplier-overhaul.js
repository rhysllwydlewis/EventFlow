/**
 * EventFlow Supplier Dashboard Overhaul — PR #1150
 * Adds: KPI cards with trend, availability widget, performance tips,
 * review request form, animated counters, and enhanced empty states.
 */
'use strict';
(function () {
  /* ── Helpers ── */
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  function toast(msg, type = 'info') {
    let container = document.querySelector('.ef-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'ef-toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `ef-toast ef-toast--${type}`;
    el.innerHTML = `<span class="ef-toast__message">${esc(msg)}</span><button class="ef-toast__close" aria-label="Dismiss">×</button>`;
    el.querySelector('.ef-toast__close').addEventListener('click', () => el.remove());
    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function readCsrfCookie() {
    const cookie = document.cookie
      .split('; ')
      .find(item => item.startsWith('csrf=') || item.startsWith('csrfToken='));
    return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : '';
  }

  async function ensureCsrfToken(forceRefresh = false) {
    if (!forceRefresh) {
      const existing = readCsrfCookie();
      if (existing) {
        return existing;
      }
    }

    if (typeof window.ensureCsrfToken === 'function') {
      return window.ensureCsrfToken(forceRefresh);
    }

    const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Unable to initialise request security');
    }
    const data = await response.json();
    if (!data.csrfToken) {
      throw new Error('Request security token missing');
    }
    return data.csrfToken;
  }

  async function fetchWithCsrfRetry(url, options) {
    const execute = async forceRefresh => {
      const token = await ensureCsrfToken(forceRefresh);
      return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          ...(options.headers || {}),
          'X-CSRF-Token': token,
        },
      });
    };

    let response = await execute(false);
    if (response.status !== 403 && response.status !== 419) {
      return response;
    }

    const body = await response
      .clone()
      .json()
      .catch(() => ({}));
    if (!/csrf/i.test(body.error || body.errorType || '')) {
      return response;
    }

    response = await execute(true);
    return response;
  }

  /* ── Availability Widget ── */
  function renderAvailabilityWidget(availability) {
    const container = document.getElementById('supplier-availability-widget');
    if (!container) {
      return;
    }

    const { status = 'available', notes = '' } = availability;
    const statusLabel =
      status === 'limited' ? 'Limited' : status === 'unavailable' ? 'Unavailable' : 'Available';
    container.className = 'availability-widget';
    // The enclosing card already has an "Availability Status" heading, so this
    // inner title repeated it verbatim. Show the current status instead — it's
    // the one piece of information the heading above doesn't already give.
    container.innerHTML = `
      <div class="availability-widget__header">
        <span class="availability-widget__title">
          <span class="availability-dot availability-dot--${esc(status)}" aria-hidden="true"></span>
          ${esc(statusLabel)}
        </span>
        <div class="availability-status-selector" role="group" aria-label="Set availability status">
          <button class="availability-btn ${status === 'available' ? 'active' : ''}" data-status="available" type="button">Available</button>
          <button class="availability-btn ${status === 'limited' ? 'active' : ''}" data-status="limited" type="button">Limited</button>
          <button class="availability-btn ${status === 'unavailable' ? 'active' : ''}" data-status="unavailable" type="button">Unavailable</button>
        </div>
      </div>
      <p style="font-size:12px;color:#6b7280;margin:0 0 8px">Let customers know your current booking status</p>
      <textarea class="availability-notes" placeholder="Add a note (e.g. 'Limited slots in December')" aria-label="Availability notes">${esc(notes)}</textarea>
      <button class="availability-save-btn" type="button" id="save-availability-btn">Save Status</button>
      <span id="availability-save-status" style="font-size:12px;color:#059669;margin-left:10px;display:none">Saved ✓</span>
    `;

    let currentStatus = status;

    // Status button click
    container.querySelectorAll('.availability-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.availability-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentStatus = btn.dataset.status;
        const dot = container.querySelector('.availability-dot');
        if (dot) {
          dot.className = `availability-dot availability-dot--${currentStatus}`;
        }
        const title = container.querySelector('.availability-widget__title');
        if (title) {
          const label =
            currentStatus === 'limited'
              ? 'Limited'
              : currentStatus === 'unavailable'
                ? 'Unavailable'
                : 'Available';
          title.lastChild.textContent = ` ${label}`;
        }
      });
    });

    // Save
    container.querySelector('#save-availability-btn').addEventListener('click', async () => {
      const notes = container.querySelector('.availability-notes').value; // skipcq: JS-0123 - local to the save handler, unrelated to the destructured widget-render notes
      const btn = container.querySelector('#save-availability-btn');
      const statusEl = container.querySelector('#availability-save-status');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const res = await fetchWithCsrfRetry('/api/v1/supplier/availability', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: currentStatus, notes }),
        });
        if (res.ok) {
          statusEl.style.display = 'inline';
          setTimeout(() => {
            statusEl.style.display = 'none';
          }, 3000);
          toast('Availability updated', 'success');
        } else {
          const data = await res.json().catch(() => ({}));
          toast(data.error || 'Failed to save availability', 'error');
        }
      } catch {
        toast('Network error — please try again', 'error');
      } finally {
        btn.textContent = 'Save Status';
        btn.disabled = false;
      }
    });
  }

  /* ── Performance Tips ── */
  function renderPerformanceTips(data) {
    const container = document.getElementById('supplier-perf-tips');
    if (!container) {
      return;
    }

    if (!data.tips || data.tips.length === 0) {
      container.innerHTML = `
        <div class="ef-empty-state">
          <div class="ef-empty-state__illustration">🎉</div>
          <div class="ef-empty-state__title">Looking great!</div>
          <div class="ef-empty-state__desc">Your profile is in excellent shape. Keep engaging with enquiries!</div>
        </div>
      `;
      return;
    }

    container.className = 'perf-tips-list';
    container.innerHTML = data.tips
      .map(
        tip => `
      <div class="perf-tip">
        <span class="perf-tip__icon" aria-hidden="true">${esc(tip.icon)}</span>
        <div class="perf-tip__body">
          <p class="perf-tip__title">${esc(tip.title)}</p>
          <p class="perf-tip__desc">${esc(tip.body)}</p>
        </div>
        ${
          tip.action
            ? `
          ${
            tip.action.href
              ? `<a class="perf-tip__action" href="${esc(tip.action.href)}">${esc(tip.action.label)}</a>`
              : `<button class="perf-tip__action" type="button" data-tip-action="${esc(tip.action.data)}">${esc(tip.action.label)}</button>`
          }
        `
            : ''
        }
      </div>
    `
      )
      .join('');

    // Wire up data-tip-action="request-review"
    container.querySelectorAll('[data-tip-action="request-review"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const toggle = document.getElementById('rreq-toggle-form');
        const form = document.getElementById('supplier-review-request-form');
        if (toggle && form) {
          if (form.hidden) {
            toggle.click();
          }
          form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }

  let reviewRequestHistoryData = { items: [], summary: {} };

  function formatReviewRequestDate(value) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB');
  }

  function reviewRequestStatusLabel(status) {
    return (
      {
        pending: 'Preparing',
        sent: 'Sent',
        opened: 'Opened',
        completed: 'Completed',
        failed: 'Failed',
        expired: 'Expired',
      }[status] || 'Unknown'
    );
  }

  function renderReviewRequestHistory(data) {
    reviewRequestHistoryData = data || { items: [], summary: {} };
    const summary = reviewRequestHistoryData.summary || {};
    const summaryEl = document.getElementById('rreq-history-summary');
    const listEl = document.getElementById('rreq-history-list');
    const filter = document.getElementById('rreq-history-status');
    if (!summaryEl || !listEl || !filter) {
      return;
    }

    summaryEl.innerHTML = [
      ['Total', summary.total],
      ['Active', summary.active],
      ['Completed', summary.completed],
      ['Needs attention', summary.deliveryIssues],
    ]
      .map(
        ([label, value]) =>
          `<div class="review-request-summary-card"><span>${esc(label)}</span><strong>${Number(value || 0).toLocaleString('en-GB')}</strong></div>`
      )
      .join('');

    const selectedStatus = filter.value;
    const items = (reviewRequestHistoryData.items || []).filter(
      item => selectedStatus === 'all' || item.status === selectedStatus
    );

    if (!items.length) {
      listEl.innerHTML = `
        <div class="review-request-history-empty">
          <strong>No review requests found</strong>
          <span>${
            selectedStatus === 'all'
              ? 'Send your first request to start tracking delivery and completion.'
              : 'No requests currently match this status.'
          }</span>
        </div>`;
      return;
    }

    listEl.innerHTML = items
      .map(item => {
        const activityAt =
          item.completedAt ||
          item.openedAt ||
          item.sentAt ||
          item.failedAt ||
          item.expiredAt ||
          item.updatedAt ||
          item.createdAt;
        const retryLabel = item.status === 'completed' ? 'Request again' : 'Retry';
        const issue =
          item.lastError && item.status === 'failed'
            ? `<p class="review-request-history-error">${esc(item.lastError)}</p>`
            : '';
        return `
          <article class="review-request-history-item">
            <div class="review-request-history-customer">
              <strong>${esc(item.customerName || item.customerEmail)}</strong>
              ${item.customerName ? `<span>${esc(item.customerEmail)}</span>` : ''}
            </div>
            <div class="review-request-history-state">
              <span class="review-request-status review-request-status--${esc(item.status)}">${esc(
                reviewRequestStatusLabel(item.status)
              )}</span>
              <span>${esc(formatReviewRequestDate(activityAt))}</span>
            </div>
            <div class="review-request-history-action">
              ${
                item.retryable
                  ? `<button class="review-request-retry-btn" type="button" data-rreq-retry="${esc(
                      item.id
                    )}">${esc(retryLabel)}</button>`
                  : `<span>${
                      item.retryAt
                        ? `Available ${esc(formatReviewRequestDate(item.retryAt))}`
                        : 'No action required'
                    }</span>`
              }
            </div>
            ${issue}
          </article>`;
      })
      .join('');

    listEl.querySelectorAll('[data-rreq-retry]').forEach(button => {
      button.addEventListener('click', async () => {
        const item = (reviewRequestHistoryData.items || []).find(
          candidate => candidate.id === button.getAttribute('data-rreq-retry')
        );
        if (!item) {
          return;
        }

        button.disabled = true;
        button.textContent = 'Sending…';
        try {
          const response = await fetchWithCsrfRetry('/api/v1/supplier/request-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerEmail: item.customerEmail,
              customerName: item.customerName || '',
            }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            toast(body.error || 'Unable to resend this review request', 'error');
            return;
          }
          toast('Review request sent again', 'success');
          await loadReviewRequestHistory();
        } catch {
          toast('Network error — please try again', 'error');
        } finally {
          button.disabled = false;
          button.textContent = item.status === 'completed' ? 'Request again' : 'Retry';
        }
      });
    });
  }

  async function loadReviewRequestHistory() {
    const response = await fetch('/api/v1/supplier/review-requests?limit=50', {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Unable to load review request activity');
    }
    const data = await response.json();
    renderReviewRequestHistory(data);
  }

  /* ── Review Request Form ── */
  function renderReviewRequestForm() {
    const container = document.getElementById('supplier-review-request-widget');
    if (!container) {
      return;
    }

    container.innerHTML = `
      <section class="review-request-operations" aria-labelledby="review-request-operations-title">
        <div class="review-request-operations__header">
          <div>
            <p class="review-request-operations__eyebrow">Reputation</p>
            <h3 id="review-request-operations-title">Review requests</h3>
            <p>Send secure invitations and follow each request from delivery to completion.</p>
          </div>
          <button id="rreq-toggle-form" class="review-request-open-btn" type="button" aria-expanded="false">
            Request a review
          </button>
        </div>

        <form class="review-request-form" id="supplier-review-request-form" hidden>
          <p class="review-request-form__title">Request a review</p>
          <p class="review-request-form__desc">Enter a past customer's details to send a secure review invitation.</p>
          <div class="review-request-inputs">
            <input type="email" id="rreq-email" placeholder="Customer email *" required aria-label="Customer email" />
            <input type="text" id="rreq-name" placeholder="Customer name (optional)" aria-label="Customer name" />
          </div>
          <div class="review-request-form__actions">
            <button type="submit" class="review-request-send-btn">Send request</button>
            <span id="rreq-status" class="review-request-sent-status" hidden>Sent ✓</span>
          </div>
        </form>

        <div class="review-request-history-toolbar">
          <div id="rreq-history-summary" class="review-request-summary" aria-live="polite"></div>
          <label class="review-request-filter">
            <span>Status</span>
            <select id="rreq-history-status">
              <option value="all">All requests</option>
              <option value="pending">Preparing</option>
              <option value="sent">Sent</option>
              <option value="opened">Opened</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="expired">Expired</option>
            </select>
          </label>
        </div>
        <div id="rreq-history-list" class="review-request-history" aria-live="polite">
          <div class="review-request-history-empty"><span>Loading review requests…</span></div>
        </div>
      </section>
    `;

    const form = container.querySelector('form');
    const toggle = container.querySelector('#rreq-toggle-form');
    const filter = container.querySelector('#rreq-history-status');

    toggle.addEventListener('click', () => {
      form.hidden = !form.hidden;
      toggle.setAttribute('aria-expanded', String(!form.hidden));
      toggle.textContent = form.hidden ? 'Request a review' : 'Close form';
      if (!form.hidden) {
        document.getElementById('rreq-email').focus();
      }
    });

    filter.addEventListener('change', () => renderReviewRequestHistory(reviewRequestHistoryData));

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const email = document.getElementById('rreq-email').value.trim();
      const name = document.getElementById('rreq-name').value.trim();
      const button = container.querySelector('.review-request-send-btn');
      const status = document.getElementById('rreq-status');

      if (!email) {
        return;
      }
      button.disabled = true;
      button.textContent = 'Sending…';

      try {
        const response = await fetchWithCsrfRetry('/api/v1/supplier/request-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerEmail: email, customerName: name }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          toast('Review request sent!', 'success');
          status.hidden = false;
          document.getElementById('rreq-email').value = '';
          document.getElementById('rreq-name').value = '';
          await loadReviewRequestHistory();
          setTimeout(() => {
            status.hidden = true;
          }, 4000);
        } else if (response.status === 409) {
          toast(data.error || 'A review request was already sent to this customer.', 'info');
        } else {
          toast(data.error || 'Failed to send request', 'error');
        }
      } catch {
        toast('Network error — please try again', 'error');
      } finally {
        button.textContent = 'Send request';
        button.disabled = false;
      }
    });
  }

  /* ── Init ── */
  async function init() {
    try {
      // Fire both requests in parallel — neither depends on the other.
      // (A third dashboard-summary request used to live here to feed a KPI
      // grid, but dashboard-supplier-module.js already renders that same
      // data into #supplier-stats-grid — the two stacked directly on top of
      // each other, duplicating several tiles. Removed the redundant one.)
      const [availRes, tipsRes] = await Promise.allSettled([
        fetch('/api/v1/supplier/availability', { credentials: 'include' }),
        fetch('/api/v1/supplier/performance-tips', { credentials: 'include' }),
      ]);

      if (availRes.status === 'fulfilled' && availRes.value.ok) {
        const { availability } = await availRes.value.json();
        renderAvailabilityWidget(availability || {});
      }

      if (tipsRes.status === 'fulfilled' && tipsRes.value.ok) {
        const tipsData = await tipsRes.value.json();
        renderPerformanceTips(tipsData);
      }

      renderReviewRequestForm();
      loadReviewRequestHistory().catch(error => {
        const list = document.getElementById('rreq-history-list');
        if (list) {
          list.innerHTML =
            '<div class="review-request-history-empty"><strong>Activity unavailable</strong><span>Refresh the page to try again.</span></div>';
        }
        if (window.__EF_DEBUG__) {
          console.warn('[overhaul] review request history error:', error);
        }
      });
    } catch (err) {
      // Non-fatal — dashboard still works without the overhaul widgets
      if (window.__EF_DEBUG__) {
        console.warn('[overhaul] init error:', err);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
