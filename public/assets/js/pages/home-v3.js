(() => {
  'use strict';

  window.__EF_HOME_V3_PREVIEW__ = true;
  window.__collageWidgetInitialized = true;

  function initialiseEventTypeSelect() {
    const select = document.querySelector('[data-hv3-event-select]');
    const input = document.getElementById('hv2-event-type');

    if (!select || !input) {
      return;
    }

    const trigger = select.querySelector('[data-hv3-select-button]');
    const label = select.querySelector('[data-hv3-event-label]');
    const menu = select.querySelector('[data-hv3-select-menu]');
    const options = Array.from(select.querySelectorAll('[data-hv3-event-option]'));

    if (!trigger || !label || !menu || options.length === 0) {
      return;
    }

    function closeMenu() {
      menu.hidden = true;
      select.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
      menu.hidden = false;
      select.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    function chooseOption(option) {
      const value = option.dataset.value || '';
      const text = option.textContent.trim();

      input.value = value;
      label.textContent = text || 'e.g. Wedding';

      options.forEach(item => {
        item.setAttribute('aria-selected', String(item === option));
      });

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      closeMenu();
      trigger.focus();
    }

    trigger.addEventListener('click', () => {
      if (menu.hidden) {
        openMenu();
        return;
      }

      closeMenu();
    });

    options.forEach(option => {
      option.addEventListener('click', () => chooseOption(option));
    });

    select.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeMenu();
        trigger.focus();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        if (menu.hidden) {
          event.preventDefault();
          openMenu();
          options[0].focus();
          return;
        }
      }

      if (event.key === 'ArrowDown' && !menu.hidden) {
        event.preventDefault();
        const currentIndex = options.indexOf(document.activeElement);
        options[(currentIndex + 1) % options.length].focus();
      }

      if (event.key === 'ArrowUp' && !menu.hidden) {
        event.preventDefault();
        const currentIndex = options.indexOf(document.activeElement);
        const nextIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
        options[nextIndex].focus();
      }
    });

    document.addEventListener('click', event => {
      if (!select.contains(event.target)) {
        closeMenu();
      }
    });
  }

  function initialiseHeroGuide() {
    const hero = document.querySelector('.hv2-hero');
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!hero || prefersReducedMotion) {
      return;
    }

    const nudge = document.createElement('div');
    nudge.className = 'hv3-hero-guide';
    nudge.setAttribute('aria-hidden', 'true');
    nudge.innerHTML = `
      <div class="hv3-hero-guide__note">
        <span class="hv3-hero-guide__label">Quick guide</span>
        <strong>Start with the search</strong>
        <p>Choose your event type, add a location, then click Search suppliers. Sign up after to save favourites and messages.</p>
      </div>
      <span class="hv3-hero-guide__pointer" aria-hidden="true"></span>
    `;

    hero.appendChild(nudge);

    let showTimer;
    let hideTimer;
    let removeTimer;
    let isDismissed = false;

    function dismissGuide() {
      if (isDismissed) {
        return;
      }

      isDismissed = true;
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      nudge.classList.remove('is-visible');
      nudge.classList.add('is-hiding');
      removeTimer = window.setTimeout(() => nudge.remove(), 700);
    }

    showTimer = window.setTimeout(() => {
      if (isDismissed || !document.body.contains(nudge)) {
        return;
      }

      nudge.classList.add('is-visible');
      hideTimer = window.setTimeout(dismissGuide, 6500);
    }, 5000);

    const searchForm = document.querySelector('.hv2-search');

    if (searchForm) {
      searchForm.addEventListener('focusin', dismissGuide, { once: true });
      searchForm.addEventListener('submit', dismissGuide, { once: true });
    }

    window.addEventListener(
      'pagehide',
      () => {
        window.clearTimeout(showTimer);
        window.clearTimeout(hideTimer);
        window.clearTimeout(removeTimer);
      },
      { once: true }
    );
  }

  function initialiseHomeV3() {
    initialiseEventTypeSelect();
    initialiseHeroGuide();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseHomeV3);
  } else {
    initialiseHomeV3();
  }
})();
