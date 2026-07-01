(() => {
  'use strict';

  const iconStyle = document.createElement('style');
  iconStyle.textContent = [
    '.hv2-nav a svg{margin-left:8px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.7;vertical-align:middle}',
    '.hv2-proof-card__icon svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}',
  ].join('');
  document.head.append(iconStyle);

  const menuButton = document.querySelector('.hv2-menu');
  const mobileNav = document.getElementById('hv2-mobile-nav');
  const categoryField = document.getElementById('hv2-category');
  const searchForm = document.querySelector('.hv2-search');
  const popularButtons = document.querySelectorAll('.hv2-popular button[data-category]');

  function closeMenu() {
    if (!menuButton || !mobileNav) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation menu');
    mobileNav.hidden = true;
  }

  if (menuButton && mobileNav) {
    menuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      menuButton.setAttribute(
        'aria-label',
        isOpen ? 'Open navigation menu' : 'Close navigation menu'
      );
      mobileNav.hidden = isOpen;
    });

    mobileNav.addEventListener('click', event => {
      if (event.target instanceof HTMLAnchorElement) closeMenu();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });

    document.addEventListener('focusin', event => {
      if (
        !mobileNav.hidden &&
        !mobileNav.contains(event.target) &&
        event.target !== menuButton
      ) {
        closeMenu();
      }
    });
  }

  popularButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (categoryField) {
        categoryField.value = button.dataset.category || '';
      }
      if (searchForm) {
        searchForm.requestSubmit();
      }
    });
  });

  if (searchForm) {
    searchForm.addEventListener('submit', () => {
      const submitButton = searchForm.querySelector('.hv2-search__button');
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
      }
    });
  }
})();
