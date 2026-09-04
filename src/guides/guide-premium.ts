/**
 * EventFlow — Premium Guide Template runtime.
 *
 * Progressive enhancement only: the article is fully readable with this file
 * blocked. Everything here is additive (scrollspy, animated figures, heading
 * permalinks, share and print; reveal-on-scroll is pure CSS) and every animation
 * is skipped when the visitor prefers reduced motion.
 *
 * This runtime is deliberately subject-agnostic: it drives blocks any article
 * may use, and each initialiser no-ops when its markup is absent, so an article
 * only pays for the blocks it actually includes. Anything specific to one
 * article's subject belongs in its own module beside this one — see
 * `guide-travel-calculator.ts`.
 *
 * Source of truth is `src/guides/guide-premium.ts`; the browser file at
 * `public/assets/js/pages/guide-premium.js` is compiled via `npm run build:guides`.
 */

(() => {
  const articleRoot = document.querySelector<HTMLElement>('[data-gp-article]');
  if (!articleRoot) {
    return;
  }
  // Rebind after the guard: the hoisted initialisers below are declared before
  // this narrowing in source order, so under `strict` they would otherwise see
  // the nullable type again.
  const root: HTMLElement = articleRoot;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Round to `places` decimals without float drift showing up in the UI. */
  function round(value: number, places = 2): number {
    const factor = 10 ** places;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  /* ── Reading state ────────────────────────────────────────────────────
     One rAF-throttled scroll pass drives both the progress dial and the
     section highlight, so the two can never disagree about where you are. */
  function initReadingState(): void {
    const list = document.querySelector<HTMLElement>('[data-gp-toc]');
    const ringBar = document.querySelector<SVGCircleElement>('[data-gp-ring]');
    const ringLabel = document.querySelector<HTMLElement>('[data-gp-ring-pct]');
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-gp-section]'));

    if (!list && !ringBar && !ringLabel) {
      return;
    }

    const links = new Map<string, HTMLAnchorElement>();
    list?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        links.set(href.slice(1), link);
      }
    });

    const circumference = ringBar ? 2 * Math.PI * Number(ringBar.getAttribute('r')) : 0;
    if (ringBar) {
      ringBar.style.setProperty('--gp-ring-circumference', String(round(circumference, 2)));
    }

    let activeId = '';
    let queued = false;

    function setActive(id: string): void {
      if (!list || id === activeId) {
        return;
      }
      activeId = id;

      links.forEach(link => link.classList.remove('is-active'));
      const link = links.get(id);
      if (!link) {
        // Above the first heading — no section is being read yet.
        list.style.setProperty('--gp-toc-o', '0');
        return;
      }
      link.classList.add('is-active');

      // Slide the rail marker onto the active row.
      const item = link.parentElement ?? link;
      list.style.setProperty('--gp-toc-y', `${item.offsetTop}px`);
      list.style.setProperty('--gp-toc-h', `${item.offsetHeight}px`);
      list.style.setProperty('--gp-toc-o', '1');
    }

    /** The section whose heading has most recently crossed the reading line. */
    function currentSectionId(): string {
      if (!sections.length) {
        return '';
      }
      const doc = document.documentElement;
      // The bottom of the page always belongs to the final section, however short.
      if (window.scrollY + window.innerHeight >= doc.scrollHeight - 4) {
        return sections[sections.length - 1].id;
      }

      const line = window.scrollY + window.innerHeight * 0.3;
      let current = '';
      for (const section of sections) {
        if (section.getBoundingClientRect().top + window.scrollY <= line) {
          current = section.id;
        }
      }
      return current;
    }

    function update(): void {
      queued = false;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const progress = scrollable > 0 ? clamp(doc.scrollTop / scrollable, 0, 1) : 0;

      if (ringBar) {
        ringBar.style.strokeDashoffset = String(round(circumference * (1 - progress), 2));
      }
      if (ringLabel) {
        ringLabel.textContent = `${Math.round(progress * 100)}%`;
      }
      setActive(currentSectionId());
    }

    function onScroll(): void {
      if (queued) {
        return;
      }
      queued = true;
      requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ── Animated figures ─────────────────────────────────────────────────
     Counts a statistic up to its published value the first time it scrolls
     into view. The literal value is already in the DOM for crawlers. */
  function initCountUp(): void {
    const stats = Array.from(root.querySelectorAll<HTMLElement>('[data-gp-count]'));
    if (!stats.length || prefersReducedMotion) {
      return;
    }

    function run(el: HTMLElement): void {
      const target = Number(el.dataset.gpCount);
      if (!Number.isFinite(target)) {
        return;
      }
      const decimals = Number(el.dataset.gpDecimals ?? 0);
      const prefix = el.dataset.gpPrefix ?? '';
      const suffix = el.dataset.gpSuffix ?? '';
      const duration = 1100;
      const start = performance.now();

      function frame(now: number): void {
        const progress = clamp((now - start) / duration, 0, 1);
        // easeOutExpo — fast out of the gate, gentle landing.
        const eased = progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
        el.textContent = `${prefix}${(target * eased).toFixed(decimals)}${suffix}`;
        if (progress < 1) {
          requestAnimationFrame(frame);
        }
      }

      requestAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) {
            return;
          }
          run(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.6 }
    );

    stats.forEach(el => observer.observe(el));
  }

  /* ── Heading permalinks ───────────────────────────────────────────────
     Adds a copy-link affordance to each section heading. */
  function initHeadingAnchors(): void {
    root.querySelectorAll<HTMLElement>('[data-gp-section] .gp-section__head').forEach(head => {
      const section = head.closest<HTMLElement>('[data-gp-section]');
      const heading = head.querySelector('h2');
      if (!section?.id || !heading) {
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gp-anchor';
      button.setAttribute('aria-label', `Copy link to “${heading.textContent?.trim() ?? ''}”`);
      button.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';

      button.addEventListener('click', () => {
        const url = `${window.location.origin}${window.location.pathname}#${section.id}`;
        copyText(url).then(ok => {
          if (ok) {
            flash(button);
          }
          history.replaceState(null, '', `#${section.id}`);
        });
      });

      heading.insertAdjacentElement('afterend', button);
    });
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function flash(el: HTMLElement): void {
    el.classList.add('is-done');
    window.setTimeout(() => el.classList.remove('is-done'), 1600);
  }

  /* ── Rail share buttons ───────────────────────────────────────────────── */
  function initRailShare(): void {
    const button = document.querySelector<HTMLButtonElement>('[data-gp-copy-page]');
    if (!button) {
      return;
    }

    const original = button.innerHTML;
    button.addEventListener('click', () => {
      copyText(button.dataset.gpCopyPage || window.location.href).then(ok => {
        button.innerHTML = ok
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>'
          : original;
        button.classList.toggle('is-done', ok);
        window.setTimeout(() => {
          button.innerHTML = original;
          button.classList.remove('is-done');
        }, 1800);
      });
    });
  }

  /* ── Print ────────────────────────────────────────────────────────────
     One control, two homes: the sticky rail on desktop and the foot of the
     article below the rail's breakpoint. CSS shows whichever fits, so only one
     is ever visible; binding both keeps that a styling decision rather than a
     scripting one. */
  function initPrint(): void {
    root.querySelectorAll<HTMLElement>('[data-gp-print]').forEach(control => {
      control.addEventListener('click', () => window.print());
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────────────── */
  initReadingState();
  initCountUp();
  initHeadingAnchors();
  initRailShare();
  initPrint();
})();
