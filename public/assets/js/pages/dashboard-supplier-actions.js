document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('[data-action="create-profile"]');
  if (btn) {
    btn.addEventListener('click', () => {
      document.getElementById('sup-name').focus();
      document.getElementById('sup-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  const btnPkg = document.querySelector('[data-action="new-package"]');
  if (btnPkg) {
    btnPkg.addEventListener('click', () => {
      document.getElementById('pkg-title').focus();
      document.getElementById('pkg-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  const btnEarnings = document.querySelector('[data-action="view-earnings"]');
  if (btnEarnings) {
    btnEarnings.addEventListener('click', () => {
      showEarningsComingSoon();
    });
  }
  const btnStats = document.querySelector('[data-action="view-stats"]');
  if (btnStats) {
    btnStats.addEventListener('click', () => {
      document
        .getElementById('supplier-stats-grid')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
});
