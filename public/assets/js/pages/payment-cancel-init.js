/**
 * Payment Cancel Page — EventFlow
 * Handles analytics logging, session tracking, and UX on payment cancellation.
 */
'use strict';
(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');
  const planParam = urlParams.get('plan') || '';

  // ── Analytics: log the cancellation ──────────────────────────────────────
  function logCancellation() {
    try {
      const payload = {
        event: 'payment_cancelled',
        sessionId: sessionId || null,
        plan: planParam || null,
        timestamp: new Date().toISOString(),
        referrer: document.referrer || null,
      };

      // Fire-and-forget — don't block UX on analytics failure
      fetch('/api/v1/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        /* ignore analytics errors */
      });
    } catch (_) {
      // Never let analytics crash the page
    }
  }

  // ── Wire up the retry button with the correct plan ────────────────────────
  function wireRetryButton() {
    const retryLink = document.querySelector('a[href="/checkout"]');
    if (retryLink && planParam) {
      // Restore the plan query parameter so user doesn't have to re-select
      retryLink.href = `/checkout?plan=${encodeURIComponent(planParam)}`;
    }
  }

  // ── Update the page's action buttons based on URL context ─────────────────
  function updateActionButtons() {
    // If we know which plan was being attempted, make the retry CTA more specific
    const btnContainer = document.querySelector('.action-buttons');
    if (!btnContainer || !planParam) {
      return;
    }

    const planNames = { pro: 'Pro', pro_plus: 'Pro Plus', free: 'Free' };
    const planLabel = planNames[planParam] || 'Your Plan';
    const retryBtn = btnContainer.querySelector('a[href*="checkout"]');
    if (retryBtn) {
      retryBtn.textContent = `Try ${planLabel} Again`;
      retryBtn.href = `/checkout?plan=${encodeURIComponent(planParam)}`;
    }
  }

  // ── Initialise ───────────────────────────────────────────────────────────
  logCancellation();
  wireRetryButton();
  updateActionButtons();
})();
