/**
 * Admin Campaigns Page — Automated Recurring Newsletter panel
 *
 * Reads/writes settings.newsletterAutomation via GET/PUT
 * /api/admin/campaigns/automation, consumed by
 * services/newsletterCadenceScheduler.js. Isolated from
 * admin-campaigns-init.js's manual composer/send flow — separate config,
 * separate save action.
 */

'use strict';
(function () {
  let enabledEl,
    cadenceEl,
    dayOfWeekWrapEl,
    dayOfWeekEl,
    dayOfMonthWrapEl,
    dayOfMonthEl,
    audienceEl,
    subjectEl,
    titleEl,
    bodyHtmlEl,
    ctaTextEl,
    ctaUrlEl,
    saveBtn,
    statusEl,
    lastSentEl;

  function setStatus(msg, type) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = msg;
    statusEl.style.color = type === 'error' ? '#ef4444' : '#10b981';
  }

  function updateCadenceFieldVisibility() {
    const isWeekly = cadenceEl.value === 'weekly';
    dayOfWeekWrapEl.style.display = isWeekly ? '' : 'none';
    dayOfMonthWrapEl.style.display = isWeekly ? 'none' : '';
  }

  function populate(automation) {
    if (!automation) {
      return;
    }
    enabledEl.checked = automation.enabled === true;
    if (automation.cadence) {
      cadenceEl.value = automation.cadence;
    }
    if (automation.dayOfWeek !== undefined && automation.dayOfWeek !== null) {
      dayOfWeekEl.value = String(automation.dayOfWeek);
    }
    if (automation.dayOfMonth !== undefined && automation.dayOfMonth !== null) {
      dayOfMonthEl.value = String(automation.dayOfMonth);
    }
    if (automation.audience) {
      audienceEl.value = automation.audience;
    }
    subjectEl.value = automation.subject || '';
    titleEl.value = automation.title || '';
    bodyHtmlEl.value = automation.bodyHtml || '';
    ctaTextEl.value = automation.ctaText || '';
    ctaUrlEl.value = automation.ctaUrl || '';
    updateCadenceFieldVisibility();

    if (automation.lastSentAt) {
      const sentDate = new Date(automation.lastSentAt);
      const stats = automation.lastRunStats || {};
      lastSentEl.textContent = `Last sent ${sentDate.toLocaleString()} — ${stats.sent || 0} delivered, ${stats.failed || 0} failed.`;
    } else {
      lastSentEl.textContent = 'Never sent automatically yet.';
    }
  }

  async function loadAutomation() {
    try {
      const result = await window.AdminShared.api('/api/admin/campaigns/automation', 'GET');
      populate(result && result.automation);
    } catch {
      setStatus('Could not load automation settings.', 'error');
    }
  }

  async function saveAutomation() {
    saveBtn.disabled = true;
    setStatus('Saving…', 'success');
    try {
      const payload = {
        enabled: enabledEl.checked,
        cadence: cadenceEl.value,
        dayOfWeek: Number(dayOfWeekEl.value),
        dayOfMonth: Number(dayOfMonthEl.value),
        audience: audienceEl.value,
        subject: subjectEl.value.trim(),
        title: titleEl.value.trim(),
        bodyHtml: bodyHtmlEl.value,
        ctaText: ctaTextEl.value.trim(),
        ctaUrl: ctaUrlEl.value.trim(),
      };
      const result = await window.AdminShared.api(
        '/api/admin/campaigns/automation',
        'PUT',
        payload
      );
      populate(result && result.automation);
      setStatus('✓ Automation settings saved', 'success');
    } catch (err) {
      const msg = err && err.message ? err.message : 'Failed to save automation settings.';
      setStatus(msg, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    enabledEl = document.getElementById('automationEnabled');
    cadenceEl = document.getElementById('automationCadence');
    dayOfWeekWrapEl = document.getElementById('automationDayOfWeekWrap');
    dayOfWeekEl = document.getElementById('automationDayOfWeek');
    dayOfMonthWrapEl = document.getElementById('automationDayOfMonthWrap');
    dayOfMonthEl = document.getElementById('automationDayOfMonth');
    audienceEl = document.getElementById('automationAudience');
    subjectEl = document.getElementById('automationSubject');
    titleEl = document.getElementById('automationTitle');
    bodyHtmlEl = document.getElementById('automationBodyHtml');
    ctaTextEl = document.getElementById('automationCtaText');
    ctaUrlEl = document.getElementById('automationCtaUrl');
    saveBtn = document.getElementById('automationSaveBtn');
    statusEl = document.getElementById('automationStatus');
    lastSentEl = document.getElementById('automationLastSent');

    if (!saveBtn) {
      return;
    }

    cadenceEl.addEventListener('change', updateCadenceFieldVisibility);
    saveBtn.addEventListener('click', saveAutomation);

    if (window.__CSRF_TOKEN__) {
      loadAutomation();
    } else {
      window.AdminShared.fetchCSRFToken().then(loadAutomation).catch(loadAutomation);
    }
  });
})();
