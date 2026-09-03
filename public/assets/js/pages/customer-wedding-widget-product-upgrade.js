'use strict';
(function () {
  let queued = false;

  const esc = value =>
    String(value || '').replace(
      /[&<>"']/g,
      ch =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[ch]
    );

  const cssEscape = value => {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return String(value || '').replace(/["\\]/g, '\\$&');
  };

  function injectStyles() {
    if (document.getElementById('ww-product-upgrade-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'ww-product-upgrade-styles';
    style.textContent = `
      .ww-product-command {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(220px, 0.75fr);
        gap: 0.85rem;
        margin-bottom: 0.85rem;
      }

      .ww-product-next,
      .ww-product-progress,
      .ww-product-empty,
      .ww-product-tip {
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 20px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(243, 252, 250, 0.74));
        box-shadow: 0 16px 36px rgba(36, 67, 111, 0.07);
        padding: 0.95rem;
      }

      .ww-product-next {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.75rem;
      }

      .ww-product-next h4,
      .ww-product-progress h4,
      .ww-product-empty h4,
      .ww-product-tip h4 {
        margin: 0.1rem 0 0.3rem;
        color: var(--ww-ink, #172033);
        font-size: 1rem;
      }

      .ww-product-next p,
      .ww-product-progress p,
      .ww-product-empty p,
      .ww-product-tip p {
        margin: 0;
        color: var(--ww-muted, #63708a);
      }

      .ww-progress-track {
        height: 10px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(80, 192, 176, 0.14);
        margin: 0.55rem 0 0.65rem;
      }

      .ww-progress-track span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--ww-mint, #50c0b0), var(--ww-teal, #2c94b1));
      }

      .ww-progress-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .ww-progress-list li {
        display: inline-flex;
        align-items: center;
        gap: 0.28rem;
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.66);
        color: var(--ww-navy, #24436f);
        font-size: 0.75rem;
        font-weight: 800;
        padding: 0.25rem 0.5rem;
      }

      .ww-progress-list li[data-done='true'] {
        color: #047857;
        background: rgba(220, 252, 231, 0.78);
      }

      .ww-product-kicker {
        color: var(--ww-muted, #63708a);
        font-size: 0.6875rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .ww-app-dialog.ww-product-enhanced .ww-overview-grid article,
      .ww-app-dialog.ww-product-enhanced .ww-tiles > div {
        position: relative;
        overflow: hidden;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(247, 253, 252, 0.72));
      }

      .ww-app-dialog.ww-product-enhanced .ww-overview-grid article::after,
      .ww-app-dialog.ww-product-enhanced .ww-tiles > div::after {
        content: '';
        position: absolute;
        inset: auto -20% -45% 30%;
        height: 70%;
        border-radius: 999px;
        background: rgba(80, 192, 176, 0.08);
        pointer-events: none;
      }

      .ww-builder details,
      .ww-builder .ww-advanced-panel {
        border-radius: 18px;
        box-shadow: 0 12px 26px rgba(36, 67, 111, 0.055);
      }

      .ww-product-required-hint {
        display: inline-flex;
        width: max-content;
        margin-top: 0.28rem;
        border-radius: 999px;
        background: rgba(254, 243, 199, 0.78);
        color: #92400e;
        font-size: 0.6875rem;
        font-weight: 800;
        padding: 0.18rem 0.45rem;
      }

      .ww-save-state {
        display: inline-flex;
        align-items: center;
        gap: 0.32rem;
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.72);
        color: var(--ww-navy, #24436f);
        font-size: 0.75rem;
        font-weight: 800;
        padding: 0.42rem 0.6rem;
      }

      .ww-save-state[data-state='dirty'] {
        color: #92400e;
        background: #fef3c7;
      }

      .ww-guest-card-list {
        display: none;
        gap: 0.55rem;
        margin-top: 0.75rem;
      }

      .ww-guest-card {
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.72);
        padding: 0.75rem;
      }

      .ww-guest-card__top {
        display: flex;
        justify-content: space-between;
        gap: 0.55rem;
        align-items: flex-start;
      }

      .ww-guest-card strong {
        color: var(--ww-ink, #172033);
      }

      .ww-guest-card small {
        color: var(--ww-muted, #63708a);
      }

      .ww-guest-card__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin-top: 0.55rem;
      }

      .ww-guest-card__meta span {
        border-radius: 999px;
        background: rgba(80, 192, 176, 0.1);
        color: var(--ww-navy, #24436f);
        font-weight: 800;
        font-size: 0.6875rem;
        padding: 0.22rem 0.42rem;
      }

      .ww-seating-command {
        display: grid;
        gap: 0.5rem;
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        padding: 0.75rem;
        margin: 0.75rem 0;
      }

      .ww-seating-command__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }

      .ww-seating-command__chips span {
        border-radius: 999px;
        background: rgba(80, 192, 176, 0.1);
        color: var(--ww-navy, #24436f);
        font-weight: 800;
        font-size: 0.75rem;
        padding: 0.28rem 0.5rem;
      }

      .ww-share-publishing-centre {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.8rem;
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 20px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(243, 252, 250, 0.74));
        box-shadow: 0 16px 36px rgba(36, 67, 111, 0.07);
        padding: 0.95rem;
        margin-bottom: 0.85rem;
      }

      .ww-share-publishing-centre h4 {
        margin: 0.1rem 0 0.25rem;
        color: var(--ww-ink, #172033);
      }

      .ww-share-publishing-centre p {
        margin: 0;
        color: var(--ww-muted, #63708a);
      }

      .ww-focus-ring :is(button, a, input, select, textarea):focus-visible,
      .ww-app-dialog :is(button, a, input, select, textarea):focus-visible {
        outline: 3px solid rgba(80, 192, 176, 0.36);
        outline-offset: 2px;
      }

      @media (max-width: 760px) {
        .ww-product-command,
        .ww-product-next,
        .ww-share-publishing-centre {
          grid-template-columns: 1fr;
        }

        .ww-table-wrap {
          overflow-x: auto;
        }

        .ww-guest-card-list {
          display: grid;
        }

        .ww-table-wrap .ww-table {
          display: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function numberFromText(text) {
    const match = String(text || '').match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function switchTab(dialog, tab) {
    dialog.querySelector(`.ww-app-tabs [data-tab="${tab}"]`)?.click();
  }

  function overviewState(panel) {
    const cards = Array.from(panel.querySelectorAll('.ww-overview-grid article'));
    const getCard = label => cards.find(card => card.textContent.toLowerCase().includes(label));
    const website = getCard('website')?.querySelector('strong')?.textContent || '';
    const rsvps = getCard('rsvps')?.querySelector('strong')?.textContent || '0/0';
    const guests = numberFromText(getCard('guests')?.querySelector('strong')?.textContent);
    const seated = numberFromText(getCard('seating')?.querySelector('strong')?.textContent);
    const rsvpParts = rsvps.split('/').map(part => Number(part.trim()) || 0);
    const url = panel.querySelector('.ww-share-mini span')?.textContent || '';

    return {
      websitePublished: /published/i.test(website),
      websiteStarted: Boolean(url) || /published/i.test(website),
      responses: rsvpParts[0] || 0,
      expected: rsvpParts[1] || guests || 0,
      guests,
      seated,
      url,
    };
  }

  function completionItems(state) {
    return [
      { label: 'Website', done: state.websiteStarted },
      { label: 'Published', done: state.websitePublished },
      { label: 'Guests', done: state.guests > 0 },
      { label: 'RSVPs', done: state.expected === 0 ? false : state.responses >= state.expected },
      {
        label: 'Seating',
        done:
          state.guests > 0 &&
          state.seated >= Math.min(state.guests, state.expected || state.guests),
      },
    ];
  }

  function nextAction(state) {
    if (!state.websiteStarted) {
      return {
        tab: 'workspace',
        title: 'Create your wedding website',
        body: 'Start the workspace so guests have one clear place for details and RSVPs.',
        button: 'Start setup',
      };
    }
    if (!state.websitePublished) {
      return {
        tab: 'workspace',
        title: 'Finish and publish your website',
        body: 'Complete the essentials, preview the guest page, then publish when ready.',
        button: 'Open workspace',
      };
    }
    if (!state.guests) {
      return {
        tab: 'guests',
        title: 'Add your first guests',
        body: 'Build your guest list so RSVPs and seating have something to work with.',
        button: 'Add guests',
      };
    }
    if (state.expected && state.responses < state.expected) {
      return {
        tab: 'guests',
        title: 'Track outstanding RSVPs',
        body: `${state.responses}/${state.expected} responses received. Keep an eye on guests still awaiting.`,
        button: 'Review RSVPs',
      };
    }
    if (state.guests && state.seated < state.guests) {
      return {
        tab: 'seating',
        title: 'Seat remaining guests',
        body: `${state.guests - state.seated} guest${state.guests - state.seated === 1 ? '' : 's'} still need a table.`,
        button: 'Open seating',
      };
    }
    return {
      tab: 'share',
      title: 'Share your wedding website',
      body: 'Everything looks healthy. Copy the link or QR code and send it to guests.',
      button: 'Open share tools',
    };
  }

  function enhanceOverview(dialog) {
    const pane = dialog.querySelector('[data-pane="overview"]');
    const panel = pane?.querySelector('.ww-app-panel');
    if (!panel || panel.dataset.wwProductOverview === 'true') {
      return;
    }

    panel.dataset.wwProductOverview = 'true';
    const state = overviewState(panel);
    const items = completionItems(state);
    const done = items.filter(item => item.done).length;
    const percent = Math.round((done / items.length) * 100);
    const action = nextAction(state);
    const command = document.createElement('div');
    command.className = 'ww-product-command';
    command.innerHTML = `
      <section class="ww-product-next">
        <div>
          <span class="ww-product-kicker">Next best action</span>
          <h4>${esc(action.title)}</h4>
          <p>${esc(action.body)}</p>
        </div>
        <button type="button" class="cta small" data-ww-product-tab="${esc(action.tab)}">${esc(
          action.button
        )}</button>
      </section>
      <section class="ww-product-progress">
        <span class="ww-product-kicker">Setup health</span>
        <h4>${done}/${items.length} complete</h4>
        <div class="ww-progress-track" aria-label="Wedding widget setup ${percent}% complete"><span style="width:${percent}%"></span></div>
        <ul class="ww-progress-list">${items
          .map(
            item => `<li data-done="${item.done}">${item.done ? '✓' : '○'} ${esc(item.label)}</li>`
          )
          .join('')}</ul>
      </section>`;
    panel.prepend(command);
    command.querySelector('[data-ww-product-tab]')?.addEventListener('click', event => {
      switchTab(dialog, event.currentTarget.dataset.wwProductTab);
    });
  }

  function enhanceWorkspace(dialog) {
    const pane = dialog.querySelector('[data-pane="workspace"]');
    const form = pane?.querySelector('#ww-builder');
    const actions = pane?.querySelector('.ww-builder-actions');
    if (!form || form.dataset.wwProductWorkspace === 'true') {
      return;
    }

    form.dataset.wwProductWorkspace = 'true';
    form.classList.add('ww-product-workspace');
    ['coupleNames', 'eventDate', 'ceremonyVenueName', 'welcomeMessage'].forEach(name => {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field) {
        return;
      }
      field.required = true;
      const label = field.closest('label');
      if (label && !label.querySelector('.ww-product-required-hint')) {
        label.insertAdjacentHTML(
          'beforeend',
          '<span class="ww-product-required-hint">Recommended before publishing</span>'
        );
      }
    });

    if (actions && !actions.querySelector('.ww-save-state')) {
      actions.insertAdjacentHTML(
        'beforeend',
        '<span class="ww-save-state" data-state="clean">✓ No unsaved changes</span>'
      );
      const saveState = actions.querySelector('.ww-save-state');
      form.addEventListener(
        'input',
        () => {
          saveState.dataset.state = 'dirty';
          saveState.textContent = 'Unsaved changes';
        },
        { passive: true }
      );
      actions.querySelector('#ww-save')?.addEventListener('click', () => {
        saveState.dataset.state = 'clean';
        saveState.textContent = 'Saving…';
        window.setTimeout(() => {
          if (saveState.isConnected) {
            saveState.textContent = '✓ Saved';
          }
        }, 900);
      });
    }

    pane.querySelectorAll('.rep-add').forEach(button => {
      if (!button.textContent.trim().startsWith('+')) {
        button.textContent = `+ ${button.textContent.trim()}`;
      }
    });
  }

  function enhanceGuests(dialog) {
    const pane = dialog.querySelector('[data-pane="guests"]');
    const table = pane?.querySelector('.ww-table');
    if (!table || pane.querySelector('.ww-guest-card-list')) {
      return;
    }

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const cards = document.createElement('div');
    cards.className = 'ww-guest-card-list';
    cards.innerHTML = rows.length
      ? rows
          .map(row => {
            const cells = Array.from(row.children);
            return `<article class="ww-guest-card"><div class="ww-guest-card__top"><div><strong>${esc(
              cells[0]?.textContent || 'Guest'
            )}</strong><br><small>${esc(cells[6]?.textContent || 'manual')}</small></div>${
              cells[1]?.innerHTML || ''
            }</div><div class="ww-guest-card__meta"><span>Party ${esc(
              cells[2]?.textContent || '1'
            )}</span><span>${esc(cells[5]?.textContent || 'No table')}</span>${
              cells[4]?.textContent ? `<span>${esc(cells[4].textContent)}</span>` : ''
            }</div><div class="ww-actions">${cells[8]?.innerHTML || ''}</div></article>`;
          })
          .join('')
      : '<section class="ww-product-empty"><h4>No guests match this view</h4><p>Try another filter or add a guest to start building your RSVP list.</p></section>';
    table.closest('.ww-table-wrap')?.after(cards);
    cards.querySelectorAll('.ww-edit').forEach(button => {
      button.addEventListener('click', () => {
        table.querySelector(`.ww-edit[data-id="${cssEscape(button.dataset.id)}"]`)?.click();
      });
    });
    cards.querySelectorAll('.ww-del').forEach(button => {
      button.addEventListener('click', () => {
        table.querySelector(`.ww-del[data-id="${cssEscape(button.dataset.id)}"]`)?.click();
      });
    });
  }

  function enhanceSeating(dialog) {
    const pane = dialog.querySelector('[data-pane="seating"]');
    const panel = pane?.querySelector('.ww-app-panel');
    if (!panel || panel.querySelector('.ww-seating-command')) {
      return;
    }

    const summary = panel.textContent || '';
    const tableCount = summary.match(/Tables:\s*(\d+)/i)?.[1] || '0';
    const seated = summary.match(/Seated:\s*(\d+)/i)?.[1] || '0';
    const unseated = summary.match(/Unseated:\s*(\d+)/i)?.[1] || '0';
    panel
      .querySelector('.ww-actions')
      ?.insertAdjacentHTML(
        'afterend',
        `<section class="ww-seating-command"><span class="ww-product-kicker">Planner command bar</span><h4>Keep tables balanced and guest needs visible</h4><div class="ww-seating-command__chips"><span>${esc(
          tableCount
        )} tables</span><span>${esc(seated)} seated</span><span>${esc(
          unseated
        )} unseated</span></div><p class="small">Use table capacity, dietary/access notes and the unseated list to quickly spot anything that needs attention.</p></section>`
      );
  }

  function enhanceShare(dialog) {
    const pane = dialog.querySelector('[data-pane="share"]');
    const card = pane?.querySelector('.ww-share-card, .ww-app-panel');
    if (!card || pane.querySelector('.ww-share-publishing-centre')) {
      return;
    }

    const url =
      pane.querySelector('input[readonly]')?.value ||
      pane.querySelector('.ww-link-preview')?.textContent ||
      '';
    const section = document.createElement('section');
    section.className = 'ww-share-publishing-centre';
    section.innerHTML = `<div><span class="ww-product-kicker">Publishing centre</span><h4>Share the right link with confidence</h4><p>${
      url
        ? 'Your guest website link is ready. Copy it, preview it, or download a QR code from this page.'
        : 'Publish your website to unlock guest sharing tools.'
    }</p></div>${
      url
        ? `<a class="cta secondary small" href="${esc(url)}" target="_blank" rel="noopener">View as guest</a>`
        : '<button type="button" class="cta secondary small" data-ww-product-tab="workspace">Finish setup</button>'
    }`;
    card.prepend(section);
    section.querySelector('[data-ww-product-tab]')?.addEventListener('click', event => {
      switchTab(dialog, event.currentTarget.dataset.wwProductTab);
    });
  }

  function installTabKeyboard(dialog) {
    const tabs = Array.from(dialog.querySelectorAll('.ww-app-tabs button'));
    if (!tabs.length || dialog.dataset.wwProductKeyboard === 'true') {
      return;
    }

    dialog.dataset.wwProductKeyboard = 'true';
    tabs.forEach((tab, index) => {
      tab.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowRight') {
          next = (index + 1) % tabs.length;
        }
        if (event.key === 'ArrowLeft') {
          next = (index - 1 + tabs.length) % tabs.length;
        }
        if (event.key === 'Home') {
          next = 0;
        }
        if (event.key === 'End') {
          next = tabs.length - 1;
        }
        tabs[next].focus();
        tabs[next].click();
      });
    });
  }

  function enhanceDialog(dialog) {
    dialog.classList.add('ww-product-enhanced', 'ww-focus-ring');
    installTabKeyboard(dialog);
    enhanceOverview(dialog);
    enhanceWorkspace(dialog);
    enhanceGuests(dialog);
    enhanceSeating(dialog);
    enhanceShare(dialog);
  }

  function run() {
    document.querySelectorAll('.ww-app-dialog').forEach(enhanceDialog);
  }

  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      run();
    });
  }

  function shouldRunForMutation(mutation) {
    return Array.from(mutation.addedNodes).some(node => {
      if (!(node instanceof Element)) {
        return false;
      }
      if (
        node.closest?.(
          '.ww-product-command,.ww-share-publishing-centre,.ww-guest-card-list,.ww-seating-command'
        )
      ) {
        return false;
      }
      return (
        node.matches('.ww-app-dialog,.ww-app-panel,.ww-table-wrap,.ww-share-card') ||
        node.querySelector?.('.ww-app-dialog,.ww-app-panel,.ww-table-wrap,.ww-share-card')
      );
    });
  }

  const observer = new MutationObserver(mutations => {
    if (mutations.some(shouldRunForMutation)) {
      schedule();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener(
    'click',
    event => {
      if (
        event.target instanceof Element &&
        event.target.closest('.ww-app-tabs button,[data-tab]')
      ) {
        [0, 250, 900].forEach(delay => window.setTimeout(schedule, delay));
      }
    },
    true
  );

  injectStyles();
  schedule();
})();
