/**
 * EventFlow Community — start a discussion
 *
 * Controlled rich text only, with live duplicate suggestions, a personal-data
 * warning and category rules shown before anything is published.
 *
 * The composer renders into whatever element it is given, so the same code
 * serves both surfaces: the standalone `/community/new` page, and a modal
 * opened from a "Start a discussion" button elsewhere in the community. The
 * page is the real thing — the modal is an enhancement layered on top of the
 * ordinary link, so middle-clicking it, opening it in a new tab, or having no
 * JavaScript at all still reaches a working form.
 */

'use strict';
(function () {
  const EFC = window.EFCommunity;
  if (!EFC) {
    return;
  }

  const pageRoot = document.getElementById('efc-composer');

  let root = null;
  let headingTag = 'h1';
  let onClose = null;
  let meta = null;
  let categories = [];
  let viewer = null;
  let suggestTimer = null;
  let draftTimer = null;
  let draftId = null;
  let presetSearch = window.location.search;
  /** Uploaded image descriptors ({ kind: 'image', url, alt }) for the draft in progress. */
  let attachments = [];

  /**
   * Personal-information patterns mirrored from the server-side check so the
   * warning appears before the member presses post.
   */
  const PERSONAL_PATTERNS = [
    { pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, label: 'a postcode' },
    { pattern: /\b(?:0|\+44)\s?\d[\d\s-]{8,}\b/, label: 'a phone number' },
    { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, label: 'an email address' },
  ];

  /**
   * Render the composer form.
   * @returns {void} Nothing.
   */
  function render() {
    if (!viewer) {
      root.innerHTML = `<div class="efc-notice efc-notice--info">
        <${headingTag} id="efc-composer-title">Start a discussion</${headingTag}>
        <p>You need an EventFlow account to post. Anyone can read the community.</p>
        <p><a class="btn btn-primary" href="/auth?next=/community/new">Log in or join</a></p>
      </div>`;
      return;
    }
    if (!viewer.emailVerified) {
      root.innerHTML = `<div class="efc-notice" role="alert">
        <${headingTag} id="efc-composer-title">Verify your email first</${headingTag}>
        <p>Check your inbox for the EventFlow verification link, then come back and post.</p>
      </div>`;
      return;
    }
    if (viewer.restriction) {
      // The API already returns expiresAt. Telling someone they are restricted
      // without saying until when reads as permanent, and is the first thing
      // they would otherwise have to appeal to find out.
      const until = viewer.restriction.expiresAt
        ? `<p class="efc-meta">This lifts on ${EFC.esc(EFC.shortDate(viewer.restriction.expiresAt))}.</p>`
        : '<p class="efc-meta">This restriction does not expire on its own.</p>';
      root.innerHTML = `<div class="efc-notice efc-notice--danger" role="alert">
        <${headingTag} id="efc-composer-title">Posting is currently restricted</${headingTag}>
        <p>${EFC.esc(viewer.restriction.reason || 'A moderator has restricted your community access.')}</p>
        ${until}
        <p><a href="/community/help#appeals">Appeal this decision</a></p>
      </div>`;
      return;
    }

    const categoryOptions = categories
      .map(item => `<option value="${EFC.esc(item.slug)}">${EFC.esc(item.name)}</option>`)
      .join('');
    const eventTypeOptions = ['<option value="">Not specific to one type</option>']
      .concat(
        meta.eventTypes.map(
          item => `<option value="${EFC.esc(item.key)}">${EFC.esc(item.label)}</option>`
        )
      )
      .join('');
    const regionOptions = ['<option value="">Not location specific</option>']
      .concat(
        meta.regions.map(
          item => `<option value="${EFC.esc(item.key)}">${EFC.esc(item.label)}</option>`
        )
      )
      .join('');

    // In a dialog the cancel control has to dismiss the dialog rather than
    // navigate away, or it would throw away the page the member started from.
    const cancel = onClose
      ? '<button type="button" class="efc-action" id="efc-composer-cancel">Cancel</button>'
      : '<a class="efc-action" href="/community">Cancel</a>';

    root.innerHTML = `
      <div class="efc-composer-head">
        <${headingTag} id="efc-composer-title">Start a discussion</${headingTag}>
        <p>Everything you post here is public. Do not include contact details, exact
          addresses or anyone else's personal information.</p>
      </div>

      <form class="efc-composer" id="efc-new-form" novalidate>
        ${
          !viewer.adultDeclared
            ? `<div class="efc-notice efc-notice--age" role="note" id="efc-adult">
                <p class="efc-notice__title"><strong>EventFlow is an 18+ service.</strong></p>
                <label class="efc-check" for="efc-adult-confirm">
                  <input type="checkbox" id="efc-adult-confirm" />
                  <span>I confirm I am 18 or over.</span>
                </label>
              </div>`
            : ''
        }

        <div class="efc-composer-card">
          <div class="efc-field">
            <label for="efc-title">Title</label>
            <input id="efc-title" type="text" required minlength="8" maxlength="${meta.limits.titleMax}"
              aria-describedby="efc-title-help" autocomplete="off"
              placeholder="e.g. Marquee hire in Kent for 120 guests — what should I budget?" />
            <p class="efc-meta" id="efc-title-help">Ask the question you actually want answered.</p>
          </div>

          <div id="efc-suggestions" aria-live="polite"></div>

          <div class="efc-field">
            <label for="efc-body">Your message</label>
            <textarea id="efc-body" required minlength="20" maxlength="${meta.limits.bodyMax}"
              aria-describedby="efc-body-help"
              placeholder="Give people the detail they need to answer well: what you are planning, when, roughly where, and what you have tried already."></textarea>
            <div class="efc-field__foot">
              <p class="efc-meta" id="efc-body-help">Plain text and simple formatting. Links are allowed
                but are never followed by search engines.</p>
              <p class="efc-charcount" id="efc-body-count" aria-live="polite"></p>
            </div>
          </div>

          <div id="efc-privacy-warning" aria-live="polite"></div>

          <div class="efc-field">
            <label for="efc-attachments">Photos (optional)</label>
            <input
              id="efc-attachments"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
            />
            <p class="efc-meta">Up to ${meta.limits.attachmentsMax} images.</p>
            <div id="efc-attachments-preview" class="efc-attachments-preview"></div>
          </div>
        </div>

        <div class="efc-composer-card">
          <p class="efc-composer-legend">Help the right people find it</p>

          <div class="efc-composer__row">
            <div class="efc-field">
              <label for="efc-category">Category</label>
              <select id="efc-category" required>${categoryOptions}</select>
            </div>
            <div class="efc-field">
              <label for="efc-event-type">Event type (optional)</label>
              <select id="efc-event-type">${eventTypeOptions}</select>
            </div>
            <div class="efc-field">
              <label for="efc-region">UK region (optional)</label>
              <select id="efc-region">${regionOptions}</select>
            </div>
            <div class="efc-field">
              <label for="efc-event-date">Event month (optional)</label>
              <input id="efc-event-date" type="month" />
            </div>
          </div>

          <div id="efc-category-rules"></div>

          <div class="efc-field">
            <label for="efc-tags">Tags (optional, comma separated)</label>
            <input id="efc-tags" type="text" maxlength="200"
              aria-describedby="efc-tags-help" placeholder="marquee, budget, kent" />
            <p class="efc-meta" id="efc-tags-help">A few words other members might search for.</p>
          </div>
        </div>

        <div class="efc-composer-actions">
          <button type="submit" class="btn btn-primary">Post discussion</button>
          <button type="button" class="efc-action" id="efc-save-draft">Save draft</button>
          ${cancel}
          <p class="efc-meta efc-composer-status" id="efc-draft-status" aria-live="polite"></p>
        </div>
      </form>
    `;
    wire();
  }

  /**
   * Attach composer behaviour.
   * @returns {void} Nothing.
   */
  function wire() {
    const form = document.getElementById('efc-new-form');
    const title = document.getElementById('efc-title');
    const body = document.getElementById('efc-body');
    const category = document.getElementById('efc-category');

    title.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(suggestDuplicates, 400);
      scheduleDraft();
    });

    body.addEventListener('input', () => {
      const count = body.value.length;
      document.getElementById('efc-body-count').textContent =
        `${count} of ${meta.limits.bodyMax} characters`;
      checkPersonalInformation(body.value);
      scheduleDraft();
    });

    category.addEventListener('change', showCategoryRules);
    showCategoryRules();

    document.getElementById('efc-save-draft').addEventListener('click', () => saveDraft(true));
    form.addEventListener('submit', submit);

    const attachmentsInput = document.getElementById('efc-attachments');
    if (attachmentsInput) {
      attachmentsInput.addEventListener('change', () =>
        handleAttachmentSelection(attachmentsInput)
      );
    }
    renderAttachmentsPreview();

    const cancel = document.getElementById('efc-composer-cancel');
    if (cancel && onClose) {
      cancel.addEventListener('click', () => onClose());
    }
  }

  /**
   * Whether the composer currently holds text the member has not posted.
   * @returns {boolean} True when the title or body has content.
   */
  function hasUnsavedContent() {
    const title = document.getElementById('efc-title');
    const body = document.getElementById('efc-body');
    return Boolean((title && title.value.trim()) || (body && body.value.trim()));
  }

  /**
   * Show the selected category's rules and any safety notice.
   * @returns {void} Nothing.
   */
  function showCategoryRules() {
    const slug = document.getElementById('efc-category').value;
    const category = categories.find(item => item.slug === slug);
    const target = document.getElementById('efc-category-rules');
    if (!category) {
      target.innerHTML = '';
      return;
    }
    const parts = [];
    if (category.rules) {
      parts.push(`<p><strong>Category rules:</strong> ${EFC.esc(category.rules)}</p>`);
    }
    if (category.marketplaceSafetyNotice) {
      parts.push(
        '<p><strong>Buying or selling?</strong> List it on the <a href="/marketplace">EventFlow marketplace</a> so you keep its protections. Do not arrange private sales in a thread.</p>'
      );
    }
    if (category.officialSupport) {
      parts.push(
        '<p>The EventFlow team reads this category. If your question involves your account details, we will move it to a private support ticket rather than answer here.</p>'
      );
    }
    target.innerHTML = parts.length
      ? `<div class="efc-notice efc-notice--info">${parts.join('')}</div>`
      : '';
  }

  /**
   * Ask the server for similar existing discussions.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function suggestDuplicates() {
    const title = document.getElementById('efc-title').value;
    const target = document.getElementById('efc-suggestions');
    if (!title || title.length < 6) {
      target.innerHTML = '';
      return;
    }
    try {
      const data = await EFC.api(`similar?title=${encodeURIComponent(title)}`);
      if (!data.suggestions.length) {
        target.innerHTML = '';
        return;
      }
      target.innerHTML = `<div class="efc-duplicates">
        <p><strong>Someone may have asked this already.</strong> Reading an existing answer is usually faster.</p>
        <ul class="efc-side__list">${data.suggestions
          .map(
            item =>
              `<li><a href="${EFC.esc(item.url)}">${EFC.esc(item.title)}</a> <span class="efc-meta">${
                item.replyCount
              } replies${item.solved ? ' · solved' : ''}${
                item.freshness === 'archive' ? ' · older discussion' : ''
              }</span></li>`
          )
          .join('')}</ul>
      </div>`;
    } catch (_) {
      target.innerHTML = '';
    }
  }

  /**
   * Warn when a draft appears to contain personal information.
   * @param {string} text Draft body.
   * @returns {void} Nothing.
   */
  function checkPersonalInformation(text) {
    const found = PERSONAL_PATTERNS.filter(item => item.pattern.test(text)).map(item => item.label);
    const target = document.getElementById('efc-privacy-warning');
    target.innerHTML = found.length
      ? `<div class="efc-notice" role="note">This looks like it contains ${EFC.esc(
          found.join(' and ')
        )}. Community posts are public — please remove anything you would not want a stranger to see.</div>`
      : '';
  }

  /**
   * Upload each newly-selected image, appending it to `attachments` as it
   * completes. Uploads run one at a time so the preview grid fills in the
   * order the member picked the files.
   * @param {HTMLInputElement} input The file input that changed.
   * @returns {Promise<void>} Resolves once every selected file has settled.
   */
  async function handleAttachmentSelection(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) {
      return;
    }
    const remaining = meta.limits.attachmentsMax - attachments.length;
    if (remaining <= 0) {
      EFC.announce(`You can attach up to ${meta.limits.attachmentsMax} images.`, 'error');
      return;
    }
    const toUpload = files.slice(0, remaining);
    if (files.length > toUpload.length) {
      EFC.announce(
        `Only the first ${toUpload.length} image(s) were added — the limit is ${meta.limits.attachmentsMax}.`,
        'error'
      );
    }
    for (const file of toUpload) {
      try {
        const attachment = await EFC.uploadAttachment(file);
        attachments.push(attachment);
        renderAttachmentsPreview();
      } catch (error) {
        EFC.announce(error.message || 'Could not upload that image.', 'error');
      }
    }
  }

  /**
   * Redraw the attachment preview grid from the current `attachments` state.
   * @returns {void} Nothing.
   */
  function renderAttachmentsPreview() {
    const target = document.getElementById('efc-attachments-preview');
    if (!target) {
      return;
    }
    target.innerHTML = attachments
      .map(
        (item, index) => `
        <div class="efc-attachment-thumb">
          <img src="${EFC.esc(item.url)}" alt="${EFC.esc(item.alt || '')}" loading="lazy" />
          <button type="button" class="efc-attachment-remove" data-index="${index}" aria-label="Remove this image">×</button>
        </div>`
      )
      .join('');
    target.querySelectorAll('.efc-attachment-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        attachments.splice(Number(btn.dataset.index), 1);
        renderAttachmentsPreview();
      });
    });
  }

  /**
   * Debounce a draft save.
   * @returns {void} Nothing.
   */
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(false), 3000);
  }

  /**
   * Save the current draft.
   * @param {boolean} announce Whether to announce success.
   * @returns {Promise<void>} Resolves when saved.
   */
  async function saveDraft(announce) {
    const title = document.getElementById('efc-title');
    const body = document.getElementById('efc-body');
    if (!title || (!title.value && !body.value)) {
      return;
    }
    try {
      const result = await EFC.api('me/drafts', {
        method: 'PUT',
        body: {
          id: draftId,
          title: title.value,
          category: document.getElementById('efc-category').value,
          body: body.value,
        },
      });
      draftId = result.draft.id;
      document.getElementById('efc-draft-status').textContent = 'Draft saved.';
      if (announce) {
        EFC.announce('Draft saved.');
      }
    } catch (_) {
      document.getElementById('efc-draft-status').textContent = 'We could not save your draft.';
    }
  }

  /**
   * Submit the new discussion.
   * @param {Event} event Submit event.
   * @returns {Promise<void>} Resolves when handled.
   */
  async function submit(event) {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');

    const adultCheckbox = document.getElementById('efc-adult-confirm');
    if (adultCheckbox && !adultCheckbox.checked) {
      EFC.announce('Please confirm you are 18 or over.', 'error');
      adultCheckbox.focus();
      return;
    }

    submitButton.disabled = true;
    try {
      if (adultCheckbox && adultCheckbox.checked) {
        await EFC.api('me/adult-declaration', { method: 'POST', body: { confirmed: true } });
      }

      const tags = document
        .getElementById('efc-tags')
        .value.split(',')
        .map(tag => tag.trim())
        .filter(Boolean);

      const result = await EFC.api('discussions', {
        method: 'POST',
        body: {
          title: document.getElementById('efc-title').value,
          category: document.getElementById('efc-category').value,
          body: document.getElementById('efc-body').value,
          eventType: document.getElementById('efc-event-type').value,
          region: document.getElementById('efc-region').value,
          eventDate: document.getElementById('efc-event-date').value,
          tags,
          attachments,
        },
      });

      if (draftId) {
        await EFC.api(`me/drafts/${draftId}`, { method: 'DELETE' }).catch(() => {});
      }
      attachments = [];
      EFC.announce(result.message);
      window.location.href = result.url;
    } catch (error) {
      if (error.status === 401) {
        window.location.href = '/auth?next=/community/new';
        return;
      }
      const details = error.data && error.data.details ? error.data.details.join(' ') : '';
      EFC.announce(`${error.message} ${details}`.trim(), 'error');
      submitButton.disabled = false;
    }
  }

  /**
   * Load the composer's data and render it into the current root.
   * @returns {Promise<void>} Resolves when ready.
   */
  async function boot() {
    root.innerHTML = EFC.skeleton(3);
    try {
      const [metaPayload, categoryPayload, viewerPayload] = await Promise.all([
        EFC.api('meta'),
        EFC.api('categories'),
        EFC.me(),
      ]);
      meta = metaPayload;
      categories = categoryPayload.categories;
      viewer = viewerPayload;
      if (root === pageRoot) {
        // Only the standalone page has a server-rendered fallback of its own to
        // replace. In a modal the page underneath owns its own content.
        EFC.hideFallback();
      }
      render();

      const preselect = new URLSearchParams(presetSearch).get('category');
      const select = document.getElementById('efc-category');
      if (preselect && select) {
        select.value = preselect;
        showCategoryRules();
      }
    } catch (error) {
      EFC.hideFallback();
      root.innerHTML = EFC.errorState('We could not open the composer.');
    }
  }

  /**
   * Render the composer into an element.
   * @param {HTMLElement} target Element to render into.
   * @param {{heading?: string, onClose?: Function, search?: string}} [options]
   *   Render options. `search` supplies the query string the composer reads its
   *   `?category=` preselection from, which is the link's for a modal rather
   *   than the current page's.
   * @returns {Promise<void>} Resolves when the composer is on screen.
   */
  function mount(target, options) {
    const settings = options || {};
    root = target;
    headingTag = settings.heading || 'h1';
    onClose = typeof settings.onClose === 'function' ? settings.onClose : null;
    presetSearch = settings.search || '';
    draftId = null;
    attachments = [];
    return boot();
  }

  /* ── Modal ─────────────────────────────────────────────────────────────
     The dialog is built on demand rather than shipped in every page shell,
     so a page only pays for it if someone actually opens the composer. */

  let dialog = null;
  let returnFocusTo = null;

  /**
   * Close the composer dialog and hand focus back to whatever opened it.
   * @returns {void} Nothing.
   */
  function closeDialog() {
    if (!dialog) {
      return;
    }
    // Both timers are armed by typing. Left running they fire against a form
    // that is no longer on screen — and the draft one would save a copy of the
    // very content the member just chose to discard.
    clearTimeout(draftTimer);
    clearTimeout(suggestTimer);
    dialog.close();
    dialog.querySelector('.efc-dialog__scroll').innerHTML = '';
    if (returnFocusTo && document.contains(returnFocusTo)) {
      returnFocusTo.focus();
    }
    returnFocusTo = null;
  }

  /**
   * Ask before discarding text the member has typed. Drafts autosave, but a
   * modal that vanishes on a stray Escape and takes the post with it is worse
   * than one extra confirmation.
   * @returns {boolean} True when it is safe to close.
   */
  function confirmClose() {
    if (!hasUnsavedContent()) {
      return true;
    }
    return window.confirm(
      'Close the composer? Anything you have not saved as a draft will be lost.'
    );
  }

  /**
   * Build the dialog element once.
   * @returns {HTMLDialogElement} The dialog.
   */
  function ensureDialog() {
    if (dialog) {
      return dialog;
    }
    dialog = document.createElement('dialog');
    dialog.className = 'efc-dialog efc-dialog--composer';
    dialog.id = 'efc-composer-dialog';
    // Every render branch emits a heading carrying this id. aria-label is the
    // fallback for the moment before the first render lands, when the
    // reference would otherwise dangle and leave the dialog unnamed.
    dialog.setAttribute('aria-labelledby', 'efc-composer-title');
    dialog.setAttribute('aria-label', 'Start a discussion');
    dialog.innerHTML = `
      <button type="button" class="efc-dialog__close" aria-label="Close the composer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
      <div class="efc-dialog__scroll"></div>`;

    dialog.querySelector('.efc-dialog__close').addEventListener('click', () => {
      if (confirmClose()) {
        closeDialog();
      }
    });

    // Escape fires `cancel` before the dialog closes, so this is the only place
    // a keyboard dismissal can be intercepted. The default action is always
    // prevented and closeDialog() called instead: letting the browser close the
    // dialog natively skips the teardown, which would leave the discarded draft
    // sitting in the DOM with its autosave timer still armed.
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (confirmClose()) {
        closeDialog();
      }
    });

    document.body.appendChild(dialog);
    return dialog;
  }

  /**
   * Open the composer in a modal over the current page.
   * @param {HTMLElement} [opener] Element to return focus to on close.
   * @param {string} [search] Query string to read the category preselect from.
   * @returns {void} Nothing.
   */
  function openDialog(opener, search) {
    const element = ensureDialog();
    returnFocusTo = opener || null;
    element.showModal();
    mount(element.querySelector('.efc-dialog__scroll'), {
      heading: 'h2',
      search: search || '',
      onClose: () => {
        if (confirmClose()) {
          closeDialog();
        }
      },
    }).then(() => {
      const title = document.getElementById('efc-title');
      if (title) {
        title.focus();
      }
    });
  }

  /**
   * Whether a click should be handled in-page rather than followed as a link.
   * Modified clicks are the member deliberately asking for a new tab or window,
   * and must keep working as ordinary navigation.
   * @param {MouseEvent} event Click event.
   * @returns {boolean} True when the modal should take over.
   */
  function isPlainClick(event) {
    return (
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    );
  }

  window.EFCComposer = { mount, openDialog, closeDialog };

  if (pageRoot) {
    // The standalone /community/new page.
    mount(pageRoot, { heading: 'h1', search: window.location.search });
  } else if (typeof HTMLDialogElement === 'function' && HTMLDialogElement.prototype.showModal) {
    // Anywhere else, upgrade the "Start a discussion" links to open the modal.
    // Without <dialog> support the link is left alone and navigates as usual.
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href^="/community/new"]');
      if (!link || !isPlainClick(event)) {
        return;
      }
      event.preventDefault();
      openDialog(link, link.search);
    });
  }
})();
