/**
 * Admin Campaigns Page — Initializer
 *
 * Wires up the campaign editor on /admin-campaigns:
 *   - Live debounced preview via POST /api/admin/campaigns/preview
 *   - Test send     via POST /api/admin/campaigns/test
 *   - Campaign send via POST /api/admin/campaigns/send
 *
 * All API calls go through AdminShared.api() so CSRF tokens and auth
 * headers are handled consistently with every other admin page.
 */

(function () {
  'use strict';

  // ── Debounce helper ────────────────────────────────────────────────────────
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let subjectEl, titleEl, messageEl, ctaTextEl, ctaUrlEl;
  let testEmailEl, testBtn, sendBtn, audienceEl;
  let previewFrame, refreshBtn, statusEl;

  // ── Collect current editor values ─────────────────────────────────────────
  function getEditorValues() {
    return {
      templateName: 'marketing',
      subject: subjectEl.value.trim(),
      title: titleEl.value.trim(),
      bodyHtml: messageEl.value,
      ctaText: ctaTextEl.value.trim(),
      ctaUrl: ctaUrlEl.value.trim(),
    };
  }

  // ── Live preview ──────────────────────────────────────────────────────────
  async function refreshPreview() {
    const values = getEditorValues();
    try {
      const data = await AdminShared.api('/api/admin/campaigns/preview', 'POST', values);
      if (data && data.html) {
        const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
        doc.open();
        doc.write(data.html);
        doc.close();
      }
    } catch (err) {
      // Preview errors are non-critical — silently ignore
    }
  }

  const debouncedRefreshPreview = debounce(refreshPreview, 400);

  // ── Status helpers ────────────────────────────────────────────────────────
  function setStatus(msg, type) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = msg;
    statusEl.className = `campaigns-status campaigns-status--${type}`;
  }

  function clearStatus() {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = '';
    statusEl.className = 'campaigns-status';
  }

  // ── Test send ─────────────────────────────────────────────────────────────
  async function handleTestSend() {
    const to = testEmailEl.value.trim();
    if (!to) {
      setStatus('Please enter a test email address.', 'error');
      return;
    }

    const values = getEditorValues();
    if (!values.subject) {
      setStatus('Please enter a subject line before sending a test.', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Sending…';
    clearStatus();

    try {
      await AdminShared.api('/api/admin/campaigns/test', 'POST', {
        to,
        ...values,
      });
      setStatus(`Test email sent to ${to}.`, 'success');
    } catch (err) {
      setStatus(err.message || 'Test send failed.', 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Send test';
    }
  }

  // ── Campaign send ─────────────────────────────────────────────────────────
  async function handleCampaignSend() {
    const values = getEditorValues();
    if (!values.subject) {
      setStatus('Please enter a subject line before sending.', 'error');
      return;
    }
    if (!values.title && !values.bodyHtml) {
      setStatus('Please enter a title or message before sending.', 'error');
      return;
    }

    const audience = audienceEl.value;

    const confirmed = await AdminShared.confirm(
      `Send campaign to all opted-in recipients (audience: ${audience})?`,
      { confirmText: 'Send campaign', danger: true }
    );
    if (!confirmed) {
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = '📣 Sending…';
    clearStatus();

    try {
      const result = await AdminShared.api('/api/admin/campaigns/send', 'POST', {
        audience,
        ...values,
      });
      const { sent = 0, skipped = 0, total = 0 } = result || {};
      setStatus(
        `Campaign sent. ${sent} delivered, ${skipped} skipped (unsubscribed/duplicate) out of ${total} recipients.`,
        'success'
      );
    } catch (err) {
      setStatus(err.message || 'Campaign send failed.', 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '📣 Send campaign';
    }
  }

  // ── Back button ───────────────────────────────────────────────────────────
  function initBackButton() {
    const btn = document.getElementById('backToDashboard');
    if (btn) {
      btn.addEventListener('click', () => {
        window.location.href = '/admin';
      });
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    subjectEl = document.getElementById('campaignSubject');
    titleEl = document.getElementById('campaignTitle');
    messageEl = document.getElementById('campaignMessage');
    ctaTextEl = document.getElementById('campaignCtaText');
    ctaUrlEl = document.getElementById('campaignCtaUrl');
    testEmailEl = document.getElementById('campaignTestEmail');
    testBtn = document.getElementById('campaignTestBtn');
    sendBtn = document.getElementById('campaignSendBtn');
    audienceEl = document.getElementById('campaignAudience');
    previewFrame = document.getElementById('campaignPreviewFrame');
    refreshBtn = document.getElementById('refreshPreviewBtn');
    statusEl = document.getElementById('campaignStatus');

    initBackButton();

    // Live preview on editor input
    [subjectEl, titleEl, messageEl, ctaTextEl, ctaUrlEl].forEach(el => {
      if (el) {
        el.addEventListener('input', debouncedRefreshPreview);
      }
    });

    // Manual refresh button
    if (refreshBtn) {
      refreshBtn.addEventListener('click', refreshPreview);
    }

    // Test send button
    if (testBtn) {
      testBtn.addEventListener('click', handleTestSend);
    }

    // Campaign send button
    if (sendBtn) {
      sendBtn.addEventListener('click', handleCampaignSend);
    }

    // Initial preview load with default content
    titleEl.value = 'Welcome to EventFlow';
    messageEl.value =
      'We have exciting news to share with you. Stay tuned for updates on new events and features coming to EventFlow.';
    refreshPreview();
  });
})();
