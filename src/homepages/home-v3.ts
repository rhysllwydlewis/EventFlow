(() => {
  'use strict';

  /**
   * The public settings endpoint exposes selected uploads in
   * collageWidget.mediaLibrary.selectedUploads. The V3 player historically
   * consumed only the legacy uploadGallery array when source === "uploads".
   * Normalise the response at the page boundary so newly assigned uploads are
   * playable immediately without requiring a legacy duplicate record.
   */
  function installHomepageUploadBridge() {
    if (window.__efHomepageUploadBridgeInstalled || typeof window.fetch !== 'function') {
      return;
    }

    const nativeFetch = window.fetch.bind(window);
    window.__efHomepageUploadBridgeInstalled = true;

    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (!requestUrl.includes('/api/v1/public/homepage-settings')) {
        return response;
      }

      window.fetch = nativeFetch;
      try {
        const data = await response.clone().json();
        const widget = data?.collageWidget;
        const selectedUploads = Array.isArray(widget?.selectedMedia)
          ? widget.selectedMedia
          : Array.isArray(widget?.mediaLibrary?.selectedUploads)
            ? widget.mediaLibrary.selectedUploads
            : [];

        if (widget?.source === 'uploads' && selectedUploads.length) {
          const selectedVideoUrls = selectedUploads
            .filter(item => item?.type === 'video' && typeof item.url === 'string' && item.url)
            .map(item => item.url);
          const legacyUrls = Array.isArray(widget.uploadGallery) ? widget.uploadGallery : [];
          widget.uploadGallery = Array.from(new Set([...selectedVideoUrls, ...legacyUrls]));
        }

        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (_) {
        return response;
      }
    };
  }

  installHomepageUploadBridge();

  window.__EF_HOME_V3_PREVIEW__ = true;
  window.__collageWidgetInitialized = true;

  function initialiseEventTypeSelect() {
    const select = document.querySelector<HTMLElement>('[data-hv3-event-select]');
    const input = document.getElementById('hv2-event-type') as HTMLInputElement | null;

    if (!select || !input) {
      return;
    }

    const trigger = select.querySelector<HTMLButtonElement>('[data-hv3-select-button]');
    const label = select.querySelector<HTMLElement>('[data-hv3-event-label]');
    const menu = select.querySelector<HTMLElement>('[data-hv3-select-menu]');
    const options = Array.from(
      select.querySelectorAll<HTMLButtonElement>('[data-hv3-event-option]')
    );

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

    select.addEventListener('keydown', (event: KeyboardEvent) => {
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
        const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
        options[(currentIndex + 1) % options.length].focus();
      }

      if (event.key === 'ArrowUp' && !menu.hidden) {
        event.preventDefault();
        const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
        options[nextIndex].focus();
      }
    });

    document.addEventListener('click', event => {
      const target = event.target;
      if (target instanceof Node && !select.contains(target)) {
        closeMenu();
      }
    });
  }

  function initialiseMobileNavigationSwap() {
    const body = document.body;
    const header = document.querySelector('.ef-header');
    const bottomNav = document.querySelector('.ef-bottom-nav');

    if (!body || !body.classList.contains('home-v3-page') || !header || !bottomNav) {
      return;
    }

    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const mobileQuery = window.matchMedia('(max-width: 960px)');
    const SCROLL_THRESHOLD = 92;
    let ticking = false;

    function getScrollY() {
      return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    }

    function syncNavigationState() {
      ticking = false;

      if (!mobileQuery.matches) {
        body.classList.remove('hv3-mobile-nav-active');
        return;
      }

      body.classList.toggle('hv3-mobile-nav-active', getScrollY() > SCROLL_THRESHOLD);
    }

    function requestSync() {
      if (ticking) {
        return;
      }

      ticking = true;

      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(syncNavigationState);
        return;
      }

      window.setTimeout(syncNavigationState, 16);
    }

    function handleQueryChange() {
      syncNavigationState();
    }

    syncNavigationState();
    window.addEventListener('scroll', requestSync, { passive: true });
    window.addEventListener('resize', requestSync, { passive: true });

    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', handleQueryChange);
    } else if (typeof mobileQuery.addListener === 'function') {
      mobileQuery.addListener(handleQueryChange);
    }

    window.addEventListener(
      'pagehide',
      () => {
        window.removeEventListener('scroll', requestSync);
        window.removeEventListener('resize', requestSync);

        if (typeof mobileQuery.removeEventListener === 'function') {
          mobileQuery.removeEventListener('change', handleQueryChange);
        } else if (typeof mobileQuery.removeListener === 'function') {
          mobileQuery.removeListener(handleQueryChange);
        }
      },
      { once: true }
    );
  }

  function initialiseHeroGuide() {
    const hero = document.querySelector('.hv2-hero');
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const compactViewport =
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 960px)').matches;

    if (!hero || prefersReducedMotion || compactViewport) {
      return;
    }

    const timers = new Set<number>();
    let activeGuide: HTMLElement | null = null;
    let userStartedSearch = false;
    let guideSequenceStopped = false;
    const GUIDE_FADE_MS = 860;
    const GUIDE_PADDING = 18;
    const GUIDE_SEARCH_GAP = 22;
    const SCROLL_DISMISS_THRESHOLD = 14;
    const startScrollY = getScrollY();

    function getScrollY() {
      return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    }

    function queue(callback: () => void, delay: number) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);

      timers.add(timer);
      return timer;
    }

    function clearQueued(timer: number) {
      window.clearTimeout(timer);
      timers.delete(timer);
    }

    function nextFrame(callback: () => void) {
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
      `;

      return guide;
    }

    function isVisibleElement(element: Element | null): element is HTMLElement {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function findByText(selector: string, pattern: RegExp): HTMLElement | undefined {
      return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => {
        return isVisibleElement(element) && pattern.test((element.textContent || '').trim());
      });
    }

    function findGuideTarget(variant: string): HTMLElement | null | undefined {
      if (variant === 'search') {
        return document.querySelector<HTMLButtonElement>('.hv2-search__button');
      }

      return (
        document.querySelector<HTMLAnchorElement>(
          'a[href="/login"], a[href="/login.html"], a[href*="/login"]'
        ) ||
        findByText('a, button', /^(log in|login|sign in)$/i)
      );
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function findGuideAvoidRect(target: HTMLElement, variant: string) {
      if (variant !== 'search') {
        return target.getBoundingClientRect();
      }

      const searchPanel = target.closest('.hv2-search');
      if (!searchPanel || !isVisibleElement(searchPanel)) {
        return target.getBoundingClientRect();
      }

      return searchPanel.getBoundingClientRect();
    }

    function placeGuide(
      guide: HTMLElement,
      target: HTMLElement,
      variant: string,
      measuredTargetRect?: DOMRect
    ) {
      if (!guide || !target || !isVisibleElement(target)) {
        return;
      }

      const guideRect = guide.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const avoidRect =
        variant === 'search' && measuredTargetRect ? measuredTargetRect : findGuideAvoidRect(target, variant);
      const guideWidth = guideRect.width || 320;
      const guideHeight = guideRect.height || 150;
      const targetCenterX = targetRect.left + targetRect.width / 2;
      const maxLeft = window.innerWidth - guideWidth - GUIDE_PADDING;
      const left = clamp(
        targetCenterX - guideWidth / 2,
        GUIDE_PADDING,
        Math.max(GUIDE_PADDING, maxLeft)
      );
      let top;

      if (variant === 'signup') {
        top = targetRect.bottom + 20;
      } else if (variant === 'search') {
        top = avoidRect.top - guideHeight - GUIDE_SEARCH_GAP;
        if (top < GUIDE_PADDING) {
          top = avoidRect.bottom + GUIDE_SEARCH_GAP;
        }
      } else {
        top = targetRect.top - guideHeight - 20;
        if (top < GUIDE_PADDING) {
          top = targetRect.bottom + 20;
        }
      }

      const maxTop = window.innerHeight - guideHeight - GUIDE_PADDING;
      top = clamp(top, GUIDE_PADDING, Math.max(GUIDE_PADDING, maxTop));

      guide.style.left = `${left}px`;
      guide.style.top = `${top}px`;
    }

    function hideGuide(guide: HTMLElement | null, onRemoved?: () => void) {
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

    function stopGuideSequence() {
      guideSequenceStopped = true;
      userStartedSearch = true;
      clearQueued(showTimer);
      window.removeEventListener('scroll', dismissForScroll);
      hideGuide(activeGuide);
    }

    function dismissForScroll() {
      if (getScrollY() > startScrollY + SCROLL_DISMISS_THRESHOLD) {
        stopGuideSequence();
      }
    }

    function showGuide(config, duration: number, onRemoved?: () => void) {
      if (guideSequenceStopped) {
        return null;
      }

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
      const initialRect =
        config.variant === 'search' ? findGuideAvoidRect(target, config.variant) : target.getBoundingClientRect();
      placeGuide(guide, target, config.variant, initialRect);
      window.addEventListener('resize', updatePosition);

      nextFrame(() => {
        if (document.body.contains(guide)) {
          target.classList.add('hv3-guide-target');
          guide.classList.add('is-visible');
        }
      });

      queue(() => hideGuide(guide, onRemoved), duration);
      return guide;
    }

    function showSignUpGuide() {
      if (userStartedSearch || guideSequenceStopped) {
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

    const searchForm = document.querySelector<HTMLFormElement>('.hv2-search');

    if (searchForm) {
      searchForm.addEventListener('focusin', stopGuideSequence, { once: true });
      searchForm.addEventListener('submit', stopGuideSequence, { once: true });
    }

    document.addEventListener('click', event => {
      if (
        event.target instanceof Element &&
        event.target.closest('.hv2-search__button, a[href*="/login"]')
      ) {
        stopGuideSequence();
      }
    });

    window.addEventListener('scroll', dismissForScroll, { passive: true });

    window.addEventListener(
      'pagehide',
      () => {
        timers.forEach(timer => window.clearTimeout(timer));
        timers.clear();
        window.removeEventListener('scroll', dismissForScroll);
      },
      { once: true }
    );
  }

  function initialiseHomeV3() {
    initialiseEventTypeSelect();
    initialiseMobileNavigationSwap();
    initialiseHeroGuide();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseHomeV3);
  } else {
    initialiseHomeV3();
  }
})();
