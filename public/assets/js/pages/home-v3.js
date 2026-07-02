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
    const compactViewport =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 960px)').matches;

    if (!hero || prefersReducedMotion || compactViewport) {
      return;
    }

    const timers = new Set();
    let activeGuide = null;
    let userStartedSearch = false;
    const GUIDE_FADE_MS = 860;
    const GUIDE_PADDING = 18;

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
      `;

      return guide;
    }

    function isVisibleElement(element) {
      if (!element) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function findByText(selector, pattern) {
      return Array.from(document.querySelectorAll(selector)).find(element => {
        return isVisibleElement(element) && pattern.test((element.textContent || '').trim());
      });
    }

    function findGuideTarget(variant) {
      if (variant === 'search') {
        return document.querySelector('.hv2-search__button');
      }

      return (
        document.querySelector('a[href="/login"], a[href="/login.html"], a[href*="/login"]') ||
        findByText('a, button', /^(log in|login|sign in)$/i)
      );
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function placeGuide(guide, target, variant) {
      if (!guide || !target || !isVisibleElement(target)) {
        return;
      }

      const guideRect = guide.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const guideWidth = guideRect.width || 320;
      const guideHeight = guideRect.height || 150;
      const targetCenterX = targetRect.left + targetRect.width / 2;
      const maxLeft = window.innerWidth - guideWidth - GUIDE_PADDING;
      const left = clamp(targetCenterX - guideWidth / 2, GUIDE_PADDING, Math.max(GUIDE_PADDING, maxLeft));
      let top;

      if (variant === 'signup') {
        top = targetRect.bottom + 30;
      } else {
        top = targetRect.top - guideHeight - 42;
        if (top < GUIDE_PADDING) {
          top = targetRect.bottom + 30;
        }
      }

      const maxTop = window.innerHeight - guideHeight - GUIDE_PADDING;
      top = clamp(top, GUIDE_PADDING, Math.max(GUIDE_PADDING, maxTop));

      const pointerLeft = clamp(targetCenterX - left, 28, guideWidth - 28);
      const pointerLength =
        variant === 'signup'
          ? clamp(top - targetRect.bottom - 11, 24, 72)
          : clamp(targetRect.top - (top + guideHeight) - 11, 24, 72);

      guide.style.left = `${left}px`;
      guide.style.top = `${top}px`;
      guide.style.setProperty('--hv3-pointer-left', `${pointerLeft}px`);
      guide.style.setProperty('--hv3-pointer-length', `${pointerLength}px`);
    }

    function hideGuide(guide, onRemoved) {
      if (!guide || guide.dataset.dismissed === 'true') {
        return;
      }

      guide.dataset.dismissed = 'true';
      guide.classList.remove('is-visible');
      guide.classList.add('is-hiding');

      if (guide._target) {
        guide._target.classList.remove('hv3-guide-target');
      }

      if (guide._placeGuide) {
        window.removeEventListener('resize', guide._placeGuide);
        window.removeEventListener('scroll', guide._placeGuide, true);
      }

      queue(() => {
        guide.remove();
        if (activeGuide === guide) {
          activeGuide = null;
        }
        if (typeof onRemoved === 'function') {
          onRemoved();
        }
      }, GUIDE_FADE_MS);
    }

    function showGuide(config, duration, onRemoved) {
      const target = findGuideTarget(config.variant);

      if (!target || !isVisibleElement(target)) {
        if (typeof onRemoved === 'function') {
          onRemoved();
        }
        return null;
      }

      const guide = buildGuide(config);
      activeGuide = guide;
      guide._target = target;
      document.body.appendChild(guide);

      const updatePosition = () => placeGuide(guide, target, config.variant);
      guide._placeGuide = updatePosition;
      target.classList.add('hv3-guide-target');
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);

      nextFrame(() => {
        if (document.body.contains(guide)) {
          updatePosition();
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

    document.addEventListener('click', event => {
      if (event.target.closest('.hv2-search__button, a[href*="/login"]')) {
        hideGuide(activeGuide);
      }
    });

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
