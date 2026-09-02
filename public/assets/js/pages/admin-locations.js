/**
 * EventFlow UK locations — admin publishing screen
 *
 * Lists every registry city with its editorial state, quality gate and
 * warnings, and lets an admin move a page through the workflow. The gate is
 * shown as the reasons a page is being held back, not just a score, so a
 * refusal to index is actionable.
 *
 * The editor is deliberately separate from the workflow buttons: saving copy
 * sends nothing but `seo` and `content`, so writing a paragraph can never
 * publish a page, request indexing or mark it reviewed by accident.
 */

(function () {
  'use strict';

  const listEl = document.getElementById('efl-admin-list');
  const summaryEl = document.getElementById('efl-admin-summary');
  const filterEl = document.getElementById('efl-admin-filter');
  const needsReviewEl = document.getElementById('efl-admin-needs-review');
  const unmappedDetailsEl = document.getElementById('efl-unmapped-suppliers');
  const unmappedListEl = document.getElementById('efl-unmapped-suppliers-list');
  const dialogEl = document.getElementById('efl-editor');

  if (!listEl) {
    return;
  }

  /** Field limits, replaced by the ones the API reports on first load. */
  let limits = {
    introMaxLength: 1200,
    sectionBodyMaxLength: 4000,
    sectionTitleMaxLength: 120,
    faqQuestionMaxLength: 200,
    faqAnswerMaxLength: 2000,
    maxSections: 8,
    maxFaqs: 10,
  };

  /** Slug currently open in the editor, or null. */
  let editingSlug = null;

  /** City currently open in the editor, or null. */
  let editingCity = null;

  /** URL whose attribution is currently held in the hidden hero fields. */
  let attributedHeroUrl = '';

  /** The live-composed introduction for the city currently open, if any. */
  let currentAutomaticIntro = '';

  /** Whether the editor holds changes that have not been saved. */
  let dirty = false;

  /** Cached CSRF token, fetched once per page load. */
  let csrfToken = null;

  const SEO_TITLE_MAX = 70;
  const SEO_DESCRIPTION_MAX = 160;
  const HERO_URL_MAX = 500;
  const HERO_ALT_MAX = 200;
  const HERO_CREDIT_MAX = 160;
  const HERO_SOURCE_URL_MAX = 500;
  const SOURCE_NAME_MAX = 120;
  const SOURCE_URL_MAX = 500;
  const SOURCE_DATE_MAX = 40;

  /**
   * Escape text for insertion into markup.
   * @param {string} value Raw value.
   * @returns {string} Escaped value.
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Ask the operator a yes/no question, in the page rather than in a browser
   * dialog — admin screens here never use native `confirm`.
   * @param {string} message Question to ask.
   * @param {string} [confirmLabel] Label for the affirmative button.
   * @returns {Promise<boolean>} True when confirmed.
   */
  function adminConfirm(message, confirmLabel) {
    const dialog = document.getElementById('efl-confirm');
    if (!dialog) {
      return Promise.resolve(true);
    }
    document.getElementById('efl-confirm-message').textContent = message;
    document.getElementById('efl-confirm-yes').textContent = confirmLabel || 'Confirm';

    return new Promise(resolve => {
      const finish = answer => {
        dialog.removeEventListener('click', onClick);
        dialog.removeEventListener('cancel', onCancel);
        if (typeof dialog.close === 'function' && dialog.open) {
          dialog.close();
        } else {
          dialog.removeAttribute('open');
        }
        resolve(answer);
      };
      function onClick(event) {
        const button = event.target.closest('button[data-confirm]');
        if (button) {
          finish(button.getAttribute('data-confirm') === 'yes');
        }
      }
      function onCancel(event) {
        event.preventDefault();
        finish(false);
      }

      dialog.addEventListener('click', onClick);
      dialog.addEventListener('cancel', onCancel);
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', 'open');
      }
    });
  }

  /**
   * The CSRF token for state-changing requests.
   *
   * The cookie is the source of truth, but it is only set once something has
   * asked for it, so fall back to the endpoint that mints one.
   * @returns {Promise<string>} Token, or an empty string.
   */
  async function getCsrfToken() {
    if (csrfToken) {
      return csrfToken;
    }
    const fromCookie = window.EventFlowCsrf ? window.EventFlowCsrf.get() : '';
    if (fromCookie) {
      csrfToken = fromCookie;
      return csrfToken;
    }
    try {
      const response = await fetch('/api/csrf-token', { credentials: 'same-origin' });
      const payload = await response.json();
      csrfToken = payload.csrfToken || payload.token || '';
    } catch (error) {
      csrfToken = '';
    }
    return csrfToken;
  }

  /**
   * Call the admin API.
   * @param {string} url Endpoint.
   * @param {Object} [options] Fetch options.
   * @returns {Promise<Object>} Response payload data.
   */
  async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (options.method && options.method !== 'GET') {
      headers['X-CSRF-Token'] = await getCsrfToken();
    }
    const response = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error((payload && payload.error) || 'Request failed');
    }
    return payload.data;
  }

  /**
   * Render a details block, or nothing when the list is empty.
   * @param {string} summary Summary text.
   * @param {string[]} items List items.
   * @returns {string} HTML.
   */
  function renderDetails(summary, items) {
    if (!items || !items.length) {
      return '';
    }
    const listItems = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
    return `<details><summary>${escapeHtml(summary)}</summary><ul>${listItems}</ul></details>`;
  }

  /**
   * A one-line explanation of what a page's state means for the public.
   * @param {Object} item Admin row.
   * @returns {string} Explanation.
   */
  function describeState(item) {
    if (item.status === 'pilot') {
      return 'Pilot: publicly visible to anyone with the link, but noindex.';
    }
    if (item.status === 'published') {
      return item.indexable
        ? 'Published and indexable.'
        : 'Published and public, but held back from search engines by the gate.';
    }
    return `${item.status}: not reachable by the public.`;
  }

  /**
   * Render one city card.
   * @param {Object} item Admin row.
   * @returns {string} Card HTML.
   */
  function renderCard(item) {
    const reviewed = item.lastReviewedAt ? String(item.lastReviewedAt).slice(0, 10) : 'never';
    const publicPreview =
      item.status === 'pilot' || item.status === 'published'
        ? `<a class="efl-btn efl-btn--ghost" href="/locations/${escapeHtml(item.slug)}" target="_blank" rel="noopener">Public page</a>`
        : '';

    return `<div class="efl-card" data-slug="${escapeHtml(item.slug)}">
      <h3>${escapeHtml(item.name)}</h3>
      <p class="efl-card__meta">
        <span class="efl-relationship">${escapeHtml(item.status)}</span>
        <span>Score ${escapeHtml(item.gate.score)}/${escapeHtml(item.gate.passMark)}</span>
        <span>${item.indexable ? 'Indexable' : 'Not indexable'}</span>
        ${item.managedBy === 'automation' ? '<span title="Published automatically once it had real supplier coverage. Saving here hands it to you.">Auto-published</span>' : ''}
        ${item.needsReview ? '<span class="efl-badge efl-badge--warn" title="Auto-published and no human has reviewed it yet">Needs review</span>' : ''}
      </p>
      <p class="efl-note">${escapeHtml(describeState(item))}</p>
      <p>${escapeHtml(item.supplierCount)} suppliers · ${escapeHtml(item.categoryCount)} categories · reviewed ${escapeHtml(reviewed)}</p>
      ${renderDetails('Why it cannot be indexed', item.gate.blockers)}
      ${renderDetails('Editorial warnings', item.warnings)}
      ${renderDetails(
        'Guides shown on this page',
        (item.guides || []).map(guide => guide.title)
      )}
      <p class="efl-actions">
        <button type="button" class="efl-btn efl-btn--solid" data-action="edit">Edit</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="pilot">Pilot</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="publish">Publish</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="index">${
          item.indexingRequested ? 'Stop requesting indexing' : 'Request indexing'
        }</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="review">Mark reviewed</button>
        <button type="button" class="efl-btn efl-btn--ghost" data-action="draft-preview">Preview draft</button>
        ${publicPreview}
      </p>
    </div>`;
  }

  /**
   * Load and render the list.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function load() {
    const params = new URLSearchParams();
    if (filterEl && filterEl.value) {
      params.set('status', filterEl.value);
    }
    if (needsReviewEl && needsReviewEl.checked) {
      params.set('needsReview', 'true');
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    try {
      const data = await api(`/api/v1/admin/locations${query}`);
      if (data.limits) {
        limits = { ...limits, ...data.limits };
      }
      const needsReview = data.summary.needsReview
        ? ` · ${data.summary.needsReview} need review`
        : '';
      const unmapped = data.summary.unmappedSuppliers
        ? ` · ${data.summary.unmappedSuppliers} suppliers not yet placed on a city`
        : '';
      summaryEl.textContent = `${data.summary.total} cities · ${data.summary.published} published · ${data.summary.pilot} in pilot · ${data.summary.indexable} indexable${needsReview}${unmapped}`;
      listEl.innerHTML = data.items.map(renderCard).join('');
      renderUnmappedSuppliers(data.summary.unmappedSupplierList || []);
    } catch (error) {
      summaryEl.textContent = `Could not load location pages: ${error.message}`;
    }
  }

  /**
   * Show the suppliers the registry could not place on any city page, so an
   * admin can see who they are without a database query.
   * @param {Object[]} suppliers Unmapped supplier summaries.
   * @returns {void} Nothing.
   */
  function renderUnmappedSuppliers(suppliers) {
    if (!unmappedDetailsEl || !unmappedListEl) {
      return;
    }
    if (!suppliers.length) {
      unmappedDetailsEl.hidden = true;
      unmappedListEl.innerHTML = '';
      return;
    }
    unmappedDetailsEl.hidden = false;
    unmappedListEl.innerHTML = suppliers
      .map(
        supplier =>
          `<li><strong>${escapeHtml(supplier.name)}</strong>${
            supplier.rawLocation ? ` — "${escapeHtml(supplier.rawLocation)}"` : ''
          }</li>`
      )
      .join('');
  }

  // ─── Editor ────────────────────────────────────────────────────────────────

  /**
   * Mark the editor as holding unsaved work.
   * @param {boolean} value Whether there are unsaved changes.
   * @returns {void} Nothing.
   */
  function setDirty(value) {
    dirty = value;
    const note = document.getElementById('efl-editor-dirty');
    if (note) {
      note.textContent = value ? 'Unsaved changes' : '';
    }
  }

  /**
   * Show a character counter beneath a field.
   * @param {HTMLElement} noteEl Note element.
   * @param {HTMLElement} fieldEl Field element.
   * @param {number} max Maximum length.
   * @returns {void} Nothing.
   */
  function updateCounter(noteEl, fieldEl, max) {
    if (!noteEl || !fieldEl) {
      return;
    }
    const length = fieldEl.value.length;
    noteEl.textContent = `${length} / ${max}`;
    noteEl.classList.toggle('efl-field-note--over', length > max);
  }

  /**
   * Wire a field to its counter and to the dirty flag.
   * @param {HTMLElement} fieldEl Field element.
   * @param {HTMLElement} noteEl Note element.
   * @param {number} max Maximum length.
   * @returns {void} Nothing.
   */
  function bindField(fieldEl, noteEl, max) {
    if (!fieldEl) {
      return;
    }
    fieldEl.setAttribute('maxlength', String(max));
    const sync = () => {
      updateCounter(noteEl, fieldEl, max);
      if (fieldEl.id === 'efl-hero-url' && fieldEl.value.trim() !== attributedHeroUrl) {
        document.getElementById('efl-hero-credit').value = '';
        document.getElementById('efl-hero-source-url').value = '';
        attributedHeroUrl = '';
      }
      if (fieldEl.id === 'efl-hero-url' || fieldEl.id === 'efl-hero-alt') {
        updateHeroPreview();
      }
      if (fieldEl.id === 'efl-intro') {
        updateAutomaticIntroNote(currentAutomaticIntro);
      }
      setDirty(true);
    };
    fieldEl.addEventListener('input', sync);
    updateCounter(noteEl, fieldEl, max);
  }

  /**
   * Reflect the selected hero and its Pexels credit in the editor.
   * @returns {void} Nothing.
   */
  function updateHeroPreview() {
    const previewEl = document.getElementById('efl-hero-picker-preview');
    const imageEl = document.getElementById('efl-hero-picker-image');
    const creditEl = document.getElementById('efl-hero-picker-credit');
    const imageUrl = document.getElementById('efl-hero-url').value.trim();
    const alt = document.getElementById('efl-hero-alt').value.trim();
    const credit = document.getElementById('efl-hero-credit').value.trim();
    const sourceUrl = document.getElementById('efl-hero-source-url').value.trim();

    previewEl.hidden = !imageUrl;
    if (!imageUrl) {
      imageEl.removeAttribute('src');
      imageEl.alt = '';
      creditEl.replaceChildren();
      return;
    }

    imageEl.src = imageUrl;
    imageEl.alt = alt;
    creditEl.replaceChildren();
    if (credit && sourceUrl) {
      const link = document.createElement('a');
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'nofollow noopener';
      link.textContent = `Photo by ${credit} on Pexels`;
      creditEl.appendChild(link);
    } else {
      creditEl.textContent = credit ? `Photo by ${credit}` : 'Hero image preview';
    }
  }

  /**
   * Which hero-source radio is currently checked.
   * @returns {string} 'auto' or 'custom'.
   */
  function heroSource() {
    return document.getElementById('efl-hero-source-custom').checked ? 'custom' : 'auto';
  }

  /**
   * Reflect the selected hero source in the note beneath the toggle.
   * @returns {void} Nothing.
   */
  function updateHeroSourceNote() {
    const noteEl = document.getElementById('efl-hero-source-note');
    noteEl.textContent =
      heroSource() === 'custom'
        ? 'This city shows the image below. If it is ever removed or fails to load, the page falls back to the named-city placeholder.'
        : 'This city shows a curated or automatically resolved Pexels photo, refreshed on its own. Any image saved below is kept but not shown until you switch to Custom image.';
  }

  /**
   * Show, when relevant, that a city with no written introduction is not
   * actually blank to visitors — an automatic one is composed from real
   * supplier data. Hidden the moment the field holds anything a human wrote.
   * @param {string|null} automaticIntro The live-composed introduction, if any.
   * @returns {void} Nothing.
   */
  function updateAutomaticIntroNote(automaticIntro) {
    const noteEl = document.getElementById('efl-intro-automatic-note');
    const introEl = document.getElementById('efl-intro');
    const show = Boolean(automaticIntro) && !introEl.value.trim();
    noteEl.hidden = !show;
    if (show) {
      noteEl.textContent = `No introduction has been written. Visitors currently see this, generated automatically from real supplier data: "${automaticIntro}"`;
    }
  }

  /**
   * Offer the pre-cleared photograph for this city, when there is one.
   *
   * The suggestion is never applied on the editor's behalf: a photo only
   * reaches a public page once somebody has looked at it and saved.
   * @param {Object|null} suggestion Curated hero, when the city has one.
   * @returns {void} Nothing.
   */
  function showHeroSuggestion(suggestion) {
    const button = document.getElementById('efl-hero-suggested');
    const note = document.getElementById('efl-hero-suggested-note');
    const alreadyChosen =
      suggestion && document.getElementById('efl-hero-url').value.trim() === suggestion.url;

    button.hidden = !suggestion || alreadyChosen;
    note.hidden = button.hidden;
    if (!button.hidden) {
      note.textContent = `Suggested: ${suggestion.alt} — photo by ${suggestion.credit} on Pexels. Check it looks right before you save.`;
    }
  }

  /**
   * Apply the suggested photograph to the hero fields.
   * @returns {void} Nothing.
   */
  function useSuggestedHero() {
    const suggestion = editingCity && editingCity.suggestedHero;
    if (!suggestion) {
      return;
    }
    document.getElementById('efl-hero-url').value = suggestion.url;
    document.getElementById('efl-hero-alt').value = suggestion.alt;
    document.getElementById('efl-hero-credit').value = suggestion.credit;
    document.getElementById('efl-hero-source-url').value = suggestion.sourceUrl;
    attributedHeroUrl = suggestion.url;
    // Applying a specific photo only means something if it is actually shown.
    document.getElementById('efl-hero-source-custom').checked = true;
    updateHeroSourceNote();
    updateCounter(
      document.querySelector('[data-counter-for="efl-hero-url"]'),
      document.getElementById('efl-hero-url'),
      HERO_URL_MAX
    );
    updateHeroPreview();
    showHeroSuggestion(suggestion);
    setDirty(true);
  }

  /**
   * Open Pexels with a city-specific search and apply the selected photo.
   * @returns {void} Nothing.
   */
  function choosePexelsPhoto() {
    const errorsEl = document.getElementById('efl-editor-errors');
    if (!editingCity || typeof window.PexelsSelector !== 'function') {
      errorsEl.textContent = 'The Pexels photo chooser is unavailable. Refresh and try again.';
      return;
    }

    errorsEl.textContent = '';
    const selector = new window.PexelsSelector();
    const nation = editingCity.nation || 'United Kingdom';
    selector.open(
      (imageUrl, photo = {}) => {
        document.getElementById('efl-hero-url').value = imageUrl;
        document.getElementById('efl-hero-alt').value =
          photo.alt || `${editingCity.name} cityscape`;
        document.getElementById('efl-hero-credit').value = photo.photographer || 'Pexels';
        document.getElementById('efl-hero-source-url').value = photo.url || '';
        attributedHeroUrl = imageUrl;
        document.getElementById('efl-hero-source-custom').checked = true;
        updateHeroSourceNote();
        updateCounter(
          document.querySelector('[data-counter-for="efl-hero-url"]'),
          document.getElementById('efl-hero-url'),
          HERO_URL_MAX
        );
        updateHeroPreview();
        setDirty(true);
      },
      { searchTerm: `${editingCity.name} ${nation} city skyline landmark` }
    );
  }

  /**
   * Renumber the "Section 1 of 8" labels after any add, move or remove.
   * @param {HTMLElement} containerEl Repeatable container.
   * @param {string} noun Singular noun for the label.
   * @param {number} max Maximum entries allowed.
   * @returns {void} Nothing.
   */
  function renumber(containerEl, noun, max) {
    const items = [...containerEl.children];
    items.forEach((item, index) => {
      const label = item.querySelector('.efl-repeatable__label');
      if (label) {
        label.textContent = `${noun} ${index + 1} of ${items.length} (maximum ${max})`;
      }
      const up = item.querySelector('[data-move="up"]');
      const down = item.querySelector('[data-move="down"]');
      if (up) {
        up.disabled = index === 0;
      }
      if (down) {
        down.disabled = index === items.length - 1;
      }
    });
  }

  /**
   * Add one repeatable row.
   * @param {string} templateId Template element id.
   * @param {HTMLElement} containerEl Container element.
   * @param {Object} values Initial values keyed by `data-field`.
   * @param {Object} maxima Maximum length per field.
   * @returns {HTMLElement} The new row.
   */
  function addRow(templateId, containerEl, values, maxima) {
    const template = document.getElementById(templateId);
    const row = template.content.firstElementChild.cloneNode(true);

    Object.keys(maxima).forEach(field => {
      const fieldEl = row.querySelector(`[data-field="${field}"]`);
      if (!fieldEl) {
        return;
      }
      fieldEl.value = values[field] === null || values[field] === undefined ? '' : values[field];
      bindField(fieldEl, row.querySelector(`[data-counter="${field}"]`), maxima[field]);
    });

    containerEl.appendChild(row);
    return row;
  }

  const SECTION_MAXIMA = () => ({
    title: limits.sectionTitleMaxLength,
    body: limits.sectionBodyMaxLength,
    sourceName: SOURCE_NAME_MAX,
    sourceUrl: SOURCE_URL_MAX,
    sourceDate: SOURCE_DATE_MAX,
  });

  const FAQ_MAXIMA = () => ({
    question: limits.faqQuestionMaxLength,
    answer: limits.faqAnswerMaxLength,
  });

  /**
   * Read the repeatable rows back out of the DOM.
   * @param {HTMLElement} containerEl Container element.
   * @param {string[]} fields Field names.
   * @returns {Object[]} Row values.
   */
  function readRows(containerEl, fields) {
    return [...containerEl.children].map(row => {
      const values = {};
      fields.forEach(field => {
        const fieldEl = row.querySelector(`[data-field="${field}"]`);
        values[field] = fieldEl ? fieldEl.value.trim() : '';
      });
      return values;
    });
  }

  /**
   * Fill the editor with one city's record.
   * @param {Object} record Admin row from the API.
   * @returns {void} Nothing.
   */
  function populateEditor(record) {
    document.getElementById('efl-editor-title').textContent = `Edit ${record.name}`;
    document.getElementById('efl-editor-state').textContent =
      `${describeState(record)} Saving content here does not change that.`;

    const gateEl = document.getElementById('efl-editor-gate');
    gateEl.innerHTML = `${renderDetails('Why it cannot be indexed', record.gate.blockers)}${renderDetails(
      'Editorial warnings',
      record.warnings
    )}`;

    const seo = record.seo || {};
    const content = record.content || {};

    const fields = [
      ['efl-seo-title', seo.title, SEO_TITLE_MAX],
      ['efl-seo-description', seo.metaDescription, SEO_DESCRIPTION_MAX],
      ['efl-hero-url', content.heroImageUrl, HERO_URL_MAX],
      ['efl-hero-alt', content.heroImageAlt, HERO_ALT_MAX],
      ['efl-intro', content.intro, limits.introMaxLength],
    ];

    fields.forEach(([id, value, max]) => {
      const fieldEl = document.getElementById(id);
      fieldEl.value = value === null || value === undefined ? '' : value;
      bindField(fieldEl, document.querySelector(`[data-counter-for="${id}"]`), max);
    });

    currentAutomaticIntro = record.automaticIntro || '';
    updateAutomaticIntroNote(currentAutomaticIntro);

    document.getElementById('efl-hero-credit').value = content.heroImageCredit || '';
    document.getElementById('efl-hero-source-url').value = content.heroImageSourceUrl || '';
    attributedHeroUrl = content.heroImageUrl || '';
    const isCustomHero = content.heroSource === 'custom';
    document.getElementById('efl-hero-source-auto').checked = !isCustomHero;
    document.getElementById('efl-hero-source-custom').checked = isCustomHero;
    updateHeroSourceNote();
    updateHeroPreview();
    showHeroSuggestion(record.suggestedHero || null);

    const sectionsEl = document.getElementById('efl-sections');
    const faqsEl = document.getElementById('efl-faqs');
    sectionsEl.innerHTML = '';
    faqsEl.innerHTML = '';

    (content.planningSections || []).forEach(section => {
      addRow('efl-section-template', sectionsEl, section, SECTION_MAXIMA());
    });
    (content.faqs || []).forEach(faq => {
      addRow('efl-faq-template', faqsEl, faq, FAQ_MAXIMA());
    });

    document.getElementById('efl-sections-note').textContent =
      `Up to ${limits.maxSections} sections. A section needs both a title and a body to be saved.`;
    document.getElementById('efl-faqs-note').textContent =
      `Up to ${limits.maxFaqs} questions. A question needs both a question and an answer to be saved.`;

    renumber(sectionsEl, 'Section', limits.maxSections);
    renumber(faqsEl, 'Question', limits.maxFaqs);
    document.getElementById('efl-editor-errors').textContent = '';
    setDirty(false);
  }

  /**
   * Build the PATCH body.
   *
   * Only `seo` and `content` are ever sent. Publication state, the indexing
   * request and the reviewed stamp are the workflow buttons' business, and this
   * form must not be able to move them.
   * @returns {Object} PATCH body.
   */
  function collectPayload() {
    const sections = readRows(document.getElementById('efl-sections'), [
      'title',
      'body',
      'sourceName',
      'sourceUrl',
      'sourceDate',
    ]);
    const faqs = readRows(document.getElementById('efl-faqs'), ['question', 'answer']);

    return {
      seo: {
        title: document.getElementById('efl-seo-title').value.trim(),
        metaDescription: document.getElementById('efl-seo-description').value.trim(),
      },
      content: {
        heroSource: heroSource(),
        heroImageUrl: document.getElementById('efl-hero-url').value.trim(),
        heroImageAlt: document.getElementById('efl-hero-alt').value.trim(),
        heroImageCredit: document.getElementById('efl-hero-credit').value.trim(),
        heroImageSourceUrl: document.getElementById('efl-hero-source-url').value.trim(),
        intro: document.getElementById('efl-intro').value.trim(),
        planningSections: sections,
        faqs,
      },
    };
  }

  /**
   * Problems that should stop or qualify a save.
   * @param {Object} payload Collected payload.
   * @returns {{blocking: string[], warnings: string[]}} Validation result.
   */
  function validate(payload) {
    const blocking = [];
    const warnings = [];

    const tooLong = (label, value, max) => {
      if (value && value.length > max) {
        blocking.push(`${label} is ${value.length} characters; the limit is ${max}.`);
      }
    };

    tooLong('Page title', payload.seo.title, SEO_TITLE_MAX);
    tooLong('Meta description', payload.seo.metaDescription, SEO_DESCRIPTION_MAX);
    tooLong('Hero image URL', payload.content.heroImageUrl, HERO_URL_MAX);
    tooLong('Hero image alt text', payload.content.heroImageAlt, HERO_ALT_MAX);
    tooLong('Hero image credit', payload.content.heroImageCredit, HERO_CREDIT_MAX);
    tooLong('Hero image source URL', payload.content.heroImageSourceUrl, HERO_SOURCE_URL_MAX);
    tooLong('Introduction', payload.content.intro, limits.introMaxLength);

    if (payload.content.heroImageUrl && !payload.content.heroImageAlt) {
      blocking.push('A hero image needs alt text.');
    }
    if (payload.content.heroSource === 'custom' && !payload.content.heroImageUrl) {
      warnings.push(
        'Custom image is selected but no image URL is set, so the automatic photo will show instead.'
      );
    }
    if (payload.content.heroImageUrl && !/^https?:\/\//i.test(payload.content.heroImageUrl)) {
      blocking.push('The hero image URL must start with http:// or https://.');
    }
    if (
      payload.content.heroImageSourceUrl &&
      !/^https?:\/\//i.test(payload.content.heroImageSourceUrl)
    ) {
      blocking.push('The hero image source URL must start with http:// or https://.');
    }

    payload.content.planningSections.forEach((section, index) => {
      const position = index + 1;
      tooLong(`Section ${position} title`, section.title, limits.sectionTitleMaxLength);
      tooLong(`Section ${position} body`, section.body, limits.sectionBodyMaxLength);
      if (section.sourceUrl && !/^https?:\/\//i.test(section.sourceUrl)) {
        blocking.push(`Section ${position} has a source URL that is not http:// or https://.`);
      }
      if (!section.title || !section.body) {
        warnings.push(
          `Section ${position} has no ${section.title ? 'body' : 'title'} and will be discarded.`
        );
      }
    });

    payload.content.faqs.forEach((faq, index) => {
      const position = index + 1;
      tooLong(`Question ${position}`, faq.question, limits.faqQuestionMaxLength);
      tooLong(`Answer ${position}`, faq.answer, limits.faqAnswerMaxLength);
      if (!faq.question || !faq.answer) {
        warnings.push(
          `Question ${position} has no ${faq.question ? 'answer' : 'question'} and will be discarded.`
        );
      }
    });

    if (payload.content.planningSections.length > limits.maxSections) {
      blocking.push(`Only ${limits.maxSections} planning sections are kept; remove some first.`);
    }
    if (payload.content.faqs.length > limits.maxFaqs) {
      blocking.push(`Only ${limits.maxFaqs} questions are kept; remove some first.`);
    }

    return { blocking, warnings };
  }

  /**
   * Open the editor for one city.
   * @param {string} slug City slug.
   * @returns {Promise<void>} Resolves when open.
   */
  async function openEditor(slug) {
    try {
      const record = await api(`/api/v1/admin/locations/${encodeURIComponent(slug)}`);
      if (record.limits) {
        limits = { ...limits, ...record.limits };
      }
      editingSlug = record.slug;
      editingCity = record;
      populateEditor(record);
      if (typeof dialogEl.showModal === 'function') {
        dialogEl.showModal();
      } else {
        dialogEl.setAttribute('open', 'open');
      }
    } catch (error) {
      summaryEl.textContent = `Could not open the editor: ${error.message}`;
    }
  }

  /**
   * Close the editor, asking first when there is unsaved work.
   * @returns {Promise<void>} Resolves when closed, or when the close is refused.
   */
  async function closeEditor() {
    if (dirty) {
      const discard = await adminConfirm(
        'Discard your unsaved changes to this page?',
        'Discard changes'
      );
      if (!discard) {
        return;
      }
    }
    editingSlug = null;
    editingCity = null;
    attributedHeroUrl = '';
    currentAutomaticIntro = '';
    setDirty(false);
    if (typeof dialogEl.close === 'function' && dialogEl.open) {
      dialogEl.close();
    } else {
      dialogEl.removeAttribute('open');
    }
  }

  /**
   * Save the editor's content.
   * @returns {Promise<void>} Resolves when saved.
   */
  async function save() {
    const errorsEl = document.getElementById('efl-editor-errors');
    const payload = collectPayload();
    const { blocking, warnings } = validate(payload);

    if (blocking.length) {
      errorsEl.textContent = blocking.join(' ');
      return;
    }
    if (warnings.length) {
      const proceed = await adminConfirm(`${warnings.join(' ')} Save anyway?`, 'Save anyway');
      if (!proceed) {
        return;
      }
    }

    errorsEl.textContent = '';
    try {
      const record = await api(`/api/v1/admin/locations/${encodeURIComponent(editingSlug)}`, {
        method: 'PATCH',
        body: payload,
      });
      setDirty(false);
      populateEditor({ ...record, limits });
      summaryEl.textContent = `Saved ${record.name}.`;
      await load();
    } catch (error) {
      errorsEl.textContent = `Save failed: ${error.message}`;
    }
  }

  const ACTIONS = {
    pilot: { status: 'pilot' },
    publish: { status: 'published' },
    review: { markReviewed: true },
  };

  listEl.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    const slug = button.closest('[data-slug]').getAttribute('data-slug');
    const action = button.getAttribute('data-action');

    if (action === 'edit') {
      await openEditor(slug);
      return;
    }
    if (action === 'draft-preview') {
      window.open(
        `/api/v1/admin/locations/${encodeURIComponent(slug)}/preview`,
        '_blank',
        'noopener'
      );
      return;
    }

    const body =
      action === 'index'
        ? { indexingRequested: button.textContent.indexOf('Stop') === -1 }
        : ACTIONS[action];
    if (!body) {
      return;
    }

    button.disabled = true;
    try {
      await api(`/api/v1/admin/locations/${encodeURIComponent(slug)}`, { method: 'PATCH', body });
      await load();
    } catch (error) {
      summaryEl.textContent = `Update failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  if (dialogEl) {
    dialogEl.addEventListener('change', event => {
      if (event.target && event.target.name === 'heroSource') {
        updateHeroSourceNote();
        setDirty(true);
      }
    });

    dialogEl.addEventListener('click', async event => {
      const moveButton = event.target.closest('button[data-move]');
      if (moveButton) {
        const item = moveButton.closest('[data-repeat]');
        const container = item.parentElement;
        const direction = moveButton.getAttribute('data-move');
        if (direction === 'up' && item.previousElementSibling) {
          container.insertBefore(item, item.previousElementSibling);
        } else if (direction === 'down' && item.nextElementSibling) {
          container.insertBefore(item.nextElementSibling, item);
        }
        renumber(
          container,
          container.id === 'efl-sections' ? 'Section' : 'Question',
          container.id === 'efl-sections' ? limits.maxSections : limits.maxFaqs
        );
        setDirty(true);
        return;
      }

      const removeButton = event.target.closest('button[data-remove]');
      if (removeButton) {
        const item = removeButton.closest('[data-repeat]');
        const container = item.parentElement;
        item.remove();
        renumber(
          container,
          container.id === 'efl-sections' ? 'Section' : 'Question',
          container.id === 'efl-sections' ? limits.maxSections : limits.maxFaqs
        );
        setDirty(true);
        return;
      }

      const actionButton = event.target.closest('button[data-editor-action]');
      if (!actionButton) {
        return;
      }
      const action = actionButton.getAttribute('data-editor-action');

      if (action === 'add-section') {
        const container = document.getElementById('efl-sections');
        if (container.children.length >= limits.maxSections) {
          document.getElementById('efl-editor-errors').textContent =
            `Only ${limits.maxSections} planning sections are kept.`;
          return;
        }
        addRow('efl-section-template', container, {}, SECTION_MAXIMA());
        renumber(container, 'Section', limits.maxSections);
        setDirty(true);
      } else if (action === 'choose-pexels') {
        choosePexelsPhoto();
      } else if (action === 'use-suggested-hero') {
        useSuggestedHero();
      } else if (action === 'add-faq') {
        const container = document.getElementById('efl-faqs');
        if (container.children.length >= limits.maxFaqs) {
          document.getElementById('efl-editor-errors').textContent =
            `Only ${limits.maxFaqs} questions are kept.`;
          return;
        }
        addRow('efl-faq-template', container, {}, FAQ_MAXIMA());
        renumber(container, 'Question', limits.maxFaqs);
        setDirty(true);
      } else if (action === 'save') {
        await save();
      } else if (action === 'preview') {
        // The preview renders what is stored, so offering it over unsaved work
        // would show the editor something other than what they are looking at.
        if (dirty) {
          document.getElementById('efl-editor-errors').textContent =
            'Save your changes first — the preview renders the saved page.';
          return;
        }
        document.getElementById('efl-editor-errors').textContent = '';
        window.open(
          `/api/v1/admin/locations/${encodeURIComponent(editingSlug)}/preview`,
          '_blank',
          'noopener'
        );
      } else if (action === 'close') {
        await closeEditor();
      }
    });

    // Escape closes a native dialog without going through our handler, so the
    // unsaved-changes question has to be asked here too.
    dialogEl.addEventListener('cancel', event => {
      event.preventDefault();
      closeEditor();
    });
  }

  window.addEventListener('beforeunload', event => {
    if (!dirty) {
      return undefined;
    }
    event.preventDefault();
    event.returnValue = '';
    return '';
  });

  if (filterEl) {
    filterEl.addEventListener('change', load);
  }
  if (needsReviewEl) {
    needsReviewEl.addEventListener('change', load);
  }

  load();
})();
