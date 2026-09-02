// Initialize core utilities
'use strict';
(function () {
  function loadHomepageStabilisationStyles() {
    if (document.getElementById('ef-home-stabilisation-css')) {
      return;
    }

    const link = document.createElement('link');
    link.id = 'ef-home-stabilisation-css';
    link.rel = 'stylesheet';
    link.href = '/assets/css/home-stabilisation.css?v=18.3.1';
    document.head.appendChild(link);
  }

  function loadHomepageStabilisation() {
    if (window.__homepageStabilisationLoading) {
      return;
    }
    window.__homepageStabilisationLoading = true;

    loadHomepageStabilisationStyles();

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
