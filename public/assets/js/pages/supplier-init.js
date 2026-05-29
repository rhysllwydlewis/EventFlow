(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const supplierId = params.get('id');
    const isPreview = params.get('preview') === 'true';

    function loadProfilePolish() {
      if (document.getElementById('supplier-profile-public-polish-script')) {
        return;
      }
      const script = document.createElement('script');
      script.id = 'supplier-profile-public-polish-script';
      script.src = '/assets/js/pages/supplier-profile-public-polish.js?v=1.0.0';
      script.defer = true;
      document.body.appendChild(script);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadProfilePolish);
    } else {
      loadProfilePolish();
    }

    if (supplierId && !isPreview) {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'profile_view', supplierId: supplierId }),
      }).catch(() => {});
    }
  } catch (e) {
    /* ignore */
  }
})();
