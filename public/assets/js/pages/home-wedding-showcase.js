'use strict';

/**
 * Homepage wedding showcase (index.html and home-v2.html): turns the illustrative preview into
 * a small interactive sample. Try a few colours on the guest website, send a sample RSVP and the
 * guest replies card updates, seat a guest (tap, drag with a mouse, or auto-seat), and Reset puts
 * everything back.
 *
 * Progressive enhancement: the markup in the page is the static illustration (role="img", every
 * card aria-hidden). This script upgrades it in place, so without JavaScript visitors still see the
 * illustration and never meet a control that does nothing. Everything is held in memory: nothing
 * typed or chosen here is saved or sent anywhere.
 *
 * The first part is pure (colour maths) and is exported for the unit tests.
 */
(() => {
  // ================================================================ pure helpers
  /** A few of the colour presets the real wedding website builder offers, plus the homepage's own plum look. */
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
      key: 'gold',
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
  ];

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

  const helpers = { PRESETS, contrast, mix, deriveTheme };
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
      seatTotals
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
  const SIGN_UP_URL = '/auth?tab=create&role=customer';
  const AUTO_SEAT_STEP_MS = 320;
  const VIEWS = [
    ['website', 'Website'],
    ['replies', 'Guest replies'],
    ['seating', 'Seating plan'],
  ];
  const STEPS = [
    ['colour', 'Pick a colour', 'Colour'],
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
  const done = { colour: false, rsvp: false, seat: false };
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

  // The phone, its colour selector and the QR card form one column, so they keep their spacing
  // however tall the phone grows (it gets taller when the RSVP message or the meal choices appear).
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

  // ================================================================ colour selector
  // A handful of colours to show what the guest website can look like. It lives in the phone's
  // column, between the phone and the QR card.
  const colourBar = node('div', 'hws-colours');
  colourBar.setAttribute('role', 'group');
  colourBar.setAttribute('aria-label', 'Website colour');
  colourBar.appendChild(node('span', 'hws-colours__label', 'Colour'));
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
    colourBar.appendChild(label);
    return input;
  });
  const colourStatus = node('p', 'hws-sr');
  colourStatus.setAttribute('role', 'status');
  colourBar.appendChild(colourStatus);
  phone.after(colourBar);

  // the call to action appears once the main flow has been tried
  const finish = node('div', 'hws-finish');
  finish.hidden = true;
  const finishLink = node('a', 'hws-finish__link', 'Create your free wedding website');
  finishLink.href = SIGN_UP_URL;
  measure(finishLink, 'cta');
  finish.append(node('p', '', 'That is the whole flow, and nothing here was saved.'), finishLink);

  frame.before(toolbar);
  frame.after(finish);

  const caption = figure.querySelector('figcaption');
  if (caption) {
    caption.append(document.createTextNode(' Nothing you try here is saved.'));
  }

  // ================================================================ rendering
  /** Show the chosen panel on narrow screens, where the three cards cannot sit side by side. */
  function renderView() {
    stage.dataset.view = view;
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
    colourStatus.textContent = message;
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

  // Colours: Plum is the original look (the stylesheet's defaults); the rest repaint the phone
  dots.forEach((input, index) =>
    input.addEventListener('change', () => {
      const preset = PRESETS[index];
      applyPalette(index === 0 ? null : preset);
      sayColour(`Colour: ${preset.name}.`);
      if (!done.colour) {
        done.colour = true;
        renderSteps();
      }
    })
  );

  // The steps are shortcuts to the part of the sample they describe
  stepButtons.forEach(button =>
    button.addEventListener('click', () => {
      const key = button.dataset.step;
      view = key === 'seat' ? 'seating' : 'website';
      renderView();
      const target =
        key === 'colour'
          ? dots.find(dot => dot.checked)
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
    dots.forEach((input, index) => {
      input.checked = index === 0;
    });
    applyPalette(null);
    done.colour = false;
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

  renderView();
  renderSeating();
  renderSteps();
  say('Tap a guest, then a table with free seats.');
  section.classList.add('hws--live');
})();
