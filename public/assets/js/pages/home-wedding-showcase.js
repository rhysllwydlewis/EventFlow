'use strict';

/**
 * Homepage wedding showcase (index.html and home-v2.html): turns the illustrative preview into
 * a small interactive sample. Make the guest website yours (names, date, colours), send a sample
 * RSVP and the guest replies card updates, seat a guest (tap, drag with a mouse, or auto-seat),
 * and Reset puts everything back.
 *
 * Progressive enhancement: the markup in the page is the static illustration (role="img", every
 * card aria-hidden). This script upgrades it in place, so without JavaScript visitors still see the
 * illustration and never meet a control that does nothing. Everything is held in memory: nothing
 * typed or chosen here is saved or sent anywhere.
 *
 * The first part is pure (colour maths, names, dates) and is exported for the unit tests.
 */
(() => {
  // ================================================================ pure helpers
  const MAX_NAME = 14;
  const DEFAULT_NAMES = ['Amelia', 'Oliver'];
  const DEFAULT_DATE = '2027-06-19';
  const VENUE_TOWN = 'Bath';
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  /** The colour presets the real wedding website builder offers, plus the homepage's own plum look. */
  const PRESETS = [
    {
      key: 'plum',
      name: 'Plum',
      accent: '#8D3F6F',
      secondary: '#C98AA9',
      background: '#FFF7FB',
      text: '#2B1B2F',
    },
    {
      key: 'sage',
      name: 'Sage & Blush',
      accent: '#0B8073',
      secondary: '#F4A6C8',
      background: '#FFF7FB',
      text: '#1E1B4B',
    },
    {
      key: 'champagne',
      name: 'Champagne',
      accent: '#B88A2B',
      secondary: '#F4D6A0',
      background: '#FFF9EF',
      text: '#30261C',
    },
    {
      key: 'midnight',
      name: 'Midnight',
      accent: '#24436F',
      secondary: '#BFA2DB',
      background: '#F6F3FF',
      text: '#161B33',
    },
    {
      key: 'terracotta',
      name: 'Terracotta',
      accent: '#B85C38',
      secondary: '#E9A178',
      background: '#FFF4EE',
      text: '#3B2119',
    },
    {
      key: 'coastal',
      name: 'Coastal',
      accent: '#2C94B1',
      secondary: '#9AD7E5',
      background: '#F2FBFE',
      text: '#14313B',
    },
  ];

  const isHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));
  const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const rgbToHex = rgb =>
    `#${rgb
      .map(v =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;

  /** Blend two colours: t = 0 is all `a`, t = 1 is all `b`. */
  function mix(a, b, t) {
    const from = hexToRgb(a);
    const to = hexToRgb(b);
    return rgbToHex(from.map((v, i) => v * (1 - t) + to[i] * t));
  }

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** WCAG contrast ratio between two colours (1 to 21). */
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Darken a colour step by step until it reads on `background`. */
  function darkenUntil(colour, background, minimum) {
    let result = colour;
    for (let i = 0; i < 40 && contrast(result, background) < minimum; i += 1) {
      result = mix(result, '#000000', 0.07);
    }
    return result;
  }

  function hslToHex(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const k = n => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return rgbToHex([f(0), f(8), f(4)].map(v => v * 255));
  }

  function hexToHsl(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) {
        h = ((g - b) / d) % 6;
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h *= 60;
    }
    return [(h + 360) % 360, s, l];
  }

  /**
   * One picked colour becomes a tasteful four-colour palette. Neon and pale picks are pulled into
   * a calm, readable range (greens and yellows a little more, so nothing looks like a highlighter).
   */
  function paletteFromOne(hex) {
    if (!isHex(hex)) {
      return null;
    }
    const [h, s, l] = hexToHsl(hex);
    const cap = h >= 50 && h <= 175 ? 0.46 : 0.58;
    const saturation = Math.min(cap, Math.max(0.28, s));
    const lightness = Math.min(0.44, Math.max(0.28, l));
    return {
      accent: hslToHex(h, saturation, lightness),
      secondary: hslToHex(h + 18, Math.min(0.6, saturation), 0.8),
      background: hslToHex(h, 0.55, 0.97),
      text: hslToHex(h, 0.35, 0.13),
    };
  }

  /** A random pleasing palette. `random` is injectable so tests are deterministic. */
  function shufflePalette(random = Math.random) {
    return paletteFromOne(hslToHex(random() * 360, 0.5 + random() * 0.1, 0.36 + random() * 0.06));
  }

  /**
   * Everything the sample phone paints, worked out from a palette, with the readability checks that
   * guarantee it: every pair below is at least WCAG AA (4.5:1) for any palette this can be given.
   */
  function deriveTheme(palette) {
    const white = '#ffffff';
    const { accent, background, text, secondary } = palette;
    const darkLabel = contrast(text, accent) >= 4.5 ? text : '#000000';
    const onAccent = contrast(white, accent) >= 4.5 ? white : darkLabel;
    const soft = mix(accent, white, 0.88);
    const ink = darkenUntil(darkenUntil(accent, soft, 4.5), background, 4.5);
    let mutedT = 0.42;
    while (mutedT > 0 && contrast(mix(text, background, mutedT), background) < 4.6) {
      mutedT -= 0.03;
    }
    const muted = mix(text, background, Math.max(0, mutedT));
    const heroWhite = contrast(white, accent) >= 4.5;
    const heroInk = heroWhite ? white : text;
    const deep = heroWhite ? mix(accent, '#000000', 0.35) : mix(accent, white, 0.45);
    // white text needs a little headroom over the middle of the gradient, so a borderline accent is deepened there
    const mid = heroWhite ? darkenUntil(accent, white, 5.2) : mix(accent, white, 0.3);
    let light = heroWhite ? mix(accent, secondary, 0.65) : mix(secondary, white, 0.2);
    // the date line sits over the lower part of the gradient: keep that part readable too
    for (let i = 0; i < 12 && contrast(heroInk, mix(mid, light, 0.25)) < 4.6; i += 1) {
      light = mix(light, mid, 0.15);
    }
    const vars = {
      bg: background,
      text,
      muted,
      accent,
      onAccent,
      ink,
      soft,
      border: mix(accent, background, 0.5),
      divider: mix(accent, background, 0.82),
      deep,
      mid,
      light,
      heroInk,
    };
    const checks = {
      buttonLabel: contrast(onAccent, accent),
      bodyText: contrast(text, background),
      mutedText: contrast(muted, background),
      accentTextOnPage: contrast(ink, background),
      accentTextOnTint: contrast(ink, soft),
      accentTextOnWhite: contrast(ink, white),
      heroText: contrast(heroInk, mid),
      heroTextLower: contrast(heroInk, mix(mid, light, 0.25)),
    };
    return { vars, checks, minimum: Math.min(...Object.values(checks)) };
  }

  /** A name as typed: no control characters, tidy spacing, at most MAX_NAME characters. */
  function cleanName(value, fallback) {
    const tidy = Array.from(
      String(value || '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
      .slice(0, MAX_NAME)
      .join('')
      .trim();
    return tidy || fallback;
  }

  /** "A & O" style monogram from two names. */
  function monogram(first, second) {
    const initial = name => (Array.from(name)[0] || '').toUpperCase();
    return `${initial(first)} & ${initial(second)}`;
  }

  /** "Saturday 19 June 2027" from a yyyy-mm-dd string, or null when it is not a sensible date. */
  function formatWeddingDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) {
      return null;
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (year < 2000 || year > 2100) {
      return null;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return `${WEEKDAYS[date.getUTCDay()]} ${day} ${MONTHS[month - 1]} ${year}`;
  }

  const helpers = {
    PRESETS,
    DEFAULT_NAMES,
    DEFAULT_DATE,
    MAX_NAME,
    contrast,
    mix,
    paletteFromOne,
    shufflePalette,
    deriveTheme,
    cleanName,
    monogram,
    formatWeddingDate,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = helpers;
  }
  if (typeof document === 'undefined') {
    return;
  }

  // ================================================================ find the section
  const section = document.querySelector('.hws');
  const stage = section && section.querySelector('.hws__stage');
  const tracker = stage && stage.querySelector('.hws__tracker');
  const phone = stage && stage.querySelector('.hws__phone');
  const seating = stage && stage.querySelector('.hws__seating');
  const rsvpBox = phone && phone.querySelector('.hws__site-rsvp');
  const seatSvg = seating && seating.querySelector('.hws-seatmap');
  const unseatedBox = seating && seating.querySelector('.hws__unseated');
  const dragChip = seating && seating.querySelector('.hws__drag');
  const figure = section && section.querySelector('.hws__visual');
  const frame = figure && figure.querySelector('.hws__frame');
  const donut = tracker && tracker.querySelectorAll('.hws-seg--yes, .hws-seg--no, .hws-seg--wait');
  const counts = tracker && tracker.querySelectorAll('.hws__legend li b');
  const percent = tracker && tracker.querySelector('.hws__donut-label strong');
  const replies = tracker && tracker.querySelector('.hws__replies');
  const seatTotals = seating && seating.querySelector('.hws__card-head span');
  const heroNames = phone && phone.querySelector('.hws__site-hero strong');
  const heroDate = phone && phone.querySelector('.hws__site-hero > span');
  const barMark = phone && phone.querySelector('.hws__site-bar > span');

  if (
    !(
      frame &&
      donut &&
      donut.length === 3 &&
      counts &&
      counts.length === 3 &&
      percent &&
      replies &&
      rsvpBox &&
      seatSvg &&
      unseatedBox &&
      seatTotals &&
      heroNames &&
      heroDate &&
      barMark
    ) ||
    section.classList.contains('hws--live')
  ) {
    return;
  }

  const INVITED = 96;
  const BASE = { yes: 64, no: 14, wait: 18 };
  const CIRCUMFERENCE = 2 * Math.PI * 38;
  const GUESTS = ['Charlotte E.', 'Priya S.', 'Tom H.'];
  const MEALS = ['Beef', 'Salmon', 'Vegetarian'];
  const DEFAULT_OWN_COLOUR = '#2e7d32';
  const SIGN_UP_URL = '/auth?tab=create&role=customer';
  const AUTO_SEAT_STEP_MS = 320;
  const VIEWS = [
    ['website', 'Website'],
    ['replies', 'Guest replies'],
    ['seating', 'Seating plan'],
  ];
  const STEPS = [
    ['make', 'Make it yours', 'Style'],
    ['rsvp', 'Send an RSVP', 'RSVP'],
    ['seat', 'Seat a guest', 'Seat'],
  ];

  /** Build an element with optional class names and text. */
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (text) {
      el.textContent = text;
    }
    return el;
  }

  /** A visually hidden label for assistive technology. */
  function srOnly(text) {
    return node('span', 'hws-sr', text);
  }

  /** Label a control for the site's own, consent-respecting usage counts (clicks only). */
  function measure(el, event, label) {
    el.dataset.analyticsEvent = `wedding_showcase_${event}`;
    if (label) {
      el.dataset.analyticsLabel = label;
    }
  }

  /** Typed text is personal: keep it out of any usage recording. */
  function keepPrivate(input) {
    input.classList.add('ph-no-capture');
    input.dataset.analyticsSensitive = 'true';
    input.autocomplete = 'off';
    input.spellcheck = false;
  }

  function reducedMotion() {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  // ================================================================ state
  let reply = null;
  let meal = '';
  let view = 'website';
  let selected = GUESTS[0];
  const seatedAt = new Map();
  const done = { make: false, rsvp: false, seat: false };
  let autoTimers = [];
  let drag = null;
  let suppressClick = false;

  // ================================================================ upgrade the static markup
  stage.setAttribute('role', 'group');
  stage.setAttribute(
    'aria-label',
    'Interactive sample of the wedding tools. Sample names and numbers.'
  );
  stage.dataset.view = view;
  [tracker, phone, seating].forEach(card => card.removeAttribute('aria-hidden'));

  // The QR card travels with the phone, so it always sits just under it however tall the phone is.
  const qrChip = stage.querySelector('.hws__chip--qr');
  const phoneColumn = node('div', 'hws__phonecol');
  phone.before(phoneColumn);
  phoneColumn.append(phone);
  if (qrChip) {
    phoneColumn.append(qrChip);
  }

  // Guest replies: keep the three sample rows so a new reply can be shown without growing the card.
  const originalReplies = [...replies.children].map(row => row.cloneNode(true));

  // Phone: the RSVP block becomes a real form, and the two "RSVP" pills become buttons.
  const question = rsvpBox.querySelector('small');
  const options = [...rsvpBox.querySelectorAll('span')].map(span => span.textContent.trim());
  const form = node('form', 'hws__site-rsvp');
  form.setAttribute('aria-labelledby', 'hws-reply-question');
  form.noValidate = true;
  const questionLabel = node(
    'small',
    '',
    question ? question.textContent : 'Will you be joining us?'
  );
  questionLabel.id = 'hws-reply-question';
  form.appendChild(questionLabel);
  ['yes', 'no'].forEach((value, index) => {
    const label = node('label', 'hws-reply');
    const input = node('input');
    input.type = 'radio';
    input.name = 'hws-reply';
    input.value = value;
    input.defaultChecked = index === 0;
    input.checked = index === 0;
    label.append(
      input,
      node('span', '', options[index] || (index ? 'Regretfully declining' : 'Joyfully attending'))
    );
    form.appendChild(label);
  });
  // only guests who are coming are asked what they would like to eat
  const meals = node('div', 'hws-meals');
  meals.setAttribute('role', 'group');
  meals.setAttribute('aria-label', 'Meal choice');
  MEALS.forEach(name => {
    const label = node('label', 'hws-meal');
    const input = node('input');
    input.type = 'radio';
    input.name = 'hws-meal';
    input.value = name;
    label.append(input, node('span', '', name));
    meals.appendChild(label);
  });
  form.appendChild(meals);
  const send = node('button', 'hws-send', 'Send RSVP');
  send.type = 'submit';
  measure(send, 'rsvp');
  const sent = node('p', 'hws-rsvp-confirm');
  sent.setAttribute('role', 'status');
  const seeReplies = node('button', 'hws-see-replies', 'See guest replies');
  seeReplies.type = 'button';
  seeReplies.hidden = true;
  form.append(send, sent, seeReplies);
  rsvpBox.replaceWith(form);

  phone.querySelectorAll('.hws__site-bar b, .hws__site-hero b').forEach(pill => {
    const button = node('button', 'hws-phone-link', pill.textContent.trim());
    button.type = 'button';
    button.addEventListener('click', () => {
      const checked = form.querySelector('input[name="hws-reply"]:checked');
      form.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      if (checked) {
        checked.focus({ preventScroll: true });
      }
    });
    pill.replaceWith(button);
  });

  // Seating: group the seats by table, turn the round tables into buttons and the guests into choices.
  const tables = [];
  [...seatSvg.children].forEach(child => {
    if (child.classList.contains('hws-table')) {
      tables.push({ shape: child, seats: [], number: 0, label: '' });
    } else if (child.classList.contains('hws-seat') && tables.length) {
      tables[tables.length - 1].seats.push(child);
    } else if (child.classList.contains('hws-table-label') && tables.length) {
      const table = tables[tables.length - 1];
      table.label = child.textContent.trim();
      table.number = Number(table.label) || 0;
    }
  });
  const ring = seatSvg.querySelector('.hws-drop');
  const ringTable = tables.find(table => table.shape.classList.contains('is-drop'));
  const ringHome = ring && {
    cx: ring.getAttribute('cx'),
    cy: ring.getAttribute('cy'),
    shape: ringTable ? ringTable.shape : null,
  };
  const initialSeats = tables.map(table =>
    table.seats.map(seat => seat.classList.contains('is-taken'))
  );
  seatSvg.removeAttribute('aria-hidden');
  seatSvg.setAttribute('role', 'group');
  seatSvg.setAttribute('aria-label', 'Seating plan');
  if (dragChip) {
    dragChip.setAttribute('aria-hidden', 'true');
  }

  const unseatedLabel = unseatedBox.querySelector('small');
  if (unseatedLabel) {
    unseatedLabel.textContent = 'Guests';
  }
  unseatedBox.querySelectorAll('span').forEach(span => span.remove());
  const guestButtons = GUESTS.map(name => {
    const button = node('button', 'hws-guest', name);
    button.type = 'button';
    button.dataset.guest = name;
    unseatedBox.appendChild(button);
    return button;
  });
  const seatRow = node('div', 'hws-seat-row');
  const status = node('p', 'hws-seat-status');
  status.setAttribute('role', 'status');
  const autoSeatButton = node('button', 'hws-autoseat', 'Auto-seat');
  autoSeatButton.type = 'button';
  autoSeatButton.setAttribute('aria-label', 'Auto-seat all the guests');
  measure(autoSeatButton, 'autoseat');
  seatRow.append(status, autoSeatButton);
  seating.appendChild(seatRow);

  // ================================================================ toolbar: steps, tabs, Reset
  const toolbar = node('div', 'hws-playbar');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Explore the wedding preview');
  const viewButtons = VIEWS.map(([key, text]) => {
    const button = node('button', 'hws-view', text);
    button.type = 'button';
    button.dataset.view = key;
    measure(button, 'tab', key);
    toolbar.appendChild(button);
    return button;
  });
  const steps = node('ol', 'hws-steps');
  steps.setAttribute('aria-label', 'Try it in three steps');
  const stepButtons = STEPS.map(([key, text, short], index) => {
    const item = node('li');
    const button = node('button', 'hws-step');
    button.type = 'button';
    button.dataset.step = key;
    measure(button, 'step', key);
    button.append(
      node('span', 'hws-step__n', String(index + 1)),
      node('span', 'hws-step__full', text),
      node('span', 'hws-step__short', short),
      srOnly('')
    );
    item.appendChild(button);
    steps.appendChild(item);
    return button;
  });
  toolbar.appendChild(steps);
  const reset = node('button', 'hws-reset', 'Reset');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Reset the sample');
  measure(reset, 'reset');
  toolbar.appendChild(reset);

  // ================================================================ make it yours
  const make = node('div', 'hws-make');
  make.setAttribute('role', 'group');
  make.setAttribute('aria-label', 'Make the sample yours');

  const names = node('div', 'hws-make__names');
  const nameInputs = DEFAULT_NAMES.map((placeholder, index) => {
    const input = node('input', 'hws-input hws-input--name');
    input.type = 'text';
    input.maxLength = MAX_NAME;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', index ? 'Second name' : 'First name');
    keepPrivate(input);
    return input;
  });
  const dateInput = node('input', 'hws-input hws-input--date');
  dateInput.type = 'date';
  dateInput.min = '2025-01-01';
  dateInput.max = '2035-12-31';
  dateInput.value = DEFAULT_DATE;
  dateInput.setAttribute('aria-label', 'Wedding date');
  keepPrivate(dateInput);
  names.append(nameInputs[0], node('span', 'hws-make__and', '&'), nameInputs[1], dateInput);

  const colours = node('div', 'hws-make__colours');
  colours.setAttribute('role', 'group');
  colours.setAttribute('aria-label', 'Website colours');
  const dots = PRESETS.map((preset, index) => {
    const label = node('label', 'hws-dot');
    const input = node('input');
    input.type = 'radio';
    input.name = 'hws-colour';
    input.value = preset.key;
    input.defaultChecked = index === 0;
    input.checked = index === 0;
    const face = node('span', 'hws-dot__face');
    face.style.setProperty('--dot-a', preset.accent);
    face.style.setProperty('--dot-b', preset.secondary);
    label.append(input, face, srOnly(preset.name));
    colours.appendChild(label);
    return input;
  });
  // the browser's colour picker, invisible and laid over a styled circle (a rainbow until one is picked)
  const ownLabel = node('label', 'hws-dot hws-dot--own');
  const ownInput = node('input', 'hws-own');
  ownInput.type = 'color';
  ownInput.value = DEFAULT_OWN_COLOUR;
  ownInput.setAttribute('aria-label', 'Pick your own colour');
  keepPrivate(ownInput);
  ownLabel.append(ownInput, node('span', 'hws-dot__face hws-dot__face--own'));
  const shuffleButton = node('button', 'hws-shuffle');
  shuffleButton.type = 'button';
  shuffleButton.setAttribute('aria-label', 'Surprise me with a random colour');
  shuffleButton.title = 'Surprise me';
  measure(shuffleButton, 'shuffle');
  const shuffleIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  shuffleIcon.setAttribute('viewBox', '0 0 24 24');
  shuffleIcon.setAttribute('aria-hidden', 'true');
  shuffleIcon.setAttribute('focusable', 'false');
  [
    'M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22',
    'm18 2 4 4-4 4',
    'M2 6h1.9c1.5 0 2.9.9 3.6 2.2',
    'M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8',
    'm18 14 4 4-4 4',
  ].forEach(d => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    shuffleIcon.appendChild(path);
  });
  shuffleButton.appendChild(shuffleIcon);
  colours.append(ownLabel, shuffleButton);

  const makeToggle = node('button', 'hws-make__toggle', 'Names & date');
  makeToggle.type = 'button';
  makeToggle.setAttribute('aria-expanded', 'false');
  const makeStatus = node('p', 'hws-sr');
  makeStatus.setAttribute('role', 'status');
  make.append(names, colours, makeToggle, makeStatus);

  // the call to action appears once the main flow has been tried
  const finish = node('div', 'hws-finish');
  finish.hidden = true;
  const finishLink = node('a', 'hws-finish__link', 'Create your free wedding website');
  finishLink.href = SIGN_UP_URL;
  measure(finishLink, 'cta');
  finish.append(node('p', '', 'That is the whole flow, and nothing here was saved.'), finishLink);

  frame.before(toolbar, make);
  frame.after(finish);

  const caption = figure.querySelector('figcaption');
  if (caption) {
    caption.append(document.createTextNode(' Nothing you try here is saved.'));
  }

  // ================================================================ rendering
  /** Show the chosen panel on narrow screens, where the three cards cannot sit side by side. */
  function renderView() {
    stage.dataset.view = view;
    figure.dataset.view = view;
    viewButtons.forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.view === view))
    );
  }

  /** Tick the steps that have been tried, and show the call to action after RSVP and seating. */
  function renderSteps() {
    stepButtons.forEach(button => {
      const key = button.dataset.step;
      const item = button.parentElement;
      item.classList.toggle('is-done', done[key]);
      button.firstChild.textContent = done[key]
        ? '✓'
        : String(STEPS.findIndex(s => s[0] === key) + 1);
      button.lastChild.textContent = done[key] ? ' (done)' : '';
    });
    finish.hidden = !(done.rsvp && done.seat);
  }

  /** Put the typed names and chosen date on the phone, falling back to the sample when empty. */
  function renderIdentity() {
    const first = cleanName(nameInputs[0].value, DEFAULT_NAMES[0]);
    const second = cleanName(nameInputs[1].value, DEFAULT_NAMES[1]);
    heroNames.textContent = `${first} & ${second}`;
    barMark.textContent = monogram(first, second);
    const when = formatWeddingDate(dateInput.value) || formatWeddingDate(DEFAULT_DATE);
    heroDate.textContent = `${when} · ${VENUE_TOWN}`;
  }

  /** Paint the phone with a palette, or put the original plum look back when given nothing. */
  function applyPalette(palette) {
    const theme = palette ? deriveTheme(palette) : null;
    const properties = [
      ['bg', '--hp-bg'],
      ['text', '--hp-text'],
      ['muted', '--hp-muted'],
      ['accent', '--hp-accent'],
      ['onAccent', '--hp-on-accent'],
      ['ink', '--hp-ink'],
      ['soft', '--hp-soft'],
      ['border', '--hp-border'],
      ['divider', '--hp-divider'],
      ['deep', '--hp-deep'],
      ['mid', '--hp-mid'],
      ['light', '--hp-light'],
      ['heroInk', '--hp-hero-ink'],
    ];
    properties.forEach(([key, property]) => {
      if (theme) {
        stage.style.setProperty(property, theme.vars[key]);
      } else {
        stage.style.removeProperty(property);
      }
    });
  }

  function markOwnColour(active, hex) {
    ownLabel.classList.toggle('is-active', active);
    if (active) {
      ownLabel.style.setProperty('--own', hex);
    } else {
      ownLabel.style.removeProperty('--own');
    }
  }

  /** Recalculate the donut, the counts and the reply list; `animate` briefly marks what changed. */
  function renderReplies(animate) {
    const yes = BASE.yes + (reply === 'yes' ? 1 : 0);
    const no = BASE.no + (reply === 'no' ? 1 : 0);
    const wait = BASE.wait - (reply ? 1 : 0);
    [yes, no, wait].forEach((value, index) => {
      const changed = animate && counts[index].textContent !== String(value);
      counts[index].textContent = String(value);
      counts[index].classList.remove('is-changed');
      if (changed) {
        void counts[index].offsetWidth;
        counts[index].classList.add('is-changed');
      }
    });
    percent.textContent = `${Math.round(((yes + no) / INVITED) * 100)}%`;
    let offset = 0;
    [yes, no, wait].forEach((value, index) => {
      const length = (value / INVITED) * CIRCUMFERENCE;
      donut[index].setAttribute(
        'stroke-dasharray',
        `${length.toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}`
      );
      donut[index].setAttribute('stroke-dashoffset', String((-offset).toFixed(1)));
      offset += length;
    });
    const rows = originalReplies.map(row => row.cloneNode(true));
    if (reply) {
      const row = node('li', 'hws-new-reply');
      row.dataset.reply = reply;
      const detail = node('div');
      detail.append(node('strong', '', 'Your sample reply'), node('span', '', 'Party of 1'));
      row.append(
        node('span', 'hws__avatar hws__avatar--you', 'You'),
        detail,
        node('em', '', reply === 'no' ? 'Declined' : meal || 'Attending')
      );
      rows.unshift(row);
    }
    replies.replaceChildren(...rows.slice(0, 3));
  }

  /** Seats still free at one table. */
  function freeSeats(table) {
    return table.seats.filter(seat => !seat.classList.contains('is-taken')).length;
  }

  /** Keep the chip, the guest buttons, the table buttons and the totals in step with the seating. */
  function renderSeating() {
    const free = tables.reduce((total, table) => total + freeSeats(table), 0);
    seatTotals.textContent = `${tables.length} tables · ${tables.reduce(
      (total, table) => total + table.seats.length,
      0
    )} seats · ${free} free`;
    guestButtons.forEach(button => {
      const name = button.dataset.guest;
      const table = seatedAt.get(name);
      button.setAttribute('aria-pressed', String(name === selected));
      button.setAttribute('aria-disabled', String(Boolean(table)));
      button.classList.toggle('is-seated', Boolean(table));
      if (table) {
        button.setAttribute('aria-label', `${name}, seated at table ${table}`);
      } else {
        button.removeAttribute('aria-label');
      }
    });
    if (dragChip) {
      // the chip only hints at the first move; once guests are being seated the guest buttons say who is next
      dragChip.hidden = !selected || seatedAt.size > 0;
      if (selected && dragChip.lastChild) {
        dragChip.lastChild.textContent = selected;
      }
    }
    tables.forEach(table => {
      if (table.shape.getAttribute('role') !== 'button') {
        return;
      }
      const left = freeSeats(table);
      const full = left === 0;
      table.shape.setAttribute('aria-disabled', String(full || !selected));
      table.shape.setAttribute(
        'aria-label',
        full
          ? `Table ${table.number}, full`
          : `Table ${table.number}, ${left} seat${left === 1 ? '' : 's'} free${
              selected ? `. Seat ${selected} here.` : ''
            }`
      );
      table.shape.classList.toggle('is-open', !full && Boolean(selected));
    });
    autoSeatButton.setAttribute('aria-disabled', String(seatedAt.size === GUESTS.length));
  }

  /** Put the dashed ring round the table that was last chosen (or back at table 2 on reset). */
  function moveRing(table) {
    const target = table || ringHome;
    if (!ring || !target) {
      return;
    }
    ring.setAttribute('cx', table ? table.shape.getAttribute('cx') : target.cx);
    ring.setAttribute('cy', table ? table.shape.getAttribute('cy') : target.cy);
    tables.forEach(candidate => {
      candidate.shape.classList.toggle('is-drop', Boolean(target.shape) && candidate === table);
    });
    if (!table && ringHome.shape) {
      ringHome.shape.classList.add('is-drop');
    }
  }

  // ================================================================ behaviour
  function say(message) {
    status.textContent = message;
  }

  function sayColour(message) {
    makeStatus.textContent = message;
  }

  /** Choose which sample guest the next table tap will seat. */
  function chooseGuest(name) {
    if (seatedAt.has(name)) {
      say(`${name} is already at Table ${seatedAt.get(name)}.`);
      return;
    }
    selected = name;
    renderSeating();
    say(`${name} selected. Tap a table with free seats.`);
  }

  /** Seat the selected guest at a table, if it has room. Returns whether someone was seated. */
  function seatAt(table) {
    if (!selected) {
      say('Everyone is seated. Choose Reset to try again.');
      return false;
    }
    if (freeSeats(table) === 0) {
      say(`Table ${table.number} is full. Try another table.`);
      return false;
    }
    const seat = table.seats.find(candidate => !candidate.classList.contains('is-taken'));
    seat.classList.add('is-taken', 'is-new');
    seatedAt.set(selected, table.number);
    moveRing(table);
    const name = selected;
    selected = GUESTS.find(guest => !seatedAt.has(guest)) || null;
    done.seat = true;
    renderSeating();
    renderSteps();
    const remaining = GUESTS.length - seatedAt.size;
    say(
      `${name} is now at Table ${table.number}. ${
        remaining
          ? `${remaining} sample guest${remaining === 1 ? '' : 's'} left to seat.`
          : 'Everyone is seated.'
      }`
    );
    return true;
  }

  function cancelAutoSeat() {
    autoTimers.forEach(timer => clearTimeout(timer));
    autoTimers = [];
  }

  /** Seat everyone who is left, one by one (all at once for visitors who prefer less motion). */
  function autoSeat() {
    if (autoTimers.length) {
      return;
    }
    const waiting = GUESTS.filter(name => !seatedAt.has(name));
    if (!waiting.length) {
      say('Everyone is seated. Choose Reset to try again.');
      return;
    }
    const seatNext = name => {
      const table = tables.find(
        candidate => candidate.shape.getAttribute('role') === 'button' && freeSeats(candidate) > 0
      );
      if (table) {
        selected = name;
        seatAt(table);
      }
    };
    if (reducedMotion()) {
      waiting.forEach(seatNext);
      return;
    }
    waiting.forEach((name, index) => {
      autoTimers.push(
        setTimeout(() => {
          seatNext(name);
          if (index === waiting.length - 1) {
            autoTimers = [];
          }
        }, index * AUTO_SEAT_STEP_MS)
      );
    });
  }

  // Round tables with a number become buttons; full tables stay in the plan but say they are full.
  tables.forEach(table => {
    if (!table.number || table.shape.tagName.toLowerCase() !== 'circle') {
      return;
    }
    const shape = table.shape;
    shape.setAttribute('role', 'button');
    shape.setAttribute('tabindex', '0');
    measure(shape, 'seat');
    shape.addEventListener('click', () => seatAt(table));
    shape.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        seatAt(table);
      }
    });
  });

  guestButtons.forEach(button =>
    button.addEventListener('click', () => {
      if (suppressClick) {
        return;
      }
      chooseGuest(button.dataset.guest);
    })
  );
  autoSeatButton.addEventListener('click', autoSeat);

  // Dragging a guest onto a table is for mouse and pen only: on touch screens it would fight with
  // scrolling, and tap-a-guest-then-tap-a-table works better there.
  function tableUnder(event) {
    if (typeof document.elementFromPoint !== 'function') {
      return null;
    }
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const shape = el && el.closest ? el.closest('.hws-table[role="button"]') : null;
    const table = shape && tables.find(candidate => candidate.shape === shape);
    return table && freeSeats(table) > 0 ? table : null;
  }

  function stopDrag() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', stopDrag);
    document.removeEventListener('keydown', onDragKey);
    if (drag && drag.ghost) {
      drag.ghost.remove();
    }
    section.classList.remove('is-dragging');
    tables.forEach(table => table.shape.classList.remove('is-over'));
    drag = null;
  }

  function onDragKey(event) {
    if (event.key === 'Escape') {
      stopDrag();
    }
  }

  function onDragMove(event) {
    if (!drag) {
      return;
    }
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) {
        return;
      }
      drag.active = true;
      chooseGuest(drag.name);
      drag.ghost = node('div', 'hws-ghost', drag.name);
      drag.ghost.setAttribute('aria-hidden', 'true');
      // the ghost wears the website's colours, like the hint chip it came from
      const look = window.getComputedStyle(stage);
      drag.ghost.style.setProperty('background', look.getPropertyValue('--hp-accent'));
      drag.ghost.style.setProperty('color', look.getPropertyValue('--hp-on-accent'));
      section.appendChild(drag.ghost);
      section.classList.add('is-dragging');
    }
    drag.ghost.style.setProperty('left', `${event.clientX + 12}px`);
    drag.ghost.style.setProperty('top', `${event.clientY + 12}px`);
    const over = tableUnder(event);
    tables.forEach(table => table.shape.classList.toggle('is-over', table === over));
  }

  function onDragEnd(event) {
    const wasActive = drag && drag.active;
    const table = wasActive ? tableUnder(event) : null;
    stopDrag();
    if (wasActive) {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
      if (table) {
        seatAt(table);
      }
    }
  }

  guestButtons.forEach(button =>
    button.addEventListener('pointerdown', event => {
      const name = button.dataset.guest;
      if (event.pointerType === 'touch' || event.button !== 0 || seatedAt.has(name)) {
        return;
      }
      stopDrag();
      drag = { name, x: event.clientX, y: event.clientY, active: false, ghost: null };
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragEnd);
      document.addEventListener('pointercancel', stopDrag);
      document.addEventListener('keydown', onDragKey);
    })
  );

  viewButtons.forEach(button =>
    button.addEventListener('click', () => {
      view = button.dataset.view;
      renderView();
    })
  );
  seeReplies.addEventListener('click', () => {
    view = 'replies';
    renderView();
  });

  // RSVP: attending guests are asked about meals, those declining are not
  form.addEventListener('change', event => {
    if (event.target && event.target.name === 'hws-reply') {
      meals.hidden = event.target.value === 'no';
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const chosen = form.querySelector('input[name="hws-reply"]:checked');
    const choice = form.querySelector('input[name="hws-meal"]:checked');
    reply = chosen ? chosen.value : 'yes';
    meal = reply === 'yes' && choice ? choice.value : '';
    renderReplies(true);
    send.textContent = 'Update RSVP';
    sent.textContent = 'Sample RSVP sent. The guest replies have updated.';
    seeReplies.hidden = false;
    done.rsvp = true;
    renderSteps();
  });

  // Make it yours
  function customised() {
    if (!done.make) {
      done.make = true;
      renderSteps();
    }
  }

  nameInputs.forEach(input =>
    input.addEventListener('input', () => {
      renderIdentity();
      customised();
    })
  );
  dateInput.addEventListener('input', () => {
    renderIdentity();
    customised();
  });

  dots.forEach((input, index) =>
    input.addEventListener('change', () => {
      const preset = PRESETS[index];
      applyPalette(index === 0 ? null : preset);
      markOwnColour(false);
      sayColour(`Colours: ${preset.name}.`);
      customised();
    })
  );
  ownInput.addEventListener('input', () => {
    const palette = paletteFromOne(ownInput.value);
    if (!palette) {
      return;
    }
    dots.forEach(input => {
      input.checked = false;
    });
    applyPalette(palette);
    // the dot shows the colour the phone actually uses, which may be a calmer version of the pick
    markOwnColour(true, palette.accent);
    sayColour('Colours: your own colour.');
    customised();
  });
  shuffleButton.addEventListener('click', () => {
    const palette = shufflePalette();
    dots.forEach(input => {
      input.checked = false;
    });
    applyPalette(palette);
    markOwnColour(true, palette.accent);
    sayColour('Colours: a surprise.');
    customised();
  });
  makeToggle.addEventListener('click', () => {
    const open = !make.classList.contains('is-open');
    make.classList.toggle('is-open', open);
    makeToggle.setAttribute('aria-expanded', String(open));
  });

  // The steps are shortcuts to the part of the sample they describe
  stepButtons.forEach(button =>
    button.addEventListener('click', () => {
      const key = button.dataset.step;
      view = key === 'seat' ? 'seating' : 'website';
      renderView();
      const target =
        key === 'make'
          ? nameInputs[0]
          : key === 'rsvp'
            ? form.querySelector('input[name="hws-reply"]:checked')
            : guestButtons.find(guest => guest.getAttribute('aria-pressed') === 'true') ||
              guestButtons[0];
      if (target) {
        target.focus();
      }
    })
  );

  reset.addEventListener('click', () => {
    cancelAutoSeat();
    stopDrag();
    reply = null;
    meal = '';
    selected = GUESTS[0];
    seatedAt.clear();
    tables.forEach((table, tableIndex) =>
      table.seats.forEach((seat, seatIndex) => {
        seat.classList.toggle('is-taken', initialSeats[tableIndex][seatIndex]);
        seat.classList.remove('is-new');
      })
    );
    moveRing(null);
    form.reset();
    form.querySelector('input[value="yes"]').checked = true;
    meals.hidden = false;
    send.textContent = 'Send RSVP';
    sent.textContent = '';
    seeReplies.hidden = true;
    nameInputs.forEach(input => {
      input.value = '';
    });
    dateInput.value = DEFAULT_DATE;
    ownInput.value = DEFAULT_OWN_COLOUR;
    dots.forEach((input, index) => {
      input.checked = index === 0;
    });
    applyPalette(null);
    markOwnColour(false);
    renderIdentity();
    done.make = false;
    done.rsvp = false;
    done.seat = false;
    view = 'website';
    renderReplies();
    renderSeating();
    renderSteps();
    renderView();
    say('Sample reset.');
    sayColour('');
  });

  renderIdentity();
  renderView();
  renderSeating();
  renderSteps();
  say('Tap a guest, then a table with free seats.');
  section.classList.add('hws--live');
})();
