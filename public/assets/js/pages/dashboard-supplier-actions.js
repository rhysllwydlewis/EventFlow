document.addEventListener('DOMContentLoaded', () => {
  function scrollToProfileForm() {
    const supName = document.getElementById('sup-name');
    if (supName) {
      supName.scrollIntoView({ behavior: 'smooth', block: 'center' });
      supName.focus();
    }
    // Expand the profile form section if it isn't already open
    const profileFormSection = document.getElementById('profile-form-section');
    if (profileFormSection && !profileFormSection.classList.contains('expanded')) {
      const toggleBtn = document.getElementById('toggle-profile-form');
      if (toggleBtn) {
        toggleBtn.click();
      }
    }
  }

  const btn = document.querySelector('[data-action="create-profile"]');
  if (btn) {
    btn.addEventListener('click', scrollToProfileForm);
  }
  // Also handle the chip after it has been relabelled to "Edit Profile" by loadSuppliers()
  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="edit-profile-chip"]')) {
      scrollToProfileForm();
    }
  });
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

  const btnGetHelp = document.querySelector('[data-action="get-help"]');
  if (btnGetHelp) {
    btnGetHelp.addEventListener('click', () => {
      const ticketsSection = document.getElementById('tickets-sup');
      if (ticketsSection) {
        ticketsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Activate the Tickets pill in the mobile nav if visible
      const ticketsPill = document.querySelector('.mobile-nav-pill[data-section="tickets-sup"]');
      if (ticketsPill) {
        document.querySelectorAll('.mobile-nav-pill').forEach(p => p.classList.remove('active'));
        ticketsPill.classList.add('active');
      }
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
