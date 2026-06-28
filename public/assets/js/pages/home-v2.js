(() => {
  'use strict';

  // ── Elements ──────────────────────────────────────────────────────────
  const burger     = document.querySelector('.v2-burger');
  const mobileNav  = document.getElementById('v2-mobile-nav');
  const catSelect  = document.getElementById('v2-cat');
  const locInput   = document.getElementById('v2-loc');
  const chips      = document.querySelectorAll('.v2-chip[data-category]');
  const searchForm = document.querySelector('.v2-search');

  // ── Mobile menu ───────────────────────────────────────────────────────
  function closeNav() {
    if (!burger || !mobileNav) return;
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open navigation menu');
    mobileNav.hidden = true;
  }

  if (burger && mobileNav) {
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      burger.setAttribute('aria-label', open ? 'Open navigation menu' : 'Close navigation menu');
      mobileNav.hidden = open;
    });

    // Close when a nav link is tapped
    mobileNav.addEventListener('click', e => {
      if (e.target instanceof HTMLAnchorElement) closeNav();
    });

    // Close on Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeNav();
    });

    // Close when focus leaves the menu
    document.addEventListener('focusin', e => {
      if (
        !mobileNav.hidden &&
        !mobileNav.contains(e.target) &&
        e.target !== burger
      ) {
        closeNav();
      }
    });
  }

  // ── Popular chips → populate form and submit ──────────────────────────
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (catSelect) catSelect.value = chip.dataset.category || '';
      if (locInput && chip.dataset.location) locInput.value = chip.dataset.location;
      if (searchForm) searchForm.requestSubmit();
    });
  });

  // ── Search form: loading state ────────────────────────────────────────
  if (searchForm) {
    searchForm.addEventListener('submit', () => {
      const btn = searchForm.querySelector('.v2-search__btn');
      if (btn) {
        btn.setAttribute('aria-busy', 'true');
        btn.disabled = true;
      }
    });
  }
})();
