(async function () {
  const slug = location.pathname.split('/').pop();
  const root = document.getElementById('public-wedding-root');
  const esc = v =>
    String(v || '').replace(
      /[&<>"']/g,
      m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]
    );
  const req = await fetch(`/api/public/wedding-websites/${encodeURIComponent(slug)}`);
  const data = await req.json();
  if (!req.ok) {
    root.textContent = data.error || 'Wedding website not found.';
    return;
  }
  const w = data.website;
  const section = (t, b) => (b ? `<section><h2>${t}</h2>${b}</section>` : '');
  const faq = (w.faq || [])
    .filter(f => f.question && f.answer)
    .map(f => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`)
    .join('');
  const acc = (w.accommodationRecommendations || [])
    .filter(x => x.name)
    .map(x => `<li><strong>${esc(x.name)}</strong> ${esc(x.description || '')}</li>`)
    .join('');
  const taxis = (w.taxiRecommendations || [])
    .filter(x => x.name)
    .map(x => `<li><strong>${esc(x.name)}</strong> ${esc(x.phone || '')}</li>`)
    .join('');
  const local = (w.localInfo || [])
    .filter(x => x.title)
    .map(x => `<li><strong>${esc(x.title)}</strong> ${esc(x.description || '')}</li>`)
    .join('');
  const party = (w.weddingParty || [])
    .filter(x => x.name)
    .map(x => `<li><strong>${esc(x.name)}</strong> — ${esc(x.role || '')}</li>`)
    .join('');

  root.innerHTML = `<header class='hero'><h1>${esc(w.coupleNames || 'Our Wedding')}</h1>${w.eventDate ? `<p>${esc(w.eventDate)}</p>` : ''}<p>${esc(w.welcomeMessage || '')}</p></header>
  ${section('Schedule', [w.arrivalTime, w.ceremonyTime, w.receptionTime, w.finishTime].some(Boolean) ? `<ul><li>Arrival: ${esc(w.arrivalTime || '-')}</li><li>Ceremony: ${esc(w.ceremonyTime || '-')}</li><li>Reception: ${esc(w.receptionTime || '-')}</li><li>Finish: ${esc(w.finishTime || '-')}</li></ul>` : '')}
  ${section('Ceremony Venue', w.ceremonyVenueName ? `<p>${esc(w.ceremonyVenueName)}<br>${esc(w.ceremonyVenueAddress || '')}</p>` : '')}
  ${section('Reception Venue', w.receptionVenueName ? `<p>${esc(w.receptionVenueName)}<br>${esc(w.receptionVenueAddress || '')}</p>` : '')}
  ${section(
    'Travel & Parking',
    [w.parkingInfo, w.accessibilityInfo]
      .filter(Boolean)
      .map(x => `<p>${esc(x)}</p>`)
      .join('')
  )}
  ${section('Accommodation', acc ? `<ul>${acc}</ul>` : '')}
  ${section('Taxis', taxis ? `<ul>${taxis}</ul>` : '')}
  ${section('Local Information', local ? `<ul>${local}</ul>` : '')}
  ${section('Dress Code', w.dressCode ? `<p>${esc(w.dressCode)}</p>` : '')}
  ${section('Children Policy', w.childrenPolicy ? `<p>${esc(w.childrenPolicy)}</p>` : '')}
  ${section('Plus One Policy', w.plusOnePolicy ? `<p>${esc(w.plusOnePolicy)}</p>` : '')}
  ${section('Wedding Party', party ? `<ul>${party}</ul>` : '')}
  ${section('Our Story', w.loveStory ? `<p>${esc(w.loveStory)}</p>` : '')}
  ${section('Proposal Story', w.proposalStory ? `<p>${esc(w.proposalStory)}</p>` : '')}
  ${section('FAQs', faq)}
  ${section('Gift Information', w.giftInfo ? `<p>${esc(w.giftInfo)}</p>` : '')}
  <section><h2>RSVP</h2>${w.rsvpEnabled === false ? '<p>RSVPs are not currently open.</p>' : w.rsvpDeadline && new Date(w.rsvpDeadline) < new Date() ? '<p>RSVPs are now closed.</p>' : `<form id='rsvp' aria-label='Wedding RSVP form'><label>Name<input aria-label='Guest name' name='guestName' placeholder='Your name' required></label><label>Email<input aria-label='Email address' name='email' placeholder='Email (optional)'></label><input name='website' style='display:none' tabindex='-1' autocomplete='off'><label>Attending<select aria-label='Attending status' name='attending'><option value='true'>Attending</option><option value='false'>Declined</option></select></label><label>Party size<input aria-label='Party size' type='number' min='1' max='20' name='partySize' value='1'></label><label>Plus one name<input aria-label='Plus one name' name='plusOneName' placeholder='Plus one name'></label><label>Dietary requirements<textarea aria-label='Dietary requirements' name='dietaryRequirements' placeholder='Dietary requirements'></textarea></label><button type='submit'>Submit RSVP</button></form><p id='rsvp-msg' role='status' aria-live='polite'></p>`}</section><footer>Powered by EventFlow</footer>`;

  const form = document.getElementById('rsvp');
  if (!form) {
    return;
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const r = await fetch(`/api/public/wedding-websites/${encodeURIComponent(slug)}/rsvp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    document.getElementById('rsvp-msg').textContent = j.message || j.error || 'Submitted';
    if (r.ok) {
      form.reset();
    }
  });
})();
