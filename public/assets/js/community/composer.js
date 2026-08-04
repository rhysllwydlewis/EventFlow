/**
 * EventFlow Community — start a discussion
 *
 * Controlled rich text only, with live duplicate suggestions, a personal-data
 * warning and category rules shown before anything is published.
 */

(function () {
  'use strict';

  const EFC = window.EFCommunity;
  const root = document.getElementById('efc-composer');
  if (!EFC || !root) {
    return;
  }

  let meta = null;
  let categories = [];
  let viewer = null;
  let suggestTimer = null;
  let draftTimer = null;
  let draftId = null;

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
        <h1>Start a discussion</h1>
        <p>You need an EventFlow account to post. Anyone can read the community.</p>
        <p><a class="btn btn-primary" href="/auth?next=/community/new">Log in or join</a></p>
      </div>`;
      return;
    }
    if (!viewer.emailVerified) {
      root.innerHTML = `<div class="efc-notice" role="alert">
        <h1>Verify your email first</h1>
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
        <h1>Posting is currently restricted</h1>
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

    root.innerHTML = `
      <h1>Start a discussion</h1>
      <p class="efc-meta">Everything you post here is public. Do not include contact details, exact
        addresses or anyone else's personal information.</p>

      ${
        !viewer.adultDeclared
          ? `<div class="efc-notice" role="note" id="efc-adult">
              <p><strong>EventFlow is an 18+ service.</strong></p>
              <p><label><input type="checkbox" id="efc-adult-confirm" /> I confirm I am 18 or over.</label></p>
            </div>`
          : ''
      }

      <form class="efc-composer" id="efc-new-form" novalidate>
        <div class="efc-field">
          <label for="efc-title">Title</label>
          <input id="efc-title" type="text" required minlength="8" maxlength="${meta.limits.titleMax}"
            aria-describedby="efc-title-help" autocomplete="off" />
          <p class="efc-meta" id="efc-title-help">Ask the question you actually want answered.</p>
        </div>

        <div id="efc-suggestions" aria-live="polite"></div>

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
          <label for="efc-body">Your message</label>
          <textarea id="efc-body" required minlength="20" maxlength="${meta.limits.bodyMax}"
            aria-describedby="efc-body-help"></textarea>
          <p class="efc-meta" id="efc-body-help">Plain text and simple formatting. Links are allowed but
            are never followed by search engines.</p>
          <p class="efc-charcount" id="efc-body-count" aria-live="polite"></p>
        </div>

        <div id="efc-privacy-warning" aria-live="polite"></div>

        <div class="efc-field">
          <label for="efc-tags">Tags (optional, comma separated)</label>
          <input id="efc-tags" type="text" maxlength="200" />
        </div>

        <div class="efc-filters__actions">
          <button type="submit" class="btn btn-primary">Post discussion</button>
          <button type="button" class="efc-action" id="efc-save-draft">Save draft</button>
          <a class="efc-action" href="/community">Cancel</a>
        </div>
        <p class="efc-meta" id="efc-draft-status" aria-live="polite"></p>
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
        },
      });

      if (draftId) {
        await EFC.api(`me/drafts/${draftId}`, { method: 'DELETE' }).catch(() => {});
      }
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
   * Boot the composer.
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
      EFC.hideFallback();
      render();

      const preselect = new URLSearchParams(window.location.search).get('category');
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

  boot();
})();
