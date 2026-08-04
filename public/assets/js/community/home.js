/**
 * EventFlow Community — homepage
 *
 * Renders only the modules that have genuine content. A module with nothing in
 * it is removed rather than shown as an empty box.
 */

(function () {
  'use strict';

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
    root.innerHTML = EFC.skeleton(4);
    try {
      data = await EFC.api('home');
      EFC.hideFallback();
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
