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

'use strict';
(function () {
  // ── Debounce helper ────────────────────────────────────────────────────────
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let subjectEl,
    titleEl,
    messageEl,
    introEl,
    bodyTextEl,
    featureListEl,
    bannerUrlEl,
    secondaryNoteEl,
    ctaTextEl,
    ctaUrlEl;
  let testEmailEl, testBtn, sendBtn, audienceEl;
  let previewFrame, previewLoading, refreshBtn, statusEl;
  let recipientBannerText, subjectCharCounter, audienceCountEl;
  let previewDesktopBtn, previewMobileBtn;

  // ── Collect current editor values ─────────────────────────────────────────
  function getEditorValues() {
    return {
      templateName: 'marketing',
      subject: subjectEl ? subjectEl.value.trim() : '',
      title: titleEl ? titleEl.value.trim() : '',
      bodyHtml: messageEl ? messageEl.value : '',
      intro: introEl ? introEl.value.trim() : '',
      bodyText: bodyTextEl ? bodyTextEl.value : '',
      featureList: featureListEl ? featureListEl.value : '',
      bannerUrl: bannerUrlEl ? bannerUrlEl.value.trim() : '',
      secondaryNote: secondaryNoteEl ? secondaryNoteEl.value.trim() : '',
      ctaText: ctaTextEl ? ctaTextEl.value.trim() : '',
      ctaUrl: ctaUrlEl ? ctaUrlEl.value.trim() : '',
    };
  }

  // ── Preview loading indicator ─────────────────────────────────────────────
  function showPreviewLoading() {
    if (previewLoading) {
      previewLoading.classList.remove('hidden');
    }
    if (previewFrame) {
      previewFrame.classList.remove('loaded');
    }
  }

  function hidePreviewLoading() {
    if (previewLoading) {
      previewLoading.classList.add('hidden');
    }
    if (previewFrame) {
      previewFrame.classList.add('loaded');
    }
  }

  // ── Live preview ──────────────────────────────────────────────────────────
  async function refreshPreview() {
    const values = getEditorValues();
    showPreviewLoading();
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
    } finally {
      hidePreviewLoading();
    }
  }

  const debouncedRefreshPreview = debounce(refreshPreview, 400);

  // ── Recipient banner ──────────────────────────────────────────────────────
  async function loadRecipientCount() {
    if (!recipientBannerText) {
      return;
    }
    try {
      const data = await AdminShared.api('/api/admin/campaigns/recipient-count', 'GET');
      if (data && typeof data.total === 'number') {
        recipientBannerText.textContent = `${data.total.toLocaleString()} opted-in recipient${data.total !== 1 ? 's' : ''} across all audiences`;
      }
    } catch (_err) {
      recipientBannerText.textContent = 'Recipient count unavailable';
    }
  }

  // Update the per-audience count helper text below the audience dropdown
  async function updateAudienceCount() {
    if (!audienceCountEl || !audienceEl) {
      return;
    }
    const audience = audienceEl.value;
    audienceCountEl.className = 'campaigns-help-text';
    audienceCountEl.textContent = 'Counting…';
    try {
      // The backend /recipient-count endpoint counts "both"; for individual
      // audiences we pass the param as a query string if the route supports it,
      // otherwise we display the top-level count as an approximation.
      const data = await AdminShared.api(
        `/api/admin/campaigns/recipient-count?audience=${encodeURIComponent(audience)}`,
        'GET'
      );
      const total = data && typeof data.total === 'number' ? data.total : null;
      if (total === null) {
        audienceCountEl.textContent = '';
      } else if (total === 0) {
        audienceCountEl.className = 'campaigns-help-text campaigns-count--zero';
        audienceCountEl.textContent = 'No recipients in this audience.';
      } else {
        audienceCountEl.textContent = `${total.toLocaleString()} recipient${total !== 1 ? 's' : ''} in this audience`;
      }
    } catch {
      audienceCountEl.textContent = '';
    }
  }

  // ── CTA URL validation ─────────────────────────────────────────────────────
  function validateCtaUrl() {
    if (!ctaUrlEl) {
      return true;
    }
    const url = ctaUrlEl.value.trim();
    const text = ctaTextEl ? ctaTextEl.value.trim() : '';
    if (url && !/^https?:\/\//i.test(url)) {
      ctaUrlEl.classList.add('campaigns-input--error');
      return false;
    }
    if (url && !text) {
      // URL without text — flag the text field
      ctaUrlEl.classList.remove('campaigns-input--error');
      return false;
    }
    ctaUrlEl.classList.remove('campaigns-input--error');
    return true;
  }

  // ── Status helpers ────────────────────────────────────────────────────────
  function setStatus(msg, type) {
    if (!statusEl) {
      return;
    }
    const icon = type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : '';
    statusEl.textContent = icon + msg;
    statusEl.className = `campaigns-status campaigns-status--${type}`;
    // Scroll status into view smoothly so it's visible even on smaller screens
    statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearStatus() {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = '';
    statusEl.className = 'campaigns-status';
  }

  // ── Subject character counter ─────────────────────────────────────────────
  function updateCharCounter() {
    if (!subjectEl || !subjectCharCounter) {
      return;
    }
    const len = subjectEl.value.length;
    const max = parseInt(subjectEl.getAttribute('maxlength') || '200', 10);
    subjectCharCounter.textContent = `${len} / ${max}`;
    subjectCharCounter.className = 'campaigns-char-counter';
    if (len >= max) {
      subjectCharCounter.classList.add('campaigns-char-counter--danger');
    } else if (len >= max * 0.85) {
      subjectCharCounter.classList.add('campaigns-char-counter--warn');
    }
  }

  // ── Test send ─────────────────────────────────────────────────────────────
  async function handleTestSend() {
    const to = testEmailEl ? testEmailEl.value.trim() : '';
    if (!to) {
      setStatus('Please enter a test email address.', 'error');
      return;
    }

    // Basic client-side email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setStatus('Please enter a valid email address.', 'error');
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
      setStatus(`✓ Test email sent to ${to}.`, 'success');
    } catch (err) {
      const msg = err && err.message ? err.message : 'Test send failed. Please try again.';
      setStatus(msg, 'error');
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
    const audienceLabel = audienceEl.options[audienceEl.selectedIndex].text;

    const subjectPreview = values.subject ? `"${values.subject}"` : '(no subject)';
    const confirmed = await AdminShared.showConfirmModal({
      title: 'Send campaign — are you sure?',
      message: `Subject: ${subjectPreview}\nAudience: ${audienceLabel}\n\nThis will send immediately to all opted-in recipients. This action cannot be undone.`,
      confirmText: 'Send campaign',
      cancelText: 'Cancel',
      type: 'danger',
    });
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
        `✓ Campaign sent. ${sent} delivered, ${skipped} skipped out of ${total} recipients.`,
        'success'
      );
    } catch (err) {
      const msg = err && err.message ? err.message : 'Campaign send failed. Please try again.';
      setStatus(msg, 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '📣 Send campaign';
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    subjectEl = document.getElementById('campaignSubject');
    titleEl = document.getElementById('campaignTitle');
    messageEl = document.getElementById('campaignMessage');
    introEl = document.getElementById('campaignIntro');
    bodyTextEl = document.getElementById('campaignBodyText');
    featureListEl = document.getElementById('campaignFeatureList');
    bannerUrlEl = document.getElementById('campaignBannerUrl');
    secondaryNoteEl = document.getElementById('campaignSecondaryNote');
    ctaTextEl = document.getElementById('campaignCtaText');
    ctaUrlEl = document.getElementById('campaignCtaUrl');
    testEmailEl = document.getElementById('campaignTestEmail');
    testBtn = document.getElementById('campaignTestBtn');
    sendBtn = document.getElementById('campaignSendBtn');
    audienceEl = document.getElementById('campaignAudience');
    previewFrame = document.getElementById('campaignPreviewFrame');
    previewLoading = document.getElementById('previewLoading');
    refreshBtn = document.getElementById('refreshPreviewBtn');
    statusEl = document.getElementById('campaignStatus');
    recipientBannerText = document.getElementById('recipientBannerText');
    subjectCharCounter = document.getElementById('subjectCharCounter');
    audienceCountEl = document.getElementById('audienceCount');
    previewDesktopBtn = document.getElementById('previewDesktopBtn');
    previewMobileBtn = document.getElementById('previewMobileBtn');

    // Live preview on editor input
    [
      subjectEl,
      titleEl,
      introEl,
      bodyTextEl,
      featureListEl,
      bannerUrlEl,
      messageEl,
      secondaryNoteEl,
      ctaTextEl,
      ctaUrlEl,
    ].forEach(el => {
      if (el) {
        el.addEventListener('input', debouncedRefreshPreview);
      }
    });

    // Subject character counter
    if (subjectEl) {
      subjectEl.addEventListener('input', updateCharCounter);
    }

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

    // Audience change → refresh count
    if (audienceEl) {
      audienceEl.addEventListener('change', () => {
        updateAudienceCount();
        debouncedRefreshPreview();
      });
    }

    // CTA URL validation on change
    if (ctaUrlEl) {
      ctaUrlEl.addEventListener('input', validateCtaUrl);
      ctaUrlEl.addEventListener('blur', validateCtaUrl);
    }

    // Preview device toggle
    if (previewDesktopBtn && previewMobileBtn && previewFrame) {
      previewDesktopBtn.addEventListener('click', () => {
        previewFrame.classList.remove('campaigns-preview-frame--mobile');
        previewDesktopBtn.classList.add('campaigns-device-btn--active');
        previewDesktopBtn.setAttribute('aria-pressed', 'true');
        previewMobileBtn.classList.remove('campaigns-device-btn--active');
        previewMobileBtn.setAttribute('aria-pressed', 'false');
      });
      previewMobileBtn.addEventListener('click', () => {
        previewFrame.classList.add('campaigns-preview-frame--mobile');
        previewMobileBtn.classList.add('campaigns-device-btn--active');
        previewMobileBtn.setAttribute('aria-pressed', 'true');
        previewDesktopBtn.classList.remove('campaigns-device-btn--active');
        previewDesktopBtn.setAttribute('aria-pressed', 'false');
      });
    }

    // Initial default content
    if (subjectEl) {
      subjectEl.value = 'News from EventFlow';
      updateCharCounter();
    }
    if (titleEl) {
      titleEl.value = 'Welcome to EventFlow';
    }
    if (introEl) {
      introEl.value = 'We have useful updates to share from the EventFlow team.';
    }
    if (bodyTextEl) {
      bodyTextEl.value =
        'We have improved planning tools and supplier discovery to help you organise your next event with more confidence.';
    }
    if (featureListEl) {
      featureListEl.value =
        'Clearer supplier comparison\nUpdated planning guidance\nMore relevant reminders';
    }

    // Load recipient count immediately; delay initial preview until the CSRF
    // token fetch has resolved. Although the preview endpoint itself does not
    // require CSRF, ensuring the token is available before the first network
    // request means subsequent state-changing calls (/test, /send) can fire
    // immediately without waiting for a token round-trip.
    loadRecipientCount();
    updateAudienceCount();
    if (window.__CSRF_TOKEN__) {
      refreshPreview();
    } else {
      AdminShared.fetchCSRFToken().then(refreshPreview).catch(refreshPreview);
    }
  });
})();
