'use strict';

/**
 * Guest-facing wedding website (/wedding/:slug).
 *
 * One module renders every state of the page from the data the server sends:
 * loading, unavailable, password gate, owner preview and the website itself. The
 * server already validates the palette, hero layout and photos (routes/wedding-theme-media.js);
 * this file validates again before anything reaches markup or inline styles.
 */
(function () {
  const root = document.getElementById('public-wedding-root');
  if (!root) {
    return;
  }

  const slug = window.location.pathname.split('/').filter(Boolean).pop() || '';
  const query = new URLSearchParams(window.location.search);
  // Owners reach this page from the dashboard to see unpublished changes: /wedding/<slug>?preview=1&plan=<id>
  const previewPlanId = query.get('preview') === '1' ? query.get('plan') || '' : '';

  const API = `/api/public/wedding-websites/${encodeURIComponent(slug)}`;
  const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;
  const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const DEFAULTS = { accent: '#0B8073', secondary: '#F4A6C8', bg: '#FFF7FB', text: '#1E1B4B' };
  const HERO_LAYOUTS = ['classic', 'editorial', 'full_bleed'];

  /* ------------------------------------------------------------------ *
   * Icons (inline SVG, decorative)
   * ------------------------------------------------------------------ */

  const ICON_PATHS = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    calendarPlus:
      '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    sparkles:
      '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M21 5h-4"/>',
    heart:
      '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    church: '<path d="M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6M12 4V2M10.5 3h3"/>',
    glass: '<path d="M8 22h8M12 11v11M5 2h14l-1 6a6 6 0 0 1-12 0z"/>',
    shirt:
      '<path d="M20.4 4.4 16 3a4 4 0 0 1-8 0L3.6 4.4a1 1 0 0 0-.7 1.2l1 4.1a1 1 0 0 0 1 .8H7V21a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10.5h2.1a1 1 0 0 0 1-.8l1-4.1a1 1 0 0 0-.7-1.2z"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    userPlus:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    car: '<path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M7 17v2M17 17v2"/>',
    access: '<circle cx="12" cy="4" r="2"/><path d="M12 7v6h5l2 6M9 13a5 5 0 1 0 6 6"/>',
    phone:
      '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    globe:
      '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
    bed: '<path d="M2 18v-8M2 14h20v4M22 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16 8-2 6-6 2 2-6z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    music:
      '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  };

  /** Inline SVG for a named icon, hidden from screen readers. */
  function icon(name) {
    return `<svg class="wed-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ''}</svg>`;
  }

  /* ------------------------------------------------------------------ *
   * Text, URL and date helpers
   * ------------------------------------------------------------------ */

  /** Escapes a value for HTML text and attribute values. */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  /** Text with any markup removed. */
  function plain(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/<[^>]*>/g, '')
      .trim();
  }

  /** True when the value has visible text. */
  function hasText(value) {
    return plain(value).length > 0;
  }

  /** Array of truthy entries, or an empty array for anything else. */
  function list(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  /** Absolute http(s) URL, or an empty string for anything else (blocks javascript: and friends). */
  function safeExternalUrl(value) {
    if (!value) {
      return '';
    }
    try {
      const url = new URL(String(value), window.location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_err) {
      return '';
    }
  }

  /** A data-URL photo or an http(s) URL; empty otherwise. */
  function safeImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    return DATA_IMAGE_RE.test(raw) ? raw : safeExternalUrl(raw);
  }

  /** CSS `url("…")` for a safe photo, or an empty string. */
  function cssUrl(value) {
    const safe = safeImageUrl(value);
    return safe ? `url("${safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")` : '';
  }

  /** `tel:` link target. */
  function phoneHref(value) {
    return `tel:${String(value || '').replace(/[^\d+]/g, '')}`;
  }

  /** Google Maps search link for an address or venue name. */
  function mapLink(query) {
    return query
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
      : '';
  }

  /** Date from `YYYY-MM-DD` (as local noon, so time zones cannot shift the day) or any parseable string. */
  function parseDate(value) {
    if (!value) {
      return null;
    }
    const raw = String(value);
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
      : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /** "Saturday 19 June 2027". */
  function longDate(value) {
    const date = parseDate(value);
    return date
      ? date.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : plain(value);
  }

  /** Whole days from today until the date, or null. */
  function daysUntil(value) {
    const date = parseDate(value);
    if (!date) {
      return null;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - start) / 86400000);
  }

  /** Whether the RSVP deadline (end of that day) has passed. */
  function deadlinePassed(value) {
    if (!value) {
      return false;
    }
    const raw = String(value);
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T23:59:59.999`)
      : parseDate(raw);
    return Boolean(deadline && deadline < new Date());
  }

  /** Up to two capital letters from a name. */
  function initials(name) {
    return (
      plain(name)
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || '?'
    );
  }

  /** "Amelia & Oliver" becomes "A & O". */
  function monogram(names) {
    const parts = plain(names)
      .split(/\s*(?:&|\band\b|\+)\s*/i)
      .filter(Boolean);
    return parts.length > 1 ? `${parts[0][0]} & ${parts[1][0]}`.toUpperCase() : initials(names);
  }

  /* ------------------------------------------------------------------ *
   * Colour (keeps any palette readable)
   * ------------------------------------------------------------------ */

  /** [r, g, b] for a #rgb or #rrggbb string, or null. */
  function parseHex(value) {
    const raw = String(value || '').trim();
    if (!HEX_RE.test(raw)) {
      return null;
    }
    const hex =
      raw.length === 4
        ? raw
            .slice(1)
            .split('')
            .map(ch => ch + ch)
            .join('')
        : raw.slice(1);
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  }

  /** "#rrggbb" for an [r, g, b] triple. */
  function toHex(rgb) {
    return `#${rgb
      .map(n =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;
  }

  /** WCAG relative luminance. */
  function luminance(rgb) {
    const [r, g, b] = rgb.map(n => {
      const c = n / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** WCAG contrast ratio between two colours. */
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** `from` blended towards `to` (0 keeps `from`, 1 gives `to`). */
  function mix(from, to, amount) {
    return from.map((n, i) => n + (to[i] - n) * amount);
  }

  /** `fg` nudged towards black or white until it reaches `min` contrast on every background. */
  function readable(fg, backgrounds, min) {
    const worst = color => Math.min(...backgrounds.map(bg => contrast(color, bg)));
    if (worst(fg) >= min) {
      return fg;
    }
    const target = backgrounds.every(bg => luminance(bg) > 0.4) ? [0, 0, 0] : [255, 255, 255];
    for (let step = 1; step <= 20; step += 1) {
      const candidate = mix(fg, target, step / 20);
      if (worst(candidate) >= min) {
        return candidate;
      }
    }
    return target;
  }

  /** Every colour the page uses, derived from the couple's four picks. */
  function buildTheme(site) {
    const bg = parseHex(site.backgroundColor) || parseHex(DEFAULTS.bg);
    const accent = parseHex(site.accentColor) || parseHex(DEFAULTS.accent);
    const secondary = parseHex(site.secondaryColor) || parseHex(DEFAULTS.secondary);
    const band = mix(secondary, bg, 0.82);
    const soft = mix(accent, bg, 0.9);
    const surfaces = [bg, band];
    const text = readable(parseHex(site.textColor) || parseHex(DEFAULTS.text), surfaces, 7);
    const white = [255, 255, 255];
    const ink = [24, 20, 26];
    return {
      '--wed-bg': toHex(bg),
      '--wed-bg-rgb': bg.map(Math.round).join(', '),
      '--wed-band': toHex(band),
      '--wed-text': toHex(text),
      '--wed-muted': toHex(readable(mix(text, bg, 0.3), surfaces, 4.6)),
      '--wed-line': toHex(mix(text, bg, 0.86)),
      '--wed-edge': toHex(readable(mix(text, bg, 0.5), [bg], 3.1)),
      '--wed-danger': toHex(readable([180, 35, 24], surfaces, 4.6)),
      '--wed-ok': toHex(readable([22, 101, 52], surfaces, 4.6)),
      '--wed-accent': toHex(accent),
      '--wed-accent-ink': toHex(readable(accent, [...surfaces, soft], 4.6)),
      '--wed-accent-soft': toHex(soft),
      '--wed-secondary': toHex(secondary),
      '--wed-on-accent': toHex(contrast(white, accent) >= contrast(ink, accent) ? white : ink),
    };
  }

  /** Applies the palette to the page and returns the hero's own colours. */
  function applyTheme(site, hasPhoto) {
    const vars = buildTheme(site);
    Object.entries(vars).forEach(([name, value]) =>
      document.documentElement.style.setProperty(name, value)
    );
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', vars['--wed-accent']);
    }
    const layout = HERO_LAYOUTS.includes(site.heroLayout) ? site.heroLayout : 'classic';
    // Text on a photo is white over a dark scrim; on plain colour it follows the accent;
    // the editorial layout sits on the page background and uses the accent for its button.
    let ink = hasPhoto ? '#ffffff' : vars['--wed-on-accent'];
    let button = { bg: ink, fg: ink === '#ffffff' ? '#18141a' : '#ffffff' };
    if (layout === 'editorial') {
      ink = vars['--wed-text'];
      button = { bg: vars['--wed-accent'], fg: vars['--wed-on-accent'] };
    }
    return {
      layout,
      style: `--hero-ink:${ink};--hero-btn-bg:${button.bg};--hero-btn-fg:${button.fg}`,
    };
  }

  /* ------------------------------------------------------------------ *
   * Loading the website
   * ------------------------------------------------------------------ */

  /** One-card page for the unavailable, password and error states. */
  function stateCard({ iconName, kicker, title, body, extra = '' }) {
    root.classList.remove('wed-loading');
    root.innerHTML = `<section class="wed-state"><article class="wed-state__card">
      <div class="wed-state__icon">${icon(iconName)}</div>
      <p class="wed-eyebrow">${esc(kicker)}</p>
      <h1>${esc(title)}</h1>
      <p class="wed-state__copy">${esc(body)}</p>
      ${extra}
    </article></section>`;
  }

  /** The "not available" page. */
  function renderUnavailable(message, title = 'This wedding website is not available') {
    stateCard({
      iconName: 'heart',
      kicker: 'Wedding website',
      title,
      body:
        message ||
        'It may not have been published yet, the link may be incorrect, or the couple may have changed the link.',
      extra: '<a class="wed-btn wed-btn--solid" href="/">Return to EventFlow</a>',
    });
  }

  /** What the server said about this website: its data, or the reason there is none. */
  async function requestWebsite() {
    const url = previewPlanId
      ? `/api/me/plans/${encodeURIComponent(previewPlanId)}/wedding-website`
      : API;
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        ...(previewPlanId ? { cache: 'no-store' } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const site = data.website || data.site || data.data?.website || null;
        return site ? { site } : { error: 'This wedding website is not available.' };
      }
      if (data.passwordRequired && !previewPlanId) {
        return { passwordRequired: true };
      }
      return {
        error: previewPlanId
          ? data.error || 'Unable to load this authenticated preview.'
          : data.error,
      };
    } catch (_err) {
      return { networkError: true };
    }
  }

  /** The password page. Resolves with the website once the right password is entered. */
  function askForPassword() {
    stateCard({
      iconName: 'lock',
      kicker: 'Private wedding website',
      title: 'Please enter the wedding password',
      body: 'This couple has protected their wedding website. Enter the password from your invitation to view the details and RSVP.',
      extra: `<form id="wed-password-form" class="wed-gate">
        <label class="wed-field"><span class="wed-label">Password</span>
          <input name="password" type="password" autocomplete="current-password" required autofocus></label>
        <button class="wed-btn wed-btn--solid" type="submit">Unlock website</button>
        <p id="wed-password-message" class="wed-msg" role="status" aria-live="polite"></p>
      </form>`,
    });
    const form = document.getElementById('wed-password-form');
    const message = document.getElementById('wed-password-message');
    form.elements.password.focus();
    return new Promise(resolve => {
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button');
        message.textContent = '';
        message.className = 'wed-msg';
        button.disabled = true;
        button.textContent = 'Checking…';
        try {
          const access = await fetch(`${API}/access`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
          });
          const accessData = await access.json().catch(() => ({}));
          if (!access.ok) {
            message.textContent = accessData.error || 'That password was not recognised.';
            message.className = 'wed-msg wed-msg--error';
            form.elements.password.select();
            return;
          }
          message.textContent = 'Password accepted. Loading wedding details…';
          message.className = 'wed-msg wed-msg--ok';
          resolve(await requestWebsite());
        } catch (_err) {
          message.textContent = 'Unable to check the password right now. Please try again.';
          message.className = 'wed-msg wed-msg--error';
        } finally {
          button.disabled = false;
          button.textContent = 'Unlock website';
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Page sections
   * ------------------------------------------------------------------ */

  /** Everything the sections need, with empty rows and unsafe values already removed. */
  function buildModel(site) {
    const primaryVenue = site.ceremonyVenueName || site.receptionVenueName;
    const model = {
      site,
      names: plain(site.coupleNames) || 'Our Wedding',
      cover: cssUrl(site.coverImageUrl),
      days: daysUntil(site.eventDate),
      primaryVenue,
      schedule: [
        ['arrivalTime', 'Guests arrive', site.ceremonyVenueName],
        ['ceremonyTime', 'Ceremony', site.ceremonyVenueName],
        ['receptionTime', 'Reception', site.receptionVenueName || site.ceremonyVenueName],
        ['finishTime', 'Carriages', ''],
      ]
        .filter(([key]) => hasText(site[key]))
        .map(([key, label, where]) => ({ time: site[key], label, where })),
      party: list(site.weddingParty).filter(person => hasText(person.name)),
      faqs: list(site.faq).filter(faq => hasText(faq.question) && hasText(faq.answer)),
      stay: list(site.accommodationRecommendations).filter(item => hasText(item.name)),
      taxis: list(site.taxiRecommendations).filter(item => hasText(item.name)),
      local: list(site.localInfo).filter(item => hasText(item.title)),
      questions: list(site.customRsvpQuestions).filter(q => hasText(q.label)),
      gallery: list(site.galleryImages)
        .map(item => ({
          url: safeImageUrl(item.imageUrl),
          caption: plain(item.caption),
          alt: plain(item.alt || item.caption) || 'Wedding photo',
        }))
        .filter(item => item.url),
      info: [
        ['Dress code', site.dressCode, 'shirt'],
        ['Children', site.childrenPolicy, 'smile'],
        ['Plus-ones', site.plusOnePolicy, 'userPlus'],
        ['Gifts', site.giftInfo, 'gift'],
        ['Parking', site.parkingInfo, 'car'],
        ['Accessibility', site.accessibilityInfo, 'access'],
      ].filter(([, text]) => hasText(text)),
    };
    model.hasVenues = hasText(site.ceremonyVenueName) || hasText(site.receptionVenueName);
    model.hasTravel = Boolean(model.stay.length || model.taxis.length || model.local.length);
    model.hasStory = hasText(site.loveStory) || hasText(site.proposalStory);
    model.sections = [
      model.schedule.length && { id: 'schedule', label: 'Schedule' },
      model.hasVenues && { id: 'venues', label: 'Venues' },
      model.info.length && { id: 'guest-info', label: 'Guest info' },
      model.hasTravel && { id: 'travel', label: 'Travel' },
      model.party.length && { id: 'wedding-party', label: 'Wedding party' },
      model.hasStory && { id: 'story', label: 'Our story' },
      model.gallery.length && { id: 'gallery', label: 'Photos' },
      model.faqs.length && { id: 'faqs', label: 'FAQs' },
      { id: 'rsvp', label: 'RSVP' },
    ].filter(Boolean);
    return model;
  }

  /** Section heading: small label above a serif title. */
  function heading(eyebrow, title) {
    return `<header class="wed-heading"><p class="wed-eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2></header>`;
  }

  /** A section wrapper. `tone` alternates the background so long pages keep a rhythm. */
  function section(id, tone, inner, extraClass = '') {
    return `<section id="${id}" class="wed-section wed-section--${tone} ${extraClass}"><div class="wed-wrap">${inner}</div></section>`;
  }

  /** Sticky top bar: monogram, section links (a menu on small screens) and an RSVP shortcut. */
  function topBar(m) {
    const links = m.sections
      .filter(item => item.id !== 'rsvp')
      .map(item => `<a href="#${item.id}">${esc(item.label)}</a>`)
      .join('');
    return `<header class="wed-bar">
      <div class="wed-bar__inner">
        <a class="wed-bar__mark" href="#top" aria-label="${esc(m.names)} — back to top">${esc(monogram(m.names))}</a>
        <nav class="wed-nav" id="wed-nav" aria-label="Wedding website sections">${links}</nav>
        <a class="wed-btn wed-btn--solid wed-btn--small wed-bar__rsvp" href="#rsvp">RSVP</a>
        <button type="button" class="wed-bar__menu" aria-expanded="false" aria-controls="wed-nav" aria-label="Menu">${icon('menu')}</button>
      </div>
    </header>`;
  }

  /** "243 days to go" (nothing once the day has passed). */
  function countdown(days) {
    if (days === null || days < 0) {
      return '';
    }
    return `<p class="wed-countdown">${
      days === 0
        ? '<strong>Today</strong><span>is the day</span>'
        : `<strong>${days}</strong><span>${days === 1 ? 'day' : 'days'} to go</span>`
    }</p>`;
  }

  /** Opening section, drawn in one of three layouts. */
  function hero(m, theme) {
    const { site } = m;
    const date = site.eventDate ? longDate(site.eventDate) : '';
    const meta = [date, m.primaryVenue && plain(m.primaryVenue)].filter(Boolean).join(' · ');
    const photoStyle = m.cover ? `--hero-image:${m.cover};` : '';
    const details = m.sections.length > 1 ? m.sections[0].id : '';
    return `<section id="top" class="wed-hero wed-hero--${theme.layout} ${m.cover ? 'wed-hero--image' : ''}" style="${esc(photoStyle + theme.style)}">
      <div class="wed-hero__media" aria-hidden="true"></div>
      <div class="wed-hero__content wed-wrap">
        <p class="wed-eyebrow wed-hero__kicker">${m.days !== null && m.days < 0 ? 'We got married' : "We're getting married"}</p>
        <h1>${esc(m.names)}</h1>
        ${meta ? `<p class="wed-hero__meta">${esc(meta)}</p>` : ''}
        ${countdown(m.days)}
        ${hasText(site.welcomeMessage) ? `<p class="wed-hero__welcome">${esc(plain(site.welcomeMessage))}</p>` : ''}
        <div class="wed-hero__actions">
          <a class="wed-btn wed-btn--hero" href="#rsvp">RSVP now</a>
          ${details ? `<a class="wed-btn wed-btn--hero-ghost" href="#${details}">View details</a>` : ''}
        </div>
      </div>
      <a class="wed-hero__cue" href="#${details || 'rsvp'}" aria-label="Scroll to the details">${icon('arrowDown')}</a>
    </section>`;
  }

  /** "Add to calendar" button, or nothing when the wedding has no usable date. */
  function calendarButton(m) {
    return parseDate(m.site.eventDate)
      ? `<button type="button" class="wed-btn wed-btn--quiet wed-btn--small" data-action="calendar">${icon('calendarPlus')}Add to calendar</button>`
      : '';
  }

  /** Date, venue, RSVP deadline and dress code at a glance, plus an add-to-calendar link. */
  function facts(m) {
    const { site } = m;
    const items = [
      site.eventDate && ['calendar', 'Date', longDate(site.eventDate)],
      m.primaryVenue && ['pin', 'Venue', plain(m.primaryVenue)],
      site.rsvpDeadline && ['mail', 'RSVP by', longDate(site.rsvpDeadline)],
      hasText(site.dressCode) && ['sparkles', 'Dress code', plain(site.dressCode)],
    ].filter(Boolean);
    if (!items.length) {
      return '';
    }
    const calendar = m.schedule.length ? '' : calendarButton(m);
    return `<section class="wed-facts" aria-label="Wedding highlights"><div class="wed-wrap wed-facts__inner">
      <ul class="wed-quick-facts">${items
        .map(
          ([name, label, value]) =>
            `<li class="wed-fact">${icon(name)}<div><span class="wed-fact__label">${esc(label)}</span><span class="wed-fact__value">${esc(value)}</span></div></li>`
        )
        .join('')}</ul>${calendar}</div></section>`;
  }

  /** The day's timings. */
  function scheduleSection(m) {
    return section(
      'schedule',
      'plain',
      `${heading('The plan', 'Schedule')}
      <ol class="wed-timeline">${m.schedule
        .map(
          item =>
            `<li class="wed-time"><span class="wed-time__hour">${esc(plain(item.time))}</span><div><h3>${esc(item.label)}</h3>${hasText(item.where) ? `<p>${esc(plain(item.where))}</p>` : ''}</div></li>`
        )
        .join('')}</ol>
      <p class="wed-center">${calendarButton(m)}</p>`
    );
  }

  /** One venue card with a maps link. */
  function venueCard(label, name, address, iconName) {
    if (!hasText(name)) {
      return '';
    }
    const where = hasText(address) ? plain(address) : plain(name);
    return `<article class="wed-venue"><span class="wed-venue__icon">${icon(iconName)}</span>
      <p class="wed-eyebrow">${esc(label)}</p><h3>${esc(plain(name))}</h3>
      ${hasText(address) ? `<p>${esc(plain(address))}</p>` : ''}
      <a class="wed-btn wed-btn--quiet wed-btn--small" target="_blank" rel="noopener noreferrer" href="${esc(mapLink(where))}">${icon('pin')}Open in maps</a>
    </article>`;
  }

  /** Ceremony and reception venues. */
  function venuesSection(m) {
    const { site } = m;
    return section(
      'venues',
      'band',
      `${heading('Where to go', 'Venues')}<div class="wed-cards">${venueCard('Ceremony', site.ceremonyVenueName, site.ceremonyVenueAddress, 'church')}${venueCard('Reception', site.receptionVenueName, site.receptionVenueAddress, 'glass')}</div>`
    );
  }

  /** Practical information (dress code, children, parking…). */
  function infoSection(m) {
    return section(
      'guest-info',
      'plain',
      `${heading('Good to know', 'Guest information')}<div class="wed-info">${m.info
        .map(
          ([title, text, iconName]) =>
            `<article class="wed-info__item"><span class="wed-info__icon">${icon(iconName)}</span><h3>${esc(title)}</h3><p>${esc(plain(text))}</p></article>`
        )
        .join('')}</div>`
    );
  }

  /** A link button, or nothing when the URL is not a safe web address. */
  function externalLink(url, label, iconName = 'globe') {
    const safe = safeExternalUrl(url);
    return safe
      ? `<a class="wed-link" target="_blank" rel="noopener noreferrer" href="${esc(safe)}">${icon(iconName)}${esc(label)}</a>`
      : '';
  }

  /** Where to stay, taxis and things to do nearby. */
  function travelSection(m) {
    const group = (title, items, render) =>
      items.length
        ? `<h3 class="wed-subheading">${esc(title)}</h3><div class="wed-cards wed-cards--tight">${items.map(render).join('')}</div>`
        : '';
    const stay =
      item => `<article class="wed-place"><span class="wed-place__icon">${icon('bed')}</span>
      <h4>${esc(plain(item.name))}</h4>
      ${hasText(item.description) ? `<p>${esc(plain(item.description))}</p>` : ''}
      ${hasText(item.address) ? `<p class="wed-place__meta">${esc(plain(item.address))}</p>` : ''}
      ${hasText(item.distance) ? `<p class="wed-place__meta">${esc(plain(item.distance))} from the venue</p>` : ''}
      ${hasText(item.notes) ? `<p class="wed-place__note">${esc(plain(item.notes))}</p>` : ''}
      <div class="wed-place__links">${hasText(item.phone) ? `<a class="wed-link" href="${esc(phoneHref(item.phone))}">${icon('phone')}Call</a>` : ''}${externalLink(item.websiteUrl, 'Website')}</div>
    </article>`;
    const taxi =
      item => `<article class="wed-place"><span class="wed-place__icon">${icon('car')}</span>
      <h4>${esc(plain(item.name))}</h4>
      ${hasText(item.notes) ? `<p>${esc(plain(item.notes))}</p>` : ''}
      <div class="wed-place__links">${hasText(item.phone) ? `<a class="wed-link" href="${esc(phoneHref(item.phone))}">${icon('phone')}${esc(plain(item.phone))}</a>` : ''}${externalLink(item.websiteUrl, 'Website')}</div>
    </article>`;
    const nearby =
      item => `<article class="wed-place"><span class="wed-place__icon">${icon('compass')}</span>
      <h4>${esc(plain(item.title))}</h4>
      ${hasText(item.description) ? `<p>${esc(plain(item.description))}</p>` : ''}
      ${hasText(item.type) ? `<p class="wed-place__meta">${esc(plain(item.type))}</p>` : ''}
      <div class="wed-place__links">${externalLink(item.url, 'Learn more', 'link')}</div>
    </article>`;
    return section(
      'travel',
      'band',
      `${heading('Travel & stay', 'Getting here')}${group('Where to stay', m.stay, stay)}${group('Taxis', m.taxis, taxi)}${group('Things to do nearby', m.local, nearby)}`
    );
  }

  /** Photo (or initials) and role for each member of the wedding party. */
  function partySection(m) {
    return section(
      'wedding-party',
      'plain',
      `${heading('Meet the people', 'Wedding party')}<div class="wed-party">${m.party
        .map(person => {
          const photo = safeImageUrl(person.imageUrl);
          return `<article class="wed-person"><div class="wed-avatar"><span>${esc(initials(person.name))}</span>${photo ? `<img src="${esc(photo)}" alt="${esc(plain(person.name))}" loading="lazy" decoding="async">` : ''}</div>
            <h3>${esc(plain(person.name))}</h3>${hasText(person.role) ? `<p class="wed-person__role">${esc(plain(person.role))}</p>` : ''}${hasText(person.bio) ? `<p>${esc(plain(person.bio))}</p>` : ''}</article>`;
        })
        .join('')}</div>`
    );
  }

  /** How they met and the proposal. */
  function storySection(m) {
    const { site } = m;
    return section(
      'story',
      'band',
      `${heading('About us', 'Our story')}<div class="wed-story">${hasText(site.loveStory) ? `<p>${esc(plain(site.loveStory))}</p>` : ''}${hasText(site.proposalStory) ? `<h3 class="wed-subheading">The proposal</h3><p>${esc(plain(site.proposalStory))}</p>` : ''}</div>`
    );
  }

  /** Photo grid that opens a lightbox. */
  function gallerySection(m) {
    return section(
      'gallery',
      'plain',
      `${heading('Photo gallery', 'Moments we love')}<div class="wed-gallery">${m.gallery
        .map(
          (item, index) =>
            `<figure class="wed-gallery__item"><button type="button" data-action="open-photo" data-index="${index}" aria-label="View photo ${index + 1} of ${m.gallery.length}${item.caption ? `: ${esc(item.caption)}` : ''}"><img src="${esc(item.url)}" alt="${esc(item.alt)}" loading="lazy" decoding="async"></button>${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ''}</figure>`
        )
        .join('')}</div>`
    );
  }

  /** Questions and answers. */
  function faqSection(m) {
    return section(
      'faqs',
      'band',
      `${heading('Need to know', 'FAQs')}<div class="wed-faqs">${m.faqs
        .map(
          faq =>
            `<details class="wed-faq"><summary><span>${esc(plain(faq.question))}</span>${icon('plus')}</summary><p>${esc(plain(faq.answer))}</p></details>`
        )
        .join('')}</div>`
    );
  }

  /** The couple's own RSVP questions. */
  function questionFields(questions) {
    return questions
      .map((q, index) => {
        const key = `cq_${index}`;
        const required = q.required ? 'required' : '';
        const hint = q.required ? '<em class="wed-required">Required</em>' : '';
        const options = list(q.options);
        if (q.type === 'textarea') {
          return `<label class="wed-field"><span class="wed-label">${esc(q.label)}${hint}</span><textarea name="${key}" maxlength="1000" rows="3" ${required}></textarea></label>`;
        }
        if (q.type === 'select') {
          return `<label class="wed-field"><span class="wed-label">${esc(q.label)}${hint}</span><select name="${key}" ${required}><option value="">Select an option</option>${options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></label>`;
        }
        if (q.type === 'checkbox') {
          return `<fieldset class="wed-field wed-checks" data-required="${q.required ? 'true' : 'false'}" data-question="${esc(q.label)}"><legend class="wed-label">${esc(q.label)}${hint}</legend>${options.map(o => `<label class="wed-check"><input type="checkbox" name="${key}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}</fieldset>`;
        }
        return `<label class="wed-field"><span class="wed-label">${esc(q.label)}${hint}</span><input name="${key}" maxlength="300" ${required}></label>`;
      })
      .join('');
  }

  /** The reply form, or the reason replies are not being taken. */
  function rsvpForm(m, preview) {
    const { site } = m;
    if (preview) {
      return `<div class="wed-closed"><strong>RSVPs are switched off in preview.</strong><p>Guests will see the reply form here once your website is live.</p></div>`;
    }
    if (site.rsvpEnabled === false) {
      return `<div class="wed-closed"><strong>RSVPs are not currently open.</strong><p>Please check back later or contact the couple directly.</p></div>`;
    }
    if (deadlinePassed(site.rsvpDeadline) || (m.days !== null && m.days < 0)) {
      return `<div class="wed-closed"><strong>RSVPs are now closed.</strong><p>If your plans have changed, please contact the couple directly.</p></div>`;
    }
    const meals = list(site.mealOptions);
    return `<form id="rsvp-form" class="wed-form" novalidate>
      <fieldset class="wed-choice">
        <legend class="wed-label">Will you be joining us?</legend>
        <label class="wed-choice__option"><input type="radio" name="attending" value="true" checked><span>${icon('check')}Joyfully attending</span></label>
        <label class="wed-choice__option"><input type="radio" name="attending" value="false"><span>${icon('close')}Regretfully declining</span></label>
      </fieldset>
      <div class="wed-form-grid">
        <label class="wed-field"><span class="wed-label">Full name<em class="wed-required">Required</em></span><input name="guestName" autocomplete="name" required maxlength="120"></label>
        <label class="wed-field"><span class="wed-label">Email address</span><input name="email" type="email" autocomplete="email" maxlength="254"></label>
      </div>
      <div class="wed-attending" data-attending-only>
        <div class="wed-form-grid">
          <label class="wed-field"><span class="wed-label">How many in your party?</span><input type="number" name="partySize" min="1" max="20" value="1" inputmode="numeric"></label>
          <label class="wed-field"><span class="wed-label">Of those, how many children?</span><input type="number" name="childrenCount" min="0" max="10" value="0" inputmode="numeric"></label>
        </div>
        <label class="wed-field"><span class="wed-label">Plus-one name</span><input name="plusOneName" maxlength="120"></label>
        ${
          meals.length
            ? `<label class="wed-field"><span class="wed-label">Meal choice</span><select name="mealChoice"><option value="">Select meal</option>${meals.map(meal => `<option value="${esc(meal)}">${esc(meal)}</option>`).join('')}</select></label>`
            : ''
        }
        <div class="wed-form-grid">
          <label class="wed-field"><span class="wed-label">Dietary requirements</span><textarea name="dietaryRequirements" maxlength="500" rows="3"></textarea></label>
          <label class="wed-field"><span class="wed-label">Accessibility requirements</span><textarea name="accessibilityRequirements" maxlength="500" rows="3"></textarea></label>
        </div>
        ${questionFields(m.questions)}
      </div>
      <details class="wed-more">
        <summary>${icon('plus')}Add a message, phone number or song request</summary>
        <div class="wed-more__body">
          <label class="wed-field"><span class="wed-label">Phone number</span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
          <label class="wed-field" data-attending-only><span class="wed-label">Song request</span><input name="songRequest" maxlength="200"></label>
          <label class="wed-field"><span class="wed-label">Message for the couple</span><textarea name="notes" maxlength="1000" rows="3"></textarea></label>
        </div>
      </details>
      <input name="website" class="wed-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button type="submit" class="wed-btn wed-btn--solid wed-btn--block">Send RSVP</button>
      <p id="rsvp-msg" class="wed-msg" role="status" aria-live="polite"></p>
    </form>`;
  }

  /** Reply section. */
  function rsvpSection(m, preview) {
    const { site } = m;
    const intro = hasText(site.rsvpIntroText)
      ? plain(site.rsvpIntroText)
      : 'Let the couple know whether you can celebrate with them.';
    return section(
      'rsvp',
      'accent',
      `${heading('Reply', 'RSVP')}<p class="wed-rsvp__intro">${esc(intro)}</p><div class="wed-rsvp__panel" id="rsvp-panel">${rsvpForm(m, preview)}</div>`,
      'wed-rsvp'
    );
  }

  /** Banner for the owner's preview. */
  function previewBanner(site) {
    const live = site.status === 'published';
    return `<aside class="wed-preview" role="status"><strong>Preview mode</strong><span>${
      live
        ? 'Showing the latest saved version of your live website.'
        : 'Draft preview. Guests cannot see this page until you publish it.'
    } Only you can see this while signed in.</span><a href="/dashboard/customer">Back to dashboard</a></aside>`;
  }

  /** Whole-page markup. */
  function pageHtml(m, theme, preview) {
    return `${preview ? previewBanner(m.site) : ''}
      ${topBar(m)}
      ${hero(m, theme)}
      ${facts(m)}
      ${m.schedule.length ? scheduleSection(m) : ''}
      ${m.hasVenues ? venuesSection(m) : ''}
      ${m.info.length ? infoSection(m) : ''}
      ${m.hasTravel ? travelSection(m) : ''}
      ${m.party.length ? partySection(m) : ''}
      ${m.hasStory ? storySection(m) : ''}
      ${m.gallery.length ? gallerySection(m) : ''}
      ${m.faqs.length ? faqSection(m) : ''}
      ${rsvpSection(m, preview)}
      <footer class="wed-footer"><p class="wed-footer__names">${esc(m.names)}</p><p>Made with <a href="/">EventFlow</a></p></footer>
      <dialog class="wed-lightbox" aria-label="Photo viewer">
        <button type="button" class="wed-lightbox__btn wed-lightbox__close" data-action="close-photo" aria-label="Close">${icon('close')}</button>
        <button type="button" class="wed-lightbox__btn wed-lightbox__prev" data-action="prev-photo" aria-label="Previous photo">${icon('left')}</button>
        <figure><img alt=""><figcaption></figcaption></figure>
        <button type="button" class="wed-lightbox__btn wed-lightbox__next" data-action="next-photo" aria-label="Next photo">${icon('right')}</button>
      </dialog>`;
  }

  /* ------------------------------------------------------------------ *
   * Behaviour
   * ------------------------------------------------------------------ */

  /** Downloads an .ics file for the wedding day. */
  function downloadCalendar(m) {
    const date = parseDate(m.site.eventDate);
    if (!date) {
      return;
    }
    const stamp = d =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const escapeIcs = value =>
      String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/[,;]/g, ch => `\\${ch}`)
        .replace(/\r?\n/g, '\\n');
    const where = [m.site.ceremonyVenueName, m.site.ceremonyVenueAddress]
      .filter(hasText)
      .map(plain)
      .join(', ');
    const body = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EventFlow//Wedding website//EN',
      'BEGIN:VEVENT',
      `UID:${slug}-${stamp(date)}@eventflow`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
      `DTSTART;VALUE=DATE:${stamp(date)}`,
      `DTEND;VALUE=DATE:${stamp(next)}`,
      `SUMMARY:${escapeIcs(`${m.names}'s wedding`)}`,
      where ? `LOCATION:${escapeIcs(where)}` : '',
      `DESCRIPTION:${escapeIcs(window.location.href.split('?')[0])}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wedding.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Mobile menu, and which section link is current while scrolling. */
  function bindNavigation() {
    const bar = root.querySelector('.wed-bar');
    const menu = root.querySelector('.wed-bar__menu');
    const nav = root.querySelector('#wed-nav');
    if (!bar || !menu || !nav) {
      return;
    }
    const setOpen = open => {
      bar.classList.toggle('is-open', open);
      menu.setAttribute('aria-expanded', String(open));
    };
    menu.addEventListener('click', () => setOpen(!bar.classList.contains('is-open')));
    nav.addEventListener('click', event => {
      if (event.target.closest('a')) {
        setOpen(false);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && bar.classList.contains('is-open')) {
        setOpen(false);
        menu.focus();
      }
    });
    if (!('IntersectionObserver' in window)) {
      return;
    }
    const links = new Map([...nav.querySelectorAll('a')].map(a => [a.getAttribute('href'), a]));
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          const link = links.get(`#${entry.target.id}`);
          if (link && entry.isIntersecting) {
            links.forEach(other => other.removeAttribute('aria-current'));
            link.setAttribute('aria-current', 'true');
          }
        });
      },
      { rootMargin: '-35% 0px -55% 0px' }
    );
    links.forEach((_link, href) => {
      const target = root.querySelector(href);
      if (target) {
        observer.observe(target);
      }
    });
  }

  /** Photo viewer: click a photo, then use the buttons or arrow keys. */
  function bindGallery(m) {
    const dialog = root.querySelector('.wed-lightbox');
    if (!dialog || !m.gallery.length || typeof dialog.showModal !== 'function') {
      return;
    }
    const image = dialog.querySelector('img');
    const caption = dialog.querySelector('figcaption');
    let current = 0;
    const show = index => {
      current = (index + m.gallery.length) % m.gallery.length;
      const item = m.gallery[current];
      image.src = item.url;
      image.alt = item.alt;
      caption.textContent = item.caption;
    };
    root.addEventListener('click', event => {
      const target = event.target.closest('[data-action]');
      if (!target) {
        return;
      }
      const action = target.dataset.action;
      if (action === 'open-photo') {
        show(Number(target.dataset.index));
        dialog.showModal();
        document.body.style.overflow = 'hidden';
      } else if (action === 'close-photo') {
        dialog.close();
      } else if (action === 'prev-photo') {
        show(current - 1);
      } else if (action === 'next-photo') {
        show(current + 1);
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
    dialog.addEventListener('close', () => {
      document.body.style.overflow = '';
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') {
        show(current - 1);
      } else if (event.key === 'ArrowRight') {
        show(current + 1);
      }
    });
  }

  /** Shows or hides the questions that only matter to guests who are coming. */
  function syncAttending(form) {
    const attending = form.elements.attending.value !== 'false';
    form.querySelectorAll('[data-attending-only]').forEach(block => {
      block.hidden = !attending;
      block.querySelectorAll('input, select, textarea').forEach(field => {
        field.disabled = !attending;
      });
    });
  }

  /** Answers to the couple's own questions, in the order they were asked. */
  function collectAnswers(m, data) {
    return m.questions.map((q, index) => {
      const key = `cq_${index}`;
      return {
        id: q.id || key,
        label: q.label,
        value: q.type === 'checkbox' ? data.getAll(key) : data.get(key),
      };
    });
  }

  /** The first required custom question that has no answer, if any. */
  function missingAnswer(m, data) {
    return m.questions.find((q, index) => {
      if (!q.required) {
        return false;
      }
      const key = `cq_${index}`;
      return q.type === 'checkbox' ? !data.getAll(key).length : !String(data.get(key) || '').trim();
    });
  }

  /** Thank-you panel shown after a successful reply. */
  function showThanks(m, message, attending) {
    const panel = document.getElementById('rsvp-panel');
    panel.innerHTML = `<div class="wed-done" role="status">
      <span class="wed-done__icon">${icon('check')}</span>
      <h3>${attending ? 'See you there!' : 'Thank you for letting us know'}</h3>
      <p class="wed-done__message">${esc(message)}</p>
      <button type="button" class="wed-btn wed-btn--quiet" data-action="edit-reply">Change my reply</button>
    </div>`;
    const done = panel.querySelector('.wed-done');
    done.tabIndex = -1;
    done.focus();
    panel.querySelector('[data-action="edit-reply"]').addEventListener('click', () => {
      panel.innerHTML = rsvpForm(m, false);
      bindRsvp(m);
      panel.querySelector('input[name="guestName"]')?.focus();
    });
  }

  /** Validates and sends the reply. */
  function bindRsvp(m) {
    const form = document.getElementById('rsvp-form');
    if (!form) {
      return;
    }
    const message = document.getElementById('rsvp-msg');
    const submit = form.querySelector('button[type="submit"]');
    const say = (text, kind) => {
      message.textContent = text;
      message.className = `wed-msg ${kind ? `wed-msg--${kind}` : ''}`;
    };
    form.addEventListener('change', event => {
      if (event.target.name === 'attending') {
        syncAttending(form);
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      say('');
      if (!form.checkValidity()) {
        form.reportValidity();
        say('Please complete the highlighted fields.', 'error');
        return;
      }
      const data = new FormData(form);
      const attending = data.get('attending') !== 'false';
      if (attending) {
        const partySize = Number(data.get('partySize')) || 1;
        if ((Number(data.get('childrenCount')) || 0) > partySize) {
          say('Children count cannot be greater than your party size.', 'error');
          return;
        }
        const missing = missingAnswer(m, data);
        if (missing) {
          say(`Please complete required question: ${missing.label}`, 'error');
          return;
        }
      }
      const payload = Object.fromEntries(data.entries());
      payload.customAnswers = attending ? collectAnswers(m, data) : [];
      submit.disabled = true;
      submit.textContent = 'Sending…';
      try {
        const response = await fetch(`${API}/rsvp`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        const text =
          result.message ||
          result.error ||
          (response.ok ? 'Thank you — your RSVP has been sent.' : 'We could not send your RSVP.');
        if (response.ok) {
          showThanks(m, text, attending);
          return;
        }
        say(text, 'error');
      } catch (_err) {
        say('We could not send your RSVP. Please check your connection and try again.', 'error');
      }
      submit.disabled = false;
      submit.textContent = 'Send RSVP';
    });
    syncAttending(form);
  }

  /** Draws the website and wires its behaviour. */
  function renderWebsite(site, { preview = false } = {}) {
    const m = buildModel(site);
    const theme = applyTheme(site, Boolean(m.cover));
    document.title = plain(site.coupleNames)
      ? `${plain(site.coupleNames)} — Wedding Website`
      : 'Wedding Website';
    root.classList.remove('wed-loading');
    root.removeAttribute('aria-live');
    root.innerHTML = pageHtml(m, theme, preview);
    root.addEventListener('click', event => {
      if (event.target.closest('[data-action="calendar"]')) {
        downloadCalendar(m);
      }
    });
    // A photo that fails to load falls back to the initials underneath it.
    root.addEventListener(
      'error',
      event => {
        if (event.target.matches?.('.wed-avatar img')) {
          event.target.remove();
        }
      },
      true
    );
    bindNavigation();
    bindGallery(m);
    bindRsvp(m);
  }

  /** Works out what to show for a response from the server. */
  function showResult(result) {
    if (result.site) {
      renderWebsite(result.site, { preview: Boolean(previewPlanId) });
    } else if (result.passwordRequired) {
      askForPassword().then(showResult);
    } else if (result.networkError) {
      renderUnavailable(
        'We could not load this wedding website. Please check your connection and try again.',
        'We hit a connection problem'
      );
    } else {
      renderUnavailable(result.error);
    }
  }

  requestWebsite().then(showResult);
})();
