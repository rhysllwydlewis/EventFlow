'use strict';
/**
 * EventFlow — Premium Guide Template runtime.
 *
 * Progressive enhancement only: the article is fully readable with this file
 * blocked. Everything here is additive (scrollspy, animated figures, heading
 * permalinks, the fuel/mileage calculator; reveal-on-scroll is pure CSS) and every animation is skipped when
 * the visitor prefers reduced motion.
 *
 * Source of truth is `src/guides/guide-premium.ts`; the browser file at
 * `public/assets/js/pages/guide-premium.js` is compiled via `npm run build:guides`.
 */
(() => {
  'use strict';
  const root = document.querySelector('[data-gp-article]');
  if (!root) {
    return;
  }
  const LITRES_PER_GALLON = 4.54609;
  const HMRC_RATE_PER_MILE = 0.45;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const money = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  /** Round to `places` decimals without float drift showing up in the UI. */
  function round(value, places = 2) {
    const factor = 10 ** places;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  /* ── Reading state ────────────────────────────────────────────────────
       One rAF-throttled scroll pass drives both the progress dial and the
       section highlight, so the two can never disagree about where you are. */
  function initReadingState() {
    const list = document.querySelector('[data-gp-toc]');
    const ringBar = document.querySelector('[data-gp-ring]');
    const ringLabel = document.querySelector('[data-gp-ring-pct]');
    const sections = Array.from(root.querySelectorAll('[data-gp-section]'));
    if (!list && !ringBar && !ringLabel) {
      return;
    }
    const links = new Map();
    list?.querySelectorAll('a[href^="#"]').forEach(link => {
      links.set(link.getAttribute('href').slice(1), link);
    });
    const circumference = ringBar ? 2 * Math.PI * Number(ringBar.getAttribute('r')) : 0;
    if (ringBar) {
      ringBar.style.setProperty('--gp-ring-circumference', String(round(circumference, 2)));
    }
    let activeId = '';
    let queued = false;
    function setActive(id) {
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
    function currentSectionId() {
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
    function update() {
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
    function onScroll() {
      if (queued) {
        return;
      }
      queued = true;
      requestAnimationFrame(update);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }
  /* ── Animated figures ─────────────────────────────────────────────────
       Counts a statistic up to its published value the first time it scrolls
       into view. The literal value is already in the DOM for crawlers. */
  function initCountUp() {
    const stats = Array.from(root.querySelectorAll('[data-gp-count]'));
    if (!stats.length || prefersReducedMotion) {
      return;
    }
    function run(el) {
      const target = Number(el.dataset.gpCount);
      if (!Number.isFinite(target)) {
        return;
      }
      const decimals = Number(el.dataset.gpDecimals ?? 0);
      const prefix = el.dataset.gpPrefix ?? '';
      const suffix = el.dataset.gpSuffix ?? '';
      const duration = 1100;
      const start = performance.now();
      function frame(now) {
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
          run(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.6 }
    );
    stats.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }
  /* ── Heading permalinks ───────────────────────────────────────────────
       Adds a copy-link affordance to each section heading. */
  function initHeadingAnchors() {
    root.querySelectorAll('[data-gp-section] .gp-section__head').forEach(head => {
      const section = head.closest('[data-gp-section]');
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
        void copyText(url).then(ok => {
          if (ok) {
            flash(button);
          }
          history.replaceState(null, '', `#${section.id}`);
        });
      });
      heading.insertAdjacentElement('afterend', button);
    });
  }
  async function copyText(text) {
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
  function flash(el) {
    el.classList.add('is-done');
    window.setTimeout(() => el.classList.remove('is-done'), 1600);
  }
  /* ── Rail share buttons ───────────────────────────────────────────────── */
  function initRailShare() {
    const button = document.querySelector('[data-gp-copy-page]');
    if (!button) {
      return;
    }
    const original = button.innerHTML;
    button.addEventListener('click', () => {
      void copyText(button.dataset.gpCopyPage || window.location.href).then(ok => {
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
  /* ── Fuel & mileage calculator ────────────────────────────────────────
       The worked example from the article, made interactive: fuel burn for a
       journey versus what the HMRC approved rate would reimburse for it. */
  function initCalculator() {
    const form = document.querySelector('[data-gp-calc]');
    if (!form) {
      return;
    }
    const milesInput = form.querySelector('#gp-calc-miles');
    const mpgInput = form.querySelector('#gp-calc-mpg');
    const priceInput = form.querySelector('#gp-calc-price');
    if (!milesInput || !mpgInput || !priceInput) {
      return;
    }
    const inputs = [milesInput, mpgInput, priceInput];
    const out = {
      headline: form.querySelector('[data-gp-out="fuel"]'),
      perMile: form.querySelector('[data-gp-out="per-mile"]'),
      fuelAmount: form.querySelector('[data-gp-out="fuel-amount"]'),
      hmrcAmount: form.querySelector('[data-gp-out="hmrc-amount"]'),
      fuelBar: form.querySelector('[data-gp-bar="fuel"]'),
      hmrcBar: form.querySelector('[data-gp-bar="hmrc"]'),
      verdict: form.querySelector('[data-gp-out="verdict"]'),
    };
    function readValues() {
      return {
        miles: Number(milesInput.value),
        mpg: Number(mpgInput.value),
        pencePerLitre: Number(priceInput.value),
      };
    }
    /** Paint the filled portion of a range track and its readout chip. */
    function paintRange(input) {
      const min = Number(input.min);
      const max = Number(input.max);
      const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--gp-range-fill', `${round(pct, 2)}%`);
      const readout = form.querySelector(`[data-gp-readout="${input.id}"]`);
      if (readout) {
        const decimals = Number(input.dataset.gpDecimals ?? 0);
        readout.textContent = `${Number(input.value).toFixed(decimals)}${input.dataset.gpUnit ?? ''}`;
      }
    }
    function update() {
      const { miles, mpg, pencePerLitre } = readValues();
      inputs.forEach(paintRange);
      const gallons = miles / mpg;
      const fuelCost = gallons * LITRES_PER_GALLON * (pencePerLitre / 100);
      const perMilePence = miles > 0 ? (fuelCost / miles) * 100 : 0;
      const hmrcCost = miles * HMRC_RATE_PER_MILE;
      const peak = Math.max(fuelCost, hmrcCost, 0.01);
      if (out.headline) {
        out.headline.textContent = money.format(fuelCost);
      }
      if (out.perMile) {
        out.perMile.textContent = `${perMilePence.toFixed(1)}p per mile in fuel · ${miles} mile round trip`;
      }
      if (out.fuelAmount) {
        out.fuelAmount.textContent = money.format(fuelCost);
      }
      if (out.hmrcAmount) {
        out.hmrcAmount.textContent = money.format(hmrcCost);
      }
      if (out.fuelBar) {
        out.fuelBar.style.setProperty('--gp-bar-w', `${round((fuelCost / peak) * 100, 2)}%`);
      }
      if (out.hmrcBar) {
        out.hmrcBar.style.setProperty('--gp-bar-w', `${round((hmrcCost / peak) * 100, 2)}%`);
      }
      if (out.verdict) {
        const gap = hmrcCost - fuelCost;
        out.verdict.innerHTML =
          gap >= 0
            ? `Reimbursing at 45p leaves <strong>${money.format(gap)}</strong> above pure fuel on this trip — that margin is meant to cover wear, tyres, servicing and insurance, not profit.`
            : `At this price and economy the fuel alone costs <strong>${money.format(Math.abs(gap))}</strong> more than a 45p reimbursement would return. Budget the real fuel figure rather than the flat rate.`;
      }
    }
    inputs.forEach(input => {
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    });
    update();
  }
  /* ── Boot ─────────────────────────────────────────────────────────────── */
  initReadingState();
  initCountUp();
  initHeadingAnchors();
  initRailShare();
  initCalculator();
})();
