(async function () {
  const slug = location.pathname.split('/').filter(Boolean).pop();
  const root = document.getElementById('public-wedding-root');

  const esc = v =>
    String(v || '').replace(
      /[&<>"']/g,
      m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]
    );
  const attr = esc;
  const boolAttr = value => (value ? 'true' : 'false');
  const stripTags = value =>
    String(value || '')
      .replace(/<[^>]*>/g, '')
      .trim();
  const toPhoneHref = v => `tel:${String(v || '').replace(/[^\d+]/g, '')}`;
  const coerceList = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const hasText = value => stripTags(value).length > 0;

  const safeExternalUrl = value => {
    if (!value) {
      return '';
    }
    try {
      const url = new URL(String(value), window.location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_err) {
      return '';
    }
  };

  const safeImageUrl = value => {
    const raw = String(value || '').trim();
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(raw)) {
      return raw;
    }
    return safeExternalUrl(raw);
  };

  const parseDate = value => {
    if (!value) {
      return null;
    }
    const raw = String(value);
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
      : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const fmtDate = value => {
    const date = parseDate(value);
    return date
      ? date.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : esc(value);
  };

  const daysUntil = value => {
    const date = parseDate(value);
    if (!date) {
      return null;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target - start) / 86400000);
  };

  const isDeadlinePassed = value => {
    if (!value) {
      return false;
    }
    const raw = String(value);
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T23:59:59.999`)
      : parseDate(raw);
    return Boolean(deadline && deadline < new Date());
  };

  const mapLink = addr => (addr ? `https://maps.google.com/?q=${encodeURIComponent(addr)}` : null);
  const renderCards = (items, renderer, className = 'wed-grid') =>
    items.length ? `<div class='${className}'>${items.map(renderer).join('')}</div>` : '';

  function renderUnavailable(message, title = 'This wedding website is not available') {
    root.classList.remove('wed-loading');
    root.innerHTML = `<section class='wed-unavailable-shell'><article class='wed-unavailable-card'><div class='wed-unavailable-icon' aria-hidden='true'>💌</div><p class='wed-kicker'>Wedding website</p><h1>${esc(title)}</h1><p class='wed-unavailable-copy'>${esc(message || 'It may not have been published yet, the link may be incorrect, or the couple may have changed the link.')}</p><a class='btn btn-primary' href='/'>Return to EventFlow</a></article></section>`;
  }

  async function loadWebsite() {
    try {
      const req = await fetch(`/api/public/wedding-websites/${encodeURIComponent(slug)}`, {
        credentials: 'same-origin',
      });
      const data = await req.json().catch(() => ({}));
      if (!req.ok) {
        renderUnavailable(
          data.passwordRequired ? 'Please enter the wedding password to continue.' : data.error
        );
        return null;
      }
      return data.website || {};
    } catch (_err) {
      renderUnavailable(
        'We could not load this wedding website. Please check your connection and try again.',
        'We hit a connection problem'
      );
      return null;
    }
  }

  function renderNav(sections) {
    if (!sections.length) {
      return '';
    }
    return `<nav class='wed-nav' aria-label='Wedding website sections'>${sections
      .map(section => `<a href='#${section.id}'>${esc(section.label)}</a>`)
      .join('')}</nav>`;
  }

  function renderDetailCard(title, text, icon) {
    return hasText(text)
      ? `<article><span aria-hidden='true'>${icon}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`
      : '';
  }

  function renderVenue(label, name, address, icon) {
    if (!hasText(name)) {
      return '';
    }
    const maps = mapLink(address);
    return `<article class='wed-pane wed-venue'><div class='wed-pane__icon' aria-hidden='true'>${icon}</div><div><p class='wed-eyebrow'>${esc(label)}</p><h3>${esc(name)}</h3>${hasText(address) ? `<p>${esc(address)}</p>` : ''}${maps ? `<a class='text-link' target='_blank' rel='noopener noreferrer' href='${maps}'>Open in maps</a>` : ''}</div></article>`;
  }

  function renderExternalLink(url, label) {
    const safeUrl = safeExternalUrl(url);
    return safeUrl
      ? `<a target='_blank' rel='noopener noreferrer' href='${attr(safeUrl)}'>${esc(label)}</a>`
      : '';
  }

  function renderQuickFacts(facts) {
    if (!facts.length) {
      return '';
    }
    return `<section class='wed-quick-facts' aria-label='Wedding highlights'>${facts
      .map(
        fact =>
          `<article class='wed-fact'><span aria-hidden='true'>${fact.icon}</span><div><p>${esc(fact.label)}</p><strong>${esc(fact.value)}</strong></div></article>`
      )
      .join('')}</section>`;
  }

  function renderRsvpForm(w, customQuestionHtml) {
    if (w.rsvpEnabled === false) {
      return `<div class='wed-rsvp-closed'><strong>RSVPs are not currently open.</strong><p class='small'>Please check back later or contact the couple directly.</p></div>`;
    }
    if (isDeadlinePassed(w.rsvpDeadline)) {
      return `<div class='wed-rsvp-closed'><strong>RSVPs are now closed.</strong><p class='small'>If your plans have changed, please contact the couple directly.</p></div>`;
    }
    return `<form id='rsvp-form' class='wed-form' novalidate>
      <div class='wed-form-grid'>
        <label>Full name<span class='req'>Required</span><input name='guestName' autocomplete='name' required maxlength='120'></label>
        <label>Email address<input name='email' type='email' autocomplete='email' maxlength='254'></label>
      </div>
      <input name='website' class='hp' tabindex='-1' autocomplete='off' aria-hidden='true'>
      <label>Are you attending?<select name='attending'><option value='true'>Joyfully attending</option><option value='false'>Regretfully declining</option></select></label>
      <div class='wed-form-grid'>
        <label>Party size<input type='number' name='partySize' min='1' max='20' value='1' inputmode='numeric'></label>
        <label>Children count<input type='number' name='childrenCount' min='0' max='10' value='0' inputmode='numeric'></label>
      </div>
      <label>Phone number<input name='phone' type='tel' autocomplete='tel' maxlength='40'></label>
      <label>Plus-one name<input name='plusOneName' maxlength='120'></label>
      ${
        coerceList(w.mealOptions).length
          ? `<label>Meal choice<select name='mealChoice'><option value=''>Select meal</option>${coerceList(
              w.mealOptions
            )
              .map(m => `<option value='${attr(m)}'>${esc(m)}</option>`)
              .join('')}</select></label>`
          : ''
      }
      <label>Dietary requirements<textarea name='dietaryRequirements' maxlength='500' rows='3'></textarea></label>
      <label>Accessibility requirements<textarea name='accessibilityRequirements' maxlength='500' rows='3'></textarea></label>
      <label>Song request<input name='songRequest' maxlength='200'></label>
      <label>Notes<textarea name='notes' maxlength='1000' rows='3'></textarea></label>
      ${customQuestionHtml}
      <button type='submit' class='btn btn-primary wed-submit'>Send RSVP</button>
    </form><p id='rsvp-msg' role='status' aria-live='polite'></p>`;
  }

  const w = await loadWebsite();
  if (!w) {
    return;
  }

  const coverImageUrl = safeImageUrl(w.coverImageUrl);
  const hasCover = !!coverImageUrl;
  const countdown = daysUntil(w.eventDate);
  const scheduleItems = [
    ['arrivalTime', 'Arrival', 'Please arrive in good time for welcome drinks.'],
    ['ceremonyTime', 'Ceremony', 'The ceremony begins promptly.'],
    ['receptionTime', 'Reception', 'Dinner and celebrations follow afterwards.'],
    ['finishTime', 'Carriages', 'Safe journey home and thank you for celebrating with us.'],
  ].filter(([k]) => hasText(w[k]));
  const weddingParty = coerceList(w.weddingParty).filter(person => hasText(person.name));
  const faqs = coerceList(w.faq).filter(faq => hasText(faq.question) && hasText(faq.answer));
  const accommodation = coerceList(w.accommodationRecommendations).filter(item =>
    hasText(item.name)
  );
  const taxis = coerceList(w.taxiRecommendations).filter(item => hasText(item.name));
  const localInfo = coerceList(w.localInfo).filter(item => hasText(item.title));
  const customQuestions = coerceList(w.customRsvpQuestions).filter(q => q && hasText(q.label));
  const primaryVenue = w.ceremonyVenueName || w.receptionVenueName;
  const quickFacts = [
    w.eventDate && { icon: '📅', label: 'Date', value: fmtDate(w.eventDate) },
    primaryVenue && { icon: '📍', label: 'Venue', value: primaryVenue },
    w.rsvpDeadline && { icon: '✉️', label: 'RSVP by', value: fmtDate(w.rsvpDeadline) },
    w.dressCode && { icon: '✨', label: 'Dress code', value: w.dressCode },
  ].filter(Boolean);
  const details = [
    w.dressCode,
    w.childrenPolicy,
    w.plusOnePolicy,
    w.giftInfo,
    w.parkingInfo,
    w.accessibilityInfo,
  ].some(hasText);
  const venues = hasText(w.ceremonyVenueName) || hasText(w.receptionVenueName);
  const travel = accommodation.length || taxis.length || localInfo.length;
  const stories = hasText(w.loveStory) || hasText(w.proposalStory);
  const navSections = [
    scheduleItems.length && { id: 'schedule', label: 'Schedule' },
    venues && { id: 'venues', label: 'Venues' },
    details && { id: 'guest-info', label: 'Guest info' },
    travel && { id: 'travel', label: 'Travel' },
    weddingParty.length && { id: 'wedding-party', label: 'Wedding party' },
    stories && { id: 'story', label: 'Story' },
    faqs.length && { id: 'faqs', label: 'FAQs' },
    { id: 'rsvp', label: 'RSVP' },
  ].filter(Boolean);

  const customQuestionHtml = customQuestions
    .map((q, idx) => {
      const key = `cq_${idx}`;
      const required = q.required ? 'required' : '';
      const hint = q.required ? "<span class='req'>Required</span>" : '';
      if (q.type === 'textarea') {
        return `<label>${esc(q.label)} ${hint}<textarea name='${key}' maxlength='1000' rows='3' ${required}></textarea></label>`;
      }
      if (q.type === 'select') {
        return `<label>${esc(q.label)} ${hint}<select name='${key}' ${required}><option value=''>Select an option</option>${coerceList(
          q.options
        )
          .map(o => `<option value='${attr(o)}'>${esc(o)}</option>`)
          .join('')}</select></label>`;
      }
      if (q.type === 'checkbox') {
        return `<fieldset data-required='${boolAttr(q.required)}' data-question='${attr(q.label)}'><legend>${esc(q.label)} ${hint}</legend>${coerceList(
          q.options
        )
          .map(
            o =>
              `<label class='inline-check'><input type='checkbox' name='${key}' value='${attr(o)}'> ${esc(o)}</label>`
          )
          .join('')}</fieldset>`;
      }
      return `<label>${esc(q.label)} ${hint}<input name='${key}' maxlength='300' ${required}></label>`;
    })
    .join('');

  document.title = w.coupleNames ? `${w.coupleNames} — Wedding Website` : 'Wedding Website';
  root.classList.remove('wed-loading');
  root.innerHTML = `
  <section class='wed-hero ${hasCover ? 'wed-hero--image' : ''}' style="${hasCover ? `--hero-image:url('${attr(coverImageUrl)}')` : ''}">
    <div class='wed-hero__overlay'></div>
    <div class='wed-hero__content'>
      <p class='wed-kicker'>Wedding Celebration</p>
      <h1>${esc(w.coupleNames || 'Our Wedding')}</h1>
      ${w.eventDate ? `<p class='wed-meta'>${fmtDate(w.eventDate)}${w.ceremonyVenueName ? ` · ${esc(w.ceremonyVenueName)}` : ''}</p>` : ''}
      ${countdown !== null ? `<div class='wed-countdown' aria-label='Countdown to the wedding'><strong>${countdown > 0 ? countdown : 0}</strong><span>${countdown === 1 ? 'day to go' : countdown > 0 ? 'days to go' : 'today is the day'}</span></div>` : ''}
      ${w.welcomeMessage ? `<p class='wed-welcome'>${esc(w.welcomeMessage)}</p>` : ''}
      <div class='wed-hero__actions'><a href='#rsvp' class='btn btn-primary'>RSVP now</a>${navSections.length > 1 ? `<a href='#${navSections[0].id}' class='btn btn-ghost'>View details</a>` : ''}</div>
      <div class='wed-scroll-cue' aria-hidden='true'>Scroll for details</div>
    </div>
  </section>
  ${renderNav(navSections)}
  ${renderQuickFacts(quickFacts)}

  ${scheduleItems.length ? `<section id='schedule' class='wed-card'><div class='wed-section-heading'><p class='wed-eyebrow'>The plan</p><h2>Schedule</h2></div><div class='wed-timeline'>${scheduleItems.map(([k, lbl, help]) => `<article class='wed-time'><div class='wed-time__dot'></div><div><p class='wed-time__hour'>${esc(w[k])}</p><h3>${esc(lbl)}</h3><p>${esc(help)}</p></div></article>`).join('')}</div></section>` : ''}

  ${venues ? `<section id='venues' class='wed-card'><div class='wed-section-heading'><p class='wed-eyebrow'>Where to go</p><h2>Venues</h2></div><div class='wed-grid'>${renderVenue('Ceremony', w.ceremonyVenueName, w.ceremonyVenueAddress, '💒')}${renderVenue('Reception', w.receptionVenueName, w.receptionVenueAddress, '🥂')}</div></section>` : ''}

  ${
    details
      ? `<section id='guest-info' class='wed-card'><div class='wed-section-heading'><p class='wed-eyebrow'>Good to know</p><h2>Guest Information</h2></div><div class='wed-chip-grid'>
    ${renderDetailCard('Dress code', w.dressCode, '👗')}
    ${renderDetailCard('Children', w.childrenPolicy, '🧸')}
    ${renderDetailCard('Plus-ones', w.plusOnePolicy, '💌')}
    ${renderDetailCard('Gifts', w.giftInfo, '🎁')}
    ${renderDetailCard('Parking', w.parkingInfo, '🚗')}
    ${renderDetailCard('Accessibility', w.accessibilityInfo, '♿')}
  </div></section>`
      : ''
  }

  ${
    travel
      ? `<section id='travel' class='wed-card'><div class='wed-section-heading'><p class='wed-eyebrow'>Travel & stay</p><h2>Recommendations</h2></div>
  ${accommodation.length ? `<h3>Accommodation</h3>${renderCards(accommodation, x => `<article class='wed-pane'><h4>${esc(x.name)}</h4>${hasText(x.description) ? `<p>${esc(x.description)}</p>` : ''}${hasText(x.address) ? `<p>${esc(x.address)}</p>` : ''}<div class='wed-links'>${x.phone ? `<a href='${toPhoneHref(x.phone)}'>Call</a>` : ''}${renderExternalLink(x.websiteUrl, 'Website')}</div>${hasText(x.distance) ? `<p class='small'>Distance: ${esc(x.distance)}</p>` : ''}${hasText(x.notes) ? `<p class='small'>${esc(x.notes)}</p>` : ''}</article>`)}` : ''}
  ${taxis.length ? `<h3>Taxis</h3>${renderCards(taxis, x => `<article class='wed-pane'><h4>${esc(x.name)}</h4>${x.phone ? `<p><a href='${toPhoneHref(x.phone)}'>${esc(x.phone)}</a></p>` : ''}${renderExternalLink(x.websiteUrl, 'Website')}${hasText(x.notes) ? `<p class='small'>${esc(x.notes)}</p>` : ''}</article>`)}` : ''}
  ${localInfo.length ? `<h3>Local information</h3>${renderCards(localInfo, x => `<article class='wed-pane'><h4>${esc(x.title)}</h4>${hasText(x.description) ? `<p>${esc(x.description)}</p>` : ''}${renderExternalLink(x.url, 'Learn more')}${hasText(x.type) ? `<p class='small'>${esc(x.type)}</p>` : ''}</article>`)}` : ''}
  </section>`
      : ''
  }

  ${
    weddingParty.length
      ? `<section id='wedding-party' class='wed-card'><div class='wed-section-heading'><p class='wed-eyebrow'>Meet the people</p><h2>Wedding Party</h2></div><div class='wed-grid'>${weddingParty
          .map(p =>
            (() => {
              const partyImage = safeImageUrl(p.imageUrl);
              const initials = (p.name || '?')
                .split(' ')
                .map(s => s[0])
                .join('')
                .slice(0, 2)
                .toUpperCase();
              return `<article class='wed-party'>${partyImage ? `<img src='${attr(partyImage)}' alt='${attr(p.name)}' loading='lazy' onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">` : ''}<div class='wed-avatar' style='display:${partyImage ? 'none' : 'grid'}'>${esc(initials)}</div><h3>${esc(p.name)}</h3>${hasText(p.role) ? `<p class='small'>${esc(p.role)}</p>` : ''}${hasText(p.bio) ? `<p>${esc(p.bio)}</p>` : ''}</article>`;
            })()
          )
          .join('')}</div></section>`
      : ''
  }

  ${stories ? `<section id='story' class='wed-card wed-story'><div class='wed-section-heading'><p class='wed-eyebrow'>About us</p><h2>Our Story</h2></div>${w.loveStory ? `<p>${esc(w.loveStory)}</p>` : ''}${w.proposalStory ? `<h3>The Proposal</h3><p>${esc(w.proposalStory)}</p>` : ''}</section>` : ''}

  ${faqs.length ? `<section id='faqs' class='wed-card'><div class='wed-section-heading'><p class='wed-eyebrow'>Need to know</p><h2>FAQs</h2></div>${faqs.map(f => `<details class='wed-faq'><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</section>` : ''}

  <section id='rsvp' class='wed-card wed-rsvp'><div class='wed-section-heading'><p class='wed-eyebrow'>Reply</p><h2>RSVP</h2></div>${w.rsvpIntroText ? `<p>${esc(w.rsvpIntroText)}</p>` : '<p class="small">Let the couple know whether you can celebrate with them.</p>'}
    ${renderRsvpForm(w, customQuestionHtml)}
  </section>
  <footer class='wed-footer'><strong>Crafted with EventFlow</strong><span>Plan, invite and celebrate beautifully.</span></footer>`;

  const form = document.getElementById('rsvp-form');
  if (!form) {
    return;
  }
  const msgEl = document.getElementById('rsvp-msg');
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    msgEl.textContent = '';
    msgEl.className = '';

    if (!form.checkValidity()) {
      form.reportValidity();
      msgEl.textContent = 'Please complete the highlighted fields.';
      msgEl.className = 'msg msg--error';
      return;
    }

    const fd = new FormData(form);
    const partySize = Number(fd.get('partySize')) || 1;
    const childrenCount = Number(fd.get('childrenCount')) || 0;
    if (childrenCount > partySize) {
      msgEl.textContent = 'Children count cannot be greater than your party size.';
      msgEl.className = 'msg msg--error';
      return;
    }

    const customAnswers = customQuestions.map((q, idx) => {
      const k = `cq_${idx}`;
      const val = q.type === 'checkbox' ? fd.getAll(k) : fd.get(k);
      return { id: q.id || k, label: q.label, value: val };
    });
    const missing = customQuestions.find((q, idx) =>
      q.required
        ? !(q.type === 'checkbox'
            ? fd.getAll(`cq_${idx}`).length
            : String(fd.get(`cq_${idx}`) || '').trim())
        : false
    );
    if (missing) {
      msgEl.textContent = `Please complete required question: ${missing.label}`;
      msgEl.className = 'msg msg--error';
      return;
    }

    const payload = Object.fromEntries(fd.entries());
    payload.customAnswers = customAnswers;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const r = await fetch(`/api/public/wedding-websites/${encodeURIComponent(slug)}/rsvp`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      msgEl.textContent =
        j.message ||
        j.error ||
        (r.ok ? 'Thank you — your RSVP has been sent.' : 'We could not send your RSVP.');
      msgEl.className = r.ok ? 'msg msg--ok' : 'msg msg--error';
      if (r.ok) {
        form.reset();
      }
    } catch (_err) {
      msgEl.textContent =
        'We could not send your RSVP. Please check your connection and try again.';
      msgEl.className = 'msg msg--error';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send RSVP';
    }
  });
})();
