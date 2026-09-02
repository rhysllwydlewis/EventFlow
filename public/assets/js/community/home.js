/**
 * EventFlow Community — homepage
 *
 * Renders only the modules that have genuine content. A module with nothing in
 * it is removed rather than shown as an empty box.
 */

'use strict';
(function () {
  const EFC = window.EFCommunity;
  const root = document.getElementById('efc-home');
  if (!EFC || !root) {
    return;
  }

  const TABS = [
    { key: 'recentActivity', label: 'Latest activity' },
    { key: 'recentDiscussions', label: 'New discussions' },
    { key: 'popular', label: 'Popular' },
    { key: 'mostViewed', label: 'Most viewed' },
    { key: 'unanswered', label: 'Needs an answer' },
    { key: 'following', label: 'Following' },
  ];

  let data = null;
  let activeTab = 'recentActivity';

  /**
   * Fill the two preview rails that flank the hero.
   *
   * The left rail shows what has just happened and the right shows what is
   * drawing people in, so the two sides say different things rather than
   * repeating one list split in half. Anything already on the left is skipped
   * on the right for the same reason.
   * @returns {void} Nothing.
   */
  function renderRails() {
    const left = document.getElementById('efc-rail-left');
    const right = document.getElementById('efc-rail-right');
    if (!left || !right) {
      return;
    }

    const recent = (data.recentActivity || []).slice(0, 3);
    const seen = new Set(recent.map(item => item.stableId));
    const pool = (data.trending || []).concat(data.popular || [], data.recentDiscussions || []);
    const highlights = [];
    for (const item of pool) {
      if (highlights.length === 3) {
        break;
      }
      if (!seen.has(item.stableId)) {
        seen.add(item.stableId);
        highlights.push(item);
      }
    }

    left.innerHTML = recent.map(EFC.previewCard).join('');
    right.innerHTML = highlights.map(EFC.previewCard).join('');

    // A young community may not have six discussions to show. An empty rail is
    // removed rather than left as a gap, and its label goes with it so a
    // screen reader is not offered a landmark with nothing inside.
    [left, right].forEach(list => {
      const rail = list.closest('.efc-rail');
      if (rail) {
        rail.hidden = list.children.length === 0;
      }
    });
  }

  /**
   * Fill the category strip beneath the hero.
   * @returns {void} Nothing.
   */
  function renderCategoryStrip() {
    const strip = document.getElementById('efc-catstrip');
    if (!strip) {
      return;
    }

    // Busiest first: the strip is a way in, and leading with categories nobody
    // has posted in yet sends a reader to a dead end.
    const ordered = data.categories
      .slice()
      .sort((a, b) => b.discussionCount - a.discussionCount || a.name.localeCompare(b.name));

    if (!ordered.length) {
      strip.hidden = true;
      return;
    }

    const chevron =
      '<svg class="efc-cattile__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

    const tiles = ordered
      .map(category => {
        const count = EFC.compactCount(category.discussionCount);
        const noun = category.discussionCount === 1 ? 'discussion' : 'discussions';
        return `<li class="efc-catstrip__item">
          <a class="efc-cattile" href="/community/category/${EFC.esc(category.slug)}">
            <span class="efc-caticon">${EFC.categoryIcon(category)}</span>
            <span class="efc-cattile__text">
              <span class="efc-cattile__name">${EFC.esc(category.name)}</span>
              <span class="efc-cattile__count">${count} ${noun}</span>
            </span>
            ${chevron}
          </a>
        </li>`;
      })
      .join('');

    // The nav buttons are a pointer affordance layered over a scroller that is
    // already fully reachable without them: every tile is a link, so tabbing
    // scrolls the strip natively, and the same categories are listed in the
    // sidebar. They are therefore hidden from assistive technology and taken
    // out of the tab order rather than announced as controls that duplicate
    // navigation a screen-reader user already has.
    const navButton = (dir, label, path) =>
      `<div class="efc-catstrip__edge efc-catstrip__edge--${dir}" data-edge="${dir}" hidden>
        <button type="button" class="efc-catstrip__nav" data-scroll="${dir}" tabindex="-1" aria-hidden="true" title="${label}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>
        </button>
      </div>`;

    strip.innerHTML = `<nav aria-label="Browse by category"><ul class="efc-catstrip__scroller">${tiles}</ul></nav>${navButton(
      'start',
      'Scroll categories left',
      'm15 6-6 6 6 6'
    )}${navButton('end', 'Scroll categories right', 'm9 6 6 6-6 6')}`;
    strip.hidden = false;
    wireCategoryStrip(strip);
  }

  /**
   * Make the category strip's edge buttons scroll it, and show each one only
   * while there is actually something to scroll to in that direction.
   * @param {HTMLElement} strip The `#efc-catstrip` container.
   * @returns {void} Nothing.
   */
  function wireCategoryStrip(strip) {
    const scroller = strip.querySelector('.efc-catstrip__scroller');
    const startEdge = strip.querySelector('[data-edge="start"]');
    const endEdge = strip.querySelector('[data-edge="end"]');
    if (!scroller || !startEdge || !endEdge) {
      return;
    }

    /**
     * Show or hide each edge from the scroller's current position.
     * @returns {void} Nothing.
     */
    function sync() {
      // A sub-pixel gap is not "more content": rounding at some zoom levels
      // leaves a fraction of a pixel and would otherwise strand a button that
      // scrolls nowhere.
      const remaining = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
      startEdge.hidden = scroller.scrollLeft <= 1;
      endEdge.hidden = remaining <= 1;
    }

    strip.querySelectorAll('[data-scroll]').forEach(button => {
      button.addEventListener('click', () => {
        const direction = button.dataset.scroll === 'start' ? -1 : 1;
        const reduced =
          window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // Just under a full width, so the tile at the edge stays partly in view
        // and the reader keeps their place instead of jumping to a fresh set.
        scroller.scrollBy({
          left: direction * scroller.clientWidth * 0.8,
          behavior: reduced ? 'auto' : 'smooth',
        });
      });
    });

    scroller.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  }

  /**
   * Render a sidebar card only when it has content.
   * @param {string} title Card heading.
   * @param {string} body Card HTML.
   * @param {boolean} hasContent Whether to render at all.
   * @returns {string} HTML or an empty string.
   */
  function sideCard(title, body, hasContent) {
    if (!hasContent) {
      return '';
    }
    return `<section class="efc-side__card"><h2>${EFC.esc(title)}</h2>${body}</section>`;
  }

  /**
   * Render the active feed tab.
   * @returns {string} HTML.
   */
  function renderFeed() {
    if (activeTab === 'following') {
      if (!data.following) {
        return EFC.emptyState(
          'Follow what matters to you',
          'Log in and follow categories or discussions to build your own feed.',
          { href: '/auth?next=/community', label: 'Log in' }
        );
      }
      return `<p class="efc-meta">${EFC.esc(data.following.explanation)}</p>${EFC.discussionList(
        data.following.items,
        {
          title: 'Nothing from what you follow yet',
          body: 'Follow a category to see its newest discussions here.',
          action: { href: '/community/discussions', label: 'Browse categories' },
        }
      )}`;
    }

    const empties = {
      unanswered: {
        title: 'Every question has a reply',
        body: 'There are no unanswered questions right now. That is a good sign.',
        action: { href: '/community/discussions', label: 'Browse all discussions' },
      },
    };
    // A featured discussion is already shown above at full width. Repeating it
    // as the first row of the feed made the page look like it was stuttering.
    // On a young community it may be the only thing there is, so de-duplicating
    // never empties the feed.
    const feed = data[activeTab] || [];
    const featuredIds = new Set((data.featured || []).map(item => item.stableId));
    const deduped = feed.filter(item => !featuredIds.has(item.stableId));
    return EFC.discussionList(deduped.length ? deduped : feed, empties[activeTab] || {});
  }

  /**
   * Render the whole page.
   * @returns {void} Nothing.
   */
  function render() {
    const tabs = TABS.filter(tab => tab.key !== 'following' || data.following)
      .map(
        tab =>
          `<button type="button" class="efc-tab" role="tab" id="efc-tab-${tab.key}" aria-controls="efc-feed" aria-selected="${
            tab.key === activeTab
          }" data-tab="${tab.key}">${EFC.esc(tab.label)}</button>`
      )
      .join('');

    // Categories with activity come first so the sidebar leads with the parts of
    // the community that are actually alive, rather than an alphabetical wall.
    const categories = data.categories
      .slice()
      .sort((a, b) => b.discussionCount - a.discussionCount)
      .map(
        category =>
          `<li><a href="/community/category/${EFC.esc(category.slug)}">${EFC.esc(
            category.icon || ''
          )} ${EFC.esc(category.name)}</a> <span class="efc-meta">${category.discussionCount}</span></li>`
      )
      .join('');

    const recentReplies = data.recentReplies
      .map(
        item => `<li>
          <a href="${EFC.esc(item.discussionUrl)}">${EFC.esc(item.discussionTitle)}</a>
          <p class="efc-meta">${EFC.esc(item.author.displayName)} · ${EFC.esc(
            EFC.timeAgo(item.createdAt)
          )}</p>
        </li>`
      )
      .join('');

    const helpful = data.helpfulMembers
      .map(
        member => `<li>
          <a href="/community/member/${EFC.esc(member.handle)}">${EFC.esc(member.displayName)}</a>
          <span class="efc-meta">${member.helpfulAnswers} helpful ${
            member.helpfulAnswers === 1 ? 'answer' : 'answers'
          }</span>
        </li>`
      )
      .join('');

    const eventTypes = data.eventTypes
      .map(
        item =>
          `<li><a href="/community/discussions?eventType=${EFC.esc(item.key)}">${EFC.esc(
            item.label
          )}</a> <span class="efc-meta">${item.count}</span></li>`
      )
      .join('');

    const regions = data.regions
      .map(
        item =>
          `<li><a href="/community/discussions?region=${EFC.esc(item.key)}">${EFC.esc(
            item.label
          )}</a> <span class="efc-meta">${item.count}</span></li>`
      )
      .join('');

    const featured = data.featured.length
      ? `<section class="efc-section">
          <div class="efc-section__head"><h2>Featured</h2></div>
          ${EFC.discussionList(data.featured)}
        </section>`
      : '';

    root.innerHTML = `
      <div class="efc-grid efc-grid--sidebar">
        <div>
          ${featured}
          <section class="efc-section">
            <div class="efc-section__head">
              <h2 id="efc-feed-heading">Discussions</h2>
              <a class="efc-section__link" href="/community/discussions">All discussions</a>
            </div>
            <div class="efc-tabs" role="tablist" aria-label="Discussion feeds">${tabs}</div>
            <div id="efc-feed" role="tabpanel" aria-labelledby="efc-tab-${activeTab}">${renderFeed()}</div>
          </section>
        </div>
        <aside class="efc-side" aria-label="Community information">
          ${sideCard(
            'Community health',
            `<ul class="efc-side__list">
              <li>${data.counts.discussions} published discussions</li>
              <li>${data.counts.replies} replies</li>
              <li>${data.counts.answeredPercentage}% of discussions have at least one reply</li>
            </ul>
            <p class="efc-meta">We publish what actually helps people, not member or online counts.</p>`,
            data.counts.discussions > 0
          )}
          ${sideCard(
            'Categories',
            `<ul class="efc-side__list efc-side__list--counts efc-side__list--scroll">${categories}</ul>`,
            Boolean(categories)
          )}
          ${sideCard('Recent replies', `<ul class="efc-side__list">${recentReplies}</ul>`, Boolean(recentReplies))}
          ${sideCard('Most helpful members', `<ul class="efc-side__list">${helpful}</ul>`, Boolean(helpful))}
          ${sideCard('Browse by event type', `<ul class="efc-side__list efc-side__list--counts">${eventTypes}</ul>`, Boolean(eventTypes))}
          ${sideCard('Browse by UK region', `<ul class="efc-side__list efc-side__list--counts">${regions}</ul>`, Boolean(regions))}
          <section class="efc-side__card">
            <h2>Before you post</h2>
            <ul class="efc-side__list">
              <li><a href="/community/guidelines">Community guidelines</a></li>
              <li><a href="/community/help">Reporting and appeals</a></li>
              <li><a href="/guides">EventFlow guides</a></li>
            </ul>
          </section>
        </aside>
      </div>
    `;

    root.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        render();
        const panel = document.getElementById('efc-feed');
        if (panel) {
          panel.focus({ preventScroll: true });
        }
      });
    });
  }

  /**
   * Load the homepage payload.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function load() {
    // Swap to the skeleton the instant JS can run, rather than leaving the
    // full no-JS fallback on screen for the whole fetch and then replacing it
    // with a structurally different layout in one jump. The skeleton is
    // shaped like the real page, so filling it in causes far less shift.
    EFC.hideFallback();
    root.innerHTML = EFC.skeleton(4, 'page');
    try {
      data = await EFC.api('home');
      renderRails();
      renderCategoryStrip();
      render();
    } catch (error) {
      root.innerHTML = EFC.errorState(
        'We could not load the community just now. Your connection may be offline.'
      );
      const retry = root.querySelector('[data-efc-retry]');
      if (retry) {
        retry.addEventListener('click', load);
      }
    }
  }

  load();
})();
