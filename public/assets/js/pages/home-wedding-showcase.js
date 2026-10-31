'use strict';

/**
 * Homepage wedding showcase (index.html and home-v2.html): turns the preview into something you can
 * use. Pick a colour and the whole section, including the guest website on the phone, changes tone;
 * send an RSVP and the guest replies card updates; seat a guest (tap, drag with a mouse, or
 * auto-seat); Reset puts everything back.
 *
 * Progressive enhancement: the markup in the page is the static illustration (role="img", every
 * card aria-hidden). This script upgrades it in place, so without JavaScript visitors still see the
 * illustration and never meet a control that does nothing. Everything is held in memory.
 *
 * The first part is pure (colour maths) and is exported for the unit tests.
 */
(() => {
  // ================================================================ pure helpers
  /** The colours on offer: four pastels and a light brown. */
  const LOOKS = [
    { key: 'rose', name: 'Rose', pastel: '#F2C4D0' },
    { key: 'sage', name: 'Sage', pastel: '#BFDDC6' },
    { key: 'sky', name: 'Sky', pastel: '#BCD9EE' },
    { key: 'lilac', name: 'Lilac', pastel: '#D5CCEC' },
    { key: 'latte', name: 'Latte', pastel: '#D2B08C' },
  ];
  const WHITE = '#ffffff';
  const BODY_INK = '#17202f';
  const BODY_MUTED = '#566176';

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

  function hueOf(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (!d) {
      return 0;
    }
    let h;
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    return (h * 60 + 360) % 360;
  }

  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Everything the guest website on the phone paints, worked out from a palette, with the readability checks that
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

  /** A deeper tone of the pastel's hue that reads on white and on the section's tints. */
  function inkOf(pastel) {
    const hue = hueOf(pastel);
    const tint = mix(pastel, WHITE, 0.7);
    for (let l = 0.5; l > 0.12; l -= 0.01) {
      const candidate = hslToHex(hue, 0.4, l);
      if (contrast(candidate, WHITE) >= 5 && contrast(candidate, tint) >= 4.7) {
        return candidate;
      }
    }
    return hslToHex(hue, 0.4, 0.12);
  }

  /**
   * One pastel becomes a whole look: matching tones for the section (its washes, buttons, links,
   * icons, charts and shadows) and a palette for the guest website on the phone. Every pairing of
   * text and background is checked, so any pastel passed in stays readable.
   */
  function buildLook(pastel) {
    const hue = hueOf(pastel);
    const ink = inkOf(pastel);
    const deep = darkenUntil(mix(ink, '#000000', 0.22), WHITE, 7);
    const tint = amount => mix(pastel, WHITE, amount);
    const section = {
      '--hws-teal': ink,
      '--hws-teal-deep': deep,
      '--hws-teal-bright': mix(pastel, ink, 0.55),
      '--hws-mint': tint(0.7),
      '--hws-line': rgba(ink, 0.14),
      '--hws-plum': ink,
      '--hws-band': tint(0.8),
      '--hws-arc-a': tint(0.5),
      '--hws-arc-b': tint(0.68),
      '--hws-arc-c': tint(0.82),
      '--hws-wash-a': rgba(tint(0.35), 0.9),
      '--hws-wash-b': rgba(tint(0.55), 0.95),
      '--hws-wash-c': tint(0.9),
      '--hws-wash-d': tint(0.8),
      '--hws-soft-1': tint(0.88),
      '--hws-soft-2': tint(0.8),
      '--hws-soft-3': tint(0.72),
      '--hws-soft-4': tint(0.55),
      '--hws-soft-5': tint(0.5),
      '--hws-soft-6': tint(0.62),
      '--hws-glow': rgba(ink, 0.28),
      '--hws-glow-2': rgba(ink, 0.35),
      '--hws-shadow-c': deep,
    };
    const phone = deriveTheme({
      accent: ink,
      secondary: pastel,
      background: tint(0.9),
      text: hslToHex(hue, 0.35, 0.14),
    });
    const checks = {
      ...phone.checks,
      buttonLabel: contrast(WHITE, ink),
      linkOnSection: contrast(ink, section['--hws-wash-d']),
      linkOnTint: contrast(ink, section['--hws-mint']),
      deepOnTint: contrast(deep, section['--hws-mint']),
      deepOnAvatar: contrast(deep, section['--hws-soft-5']),
      deepOnSoft: contrast(deep, section['--hws-soft-3']),
      bodyOnSection: contrast(BODY_INK, section['--hws-wash-d']),
      mutedOnSection: contrast(BODY_MUTED, section['--hws-wash-d']),
      mutedOnChips: contrast(BODY_MUTED, section['--hws-soft-1']),
    };
    return { section, phone: phone.vars, checks, minimum: Math.min(...Object.values(checks)) };
  }

  const helpers = { LOOKS, contrast, mix, deriveTheme, buildLook };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = helpers;
  }
  if (typeof document === 'undefined') {
    return;
  }

  const host = document.querySelector('.hws');
  if (!host) {
    return;
  }

  const upgrade = () => {
    // ================================================================ find the section
    const section = host;
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
    const donut =
      tracker && tracker.querySelectorAll('.hws-seg--yes, .hws-seg--no, .hws-seg--wait');
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
    const SECTION_PROPERTIES = Object.keys(buildLook(LOOKS[0].pastel).section);
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
      'Interactive wedding tools: a guest website on a phone, an RSVP tracker and a seating plan.'
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

    // Guest replies: keep the three original rows so a new reply can be shown without growing the card.
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
    measure(reset, 'reset');
    toolbar.appendChild(reset);

    // ================================================================ colour selector
    // A handful of colours to show what the guest website can look like. It lives in the phone's
    // column, between the phone and the QR card.
    const colourBar = node('div', 'hws-colours');
    colourBar.setAttribute('role', 'group');
    colourBar.setAttribute('aria-label', 'Website colour');
    colourBar.appendChild(node('span', 'hws-colours__label', 'Colour'));
    const dots = LOOKS.map(look => {
      const label = node('label', 'hws-dot');
      const input = node('input');
      input.type = 'radio';
      input.name = 'hws-colour';
      input.value = look.key;
      const face = node('span', 'hws-dot__face');
      face.style.setProperty('--dot', look.pastel);
      label.append(input, face, srOnly(look.name));
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
    finish.appendChild(finishLink);

    frame.before(toolbar);
    frame.after(finish);

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

    /** Paint the whole section and the phone in a look, or put the original colours back. */
    function applyLook(look) {
      const built = look ? buildLook(look.pastel) : null;
      const phoneProperties = [
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
      phoneProperties.forEach(([key, property]) => {
        if (built) {
          stage.style.setProperty(property, built.phone[key]);
        } else {
          stage.style.removeProperty(property);
        }
      });
      SECTION_PROPERTIES.forEach(property => {
        if (built) {
          section.style.setProperty(property, built.section[property]);
        } else {
          section.style.removeProperty(property);
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
        detail.append(node('strong', '', 'Your reply'), node('span', '', 'Party of 1'));
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

    /** Choose which guest the next table tap will seat. */
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
            ? `${remaining} guest${remaining === 1 ? '' : 's'} left to seat.`
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
      sent.textContent = 'RSVP sent. The guest replies have updated.';
      seeReplies.hidden = false;
      done.rsvp = true;
      renderSteps();
    });

    // Colours: each one repaints the whole section and the phone; Reset puts the original look back
    dots.forEach((input, index) =>
      input.addEventListener('change', () => {
        const look = LOOKS[index];
        applyLook(look);
        sayColour(`Colour: ${look.name}.`);
        if (!done.colour) {
          done.colour = true;
          renderSteps();
        }
      })
    );

    // The steps are shortcuts to the part of the page they describe
    stepButtons.forEach(button =>
      button.addEventListener('click', () => {
        const key = button.dataset.step;
        view = key === 'seat' ? 'seating' : 'website';
        renderView();
        const target =
          key === 'colour'
            ? dots.find(dot => dot.checked) || dots[0]
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
      dots.forEach(input => {
        input.checked = false;
      });
      applyLook(null);
      done.colour = false;
      done.rsvp = false;
      done.seat = false;
      view = 'website';
      renderReplies();
      renderSeating();
      renderSteps();
      renderView();
      say('Reset.');
      sayColour('');
    });

    renderView();
    renderSeating();
    renderSteps();
    say('Tap a guest, then a table with free seats.');
    section.classList.add('hws--live');
  };

  // The section sits well below the first screen, so the page does not pay for building it until a
  // visitor is about to reach it. Without IntersectionObserver it is built straight away.
  if (typeof window.IntersectionObserver === 'function') {
    const watcher = new window.IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          watcher.disconnect();
          upgrade();
        }
      },
      { rootMargin: '600px 0px' }
    );
    watcher.observe(host);
  } else {
    upgrade();
  }
})();
