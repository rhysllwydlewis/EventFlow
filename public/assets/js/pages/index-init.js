// Initialize core utilities
(function () {
  'use strict';

  function loadHomepageStabilisation() {
    if (window.__homepageStabilisationLoading) {
      return;
    }
    window.__homepageStabilisationLoading = true;

    const script = document.createElement('script');
    script.src = '/assets/js/pages/home-stabilisation.js?v=18.3.1';
    script.defer = true;
    document.head.appendChild(script);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Initialize error boundary only when the component is available.
    if (typeof ErrorBoundary === 'function') {
      window.errorBoundary = new ErrorBoundary({
        showErrorDetails: window.location.hostname === 'localhost',
      });
    }

    loadHomepageStabilisation();
  });
})();
