/**
 * Supplier verification dialog.
 *
 * The strip that says "Get verified", "In review" or "Changes are needed" is drawn by
 * supplier-dashboard-home.js from the dashboard summary. This script owns the dialog that strip
 * opens (#sv-verification-modal, a native <dialog> in the page): it pre-fills the supplier's
 * details, asks for the ones the server requires, and posts them to
 * POST /api/supplier/verification/submit.
 *
 * Public surface: window.SupplierVerification.open(profile, options). Pass
 * { rejectionNotes } to open it as a resubmission with the reviewer's notes shown.
 */
'use strict';
(function () {
  const FIELD_IDS = ['name', 'category', 'phone', 'location', 'email'];
  const FIELD_LABELS = {
    name: 'Business name',
    category: 'Category',
    phone: 'Phone',
    location: 'Location',
    email: 'Contact email',
  };

  /** Shorthand for document.getElementById. */
  const byId = key => document.getElementById(key);

  /** Shows a message in one of the dialog's message boxes, or hides it when the text is empty. */
  function setMessage(key, text) {
    const box = byId(key);
    if (!box) {
      return;
    }
    box.textContent = text || '';
    box.hidden = !text;
  }

  /**
   * Posts the request. The dashboard's own write helper is used when it is there: it fetches the
   * CSRF token and tries once more with a fresh one if the server refuses a stale token.
   */
  async function post(body) {
    const url = '/api/supplier/verification/submit';
    const home = window.SupplierDashboardHome;
    if (home && typeof home.sendJson === 'function') {
      return home.sendJson(url, 'POST', body);
    }
    const token = await csrfToken();
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      data: await response.json().catch(() => ({})),
    };
  }

  /** A fresh CSRF token, for the case where the dashboard's write helper is not on the page. */
  async function csrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    try {
      const response = await fetch('/api/csrf-token', { credentials: 'include' });
      const data = response.ok ? await response.json() : {};
      return data.csrfToken || data.token || '';
    } catch {
      return '';
    }
  }

  /** Puts the dialog back to its starting state and fills it from the supplier's profile. */
  function prepare(profile, options) {
    const source = profile || {};
    const values = {
      name: source.name,
      category: source.category,
      phone: source.phone,
      location: source.location || source.venuePostcode,
      email: source.email,
    };
    FIELD_IDS.forEach(field => {
      const input = byId(`sv-${field}`);
      if (input) {
        input.value = values[field] || '';
        input.removeAttribute('aria-invalid');
      }
    });
    setMessage('sv-modal-error', '');
    setMessage('sv-modal-success', '');
    byId('sv-fields').hidden = false;

    const resubmit = options && options.rejectionNotes !== undefined;
    const notes = resubmit ? String(options.rejectionNotes || '') : '';
    const notesBlock = byId('sv-rejection-notes-block');
    byId('sv-rejection-notes-text').textContent = notes;
    notesBlock.hidden = !notes;
    byId('sv-supplier-note-block').hidden = !resubmit;
    byId('sv-supplier-note').value = '';
    byId('sv-modal-title').textContent = resubmit
      ? 'Resubmit for verification'
      : 'Submit for verification';
    byId('sv-modal-subtitle').textContent = resubmit
      ? 'Read our notes, update your details if you need to, and send your profile for review again.'
      : 'Confirm your details and send your profile to our team for review.';
    const submitButton = byId('sv-submit-btn');
    submitButton.dataset.mode = resubmit ? 'resubmit' : 'submit';
    submitButton.textContent = resubmit ? 'Resubmit for verification' : 'Submit for verification';
    submitButton.hidden = false;
    submitButton.disabled = false;
    byId('sv-cancel-btn').textContent = 'Cancel';
  }

  /** Opens the dialog for the given profile. */
  function open(profile, options) {
    const dialog = byId('sv-verification-modal');
    if (!dialog) {
      return;
    }
    prepare(profile, options || {});
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
    }
    byId('sv-name').focus();
  }

  /** Closes the dialog. */
  function close() {
    const dialog = byId('sv-verification-modal');
    if (dialog && typeof dialog.close === 'function') {
      dialog.close();
    } else if (dialog) {
      dialog.removeAttribute('open');
    }
  }

  /** Shows that the request went through, hides the form and leaves a Close button. */
  function showDone(message) {
    setMessage('sv-modal-success', message);
    byId('sv-fields').hidden = true;
    byId('sv-submit-btn').hidden = true;
    byId('sv-cancel-btn').textContent = 'Close';
    const home = window.SupplierDashboardHome;
    if (home && typeof home.refresh === 'function') {
      home.refresh();
    }
  }

  /** Validates the five required fields, posts them, and shows what the server said. */
  async function submit(event) {
    event.preventDefault();
    setMessage('sv-modal-error', '');
    const body = {};
    const missing = [];
    FIELD_IDS.forEach(field => {
      const input = byId(`sv-${field}`);
      body[field] = input ? input.value.trim() : '';
      if (!body[field]) {
        missing.push(FIELD_LABELS[field]);
        input?.setAttribute('aria-invalid', 'true');
      } else {
        input?.removeAttribute('aria-invalid');
      }
    });
    if (missing.length) {
      setMessage('sv-modal-error', `These fields are required: ${missing.join(', ')}.`);
      return;
    }
    const note = byId('sv-supplier-note').value.trim();
    if (note) {
      body.supplierNote = note;
    }

    const button = byId('sv-submit-btn');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
      const response = await post(body);
      const data = response.data || {};
      if (response.status === 409) {
        showDone(data.error || 'Your verification is already in review or approved.');
      } else if (response.status === 403 && data.code === 'VERIFICATION_MAX_REJECTIONS') {
        setMessage(
          'sv-modal-error',
          data.error ||
            'You have reached the most verification requests allowed. Please contact support.'
        );
      } else if (!response.ok) {
        const missingFields = Array.isArray(data.missingFields) ? data.missingFields : [];
        setMessage(
          'sv-modal-error',
          missingFields.length
            ? `Please complete your profile first. Missing: ${missingFields.join(', ')}.`
            : data.error || 'Could not send your request. Please try again.'
        );
      } else {
        showDone(
          data.autoApproved === true
            ? 'Your profile has been verified and approved.'
            : data.message || 'Sent. We will review your profile and email you when it is decided.'
        );
      }
    } catch {
      setMessage('sv-modal-error', 'Network error. Check your connection and try again.');
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  /** Wires the dialog's form and buttons once the page is parsed. */
  function init() {
    const form = byId('sv-verification-form');
    if (!form) {
      return;
    }
    form.addEventListener('submit', submit);
    byId('sv-cancel-btn').addEventListener('click', close);
    byId('sv-modal-close').addEventListener('click', close);
    byId('sv-verification-modal').addEventListener('click', event => {
      // A click on the backdrop lands on the dialog element itself.
      if (event.target === byId('sv-verification-modal')) {
        close();
      }
    });
  }

  window.SupplierVerification = { open };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
