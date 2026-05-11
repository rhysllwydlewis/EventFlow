(async function () {
  const slug = location.pathname.split('/').filter(Boolean).pop();
  const root = document.getElementById('public-wedding-root');
  const esc = v =>
    String(v || '').replace(
      /[&<>"']/g,
      m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]
    );
  const toPhoneHref = v => `tel:${String(v || '').replace(/[^\d+]/g, '')}`;

  function renderUnavailable(message) {
    root.innerHTML = `<section class='wed-unavailable-shell'><article class='wed-unavailable-card'><div class='wed-unavailable-icon' aria-hidden='true'>💌</div><p class='wed-kicker'>Wedding website</p><h1>This wedding website is not available</h1><p class='wed-unavailable-copy'>${esc(message || 'It may not have been published yet, the link may be incorrect, or the couple may have changed the link.')}</p><a class='btn btn-primary' href='/'>Return to EventFlow</a></article></section>`;
  }

  const req = await fetch(`/api/public/wedding-websites/${encodeURIComponent(slug)}`, {
    credentials: 'same-origin',
  });
  const data = await req.json().catch(() => ({}));
  if (!req.ok) {
    renderUnavailable(data.passwordRequired ? 'Please enter the wedding password to continue.' : data.error);
    return;
  }
  const w = data.website || {};
  const hasCover = !!w.coverImageUrl;
  const fmtDate = d => {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime())
      ? esc(d)
      : dt.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
  };
  const scheduleItems = [
    ['arrivalTime', 'Arrival', 'Please arrive in good time for welcome drinks.'],
    ['ceremonyTime', 'Ceremony', 'The ceremony begins promptly.'],
    ['receptionTime', 'Reception', 'Dinner and celebrations follow afterwards.'],
    ['finishTime', 'Carriages', 'Safe journey home and thank you for celebrating with us.'],
  ].filter(([k]) => w[k]);

  const mapLink = addr => (addr ? `https://maps.google.com/?q=${encodeURIComponent(addr)}` : null);
  const renderCards = (items, renderer) =>
    items.length ? `<div class='wed-grid'>${items.map(renderer).join('')}</div>` : '';

  const customQuestions = (w.customRsvpQuestions || []).filter(q => q && q.label);
  const customQuestionHtml = customQuestions
    .map((q, idx) => {
      const key = `cq_${idx}`;
      const required = q.required ? 'required' : '';
      const hint = q.required ? "<span class='req'>Required</span>" : '';
      if (q.type === 'textarea') {
        return `<label>${esc(q.label)} ${hint}<textarea name='${key}' maxlength='1000' ${required}></textarea></label>`;
      }
      if (q.type === 'select') {
        return `<label>${esc(q.label)} ${hint}<select name='${key}' ${required}><option value=''>Select an option</option>${(q.options || []).map(o => `<option value='${esc(o)}'>${esc(o)}</option>`).join('')}</select></label>`;
      }
      if (q.type === 'checkbox') {
        return `<fieldset><legend>${esc(q.label)} ${hint}</legend>${(q.options || []).map(o => `<label class='inline-check'><input type='checkbox' name='${key}' value='${esc(o)}'> ${esc(o)}</label>`).join('')}</fieldset>`;
      }
      return `<label>${esc(q.label)} ${hint}<input name='${key}' maxlength='300' ${required}></label>`;
    })
    .join('');

  root.innerHTML = `
  <section class='wed-hero ${hasCover ? 'wed-hero--image' : ''}' style="${hasCover ? `--hero-image:url('${esc(w.coverImageUrl)}')` : ''}">
    <div class='wed-hero__overlay'></div>
    <div class='wed-hero__content'>
      <p class='wed-kicker'>Wedding Celebration</p>
      <h1>${esc(w.coupleNames || 'Our Wedding')}</h1>
      ${w.eventDate ? `<p class='wed-meta'>${fmtDate(w.eventDate)}${w.ceremonyVenueName ? ` · ${esc(w.ceremonyVenueName)}` : ''}</p>` : ''}
      ${w.welcomeMessage ? `<p class='wed-welcome'>${esc(w.welcomeMessage)}</p>` : ''}
      <div class='wed-hero__actions'><a href='#rsvp' class='btn btn-primary'>RSVP now</a><a href='#details' class='btn btn-ghost'>View details</a></div>
    </div>
  </section>

  ${scheduleItems.length ? `<section id='details' class='wed-card'><h2>Schedule</h2><div class='wed-timeline'>${scheduleItems.map(([k, lbl, help]) => `<article class='wed-time'><div class='wed-time__dot'></div><div><p class='wed-time__hour'>${esc(w[k])}</p><h3>${lbl}</h3><p>${help}</p></div></article>`).join('')}</div></section>` : ''}

  ${
    w.ceremonyVenueName || w.receptionVenueName
      ? `<section class='wed-card'><h2>Venues</h2><div class='wed-grid'>
  ${w.ceremonyVenueName ? `<article class='wed-pane'><h3>💒 Ceremony</h3><p><strong>${esc(w.ceremonyVenueName)}</strong></p><p>${esc(w.ceremonyVenueAddress || '')}</p>${mapLink(w.ceremonyVenueAddress) ? `<a class='text-link' target='_blank' rel='noopener noreferrer' href='${mapLink(w.ceremonyVenueAddress)}'>Open map</a>` : ''}</article>` : ''}
  ${w.receptionVenueName ? `<article class='wed-pane'><h3>🥂 Reception</h3><p><strong>${esc(w.receptionVenueName)}</strong></p><p>${esc(w.receptionVenueAddress || '')}</p>${mapLink(w.receptionVenueAddress) ? `<a class='text-link' target='_blank' rel='noopener noreferrer' href='${mapLink(w.receptionVenueAddress)}'>Open map</a>` : ''}</article>` : ''}
  </div></section>`
      : ''
  }

  ${
    [w.dressCode, w.childrenPolicy, w.plusOnePolicy, w.giftInfo, w.parkingInfo, w.accessibilityInfo].some(Boolean)
      ? `<section class='wed-card'><h2>Guest Information</h2><div class='wed-chip-grid'>
    ${w.dressCode ? `<article><h3>Dress code</h3><p>${esc(w.dressCode)}</p></article>` : ''}
    ${w.childrenPolicy ? `<article><h3>Children</h3><p>${esc(w.childrenPolicy)}</p></article>` : ''}
    ${w.plusOnePolicy ? `<article><h3>Plus-ones</h3><p>${esc(w.plusOnePolicy)}</p></article>` : ''}
    ${w.giftInfo ? `<article><h3>Gifts</h3><p>${esc(w.giftInfo)}</p></article>` : ''}
    ${w.parkingInfo ? `<article><h3>Parking</h3><p>${esc(w.parkingInfo)}</p></article>` : ''}
    ${w.accessibilityInfo ? `<article><h3>Accessibility</h3><p>${esc(w.accessibilityInfo)}</p></article>` : ''}
  </div></section>`
      : ''
  }

  ${
    (w.accommodationRecommendations || []).length || (w.taxiRecommendations || []).length || (w.localInfo || []).length
      ? `<section class='wed-card'><h2>Travel & Stay</h2>
  ${(w.accommodationRecommendations || []).length ? `<h3>Accommodation</h3>${renderCards(w.accommodationRecommendations.filter(x => x.name), x => `<article class='wed-pane'><h4>${esc(x.name)}</h4><p>${esc(x.description || '')}</p><p>${esc(x.address || '')}</p><div class='wed-links'>${x.phone ? `<a href='${toPhoneHref(x.phone)}'>Call</a>` : ''}${x.websiteUrl ? `<a target='_blank' rel='noopener noreferrer' href='${esc(x.websiteUrl)}'>Website</a>` : ''}</div>${x.distance ? `<p class='small'>Distance: ${esc(x.distance)}</p>` : ''}${x.notes ? `<p class='small'>${esc(x.notes)}</p>` : ''}</article>`)}` : ''}
  ${(w.taxiRecommendations || []).length ? `<h3>Taxis</h3>${renderCards(w.taxiRecommendations.filter(x => x.name), x => `<article class='wed-pane'><h4>${esc(x.name)}</h4>${x.phone ? `<p><a href='${toPhoneHref(x.phone)}'>${esc(x.phone)}</a></p>` : ''}${x.websiteUrl ? `<p><a target='_blank' rel='noopener noreferrer' href='${esc(x.websiteUrl)}'>Website</a></p>` : ''}${x.notes ? `<p class='small'>${esc(x.notes)}</p>` : ''}</article>`)}` : ''}
  ${(w.localInfo || []).length ? `<h3>Local information</h3>${renderCards(w.localInfo.filter(x => x.title), x => `<article class='wed-pane'><h4>${esc(x.title)}</h4><p>${esc(x.description || '')}</p>${x.url ? `<a target='_blank' rel='noopener noreferrer' href='${esc(x.url)}'>Learn more</a>` : ''}${x.type ? `<p class='small'>${esc(x.type)}</p>` : ''}</article>`)}` : ''}
  </section>`
      : ''
  }

  ${(w.weddingParty || []).filter(x => x.name).length ? `<section class='wed-card'><h2>Wedding Party</h2><div class='wed-grid'>${(w.weddingParty || []).filter(x => x.name).map(p => `<article class='wed-party'>${p.imageUrl ? `<img src='${esc(p.imageUrl)}' alt='${esc(p.name)}' onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">` : ''}<div class='wed-avatar' style='display:${p.imageUrl ? 'none' : 'grid'}'>${esc((p.name || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase())}</div><h3>${esc(p.name)}</h3><p class='small'>${esc(p.role || '')}</p><p>${esc(p.bio || '')}</p></article>`).join('')}</div></section>` : ''}

  ${w.loveStory ? `<section class='wed-card wed-story'><h2>Our Story</h2><p>${esc(w.loveStory)}</p></section>` : ''}
  ${w.proposalStory ? `<section class='wed-card wed-story'><h2>The Proposal</h2><p>${esc(w.proposalStory)}</p></section>` : ''}

  ${(w.faq || []).filter(f => f.question && f.answer).length ? `<section class='wed-card'><h2>FAQs</h2>${(w.faq || []).filter(f => f.question && f.answer).map(f => `<details class='wed-faq'><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</section>` : ''}

  <section id='rsvp' class='wed-card wed-rsvp'><h2>RSVP</h2>${w.rsvpIntroText ? `<p>${esc(w.rsvpIntroText)}</p>` : ''}
    ${w.rsvpEnabled === false ? '<p>RSVPs are not currently open.</p>' : w.rsvpDeadline && new Date(w.rsvpDeadline) < new Date() ? '<p>RSVPs are now closed.</p>' : `<form id='rsvp-form' class='wed-form'><label>Full name<input name='guestName' required></label><label>Email address<input name='email' type='email'></label><input name='website' class='hp' tabindex='-1' autocomplete='off'><label>Are you attending?<select name='attending'><option value='true'>Joyfully attending</option><option value='false'>Regretfully declining</option></select></label><div class='wed-form-grid'><label>Party size<input type='number' name='partySize' min='1' max='20' value='1'></label><label>Children count<input type='number' name='childrenCount' min='0' max='10' value='0'></label></div><label>Plus-one name<input name='plusOneName'></label>${(w.mealOptions || []).length ? `<label>Meal choice<select name='mealChoice'><option value=''>Select meal</option>${w.mealOptions.map(m => `<option value='${esc(m)}'>${esc(m)}</option>`).join('')}</select></label>` : ''}<label>Dietary requirements<textarea name='dietaryRequirements'></textarea></label><label>Accessibility requirements<textarea name='accessibilityRequirements'></textarea></label><label>Song request<input name='songRequest'></label><label>Notes<textarea name='notes'></textarea></label>${customQuestionHtml}<button type='submit' class='btn btn-primary'>Send RSVP</button></form><p id='rsvp-msg' role='status' aria-live='polite'></p>`}
  </section>
  <footer class='wed-footer'>Crafted with EventFlow</footer>`;

  const form = document.getElementById('rsvp-form');
  if (!form) return;
  const msgEl = document.getElementById('rsvp-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    msgEl.textContent = '';
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const customAnswers = customQuestions.map((q, idx) => {
      const k = `cq_${idx}`;
      const val = q.type === 'checkbox' ? fd.getAll(k) : fd.get(k);
      return { id: q.id || k, label: q.label, value: val };
    });
    const missing = customQuestions.find((q, idx) => q.required && !(q.type === 'checkbox' ? fd.getAll(`cq_${idx}`).length : String(fd.get(`cq_${idx}`) || '').trim()));
    if (missing) {
      msgEl.textContent = `Please complete required question: ${missing.label}`;
      msgEl.className = 'msg msg--error';
      return;
    }
    payload.customAnswers = customAnswers;
    const r = await fetch(`/api/public/wedding-websites/${encodeURIComponent(slug)}/rsvp`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    msgEl.textContent = j.message || j.error || 'Submitted';
    msgEl.className = r.ok ? 'msg msg--ok' : 'msg msg--error';
    if (r.ok) form.reset();
  });
})();
