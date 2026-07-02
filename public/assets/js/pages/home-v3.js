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

    const timers = new Set();
    let activeGuide = null;
    let userStartedSearch = false;

    function queue(callback, delay) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);

      timers.add(timer);
      return timer;
    }

    function clearQueued(timer) {
      window.clearTimeout(timer);
      timers.delete(timer);
    }

    function nextFrame(callback) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(callback);
        return;
      }

      queue(callback, 16);
    }

    function buildGuide({ variant, label, title, body }) {
      const guide = document.createElement('div');
      guide.className = `hv3-hero-guide hv3-hero-guide--${variant}`;
      guide.setAttribute('aria-hidden', 'true');
      guide.innerHTML = `
        <div class="hv3-hero-guide__note">
          <span class="hv3-hero-guide__label">${label}</span>
          <strong>${title}</strong>
          <p>${body}</p>
        </div>
        <span class="hv3-hero-guide__pointer" aria-hidden="true"></span>
        <span class="hv3-hero-guide__arrow hv3-hero-guide__arrow--one" aria-hidden="true"></span>
        <span class="hv3-hero-guide__arrow hv3-hero-guide__arrow--two" aria-hidden="true"></span>
        <span class="hv3-hero-guide__arrow hv3-hero-guide__arrow--three" aria-hidden="true"></span>
      `;

      return guide;
    }

    function hideGuide(guide, onRemoved) {
      if (!guide || guide.dataset.dismissed === 'true') {
        return;
      }

      guide.dataset.dismissed = 'true';
      guide.classList.remove('is-visible');
      guide.classList.add('is-hiding');

      queue(() => {
        guide.remove();
        if (activeGuide === guide) {
          activeGuide = null;
        }
        if (typeof onRemoved === 'function') {
          onRemoved();
        }
      }, 700);
    }

    function showGuide(config, duration, onRemoved) {
      const guide = buildGuide(config);
      activeGuide = guide;
      hero.appendChild(guide);

      nextFrame(() => {
        if (document.body.contains(guide)) {
          guide.classList.add('is-visible');
        }
      });

      queue(() => hideGuide(guide, onRemoved), duration);
      return guide;
    }

    function showSignUpGuide() {
      if (userStartedSearch) {
        return;
      }

      showGuide(
        {
          variant: 'signup',
          label: 'Join free',
          title: 'Save your plans today',
          body: 'Create your EventFlow account to keep favourites, messages and supplier shortlists together.',
        },
        5600
      );
    }

    const showTimer = queue(() => {
      showGuide(
        {
          variant: 'search',
          label: 'Quick guide',
          title: 'Start with the search',
          body: 'Choose your event type, add a location, then click Search suppliers to find the right people faster.',
        },
        6400,
        () => queue(showSignUpGuide, 850)
      );
    }, 1000);

    const searchForm = document.querySelector('.hv2-search');

    if (searchForm) {
      const dismissForSearch = () => {
        userStartedSearch = true;
        clearQueued(showTimer);
        hideGuide(activeGuide);
      };

      searchForm.addEventListener('focusin', dismissForSearch, { once: true });
      searchForm.addEventListener('submit', dismissForSearch, { once: true });
    }

    window.addEventListener(
      'pagehide',
      () => {
        timers.forEach(timer => window.clearTimeout(timer));
        timers.clear();
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
