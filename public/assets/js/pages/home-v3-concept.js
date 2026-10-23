'use strict';
/** V3 homepage: approved concept interactions; all wedding data is an in-memory sample. */
(() => {
  'use strict';
  document.querySelectorAll('[data-scroll]').forEach(b =>
    b.addEventListener('click', () => {
      const track = document.getElementById(b.dataset.scroll);
      track.scrollBy({
        left: track.clientWidth * Number(b.dataset.direction) * 0.85,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    })
  );
  const menu = document.querySelector('.menu-toggle'),
    mobile = document.querySelector('.mobile-menu');
  function setMenu(open) {
    mobile.hidden = !open;
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  }
  menu.addEventListener('click', () => setMenu(mobile.hidden));
  mobile.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !mobile.hidden) {
      setMenu(false);
      menu.focus();
    }
  });
  document.addEventListener('click', e => {
    if (!mobile.hidden && !mobile.contains(e.target) && !menu.contains(e.target)) {
      setMenu(false);
    }
  });
  matchMedia('(min-width:801px)').addEventListener('change', e => {
    if (e.matches) {
      setMenu(false);
    }
  });
  (() => {
    const section = document.querySelector('.hws'),
      stage = section.querySelector('.hws__stage');
    const views = [...section.querySelectorAll('[data-preview]')];
    function show(view) {
      stage.dataset.view = view;
      views.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preview === view)));
    }
    views.forEach(b => b.addEventListener('click', () => show(b.dataset.preview)));
    section.querySelectorAll('[data-rsvp-focus]').forEach(b =>
      b.addEventListener('click', () => {
        show('website');
        section
          .querySelector('input[name="sample-response"]:checked')
          .focus({ preventScroll: true });
      })
    );
    const originalGuests = section.querySelector('#sample-guest-list').innerHTML;
    let reply = null;
    let currentGuest = 'Charlotte E.';
    const seated = new Map();
    const seatNodes = [...section.querySelectorAll('.hws-seat')];
    const initialSeats = seatNodes.map(x => x.classList.contains('is-taken'));
    const capacities = { 2: 2, 3: 1 };
    let spaces = { ...capacities };
    const circle = 2 * Math.PI * 38;
    function updateChart() {
      const yes = 64 + (reply === 'yes' ? 1 : 0),
        no = 14 + (reply === 'no' ? 1 : 0),
        wait = 18 - (reply ? 1 : 0);
      section.querySelector('#sample-yes').textContent = String(yes);
      section.querySelector('#sample-no').textContent = String(no);
      section.querySelector('#sample-wait').textContent = String(wait);
      section.querySelector('#sample-percent').textContent =
        `${Math.round(((yes + no) / 96) * 100)}%`;
      const values = [yes, no, wait];
      let offset = 0;
      ['yes', 'no', 'wait'].forEach((key, i) => {
        const seg = section.querySelector(`.hws-seg--${key}`);
        const length = (values[i] / 96) * circle;
        seg.setAttribute('stroke-dasharray', `${length} ${circle}`);
        seg.setAttribute('stroke-dashoffset', String(-offset));
        offset += length;
      });
      section.querySelector('#sample-guest-list').innerHTML =
        originalGuests +
        (reply
          ? `<li class="sample-new-reply"><span class="hws__avatar">You</span><div><strong>Your sample guest</strong><span>Party of 1</span></div><em>${reply === 'yes' ? 'Attending' : 'Declined'}</em></li>`
          : '');
    }
    section.querySelector('#sample-rsvp').addEventListener('submit', e => {
      e.preventDefault();
      reply = section.querySelector('input[name="sample-response"]:checked').value;
      updateChart();
      section.querySelector('.hws-rsvp-confirm').textContent =
        'Sample RSVP sent. Guest replies updated.';
      section.querySelector('.hws-send-rsvp').textContent = 'Update RSVP';
    });
    const guestButtons = [...section.querySelectorAll('[data-seat-guest]')];
    function chooseGuest(name) {
      currentGuest = name;
      section.querySelector('#seat-guest-label').textContent = name;
      guestButtons.forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.seatGuest === name))
      );
      const chip = section.querySelector('#sample-drag');
      chip.lastChild.textContent = name;
      chip.hidden = seated.has(name);
      section.querySelector('#sample-seat').disabled = seated.has(name);
    }
    guestButtons.forEach(b => b.addEventListener('click', () => chooseGuest(b.dataset.seatGuest)));
    const tables = [...section.querySelectorAll('circle.hws-table')];
    tables.forEach((t, i) => {
      if (i === 0) {
        return;
      }
      t.setAttribute('role', 'button');
      t.setAttribute('tabindex', '0');
      t.setAttribute('aria-label', `Choose table ${i + 1}`);
      const choose = () => {
        section.querySelector('#sample-table').value = String(i + 1);
        section.querySelector('.hws-seat-status').textContent =
          `Table ${i + 1} selected. Choose “Seat guest” to place ${currentGuest}.`;
      };
      t.addEventListener('click', choose);
      t.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
    });
    section.querySelector('#sample-seat').addEventListener('click', () => {
      const number = section.querySelector('#sample-table').value;
      const status = section.querySelector('.hws-seat-status');
      if (seated.has(currentGuest)) {
        status.textContent = `${currentGuest} is already seated.`;
        return;
      }
      if (!spaces[number]) {
        status.textContent = `Table ${number} is full. Try another table.`;
        return;
      }
      spaces[number]--;
      seated.set(currentGuest, number);
      const empty = seatNodes.find(
        (s, index) =>
          !s.classList.contains('is-taken') &&
          ((number === '2' && index >= 8 && index < 16) ||
            (number === '3' && index >= 16 && index < 24))
      );
      if (empty) {
        empty.classList.add('is-taken');
      }
      status.textContent = `${currentGuest} is now at Table ${number}. ${3 - seated.size} sample guests left to seat.`;
      section.querySelector('#sample-drag').hidden = true;
      guestButtons.forEach(b => {
        if (b.dataset.seatGuest === currentGuest) {
          b.disabled = true;
        }
      });
      section.querySelector('#sample-seat').disabled = true;
    });
    section.querySelector('#sample-reset').addEventListener('click', () => {
      reply = null;
      updateChart();
      seated.clear();
      spaces = { ...capacities };
      seatNodes.forEach((s, i) => s.classList.toggle('is-taken', initialSeats[i]));
      guestButtons.forEach(b => (b.disabled = false));
      chooseGuest('Charlotte E.');
      section.querySelector('#sample-table').value = '2';
      section.querySelector('.hws-seat-status').textContent =
        'Choose a table to try the seating plan.';
      section.querySelector('.hws-rsvp-confirm').textContent = '';
      section.querySelector('.hws-send-rsvp').textContent = 'Send RSVP';
      section.querySelector('input[value="yes"]').checked = true;
      show('website');
    });
  })();
  (() => {
    const orbit = document.querySelector('.photo-orbit'),
      toggle = orbit.querySelector('.orbit-toggle'),
      motion = matchMedia('(prefers-reduced-motion: reduce)');
    let paused = motion.matches;
    function renderMotion() {
      if (motion.matches) {
        paused = true;
      }
      toggle.disabled = motion.matches;
      orbit.classList.toggle('is-paused', paused);
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.setAttribute(
        'aria-label',
        motion.matches
          ? 'Photo animation off: reduced motion setting'
          : paused
            ? 'Play photo animation'
            : 'Pause photo animation'
      );
      toggle.querySelector('span').textContent = motion.matches
        ? 'Motion off'
        : paused
          ? 'Play'
          : 'Pause';
    }
    toggle.addEventListener('click', () => {
      paused = !paused;
      renderMotion();
    });
    motion.addEventListener('change', () => {
      paused = motion.matches;
      renderMotion();
    });
    renderMotion();
    let onScreen = true;
    function rest() {
      orbit.classList.toggle('is-resting', !onScreen || document.hidden);
    }
    new IntersectionObserver(
      entries => {
        onScreen = entries[0].isIntersecting;
        rest();
      },
      { threshold: 0 }
    ).observe(orbit);
    document.addEventListener('visibilitychange', rest);
    // Explain unavailable directions by disabling carousel arrows at either end.
    document.querySelectorAll('.package-track').forEach(track => {
      const buttons = [...document.querySelectorAll('[data-scroll]')].filter(
        b => b.dataset.scroll === track.id
      );
      let pending = false;
      function update() {
        pending = false;
        const max = track.scrollWidth - track.clientWidth;
        buttons.forEach(b => {
          b.disabled =
            Number(b.dataset.direction) < 0 ? track.scrollLeft < 2 : track.scrollLeft >= max - 2;
        });
      }
      track.addEventListener(
        'scroll',
        () => {
          if (!pending) {
            pending = true;
            requestAnimationFrame(update);
          }
        },
        { passive: true }
      );
      new ResizeObserver(update).observe(track);
      new MutationObserver(update).observe(track, { childList: true });
      update();
    });
  })();
  (() => {
    const phone = document.querySelector('.hws__screen'),
      form = document.querySelector('#sample-rsvp'),
      reduced = matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('[data-rsvp-focus]').forEach(b =>
      b.addEventListener('click', () => {
        phone.scrollTo({
          top: Math.max(0, form.offsetTop - 20),
          behavior: reduced.matches ? 'instant' : 'smooth',
        });
      })
    );
    document
      .querySelector('#sample-reset')
      .addEventListener('click', () => phone.scrollTo({ top: 0, behavior: 'instant' }));
    const links = [...document.querySelectorAll('[data-chapter]')],
      chapters = links.map(a => document.getElementById(a.dataset.chapter)),
      bar = document.querySelector('.page-wayfinder'),
      progress = bar.querySelector('[role=progressbar]');
    let pending = false;
    function update() {
      pending = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      const fraction = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
      bar.style.setProperty('--reading-progress', String(fraction));
      progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      let current = 0;
      chapters.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= innerHeight * 0.35) {
          current = i;
        }
      });
      links.forEach((a, i) => {
        if (i === current) {
          a.setAttribute('aria-current', 'location');
        } else {
          a.removeAttribute('aria-current');
        }
      });
    }
    function schedule() {
      if (!pending) {
        pending = true;
        requestAnimationFrame(update);
      }
    }
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    new ResizeObserver(schedule).observe(document.body);
    update();
  })();
  (() => {
    const select = document.querySelector('#sample-table'),
      tables = [...document.querySelectorAll('circle.hws-table')],
      ring = document.querySelector('.hws-drop');
    function syncTable() {
      const selected = Number(select.value) - 1;
      tables.forEach((table, i) => {
        table.classList.toggle('is-drop', i === selected);
        if (table.getAttribute('role') === 'button') {
          table.setAttribute('aria-pressed', String(i === selected));
        }
      });
      ring.setAttribute('cx', tables[selected].getAttribute('cx'));
      ring.setAttribute('cy', tables[selected].getAttribute('cy'));
    }
    select.addEventListener('change', syncTable);
    tables.forEach(t => {
      t.addEventListener('click', syncTable);
      t.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          syncTable();
        }
      });
    });
    document.querySelector('#sample-reset').addEventListener('click', syncTable);
    syncTable();
  })();
})();
/** Live homepage content. DOM construction keeps API text out of HTML parsing. */
(() => {
  const pageWindow = window;
  const placeholder = '/assets/images/placeholders/package-event.svg';
  const arrow = document.querySelector('.text-link .arrow-icon');
  const currency = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function imageUrl(value, fallback = placeholder) {
    if (typeof value !== 'string' || !value.trim()) {
      return fallback;
    }
    try {
      const url = new URL(value, location.origin);
      return (url.origin === location.origin && /^https?:$/.test(url.protocol)) ||
        url.protocol === 'https:'
        ? url.href
        : fallback;
    } catch {
      return fallback;
    }
  }
  function image(src, alt, fallback = placeholder) {
    const img = element('img');
    img.src = imageUrl(src, fallback);
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener(
      'error',
      () => {
        img.src = fallback;
      },
      { once: true }
    );
    return img;
  }
  function withArrow(node) {
    if (arrow) {
      node.append(arrow.cloneNode(true));
    }
    return node;
  }
  function price(value) {
    if (value === null || value === undefined || value === '') {
      return 'Enquire for quote';
    }
    const text = String(value).trim();
    return /^\d+(\.\d+)?$/.test(text) ? currency.format(Number(text)) : text;
  }
  async function readJson(url) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error('Homepage content unavailable');
    }
    return response.json();
  }
  function message(container, text, href, label) {
    const note = element('p', 'v3-feed-message', `${text} `);
    note.setAttribute('role', 'status');
    const link = element('a', '', label);
    link.href = href;
    note.append(link);
    container.replaceChildren(note);
  }
  function renderPackage(item) {
    const card = element('a', 'package');
    card.href = `/package/${encodeURIComponent(item.slug || item.id)}`;
    const photo = element('div', 'package-photo');
    photo.append(
      image(pageWindow.resolvePackageImage?.(item) || item.image, item.title || 'Event package'),
      withArrow(element('span', 'image-arrow'))
    );
    const body = element('div', 'package-body');
    body.append(
      element('p', 'meta', item.supplier_name || 'Event package'),
      element('h3', '', item.title || 'Event package'),
      element('p', 'place', item.location || 'Explore this package')
    );
    const bottom = element('div', 'package-bottom');
    bottom.append(
      element('strong', '', price(item.price_display ?? item.price)),
      withArrow(element('span', '', 'View package '))
    );
    body.append(bottom);
    card.append(photo, body);
    return card;
  }
  async function loadPackages(container, kind) {
    try {
      const data = await readJson(`/api/packages/${kind}`);
      if (!Array.isArray(data.items)) {
        throw new Error('Invalid package response');
      }
      const items = data.items.filter(item => item && (item.slug || item.id)).slice(0, 6);
      if (items.length) {
        container.replaceChildren(...items.map(renderPackage));
      } else {
        message(container, 'New packages are being added.', '/suppliers', 'Explore suppliers');
      }
    } catch {
      message(
        container,
        'Packages could not load just now.',
        '/suppliers',
        'Browse suppliers and packages'
      );
    } finally {
      container.setAttribute('aria-busy', 'false');
    }
  }
  async function loadMarketplace(container) {
    try {
      const data = await readJson('/api/v1/marketplace/listings?limit=3');
      if (!Array.isArray(data.listings)) {
        throw new Error('Invalid marketplace response');
      }
      const cards = data.listings
        .filter(item => item && item.id)
        .slice(0, 3)
        .map(item => {
          const card = element('a', 'market-card');
          card.href = `/marketplace?listing=${encodeURIComponent(item.id)}`;
          const first = item.images?.[0];
          const src = typeof first === 'string' ? first : first?.url || first?.src;
          const body = element('div');
          body.append(
            element('span', 'meta', [item.location, item.condition].filter(Boolean).join(' · ')),
            element('h3', '', item.title || 'Event essential'),
            element('strong', '', price(item.price))
          );
          card.append(
            image(
              src,
              item.title || 'Marketplace listing',
              '/assets/images/marketplace-placeholder.svg'
            ),
            body
          );
          return card;
        });
      if (cards.length) {
        container.replaceChildren(...cards);
      } else {
        message(
          container,
          'New pre-loved finds are on their way.',
          '/marketplace',
          'Explore the marketplace'
        );
      }
    } catch {
      message(
        container,
        'Marketplace items could not load just now.',
        '/marketplace',
        'Explore the marketplace'
      );
    } finally {
      container.setAttribute('aria-busy', 'false');
    }
  }
  async function loadLocations() {
    const grid = document.querySelector('[data-v3-locations]');
    try {
      const data = await readJson('/api/v1/locations/featured?limit=6');
      if (!data.success || !Array.isArray(data.data?.cities)) {
        return;
      }
      const cards = data.data.cities
        .filter(city => city?.slug && city.name)
        .slice(0, 6)
        .map((city, index) => {
          const card = element('a', 'city');
          card.href = `/locations/${encodeURIComponent(city.slug)}`;
          const caption = element('div');
          const copy = element('span');
          const count = city.supplierCount;
          const meta =
            Number.isFinite(count) && count > 0
              ? count.toLocaleString('en-GB') + (count === 1 ? ' supplier' : ' suppliers')
              : city.region || 'Explore local suppliers';
          copy.append(element('strong', '', city.name), element('small', '', meta));
          caption.append(copy, withArrow(element('b')));
          card.append(
            image(city.imageUrl, city.name, `/assets/images/home-v3/locations-${index}.webp`),
            caption
          );
          return card;
        });
      if (cards.length) {
        grid.replaceChildren(...cards);
      }
    } catch {
      // The static cards link to supplier searches and never show captured counts.
    }
  }
  async function loadCategoryImages() {
    try {
      const data = await readJson('/api/v1/categories');
      if (!Array.isArray(data.items)) {
        return;
      }
      const aliases = [
        'venues',
        'catering',
        'entertainment',
        'photography',
        'decor',
        'av & lighting',
        'transport',
        'cake',
      ];
      const normalise = value =>
        String(value || '')
          .toLowerCase()
          .replace('decorations', 'decor');
      document.querySelectorAll('[data-v3-categories] .category').forEach((card, index) => {
        const category = data.items.find(
          item => normalise(item.name || item.slug) === aliases[index]
        );
        if (category?.heroImage) {
          const img = card.querySelector('img');
          const fallback = img.src;
          img.addEventListener(
            'error',
            () => {
              img.src = fallback;
            },
            { once: true }
          );
          img.src = imageUrl(category.heroImage, fallback);
        }
      });
    } catch {
      // Optimised local category photos remain available if the feed is offline.
    }
  }
  pageWindow.__authState?.onchange(user => {
    if (pageWindow.__authState.isLoading()) {
      return;
    }
    document.querySelectorAll('[data-v3-account]').forEach(link => {
      link.textContent = user ? 'Dashboard' : 'Log in';
      link.href = user ? '/dashboard' : '/auth';
      link.classList.remove('v3-auth-pending');
    });
  });
  void loadCategoryImages();
  void loadLocations();
  const loadFeed = container => {
    if (container.dataset.v3Feed === 'marketplace') {
      void loadMarketplace(container);
    } else {
      void loadPackages(
        container,
        container.dataset.v3Feed === 'featured' ? 'featured' : 'spotlight'
      );
    }
  };
  const feeds = document.querySelectorAll('[data-v3-feed]');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) {
            return;
          }
          observer.unobserve(entry.target);
          loadFeed(entry.target);
        });
      },
      { rootMargin: '600px' }
    );
    feeds.forEach(feed => observer.observe(feed));
  } else {
    feeds.forEach(loadFeed);
  }
})();
