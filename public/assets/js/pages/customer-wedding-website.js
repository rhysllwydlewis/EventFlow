'use strict';
/**
 * Wedding Website & RSVPs — customer dashboard app.
 *
 * One self-contained module: a modal "app" with five views (Overview, Website, Guests,
 * Seating, Share). State lives in `app` while the app is open and every view renders from it;
 * nothing here depends on other scripts patching the DOM. Styles: customer-wedding-website.css.
 *
 * Public surface: window.initWeddingWebsiteDashboard(plans) — called by the customer dashboard.
 */
(function () {
  const ROOT_ID = 'wedding-website-dashboard-root';
  const STATUS_ID = 'wedding-website-status-pill';
  const OPEN_BUTTON_SELECTOR = '.ww-card-open-app-btn';
  const PAGE_SIZE = 20;
  const MAX_GALLERY = 12;
  // The server drops any image over 900,000 characters, and every photo travels in one JSON
  // body (limit 10 MB). Photos are shrunk to ~0.6 M characters so a full gallery fits.
  const TARGET_IMAGE_CHARS = 600000;
  const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const SAFE_IMAGE_RE =
    /^(?:data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}|https?:\/\/[^\s"'()<>\\]+)$/i;
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

  const TABS = [
    { key: 'overview', label: 'Overview', title: 'Overview', icon: 'overview' },
    { key: 'website', label: 'Website', title: 'Your website', icon: 'website' },
    { key: 'guests', label: 'Guests', title: 'Guests & RSVPs', icon: 'guests' },
    { key: 'seating', label: 'Seating', title: 'Seating plan', icon: 'seating' },
    { key: 'share', label: 'Share', title: 'Share with guests', icon: 'share' },
  ];

  const PALETTES = [
    {
      name: 'Sage & Blush',
      accent: '#0B8073',
      secondary: '#F4A6C8',
      background: '#FFF7FB',
      text: '#1E1B4B',
    },
    {
      name: 'Champagne',
      accent: '#B88A2B',
      secondary: '#F4D6A0',
      background: '#FFF9EF',
      text: '#30261C',
    },
    {
      name: 'Midnight',
      accent: '#24436F',
      secondary: '#BFA2DB',
      background: '#F6F3FF',
      text: '#161B33',
    },
    {
      name: 'Terracotta',
      accent: '#B85C38',
      secondary: '#E9A178',
      background: '#FFF4EE',
      text: '#3B2119',
    },
    {
      name: 'Coastal',
      accent: '#2C94B1',
      secondary: '#9AD7E5',
      background: '#F2FBFE',
      text: '#14313B',
    },
    {
      name: 'Rose',
      accent: '#A8325F',
      secondary: '#F2A7C4',
      background: '#FFF5FA',
      text: '#311827',
    },
  ];

  const HERO_LAYOUTS = [
    { value: 'classic', label: 'Classic', hint: 'Centred title' },
    { value: 'editorial', label: 'Editorial', hint: 'Split with photo' },
    { value: 'full_bleed', label: 'Full bleed', hint: 'Photo behind title' },
  ];

  const TEMPLATES = [
    { value: 'classic', label: 'Classic' },
    { value: 'modern', label: 'Modern' },
    { value: 'romantic', label: 'Romantic' },
    { value: 'minimal', label: 'Minimal' },
  ];

  const RSVP_LABELS = {
    pending: 'Awaiting',
    attending: 'Attending',
    declined: 'Declined',
    maybe: 'Maybe',
  };

  const TABLE_TYPES = {
    round: 'Round',
    long: 'Long',
    top_table: 'Top table',
    custom: 'Custom',
  };

  const READINESS_LABELS = {
    coupleNames: 'Add your names',
    eventDate: 'Add your wedding date',
    venue: 'Add a venue',
    rsvpEnabled: 'Turn RSVPs on',
    slug: 'Choose a website link',
    password: 'Set a website password',
  };

  /* ------------------------------------------------------------------ *
   * Website form definition
   * ------------------------------------------------------------------ */

  const SCALAR_KEYS = [
    'coupleNames',
    'eventDate',
    'welcomeMessage',
    'ceremonyVenueName',
    'ceremonyVenueAddress',
    'receptionVenueName',
    'receptionVenueAddress',
    'arrivalTime',
    'ceremonyTime',
    'receptionTime',
    'finishTime',
    'dressCode',
    'childrenPolicy',
    'plusOnePolicy',
    'giftInfo',
    'parkingInfo',
    'accessibilityInfo',
    'loveStory',
    'proposalStory',
    'rsvpIntroText',
    'rsvpDeadline',
    'template',
  ];

  const LISTS = {
    accommodationRecommendations: {
      noun: 'place to stay',
      title: 'Where to stay',
      fields: [
        { key: 'name', label: 'Name' },
        { key: 'address', label: 'Address' },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'websiteUrl', label: 'Website', type: 'url', placeholder: 'https://' },
        { key: 'distance', label: 'Distance', placeholder: '5 minutes from the venue' },
        { key: 'description', label: 'Description' },
        { key: 'notes', label: 'Notes', wide: true },
      ],
    },
    taxiRecommendations: {
      noun: 'taxi firm',
      title: 'Taxis & transport',
      fields: [
        { key: 'name', label: 'Name' },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'websiteUrl', label: 'Website', type: 'url', placeholder: 'https://' },
        { key: 'notes', label: 'Notes' },
      ],
    },
    localInfo: {
      noun: 'local tip',
      title: 'Local tips',
      fields: [
        { key: 'title', label: 'Title' },
        { key: 'type', label: 'Type', placeholder: 'Restaurant, sightseeing…' },
        { key: 'url', label: 'Link', type: 'url', placeholder: 'https://' },
        { key: 'description', label: 'Description' },
      ],
    },
    weddingParty: {
      noun: 'person',
      title: 'Wedding party',
      fields: [
        { key: 'name', label: 'Name' },
        { key: 'role', label: 'Role', placeholder: 'Best man, maid of honour…' },
        { key: 'imageUrl', label: 'Photo link', type: 'url', placeholder: 'https://' },
        { key: 'bio', label: 'Short bio', wide: true, type: 'textarea' },
      ],
    },
    faq: {
      noun: 'question',
      title: 'FAQs',
      fields: [
        { key: 'question', label: 'Question', wide: true },
        { key: 'answer', label: 'Answer', wide: true, type: 'textarea' },
      ],
    },
    mealOptions: {
      noun: 'meal option',
      title: 'Meal options',
      compact: true,
      fields: [{ key: 'value', label: 'Meal option', placeholder: 'Vegetarian' }],
    },
    customRsvpQuestions: {
      noun: 'question',
      title: 'Extra RSVP questions',
      defaults: { type: 'text', required: 'false' },
      fields: [
        { key: 'label', label: 'Question', wide: true },
        {
          key: 'type',
          label: 'Answer type',
          type: 'select',
          options: [
            ['text', 'Short answer'],
            ['textarea', 'Long answer'],
            ['select', 'Pick one'],
            ['checkbox', 'Tick box'],
          ],
        },
        {
          key: 'required',
          label: 'Required?',
          type: 'select',
          options: [
            ['false', 'Optional'],
            ['true', 'Required'],
          ],
        },
        {
          key: 'optionsCsv',
          label: 'Choices (comma separated)',
          wide: true,
          showWhen: item => item.type === 'select',
        },
      ],
    },
  };

  const SECTIONS = [
    {
      id: 'essentials',
      icon: 'heart',
      title: 'The essentials',
      hint: 'Names, date, venues and welcome message',
      fields: [
        { key: 'coupleNames', label: 'Names', required: true, placeholder: 'Alex & Sam' },
        { key: 'eventDate', label: 'Wedding date', type: 'date', required: true },
        { key: 'ceremonyVenueName', label: 'Ceremony venue', required: true },
        { key: 'ceremonyVenueAddress', label: 'Ceremony address' },
        { key: 'receptionVenueName', label: 'Reception venue' },
        { key: 'receptionVenueAddress', label: 'Reception address' },
        {
          key: 'welcomeMessage',
          label: 'Welcome message',
          type: 'textarea',
          wide: true,
          placeholder: 'A few words to greet your guests',
        },
      ],
    },
    {
      id: 'info',
      icon: 'calendar',
      title: 'Timings & guest information',
      hint: 'Schedule, dress code and practical details',
      fields: [
        { key: 'arrivalTime', label: 'Guests arrive', placeholder: '13:00' },
        { key: 'ceremonyTime', label: 'Ceremony', placeholder: '14:00' },
        { key: 'receptionTime', label: 'Reception', placeholder: '17:30' },
        { key: 'finishTime', label: 'Finish', placeholder: 'Midnight' },
        { key: 'dressCode', label: 'Dress code', type: 'textarea', wide: true },
        { key: 'childrenPolicy', label: 'Children', type: 'textarea' },
        { key: 'plusOnePolicy', label: 'Plus ones', type: 'textarea' },
        { key: 'parkingInfo', label: 'Parking & drop-off', type: 'textarea' },
        { key: 'accessibilityInfo', label: 'Accessibility', type: 'textarea' },
        { key: 'giftInfo', label: 'Gifts', type: 'textarea', wide: true },
      ],
    },
    {
      id: 'travel',
      icon: 'map',
      title: 'Travel & stay',
      hint: 'Accommodation, taxis and local tips',
      lists: ['accommodationRecommendations', 'taxiRecommendations', 'localInfo'],
    },
    {
      id: 'story',
      icon: 'users',
      title: 'Story, party & FAQs',
      hint: 'Introduce yourselves and answer common questions',
      fields: [
        { key: 'loveStory', label: 'How we met', type: 'textarea', wide: true },
        { key: 'proposalStory', label: 'The proposal', type: 'textarea', wide: true },
      ],
      lists: ['weddingParty', 'faq'],
    },
    {
      id: 'rsvp',
      icon: 'mail',
      title: 'RSVP form',
      hint: 'Deadline, meal options and extra questions',
      toggle: 'rsvpEnabled',
      fields: [
        { key: 'rsvpDeadline', label: 'Reply by', type: 'date' },
        { key: 'rsvpIntroText', label: 'Message above the form', type: 'textarea', wide: true },
      ],
      lists: ['mealOptions', 'customRsvpQuestions'],
    },
    {
      id: 'look',
      icon: 'image',
      title: 'Look & photos',
      hint: 'Colours, layout, cover photo and gallery',
      custom: 'look',
    },
  ];

  /* ------------------------------------------------------------------ *
   * Icons
   * ------------------------------------------------------------------ */

  const ICONS = {
    overview:
      '<rect width="7" height="9" x="3" y="3" rx="1.5"/><rect width="7" height="5" x="14" y="3" rx="1.5"/><rect width="7" height="9" x="14" y="12" rx="1.5"/><rect width="7" height="5" x="3" y="16" rx="1.5"/>',
    website:
      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    guests:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    seating:
      '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="20.5" r="1.5"/><circle cx="3.5" cy="12" r="1.5"/><circle cx="20.5" cy="12" r="1.5"/>',
    share:
      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    external:
      '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    trash:
      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m18 15-6-6-6 6"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    image:
      '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    calendar:
      '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    heart:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    map: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
    refresh:
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    globe:
      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  };

  /** Inline SVG for a named icon (decorative, so hidden from screen readers). */
  function icon(name, size = 18) {
    return `<svg class="ww-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  let cachedPlans = [];
  let initialised = false;
  let app = null;

  /** Escapes a value for safe use in HTML text and attribute values. */
  function esc(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  /** Short random id with a readable prefix, for new rows created in the editor. */
  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /** Formats a count with its noun, e.g. "1 guest" / "3 guests". */
  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many || `${one}s`}`;
  }

  /** Whole-number percentage of `value` in `total`, clamped to 0–100. */
  function percent(value, total) {
    if (!total) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((Number(value || 0) / Number(total)) * 100)));
  }

  /** True for plans that are weddings or already carry a wedding website. */
  function isWeddingPlan(plan) {
    const type = String(plan?.eventType || '').toLowerCase();
    const name = String(plan?.name || plan?.eventName || '').toLowerCase();
    return Boolean(plan?.weddingWebsite) || type === 'wedding' || name.includes('wedding');
  }

  /** The plan the app works on: one with a website first, otherwise any wedding plan. */
  function pickPlan(plans) {
    const weddingPlans = (plans || []).filter(isWeddingPlan);
    return weddingPlans.find(plan => plan.weddingWebsite) || weddingPlans[0] || null;
  }

  /** CSRF token from the page meta tag or cookie, needed on every write request. */
  function getCsrfToken() {
    const fromMeta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (fromMeta) {
      return fromMeta;
    }
    const match = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  /**
   * fetch wrapper: sends cookies and the CSRF token, JSON-encodes object bodies and throws an
   * Error with the server message (and `payload`) on failure.
   */
  async function api(path, opts = {}) {
    const options = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && !options.headers['X-CSRF-Token']) {
      const token = getCsrfToken();
      if (token) {
        options.headers['X-CSRF-Token'] = token;
      }
    }
    if (options.body && typeof options.body !== 'string') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const res = await fetch(path, options);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        json.error || json.message || 'Something went wrong. Please try again.'
      );
      err.payload = json;
      err.status = res.status;
      throw err;
    }
    return json;
  }

  /** URL for a plan-scoped API endpoint. */
  const planPath = (plan, suffix = '') => `/api/me/plans/${encodeURIComponent(plan.id)}${suffix}`;

  /** UK-style short date, e.g. "9 Mar 2027" (or "9 Mar" without the year). */
  function formatDate(value, withYear = true) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  }

  /** Whole days from today until the given date (negative once it has passed), or null. */
  function daysUntil(value) {
    if (!value) {
      return null;
    }
    const target = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
      return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  /** Relative time such as "5 min ago" or "3d ago"; older dates fall back to a short date. */
  function timeAgo(iso) {
    const then = new Date(iso).getTime();
    if (!then) {
      return '';
    }
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 2) {
      return 'just now';
    }
    if (mins < 60) {
      return `${mins} min ago`;
    }
    const hours = Math.round(mins / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.round(hours / 24);
    return days < 8 ? `${days}d ago` : formatDate(iso, false);
  }

  /** Up to two capital letters for an avatar. */
  function initials(name) {
    const parts = String(name || '?')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return (
      (parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }

  /** Lower-case, dash-separated website link, matching the server rules. */
  function normalizeSlug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
  }

  /** Returns the URL only if it is an https/http link or an image data URL, otherwise ''. */
  function safeImageUrl(value) {
    const url = String(value || '').trim();
    return SAFE_IMAGE_RE.test(url) ? url : '';
  }

  /** Normalises #rgb / #rrggbb to #RRGGBB, falling back when the value is not a hex colour. */
  function safeColour(value, fallback) {
    const raw = String(value || '').trim();
    const short = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (short) {
      return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
    }
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : fallback;
  }

  /** Reads a file as a data URL. */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read this image.'));
      reader.readAsDataURL(file);
    });
  }

  /** Redraws the photo on a canvas at decreasing sizes and qualities until it is small enough. */
  async function shrinkImage(file) {
    const bitmap = await createImageBitmap(file).catch(() => {
      throw new Error('Unable to read this image.');
    });
    try {
      for (const longestSide of [1600, 1280, 1024, 800]) {
        const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        // JPEG has no transparency, so flatten onto white.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.85, 0.72, 0.6]) {
          const url = canvas.toDataURL('image/jpeg', quality);
          if (url.length <= TARGET_IMAGE_CHARS) {
            return url;
          }
        }
      }
    } finally {
      bitmap.close?.();
    }
    throw new Error('Unable to shrink this image enough. Please try a smaller one.');
  }

  /** Reads a chosen photo as a data URL, shrinking anything too big for the server to keep. */
  async function readImage(file) {
    if (!file) {
      return '';
    }
    if (!IMAGE_TYPES.has(file.type)) {
      throw new Error('Please choose a JPG, PNG, WebP or GIF image.');
    }
    if (file.size > MAX_SOURCE_BYTES) {
      throw new Error('Please choose a photo under 12 MB.');
    }
    const original = await fileToDataUrl(file);
    if (original.length <= TARGET_IMAGE_CHARS) {
      return original;
    }
    if (file.type === 'image/gif') {
      throw new Error('That GIF is too large. Please use a smaller GIF, or a JPG or PNG.');
    }
    return shrinkImage(file);
  }

  /** Whether the guest has a table. */
  const isSeated = guest => Boolean(guest.tableId || guest.tableName || guest.table);
  /** Whether the guest has said they are coming. */
  const isAttending = guest => guest.rsvpStatus === 'attending';
  /** Whether the guest has not replied yet. */
  const isAwaiting = guest => !guest.rsvpStatus || guest.rsvpStatus === 'pending';
  /** Whether the guest has dietary or accessibility notes. */
  const hasNotes = guest =>
    Boolean(guest.dietaryRequirements || guest.dietary || guest.accessibilityRequirements);

  /** The guest-facing URL of the website, or an empty string before it has a link. */
  const publicUrl = site => (site?.slug ? `${window.location.origin}/wedding/${site.slug}` : '');

  /** Owner-only preview URL that also works while the website is still a draft. */
  function previewUrl() {
    const slug = app?.site?.slug;
    if (!slug || !app.plan) {
      return '';
    }
    return `/wedding/${encodeURIComponent(slug)}?preview=1&plan=${encodeURIComponent(app.plan.id)}`;
  }

  /* ------------------------------------------------------------------ *
   * Status (dashboard card pill)
   * ------------------------------------------------------------------ */

  /** Which of names / date / venue are still empty (the minimum needed to publish). */
  function essentialsMissing(source) {
    const missing = [];
    if (!String(source?.coupleNames || '').trim()) {
      missing.push('coupleNames');
    }
    if (!String(source?.eventDate || '').trim()) {
      missing.push('eventDate');
    }
    if (
      !String(source?.ceremonyVenueName || source?.venueName || '').trim() &&
      !String(source?.receptionVenueName || '').trim()
    ) {
      missing.push('venue');
    }
    return missing;
  }

  /** Label and key for the status pill, derived from the plan and website. */
  function statusMeta(site, plan) {
    if (!plan) {
      return { key: 'not-started', label: 'Not started' };
    }
    if (!site) {
      // A plan with no website yet: nothing has been drafted, so it has not started.
      return { key: 'not-started', label: 'Not started' };
    }
    if (site.status === 'published') {
      return { key: 'published', label: 'Published' };
    }
    if (!essentialsMissing(site).length) {
      return { key: 'ready', label: 'Ready to publish' };
    }
    return { key: 'in-progress', label: 'In progress' };
  }

  /** Updates the status pill on the dashboard card. */
  function setHeaderStatus(meta) {
    const pill = document.getElementById(STATUS_ID);
    if (!pill) {
      return;
    }
    pill.textContent = meta.label;
    pill.dataset.status = meta.key;
    pill.setAttribute('aria-label', `Wedding website status: ${meta.label}`);
  }

  /* ------------------------------------------------------------------ *
   * Data
   * ------------------------------------------------------------------ */

  /** The customer's plans from the server, falling back to those the dashboard already has. */
  async function fetchPlans(fallback) {
    try {
      const data = await api('/api/me/plans?source=mongodb&wedding=1', { cache: 'no-store' });
      if (Array.isArray(data.plans)) {
        return data.plans;
      }
    } catch {
      /* fall back to the plans the dashboard already loaded */
    }
    return fallback || [];
  }

  /** The plan's wedding website, or null when it has none yet. Network errors propagate. */
  async function getWebsite(plan) {
    if (!plan?.id) {
      return null;
    }
    const data = await api(planPath(plan, '/wedding-website'));
    return data.website || data.site || data.data?.website || null;
  }

  /** Returns the plan's website, creating a draft first when there is none. */
  async function ensureWebsite(plan) {
    const existing = await getWebsite(plan);
    if (existing) {
      return existing;
    }
    await api(planPath(plan, '/wedding-website'), {
      method: 'POST',
      body: {
        coupleNames: plan.name || plan.eventName || 'Our Wedding',
        ceremonyVenueName: plan.venueName || plan.location || '',
      },
    });
    return getWebsite(plan);
  }

  /** Loads the guest list and tables into the app state. Errors propagate. */
  async function loadGuestsAndTables() {
    if (!app.plan) {
      app.guests = [];
      app.tables = [];
      return;
    }
    const [guests, tables] = await Promise.all([
      api(planPath(app.plan, '/guests')),
      api(planPath(app.plan, '/tables')),
    ]);
    app.guests = guests.guests || [];
    app.tables = tables.tables || [];
  }

  /** Refreshes guests and tables from the server, then redraws the current view. */
  async function reloadGuestsAndRender() {
    await loadGuestsAndTables();
    renderActive();
  }

  /* ------------------------------------------------------------------ *
   * Draft (editable copy of the website)
   * ------------------------------------------------------------------ */

  /** Date and venue taken from the plan, used to pre-fill empty website fields. */
  function planFallbacks(plan) {
    const first = (...values) => values.map(v => String(v || '').trim()).find(Boolean) || '';
    const venue = first(plan?.venueName, plan?.venue, plan?.location, plan?.selectedVenue?.name);
    return {
      eventDate: first(plan?.eventDate, plan?.date, plan?.weddingDate).slice(0, 10),
      ceremonyVenueName: venue,
      ceremonyVenueAddress: first(plan?.venueAddress, plan?.address, plan?.selectedVenue?.address),
    };
  }

  /** Editable copy of the website for the form, with validated colours and image URLs. */
  function makeDraft(site, plan) {
    const fallback = planFallbacks(plan);
    const draft = { rsvpEnabled: site.rsvpEnabled !== false, lists: {}, theme: {} };
    SCALAR_KEYS.forEach(key => {
      let value = site[key];
      if (key === 'ceremonyVenueName') {
        value = value || site.venueName;
      }
      if (key === 'ceremonyVenueAddress') {
        value = value || site.venueAddress;
      }
      if (key === 'eventDate' || key === 'rsvpDeadline') {
        value = String(value || '').slice(0, 10);
      }
      draft[key] = String(value || fallback[key] || '');
    });
    if (!TEMPLATES.some(t => t.value === draft.template)) {
      draft.template = 'classic';
    }
    Object.keys(LISTS).forEach(name => {
      if (name === 'mealOptions') {
        draft.lists[name] = (site.mealOptions || []).map(value => ({ id: uid('meal'), value }));
      } else if (name === 'customRsvpQuestions') {
        draft.lists[name] = (site.customRsvpQuestions || []).map(question => ({
          id: question.id || uid('question'),
          label: question.label || '',
          type: question.type || 'text',
          required: String(Boolean(question.required)),
          optionsCsv: (question.options || []).join(', '),
        }));
      } else {
        draft.lists[name] = (site[name] || []).map(item => ({ ...item }));
      }
    });
    draft.theme = {
      accentColor: safeColour(site.accentColor, PALETTES[0].accent),
      secondaryColor: safeColour(site.secondaryColor, PALETTES[0].secondary),
      backgroundColor: safeColour(site.backgroundColor, PALETTES[0].background),
      textColor: safeColour(site.textColor, PALETTES[0].text),
      heroLayout: HERO_LAYOUTS.some(l => l.value === site.heroLayout) ? site.heroLayout : 'classic',
      coverImageUrl: safeImageUrl(site.coverImageUrl),
      galleryImages: (Array.isArray(site.galleryImages) ? site.galleryImages : [])
        .map(item => ({ ...item, imageUrl: safeImageUrl(item?.imageUrl) }))
        .filter(item => item.imageUrl),
    };
    return draft;
  }

  /** Body for the website PATCH: text fields and lists only (photos go with the theme). */
  function draftPayload() {
    const draft = app.draft;
    const payload = { rsvpEnabled: draft.rsvpEnabled };
    SCALAR_KEYS.forEach(key => {
      payload[key] = draft[key];
    });
    Object.keys(LISTS).forEach(name => {
      const rows = draft.lists[name];
      if (name === 'mealOptions') {
        payload.mealOptions = rows.map(item => String(item.value || '').trim()).filter(Boolean);
      } else if (name === 'customRsvpQuestions') {
        payload.customRsvpQuestions = rows
          .filter(item => String(item.label || '').trim())
          .map(item => ({
            id: item.id || uid('question'),
            label: item.label.trim(),
            type: ['text', 'textarea', 'select', 'checkbox'].includes(item.type)
              ? item.type
              : 'text',
            required: item.required === 'true',
            options: String(item.optionsCsv || '')
              .split(',')
              .map(option => option.trim())
              .filter(Boolean),
          }));
      } else {
        // Rows the customer added but never filled in are not sent.
        payload[name] = rows.filter(item =>
          Object.entries(item).some(([key, value]) => key !== 'id' && String(value || '').trim())
        );
      }
    });
    return payload;
  }

  /** Body for the theme/media PATCH: colours, hero layout, cover and gallery. */
  function themePayload() {
    const theme = app.draft.theme;
    return {
      accentColor: theme.accentColor,
      secondaryColor: theme.secondaryColor,
      backgroundColor: theme.backgroundColor,
      textColor: theme.textColor,
      heroLayout: theme.heroLayout,
      coverImageUrl: theme.coverImageUrl,
      galleryImages: theme.galleryImages,
    };
  }

  /** Marks the editor dirty; `part` records whether the site text or the theme/photos changed. */
  function setDirty(value, part) {
    app.dirty = value;
    app.touched = value
      ? { ...app.touched, [part || 'site']: true }
      : { site: false, theme: false };
    const bar = app.dialog?.querySelector('.ww-savebar');
    if (bar) {
      bar.dataset.state = value ? 'dirty' : 'clean';
      bar.querySelector('.ww-savebar__text').textContent = value
        ? 'You have unsaved changes'
        : 'All changes saved';
    }
  }

  /* ------------------------------------------------------------------ *
   * Derived numbers
   * ------------------------------------------------------------------ */

  /** Guest and seating counts used across the views. */
  function stats() {
    const guests = app.guests;
    const attending = guests.filter(isAttending);
    const awaiting = guests.filter(isAwaiting);
    const seated = attending.filter(isSeated).length;
    return {
      total: guests.length,
      attending: attending.length,
      declined: guests.filter(g => g.rsvpStatus === 'declined').length,
      maybe: guests.filter(g => g.rsvpStatus === 'maybe').length,
      awaiting: awaiting.length,
      replied: guests.length - awaiting.length,
      headcount: attending.reduce((sum, g) => sum + (Number(g.partySize) || 1), 0),
      seated,
      unseated: attending.length - seated,
      notes: guests.filter(hasNotes).length,
    };
  }

  /** The five setup steps on the Overview, with their completion state. */
  function checklist() {
    const st = stats();
    const site = app.site;
    return [
      {
        label: 'Add your wedding details',
        done: Boolean(site) && !essentialsMissing(site).length,
        go: 'website',
        section: 'essentials',
      },
      {
        label: 'Set up your RSVP form',
        done: Boolean(site) && site.rsvpEnabled !== false && Boolean(site.rsvpDeadline),
        go: 'website',
        section: 'rsvp',
      },
      { label: 'Add your guests', done: st.total > 0, go: 'guests' },
      { label: 'Publish your website', done: site?.status === 'published', go: 'share' },
      {
        label: 'Seat your guests',
        done: st.attending > 0 && st.unseated === 0,
        go: 'seating',
      },
    ];
  }

  /** The single most useful thing to do next, based on what is already done. */
  function nextStep() {
    const st = stats();
    const site = app.site;
    if (!site) {
      return {
        title: 'Create your wedding website',
        body: 'Start your free draft, then add your details whenever you are ready.',
        cta: 'Create website',
        go: 'website',
      };
    }
    if (essentialsMissing(site).length) {
      return {
        title: 'Add your wedding details',
        body: 'Names, date and venue are all guests need to see a beautiful first version.',
        cta: 'Add details',
        go: 'website',
        section: 'essentials',
      };
    }
    if (site.status !== 'published') {
      return {
        title: 'Review and publish',
        body: 'Your essentials are in. Preview the site, then publish when you are happy.',
        cta: 'Open website',
        go: 'website',
      };
    }
    if (!st.total) {
      return {
        title: 'Add your guests',
        body: 'Build your guest list so you can track replies and plan seating.',
        cta: 'Add guests',
        go: 'guests',
        add: true,
      };
    }
    if (st.awaiting) {
      return {
        title: `${plural(st.awaiting, 'guest')} still to reply`,
        body: 'Keep an eye on outstanding RSVPs and nudge anyone who has gone quiet.',
        cta: 'View awaiting',
        go: 'guests',
        filter: 'awaiting',
      };
    }
    if (st.unseated) {
      return {
        title: `Seat ${plural(st.unseated, 'remaining guest')}`,
        body: 'Everyone has replied. Give the last few guests a table.',
        cta: 'Open seating',
        go: 'seating',
      };
    }
    return {
      title: 'Share your link',
      body: 'Everything looks great. Send your website to guests by link, QR code or message.',
      cta: 'Open share tools',
      go: 'share',
    };
  }

  /* ------------------------------------------------------------------ *
   * Toasts, confirm dialog, busy buttons
   * ------------------------------------------------------------------ */

  /** Brief status message shown inside the open app. */
  function toast(message, type = 'ok') {
    const host = app?.dialog?.querySelector('.ww-toasts');
    if (!host) {
      return;
    }
    host.querySelectorAll('.ww-toast').forEach(old => old.remove());
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type}`;
    if (type === 'warn') {
      el.setAttribute('role', 'alert');
    }
    el.innerHTML = `${icon(type === 'warn' ? 'info' : 'check', 16)}<span>${esc(message)}</span>`;
    host.appendChild(el);
    window.requestAnimationFrame(() => el.classList.add('is-in'));
    window.setTimeout(() => {
      el.classList.remove('is-in');
      window.setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  /** Disables a button and flags it busy while a request is running. */
  function setBusy(button, busy) {
    if (!button) {
      return;
    }
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', String(Boolean(busy)));
  }

  /** Runs an async task with the button disabled, turning any error into a warning toast. */
  async function guard(button, task) {
    setBusy(button, true);
    try {
      return await task();
    } catch (err) {
      toast(err.message || 'Something went wrong. Please try again.', 'warn');
      return undefined;
    } finally {
      if (button?.isConnected) {
        setBusy(button, false);
      }
    }
  }

  /** Appends a dialog to the page and shows it as a modal. */
  function openModal(dialog) {
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.show();
    }
  }

  /** Asks the customer to confirm; resolves true only when they choose to continue. */
  function confirmAction({ title, message, confirmLabel = 'Continue', danger = false }) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ww-modal ww-modal--narrow';
      dialog.setAttribute('aria-labelledby', 'ww-confirm-title');
      dialog.innerHTML = `<div class="ww-modal__body"><h3 id="ww-confirm-title" class="ww-modal__title">${esc(title)}</h3><p class="ww-modal__text">${esc(message)}</p></div><div class="ww-modal__foot"><button type="button" class="ww-btn ww-btn--ghost" data-confirm="no">Cancel</button><button type="button" class="ww-btn ${danger ? 'ww-btn--danger' : 'ww-btn--primary'}" data-confirm="yes">${esc(confirmLabel)}</button></div>`;
      let result = false;
      dialog.addEventListener('click', event => {
        const choice = event.target.closest('[data-confirm]')?.dataset.confirm;
        if (choice) {
          result = choice === 'yes';
          dialog.close();
        }
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(result);
      });
      openModal(dialog);
      dialog.querySelector('[data-confirm="no"]').focus();
    });
  }

  /* ------------------------------------------------------------------ *
   * App shell
   * ------------------------------------------------------------------ */

  /** The app frame: sidebar navigation, top bar, tab panels and toast area. */
  function shellHtml() {
    const nav = TABS.map(
      (tab, index) =>
        `<button type="button" class="ww-nav__item" role="tab" id="ww-tab-${tab.key}" data-go="${tab.key}" aria-selected="${index === 0}" aria-controls="ww-pane-${tab.key}"${index === 0 ? '' : ' tabindex="-1"'}>${icon(tab.icon, 20)}<span>${esc(tab.label)}</span><em class="ww-nav__count" data-count="${tab.key}" hidden></em></button>`
    ).join('');
    const panes = TABS.map(
      (tab, index) =>
        `<section class="ww-pane" id="ww-pane-${tab.key}" data-pane="${tab.key}" role="tabpanel" aria-labelledby="ww-tab-${tab.key}"${index === 0 ? '' : ' hidden'}></section>`
    ).join('');
    return `<div class="ww-shell">
      <aside class="ww-side">
        <div class="ww-brand"><span class="ww-brand__mark">${icon('heart', 18)}</span><div><p class="ww-brand__eyebrow">EventFlow</p><h2 class="ww-brand__title" id="ww-app-title">Wedding Website &amp; RSVPs</h2></div></div>
        <nav class="ww-nav" role="tablist" aria-orientation="vertical" aria-label="Wedding Website sections">${nav}</nav>
        <p class="ww-side__note">${icon('lock', 14)}<span>Private to you. Guests only see what you publish.</span></p>
      </aside>
      <div class="ww-main">
        <header class="ww-top">
          <div class="ww-top__titles"><h3 class="ww-top__title" id="ww-top-title">Overview</h3></div>
          <div class="ww-top__actions"><span class="ww-status" data-status="not-started" id="ww-status"></span><button type="button" class="ww-icon-btn" data-action="close" aria-label="Close Wedding Website app">${icon('close', 20)}</button></div>
        </header>
        <div class="ww-scroll" id="ww-scroll">${panes}</div>
      </div>
      <div class="ww-toasts" aria-live="polite"></div>
    </div>`;
  }

  /** Placeholder blocks shown while data loads. */
  function loadingHtml() {
    return '<div class="ww-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>';
  }

  /** Message and retry button shown when the workspace could not be loaded. */
  function loadErrorHtml() {
    return `<div class="ww-card">${emptyState({
      iconName: 'info',
      title: 'We could not load your wedding workspace',
      body: app.loadError,
      actions:
        '<button type="button" class="ww-btn ww-btn--primary" data-action="retry-load">Try again</button>',
    })}</div>`;
  }

  /** Syncs the status pill, page title and guest count with the current state. */
  function updateChrome() {
    const meta = statusMeta(app.site, app.plan);
    const status = app.dialog.querySelector('#ww-status');
    status.textContent = meta.label;
    status.dataset.status = meta.key;
    app.dialog.querySelector('#ww-top-title').textContent = TABS.find(t => t.key === app.tab).title;
    const guestsCount = app.dialog.querySelector('[data-count="guests"]');
    guestsCount.hidden = !app.guests.length;
    guestsCount.textContent = app.guests.length;
  }

  /** Smooth scrolling, unless the customer prefers reduced motion. */
  const scrollBehavior = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

  /**
   * Switches tab, optionally opening an editor section, applying a guest filter or opening the
   * add-guest form.
   */
  function goTo(tab, opts = {}) {
    if (!TABS.some(item => item.key === tab)) {
      return;
    }
    app.tab = tab;
    if (opts.section) {
      app.ui.openSection = opts.section;
    }
    if (opts.filter) {
      app.ui.guestFilter = opts.filter;
      app.ui.guestPage = 1;
    }
    app.dialog.querySelectorAll('.ww-nav__item').forEach(button => {
      const active = button.dataset.go === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    app.dialog.querySelectorAll('.ww-pane').forEach(pane => {
      pane.hidden = pane.dataset.pane !== tab;
    });
    renderActive({ resetScroll: !opts.keepScroll });
    if (opts.add) {
      editGuest(null);
    }
    if (opts.section) {
      window.requestAnimationFrame(() => {
        app.dialog
          .querySelector(`[data-section="${opts.section}"]`)
          ?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
      });
    }
  }

  /**
   * Redraws the visible tab from the current state, keeping the scroll position unless asked
   * to reset it.
   */
  function renderActive({ resetScroll = false } = {}) {
    if (!app) {
      return;
    }
    const scroller = app.dialog.querySelector('#ww-scroll');
    const top = scroller.scrollTop;
    const pane = app.dialog.querySelector(`[data-pane="${app.tab}"]`);
    const views = {
      overview: viewOverview,
      website: viewWebsite,
      guests: viewGuests,
      seating: viewSeating,
      share: viewShare,
    };
    if (app.loading) {
      pane.innerHTML = loadingHtml();
    } else if (app.loadError) {
      pane.innerHTML = loadErrorHtml();
    } else {
      pane.innerHTML = views[app.tab]();
    }
    scroller.scrollTop = resetScroll ? 0 : top;
    updateChrome();
  }

  /* ------------------------------------------------------------------ *
   * Shared view fragments
   * ------------------------------------------------------------------ */

  /** Centred icon, heading and message with optional action buttons. */
  function emptyState({ iconName, title, body, actions = '' }) {
    return `<div class="ww-empty">${`<span class="ww-empty__icon">${icon(iconName, 26)}</span>`}<h4>${esc(title)}</h4><p>${esc(body)}</p>${actions ? `<div class="ww-empty__actions">${actions}</div>` : ''}</div>`;
  }

  /** Coloured RSVP status pill. */
  function badge(status) {
    const key = String(status || 'pending').toLowerCase();
    return `<span class="ww-badge ww-badge--${esc(key)}">${esc(RSVP_LABELS[key] || key)}</span>`;
  }

  /** First-run choices shown when the customer has no wedding plan yet. */
  function needsWorkspace() {
    const cards = [
      '<article class="ww-choice ww-choice--primary"><h4>Free wedding website</h4><p>The quickest way to a guest website, RSVP form, guest list and seating plan.</p><button type="button" class="ww-btn ww-btn--primary" id="ww-quick-start" data-action="quick-start">Create wedding website</button></article>',
    ];
    if (cachedPlans.length) {
      cards.push(
        `<article class="ww-choice"><h4>Use an existing plan</h4><p>Attach your wedding website to a plan you have already created.</p><select class="ww-input" id="ww-existing-plan" aria-label="Choose a plan"><option value="">Choose a plan</option>${cachedPlans
          .map(
            item =>
              `<option value="${esc(item.id)}">${esc(item.name || item.eventName || 'Untitled plan')}</option>`
          )
          .join(
            ''
          )}</select><button type="button" class="ww-btn ww-btn--secondary" data-action="use-existing">Use this plan</button></article>`
      );
    }
    cards.push(
      '<article class="ww-choice"><h4>Full event plan</h4><p>Add budget, suppliers and tasks alongside your wedding website.</p><a class="ww-btn ww-btn--secondary" href="/start">Create event plan</a></article>'
    );
    return `<div class="ww-start"><span class="ww-start__icon">${icon('heart', 28)}</span><h4>Let's set up your wedding hub</h4><p>Choose how you would like to begin. You can change anything later.</p><div class="ww-start__grid">${cards.join('')}</div></div>`;
  }

  /* ------------------------------------------------------------------ *
   * View: Overview
   * ------------------------------------------------------------------ */

  /** One figure on the Overview, optionally with a progress bar. */
  function statCard({ label, value, sub, pct }) {
    return `<div class="ww-stat"><p class="ww-stat__label">${esc(label)}</p><p class="ww-stat__value">${value}</p>${
      pct === undefined
        ? ''
        : `<div class="ww-meter" role="img" aria-label="${esc(label)} ${pct}%"><span style="width:${pct}%"></span></div>`
    }<p class="ww-stat__sub">${esc(sub)}</p></div>`;
  }

  /** The "N days to go" badge (or "N days ago" once the wedding has passed). */
  function countdownHtml(days) {
    if (days === null) {
      return '';
    }
    const past = days < 0;
    const count = Math.abs(days);
    return `<div class="ww-countdown ${past ? 'ww-countdown--past' : ''}"><strong>${count}</strong><span>${count === 1 ? 'day' : 'days'} ${past ? 'ago' : 'to go'}</span></div>`;
  }

  /** Names, date and venue at the top of the Overview. */
  function overviewHero(site) {
    // Before the website exists the date and place come from the plan, which already has them;
    // asking for them again would be asking for something the customer has told us.
    const eventDate = site ? site.eventDate : app.plan.eventDate || app.plan.date;
    const days = daysUntil(eventDate);
    const names = site?.coupleNames || app.plan.name || 'Your wedding';
    const meta = [
      eventDate ? formatDate(eventDate) : '',
      site ? site.ceremonyVenueName || site.venueName : app.plan.location,
    ]
      .filter(Boolean)
      .join(' · ');
    return `<section class="ww-card ww-hero">
        <div class="ww-hero__text"><p class="ww-eyebrow">Your wedding</p><h4 class="ww-hero__title">${esc(names)}</h4><p class="ww-hero__meta">${esc(meta || 'Add your date and venue to complete your details.')}</p></div>
${countdownHtml(days)}
      </section>`;
  }

  /** The highlighted "next step" card. */
  function overviewNext() {
    const next = nextStep();
    return `<section class="ww-card ww-next">
        <span class="ww-next__icon">${icon('arrow', 20)}</span>
        <div class="ww-next__text"><p class="ww-eyebrow">Next step</p><h4>${esc(next.title)}</h4><p>${esc(next.body)}</p></div>
        <button type="button" class="ww-btn ww-btn--primary" data-go="${next.go}" ${next.section ? `data-section-target="${next.section}"` : ''} ${next.filter ? `data-filter-target="${next.filter}"` : ''} ${next.add ? 'data-add-target="1"' : ''}>${esc(next.cta)}</button>
      </section>`;
  }

  /** The four headline figures: guests, replies, attending and seated. */
  function overviewStats(st) {
    return `<div class="ww-stats">
        ${statCard({ label: 'Guests', value: st.total, sub: st.total ? `${plural(st.notes, 'dietary or access note')}` : 'No guests added yet' })}
        ${statCard({ label: 'Replied', value: `${st.replied}<small>/${st.total}</small>`, sub: st.awaiting ? `${st.awaiting} awaiting a reply` : st.total ? 'Everyone has replied' : 'Waiting for guests', pct: percent(st.replied, st.total) })}
        ${statCard({ label: 'Attending', value: st.attending, sub: st.headcount ? `${plural(st.headcount, 'person', 'people')} including plus ones` : `${st.declined} declined` })}
        ${statCard({ label: 'Seated', value: `${st.seated}<small>/${st.attending}</small>`, sub: st.unseated ? `${st.unseated} still need a table` : st.attending ? 'Everyone has a seat' : 'No attending guests yet', pct: percent(st.seated, st.attending) })}
      </div>`;
  }

  /** Setup checklist card with overall progress. */
  function overviewChecklist() {
    const items = checklist();
    const done = items.filter(item => item.done).length;
    return `<section class="ww-card">
          <header class="ww-card__head"><h4>Setup checklist</h4><span class="ww-pill">${done} of ${items.length}</span></header>
          <div class="ww-meter ww-meter--lg" role="img" aria-label="Setup ${percent(done, items.length)}% complete"><span style="width:${percent(done, items.length)}%"></span></div>
          <ul class="ww-checklist">${items
            .map(
              item =>
                `<li><button type="button" class="ww-check ${item.done ? 'is-done' : ''}" data-go="${item.go}" ${item.section ? `data-section-target="${item.section}"` : ''}><span class="ww-check__box">${item.done ? icon('check', 14) : ''}</span><span class="ww-check__label">${esc(item.label)}</span>${icon('arrow', 16)}</button></li>`
            )
            .join('')}</ul>
        </section>`;
  }

  /** The most recent RSVP responses. */
  function overviewReplies(st) {
    const recent = [...app.guests]
      .filter(g => !isAwaiting(g) && g.updatedAt)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 5);
    return `<section class="ww-card">
          <header class="ww-card__head"><h4>Latest replies</h4>${st.replied ? '<button type="button" class="ww-link" data-go="guests">View all</button>' : ''}</header>
          ${
            recent.length
              ? `<ul class="ww-feed">${recent
                  .map(
                    g =>
                      `<li><span class="ww-avatar">${esc(initials(g.name))}</span><div><strong>${esc(g.name)}</strong><small>${esc(timeAgo(g.updatedAt))}${g.source === 'public_rsvp' ? ' · via RSVP form' : ''}</small></div>${badge(g.rsvpStatus)}</li>`
                  )
                  .join('')}</ul>`
              : '<p class="ww-muted-note">Replies will appear here as soon as guests respond.</p>'
          }
        </section>`;
  }

  /** Guest link with copy and share shortcuts, once the website has a link. */
  function overviewLinkBar(site) {
    const url = publicUrl(site);
    const live = site?.status === 'published';
    return url
      ? `<section class="ww-card ww-linkbar"><div class="ww-linkbar__text"><span class="ww-dot ${live ? 'is-live' : ''}"></span><div><p class="ww-eyebrow">${live ? 'Live guest link' : 'Guest link (not live yet)'}</p><p class="ww-linkbar__url">${esc(url.replace(/^https?:\/\//, ''))}</p></div></div><div class="ww-linkbar__actions"><button type="button" class="ww-btn ww-btn--secondary" data-action="copy-link">${icon('copy', 16)}Copy link</button><button type="button" class="ww-btn ww-btn--ghost" data-go="share">Share tools</button></div></section>`
      : '';
  }

  /** Overview tab. */
  function viewOverview() {
    if (!app.plan) {
      return needsWorkspace();
    }
    const st = stats();
    return `<div class="ww-stack">
      ${overviewHero(app.site)}
      ${overviewNext()}
      ${overviewStats(st)}
      <div class="ww-columns">
        ${overviewChecklist()}
        ${overviewReplies(st)}
      </div>
      ${overviewLinkBar(app.site)}
    </div>`;
  }

  /* ------------------------------------------------------------------ *
   * View: Website (editor)
   * ------------------------------------------------------------------ */

  /** The input, textarea or select for a form field, bound by data attributes. */
  function inputControl(field, value, attrs) {
    const common = `class="ww-input" ${attrs}`;
    if (field.type === 'textarea') {
      return `<textarea ${common} rows="3" placeholder="${esc(field.placeholder || '')}">${esc(value)}</textarea>`;
    }
    if (field.type === 'select') {
      return `<select ${common}>${field.options
        .map(
          ([val, label]) =>
            `<option value="${esc(val)}" ${String(value) === String(val) ? 'selected' : ''}>${esc(label)}</option>`
        )
        .join('')}</select>`;
    }
    return `<input ${common} type="${field.type || 'text'}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}" autocomplete="off">`;
  }

  /** A labelled form field. */
  function fieldHtml(field, value, attrs) {
    return `<label class="ww-field ${field.wide ? 'ww-field--wide' : ''}"><span class="ww-label">${esc(field.label)}${field.required ? '<em>Required</em>' : ''}</span>${inputControl(field, value, attrs)}</label>`;
  }

  /** An editable list of rows (FAQs, places to stay, meal options…) with an add button. */
  function listHtml(name) {
    const def = LISTS[name];
    const rows = app.draft.lists[name];
    const noun = def.noun;
    const items = rows
      .map((item, index) => {
        const fields = def.fields
          .filter(field => !field.showWhen || field.showWhen(item))
          .map(field =>
            fieldHtml(
              field,
              item[field.key] ?? '',
              `data-list="${name}" data-i="${index}" data-k="${field.key}"`
            )
          )
          .join('');
        return `<div class="ww-item ${def.compact ? 'ww-item--compact' : ''}"><div class="ww-item__fields">${fields}</div><button type="button" class="ww-icon-btn ww-icon-btn--danger" data-action="remove-item" data-list="${name}" data-i="${index}" aria-label="Remove ${esc(noun)} ${index + 1}">${icon('trash', 16)}</button></div>`;
      })
      .join('');
    return `<div class="ww-list"><div class="ww-list__head"><h5>${esc(def.title)}</h5><span class="ww-muted">${rows.length ? plural(rows.length, 'entry', 'entries') : 'Optional'}</span></div>${items}<button type="button" class="ww-add" data-action="add-item" data-list="${name}">${icon('plus', 16)}Add ${esc(noun)}</button></div>`;
  }

  /**
   * The "Look & photos" section: palette, colours, hero layout, template, photos and live
   * preview.
   */
  function lookHtml() {
    const theme = app.draft.theme;
    const gallery = theme.galleryImages
      .map(
        (item, index) =>
          `<article class="ww-thumb"><img src="${esc(item.imageUrl)}" alt="${esc(item.alt || item.caption || `Gallery photo ${index + 1}`)}"><input class="ww-input" data-gallery-caption="${index}" value="${esc(item.caption || '')}" placeholder="Caption (optional)" aria-label="Caption for photo ${index + 1}"><div class="ww-thumb__tools"><button type="button" class="ww-icon-btn" data-action="gallery-move" data-i="${index}" data-dir="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move photo ${index + 1} earlier">${icon('chevronUp', 16)}</button><button type="button" class="ww-icon-btn" data-action="gallery-move" data-i="${index}" data-dir="1" ${index === theme.galleryImages.length - 1 ? 'disabled' : ''} aria-label="Move photo ${index + 1} later">${icon('chevron', 16)}</button><button type="button" class="ww-icon-btn ww-icon-btn--danger" data-action="gallery-remove" data-i="${index}" aria-label="Remove photo ${index + 1}">${icon('trash', 16)}</button></div></article>`
      )
      .join('');
    const colour = (key, label) =>
      `<label class="ww-swatch"><input type="color" data-theme="${key}" value="${esc(theme[key])}"><span class="ww-swatch__chip" style="background:${esc(theme[key])}"></span><span class="ww-swatch__label">${label}</span></label>`;
    const names = app.draft.coupleNames || 'Your names';
    const dateLine = [
      app.draft.eventDate ? formatDate(app.draft.eventDate) : '',
      app.draft.ceremonyVenueName,
    ]
      .filter(Boolean)
      .join(' · ');
    return `<div class="ww-look">
      <div class="ww-look__controls">
        <div class="ww-group"><h5>Colour palette</h5><div class="ww-palettes">${PALETTES.map(
          (p, i) =>
            `<button type="button" class="ww-palette ${isActivePalette(p) ? 'is-active' : ''}" data-action="palette" data-i="${i}" title="${esc(p.name)}" aria-label="Use ${esc(p.name)} palette"><span style="background:${p.accent}"></span><span style="background:${p.secondary}"></span><span style="background:${p.background}"></span><em>${esc(p.name)}</em></button>`
        ).join('')}</div>
          <div class="ww-swatches">${colour('accentColor', 'Accent')}${colour('secondaryColor', 'Secondary')}${colour('backgroundColor', 'Background')}${colour('textColor', 'Text')}</div></div>
        <div class="ww-group"><h5>Hero layout</h5><div class="ww-segment" role="radiogroup" aria-label="Hero layout">${HERO_LAYOUTS.map(
          layout =>
            `<label class="ww-segment__item"><input type="radio" name="ww-hero-layout" data-theme="heroLayout" value="${layout.value}" ${theme.heroLayout === layout.value ? 'checked' : ''}><span><strong>${esc(layout.label)}</strong><small>${esc(layout.hint)}</small></span></label>`
        ).join('')}</div></div>
        <div class="ww-group"><h5>Style</h5><label class="ww-field"><span class="ww-label">Website template</span><select class="ww-input" data-f="template">${TEMPLATES.map(
          tpl =>
            `<option value="${tpl.value}" ${app.draft.template === tpl.value ? 'selected' : ''}>${esc(tpl.label)}</option>`
        ).join('')}</select></label></div>
        <div class="ww-group"><h5>Cover photo</h5><div class="ww-actions-row"><label class="ww-btn ww-btn--secondary">${icon('image', 16)}${theme.coverImageUrl ? 'Replace photo' : 'Choose photo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload="cover" class="ww-sr"></label>${theme.coverImageUrl ? '<button type="button" class="ww-btn ww-btn--ghost" data-action="cover-remove">Remove</button>' : ''}</div><p class="ww-hint">JPG, PNG, WebP or GIF. Large photos are resized for you.</p></div>
        <div class="ww-group"><h5>Gallery <span class="ww-muted">${theme.galleryImages.length}/${MAX_GALLERY}</span></h5>${gallery ? `<div class="ww-gallery">${gallery}</div>` : ''}<div class="ww-actions-row"><label class="ww-btn ww-btn--secondary ${theme.galleryImages.length >= MAX_GALLERY ? 'is-disabled' : ''}">${icon('plus', 16)}Add photos<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple data-upload="gallery" class="ww-sr" ${theme.galleryImages.length >= MAX_GALLERY ? 'disabled' : ''}></label></div></div>
      </div>
      <aside class="ww-look__preview" aria-label="Website preview">
        <p class="ww-eyebrow">Live preview</p>
        <div class="ww-mini" data-mini style="${miniVars()}">
          <div class="ww-mini__hero" data-layout="${esc(theme.heroLayout)}" ${theme.coverImageUrl ? `style="background-image:url('${esc(theme.coverImageUrl)}')"` : ''}><small>We're getting married</small><strong>${esc(names)}</strong><span>${esc(dateLine || 'Date · Venue')}</span></div>
          <div class="ww-mini__body"><p>Join us for a day of love, laughter and celebration.</p><span class="ww-mini__btn">RSVP</span>${
            theme.galleryImages.length
              ? `<div class="ww-mini__gallery">${theme.galleryImages
                  .slice(0, 4)
                  .map(item => `<i style="background-image:url('${esc(item.imageUrl)}')"></i>`)
                  .join('')}</div>`
              : ''
          }</div>
        </div>
      </aside>
    </div>`;
  }

  /** Whether the current colours exactly match a preset palette. */
  function isActivePalette(palette) {
    const theme = app.draft.theme;
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    return (
      same(theme.accentColor, palette.accent) &&
      same(theme.secondaryColor, palette.secondary) &&
      same(theme.backgroundColor, palette.background) &&
      same(theme.textColor, palette.text)
    );
  }

  /** CSS custom properties that colour the live preview. */
  function miniVars() {
    const theme = app.draft.theme;
    return `--m-accent:${esc(theme.accentColor)};--m-2:${esc(theme.secondaryColor)};--m-bg:${esc(theme.backgroundColor)};--m-text:${esc(theme.textColor)}`;
  }

  /** The one-line status shown under each editor section title. */
  function sectionSummary(section) {
    const draft = app.draft;
    if (section.id === 'essentials') {
      const missing = essentialsMissing(draft);
      return missing.length ? `${missing.length} to complete` : 'Complete';
    }
    if (section.lists && !section.fields) {
      const count = section.lists.reduce((sum, name) => sum + draft.lists[name].length, 0);
      return count ? `${count} added` : section.hint;
    }
    if (section.id === 'rsvp') {
      return draft.rsvpEnabled
        ? draft.rsvpDeadline
          ? `Reply by ${formatDate(draft.rsvpDeadline)}`
          : 'No deadline set'
        : 'RSVPs are off';
    }
    if (section.id === 'look') {
      return `${draft.theme.galleryImages.length ? plural(draft.theme.galleryImages.length, 'photo') : 'No gallery yet'}`;
    }
    const filled = (section.fields || []).filter(field =>
      String(draft[field.key] || '').trim()
    ).length;
    const listCount = (section.lists || []).reduce(
      (sum, name) => sum + draft.lists[name].length,
      0
    );
    return filled + listCount ? `${filled + listCount} added` : section.hint;
  }

  /** Fields and lists of an editor section (only rendered while it is open). */
  function sectionBody(section) {
    if (section.custom === 'look') {
      return lookHtml();
    }
    const toggle = section.toggle
      ? `<label class="ww-toggle"><input type="checkbox" data-f="${section.toggle}" ${app.draft[section.toggle] ? 'checked' : ''}><span class="ww-toggle__track"></span><span class="ww-toggle__text"><strong>Collect RSVPs on your website</strong><small>Guests reply with the form on your public page.</small></span></label>`
      : '';
    const fields = section.fields
      ? `<div class="ww-grid">${section.fields.map(field => fieldHtml(field, app.draft[field.key], `data-f="${field.key}"`)).join('')}</div>`
      : '';
    const lists = (section.lists || []).map(listHtml).join('');
    return `${toggle}${fields}${lists}`;
  }

  /** Banner at the top of the editor: live, ready to publish, or what is still missing. */
  function readinessBanner() {
    if (app.site?.status === 'published') {
      return `<div class="ww-banner ww-banner--ok">${icon('check', 18)}<div><strong>Your website is live</strong><span>Changes go live as soon as you save.</span></div><a class="ww-link" href="${esc(publicUrl(app.site))}" target="_blank" rel="noopener">View site</a></div>`;
    }
    const missing = essentialsMissing(app.draft);
    if (!missing.length) {
      return `<div class="ww-banner ww-banner--ok">${icon('check', 18)}<div><strong>Ready to publish</strong><span>Save, preview, then publish when you are happy.</span></div></div>`;
    }
    return `<div class="ww-banner ww-banner--warn">${icon('info', 18)}<div><strong>Before you publish</strong><span>${missing
      .map(
        key =>
          `<button type="button" class="ww-chip" data-action="focus-field" data-key="${key}">${esc(READINESS_LABELS[key])}</button>`
      )
      .join('')}</span></div></div>`;
  }

  /** Website tab: the editor sections and the sticky save bar. */
  function viewWebsite() {
    if (!app.plan) {
      return needsWorkspace();
    }
    if (!app.site) {
      return `<div class="ww-card">${emptyState({
        iconName: 'website',
        title: 'Create your free wedding website',
        body: 'Start a draft now. You can add details, photos and your RSVP form whenever you are ready.',
        actions:
          '<button type="button" class="ww-btn ww-btn--primary" id="ww-create" data-action="create-site">Create website</button>',
      })}</div>`;
    }
    const live = app.site.status === 'published';
    const sections = SECTIONS.map(section => {
      const open = app.ui.openSection === section.id;
      return `<section class="ww-section ${open ? 'is-open' : ''}" data-section="${section.id}">
        <h4 class="ww-section__head"><button type="button" class="ww-section__toggle" data-action="toggle-section" data-id="${section.id}" aria-expanded="${open}" aria-controls="ww-sec-${section.id}"><span class="ww-section__icon">${icon(section.icon, 18)}</span><span class="ww-section__titles"><strong>${esc(section.title)}</strong><small data-summary="${section.id}">${esc(sectionSummary(section))}</small></span><span class="ww-section__chev">${icon('chevron', 18)}</span></button></h4>
        <div class="ww-section__body" id="ww-sec-${section.id}" ${open ? '' : 'hidden'}>${open ? sectionBody(section) : ''}</div>
      </section>`;
    }).join('');
    return `<div class="ww-stack ww-stack--editor">
      <div data-readiness>${readinessBanner()}</div>
      <div class="ww-sections">${sections}</div>
      <div class="ww-savebar" data-state="${app.dirty ? 'dirty' : 'clean'}">
        <span class="ww-savebar__dot"></span><span class="ww-savebar__text">${app.dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
        <div class="ww-savebar__actions">
          ${previewUrl() ? `<a class="ww-btn ww-btn--ghost" data-preview href="${esc(previewUrl())}" target="_blank" rel="noopener">${icon('eye', 16)}${live ? 'View live site' : 'Preview draft'}</a>` : ''}
          <button type="button" class="ww-btn ww-btn--secondary" data-action="${live ? 'unpublish' : 'publish'}">${live ? 'Unpublish' : 'Publish'}</button>
          <button type="button" class="ww-btn ww-btn--primary" data-action="save" id="ww-save">Save changes</button>
        </div>
      </div>
    </div>`;
  }

  /** Updates the banner, section summaries and live preview without redrawing the form. */
  function refreshEditorMeta() {
    const dialog = app.dialog;
    const banner = dialog.querySelector('[data-readiness]');
    if (banner) {
      banner.innerHTML = readinessBanner();
    }
    SECTIONS.forEach(section => {
      const el = dialog.querySelector(`[data-summary="${section.id}"]`);
      if (el) {
        el.textContent = sectionSummary(section);
      }
    });
    const mini = dialog.querySelector('[data-mini]');
    if (mini) {
      mini.setAttribute('style', miniVars());
      const hero = mini.querySelector('.ww-mini__hero');
      hero.dataset.layout = app.draft.theme.heroLayout;
      hero.style.backgroundImage = app.draft.theme.coverImageUrl
        ? `url('${app.draft.theme.coverImageUrl}')`
        : '';
      hero.querySelector('strong').textContent = app.draft.coupleNames || 'Your names';
      hero.querySelector('span').textContent =
        [app.draft.eventDate ? formatDate(app.draft.eventDate) : '', app.draft.ceremonyVenueName]
          .filter(Boolean)
          .join(' · ') || 'Date · Venue';
    }
  }

  /** Saves the editor. Photos and colours travel separately and only when they changed. */
  async function saveWebsite({ quiet = false } = {}) {
    const themeChanged = Boolean(app.touched.theme);
    await api(planPath(app.plan, '/wedding-website'), { method: 'PATCH', body: draftPayload() });
    if (themeChanged) {
      await api(planPath(app.plan, '/wedding-website/theme-media'), {
        method: 'PATCH',
        body: themePayload(),
      });
    }
    app.site = await getWebsite(app.plan);
    app.draft = makeDraft(app.site, app.plan);
    setDirty(false);
    if (!quiet) {
      toast('Changes saved');
    }
    renderActive();
  }

  /** True when the Share tab has a new link or privacy choice that has not been saved yet. */
  function shareDirty() {
    if (!app.site) {
      return false;
    }
    const slugChanged = app.ui.slug !== undefined && normalizeSlug(app.ui.slug) !== app.site.slug;
    const privacyChanged =
      app.ui.visibility !== undefined &&
      app.ui.visibility !== (app.site.visibility || 'private_link');
    return slugChanged || privacyChanged || Boolean(app.ui.password);
  }

  /** Sends the customer to the place where a publish blocker can be fixed. */
  function explainPublishBlockers(keys) {
    const labels = keys.map(key => (READINESS_LABELS[key] || key).toLowerCase());
    toast(`Before publishing: ${labels.join(', ')}`, 'warn');
    const essential = keys.find(key => ['coupleNames', 'eventDate', 'venue'].includes(key));
    if (essential) {
      focusField(essential);
    } else if (keys.includes('rsvpEnabled')) {
      goTo('website', { section: 'rsvp' });
    } else {
      goTo('share');
    }
  }

  /** Saves any edits, then publishes. Works from the Website and Share tabs. */
  async function publish(button) {
    const missing = essentialsMissing(app.draft);
    if (missing.length) {
      explainPublishBlockers(missing);
      return;
    }
    if (shareDirty()) {
      toast('Save your link settings before publishing', 'warn');
      goTo('share');
      return;
    }
    await guard(button, async () => {
      await saveWebsite({ quiet: true });
      try {
        await api(planPath(app.plan, '/wedding-website/publish'), { method: 'POST' });
      } catch (err) {
        const keys = err.payload?.checklist?.missing;
        if (Array.isArray(keys) && keys.length) {
          explainPublishBlockers(keys);
          return;
        }
        throw err;
      }
      app.site = await getWebsite(app.plan);
      app.draft = makeDraft(app.site, app.plan);
      setHeaderStatus(statusMeta(app.site, app.plan));
      toast('Your website is live');
      renderActive();
    });
  }

  /** Takes the website offline after confirmation. */
  async function unpublishWebsite(button) {
    const ok = await confirmAction({
      title: 'Unpublish your website?',
      message:
        'Guests will no longer be able to open your link or send RSVPs until you publish again.',
      confirmLabel: 'Unpublish',
      danger: true,
    });
    if (!ok) {
      return;
    }
    await guard(button, async () => {
      await api(planPath(app.plan, '/wedding-website/unpublish'), { method: 'POST' });
      app.site = await getWebsite(app.plan);
      setHeaderStatus(statusMeta(app.site, app.plan));
      toast('Website unpublished');
      renderActive();
    });
  }

  /** Opens the essentials section and focuses the field behind a publish blocker. */
  function focusField(key) {
    const target = key === 'venue' ? 'ceremonyVenueName' : key;
    app.ui.openSection = 'essentials';
    if (app.tab !== 'website') {
      goTo('website', { section: 'essentials' });
    } else {
      renderActive();
    }
    window.requestAnimationFrame(() => {
      const input = app.dialog.querySelector(`[data-f="${target}"]`);
      input?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      input?.focus({ preventScroll: true });
    });
  }

  /* ------------------------------------------------------------------ *
   * View: Guests
   * ------------------------------------------------------------------ */

  const GUEST_FILTERS = [
    ['all', 'All'],
    ['attending', 'Attending'],
    ['awaiting', 'Awaiting'],
    ['declined', 'Declined'],
    ['dietary', 'Dietary & access'],
    ['unseated', 'Unseated'],
  ];

  const guestPredicates = {
    all: () => true,
    attending: isAttending,
    declined: g => g.rsvpStatus === 'declined',
    awaiting: isAwaiting,
    dietary: hasNotes,
    unseated: g => isAttending(g) && !isSeated(g),
  };

  /** Guests matching the current filter, source, search and sort. */
  function filteredGuests() {
    const { guestFilter, guestSearch, guestSort, guestSource } = app.ui;
    const query = guestSearch.trim().toLowerCase();
    const list = app.guests
      .filter(guestPredicates[guestFilter] || guestPredicates.all)
      .filter(g =>
        guestSource === 'any'
          ? true
          : guestSource === 'form'
            ? g.source === 'public_rsvp'
            : g.source !== 'public_rsvp'
      )
      .filter(
        g =>
          !query ||
          [g.name, g.email, g.phone, g.householdName, g.plusOneName].some(value =>
            String(value || '')
              .toLowerCase()
              .includes(query)
          )
      );
    return list.sort((a, b) => {
      if (guestSort === 'name_asc') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (guestSort === 'status') {
        return String(a.rsvpStatus || 'pending').localeCompare(String(b.rsvpStatus || 'pending'));
      }
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  /** Table rows for one page of guests. */
  function guestRows(shown) {
    return shown
      .map(g => {
        const sub = [g.email || g.householdName, g.source === 'public_rsvp' ? 'via RSVP form' : '']
          .filter(Boolean)
          .join(' · ');
        const needs = [
          ...new Set(
            [g.mealChoice, g.dietaryRequirements || g.dietary, g.accessibilityRequirements].filter(
              Boolean
            )
          ),
        ]
          .map(text => `<span class="ww-tag">${esc(text)}</span>`)
          .join('');
        const table =
          app.tables.find(t => t.id === g.tableId)?.name || g.tableName || g.table || '';
        return `<tr>
          <td data-label="Guest"><div class="ww-person"><span class="ww-avatar">${esc(initials(g.name))}</span><div><strong>${esc(g.name)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div></td>
          <td data-label="RSVP">${badge(g.rsvpStatus)}</td>
          <td data-label="Party">${Number(g.partySize) || 1}</td>
          <td data-label="Requirements"><div class="ww-tags">${needs || '<span class="ww-muted">—</span>'}</div></td>
          <td data-label="Table">${table ? esc(table) : isAttending(g) ? '<span class="ww-muted">Unseated</span>' : '<span class="ww-muted">—</span>'}</td>
          <td class="ww-td-actions"><button type="button" class="ww-icon-btn" data-action="guest-edit" data-id="${esc(g.id)}" aria-label="Edit ${esc(g.name)}">${icon('edit', 16)}</button><button type="button" class="ww-icon-btn ww-icon-btn--danger" data-action="guest-delete" data-id="${esc(g.id)}" aria-label="Delete ${esc(g.name)}">${icon('trash', 16)}</button></td>
        </tr>`;
      })
      .join('');
  }

  /** The guest table with pager, or an empty state. */
  function guestResults() {
    const sorted = filteredGuests();
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, app.ui.guestPage), totalPages);
    app.ui.guestPage = page;
    const shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!app.guests.length) {
      return emptyState({
        iconName: 'guests',
        title: 'No guests yet',
        body: 'Add your guests one by one. Replies from your website will appear here too.',
        actions:
          '<button type="button" class="ww-btn ww-btn--primary" data-action="guest-add">Add your first guest</button>',
      });
    }
    if (!sorted.length) {
      return emptyState({
        iconName: 'search',
        title: 'No guests match',
        body: 'Try a different filter or search term.',
        actions:
          '<button type="button" class="ww-btn ww-btn--secondary" data-action="guest-reset">Clear filters</button>',
      });
    }
    return `<div class="ww-table-wrap"><table class="ww-table"><thead><tr><th>Guest</th><th>RSVP</th><th>Party</th><th>Requirements</th><th>Table</th><th><span class="ww-sr">Actions</span></th></tr></thead><tbody>${guestRows(shown)}</tbody></table></div>
      <div class="ww-pager"><span>${sorted.length === app.guests.length ? plural(sorted.length, 'guest') : `${sorted.length} of ${app.guests.length} guests`}</span><div><button type="button" class="ww-btn ww-btn--ghost" data-action="guest-page" data-dir="-1" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ww-pager__page">Page ${page} of ${totalPages}</span><button type="button" class="ww-btn ww-btn--ghost" data-action="guest-page" data-dir="1" ${page >= totalPages ? 'disabled' : ''}>Next</button></div></div>`;
  }

  /** Guests tab: summary, toolbar, filters and results. */
  function viewGuests() {
    if (!app.plan) {
      return needsWorkspace();
    }
    const st = stats();
    const pills = [
      ['Total', st.total],
      ['Attending', st.attending],
      ['Awaiting', st.awaiting],
      ['Declined', st.declined],
    ]
      .map(
        ([label, value]) =>
          `<div class="ww-mini-stat"><strong>${value}</strong><span>${label}</span></div>`
      )
      .join('');
    return `<div class="ww-stack">
      <div class="ww-card ww-ministats">${pills}</div>
      <section class="ww-card ww-flush">
        <div class="ww-toolbar">
          <label class="ww-search">${icon('search', 16)}<input type="search" data-ui="guestSearch" value="${esc(app.ui.guestSearch)}" placeholder="Search guests" aria-label="Search guests" autocomplete="off"></label>
          <select class="ww-input ww-select" data-ui="guestSort" aria-label="Sort guests"><option value="updated_desc" ${app.ui.guestSort === 'updated_desc' ? 'selected' : ''}>Recently updated</option><option value="name_asc" ${app.ui.guestSort === 'name_asc' ? 'selected' : ''}>Name A–Z</option><option value="status" ${app.ui.guestSort === 'status' ? 'selected' : ''}>RSVP status</option></select>
          <select class="ww-input ww-select" data-ui="guestSource" aria-label="Filter by source"><option value="any" ${app.ui.guestSource === 'any' ? 'selected' : ''}>All sources</option><option value="form" ${app.ui.guestSource === 'form' ? 'selected' : ''}>RSVP form</option><option value="manual" ${app.ui.guestSource === 'manual' ? 'selected' : ''}>Added by you</option></select>
          <a class="ww-btn ww-btn--secondary" href="${planPath(app.plan, '/guests/export.csv')}">${icon('download', 16)}Export</a>
          <button type="button" class="ww-btn ww-btn--primary" data-action="guest-add">${icon('plus', 16)}Add guest</button>
        </div>
        <div class="ww-filters" role="group" aria-label="Filter guests">${GUEST_FILTERS.map(
          ([key, label]) =>
            `<button type="button" class="ww-filter ${app.ui.guestFilter === key ? 'is-active' : ''}" data-action="guest-filter" data-f="${key}" aria-pressed="${app.ui.guestFilter === key}">${label}</button>`
        ).join('')}</div>
        <div id="ww-guest-results">${guestResults()}</div>
      </section>
    </div>`;
  }

  /** Redraws only the results and filter buttons so typing in the search box keeps focus. */
  function renderGuestResults() {
    const host = app.dialog.querySelector('#ww-guest-results');
    if (host) {
      host.innerHTML = guestResults();
    }
    app.dialog.querySelectorAll('[data-action="guest-filter"]').forEach(button => {
      const active = button.dataset.f === app.ui.guestFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  /** Add/edit guest dialog. Pass null to add a new guest. */
  function editGuest(guest) {
    const current = guest || {
      name: '',
      email: '',
      phone: '',
      rsvpStatus: 'pending',
      partySize: 1,
      plusOneName: '',
      childrenCount: 0,
      mealChoice: '',
      dietaryRequirements: '',
      accessibilityRequirements: '',
      songRequest: '',
      notes: '',
    };
    const text = (name, label, extra = '') =>
      `<label class="ww-field"><span class="ww-label">${label}</span><input class="ww-input" name="${name}" value="${esc(current[name] ?? '')}" ${extra}></label>`;
    const area = (name, label, value) =>
      `<label class="ww-field ww-field--wide"><span class="ww-label">${label}</span><textarea class="ww-input" name="${name}" rows="2">${esc(value ?? '')}</textarea></label>`;
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-modal';
    dialog.setAttribute('aria-labelledby', 'ww-guest-title');
    dialog.innerHTML = `<form class="ww-modal__form" novalidate>
      <div class="ww-modal__head"><h3 id="ww-guest-title" class="ww-modal__title">${guest ? 'Edit guest' : 'Add guest'}</h3><button type="button" class="ww-icon-btn" data-modal="cancel" aria-label="Close">${icon('close', 20)}</button></div>
      <div class="ww-modal__body">
        <div class="ww-grid">
          <label class="ww-field ww-field--wide"><span class="ww-label">Name<em>Required</em></span><input class="ww-input" name="name" value="${esc(current.name)}" required autocomplete="off"><small class="ww-error" hidden>Please enter a name.</small></label>
          ${text('email', 'Email', 'type="email"')}
          ${text('phone', 'Phone', 'type="tel"')}
          <label class="ww-field"><span class="ww-label">RSVP</span><select class="ww-input" name="rsvpStatus">${Object.entries(
            RSVP_LABELS
          )
            .map(
              ([value, label]) =>
                `<option value="${value}" ${(current.rsvpStatus || 'pending') === value ? 'selected' : ''}>${label}</option>`
            )
            .join('')}</select></label>
          <label class="ww-field"><span class="ww-label">Party size</span><input class="ww-input" name="partySize" type="number" min="1" max="20" value="${Number(current.partySize || 1)}"></label>
          <label class="ww-field"><span class="ww-label">Children</span><input class="ww-input" name="childrenCount" type="number" min="0" max="10" value="${Number(current.childrenCount || 0)}"></label>
          ${text('plusOneName', 'Plus one')}
          ${text('mealChoice', 'Meal choice')}
          ${area('dietaryRequirements', 'Dietary requirements', current.dietaryRequirements || current.dietary)}
          ${area('accessibilityRequirements', 'Accessibility needs', current.accessibilityRequirements)}
          ${text('songRequest', 'Song request')}
          ${area('notes', 'Notes', current.notes)}
        </div>
      </div>
      <div class="ww-modal__foot"><button type="button" class="ww-btn ww-btn--ghost" data-modal="cancel">Cancel</button><button type="submit" class="ww-btn ww-btn--primary">${guest ? 'Save guest' : 'Add guest'}</button></div>
    </form>`;
    const form = dialog.querySelector('form');
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-modal="cancel"]')) {
        dialog.close();
      }
    });
    form.elements.name.addEventListener('input', () => {
      form.querySelector('.ww-error').hidden = true;
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.name = String(payload.name || '').trim();
      if (!payload.name) {
        form.querySelector('.ww-error').hidden = false;
        form.elements.name.focus();
        return;
      }
      payload.partySize = Number(payload.partySize) || 1;
      payload.childrenCount = Number(payload.childrenCount) || 0;
      const submit = form.querySelector('[type="submit"]');
      setBusy(submit, true);
      try {
        await api(planPath(app.plan, `/guests${guest ? `/${encodeURIComponent(guest.id)}` : ''}`), {
          method: guest ? 'PATCH' : 'POST',
          body: payload,
        });
        dialog.close();
        toast(guest ? 'Guest updated' : 'Guest added');
        await reloadGuestsAndRender();
      } catch (err) {
        setBusy(submit, false);
        toast(err.message, 'warn');
      }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    openModal(dialog);
    form.elements.name.focus();
  }

  /** Deletes a guest after confirmation. */
  async function deleteGuest(id, button) {
    const guest = app.guests.find(g => String(g.id) === String(id));
    const ok = await confirmAction({
      title: `Delete ${guest?.name || 'this guest'}?`,
      message: 'This removes the guest and their RSVP details from your workspace.',
      confirmLabel: 'Delete guest',
      danger: true,
    });
    if (!ok) {
      return;
    }
    await guard(button, async () => {
      await api(planPath(app.plan, `/guests/${encodeURIComponent(id)}`), { method: 'DELETE' });
      toast('Guest deleted');
      await reloadGuestsAndRender();
    });
  }

  /* ------------------------------------------------------------------ *
   * View: Seating
   * ------------------------------------------------------------------ */

  /** Top-down diagram of a table with one dot per seat, filled for seated guests. */
  function tableSvg(table, used) {
    const cap = Math.max(1, Number(table.capacity) || 1);
    const type = table.type || 'round';
    const filled = Math.min(used, cap);
    const seats = [];
    let body = '';
    if (type === 'long' || type === 'top_table') {
      const sides = type === 'top_table' ? [cap] : [Math.ceil(cap / 2), Math.floor(cap / 2)];
      sides.forEach((count, sideIndex) => {
        const y = type === 'top_table' ? 82 : sideIndex === 0 ? 38 : 82;
        const spacing = Math.min(16, 130 / Math.max(count, 1));
        const start = 80 - (spacing * (count - 1)) / 2;
        for (let i = 0; i < count; i += 1) {
          seats.push({ x: start + spacing * i, y, r: Math.min(5, spacing * 0.36) });
        }
      });
      body = '<rect x="26" y="48" width="108" height="24" rx="6" class="ww-tbl"/>';
    } else {
      const radius = cap > 14 ? 46 : 41;
      const seatSize = cap > 20 ? 3.4 : cap > 14 ? 4 : 5;
      for (let i = 0; i < cap; i += 1) {
        const angle = (Math.PI * 2 * i) / cap - Math.PI / 2;
        seats.push({
          x: 80 + Math.cos(angle) * radius,
          y: 60 + Math.sin(angle) * radius,
          r: seatSize,
        });
      }
      body = '<circle cx="80" cy="60" r="27" class="ww-tbl"/>';
    }
    const dots = seats
      .map(
        (seat, i) =>
          `<circle cx="${seat.x.toFixed(1)}" cy="${seat.y.toFixed(1)}" r="${seat.r.toFixed(1)}" class="${i < filled ? 'ww-seat is-taken' : 'ww-seat'}"/>`
      )
      .join('');
    return `<svg class="ww-table-svg" viewBox="0 0 160 120" role="img" aria-label="${used} of ${cap} seats taken">${body}${dots}<text x="80" y="64" text-anchor="middle" class="ww-tbl-text">${used}/${cap}</text></svg>`;
  }

  /** Guests who currently exist and sit at this table (ignores ids of deleted guests). */
  function seatedAt(table) {
    const ids = new Set(table.guestIds || []);
    return app.guests.filter(g => ids.has(g.id));
  }

  /** Seats still free at a table. */
  const freeSeats = table => Math.max(0, Number(table.capacity || 0) - seatedAt(table).length);

  /** Seating tab: summary, guests needing a seat and the tables. */
  function viewSeating() {
    if (!app.plan) {
      return needsWorkspace();
    }
    const st = stats();
    const attending = app.guests.filter(isAttending);
    const unseated = attending.filter(g => !isSeated(g));
    const capacity = app.tables.reduce((sum, table) => sum + (Number(table.capacity) || 0), 0);
    const over = app.tables.filter(table => seatedAt(table).length > Number(table.capacity || 0));

    const toolbar = `<div class="ww-toolbar ww-toolbar--plain"><div class="ww-seatstats"><div><strong>${app.tables.length}</strong><span>Tables</span></div><div><strong>${capacity}</strong><span>Seats</span></div><div><strong>${st.seated}</strong><span>Seated</span></div><div class="${st.unseated ? 'is-alert' : ''}"><strong>${st.unseated}</strong><span>Unseated</span></div></div><div class="ww-toolbar__actions"><button type="button" class="ww-btn ww-btn--ghost" data-action="auto-seat" ${unseated.length && app.tables.length ? '' : 'disabled'}>${icon('wand', 16)}Auto-seat</button><button type="button" class="ww-btn ww-btn--ghost" data-action="clear-seating" ${st.seated ? '' : 'disabled'}>Clear seating</button><button type="button" class="ww-btn ww-btn--primary" data-action="table-add">${icon('plus', 16)}Add table</button></div></div>`;

    if (!app.tables.length && !attending.length) {
      return `<div class="ww-stack">${toolbar}<div class="ww-card">${emptyState({
        iconName: 'seating',
        title: 'Plan your seating',
        body: 'Add your tables now. Guests who reply "attending" will appear here ready to seat.',
        actions:
          '<button type="button" class="ww-btn ww-btn--primary" data-action="table-add">Add your first table</button>',
      })}</div></div>`;
    }

    const aside = `<aside class="ww-card ww-unseated" data-drop="unseat" aria-label="Guests needing a seat"><header class="ww-card__head"><h4>Needs a seat</h4><span class="ww-pill ${unseated.length ? 'ww-pill--warn' : ''}">${unseated.length}</span></header>${
      unseated.length
        ? `<ul class="ww-seatlist">${unseated
            .map(
              g =>
                `<li draggable="true" data-guest="${esc(g.id)}"><span class="ww-avatar">${esc(initials(g.name))}</span><span class="ww-seatlist__name"><strong>${esc(g.name)}</strong>${Number(g.partySize) > 1 ? `<small>Party of ${Number(g.partySize)}</small>` : ''}</span><select class="ww-input ww-select ww-select--sm" data-assign="${esc(g.id)}" aria-label="Seat ${esc(g.name)} at a table"><option value="">Seat at…</option>${app.tables
                  .map(
                    table =>
                      `<option value="${esc(table.id)}" ${freeSeats(table) ? '' : 'disabled'}>${esc(table.name)} (${freeSeats(table)} free)</option>`
                  )
                  .join('')}</select></li>`
            )
            .join('')}</ul>`
        : `<p class="ww-muted-note">${attending.length ? 'Everyone attending has a seat.' : 'Guests who RSVP “attending” will appear here.'}</p>`
    }<p class="ww-hint">${icon('info', 14)} Drag a guest onto a table, or use the menu.</p></aside>`;

    const grid = app.tables.length
      ? `<div class="ww-tables">${app.tables
          .map(table => {
            const guests = seatedAt(table);
            const full = guests.length > Number(table.capacity || 0);
            return `<article class="ww-card ww-tablecard ${full ? 'is-over' : ''}" data-drop="table" data-table="${esc(table.id)}"><header class="ww-tablecard__head"><div><h4 title="${esc(table.name)}">${esc(table.name)}</h4><small>${esc(TABLE_TYPES[table.type] || 'Table')} · ${guests.length}/${Number(table.capacity) || 0}</small></div><div><button type="button" class="ww-icon-btn" data-action="table-edit" data-id="${esc(table.id)}" aria-label="Edit ${esc(table.name)}">${icon('edit', 16)}</button><button type="button" class="ww-icon-btn ww-icon-btn--danger" data-action="table-delete" data-id="${esc(table.id)}" aria-label="Delete ${esc(table.name)}">${icon('trash', 16)}</button></div></header>${tableSvg(table, guests.length)}${full ? '<p class="ww-warn-text">Over capacity. Move a guest or add seats.</p>' : ''}<ul class="ww-chips">${
              guests.length
                ? guests
                    .map(
                      g =>
                        `<li draggable="true" data-guest="${esc(g.id)}"><button type="button" class="ww-chips__name" data-action="seat-move" data-id="${esc(g.id)}" aria-label="Move ${esc(g.name)} to another table">${esc(g.name)}</button><button type="button" data-action="seat-unassign" data-id="${esc(g.id)}" aria-label="Unseat ${esc(g.name)}">${icon('close', 12)}</button></li>`
                    )
                    .join('')
                : '<li class="ww-chips__empty">Drop guests here</li>'
            }</ul></article>`;
          })
          .join('')}</div>`
      : `<div class="ww-card">${emptyState({
          iconName: 'seating',
          title: 'No tables yet',
          body: 'Add a table to start seating your guests.',
          actions:
            '<button type="button" class="ww-btn ww-btn--primary" data-action="table-add">Add table</button>',
        })}</div>`;

    return `<div class="ww-stack">${toolbar}${over.length ? `<div class="ww-banner ww-banner--warn">${icon('info', 18)}<div><strong>${plural(over.length, 'table')} over capacity</strong><span>Move a guest or increase seats.</span></div></div>` : ''}<div class="ww-seating">${aside}${grid}</div></div>`;
  }

  /** Add/edit table dialog. Resolves with the form values, or null if cancelled. */
  function editTable(table) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ww-modal ww-modal--narrow';
      dialog.setAttribute('aria-labelledby', 'ww-table-title');
      dialog.innerHTML = `<form class="ww-modal__form" novalidate>
        <div class="ww-modal__head"><h3 id="ww-table-title" class="ww-modal__title">${table.id ? 'Edit table' : 'Add table'}</h3><button type="button" class="ww-icon-btn" data-modal="cancel" aria-label="Close">${icon('close', 20)}</button></div>
        <div class="ww-modal__body"><div class="ww-grid">
          <label class="ww-field ww-field--wide"><span class="ww-label">Name</span><input class="ww-input" name="name" value="${esc(table.name || '')}" required></label>
          <label class="ww-field"><span class="ww-label">Shape</span><select class="ww-input" name="type">${Object.entries(
            TABLE_TYPES
          )
            .map(
              ([value, label]) =>
                `<option value="${value}" ${(table.type || 'round') === value ? 'selected' : ''}>${label}</option>`
            )
            .join('')}</select></label>
          <label class="ww-field"><span class="ww-label">Seats</span><input class="ww-input" name="capacity" type="number" min="1" max="30" value="${Number(table.capacity || 10)}"></label>
          <label class="ww-field ww-field--wide"><span class="ww-label">Notes</span><textarea class="ww-input" name="notes" rows="2">${esc(table.notes || '')}</textarea></label>
        </div></div>
        <div class="ww-modal__foot"><button type="button" class="ww-btn ww-btn--ghost" data-modal="cancel">Cancel</button><button type="submit" class="ww-btn ww-btn--primary">Save table</button></div>
      </form>`;
      let result = null;
      dialog.addEventListener('click', event => {
        if (event.target.closest('[data-modal="cancel"]')) {
          dialog.close();
        }
      });
      dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
        payload.name = String(payload.name || '').trim() || table.name || 'Table';
        payload.capacity = Math.max(1, Math.min(30, Number(payload.capacity) || 10));
        result = payload;
        dialog.close();
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        resolve(result);
      });
      openModal(dialog);
      dialog.querySelector('[name="name"]').focus();
    });
  }

  /** Dialog to move a seated guest to another table (no dragging needed), or to unseat them. */
  function moveGuestDialog(guest) {
    const here = app.tables.find(table => seatedAt(table).some(g => g.id === guest.id));
    const options = app.tables
      .filter(table => table !== here)
      .map(
        table =>
          `<option value="${esc(table.id)}" ${freeSeats(table) ? '' : 'disabled'}>${esc(table.name)} (${freeSeats(table)} free)</option>`
      )
      .join('');
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-modal ww-modal--narrow';
    dialog.setAttribute('aria-labelledby', 'ww-move-title');
    dialog.innerHTML = `<form class="ww-modal__form" novalidate>
      <div class="ww-modal__head"><h3 id="ww-move-title" class="ww-modal__title">Move ${esc(guest.name)}</h3><button type="button" class="ww-icon-btn" data-modal="cancel" aria-label="Close">${icon('close', 20)}</button></div>
      <div class="ww-modal__body"><label class="ww-field"><span class="ww-label">Now at ${esc(here?.name || 'no table')}. Move to</span><select class="ww-input" name="table"><option value="">Nowhere (unseat)</option>${options}</select></label></div>
      <div class="ww-modal__foot"><button type="button" class="ww-btn ww-btn--ghost" data-modal="cancel">Cancel</button><button type="submit" class="ww-btn ww-btn--primary">Move</button></div>
    </form>`;
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-modal="cancel"]')) {
        dialog.close();
      }
    });
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const target = event.currentTarget.elements.table.value;
      const submit = event.currentTarget.querySelector('[type="submit"]');
      setBusy(submit, true);
      try {
        await (target ? assignGuest(guest.id, target) : unassignGuest(guest.id));
        dialog.close();
        await reloadGuestsAndRender();
      } catch (err) {
        setBusy(submit, false);
        toast(err.message, 'warn');
      }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    openModal(dialog);
    dialog.querySelector('select').focus();
  }

  /** Seats a guest at a table (moving them if they were already seated). */
  async function assignGuest(guestId, tableId) {
    await api(planPath(app.plan, `/tables/${encodeURIComponent(tableId)}/assign-guest`), {
      method: 'POST',
      body: { guestId },
    });
  }

  /** Removes a guest from their table. */
  async function unassignGuest(guestId) {
    await api(planPath(app.plan, '/tables/unassign-guest'), { method: 'POST', body: { guestId } });
  }

  /** Seats unseated guests into free seats table by table, keeping households together. */
  async function autoSeat(button) {
    const unseated = app.guests
      .filter(g => isAttending(g) && !isSeated(g))
      .sort(
        (a, b) =>
          String(a.householdName || '~').localeCompare(String(b.householdName || '~')) ||
          String(a.name || '').localeCompare(String(b.name || ''))
      );
    const slots = app.tables.flatMap(table => Array(freeSeats(table)).fill(table.id));
    if (!unseated.length) {
      toast('Everyone attending already has a seat');
      return;
    }
    if (!slots.length) {
      toast('Add more table capacity first', 'warn');
      return;
    }
    await guard(button, async () => {
      const count = Math.min(unseated.length, slots.length);
      // One request for the whole plan: seating guests one at a time hits the write limit.
      const assignments = unseated
        .slice(0, count)
        .map((guest, i) => ({ guestId: guest.id, tableId: slots[i] }));
      await api(planPath(app.plan, '/tables/seat-guests'), {
        method: 'POST',
        body: { assignments },
      });
      toast(
        count < unseated.length
          ? `Seated ${count}. ${unseated.length - count} more need seats.`
          : `Seated ${plural(count, 'guest')}`
      );
      await reloadGuestsAndRender();
    });
  }

  /** Unseats every guest after confirmation. */
  async function clearSeating(button) {
    const ok = await confirmAction({
      title: 'Clear all seating?',
      message: 'Every guest will be unseated. Your tables and guest list stay as they are.',
      confirmLabel: 'Clear seating',
      danger: true,
    });
    if (!ok) {
      return;
    }
    await guard(button, async () => {
      await api(planPath(app.plan, '/tables/clear-seating'), { method: 'POST', body: {} });
      toast('Seating cleared');
      await reloadGuestsAndRender();
    });
  }

  /* ------------------------------------------------------------------ *
   * View: Share
   * ------------------------------------------------------------------ */

  const VISIBILITY = [
    {
      value: 'private_link',
      icon: 'link',
      title: 'Anyone with the link',
      text: 'Unlisted. Only people you send the link to will find it.',
    },
    {
      value: 'password',
      icon: 'key',
      title: 'Password protected',
      text: 'Guests enter a password before they can see details or RSVP.',
    },
    {
      value: 'public',
      icon: 'globe',
      title: 'Public',
      text: 'Open to anyone who visits the link.',
    },
  ];

  /** Ready-made message that carries the guest link. */
  const inviteMessage = url => `We would love you to RSVP on our wedding website: ${url}`;

  /** Publish state, guest link and copy/preview buttons. */
  function shareLiveCard(site) {
    const live = site.status === 'published';
    const url = publicUrl(site);
    return `<section class="ww-card ww-live ${live ? 'is-live' : ''}">
        <div class="ww-live__head"><span class="ww-dot ${live ? 'is-live' : ''}"></span><div><h4>${live ? 'Your website is live' : 'Your website is a draft'}</h4><p>${live ? 'Guests can open your link and send RSVPs.' : 'Publish when you are ready. Guests cannot see it until then.'}</p></div><button type="button" class="ww-btn ${live ? 'ww-btn--secondary' : 'ww-btn--primary'}" data-action="${live ? 'unpublish' : 'publish'}">${live ? 'Unpublish' : 'Publish website'}</button></div>
        <div class="ww-copybox"><span class="ww-copybox__icon">${icon('link', 16)}</span><input readonly value="${esc(url)}" aria-label="Guest website link"><button type="button" class="ww-btn ww-btn--secondary" data-action="copy-link">${icon('copy', 16)}Copy</button>${live || previewUrl() ? `<a class="ww-btn ww-btn--ghost" href="${esc(live ? url : previewUrl())}" target="_blank" rel="noopener">${icon('external', 16)}${live ? 'Open' : 'Preview'}</a>` : ''}</div>
      </section>`;
  }

  /** Website link, privacy choice and password settings. */
  function sharePrivacyCard(site) {
    const visibility = app.ui.visibility || site.visibility || 'private_link';
    const slug = app.ui.slug ?? site.slug ?? '';
    const password = app.ui.password || '';
    return `<section class="ww-card">
          <header class="ww-card__head"><h4>Link &amp; privacy</h4></header>
          <label class="ww-field"><span class="ww-label">Website link</span><span class="ww-slug"><span class="ww-slug__prefix">/wedding/</span><input class="ww-input" data-ui-slug value="${esc(slug)}" placeholder="our-wedding" autocomplete="off" spellcheck="false" aria-label="Custom website link"></span><small class="ww-hint">Letters, numbers and dashes. Choose something personal.</small></label>
          <button type="button" class="ww-link ww-link--inline" data-action="regen-slug">${icon('refresh', 14)}Suggest a new link</button>
          <fieldset class="ww-radios"><legend class="ww-label">Who can view it</legend>${VISIBILITY.map(
            option =>
              `<label class="ww-radio ${visibility === option.value ? 'is-selected' : ''}"><input type="radio" name="ww-visibility" value="${option.value}" ${visibility === option.value ? 'checked' : ''}><span class="ww-radio__icon">${icon(option.icon, 18)}</span><span class="ww-radio__text"><strong>${esc(option.title)}</strong><small>${esc(option.text)}</small></span></label>`
          ).join('')}</fieldset>
          <label class="ww-field" ${visibility === 'password' ? '' : 'hidden'} data-password-field><span class="ww-label">Website password</span><input class="ww-input" type="password" data-ui-password value="${esc(password)}" minlength="6" autocomplete="new-password" placeholder="${site.passwordSet ? 'Leave blank to keep your current password' : 'At least 6 characters'}"><small class="ww-hint">Saved passwords are never shown again. Share it with guests separately.</small></label>
          <p class="ww-error" data-share-error hidden></p>
          <div class="ww-actions-row"><button type="button" class="ww-btn ww-btn--primary" data-action="save-share">Save link settings</button></div>
        </section>`;
  }

  /** QR code and WhatsApp, email and copy-message shortcuts. */
  function shareInviteCard(site) {
    const live = site.status === 'published';
    const url = publicUrl(site);
    const qr = url ? `/api/tools/qr.png?url=${encodeURIComponent(url)}` : '';
    const message = inviteMessage(url);
    return `<section class="ww-card">
          <header class="ww-card__head"><h4>Invite guests</h4></header>
          ${
            live && qr
              ? `<div class="ww-qr"><img src="${esc(qr)}" width="148" height="148" alt="QR code linking to your wedding website"><div><p><strong>Scan to RSVP</strong></p><p class="ww-hint">Add it to invitations, save-the-dates or table signs.</p><a class="ww-btn ww-btn--secondary" href="${esc(qr)}" download="wedding-website-qr.png">${icon('download', 16)}Download QR</a></div></div>`
              : `<p class="ww-muted-note">${icon('info', 14)} Publish your website to get a QR code and share links.</p>`
          }
          <div class="ww-share-actions">
            <a class="ww-btn ww-btn--secondary ${live ? '' : 'is-disabled'}" ${live ? `href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>${icon('chat', 16)}WhatsApp</a>
            <a class="ww-btn ww-btn--secondary ${live ? '' : 'is-disabled'}" ${live ? `href="mailto:?subject=${encodeURIComponent('Our wedding website')}&body=${encodeURIComponent(message)}"` : 'aria-disabled="true"'}>${icon('mail', 16)}Email</a>
            <button type="button" class="ww-btn ww-btn--secondary" data-action="copy-message" ${live ? '' : 'disabled'}>${icon('copy', 16)}Copy message</button>
          </div>
          <div class="ww-tips"><h5>Before you send</h5><ul><li>Check your RSVP deadline and meal options.</li><li>Open the link in a private window to see what guests see.</li><li>Ask one trusted guest to test the RSVP form.</li></ul></div>
        </section>`;
  }

  /** Share tab. */
  function viewShare() {
    if (!app.plan) {
      return needsWorkspace();
    }
    if (!app.site) {
      return `<div class="ww-card">${emptyState({
        iconName: 'share',
        title: 'Create your website first',
        body: 'Once your website exists you can set its link, privacy and share it with guests.',
        actions:
          '<button type="button" class="ww-btn ww-btn--primary" data-go="website">Go to website</button>',
      })}</div>`;
    }
    return `<div class="ww-stack">
      ${shareLiveCard(app.site)}
      <div class="ww-columns">
        ${sharePrivacyCard(app.site)}
        ${shareInviteCard(app.site)}
      </div>
    </div>`;
  }

  /** Saves the website link, privacy and password. */
  async function saveShareSettings(button) {
    const dialog = app.dialog;
    const errorEl = dialog.querySelector('[data-share-error]');
    errorEl.hidden = true;
    const slug = normalizeSlug(dialog.querySelector('[data-ui-slug]').value);
    const visibility =
      dialog.querySelector('input[name="ww-visibility"]:checked')?.value || 'private_link';
    const password = dialog.querySelector('[data-ui-password]').value;
    if (!slug) {
      errorEl.textContent = 'Please enter a website link.';
      errorEl.hidden = false;
      return;
    }
    if (visibility === 'password' && !password && !app.site.passwordSet) {
      errorEl.textContent = 'Please set a password before enabling password protection.';
      errorEl.hidden = false;
      return;
    }
    if (password && password.length < 6) {
      errorEl.textContent = 'Passwords need at least 6 characters.';
      errorEl.hidden = false;
      return;
    }
    await guard(button, async () => {
      try {
        const body = { slug, visibility };
        if (password) {
          body.password = password;
        }
        await api(planPath(app.plan, '/wedding-website'), { method: 'PATCH', body });
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        return;
      }
      app.site = await getWebsite(app.plan);
      app.ui.slug = undefined;
      app.ui.visibility = undefined;
      app.ui.password = undefined;
      toast('Link settings saved');
      renderActive();
    });
  }

  /** Shows the text in a selectable box when the browser blocks clipboard access. */
  function showCopyFallback(text) {
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-modal ww-modal--narrow';
    dialog.setAttribute('aria-labelledby', 'ww-copy-title');
    dialog.innerHTML = `<div class="ww-modal__body"><h3 id="ww-copy-title" class="ww-modal__title">Copy this text</h3><p class="ww-modal__text">Your browser did not allow automatic copying. Select the text below and copy it.</p><textarea class="ww-input" rows="3" readonly aria-label="Text to copy">${esc(text)}</textarea></div><div class="ww-modal__foot"><button type="button" class="ww-btn ww-btn--primary" data-modal="cancel">Done</button></div>`;
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-modal="cancel"]')) {
        dialog.close();
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    openModal(dialog);
    const field = dialog.querySelector('textarea');
    field.focus();
    field.select();
  }

  /** Copies text to the clipboard, or shows it for manual copying if the browser refuses. */
  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      showCopyFallback(text);
    }
  }

  /* ------------------------------------------------------------------ *
   * Event handling
   * ------------------------------------------------------------------ */

  /** Keeps the draft in step with what is typed, and records which part changed. */
  function onInput(event) {
    const el = event.target;
    if (el.matches('[data-f]')) {
      app.draft[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      setDirty(true, 'site');
      refreshEditorMeta();
      return;
    }
    if (el.matches('[data-list]')) {
      const { list, i, k } = el.dataset;
      app.draft.lists[list][Number(i)][k] = el.value;
      setDirty(true, 'site');
      if (list === 'customRsvpQuestions' && k === 'type') {
        // Choosing "Pick one" reveals a field, so redraw and keep focus on the select.
        renderActive();
        app.dialog.querySelector(`[data-list="${list}"][data-i="${i}"][data-k="${k}"]`)?.focus();
      }
      refreshEditorMeta();
      return;
    }
    if (el.matches('[data-theme]')) {
      if (el.type === 'radio' && !el.checked) {
        return;
      }
      app.draft.theme[el.dataset.theme] = el.value;
      const chip = el.parentElement.querySelector('.ww-swatch__chip');
      if (chip) {
        chip.style.background = el.value;
      }
      setDirty(true, 'theme');
      refreshEditorMeta();
      return;
    }
    if (el.matches('[data-gallery-caption]')) {
      const item = app.draft.theme.galleryImages[Number(el.dataset.galleryCaption)];
      if (item) {
        item.caption = el.value;
        setDirty(true, 'theme');
      }
      return;
    }
    if (el.matches('[data-ui="guestSearch"]')) {
      app.ui.guestSearch = el.value;
      app.ui.guestPage = 1;
      renderGuestResults();
      return;
    }
    if (el.matches('[data-ui-slug]')) {
      app.ui.slug = el.value;
      return;
    }
    if (el.matches('[data-ui-password]')) {
      app.ui.password = el.value;
    }
  }

  /** Handles selects, radios and file pickers. */
  function onChange(event) {
    const el = event.target;
    if (el.matches('[data-ui]') && el.dataset.ui !== 'guestSearch') {
      app.ui[el.dataset.ui] = el.value;
      app.ui.guestPage = 1;
      renderGuestResults();
      return;
    }
    if (el.matches('[data-assign]') && el.value) {
      guard(el, async () => {
        await assignGuest(el.dataset.assign, el.value);
        await reloadGuestsAndRender();
      });
      return;
    }
    if (el.matches('input[name="ww-visibility"]')) {
      app.ui.visibility = el.value;
      app.dialog.querySelectorAll('.ww-radio').forEach(label => {
        label.classList.toggle('is-selected', label.contains(el));
      });
      const field = app.dialog.querySelector('[data-password-field]');
      if (field) {
        field.hidden = el.value !== 'password';
      }
      return;
    }
    if (el.matches('[data-upload]')) {
      handleUpload(el);
    }
  }

  /**
   * Adds chosen photos to the draft, keeping those that worked and reporting those that did
   * not.
   */
  async function handleUpload(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    const theme = app.draft.theme;
    let failure = '';
    let added = 0;
    if (input.dataset.upload === 'cover') {
      try {
        theme.coverImageUrl = await readImage(files[0]);
        added = 1;
      } catch (err) {
        failure = err.message;
      }
    } else {
      const room = MAX_GALLERY - theme.galleryImages.length;
      if (files.length > room) {
        failure = `Only ${plural(room, 'more photo')} fit in the gallery.`;
      }
      for (const file of files.slice(0, room)) {
        try {
          theme.galleryImages.push({
            id: uid('gallery'),
            imageUrl: await readImage(file),
            caption: '',
            alt: '',
          });
          added += 1;
        } catch (err) {
          failure = err.message;
        }
      }
    }
    if (added) {
      setDirty(true, 'theme');
      renderActive();
    }
    if (failure) {
      toast(failure, 'warn');
    } else if (added) {
      toast('Photos ready. Save to add them to your website.');
    }
  }

  /** Single click handler for the app: tab/shortcut buttons and data-action buttons. */
  async function onClick(event) {
    if (app.dirty && event.target.closest('[data-preview]')) {
      // The preview page shows the saved version, so let the customer know edits are not in it.
      toast('Preview shows your last saved version. Save to include your latest edits.');
    }
    const goEl = event.target.closest('[data-go]');
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      await runAction(actionEl, event);
      return;
    }
    if (goEl) {
      goTo(goEl.dataset.go, {
        section: goEl.dataset.sectionTarget,
        filter: goEl.dataset.filterTarget,
        add: Boolean(goEl.dataset.addTarget),
      });
    }
  }

  /** Marks the website editor as changed and redraws it. */
  function editorChanged(part) {
    setDirty(true, part);
    renderActive();
  }

  /** Repeating rows (FAQs, places to stay…), the colour theme and the photo gallery. */
  const EDITOR_ACTIONS = {
    'toggle-section': el => {
      app.ui.openSection = app.ui.openSection === el.dataset.id ? '' : el.dataset.id;
      renderActive();
    },
    'focus-field': el => focusField(el.dataset.key),
    'add-item': el => {
      const { list } = el.dataset;
      const rows = app.draft.lists[list];
      const item = { id: uid(list) };
      LISTS[list].fields.forEach(field => {
        item[field.key] = LISTS[list].defaults?.[field.key] ?? '';
      });
      rows.push(item);
      editorChanged('site');
      window.requestAnimationFrame(() => {
        app.dialog.querySelector(`[data-list="${list}"][data-i="${rows.length - 1}"]`)?.focus();
      });
    },
    'remove-item': el => {
      app.draft.lists[el.dataset.list].splice(Number(el.dataset.i), 1);
      editorChanged('site');
    },
    palette: el => {
      const palette = PALETTES[Number(el.dataset.i)];
      Object.assign(app.draft.theme, {
        accentColor: palette.accent,
        secondaryColor: palette.secondary,
        backgroundColor: palette.background,
        textColor: palette.text,
      });
      editorChanged('theme');
    },
    'cover-remove': () => {
      app.draft.theme.coverImageUrl = '';
      editorChanged('theme');
    },
    'gallery-remove': el => {
      app.draft.theme.galleryImages.splice(Number(el.dataset.i), 1);
      editorChanged('theme');
    },
    'gallery-move': el => {
      const list = app.draft.theme.galleryImages;
      const from = Number(el.dataset.i);
      const to = from + Number(el.dataset.dir);
      if (to >= 0 && to < list.length) {
        list.splice(to, 0, list.splice(from, 1)[0]);
        editorChanged('theme');
      }
    },
    save: el => guard(el, () => saveWebsite()),
    publish: el => publish(el),
    unpublish: el => unpublishWebsite(el),
    'create-site': el =>
      guard(el, async () => {
        await api(planPath(app.plan, '/wedding-website'), { method: 'POST', body: {} });
        app.site = await getWebsite(app.plan);
        app.draft = makeDraft(app.site, app.plan);
        setHeaderStatus(statusMeta(app.site, app.plan));
        toast('Website draft created');
        renderActive();
      }),
  };

  /** Starting out: new workspace, or attach the website to an existing plan. */
  const SETUP_ACTIONS = {
    'quick-start': el =>
      guard(el, async () => {
        const res = await api('/api/me/plans/wedding-workspace', { method: 'POST' });
        await adoptPlan(res.plan);
        toast('Wedding workspace created');
      }),
    'use-existing': el => {
      const chosen = app.dialog.querySelector('#ww-existing-plan')?.value;
      const plan = cachedPlans.find(item => String(item.id) === String(chosen));
      if (!plan) {
        toast('Choose a plan first', 'warn');
        return undefined;
      }
      return guard(el, () => adoptPlan(plan));
    },
    'retry-load': () => loadWorkspace(),
  };

  /** Link, privacy and the share buttons. */
  const SHARE_ACTIONS = {
    'copy-link': () => copyText(publicUrl(app.site), 'Link copied'),
    'copy-message': () => copyText(inviteMessage(publicUrl(app.site)), 'Message copied'),
    'save-share': el => saveShareSettings(el),
    'regen-slug': el =>
      guard(el, async () => {
        // Preview only: the live link is not changed until the customer saves it.
        const res = await api(planPath(app.plan, '/wedding-website/regenerate-slug'), {
          method: 'POST',
          body: { preview: true },
        });
        app.ui.slug = res.slug;
        toast('New link suggested. Save link settings to use it.');
        renderActive();
      }),
  };

  /** The guest list: add, edit, delete, filter and page. */
  const GUEST_ACTIONS = {
    'guest-add': () => editGuest(null),
    'guest-edit': el => {
      const guest = app.guests.find(g => String(g.id) === String(el.dataset.id));
      if (guest) {
        editGuest(guest);
      }
    },
    'guest-delete': el => deleteGuest(el.dataset.id, el),
    'guest-filter': el => {
      app.ui.guestFilter = el.dataset.f;
      app.ui.guestPage = 1;
      renderGuestResults();
    },
    'guest-page': el => {
      app.ui.guestPage += Number(el.dataset.dir);
      renderGuestResults();
      app.dialog
        .querySelector('.ww-filters')
        ?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
    },
    'guest-reset': () => {
      Object.assign(app.ui, {
        guestFilter: 'all',
        guestSearch: '',
        guestSource: 'any',
        guestPage: 1,
      });
      renderActive();
    },
  };

  /** Tables and seating. */
  const SEATING_ACTIONS = {
    'table-add': async el => {
      const payload = await editTable({
        name: `Table ${app.tables.length + 1}`,
        capacity: 10,
        type: 'round',
      });
      if (payload) {
        await guard(el, async () => {
          await api(planPath(app.plan, '/tables'), { method: 'POST', body: payload });
          toast('Table added');
          await reloadGuestsAndRender();
        });
      }
    },
    'table-edit': async el => {
      const table = app.tables.find(item => String(item.id) === String(el.dataset.id));
      const payload = table && (await editTable(table));
      if (payload) {
        await guard(el, async () => {
          await api(planPath(app.plan, `/tables/${encodeURIComponent(table.id)}`), {
            method: 'PATCH',
            body: payload,
          });
          await reloadGuestsAndRender();
        });
      }
    },
    'table-delete': async el => {
      const table = app.tables.find(item => String(item.id) === String(el.dataset.id));
      const ok = await confirmAction({
        title: `Delete ${table?.name || 'table'}?`,
        message:
          'Guests at this table become unseated. Their RSVP details stay in your guest list.',
        confirmLabel: 'Delete table',
        danger: true,
      });
      if (ok) {
        await guard(el, async () => {
          await api(planPath(app.plan, `/tables/${encodeURIComponent(el.dataset.id)}`), {
            method: 'DELETE',
          });
          await reloadGuestsAndRender();
        });
      }
    },
    'seat-unassign': (el, event) => {
      event.preventDefault();
      return guard(el, async () => {
        await unassignGuest(el.dataset.id);
        await reloadGuestsAndRender();
      });
    },
    'seat-move': el => {
      const guest = app.guests.find(g => String(g.id) === String(el.dataset.id));
      if (guest) {
        moveGuestDialog(guest);
      }
    },
    'auto-seat': el => autoSeat(el),
    'clear-seating': el => clearSeating(el),
  };

  /** Every click handler, keyed by the `data-action` attribute of the clicked element. */
  const ACTIONS = {
    close: () => app.dialog.dispatchEvent(new Event('cancel', { cancelable: true })),
    ...EDITOR_ACTIONS,
    ...SETUP_ACTIONS,
    ...SHARE_ACTIONS,
    ...GUEST_ACTIONS,
    ...SEATING_ACTIONS,
  };

  /** Runs the handler registered for a data-action. */
  async function runAction(el, event) {
    await ACTIONS[el.dataset.action]?.(el, event);
  }

  /** Starts working on a plan (new or existing), creating its website if needed. */
  async function adoptPlan(plan) {
    app.plan = plan;
    app.site = await ensureWebsite(plan);
    app.draft = app.site ? makeDraft(app.site, plan) : null;
    await loadGuestsAndTables();
    setHeaderStatus(statusMeta(app.site, app.plan));
    goTo(app.site ? 'overview' : 'website');
  }

  /* Drag and drop for seating (mouse); menus cover keyboard and touch. */

  /** Starts dragging a guest between the unseated list and tables. */
  function onDragStart(event) {
    const item = event.target.closest('[data-guest]');
    if (!item) {
      return;
    }
    event.dataTransfer.setData('text/plain', item.dataset.guest);
    event.dataTransfer.effectAllowed = 'move';
    item.classList.add('is-dragging');
  }

  /** Clears drag highlighting. */
  function onDragEnd(event) {
    event.target.closest?.('[data-guest]')?.classList.remove('is-dragging');
    app.dialog
      .querySelectorAll('.is-drop-target')
      .forEach(el => el.classList.remove('is-drop-target'));
  }

  /** Highlights a table or the unseated list as a valid drop target. */
  function onDragOver(event) {
    const zone = event.target.closest('[data-drop]');
    if (zone) {
      event.preventDefault();
      zone.classList.add('is-drop-target');
    }
  }

  /** Removes drop highlighting when the pointer leaves a target. */
  function onDragLeave(event) {
    const zone = event.target.closest('[data-drop]');
    if (zone && !zone.contains(event.relatedTarget)) {
      zone.classList.remove('is-drop-target');
    }
  }

  /** Seats the dragged guest at the table, or unseats them when dropped on the list. */
  async function onDrop(event) {
    const zone = event.target.closest('[data-drop]');
    const guestId = event.dataTransfer.getData('text/plain');
    if (!zone || !guestId) {
      return;
    }
    event.preventDefault();
    zone.classList.remove('is-drop-target');
    try {
      if (zone.dataset.drop === 'table') {
        await assignGuest(guestId, zone.dataset.table);
      } else if (isSeated(app.guests.find(g => String(g.id) === String(guestId)) || {})) {
        await unassignGuest(guestId);
      }
      await reloadGuestsAndRender();
    } catch (err) {
      toast(err.message, 'warn');
    }
  }

  /** Arrow/Home/End navigation between tabs, and Ctrl/Cmd+S to save the editor. */
  function onKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      const saveButton = app.dialog.querySelector('#ww-save');
      if (saveButton && !event.target.closest('.ww-modal')) {
        event.preventDefault();
        if (app.dirty) {
          saveButton.click();
        }
      }
      return;
    }
    const tab = event.target.closest('.ww-nav__item');
    if (!tab) {
      return;
    }
    const tabs = Array.from(app.dialog.querySelectorAll('.ww-nav__item'));
    const index = tabs.indexOf(tab);
    const next = {
      ArrowDown: (index + 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      ArrowUp: (index - 1 + tabs.length) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    tabs[next].focus();
    goTo(tabs[next].dataset.go);
  }

  /* ------------------------------------------------------------------ *
   * Open / close
   * ------------------------------------------------------------------ */

  /** Loads the website, guests and tables for the open app, with a retry on failure. */
  async function loadWorkspace() {
    const state = app;
    state.loading = true;
    state.loadError = '';
    renderActive();
    try {
      if (state.plan) {
        const site = await getWebsite(state.plan);
        state.site = site;
        state.draft = site ? makeDraft(site, state.plan) : null;
        await loadGuestsAndTables();
      }
    } catch (err) {
      state.loadError = err.message || 'Please check your connection and try again.';
    }
    if (app !== state) {
      return;
    }
    state.loading = false;
    renderActive();
  }

  /** True when closing now would lose edits the customer has not saved. */
  const hasUnsavedChanges = () => app.dirty || shareDirty();

  /** Wires every event handler onto the app dialog. */
  function bindAppEvents(dialog) {
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('input', onInput);
    dialog.addEventListener('change', onChange);
    dialog.addEventListener('keydown', onKeydown);
    dialog.addEventListener('dragstart', onDragStart);
    dialog.addEventListener('dragend', onDragEnd);
    dialog.addEventListener('dragover', onDragOver);
    dialog.addEventListener('dragleave', onDragLeave);
    dialog.addEventListener('drop', onDrop);
    dialog.addEventListener('submit', event => event.preventDefault());
    dialog.addEventListener('cancel', async event => {
      event.preventDefault();
      if (hasUnsavedChanges()) {
        const ok = await confirmAction({
          title: 'Discard unsaved changes?',
          message: 'You have changes that have not been saved.',
          confirmLabel: 'Discard changes',
          danger: true,
        });
        if (!ok) {
          return;
        }
      }
      dialog.close();
    });
    // Only a press that starts on the backdrop closes the app, so dragging a text selection out
    // of a field and releasing outside the window does not.
    let pressedBackdrop = false;
    dialog.addEventListener('mousedown', event => {
      pressedBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog && pressedBackdrop) {
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      }
    });
    // A QR image that fails to load is replaced with a message instead of a broken icon.
    dialog.addEventListener(
      'error',
      event => {
        const wrapper = event.target.closest?.('.ww-qr');
        if (wrapper) {
          wrapper.innerHTML = `<p class="ww-muted-note">${icon('info', 14)} The QR code could not be loaded right now. Please try again later.</p>`;
        }
      },
      true
    );
    dialog.addEventListener('close', closeApp, { once: true });
  }

  let opening = false;

  /** Opens the app from the dashboard card and loads the customer's workspace. */
  async function openApp(opener) {
    if (app || opening) {
      return;
    }
    if (!initialised) {
      opening = true;
      try {
        cachedPlans = await fetchPlans(cachedPlans);
      } finally {
        opening = false;
      }
    }
    const plan = pickPlan(cachedPlans);
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-app';
    dialog.setAttribute('aria-labelledby', 'ww-app-title');
    dialog.innerHTML = shellHtml();
    app = {
      dialog,
      opener,
      plan,
      site: null,
      draft: null,
      dirty: false,
      touched: { site: false, theme: false },
      guests: [],
      tables: [],
      tab: 'overview',
      loading: true,
      loadError: '',
      ui: {
        openSection: 'essentials',
        guestFilter: 'all',
        guestSearch: '',
        guestSort: 'updated_desc',
        guestSource: 'any',
        guestPage: 1,
      },
    };
    document.body.appendChild(dialog);
    document.body.classList.add('ww-app-open');
    bindAppEvents(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.show();
    }
    dialog.querySelector('.ww-nav__item[aria-selected="true"]')?.focus({ preventScroll: true });
    await loadWorkspace();
  }

  /** Removes the app, refreshes the card status and returns focus to the launcher. */
  function closeApp() {
    const { dialog, opener, plan } = app;
    const finalPlan = app.plan || plan;
    const finalSite = app.site;
    app = null;
    dialog.remove();
    document.body.classList.remove('ww-app-open');
    setHeaderStatus(statusMeta(finalSite, finalPlan));
    if (finalPlan) {
      const index = cachedPlans.findIndex(item => item.id === finalPlan.id);
      if (index >= 0) {
        cachedPlans[index] = {
          ...cachedPlans[index],
          weddingWebsite: finalSite || cachedPlans[index].weddingWebsite,
        };
      } else {
        cachedPlans.push({ ...finalPlan, weddingWebsite: finalSite });
      }
    }
    opener?.focus?.();
  }

  /* ------------------------------------------------------------------ *
   * Dashboard entry point
   * ------------------------------------------------------------------ */

  let buttonBound = false;

  /** Makes the dashboard card's "Open app" button launch the app. */
  function bindOpenButton() {
    if (buttonBound) {
      return;
    }
    buttonBound = true;
    document.addEventListener('click', event => {
      const button = event.target.closest?.(OPEN_BUTTON_SELECTOR);
      if (button) {
        event.preventDefault();
        openApp(button);
      }
    });
  }

  /** Entry point called by the customer dashboard: loads the plans and sets the card status. */
  async function initWeddingWebsiteDashboard(plans) {
    cachedPlans = plans || [];
    if (!document.getElementById(ROOT_ID)) {
      return;
    }
    try {
      cachedPlans = await fetchPlans(cachedPlans);
      initialised = true;
      const plan = pickPlan(cachedPlans);
      const site = plan ? await getWebsite(plan) : null;
      setHeaderStatus(statusMeta(site, plan));
    } catch {
      /* the card keeps its default status */
    }
  }

  bindOpenButton();
  window.initWeddingWebsiteDashboard = initWeddingWebsiteDashboard;
})();
