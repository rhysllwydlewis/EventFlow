/**
 * EventFlow Community — public member profile and the member's own lists.
 *
 * The same script drives /community/member/:handle, /community/saved and
 * /community/following, because all three are "a list belonging to someone".
 */

'use strict';
(function () {
  const EFC = window.EFCommunity;
  const profileRoot = document.getElementById('efc-member');
  const savedRoot = document.getElementById('efc-saved');
  const followingRoot = document.getElementById('efc-following');
  if (!EFC) {
    return;
  }

  /**
   * Render a public member profile.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function renderProfile() {
    const handle =
      profileRoot.dataset.handle ||
      decodeURIComponent(window.location.pathname.split('/').pop() || '');
    profileRoot.innerHTML = EFC.skeleton(2, 'profile');
    try {
      const data = await EFC.api(`members/${encodeURIComponent(handle)}`);
      EFC.hideFallback();
      const m = data.member;
      const context = [
        m.eventTypeLabel ? EFC.esc(m.eventTypeLabel) : '',
        m.regionLabel ? EFC.esc(m.regionLabel) : '',
      ].filter(Boolean);

      profileRoot.innerHTML = `
        <header class="efc-card">
          <div class="efc-post__head">
            <img class="efc-avatar" src="${EFC.esc(
              m.avatarUrl || '/assets/images/default-avatar.svg'
            )}" alt="" width="40" height="40" />
            <div>
              <h1>${EFC.esc(m.displayName)}</h1>
              <p class="efc-meta">@${EFC.esc(m.handle)} ${EFC.authorBadges(m)}</p>
              <p class="efc-meta">
                ${m.memberSince ? `<span>Member since ${EFC.esc(EFC.shortDate(m.memberSince))}</span>` : ''}
                ${context.map(item => `<span class="efc-meta__dot">${item}</span>`).join('')}
              </p>
            </div>
          </div>
          ${m.bio ? `<p>${EFC.esc(m.bio)}</p>` : ''}
          ${
            m.supplierProfileUrl
              ? `<p><a class="efc-action" href="${EFC.esc(m.supplierProfileUrl)}">View supplier profile</a></p>`
              : ''
          }
          <ul class="efc-side__list">
            <li>${data.stats.discussions} discussions started</li>
            <li>${data.stats.replies} replies</li>
            <li>${data.stats.helpfulAnswers} answers marked helpful</li>
          </ul>
        </header>

        <section class="efc-section">
          <div class="efc-section__head"><h2>Discussions</h2></div>
          ${EFC.discussionList(data.discussions, {
            title: 'No discussions yet',
            body: 'This member has not started a discussion.',
          })}
        </section>

        <section class="efc-section">
          <div class="efc-section__head"><h2>Recent replies</h2></div>
          ${
            data.replies.length
              ? `<ul class="efc-list">${data.replies
                  .map(
                    reply => `<li class="efc-discussion">
                      <p class="efc-discussion__excerpt">${EFC.esc(reply.excerpt)}</p>
                      <p class="efc-meta"><a href="${EFC.esc(reply.url)}">View in context</a>
                        <span class="efc-meta__dot">${EFC.esc(EFC.timeAgo(reply.createdAt))}</span>
                        ${reply.isHelpfulAnswer ? '<span class="efc-badge efc-badge--solved">Helpful answer</span>' : ''}
                      </p>
                    </li>`
                  )
                  .join('')}</ul>`
              : EFC.emptyState('No replies yet', 'This member has not replied to a discussion.')
          }
        </section>
      `;
    } catch (error) {
      EFC.hideFallback();
      profileRoot.innerHTML =
        error.status === 404
          ? // The API answers 404 both for an unknown handle and for a member who
            // has simply never posted, so the copy must be true of both without
            // asserting the account does not exist.
            EFC.emptyState('Nothing to show yet', 'This member has no public community activity.', {
              href: '/community',
              label: 'Back to the community',
            })
          : EFC.errorState('We could not load this profile.');
    }
  }

  /**
   * Render the member's saved discussions.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function renderSaved() {
    savedRoot.innerHTML = EFC.skeleton(3);
    try {
      const data = await EFC.api('me/saved');
      EFC.hideFallback();
      savedRoot.innerHTML = `<h1>Saved discussions</h1>${EFC.discussionList(data.discussions, {
        title: 'Nothing saved yet',
        body: 'Save a discussion from any thread to keep it here for later.',
        action: { href: '/community/discussions', label: 'Browse discussions' },
      })}`;
    } catch (error) {
      if (error.status === 401) {
        window.location.href = '/auth?next=/community/saved';
        return;
      }
      EFC.hideFallback();
      savedRoot.innerHTML = EFC.errorState('We could not load your saved discussions.');
    }
  }

  /**
   * Render what the member follows.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function renderFollowing() {
    followingRoot.innerHTML = EFC.skeleton(3);
    try {
      const data = await EFC.api('me/following');
      EFC.hideFallback();
      const categories = data.categories.length
        ? `<ul class="efc-side__list">${data.categories
            .map(
              item =>
                `<li><a href="/community/category/${EFC.esc(item.slug)}">${EFC.esc(
                  item.icon || ''
                )} ${EFC.esc(item.name)}</a></li>`
            )
            .join('')}</ul>`
        : EFC.emptyState(
            'You are not following any categories',
            'Following a category puts its newest discussions on your community homepage.',
            { href: '/community', label: 'Browse categories' }
          );

      followingRoot.innerHTML = `
        <h1>Following</h1>
        <section class="efc-section">
          <div class="efc-section__head"><h2>Categories</h2></div>
          ${categories}
        </section>
        <section class="efc-section">
          <div class="efc-section__head"><h2>Discussions</h2></div>
          ${EFC.discussionList(data.discussions, {
            title: 'You are not following any discussions',
            body: 'Follow a discussion to be notified when someone replies.',
            action: { href: '/community/discussions', label: 'Browse discussions' },
          })}
        </section>`;
    } catch (error) {
      if (error.status === 401) {
        window.location.href = '/auth?next=/community/following';
        return;
      }
      EFC.hideFallback();
      followingRoot.innerHTML = EFC.errorState('We could not load what you follow.');
    }
  }

  if (profileRoot) {
    renderProfile();
  }
  if (savedRoot) {
    renderSaved();
  }
  if (followingRoot) {
    renderFollowing();
  }
})();
