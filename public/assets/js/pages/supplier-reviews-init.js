/**
 * Supplier Review Management
 *
 * Loads the supplier's individual reviews from the existing
 * GET /api/v2/reviews/supplier/:id endpoint, renders them with
 * star distribution, and wires the "Reply" / "Edit reply" form
 * to POST /api/v2/reviews/:id/response and PUT /api/v2/reviews/:id/response.
 *
 * Exported as a single async init function called from
 * dashboard-supplier-module.js once the supplierId is known.
 */

'use strict';

(function () {
  /* ─────────────────────────────────────────────────────────────────────────
   * Constants
   * ──────────────────────────────────────────────────────────────────────── */
  const REVIEWS_PER_PAGE = 10;
  const MAX_REPLY_CHARS  = 1000;

  /* ─────────────────────────────────────────────────────────────────────────
   * Helpers
   * ──────────────────────────────────────────────────────────────────────── */

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }

  function stars(n) {
    const full  = Math.round(Math.max(0, Math.min(5, n)));
    const empty = 5 - full;
    return (
      '<span class="sr-stars" aria-hidden="true">' +
      '★'.repeat(full) + '<span class="sr-stars--empty">' + '★'.repeat(empty) + '</span>' +
      '</span>'
    );
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch (_) { return ''; }
  }

  async function csrfToken() {
    try {
      const r = await fetch('/api/v1/auth/csrf', { credentials: 'include' });
      if (!r.ok) return '';
      const d = await r.json();
      return d.csrfToken || d.token || '';
    } catch (_) { return ''; }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Fetch
   * ──────────────────────────────────────────────────────────────────────── */

  async function fetchReviews(supplierId, page, sortBy) {
    const url = `/api/v2/reviews/supplier/${encodeURIComponent(supplierId)}?page=${page}&limit=${REVIEWS_PER_PAGE}&sortBy=${sortBy}`;
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('Failed to load reviews');
    const d = await r.json();
    return d.data;   // { reviews, pagination, analytics }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Star distribution bar
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * @param {number[]} dist  [1★count, 2★count, 3★count, 4★count, 5★count] across ALL reviews
   * @param {number}   totalReviews  Total review count (for percentage calculation)
   */
  function renderDistribution(dist, totalReviews) {
    const total = totalReviews || 1;

    return [5, 4, 3, 2, 1].map(n => {
      const c   = dist[n - 1] || 0;
      const pct = Math.round((c / total) * 100);
      return `
        <div class="sr-dist-row">
          <span class="sr-dist-label">${n}★</span>
          <div class="sr-dist-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${n} star: ${c} review${c !== 1 ? 's' : ''}">
            <div class="sr-dist-fill sr-dist-fill--${n}" style="width:${pct}%"></div>
          </div>
          <span class="sr-dist-count">${c}</span>
        </div>`;
    }).join('');
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Reply form
   * ──────────────────────────────────────────────────────────────────────── */

  function replyFormHtml(reviewId, existingText) {
    const isEdit    = !!existingText;
    const label     = isEdit ? 'Edit your reply' : 'Reply to this review';
    const submitLbl = isEdit ? 'Save changes' : 'Post reply';

    return `
      <div class="sr-reply-form" id="sr-reply-form-${esc(reviewId)}" role="form" aria-label="${label}">
        <label for="sr-reply-textarea-${esc(reviewId)}" class="sr-reply-label">${label}</label>
        <textarea
          id="sr-reply-textarea-${esc(reviewId)}"
          class="sr-reply-textarea"
          rows="4"
          maxlength="${MAX_REPLY_CHARS}"
          placeholder="Write a professional, helpful response that potential customers will also read…"
          aria-describedby="sr-reply-count-${esc(reviewId)} sr-reply-tip-${esc(reviewId)}"
        >${esc(existingText || '')}</textarea>
        <div class="sr-reply-meta">
          <span class="sr-reply-count" id="sr-reply-count-${esc(reviewId)}">${(existingText || '').length} / ${MAX_REPLY_CHARS}</span>
          <span class="sr-reply-tip" id="sr-reply-tip-${esc(reviewId)}">Keep replies professional — they are visible to all customers.</span>
        </div>
        <div class="sr-reply-actions">
          <button type="button" class="ef-cta sr-reply-submit" data-review-id="${esc(reviewId)}" data-is-edit="${isEdit}">${submitLbl}</button>
          <button type="button" class="sr-reply-cancel" data-review-id="${esc(reviewId)}">Cancel</button>
          <span class="sr-reply-status" id="sr-reply-status-${esc(reviewId)}" role="alert" aria-live="polite"></span>
        </div>
      </div>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Single review card
   * ──────────────────────────────────────────────────────────────────────── */

  function reviewCardHtml(review) {
    const id          = review.id || review._id || '';
    const rating      = review.rating || 0;
    const title       = review.title || '';
    const text        = review.text || '';
    const authorName  = review.userName || review.authorName || 'Anonymous';
    const date        = review.createdAt || '';
    const hasResponse = !!(review.response || review.supplierResponse);
    const responseText = hasResponse
      ? (review.response?.text || review.supplierResponse?.text || '')
      : '';
    const responseDate = hasResponse
      ? (review.response?.respondedAt || review.supplierResponse?.respondedAt || review.response?.createdAt || '')
      : '';

    const verifiedBadge = review.verified
      ? '<span class="sr-badge sr-badge--verified">✓ Verified</span>'
      : '';

    const responseSection = hasResponse
      ? `<div class="sr-response" id="sr-response-block-${esc(id)}">
           <div class="sr-response-header">
             <span class="sr-response-label">💬 Your reply</span>
             <span class="sr-response-date">${fmtDate(responseDate)}</span>
           </div>
           <p class="sr-response-text" id="sr-response-text-${esc(id)}">${esc(responseText)}</p>
           <button type="button" class="sr-edit-reply-btn" data-review-id="${esc(id)}" aria-label="Edit your reply to this review">
             Edit reply
           </button>
         </div>`
      : '';

    const replyBtn = !hasResponse
      ? `<button type="button" class="sr-reply-btn ef-cta ef-cta--outline" data-review-id="${esc(id)}" aria-label="Reply to this review">
           Reply
         </button>`
      : '';

    return `
      <article class="sr-review-card" id="sr-card-${esc(id)}" data-review-id="${esc(id)}">
        <div class="sr-review-header">
          <div class="sr-review-meta">
            ${stars(rating)}
            <span class="sr-review-rating-num" aria-label="${rating} out of 5">${rating.toFixed(1)}</span>
            ${verifiedBadge}
          </div>
          <time class="sr-review-date" datetime="${esc(date)}">${fmtDate(date)}</time>
        </div>
        <p class="sr-review-author">From <strong>${esc(authorName)}</strong></p>
        ${title ? `<p class="sr-review-title">${esc(title)}</p>` : ''}
        <p class="sr-review-text">${esc(text)}</p>
        ${responseSection}
        <div class="sr-review-footer" id="sr-footer-${esc(id)}">
          ${replyBtn}
        </div>
        <div class="sr-form-slot" id="sr-form-slot-${esc(id)}"></div>
      </article>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Full section render
   * ──────────────────────────────────────────────────────────────────────── */

  function renderSection(container, data, page, sortBy, supplierId) {
    const { reviews, pagination, analytics } = data;
    const total     = pagination?.total   || 0;
    const pages     = pagination?.pages   || 1;
    const avgRating = analytics?.avgRating || 0;
    const resRate   = typeof analytics?.responseRate === 'number'
      ? analytics.responseRate
      : null;

    if (total === 0) {
      container.innerHTML = `
        <div class="sr-empty">
          <div class="sr-empty-icon" aria-hidden="true">⭐⭐⭐⭐⭐</div>
          <p class="sr-empty-title">No reviews yet</p>
          <p class="sr-empty-desc">Your first customer review will appear here once it is approved. Share your profile with satisfied customers and ask them to leave feedback.</p>
          <button type="button" class="ef-cta" id="sr-copy-link-btn">Copy your profile link</button>
        </div>`;

      const copyBtn = container.querySelector('#sr-copy-link-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const link = window.location.origin + '/supplier?id=' + encodeURIComponent(supplierId);
          navigator.clipboard?.writeText(link).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy your profile link'; }, 2000);
          }).catch(() => {
            prompt('Copy your profile link:', link);
          });
        });
      }
      return;
    }

    /* Summary bar */
    const resRateHtml = resRate !== null
      ? `<div class="sr-stat-card">
           <div class="sr-stat-label">Response rate</div>
           <div class="sr-stat-value">${resRate}%</div>
           <div class="sr-stat-sub">${resRate === 100 ? 'Excellent' : resRate >= 80 ? 'Good' : 'Needs improvement'}</div>
         </div>`
      : '';

    /* Sort controls */
    const sortOptions = [
      { value: 'recent', label: 'Most recent' },
      { value: 'rating',  label: 'Highest rated' },
      { value: 'helpful', label: 'Most helpful' },
    ];
    const sortHtml = sortOptions.map(o =>
      `<option value="${o.value}" ${sortBy === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');

    /* Pagination */
    const prevDisabled = page <= 1 ? 'disabled' : '';
    const nextDisabled = page >= pages ? 'disabled' : '';

    container.innerHTML = `
      <div class="sr-summary">
        <div class="sr-summary-score">
          <div class="sr-big-rating" aria-label="${avgRating.toFixed(1)} out of 5">${avgRating.toFixed(1)}</div>
          ${stars(avgRating)}
          <div class="sr-total-count">${total} review${total !== 1 ? 's' : ''}</div>
        </div>
        <div class="sr-distribution" aria-label="Star rating breakdown">
          ${renderDistribution(analytics?.ratingDistribution || [0,0,0,0,0], total)}
        </div>
        ${resRateHtml}
      </div>

      <div class="sr-toolbar">
        <label for="sr-sort" class="sr-sort-label">Sort by</label>
        <select id="sr-sort" class="sr-sort-select" aria-label="Sort reviews">
          ${sortHtml}
        </select>
        <span class="sr-page-info">Page ${page} of ${pages}</span>
      </div>

      <div class="sr-list" id="sr-list">
        ${reviews.map(r => reviewCardHtml(r)).join('')}
      </div>

      <div class="sr-pagination">
        <button type="button" class="sr-page-btn" id="sr-prev" ${prevDisabled} aria-label="Previous page">← Prev</button>
        <button type="button" class="sr-page-btn" id="sr-next" ${nextDisabled} aria-label="Next page">Next →</button>
      </div>`;

    /* Bind sort */
    const sortEl = container.querySelector('#sr-sort');
    if (sortEl) {
      sortEl.addEventListener('change', () =>
        reload(container, supplierId, 1, sortEl.value)
      );
    }

    /* Bind pagination */
    const prevBtn = container.querySelector('#sr-prev');
    const nextBtn = container.querySelector('#sr-next');
    if (prevBtn) prevBtn.addEventListener('click', () => reload(container, supplierId, page - 1, sortBy));
    if (nextBtn) nextBtn.addEventListener('click', () => reload(container, supplierId, page + 1, sortBy));

    /* Bind reply buttons */
    bindReplyButtons(container, supplierId);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Reply / edit-reply wiring
   * ──────────────────────────────────────────────────────────────────────── */

  function bindReplyButtons(container, supplierId) {
    /* Open reply form */
    container.querySelectorAll('.sr-reply-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const reviewId = btn.dataset.reviewId;
        const slot     = container.querySelector(`#sr-form-slot-${CSS.escape(reviewId)}`);
        if (!slot || slot.querySelector('.sr-reply-form')) return; // already open
        slot.innerHTML = replyFormHtml(reviewId, '');
        slot.querySelector(`#sr-reply-textarea-${CSS.escape(reviewId)}`)?.focus();
        bindFormEvents(container, slot, reviewId, false, supplierId);
      });
    });

    /* Open edit-reply form */
    container.querySelectorAll('.sr-edit-reply-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const reviewId  = btn.dataset.reviewId;
        const textEl    = container.querySelector(`#sr-response-text-${CSS.escape(reviewId)}`);
        const existing  = textEl?.textContent || '';
        const slot      = container.querySelector(`#sr-form-slot-${CSS.escape(reviewId)}`);
        if (!slot || slot.querySelector('.sr-reply-form')) return;
        slot.innerHTML = replyFormHtml(reviewId, existing);
        slot.querySelector(`#sr-reply-textarea-${CSS.escape(reviewId)}`)?.focus();
        bindFormEvents(container, slot, reviewId, true, supplierId);
      });
    });
  }

  function bindFormEvents(container, slot, reviewId, isEdit, supplierId) {
    const textarea   = slot.querySelector(`#sr-reply-textarea-${CSS.escape(reviewId)}`);
    const countEl    = slot.querySelector(`#sr-reply-count-${CSS.escape(reviewId)}`);
    const submitBtn  = slot.querySelector('.sr-reply-submit');
    const cancelBtn  = slot.querySelector('.sr-reply-cancel');
    const statusEl   = slot.querySelector(`#sr-reply-status-${CSS.escape(reviewId)}`);

    /* Character counter */
    if (textarea && countEl) {
      textarea.addEventListener('input', () => {
        countEl.textContent = `${textarea.value.length} / ${MAX_REPLY_CHARS}`;
      });
    }

    /* Cancel */
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        slot.innerHTML = '';
      });
    }

    /* Submit */
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const text = (textarea?.value || '').trim();
        if (!text) {
          if (statusEl) { statusEl.textContent = 'Please enter a reply.'; statusEl.style.color = '#ef4444'; }
          return;
        }

        submitBtn.disabled = true;
        if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = ''; }

        try {
          const token = await csrfToken();
          const method = isEdit ? 'PUT' : 'POST';
          const url    = `/api/v2/reviews/${encodeURIComponent(reviewId)}/response`;

          const res  = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            body: JSON.stringify({ text }),
          });

          const body = await res.json().catch(() => ({}));

          if (!res.ok) {
            if (statusEl) {
              statusEl.textContent = body.error || 'Failed to save reply.';
              statusEl.style.color = '#ef4444';
            }
            submitBtn.disabled = false;
            return;
          }

          /* Success — update the UI without a full reload */
          slot.innerHTML = '';
          const responseBlock = container.querySelector(`#sr-response-block-${CSS.escape(reviewId)}`);
          const footer        = container.querySelector(`#sr-footer-${CSS.escape(reviewId)}`);

          const now = new Date().toISOString();

          if (isEdit && responseBlock) {
            /* Update existing response text in-place */
            const textNode = responseBlock.querySelector(`#sr-response-text-${CSS.escape(reviewId)}`);
            if (textNode) textNode.textContent = text;
          } else {
            /* Inject a new response block */
            const card = container.querySelector(`#sr-card-${CSS.escape(reviewId)}`);
            if (card && footer) {
              const div = document.createElement('div');
              div.innerHTML = `
                <div class="sr-response" id="sr-response-block-${esc(reviewId)}">
                  <div class="sr-response-header">
                    <span class="sr-response-label">💬 Your reply</span>
                    <span class="sr-response-date">${fmtDate(now)}</span>
                  </div>
                  <p class="sr-response-text" id="sr-response-text-${esc(reviewId)}">${esc(text)}</p>
                  <button type="button" class="sr-edit-reply-btn" data-review-id="${esc(reviewId)}" aria-label="Edit your reply to this review">Edit reply</button>
                </div>`;
              card.insertBefore(div.firstElementChild, footer);

              /* Remove the "Reply" button */
              if (footer) footer.innerHTML = '';

              /* Bind only the newly-injected edit button — calling bindReplyButtons()
                 on the full container would re-attach listeners to every existing
                 reply button and cause duplicate event handlers. */
              const newEditBtn = card.querySelector(
                `#sr-response-block-${CSS.escape(reviewId)} .sr-edit-reply-btn`
              );
              if (newEditBtn) {
                newEditBtn.addEventListener('click', () => {
                  const slot2   = container.querySelector(`#sr-form-slot-${CSS.escape(reviewId)}`);
                  if (!slot2 || slot2.querySelector('.sr-reply-form')) return;
                  const textEl2 = container.querySelector(`#sr-response-text-${CSS.escape(reviewId)}`);
                  slot2.innerHTML = replyFormHtml(reviewId, textEl2?.textContent || '');
                  slot2.querySelector(`#sr-reply-textarea-${CSS.escape(reviewId)}`)?.focus();
                  bindFormEvents(container, slot2, reviewId, true, supplierId);
                });
              }
            }
          }

          /* Show brief confirmation */
          const confirmEl = document.createElement('span');
          confirmEl.className = 'sr-reply-confirm';
          confirmEl.textContent = isEdit ? '✓ Reply updated' : '✓ Reply posted';
          const insertTarget = (container.querySelector(`#sr-response-block-${CSS.escape(reviewId)}`) || container.querySelector(`#sr-card-${CSS.escape(reviewId)}`));
          if (insertTarget) {
            insertTarget.appendChild(confirmEl);
            setTimeout(() => confirmEl.remove(), 3000);
          }

        } catch (err) {
          if (statusEl) {
            statusEl.textContent = 'Network error — please try again.';
            statusEl.style.color = '#ef4444';
          }
          submitBtn.disabled = false;
        }
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Reload helper (sort / page change)
   * ──────────────────────────────────────────────────────────────────────── */

  async function reload(container, supplierId, page, sortBy) {
    container.innerHTML = `
      <div class="sr-loading" role="status" aria-label="Loading reviews">
        <span class="sr-spinner" aria-hidden="true"></span>
        <p>Loading reviews…</p>
      </div>`;

    try {
      const data = await fetchReviews(supplierId, page, sortBy);
      renderSection(container, data, page, sortBy, supplierId);
    } catch (err) {
      container.innerHTML = `
        <div class="sr-error" role="alert">
          <p>Unable to load reviews. Please refresh the page to try again.</p>
        </div>`;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Public entry point
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * Initialise the supplier review management panel.
   * @param {string} supplierId  The supplier's record ID
   * @param {string} containerId DOM ID of the section to render into
   */
  async function initSupplierReviews(supplierId, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !supplierId) return;

    await reload(container, supplierId, 1, 'recent');
  }

  /* Expose so dashboard-supplier-module.js can call it */
  window.SupplierReviews = { init: initSupplierReviews };
})();
