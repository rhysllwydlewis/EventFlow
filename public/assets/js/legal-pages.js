/**
 * Legal pages — shared reading enhancements.
 *
 * The policy documents are long: the Terms run to 24 sections and the Privacy
 * Notice to 16, and until now neither offered any way to reach a section
 * without scrolling. This script adds, as a progressive enhancement:
 *
 *   - a contents navigation built from the headings already on the page
 *     (sticky sidebar on desktop, a collapsed disclosure on narrow screens);
 *   - a filter box, for the Legal Hub's twenty-odd sections;
 *   - scroll-spy highlighting of the section currently being read;
 *   - copyable anchor links on each heading; and
 *   - a reading-progress bar and a back-to-top control.
 *
 * Nothing here is required to read a policy. Every element above is generated
 * at runtime and its styles are scoped to classes that only exist once this has
 * run, so with JavaScript disabled each page keeps its plain document layout.
 * The rules in /assets/css/legal-pages.css that fix the document itself — the
 * mobile line-clamp override and the sticky containment — are deliberately not
 * scoped that way, because a reader without JavaScript needs them most.
 */
'use strict';

(function () {
  const FILTER_THRESHOLD = 12;
  const COLLAPSE_BREAKPOINT = '(max-width: 1024px)';
  // Matches --legal-header-offset in legal-pages.css.
  const HEADER_OFFSET = 88;
  /*
   * The line below which a heading counts as "being read". It has to sit a
   * little below every anchor landing position on these pages — 88px from
   * legal-pages.css, 100px from the Legal Hub's own `.legal-section` rule —
   * otherwise following a contents link lands the target just short of the line
   * and the previous section stays highlighted.
   */
  const SPY_LINE = HEADER_OFFSET + 32;

  /**
   * The Legal Hub already ships hand-written sections with stable ids and its
   * own sidebar; the long-form documents are a single card of `h2` headings
   * with no ids at all. Both shapes reduce to the same list of targets.
   */
  function collectSections() {
    const hubSections = document.querySelectorAll('main .legal-section[id]');
    if (hubSections.length) {
      return { mode: 'hub', sections: Array.from(hubSections) };
    }

    const card = document.querySelector('main .container > .card');
    if (!card) {
      return { mode: 'none', sections: [] };
    }

    const headings = Array.from(card.querySelectorAll(':scope > h2'));
    return { mode: 'document', sections: headings, card };
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  /** Assigns a document-unique id, keeping any id the markup already set. */
  function ensureId(element, fallbackIndex) {
    if (element.id) {
      return element.id;
    }
    const base = slugify(element.textContent) || `section-${fallbackIndex + 1}`;
    let candidate = base;
    let suffix = 2;
    while (document.getElementById(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    element.id = candidate;
    return candidate;
  }

  /** The label for a nav entry: a hub section's own `h2`, or the heading itself. */
  function labelFor(element, mode) {
    const source = mode === 'hub' ? element.querySelector('h2') || element : element;
    return source.textContent.replace(/\s+/g, ' ').trim();
  }

  function buildEntries(collected) {
    return collected.sections.map((element, index) => {
      const heading = collected.mode === 'hub' ? element.querySelector('h2') : element;
      return {
        id: ensureId(element, index),
        label: labelFor(element, collected.mode),
        target: element,
        heading,
      };
    });
  }

  function buildNavList(entries) {
    const list = document.createElement('ul');
    list.className = 'legal-nav__list';

    entries.forEach(entry => {
      const item = document.createElement('li');
      item.className = 'legal-nav__item';

      const link = document.createElement('a');
      link.className = 'legal-nav__link';
      link.href = `#${entry.id}`;
      link.textContent = entry.label;

      item.appendChild(link);
      list.appendChild(item);
      entry.link = link;
      entry.item = item;
    });

    return list;
  }

  function buildFilter(entries) {
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'legal-nav__filter';
    input.placeholder = 'Filter sections';
    input.setAttribute('aria-label', 'Filter sections');

    const empty = document.createElement('p');
    empty.className = 'legal-nav__empty';
    empty.textContent = 'No matching section.';
    empty.hidden = true;
    // Announced when a filter term matches nothing, which is otherwise a silent
    // empty list for anyone not looking at it.
    empty.setAttribute('role', 'status');

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      let matches = 0;

      entries.forEach(entry => {
        const hit = !query || entry.label.toLowerCase().includes(query);
        entry.item.hidden = !hit;
        if (hit) {
          matches += 1;
        }
      });

      empty.hidden = matches !== 0;
    });

    return { input, empty };
  }

  function buildNav(entries, headingId) {
    const inner = document.createElement('div');
    inner.className = 'legal-nav__inner';

    const title = document.createElement('p');
    title.className = 'legal-nav__title';
    title.id = headingId;
    title.textContent = 'On this page';
    inner.appendChild(title);

    const list = buildNavList(entries);

    if (entries.length >= FILTER_THRESHOLD) {
      const filter = buildFilter(entries);
      inner.appendChild(filter.input);
      inner.appendChild(list);
      inner.appendChild(filter.empty);
    } else {
      inner.appendChild(list);
    }

    const nav = document.createElement('nav');
    nav.className = 'legal-nav';
    nav.setAttribute('aria-labelledby', headingId);
    nav.appendChild(inner);
    return nav;
  }

  /**
   * On narrow screens a twenty-item list sitting above the document is worse
   * than no list at all, so the nav's contents move into a closed `<details>`.
   * The `<nav>` itself stays mounted either way, so the landmark, its label and
   * the scroll-spy links survive a resize across the breakpoint.
   */
  function applyResponsiveNav(nav) {
    const inner = nav.querySelector('.legal-nav__inner');

    const collapse = () => {
      if (nav.querySelector(':scope > details')) {
        return;
      }
      const details = document.createElement('details');
      details.className = 'legal-nav__disclosure';

      const summary = document.createElement('summary');
      summary.textContent = 'On this page';

      details.appendChild(summary);
      details.appendChild(inner);
      nav.appendChild(details);
      nav.classList.add('legal-nav--collapsed');
    };

    const expand = () => {
      const details = nav.querySelector(':scope > details');
      if (!details) {
        return;
      }
      nav.appendChild(inner);
      details.remove();
      nav.classList.remove('legal-nav--collapsed');
    };

    if (!window.matchMedia) {
      return;
    }

    const query = window.matchMedia(COLLAPSE_BREAKPOINT);
    const sync = () => (query.matches ? collapse() : expand());
    sync();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync);
    } else if (typeof query.addListener === 'function') {
      query.addListener(sync);
    }
  }

  function addHeadingAnchors(entries) {
    entries.forEach(entry => {
      if (!entry.heading || entry.heading.querySelector('.legal-anchor')) {
        return;
      }
      entry.target.classList.add('legal-anchored');

      const anchor = document.createElement('a');
      anchor.className = 'legal-anchor';
      anchor.href = `#${entry.id}`;
      anchor.textContent = '#';
      anchor.setAttribute('aria-label', `Link to “${entry.label}”`);
      entry.heading.appendChild(anchor);
    });
  }

  /**
   * Marks the section being read. This is measured from scroll position rather
   * than with an IntersectionObserver, because in document mode the targets are
   * bare `h2` headings: a few pixels tall, and never simultaneously visible in
   * the way whole sections are. The last heading to have passed the top of the
   * viewport is the one whose text is on screen.
   */
  function setupScrollSpy(entries) {
    let currentId = null;

    return () => {
      let activeId = entries.length ? entries[0].id : null;

      entries.forEach(entry => {
        if (entry.target.getBoundingClientRect().top <= SPY_LINE) {
          activeId = entry.id;
        }
      });

      // Once the page is scrolled to the bottom no further heading can cross the
      // line, so the last section would never light up on a short final block.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && entries.length) {
        activeId = entries[entries.length - 1].id;
      }

      if (activeId === currentId) {
        return;
      }
      currentId = activeId;

      entries.forEach(entry => {
        if (entry.id === activeId) {
          entry.link.setAttribute('aria-current', 'true');
        } else {
          entry.link.removeAttribute('aria-current');
        }
      });
    };
  }

  function setupProgressBar() {
    const wrapper = document.createElement('div');
    wrapper.className = 'legal-progress';
    wrapper.setAttribute('aria-hidden', 'true');

    const bar = document.createElement('div');
    bar.className = 'legal-progress__bar';
    wrapper.appendChild(bar);
    document.body.appendChild(wrapper);

    const update = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
      bar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    };

    return update;
  }

  function setupBackToTop() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'legal-top';
    button.setAttribute('aria-label', 'Back to top');
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

    button.addEventListener('click', () => {
      const reduceMotion =
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      const heading = document.querySelector('main h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    });

    document.body.appendChild(button);

    return () => {
      button.classList.toggle('legal-top--visible', window.scrollY > 600);
    };
  }

  function onScroll(callbacks) {
    let queued = false;
    const run = () => {
      queued = false;
      callbacks.forEach(callback => callback());
    };
    window.addEventListener(
      'scroll',
      () => {
        if (queued) {
          return;
        }
        queued = true;
        window.requestAnimationFrame(run);
      },
      { passive: true }
    );
    run();
  }

  function init() {
    const collected = collectSections();
    if (collected.sections.length < 3) {
      return;
    }

    const entries = buildEntries(collected);
    addHeadingAnchors(entries);

    if (collected.mode === 'document') {
      // The hub already has a hand-written sidebar; only the plain documents
      // need one generated, and only they need the surrounding grid.
      const card = collected.card;
      const layout = document.createElement('div');
      layout.className = 'legal-doc-layout';
      card.parentNode.insertBefore(layout, card);
      layout.appendChild(card);

      const nav = buildNav(entries, 'legal-contents-heading');
      layout.insertBefore(nav, card);
      applyResponsiveNav(nav);
    } else {
      // The hub's sidebar is hand-written, so its links are adopted rather than
      // generated; scroll-spy then drives the same elements.
      document.querySelectorAll('.legal-toc a[href^="#"]').forEach(link => {
        const id = link.getAttribute('href').slice(1);
        const entry = entries.find(candidate => candidate.id === id);
        if (entry) {
          entry.link = link;
        }
      });
    }

    const spy = setupScrollSpy(entries.filter(entry => entry.link));
    onScroll([spy, setupProgressBar(), setupBackToTop()]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
