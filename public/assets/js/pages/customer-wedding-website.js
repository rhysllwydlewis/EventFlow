'use strict';
/**
 * Wedding Website & RSVPs — customer dashboard app.
 *
 * One self-contained module: a modal "app" with five views (Overview, Website, Guests,
 * Seating, Share). State lives in `S` while the app is open and every view renders from it;
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
  const MAX_IMAGE_BYTES = 700000;
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

  function icon(name, size = 18) {
    return `<svg class="ww-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  let cachedPlans = [];
  let initialised = false;
  let S = null;

  function esc(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many || `${one}s`}`;
  }

  function percent(value, total) {
    if (!total) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((Number(value || 0) / Number(total)) * 100)));
  }

  function isWeddingPlan(plan) {
    const type = String(plan?.eventType || '').toLowerCase();
    const name = String(plan?.name || plan?.eventName || '').toLowerCase();
    return Boolean(plan?.weddingWebsite) || type === 'wedding' || name.includes('wedding');
  }

  function pickPlan(plans) {
    const weddingPlans = (plans || []).filter(isWeddingPlan);
    return weddingPlans.find(plan => plan.weddingWebsite) || weddingPlans[0] || null;
  }

  function getCsrfToken() {
    const fromMeta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (fromMeta) {
      return fromMeta;
    }
    const match = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

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

  const planPath = (plan, suffix = '') => `/api/me/plans/${encodeURIComponent(plan.id)}${suffix}`;

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

  function initials(name) {
    const parts = String(name || '?')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return (
      (parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }

  function normalizeSlug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
  }

  function readImage(file) {
    if (!file) {
      return Promise.resolve('');
    }
    if (!IMAGE_TYPES.has(file.type)) {
      return Promise.reject(new Error('Please choose a JPG, PNG, WebP or GIF image.'));
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return Promise.reject(new Error('Please choose an image under 700 KB.'));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read this image.'));
      reader.readAsDataURL(file);
    });
  }

  const isSeated = guest => Boolean(guest.tableId || guest.tableName || guest.table);
  const isAttending = guest => guest.rsvpStatus === 'attending';
  const isAwaiting = guest => !guest.rsvpStatus || guest.rsvpStatus === 'pending';
  const hasNotes = guest =>
    Boolean(guest.dietaryRequirements || guest.dietary || guest.accessibilityRequirements);

  const publicUrl = site => (site?.slug ? `${window.location.origin}/wedding/${site.slug}` : '');

  function previewUrl() {
    const slug = S?.site?.slug;
    if (!slug || !S.plan) {
      return '';
    }
    return `/wedding/${encodeURIComponent(slug)}?preview=1&plan=${encodeURIComponent(S.plan.id)}`;
  }

  /* ------------------------------------------------------------------ *
   * Status (dashboard card pill)
   * ------------------------------------------------------------------ */

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

  function statusMeta(site, plan) {
    if (!plan) {
      return { key: 'not-started', label: 'Not started' };
    }
    if (!site) {
      return { key: 'in-progress', label: 'Draft started' };
    }
    if (site.status === 'published') {
      return { key: 'published', label: 'Published' };
    }
    if (!essentialsMissing(site).length) {
      return { key: 'ready', label: 'Ready to publish' };
    }
    return { key: 'in-progress', label: 'In progress' };
  }

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

  async function getWebsite(plan) {
    if (!plan?.id) {
      return null;
    }
    const data = await api(planPath(plan, '/wedding-website')).catch(() => ({}));
    return data.website || data.site || data.data?.website || null;
  }

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

  async function loadGuestsAndTables() {
    if (!S.plan) {
      S.guests = [];
      S.tables = [];
      return;
    }
    const [guests, tables] = await Promise.all([
      api(planPath(S.plan, '/guests')).catch(() => ({ guests: [] })),
      api(planPath(S.plan, '/tables')).catch(() => ({ tables: [] })),
    ]);
    S.guests = guests.guests || [];
    S.tables = tables.tables || [];
  }

  async function reloadGuestsAndRender() {
    await loadGuestsAndTables();
    renderActive();
  }

  /* ------------------------------------------------------------------ *
   * Draft (editable copy of the website)
   * ------------------------------------------------------------------ */

  function planFallbacks(plan) {
    const first = (...values) => values.map(v => String(v || '').trim()).find(Boolean) || '';
    const venue = first(plan?.venueName, plan?.venue, plan?.location, plan?.selectedVenue?.name);
    return {
      eventDate: first(plan?.eventDate, plan?.date, plan?.weddingDate).slice(0, 10),
      ceremonyVenueName: venue,
      ceremonyVenueAddress: first(plan?.venueAddress, plan?.address, plan?.selectedVenue?.address),
    };
  }

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
    draft.template = site.template || 'classic';
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
      accentColor: site.accentColor || PALETTES[0].accent,
      secondaryColor: site.secondaryColor || PALETTES[0].secondary,
      backgroundColor: site.backgroundColor || PALETTES[0].background,
      textColor: site.textColor || PALETTES[0].text,
      heroLayout: site.heroLayout || 'classic',
      coverImageUrl: site.coverImageUrl || '',
      galleryImages: Array.isArray(site.galleryImages)
        ? site.galleryImages.map(item => ({ ...item }))
        : [],
    };
    return draft;
  }

  function draftPayload() {
    const draft = S.draft;
    const payload = { rsvpEnabled: draft.rsvpEnabled, accentColor: draft.theme.accentColor };
    SCALAR_KEYS.forEach(key => {
      payload[key] = draft[key];
    });
    payload.coverImageUrl = draft.theme.coverImageUrl;
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
        payload[name] = rows;
      }
    });
    return payload;
  }

  function themePayload() {
    const theme = S.draft.theme;
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

  function setDirty(value) {
    S.dirty = value;
    const bar = S.dialog?.querySelector('.ww-savebar');
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

  function stats() {
    const guests = S.guests;
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

  function checklist() {
    const st = stats();
    const site = S.site;
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

  function nextStep() {
    const st = stats();
    const site = S.site;
    if (!S.plan) {
      return {
        title: 'Set up your wedding hub',
        body: 'Create your guest website, RSVP form, guest list and seating plan in one place.',
        cta: 'Get started',
        go: 'website',
      };
    }
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

  function toast(message, type = 'ok') {
    const host = S?.dialog?.querySelector('.ww-toasts') || document.body;
    host.querySelectorAll('.ww-toast').forEach(old => old.remove());
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type}`;
    el.setAttribute('role', type === 'warn' ? 'alert' : 'status');
    el.innerHTML = `${icon(type === 'warn' ? 'info' : 'check', 16)}<span>${esc(message)}</span>`;
    host.appendChild(el);
    window.requestAnimationFrame(() => el.classList.add('is-in'));
    window.setTimeout(() => {
      el.classList.remove('is-in');
      window.setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  function setBusy(button, busy) {
    if (!button) {
      return;
    }
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', String(Boolean(busy)));
  }

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

  function openModal(dialog) {
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.show();
    }
  }

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

  function loadingHtml() {
    return '<div class="ww-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>';
  }

  function updateChrome() {
    const meta = statusMeta(S.site, S.plan);
    const status = S.dialog.querySelector('#ww-status');
    status.textContent = meta.label;
    status.dataset.status = meta.key;
    S.dialog.querySelector('#ww-top-title').textContent = TABS.find(t => t.key === S.tab).title;
    const guestsCount = S.dialog.querySelector('[data-count="guests"]');
    guestsCount.hidden = !S.guests.length;
    guestsCount.textContent = S.guests.length;
  }

  function goTo(tab, opts = {}) {
    if (!TABS.some(item => item.key === tab)) {
      return;
    }
    S.tab = tab;
    if (opts.section) {
      S.ui.openSection = opts.section;
    }
    if (opts.filter) {
      S.ui.guestFilter = opts.filter;
      S.ui.guestPage = 1;
    }
    S.dialog.querySelectorAll('.ww-nav__item').forEach(button => {
      const active = button.dataset.go === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    S.dialog.querySelectorAll('.ww-pane').forEach(pane => {
      pane.hidden = pane.dataset.pane !== tab;
    });
    renderActive({ resetScroll: !opts.keepScroll });
    if (opts.add) {
      editGuest(null);
    }
    if (opts.section) {
      window.requestAnimationFrame(() => {
        S.dialog
          .querySelector(`[data-section="${opts.section}"]`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  }

  function renderActive({ resetScroll = false } = {}) {
    if (!S) {
      return;
    }
    const scroller = S.dialog.querySelector('#ww-scroll');
    const top = scroller.scrollTop;
    const pane = S.dialog.querySelector(`[data-pane="${S.tab}"]`);
    const views = {
      overview: viewOverview,
      website: viewWebsite,
      guests: viewGuests,
      seating: viewSeating,
      share: viewShare,
    };
    pane.innerHTML = S.loading ? loadingHtml() : views[S.tab]();
    scroller.scrollTop = resetScroll ? 0 : top;
    updateChrome();
  }

  /* ------------------------------------------------------------------ *
   * Shared view fragments
   * ------------------------------------------------------------------ */

  function emptyState({ iconName, title, body, actions = '' }) {
    return `<div class="ww-empty">${`<span class="ww-empty__icon">${icon(iconName, 26)}</span>`}<h4>${esc(title)}</h4><p>${esc(body)}</p>${actions ? `<div class="ww-empty__actions">${actions}</div>` : ''}</div>`;
  }

  function badge(status) {
    const key = String(status || 'pending').toLowerCase();
    return `<span class="ww-badge ww-badge--${esc(key)}">${esc(RSVP_LABELS[key] || key)}</span>`;
  }

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

  function statCard({ label, value, sub, pct }) {
    return `<div class="ww-stat"><p class="ww-stat__label">${esc(label)}</p><p class="ww-stat__value">${value}</p>${
      pct === undefined
        ? ''
        : `<div class="ww-meter" role="img" aria-label="${esc(label)} ${pct}%"><span style="width:${pct}%"></span></div>`
    }<p class="ww-stat__sub">${esc(sub)}</p></div>`;
  }

  function viewOverview() {
    if (!S.plan) {
      return needsWorkspace();
    }
    const st = stats();
    const site = S.site;
    const items = checklist();
    const done = items.filter(item => item.done).length;
    const next = nextStep();
    const days = daysUntil(site?.eventDate);
    const url = publicUrl(site);
    const live = site?.status === 'published';
    const recent = [...S.guests]
      .filter(g => !isAwaiting(g) && g.updatedAt)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 5);
    const names = site?.coupleNames || S.plan.name || 'Your wedding';
    const meta = [
      site?.eventDate ? formatDate(site.eventDate) : '',
      site?.ceremonyVenueName || site?.venueName,
    ]
      .filter(Boolean)
      .join(' · ');

    return `<div class="ww-stack">
      <section class="ww-card ww-hero">
        <div class="ww-hero__text"><p class="ww-eyebrow">Your wedding</p><h4 class="ww-hero__title">${esc(names)}</h4><p class="ww-hero__meta">${esc(meta || 'Add your date and venue to complete your details.')}</p></div>
        ${
          days !== null && days >= 0
            ? `<div class="ww-countdown"><strong>${days}</strong><span>${days === 1 ? 'day' : 'days'} to go</span></div>`
            : days !== null
              ? `<div class="ww-countdown ww-countdown--past"><strong>${Math.abs(days)}</strong><span>${Math.abs(days) === 1 ? 'day' : 'days'} ago</span></div>`
              : ''
        }
      </section>

      <section class="ww-card ww-next">
        <span class="ww-next__icon">${icon('arrow', 20)}</span>
        <div class="ww-next__text"><p class="ww-eyebrow">Next step</p><h4>${esc(next.title)}</h4><p>${esc(next.body)}</p></div>
        <button type="button" class="ww-btn ww-btn--primary" data-go="${next.go}" ${next.section ? `data-section-target="${next.section}"` : ''} ${next.filter ? `data-filter-target="${next.filter}"` : ''} ${next.add ? 'data-add-target="1"' : ''}>${esc(next.cta)}</button>
      </section>

      <div class="ww-stats">
        ${statCard({ label: 'Guests', value: st.total, sub: st.total ? `${plural(st.notes, 'dietary or access note')}` : 'No guests added yet' })}
        ${statCard({ label: 'Replied', value: `${st.replied}<small>/${st.total}</small>`, sub: st.awaiting ? `${st.awaiting} awaiting a reply` : st.total ? 'Everyone has replied' : 'Waiting for guests', pct: percent(st.replied, st.total) })}
        ${statCard({ label: 'Attending', value: st.attending, sub: st.headcount ? `${plural(st.headcount, 'person', 'people')} including plus ones` : `${st.declined} declined` })}
        ${statCard({ label: 'Seated', value: `${st.seated}<small>/${st.attending}</small>`, sub: st.unseated ? `${st.unseated} still need a table` : st.attending ? 'Everyone has a seat' : 'No attending guests yet', pct: percent(st.seated, st.attending) })}
      </div>

      <div class="ww-columns">
        <section class="ww-card">
          <header class="ww-card__head"><h4>Setup checklist</h4><span class="ww-pill">${done} of ${items.length}</span></header>
          <div class="ww-meter ww-meter--lg" role="img" aria-label="Setup ${percent(done, items.length)}% complete"><span style="width:${percent(done, items.length)}%"></span></div>
          <ul class="ww-checklist">${items
            .map(
              item =>
                `<li><button type="button" class="ww-check ${item.done ? 'is-done' : ''}" data-go="${item.go}" ${item.section ? `data-section-target="${item.section}"` : ''}><span class="ww-check__box">${item.done ? icon('check', 14) : ''}</span><span class="ww-check__label">${esc(item.label)}</span>${icon('arrow', 16)}</button></li>`
            )
            .join('')}</ul>
        </section>
        <section class="ww-card">
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
        </section>
      </div>

      ${
        url
          ? `<section class="ww-card ww-linkbar"><div class="ww-linkbar__text"><span class="ww-dot ${live ? 'is-live' : ''}"></span><div><p class="ww-eyebrow">${live ? 'Live guest link' : 'Guest link (not live yet)'}</p><p class="ww-linkbar__url">${esc(url.replace(/^https?:\/\//, ''))}</p></div></div><div class="ww-linkbar__actions"><button type="button" class="ww-btn ww-btn--secondary" data-action="copy-link">${icon('copy', 16)}Copy link</button><button type="button" class="ww-btn ww-btn--ghost" data-go="share">Share tools</button></div></section>`
          : ''
      }
    </div>`;
  }

  /* ------------------------------------------------------------------ *
   * View: Website (editor)
   * ------------------------------------------------------------------ */

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

  function fieldHtml(field, value, attrs) {
    return `<label class="ww-field ${field.wide ? 'ww-field--wide' : ''}"><span class="ww-label">${esc(field.label)}${field.required ? '<em>Required</em>' : ''}</span>${inputControl(field, value, attrs)}</label>`;
  }

  function listHtml(name) {
    const def = LISTS[name];
    const rows = S.draft.lists[name];
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

  function lookHtml() {
    const theme = S.draft.theme;
    const gallery = theme.galleryImages
      .map(
        (item, index) =>
          `<article class="ww-thumb"><img src="${esc(item.imageUrl)}" alt="${esc(item.alt || item.caption || `Gallery photo ${index + 1}`)}"><input class="ww-input" data-gallery-caption="${index}" value="${esc(item.caption || '')}" placeholder="Caption (optional)" aria-label="Caption for photo ${index + 1}"><div class="ww-thumb__tools"><button type="button" class="ww-icon-btn" data-action="gallery-move" data-i="${index}" data-dir="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move photo ${index + 1} earlier">${icon('chevronUp', 16)}</button><button type="button" class="ww-icon-btn" data-action="gallery-move" data-i="${index}" data-dir="1" ${index === theme.galleryImages.length - 1 ? 'disabled' : ''} aria-label="Move photo ${index + 1} later">${icon('chevron', 16)}</button><button type="button" class="ww-icon-btn ww-icon-btn--danger" data-action="gallery-remove" data-i="${index}" aria-label="Remove photo ${index + 1}">${icon('trash', 16)}</button></div></article>`
      )
      .join('');
    const colour = (key, label) =>
      `<label class="ww-swatch"><input type="color" data-theme="${key}" value="${esc(theme[key])}"><span class="ww-swatch__chip" style="background:${esc(theme[key])}"></span><span class="ww-swatch__label">${label}</span></label>`;
    const names = S.draft.coupleNames || 'Your names';
    const dateLine = [
      S.draft.eventDate ? formatDate(S.draft.eventDate) : '',
      S.draft.ceremonyVenueName,
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
            `<option value="${tpl.value}" ${S.draft.template === tpl.value ? 'selected' : ''}>${esc(tpl.label)}</option>`
        ).join('')}</select></label></div>
        <div class="ww-group"><h5>Cover photo</h5><div class="ww-actions-row"><label class="ww-btn ww-btn--secondary">${icon('image', 16)}${theme.coverImageUrl ? 'Replace photo' : 'Choose photo'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload="cover" hidden></label>${theme.coverImageUrl ? '<button type="button" class="ww-btn ww-btn--ghost" data-action="cover-remove">Remove</button>' : ''}</div><p class="ww-hint">JPG, PNG, WebP or GIF under 700 KB.</p></div>
        <div class="ww-group"><h5>Gallery <span class="ww-muted">${theme.galleryImages.length}/${MAX_GALLERY}</span></h5>${gallery ? `<div class="ww-gallery">${gallery}</div>` : ''}<div class="ww-actions-row"><label class="ww-btn ww-btn--secondary ${theme.galleryImages.length >= MAX_GALLERY ? 'is-disabled' : ''}">${icon('plus', 16)}Add photos<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple data-upload="gallery" hidden ${theme.galleryImages.length >= MAX_GALLERY ? 'disabled' : ''}></label></div></div>
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

  function isActivePalette(palette) {
    const theme = S.draft.theme;
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    return (
      same(theme.accentColor, palette.accent) &&
      same(theme.secondaryColor, palette.secondary) &&
      same(theme.backgroundColor, palette.background) &&
      same(theme.textColor, palette.text)
    );
  }

  function miniVars() {
    const theme = S.draft.theme;
    return `--m-accent:${esc(theme.accentColor)};--m-2:${esc(theme.secondaryColor)};--m-bg:${esc(theme.backgroundColor)};--m-text:${esc(theme.textColor)}`;
  }

  function sectionSummary(section) {
    const draft = S.draft;
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

  function sectionBody(section) {
    if (section.custom === 'look') {
      return lookHtml();
    }
    const toggle = section.toggle
      ? `<label class="ww-toggle"><input type="checkbox" data-f="${section.toggle}" ${S.draft[section.toggle] ? 'checked' : ''}><span class="ww-toggle__track"></span><span class="ww-toggle__text"><strong>Collect RSVPs on your website</strong><small>Guests reply with the form on your public page.</small></span></label>`
      : '';
    const fields = section.fields
      ? `<div class="ww-grid">${section.fields.map(field => fieldHtml(field, S.draft[field.key], `data-f="${field.key}"`)).join('')}</div>`
      : '';
    const lists = (section.lists || []).map(listHtml).join('');
    return `${toggle}${fields}${lists}`;
  }

  function readinessBanner() {
    if (S.site?.status === 'published') {
      return `<div class="ww-banner ww-banner--ok">${icon('check', 18)}<div><strong>Your website is live</strong><span>Changes go live as soon as you save.</span></div><a class="ww-link" href="${esc(publicUrl(S.site))}" target="_blank" rel="noopener">View site</a></div>`;
    }
    const missing = essentialsMissing(S.draft);
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

  function viewWebsite() {
    if (!S.plan) {
      return needsWorkspace();
    }
    if (!S.site) {
      return `<div class="ww-card">${emptyState({
        iconName: 'website',
        title: 'Create your free wedding website',
        body: 'Start a draft now. You can add details, photos and your RSVP form whenever you are ready.',
        actions:
          '<button type="button" class="ww-btn ww-btn--primary" id="ww-create" data-action="create-site">Create website</button>',
      })}</div>`;
    }
    const live = S.site.status === 'published';
    const sections = SECTIONS.map(section => {
      const open = S.ui.openSection === section.id;
      return `<section class="ww-section ${open ? 'is-open' : ''}" data-section="${section.id}">
        <h4 class="ww-section__head"><button type="button" class="ww-section__toggle" data-action="toggle-section" data-id="${section.id}" aria-expanded="${open}" aria-controls="ww-sec-${section.id}"><span class="ww-section__icon">${icon(section.icon, 18)}</span><span class="ww-section__titles"><strong>${esc(section.title)}</strong><small data-summary="${section.id}">${esc(sectionSummary(section))}</small></span><span class="ww-section__chev">${icon('chevron', 18)}</span></button></h4>
        <div class="ww-section__body" id="ww-sec-${section.id}" ${open ? '' : 'hidden'}>${open ? sectionBody(section) : ''}</div>
      </section>`;
    }).join('');
    return `<div class="ww-stack ww-stack--editor">
      <div data-readiness>${readinessBanner()}</div>
      <div class="ww-sections">${sections}</div>
      <div class="ww-savebar" data-state="${S.dirty ? 'dirty' : 'clean'}">
        <span class="ww-savebar__dot"></span><span class="ww-savebar__text">${S.dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
        <div class="ww-savebar__actions">
          <a class="ww-btn ww-btn--ghost" href="${esc(previewUrl())}" target="_blank" rel="noopener">${icon('eye', 16)}${live ? 'View live site' : 'Preview draft'}</a>
          <button type="button" class="ww-btn ww-btn--secondary" data-action="${live ? 'unpublish' : 'publish'}">${live ? 'Unpublish' : 'Publish'}</button>
          <button type="button" class="ww-btn ww-btn--primary" data-action="save" id="ww-save">Save changes</button>
        </div>
      </div>
    </div>`;
  }

  function refreshEditorMeta() {
    const dialog = S.dialog;
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
      hero.dataset.layout = S.draft.theme.heroLayout;
      hero.style.backgroundImage = S.draft.theme.coverImageUrl
        ? `url('${S.draft.theme.coverImageUrl}')`
        : '';
      hero.querySelector('strong').textContent = S.draft.coupleNames || 'Your names';
      hero.querySelector('span').textContent =
        [S.draft.eventDate ? formatDate(S.draft.eventDate) : '', S.draft.ceremonyVenueName]
          .filter(Boolean)
          .join(' · ') || 'Date · Venue';
    }
  }

  async function saveWebsite({ quiet = false } = {}) {
    await api(planPath(S.plan, '/wedding-website'), { method: 'PATCH', body: draftPayload() });
    await api(planPath(S.plan, '/wedding-website/theme-media'), {
      method: 'PATCH',
      body: themePayload(),
    });
    S.site = await getWebsite(S.plan);
    S.draft = makeDraft(S.site, S.plan);
    setDirty(false);
    if (!quiet) {
      toast('Changes saved');
    }
    renderActive();
  }

  async function publishWebsite(button) {
    const missing = essentialsMissing(S.draft);
    if (missing.length) {
      toast(
        `Before publishing: ${missing.map(k => READINESS_LABELS[k].toLowerCase()).join(', ')}`,
        'warn'
      );
      focusField(missing[0]);
      return;
    }
    await guard(button, async () => {
      await saveWebsite({ quiet: true });
      try {
        await api(planPath(S.plan, '/wedding-website/publish'), { method: 'POST' });
      } catch (err) {
        const keys = err.payload?.checklist?.missing;
        if (Array.isArray(keys) && keys.length) {
          const needsShare = keys.some(key => key === 'slug' || key === 'password');
          toast(
            `Before publishing: ${keys.map(k => (READINESS_LABELS[k] || k).toLowerCase()).join(', ')}`,
            'warn'
          );
          if (needsShare) {
            goTo('share');
          }
          return;
        }
        throw err;
      }
      S.site = await getWebsite(S.plan);
      S.draft = makeDraft(S.site, S.plan);
      setHeaderStatus(statusMeta(S.site, S.plan));
      toast('Your website is live');
      renderActive();
    });
  }

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
      await api(planPath(S.plan, '/wedding-website/unpublish'), { method: 'POST' });
      S.site = await getWebsite(S.plan);
      setHeaderStatus(statusMeta(S.site, S.plan));
      toast('Website unpublished');
      renderActive();
    });
  }

  function focusField(key) {
    const target = key === 'venue' ? 'ceremonyVenueName' : key;
    S.ui.openSection = 'essentials';
    if (S.tab !== 'website') {
      goTo('website', { section: 'essentials' });
    } else {
      renderActive();
    }
    window.requestAnimationFrame(() => {
      const input = S.dialog.querySelector(`[data-f="${target}"]`);
      input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  function filteredGuests() {
    const { guestFilter, guestSearch, guestSort, guestSource } = S.ui;
    const query = guestSearch.trim().toLowerCase();
    const list = S.guests
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
          [g.name, g.email, g.householdName, g.plusOneName].some(value =>
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
        const table = g.tableName || g.table || S.tables.find(t => t.id === g.tableId)?.name || '';
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

  function guestResults() {
    const sorted = filteredGuests();
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, S.ui.guestPage), totalPages);
    S.ui.guestPage = page;
    const shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!S.guests.length) {
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
      <div class="ww-pager"><span>${sorted.length === S.guests.length ? plural(sorted.length, 'guest') : `${sorted.length} of ${S.guests.length} guests`}</span><div><button type="button" class="ww-btn ww-btn--ghost" data-action="guest-page" data-dir="-1" ${page <= 1 ? 'disabled' : ''}>Previous</button><span class="ww-pager__page">Page ${page} of ${totalPages}</span><button type="button" class="ww-btn ww-btn--ghost" data-action="guest-page" data-dir="1" ${page >= totalPages ? 'disabled' : ''}>Next</button></div></div>`;
  }

  function viewGuests() {
    if (!S.plan) {
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
          <label class="ww-search">${icon('search', 16)}<input type="search" data-ui="guestSearch" value="${esc(S.ui.guestSearch)}" placeholder="Search guests" aria-label="Search guests" autocomplete="off"></label>
          <select class="ww-input ww-select" data-ui="guestSort" aria-label="Sort guests"><option value="updated_desc" ${S.ui.guestSort === 'updated_desc' ? 'selected' : ''}>Recently updated</option><option value="name_asc" ${S.ui.guestSort === 'name_asc' ? 'selected' : ''}>Name A–Z</option><option value="status" ${S.ui.guestSort === 'status' ? 'selected' : ''}>RSVP status</option></select>
          <select class="ww-input ww-select" data-ui="guestSource" aria-label="Filter by source"><option value="any" ${S.ui.guestSource === 'any' ? 'selected' : ''}>All sources</option><option value="form" ${S.ui.guestSource === 'form' ? 'selected' : ''}>RSVP form</option><option value="manual" ${S.ui.guestSource === 'manual' ? 'selected' : ''}>Added by you</option></select>
          <a class="ww-btn ww-btn--secondary" href="${planPath(S.plan, '/guests/export.csv')}">${icon('download', 16)}Export</a>
          <button type="button" class="ww-btn ww-btn--primary" data-action="guest-add">${icon('plus', 16)}Add guest</button>
        </div>
        <div class="ww-filters" role="group" aria-label="Filter guests">${GUEST_FILTERS.map(
          ([key, label]) =>
            `<button type="button" class="ww-filter ${S.ui.guestFilter === key ? 'is-active' : ''}" data-action="guest-filter" data-f="${key}" aria-pressed="${S.ui.guestFilter === key}">${label}</button>`
        ).join('')}</div>
        <div id="ww-guest-results">${guestResults()}</div>
      </section>
    </div>`;
  }

  function renderGuestResults() {
    const host = S.dialog.querySelector('#ww-guest-results');
    if (host) {
      host.innerHTML = guestResults();
    }
    S.dialog.querySelectorAll('[data-action="guest-filter"]').forEach(button => {
      const active = button.dataset.f === S.ui.guestFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

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
        await api(planPath(S.plan, `/guests${guest ? `/${encodeURIComponent(guest.id)}` : ''}`), {
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

  async function deleteGuest(id, button) {
    const guest = S.guests.find(g => String(g.id) === String(id));
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
      await api(planPath(S.plan, `/guests/${encodeURIComponent(id)}`), { method: 'DELETE' });
      toast('Guest deleted');
      await reloadGuestsAndRender();
    });
  }

  /* ------------------------------------------------------------------ *
   * View: Seating
   * ------------------------------------------------------------------ */

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

  function seatedAt(table) {
    const ids = new Set(table.guestIds || []);
    return S.guests.filter(g => ids.has(g.id));
  }

  function viewSeating() {
    if (!S.plan) {
      return needsWorkspace();
    }
    const st = stats();
    const attending = S.guests.filter(isAttending);
    const unseated = attending.filter(g => !isSeated(g));
    const capacity = S.tables.reduce((sum, table) => sum + (Number(table.capacity) || 0), 0);
    const over = S.tables.filter(
      table => (table.guestIds || []).length > Number(table.capacity || 0)
    );
    const freeSeats = table =>
      Math.max(0, Number(table.capacity || 0) - (table.guestIds || []).length);

    const toolbar = `<div class="ww-toolbar ww-toolbar--plain"><div class="ww-seatstats"><div><strong>${S.tables.length}</strong><span>Tables</span></div><div><strong>${capacity}</strong><span>Seats</span></div><div><strong>${st.seated}</strong><span>Seated</span></div><div class="${st.unseated ? 'is-alert' : ''}"><strong>${st.unseated}</strong><span>Unseated</span></div></div><div class="ww-toolbar__actions"><button type="button" class="ww-btn ww-btn--ghost" data-action="auto-seat" ${unseated.length && S.tables.length ? '' : 'disabled'}>${icon('wand', 16)}Auto-seat</button><button type="button" class="ww-btn ww-btn--ghost" data-action="clear-seating" ${st.seated ? '' : 'disabled'}>Clear seating</button><button type="button" class="ww-btn ww-btn--primary" data-action="table-add">${icon('plus', 16)}Add table</button></div></div>`;

    if (!S.tables.length && !attending.length) {
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
                `<li draggable="true" data-guest="${esc(g.id)}"><span class="ww-avatar">${esc(initials(g.name))}</span><span class="ww-seatlist__name"><strong>${esc(g.name)}</strong>${Number(g.partySize) > 1 ? `<small>Party of ${Number(g.partySize)}</small>` : ''}</span><select class="ww-input ww-select ww-select--sm" data-assign="${esc(g.id)}" aria-label="Seat ${esc(g.name)} at a table"><option value="">Seat at…</option>${S.tables
                  .map(
                    table =>
                      `<option value="${esc(table.id)}" ${freeSeats(table) ? '' : 'disabled'}>${esc(table.name)} (${freeSeats(table)} free)</option>`
                  )
                  .join('')}</select></li>`
            )
            .join('')}</ul>`
        : `<p class="ww-muted-note">${attending.length ? 'Everyone attending has a seat.' : 'Guests who RSVP “attending” will appear here.'}</p>`
    }<p class="ww-hint">${icon('info', 14)} Drag a guest onto a table, or use the menu.</p></aside>`;

    const grid = S.tables.length
      ? `<div class="ww-tables">${S.tables
          .map(table => {
            const guests = seatedAt(table);
            const full = guests.length > Number(table.capacity || 0);
            return `<article class="ww-card ww-tablecard ${full ? 'is-over' : ''}" data-drop="table" data-table="${esc(table.id)}"><header class="ww-tablecard__head"><div><h4>${esc(table.name)}</h4><small>${esc(TABLE_TYPES[table.type] || 'Table')} · ${guests.length}/${Number(table.capacity) || 0}</small></div><div><button type="button" class="ww-icon-btn" data-action="table-edit" data-id="${esc(table.id)}" aria-label="Edit ${esc(table.name)}">${icon('edit', 16)}</button><button type="button" class="ww-icon-btn ww-icon-btn--danger" data-action="table-delete" data-id="${esc(table.id)}" aria-label="Delete ${esc(table.name)}">${icon('trash', 16)}</button></div></header>${tableSvg(table, guests.length)}${full ? '<p class="ww-warn-text">Over capacity. Move a guest or add seats.</p>' : ''}<ul class="ww-chips">${
              guests.length
                ? guests
                    .map(
                      g =>
                        `<li draggable="true" data-guest="${esc(g.id)}"><span>${esc(g.name)}</span><button type="button" data-action="seat-unassign" data-id="${esc(g.id)}" aria-label="Unseat ${esc(g.name)}">${icon('close', 12)}</button></li>`
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

  async function assignGuest(guestId, tableId) {
    await api(planPath(S.plan, `/tables/${encodeURIComponent(tableId)}/assign-guest`), {
      method: 'POST',
      body: { guestId },
    });
  }

  async function unassignGuest(guestId) {
    await api(planPath(S.plan, '/tables/unassign-guest'), { method: 'POST', body: { guestId } });
  }

  async function autoSeat(button) {
    const unseated = S.guests
      .filter(g => isAttending(g) && !isSeated(g))
      .sort(
        (a, b) =>
          String(a.householdName || '~').localeCompare(String(b.householdName || '~')) ||
          String(a.name || '').localeCompare(String(b.name || ''))
      );
    const slots = S.tables.flatMap(table =>
      Array(Math.max(0, Number(table.capacity || 0) - (table.guestIds || []).length)).fill(table.id)
    );
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
      for (let i = 0; i < count; i += 1) {
        await assignGuest(unseated[i].id, slots[i]);
      }
      toast(
        count < unseated.length
          ? `Seated ${count}. ${unseated.length - count} more need seats.`
          : `Seated ${plural(count, 'guest')}`
      );
      await reloadGuestsAndRender();
    });
  }

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
      for (const guest of S.guests.filter(g => isAttending(g) && isSeated(g))) {
        await unassignGuest(guest.id);
      }
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

  function viewShare() {
    if (!S.plan) {
      return needsWorkspace();
    }
    if (!S.site) {
      return `<div class="ww-card">${emptyState({
        iconName: 'share',
        title: 'Create your website first',
        body: 'Once your website exists you can set its link, privacy and share it with guests.',
        actions:
          '<button type="button" class="ww-btn ww-btn--primary" data-go="website">Go to website</button>',
      })}</div>`;
    }
    const site = S.site;
    const live = site.status === 'published';
    const url = publicUrl(site);
    const qr = url ? `/api/tools/qr.png?url=${encodeURIComponent(url)}` : '';
    const message = `We would love you to RSVP on our wedding website: ${url}`;
    const visibility = S.ui.visibility || site.visibility || 'private_link';
    const slug = S.ui.slug ?? site.slug ?? '';

    return `<div class="ww-stack">
      <section class="ww-card ww-live ${live ? 'is-live' : ''}">
        <div class="ww-live__head"><span class="ww-dot ${live ? 'is-live' : ''}"></span><div><h4>${live ? 'Your website is live' : 'Your website is a draft'}</h4><p>${live ? 'Guests can open your link and send RSVPs.' : 'Publish when you are ready. Guests cannot see it until then.'}</p></div><button type="button" class="ww-btn ${live ? 'ww-btn--secondary' : 'ww-btn--primary'}" data-action="${live ? 'unpublish' : 'publish'}">${live ? 'Unpublish' : 'Publish website'}</button></div>
        <div class="ww-copybox"><span class="ww-copybox__icon">${icon('link', 16)}</span><input readonly value="${esc(url)}" aria-label="Guest website link"><button type="button" class="ww-btn ww-btn--secondary" data-action="copy-link">${icon('copy', 16)}Copy</button><a class="ww-btn ww-btn--ghost" href="${esc(live ? url : previewUrl())}" target="_blank" rel="noopener">${icon('external', 16)}${live ? 'Open' : 'Preview'}</a></div>
      </section>

      <div class="ww-columns">
        <section class="ww-card">
          <header class="ww-card__head"><h4>Link &amp; privacy</h4></header>
          <label class="ww-field"><span class="ww-label">Website link</span><span class="ww-slug"><span class="ww-slug__prefix">/wedding/</span><input class="ww-input" data-ui-slug value="${esc(slug)}" placeholder="our-wedding" autocomplete="off" spellcheck="false" aria-label="Custom website link"></span><small class="ww-hint">Letters, numbers and dashes. Choose something personal.</small></label>
          <button type="button" class="ww-link ww-link--inline" data-action="regen-slug">${icon('refresh', 14)}Suggest a new link</button>
          <fieldset class="ww-radios"><legend class="ww-label">Who can view it</legend>${VISIBILITY.map(
            option =>
              `<label class="ww-radio ${visibility === option.value ? 'is-selected' : ''}"><input type="radio" name="ww-visibility" value="${option.value}" ${visibility === option.value ? 'checked' : ''}><span class="ww-radio__icon">${icon(option.icon, 18)}</span><span class="ww-radio__text"><strong>${esc(option.title)}</strong><small>${esc(option.text)}</small></span></label>`
          ).join('')}</fieldset>
          <label class="ww-field" ${visibility === 'password' ? '' : 'hidden'} data-password-field><span class="ww-label">Website password</span><input class="ww-input" type="password" data-ui-password minlength="6" autocomplete="new-password" placeholder="${site.passwordSet ? 'Leave blank to keep your current password' : 'At least 6 characters'}"><small class="ww-hint">Saved passwords are never shown again. Share it with guests separately.</small></label>
          <p class="ww-error" data-share-error hidden></p>
          <div class="ww-actions-row"><button type="button" class="ww-btn ww-btn--primary" data-action="save-share">Save link settings</button></div>
        </section>

        <section class="ww-card">
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
        </section>
      </div>
    </div>`;
  }

  async function saveShareSettings(button) {
    const dialog = S.dialog;
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
    if (visibility === 'password' && !password && !S.site.passwordSet) {
      errorEl.textContent = 'Please set a password before enabling password protection.';
      errorEl.hidden = false;
      return;
    }
    await guard(button, async () => {
      try {
        const body = { slug, visibility };
        if (password) {
          body.password = password;
        }
        await api(planPath(S.plan, '/wedding-website'), { method: 'PATCH', body });
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        return;
      }
      S.site = await getWebsite(S.plan);
      S.ui.slug = undefined;
      S.ui.visibility = undefined;
      toast('Link settings saved');
      renderActive();
    });
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      window.prompt('Copy this text:', text);
    }
  }

  /* ------------------------------------------------------------------ *
   * Event handling
   * ------------------------------------------------------------------ */

  function onInput(event) {
    const el = event.target;
    if (el.matches('[data-f]')) {
      S.draft[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      setDirty(true);
      refreshEditorMeta();
      return;
    }
    if (el.matches('[data-list]')) {
      const row = S.draft.lists[el.dataset.list][Number(el.dataset.i)];
      row[el.dataset.k] = el.value;
      if (el.dataset.list === 'customRsvpQuestions' && el.dataset.k === 'type') {
        renderActive();
      }
      setDirty(true);
      refreshEditorMeta();
      return;
    }
    if (el.matches('[data-theme]')) {
      if (el.type === 'radio' && !el.checked) {
        return;
      }
      S.draft.theme[el.dataset.theme] = el.value;
      const chip = el.parentElement.querySelector('.ww-swatch__chip');
      if (chip) {
        chip.style.background = el.value;
      }
      setDirty(true);
      refreshEditorMeta();
      return;
    }
    if (el.matches('[data-gallery-caption]')) {
      const item = S.draft.theme.galleryImages[Number(el.dataset.galleryCaption)];
      if (item) {
        item.caption = el.value;
        setDirty(true);
      }
      return;
    }
    if (el.matches('[data-ui="guestSearch"]')) {
      S.ui.guestSearch = el.value;
      S.ui.guestPage = 1;
      renderGuestResults();
      return;
    }
    if (el.matches('[data-ui-slug]')) {
      S.ui.slug = el.value;
    }
  }

  function onChange(event) {
    const el = event.target;
    if (el.matches('[data-ui]') && el.dataset.ui !== 'guestSearch') {
      S.ui[el.dataset.ui] = el.value;
      S.ui.guestPage = 1;
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
      S.ui.visibility = el.value;
      S.dialog.querySelectorAll('.ww-radio').forEach(label => {
        label.classList.toggle('is-selected', label.contains(el));
      });
      const field = S.dialog.querySelector('[data-password-field]');
      if (field) {
        field.hidden = el.value !== 'password';
      }
      return;
    }
    if (el.matches('[data-upload]')) {
      handleUpload(el);
    }
  }

  async function handleUpload(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    try {
      if (input.dataset.upload === 'cover') {
        S.draft.theme.coverImageUrl = await readImage(files[0]);
        toast('Cover photo ready. Save to publish it.');
      } else {
        const room = MAX_GALLERY - S.draft.theme.galleryImages.length;
        for (const file of files.slice(0, room)) {
          S.draft.theme.galleryImages.push({
            id: uid('gallery'),
            imageUrl: await readImage(file),
            caption: '',
            alt: '',
          });
        }
        toast('Photos ready. Save to publish them.');
      }
      setDirty(true);
      renderActive();
    } catch (err) {
      toast(err.message, 'warn');
    }
  }

  async function onClick(event) {
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

  async function runAction(el, event) {
    const { action } = el.dataset;
    switch (action) {
      case 'close':
        S.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
        break;
      case 'toggle-section':
        S.ui.openSection = S.ui.openSection === el.dataset.id ? '' : el.dataset.id;
        renderActive();
        break;
      case 'add-item': {
        const rows = S.draft.lists[el.dataset.list];
        const item = { id: uid(el.dataset.list) };
        LISTS[el.dataset.list].fields.forEach(field => {
          item[field.key] = field.key === 'type' ? 'text' : field.key === 'required' ? 'false' : '';
        });
        rows.push(item);
        setDirty(true);
        renderActive();
        window.requestAnimationFrame(() => {
          const inputs = S.dialog.querySelectorAll(
            `[data-list="${el.dataset.list}"][data-i="${rows.length - 1}"]`
          );
          inputs[0]?.focus();
        });
        break;
      }
      case 'remove-item':
        S.draft.lists[el.dataset.list].splice(Number(el.dataset.i), 1);
        setDirty(true);
        renderActive();
        break;
      case 'focus-field':
        focusField(el.dataset.key);
        break;
      case 'palette': {
        const palette = PALETTES[Number(el.dataset.i)];
        Object.assign(S.draft.theme, {
          accentColor: palette.accent,
          secondaryColor: palette.secondary,
          backgroundColor: palette.background,
          textColor: palette.text,
        });
        setDirty(true);
        renderActive();
        break;
      }
      case 'cover-remove':
        S.draft.theme.coverImageUrl = '';
        setDirty(true);
        renderActive();
        break;
      case 'gallery-remove':
        S.draft.theme.galleryImages.splice(Number(el.dataset.i), 1);
        setDirty(true);
        renderActive();
        break;
      case 'gallery-move': {
        const list = S.draft.theme.galleryImages;
        const from = Number(el.dataset.i);
        const to = from + Number(el.dataset.dir);
        if (to >= 0 && to < list.length) {
          list.splice(to, 0, list.splice(from, 1)[0]);
          setDirty(true);
          renderActive();
        }
        break;
      }
      case 'save':
        await guard(el, () => saveWebsite());
        break;
      case 'publish':
        if (S.dirty || S.tab === 'website') {
          await publishWebsite(el);
        } else {
          await guard(el, async () => {
            await publishFromShare();
          });
        }
        break;
      case 'unpublish':
        await unpublishWebsite(el);
        break;
      case 'create-site':
        await guard(el, async () => {
          await api(planPath(S.plan, '/wedding-website'), { method: 'POST', body: {} });
          S.site = await getWebsite(S.plan);
          S.draft = makeDraft(S.site, S.plan);
          setHeaderStatus(statusMeta(S.site, S.plan));
          toast('Website draft created');
          renderActive();
        });
        break;
      case 'quick-start':
        await guard(el, async () => {
          const res = await api('/api/me/plans/wedding-workspace', { method: 'POST' });
          await adoptPlan(res.plan);
          toast('Wedding workspace created');
        });
        break;
      case 'use-existing': {
        const chosen = S.dialog.querySelector('#ww-existing-plan')?.value;
        const plan = cachedPlans.find(item => String(item.id) === String(chosen));
        if (!plan) {
          toast('Choose a plan first', 'warn');
          break;
        }
        await guard(el, async () => {
          await adoptPlan(plan);
        });
        break;
      }
      case 'copy-link':
        await copyText(publicUrl(S.site), 'Link copied');
        break;
      case 'copy-message':
        await copyText(
          `We would love you to RSVP on our wedding website: ${publicUrl(S.site)}`,
          'Message copied'
        );
        break;
      case 'save-share':
        await saveShareSettings(el);
        break;
      case 'regen-slug':
        await guard(el, async () => {
          const res = await api(planPath(S.plan, '/wedding-website/regenerate-slug'), {
            method: 'POST',
            body: {},
          });
          S.site = res.website || (await getWebsite(S.plan));
          S.ui.slug = undefined;
          toast('New link suggested');
          renderActive();
        });
        break;
      case 'guest-add':
        editGuest(null);
        break;
      case 'guest-edit':
        editGuest(S.guests.find(g => String(g.id) === String(el.dataset.id)));
        break;
      case 'guest-delete':
        await deleteGuest(el.dataset.id, el);
        break;
      case 'guest-filter':
        S.ui.guestFilter = el.dataset.f;
        S.ui.guestPage = 1;
        renderGuestResults();
        break;
      case 'guest-page':
        S.ui.guestPage += Number(el.dataset.dir);
        renderGuestResults();
        break;
      case 'guest-reset':
        Object.assign(S.ui, {
          guestFilter: 'all',
          guestSearch: '',
          guestSource: 'any',
          guestPage: 1,
        });
        renderActive();
        break;
      case 'table-add': {
        const payload = await editTable({
          name: `Table ${S.tables.length + 1}`,
          capacity: 10,
          type: 'round',
        });
        if (payload) {
          await guard(el, async () => {
            await api(planPath(S.plan, '/tables'), { method: 'POST', body: payload });
            toast('Table added');
            await reloadGuestsAndRender();
          });
        }
        break;
      }
      case 'table-edit': {
        const table = S.tables.find(item => String(item.id) === String(el.dataset.id));
        const payload = table && (await editTable(table));
        if (payload) {
          await guard(el, async () => {
            await api(planPath(S.plan, `/tables/${encodeURIComponent(table.id)}`), {
              method: 'PATCH',
              body: payload,
            });
            await reloadGuestsAndRender();
          });
        }
        break;
      }
      case 'table-delete': {
        const table = S.tables.find(item => String(item.id) === String(el.dataset.id));
        const ok = await confirmAction({
          title: `Delete ${table?.name || 'table'}?`,
          message:
            'Guests at this table become unseated. Their RSVP details stay in your guest list.',
          confirmLabel: 'Delete table',
          danger: true,
        });
        if (ok) {
          await guard(el, async () => {
            await api(planPath(S.plan, `/tables/${encodeURIComponent(el.dataset.id)}`), {
              method: 'DELETE',
            });
            await reloadGuestsAndRender();
          });
        }
        break;
      }
      case 'seat-unassign':
        event.preventDefault();
        await guard(el, async () => {
          await unassignGuest(el.dataset.id);
          await reloadGuestsAndRender();
        });
        break;
      case 'auto-seat':
        await autoSeat(el);
        break;
      case 'clear-seating':
        await clearSeating(el);
        break;
      default:
        break;
    }
  }

  async function publishFromShare() {
    const missing = essentialsMissing(S.site);
    if (missing.length) {
      toast(
        `Before publishing: ${missing.map(k => READINESS_LABELS[k].toLowerCase()).join(', ')}`,
        'warn'
      );
      focusField(missing[0]);
      return;
    }
    try {
      await api(planPath(S.plan, '/wedding-website/publish'), { method: 'POST' });
    } catch (err) {
      const keys = err.payload?.checklist?.missing;
      if (Array.isArray(keys) && keys.length) {
        toast(
          `Before publishing: ${keys.map(k => (READINESS_LABELS[k] || k).toLowerCase()).join(', ')}`,
          'warn'
        );
        return;
      }
      throw err;
    }
    S.site = await getWebsite(S.plan);
    S.draft = makeDraft(S.site, S.plan);
    setHeaderStatus(statusMeta(S.site, S.plan));
    toast('Your website is live');
    renderActive();
  }

  async function adoptPlan(plan) {
    S.plan = plan;
    S.site = await ensureWebsite(plan);
    S.draft = S.site ? makeDraft(S.site, plan) : null;
    await loadGuestsAndTables();
    setHeaderStatus(statusMeta(S.site, S.plan));
    goTo(S.site ? 'overview' : 'website');
  }

  /* Drag and drop for seating (mouse); menus cover keyboard and touch. */

  function onDragStart(event) {
    const item = event.target.closest('[data-guest]');
    if (!item) {
      return;
    }
    event.dataTransfer.setData('text/plain', item.dataset.guest);
    event.dataTransfer.effectAllowed = 'move';
    item.classList.add('is-dragging');
  }

  function onDragEnd(event) {
    event.target.closest?.('[data-guest]')?.classList.remove('is-dragging');
    S.dialog
      .querySelectorAll('.is-drop-target')
      .forEach(el => el.classList.remove('is-drop-target'));
  }

  function onDragOver(event) {
    const zone = event.target.closest('[data-drop]');
    if (zone) {
      event.preventDefault();
      zone.classList.add('is-drop-target');
    }
  }

  function onDragLeave(event) {
    const zone = event.target.closest('[data-drop]');
    if (zone && !zone.contains(event.relatedTarget)) {
      zone.classList.remove('is-drop-target');
    }
  }

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
      } else if (isSeated(S.guests.find(g => String(g.id) === String(guestId)) || {})) {
        await unassignGuest(guestId);
      }
      await reloadGuestsAndRender();
    } catch (err) {
      toast(err.message, 'warn');
    }
  }

  function onKeydown(event) {
    const tab = event.target.closest('.ww-nav__item');
    if (!tab) {
      return;
    }
    const tabs = Array.from(S.dialog.querySelectorAll('.ww-nav__item'));
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

  async function openApp(opener) {
    if (S) {
      return;
    }
    if (!initialised) {
      cachedPlans = await fetchPlans(cachedPlans);
    }
    const plan = pickPlan(cachedPlans);
    const dialog = document.createElement('dialog');
    dialog.className = 'ww-app';
    dialog.setAttribute('aria-labelledby', 'ww-app-title');
    dialog.innerHTML = shellHtml();
    S = {
      dialog,
      opener,
      plan,
      site: null,
      draft: null,
      dirty: false,
      guests: [],
      tables: [],
      tab: 'overview',
      loading: true,
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
      if (S.dirty) {
        const ok = await confirmAction({
          title: 'Discard unsaved changes?',
          message: 'You have changes to your website that have not been saved.',
          confirmLabel: 'Discard changes',
          danger: true,
        });
        if (!ok) {
          return;
        }
      }
      dialog.close();
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      }
    });
    dialog.addEventListener('close', closeApp, { once: true });

    try {
      dialog.showModal();
    } catch {
      dialog.show();
    }
    renderActive();
    dialog.querySelector('.ww-nav__item[aria-selected="true"]')?.focus({ preventScroll: true });

    const state = S;
    try {
      if (plan) {
        const site = await getWebsite(plan);
        state.site = site;
        state.draft = site ? makeDraft(site, plan) : null;
        await loadGuestsAndTables();
      }
    } catch (err) {
      toast(err.message || 'Unable to load your wedding workspace', 'warn');
    }
    if (S !== state) {
      return;
    }
    S.loading = false;
    renderActive();
  }

  function closeApp() {
    const { dialog, opener, plan } = S;
    const finalPlan = S.plan || plan;
    const finalSite = S.site;
    S = null;
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
