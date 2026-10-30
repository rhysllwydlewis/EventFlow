'use strict';

/**
 * Homepage wedding showcase (index.html and home-v2.html): turns the illustrative preview into
 * a small interactive sample. Send a sample RSVP and the guest replies card updates; tap a guest,
 * then a table, to seat them; Reset puts everything back.
 *
 * Progressive enhancement: the markup in the page is the static illustration (role="img", every
 * card aria-hidden). This script upgrades it in place, so without JavaScript visitors still see the
 * illustration and never meet a control that does nothing. Everything is held in memory and nothing
 * is saved or sent.
 */
(() => {
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
  const VIEWS = [
    ['website', 'Website'],
    ['replies', 'Guest replies'],
    ['seating', 'Seating plan'],
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

  // ---------------------------------------------------------------- state
  let reply = null;
  let view = 'website';
  let selected = GUESTS[0];
  const seatedAt = new Map();

  // ---------------------------------------------------------------- upgrade the static markup
  stage.setAttribute('role', 'group');
  stage.setAttribute(
    'aria-label',
    'Interactive sample of the wedding tools. Sample names and numbers.'
  );
  stage.dataset.view = view;
  [tracker, phone, seating].forEach(card => card.removeAttribute('aria-hidden'));

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
  const send = node('button', 'hws-send', 'Send RSVP');
  send.type = 'submit';
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
      const checked = form.querySelector('input:checked');
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
  const status = node('p', 'hws-seat-status');
  status.setAttribute('role', 'status');
  seating.appendChild(status);

  // ---------------------------------------------------------------- toolbar
  const toolbar = node('div', 'hws-playbar');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Explore the wedding preview');
  toolbar.appendChild(node('p', 'hws-hint', 'Try it: send an RSVP, then seat a guest.'));
  const viewButtons = VIEWS.map(([key, text]) => {
    const button = node('button', 'hws-view', text);
    button.type = 'button';
    button.dataset.view = key;
    toolbar.appendChild(button);
    return button;
  });
  const reset = node('button', 'hws-reset', 'Reset');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Reset the sample');
  toolbar.appendChild(reset);
  frame.before(toolbar);

  const caption = figure.querySelector('figcaption');
  if (caption) {
    caption.append(document.createTextNode(' Nothing you try here is saved.'));
  }

  // ---------------------------------------------------------------- rendering
  /** Show the chosen panel on narrow screens, where the three cards cannot sit side by side. */
  function renderView() {
    stage.dataset.view = view;
    viewButtons.forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.view === view))
    );
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
        node('em', '', reply === 'yes' ? 'Attending' : 'Declined')
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

  // ---------------------------------------------------------------- behaviour
  function say(message) {
    status.textContent = message;
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

  /** Seat the selected guest at a table, if it has room. */
  function seatAt(table) {
    if (!selected) {
      say('Everyone is seated. Choose Reset to try again.');
      return;
    }
    if (freeSeats(table) === 0) {
      say(`Table ${table.number} is full. Try another table.`);
      return;
    }
    const seat = table.seats.find(candidate => !candidate.classList.contains('is-taken'));
    seat.classList.add('is-taken', 'is-new');
    seatedAt.set(selected, table.number);
    moveRing(table);
    const name = selected;
    selected = GUESTS.find(guest => !seatedAt.has(guest)) || null;
    renderSeating();
    const remaining = GUESTS.length - seatedAt.size;
    say(
      `${name} is now at Table ${table.number}. ${
        remaining
          ? `${remaining} sample guest${remaining === 1 ? '' : 's'} left to seat.`
          : 'Everyone is seated.'
      }`
    );
  }

  // Round tables with a number become buttons; full tables stay in the plan but say they are full.
  tables.forEach(table => {
    if (!table.number || table.shape.tagName.toLowerCase() !== 'circle') {
      return;
    }
    const shape = table.shape;
    shape.setAttribute('role', 'button');
    shape.setAttribute('tabindex', '0');
    shape.addEventListener('click', () => seatAt(table));
    shape.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        seatAt(table);
      }
    });
  });

  guestButtons.forEach(button =>
    button.addEventListener('click', () => chooseGuest(button.dataset.guest))
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

  form.addEventListener('submit', event => {
    event.preventDefault();
    const chosen = form.querySelector('input:checked');
    reply = chosen ? chosen.value : 'yes';
    renderReplies(true);
    send.textContent = 'Update RSVP';
    sent.textContent = 'Sample RSVP sent. The guest replies have updated.';
    seeReplies.hidden = false;
  });

  reset.addEventListener('click', () => {
    reply = null;
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
    send.textContent = 'Send RSVP';
    sent.textContent = '';
    seeReplies.hidden = true;
    view = 'website';
    renderReplies();
    renderSeating();
    renderView();
    say('Sample reset.');
  });

  renderView();
  renderSeating();
  say('Tap a guest, then a table with free seats.');
  section.classList.add('hws--live');
})();
