'use strict';
(function () {
  function issueUrl(widget) {
    const slug = widget.dataset.guideSlug || window.location.pathname.split('/').pop();
    const title = encodeURIComponent(`[Report] Guide: ${slug}`);
    const body = encodeURIComponent(
      `I found an issue in ${window.location.href}:\n\nWhat looks outdated or incorrect?\n\nSuggested update:\n`
    );
    return `https://github.com/rhysllwydlewis/EventFlow/issues/new?title=${title}&labels=content,guides&body=${body}`;
  }

  function track(eventName, params) {
    if (window.EFAnalytics && typeof window.EFAnalytics.track === 'function') {
      window.EFAnalytics.track(eventName, params);
    }
  }

  function initWidget(widget) {
    const status = widget.querySelector('[data-feedback-status]');
    const slug = widget.dataset.guideSlug || '';
    const reportLink = widget.querySelector('[data-report-outdated]');
    if (reportLink) {
      reportLink.href = issueUrl(widget);
    }

    widget.addEventListener('click', event => {
      const button = event.target.closest('[data-feedback-value]');
      if (!button) {
        return;
      }
      const value = button.dataset.feedbackValue;
      widget.querySelectorAll('[data-feedback-value]').forEach(el => {
        el.setAttribute('aria-pressed', el === button ? 'true' : 'false');
      });
      if (status) {
        status.textContent =
          value === 'yes'
            ? 'Thanks — glad it helped.'
            : 'Thanks — tell us what to improve using the report link.';
      }
      track('feedback_submitted', { guide_slug: slug, helpful: value });
    });

    if (reportLink) {
      reportLink.addEventListener('click', () => {
        track('feedback_submitted', { guide_slug: slug, helpful: 'report_outdated' });
      });
    }
  }

  function init() {
    document.querySelectorAll('[data-guide-feedback]').forEach(initWidget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
