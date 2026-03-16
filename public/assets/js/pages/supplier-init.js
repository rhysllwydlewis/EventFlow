(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const supplierId = params.get('id');
    if (supplierId) {
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
