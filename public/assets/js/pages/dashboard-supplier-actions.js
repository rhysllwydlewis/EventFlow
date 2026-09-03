document.addEventListener('DOMContentLoaded', () => {
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

  function activateSection(sectionId) {
    const pill = document.querySelector(`.mobile-nav-pill[data-section="${sectionId}"]`);
    if (pill) {
      pill.click();
      return true;
    }

    const section = document.getElementById(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
      return true;
    }
    return false;
  }

  function expandForm(sectionId, toggleId) {
    const section = document.getElementById(sectionId);
    const toggle = document.getElementById(toggleId);
    if (section && !section.classList.contains('expanded') && toggle) {
      toggle.click();
    }
  }

  function scrollToProfileForm() {
    expandForm('profile-form-section', 'toggle-profile-form');
    const supName = document.getElementById('sup-name');
    if (supName) {
      supName.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
      supName.focus();
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
  document.querySelectorAll('[data-action="new-package"]').forEach(btnPkg => {
    btnPkg.addEventListener('click', event => {
      event.preventDefault();
      expandForm('package-form-section', 'toggle-package-form');
      const packageTitle = document.getElementById('pkg-title');
      if (packageTitle) {
        packageTitle.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
        packageTitle.focus();
      }
    });
  });
  const btnEarnings = document.querySelector('[data-action="view-earnings"]');
  if (btnEarnings) {
    btnEarnings.addEventListener('click', () => {
      const earningsSection = document.getElementById('earnings-overview');
      if (!earningsSection) {
        showEarningsComingSoon();
        return;
      }
      // Match view-stats/get-help: land the supplier on the real section
      // instead of only popping a toast with no way to see it in context.
      const collapseBtn = earningsSection.querySelector(':scope > .card-collapse-btn');
      if (collapseBtn && collapseBtn.getAttribute('aria-expanded') === 'false') {
        collapseBtn.click();
      }
      earningsSection.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
    });
  }
  const btnStats = document.querySelector('[data-action="view-stats"]');
  if (btnStats) {
    btnStats.addEventListener('click', () => {
      activateSection('supplier-stats-grid');
    });
  }

  const btnGetHelp = document.querySelector('[data-action="get-help"]');
  if (btnGetHelp) {
    btnGetHelp.addEventListener('click', () => {
      activateSection('tickets-sup');
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
      } catch {
        /* use fallback url */
      }
      const originalText = this.textContent;
      let copied = false;
      let copyField = null;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          copied = true;
        } else {
          copyField = document.createElement('textarea');
          copyField.value = url;
          copyField.setAttribute('readonly', '');
          copyField.style.position = 'fixed';
          copyField.style.opacity = '0';
          document.body.appendChild(copyField);
          copyField.select();
          copied = document.execCommand('copy');
        }
      } catch {
        copied = false;
      } finally {
        copyField?.remove();
      }

      if (typeof showToast === 'function') {
        showToast(
          copied ? 'Review link copied!' : 'Could not copy the review link. Please try again.',
          copied ? 'success' : 'error'
        );
      } else {
        this.textContent = copied ? '✅ Copied!' : 'Copy failed — try again';
        setTimeout(() => {
          this.textContent = originalText;
        }, 2000);
      }
    });
  }
});
