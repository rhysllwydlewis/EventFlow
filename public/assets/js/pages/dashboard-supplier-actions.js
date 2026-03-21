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

  // Copy review link button
  const copyReviewLinkBtn = document.getElementById('copyReviewLinkBtn');
  if (copyReviewLinkBtn) {
    copyReviewLinkBtn.addEventListener('click', async function () {
      // Try to get the supplier's profile slug for a direct-to-profile review link
      let url = `${window.location.origin}/suppliers`;
      try {
        const res = await fetch('/api/me/suppliers', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const slug = data.items?.[0]?.slug || data.items?.[0]?.id;
          if (slug) {
            url = `${window.location.origin}/suppliers/${slug}`;
          }
        }
      } catch (_e) {
        /* use fallback url */
      }
      const originalText = this.textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
          () => {
            if (typeof Toast !== 'undefined') {
              Toast.success('Review link copied!');
            } else {
              this.textContent = '✅ Copied!';
              setTimeout(() => {
                this.textContent = originalText;
              }, 2000);
            }
          },
          () => {
            window.prompt('Copy this link:', url);
          }
        );
      } else {
        window.prompt('Copy this link:', url);
      }
    });
  }
});
