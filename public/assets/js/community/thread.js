/**
 * EventFlow Community — discussion thread
 *
 * Renders the original post, replies and every interaction: reply, quote, save,
 * follow, react, mark helpful, report and share.
 */

'use strict';
(function () {
  const EFC = window.EFCommunity;
  const root = document.getElementById('efc-thread');
  if (!EFC || !root) {
    return;
  }

  // /community/discussion/:stableId/:slug — the id is always the third segment.
  const stableId = root.dataset.stableId || window.location.pathname.split('/')[3] || '';
  let payload = null;
  let viewer = null;

  // Mirrors models/CommunityContent.js REACTIONS. Only "helpful" counts toward
  // reputation server-side; the other three are appreciation only, and the
  // server already accepts and counts all four — this list is what was
  // missing to actually offer them.
  const REACTIONS = [
    { key: 'helpful', emoji: '👍', label: 'Helpful' },
    { key: 'thanks', emoji: '🙏', label: 'Thanks' },
    { key: 'congratulations', emoji: '🎉', label: 'Congratulations' },
    { key: 'support', emoji: '💜', label: 'Support' },
  ];
  let page = Number(new URLSearchParams(window.location.search).get('page') || 1);

  /**
   * Render the freshness warning for an old or dormant discussion.
   * @returns {string} HTML.
   */
  function freshnessNotice() {
    const { freshness, discussion } = payload;
    if (discussion.supersededBy && discussion.canonicalDiscussion) {
      return `<div class="efc-notice efc-notice--info" role="note">
        This discussion has been replaced by a newer one:
        <a href="${EFC.esc(discussion.canonicalDiscussion.url)}">${EFC.esc(
          discussion.canonicalDiscussion.title
        )}</a>.
      </div>`;
    }
    if (!freshness.isOld && !freshness.isDormant) {
      return '';
    }
    const years = Math.floor(freshness.ageDays / 365);
    const age = years >= 1 ? `${years} year${years === 1 ? '' : 's'}` : `${freshness.ageDays} days`;
    return `<div class="efc-notice" role="note">
      <strong>This discussion is ${age} old.</strong> Prices, availability and advice may have
      changed since it was written. <a href="/community/new">Start a new discussion</a> to get
      current answers.
    </div>`;
  }

  /**
   * Render the thread's status badges and, when there is one, a link straight
   * to the answer.
   *
   * A card in a listing says "Solved" before you open it; before this the
   * thread itself said so only in a sidebar list, and a reader arriving on a
   * long solved thread had to scroll to find out which reply was the answer.
   * @returns {string} HTML.
   */
  function renderThreadStatus() {
    const d = payload.discussion;
    const answer = (payload.replies || []).find(reply => reply.isHelpfulAnswer);
    const official = (payload.replies || []).find(reply => reply.isOfficialAnswer);
    const badges = [
      d.solved ? '<span class="efc-badge efc-badge--solved">Solved</span>' : '',
      official ? '<span class="efc-badge efc-badge--official">Official answer</span>' : '',
      d.pinned ? '<span class="efc-badge">Pinned</span>' : '',
      d.locked ? '<span class="efc-badge">Locked</span>' : '',
    ].filter(Boolean);

    const jumpTo = answer || official;
    const jump = jumpTo
      ? `<a class="efc-jump" href="#reply-${EFC.esc(jumpTo.id)}">Jump to the ${
          answer ? 'helpful' : 'official'
        } answer</a>`
      : '';

    if (!badges.length && !jump) {
      return '';
    }
    return `<p class="efc-meta efc-thread-status">${badges.join(' ')}${jump}</p>`;
  }

  /**
   * Render the original post.
   * @returns {string} HTML.
   */
  function renderOriginalPost() {
    const d = payload.discussion;
    const context = [
      d.category && d.category.name
        ? `<a href="/community/category/${EFC.esc(d.category.slug)}">${EFC.esc(d.category.name)}</a>`
        : '',
      d.eventTypeLabel ? EFC.esc(d.eventTypeLabel) : '',
      d.regionLabel ? EFC.esc(d.regionLabel) : '',
    ].filter(Boolean);

    const brief = d.recommendationBrief
      ? `<div class="efc-notice efc-notice--info">
          <strong>Recommendations wanted.</strong>
          ${[
            d.recommendationBrief.supplierCategory
              ? `Looking for: ${EFC.esc(d.recommendationBrief.supplierCategory)}`
              : '',
            d.recommendationBrief.budgetRange
              ? `Budget: ${EFC.esc(d.recommendationBrief.budgetRange)}`
              : '',
            d.recommendationBrief.guestCount ? `Guests: ${d.recommendationBrief.guestCount}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          <p><a class="btn btn-primary" href="/suppliers${
            d.region ? `?region=${EFC.esc(d.region)}` : ''
          }">View matching EventFlow suppliers</a></p>
        </div>`
      : '';

    const poll = d.poll ? renderPoll(d.poll) : '';
    const images = renderAttachments(d.attachments);

    return `<article class="efc-post" aria-labelledby="efc-thread-title">
      <div class="efc-post__head">
        ${EFC.avatar(d.author, 40)}
        <div>
          <p class="efc-meta">
            <a href="/community/member/${EFC.esc(d.author.handle)}">${EFC.esc(
              d.author.displayName
            )}</a> ${EFC.authorBadges(d.author)}
          </p>
          <p class="efc-meta">
            <span>Posted ${EFC.esc(EFC.shortDate(d.createdAt))}</span>
            ${d.editedAt ? `<span class="efc-meta__dot">edited ${EFC.esc(EFC.timeAgo(d.editedAt))}</span>` : ''}
            ${context.map(item => `<span class="efc-meta__dot">${item}</span>`).join('')}
          </p>
        </div>
      </div>
      ${
        d.pendingReview
          ? '<div class="efc-notice" role="status">Only you can see this. A moderator is checking it before it appears publicly.</div>'
          : ''
      }
      ${d.moderatorNotice ? `<div class="efc-notice" role="note">${EFC.esc(d.moderatorNotice)}</div>` : ''}
      ${brief}
      <div class="efc-post__body" data-mentions="${EFC.esc(JSON.stringify((d.mentions || []).map(m => m.handle)))}">${d.body || ''}</div>
      ${images}
      ${poll}
      <p class="efc-meta">
        <span>${d.replyCount} ${d.replyCount === 1 ? 'reply' : 'replies'}</span>
        <span class="efc-meta__dot">${d.uniqueViews} views</span>
        <span class="efc-meta__dot">${d.participantCount} taking part</span>
      </p>
      <div class="efc-post__actions">
        <button type="button" class="efc-action" data-save aria-pressed="${payload.viewerState.saved}">${
          payload.viewerState.saved ? 'Saved' : 'Save'
        }</button>
        <button type="button" class="efc-action" data-follow aria-pressed="${payload.viewerState.following}">${
          payload.viewerState.following ? 'Following' : 'Follow'
        }</button>
        <button type="button" class="efc-action" data-share>Share</button>
        <button type="button" class="efc-action" data-report="${EFC.esc(d.stableId)}">Report</button>
        ${
          payload.viewerState.canReply
            ? '<a class="btn btn-primary" href="#efc-reply-box">Reply</a>'
            : ''
        }
      </div>
    </article>`;
  }

  /**
   * Render image attachments as a lightbox-free thumbnail grid. Only
   * same-origin `/uploads/community/...` URLs are ever stored for these, so
   * no extra sanitisation is needed beyond the usual HTML escaping.
   * @param {Object[]} [attachments] Attachment records.
   * @returns {string} HTML, or an empty string when there is nothing to show.
   */
  function renderAttachments(attachments) {
    const images = Array.isArray(attachments)
      ? attachments.filter(item => item && item.kind === 'image' && item.url)
      : [];
    if (!images.length) {
      return '';
    }
    return `<div class="efc-post__attachments">${images
      .map(
        item =>
          `<a href="${EFC.esc(item.url)}" target="_blank" rel="noopener noreferrer">
            <img src="${EFC.esc(item.url)}" alt="${EFC.esc(item.alt || '')}" loading="lazy" />
          </a>`
      )
      .join('')}</div>`;
  }

  /**
   * Render a poll with its current results.
   * @param {Object} poll Poll payload.
   * @returns {string} HTML.
   */
  function renderPoll(poll) {
    const options = poll.options
      .map(option => {
        const share = poll.totalVotes ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        return `<li>
          <button type="button" class="efc-action" data-poll-option="${EFC.esc(option.id)}">${EFC.esc(
            option.label
          )}</button>
          <span class="efc-meta">${option.votes} votes (${share}%)</span>
        </li>`;
      })
      .join('');
    return `<section class="efc-card" aria-label="Poll">
      <h3>${EFC.esc(poll.question)}</h3>
      <ul class="efc-side__list">${options}</ul>
      <p class="efc-meta">${poll.totalVotes} ${poll.totalVotes === 1 ? 'vote' : 'votes'}</p>
    </section>`;
  }

  /**
   * Render one reply.
   * @param {Object} reply Reply view model.
   * @returns {string} HTML.
   */
  function renderReply(reply) {
    if (reply.withdrawn) {
      return `<article class="efc-post efc-post--withdrawn" id="reply-${EFC.esc(reply.id)}">
        <p>${EFC.esc(reply.withdrawnReason)}</p>
      </article>`;
    }

    const classes = ['efc-post'];
    if (reply.isHelpfulAnswer) {
      classes.push('efc-post--answer');
    }
    if (reply.isOfficialAnswer) {
      classes.push('efc-post--official');
    }

    const flags = [
      reply.isHelpfulAnswer
        ? '<span class="efc-badge efc-badge--solved">Helpful answer</span>'
        : '',
      // The verification date is metadata about the badge, not part of its
      // label, so it sits beside the pill as muted text rather than inside it.
      // A pill is a status at a glance; a whole sentence in one is neither
      // glanceable nor able to wrap where the space is tight.
      reply.isOfficialAnswer
        ? `<span class="efc-badge efc-badge--official">Official EventFlow answer</span>${
            reply.officialAnswerVerifiedAt
              ? `<span class="efc-verified">Last verified ${EFC.esc(
                  EFC.shortDate(reply.officialAnswerVerifiedAt)
                )}</span>`
              : ''
          }`
        : '',
      reply.pendingReview
        ? '<span class="efc-badge efc-badge--pending">Awaiting review</span>'
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const disclosure =
      reply.supplierDisclosure && reply.supplierDisclosure.selfRecommendation
        ? `<p class="efc-disclosure">${EFC.esc(reply.supplierDisclosure.label)}.</p>`
        : '';

    const quote = reply.quotedExcerpt
      ? `<blockquote>${EFC.esc(reply.quotedExcerpt)}</blockquote>`
      : '';

    const canSolve =
      payload.discussion.isOwn || payload.viewerState.isModerator
        ? `<button type="button" class="efc-action" data-solve="${EFC.esc(reply.id)}" aria-pressed="${
            reply.isHelpfulAnswer
          }">${reply.isHelpfulAnswer ? 'Helpful answer' : 'Mark as helpful answer'}</button>`
        : '';

    const canOfficial = payload.viewerState.isModerator
      ? `<button type="button" class="efc-action" data-official="${EFC.esc(reply.id)}" aria-pressed="${
          reply.isOfficialAnswer
        }">${reply.isOfficialAnswer ? 'Official answer' : 'Mark as official answer'}</button>`
      : '';

    return `<article class="${classes.join(' ')}" id="reply-${EFC.esc(reply.id)}">
      <div class="efc-post__head">
        ${EFC.avatar(reply.author, 40)}
        <div>
          <p class="efc-meta">
            <a href="/community/member/${EFC.esc(reply.author.handle)}">${EFC.esc(
              reply.author.displayName
            )}</a> ${EFC.authorBadges(reply.author)}
          </p>
          <p class="efc-meta">
            <a class="efc-permalink" href="#reply-${EFC.esc(reply.id)}">${EFC.esc(
              EFC.shortDate(reply.createdAt)
            )}</a>${reply.edited ? ` · edited ${EFC.esc(EFC.timeAgo(reply.editedAt))}` : ''}
          </p>
        </div>
      </div>
      ${flags ? `<p class="efc-meta">${flags}</p>` : ''}
      ${disclosure}
      ${quote}
      <div class="efc-post__body" data-mentions="${EFC.esc(JSON.stringify((reply.mentions || []).map(m => m.handle)))}">${reply.body || ''}</div>
      <div class="efc-reactions" role="group" aria-label="React to this reply">
        ${REACTIONS.map(item => {
          const mine = (payload.myReactions[reply.id] || []).includes(item.key);
          const count = Number((reply.reactions || {})[item.key] || 0);
          return `<button type="button" class="efc-reaction" data-react="${EFC.esc(reply.id)}" data-reaction="${item.key}" aria-pressed="${mine}">
            <span aria-hidden="true">${item.emoji}</span>
            <span>${count}</span>
            <span class="efc-sr-only">${item.label}${count === 1 ? ', 1 member' : `, ${count} members`}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="efc-post__actions">
        <button type="button" class="efc-action" data-quote="${EFC.esc(reply.id)}">Quote</button>
        ${canSolve}
        ${canOfficial}
        <button type="button" class="efc-action" data-report="${EFC.esc(reply.id)}">Report</button>
        ${reply.isOwn ? `<button type="button" class="efc-action" data-delete="${EFC.esc(reply.id)}">Withdraw</button>` : ''}
      </div>
    </article>`;
  }

  /**
   * Render the reply composer, or the reason it is unavailable.
   * @returns {string} HTML.
   */
  function renderReplyBox() {
    if (payload.discussion.locked) {
      return '<div class="efc-notice" role="note">This discussion is locked. <a href="/community/new">Start a new discussion</a> to carry on the conversation.</div>';
    }
    if (payload.discussion.archived) {
      return '<div class="efc-notice" role="note">This discussion has been archived because it is no longer current. <a href="/community/new">Start a new discussion</a> instead.</div>';
    }
    if (!viewer) {
      return `<div class="efc-notice efc-notice--info"><a href="/auth?next=${encodeURIComponent(
        window.location.pathname
      )}">Log in or join EventFlow</a> to reply. Anyone can read the community.</div>`;
    }
    if (viewer.restriction) {
      return `<div class="efc-notice efc-notice--danger" role="alert">
        Your ability to post is currently restricted${
          viewer.restriction.reason ? `: ${EFC.esc(viewer.restriction.reason)}` : '.'
        } <a href="/community/help#appeals">Appeal this decision</a>.
      </div>`;
    }

    const linkWarning =
      viewer.linkPolicy && !viewer.linkPolicy.linksClickable
        ? '<p class="efc-meta">New accounts can include links, but they appear as plain text until you have taken part for a little while. This keeps the community free of drive-by promotion.</p>'
        : '';

    return `<form class="efc-card" id="efc-reply-box">
      <h2>Reply</h2>
      <div class="efc-field">
        <label for="efc-reply-body">Your reply</label>
        <textarea id="efc-reply-body" required minlength="2" maxlength="10000"
          aria-describedby="efc-reply-help"></textarea>
      </div>
      <p class="efc-meta" id="efc-reply-help">Be kind and specific. Do not post personal contact details or anyone else's information.</p>
      ${linkWarning}
      <div id="efc-quote-preview"></div>
      <p><button type="submit" class="btn btn-primary">Post reply</button></p>
    </form>`;
  }

  /**
   * Render the report dialog.
   * @returns {string} HTML.
   */
  function reportDialog() {
    return `<dialog class="efc-dialog" id="efc-report-dialog" aria-labelledby="efc-report-title">
      <form method="dialog" class="efc-dialog__body">
        <h2 id="efc-report-title">Report this content</h2>
        <div class="efc-field">
          <label for="efc-report-reason">Why are you reporting this?</label>
          <select id="efc-report-reason" required></select>
        </div>
        <div class="efc-field">
          <label for="efc-report-detail">Anything else we should know? (optional)</label>
          <textarea id="efc-report-detail" maxlength="1000" style="min-height:100px"></textarea>
        </div>
        <p class="efc-meta">Reports are confidential. We will tell you the outcome.</p>
        <div class="efc-dialog__actions">
          <button type="button" class="efc-action" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" data-submit-report>Send report</button>
        </div>
      </form>
    </dialog>`;
  }

  /**
   * Render the whole thread.
   * @returns {void} Nothing.
   */
  function render() {
    const d = payload.discussion;
    const related = payload.related.length
      ? `<section class="efc-side__card"><h2>Related discussions</h2><ul class="efc-side__list">${payload.related
          .map(item => `<li><a href="${EFC.esc(item.url)}">${EFC.esc(item.title)}</a></li>`)
          .join('')}</ul></section>`
      : '';

    root.innerHTML = `
      <nav aria-label="Breadcrumb" class="efc-meta">
        <a href="/community">Community</a> ›
        <a href="/community/category/${EFC.esc(d.category.slug)}">${EFC.esc(d.category.name)}</a>
      </nav>
      <h1 id="efc-thread-title">${EFC.esc(d.title)}</h1>
      ${renderThreadStatus()}
      ${freshnessNotice()}
      <div class="efc-grid efc-grid--sidebar">
        <div>
          ${renderOriginalPost()}
          <h2 class="efc-sr-only">Replies</h2>
          <div id="efc-replies">${
            payload.replies.length
              ? payload.replies.map(renderReply).join('')
              : EFC.emptyState(
                  'No replies yet',
                  'Be the first to help. A short, specific answer is worth more than a long one.'
                )
          }</div>
          ${EFC.pagination(payload.pagination, p => `${window.location.pathname}?page=${p}`)}
          ${renderReplyBox()}
        </div>
        <aside class="efc-side" aria-label="About this discussion">
          <section class="efc-side__card">
            <h2>About this discussion</h2>
            <ul class="efc-side__list">
              <li>Started ${EFC.esc(EFC.shortDate(d.createdAt))}</li>
              <li>Last activity ${EFC.esc(EFC.timeAgo(d.lastActivityAt))}</li>
              <li>${d.replyCount} ${d.replyCount === 1 ? 'reply' : 'replies'} from ${
                d.participantCount
              } ${d.participantCount === 1 ? 'person' : 'people'}</li>
              ${d.solved ? '<li>Marked as solved</li>' : ''}
            </ul>
          </section>
          ${related}
          <section class="efc-side__card">
            <h2>Take it further</h2>
            <ul class="efc-side__list">
              <li><a href="/suppliers">Find suppliers</a></li>
              <li><a href="/public-calendar">Upcoming public events</a></li>
              <li><a href="/marketplace">Marketplace listings</a></li>
              <li><a href="/guides">EventFlow guides</a></li>
            </ul>
          </section>
        </aside>
      </div>
      ${reportDialog()}
    `;
    wire();
    linkifyMentions();
    revealLinkedReply();
  }

  /**
   * Turn @handle text into a profile link, but only for handles the server
   * already resolved to a real member for this specific post (via its
   * `data-mentions` list) — never for arbitrary "@word" text a reader typed.
   *
   * Operates on real DOM text nodes rather than the HTML string, so it can
   * never corrupt markup or attributes the way a regex replace on innerHTML
   * could (e.g. an "@word" inside a link's href).
   * @param {HTMLElement} container A `.efc-post__body` element with a
   *   `data-mentions` JSON array of lower-case handles.
   * @returns {void} Nothing.
   */
  function linkifyMentionsIn(container) {
    let handles;
    try {
      handles = JSON.parse(container.dataset.mentions || '[]');
    } catch (_) {
      handles = [];
    }
    if (!Array.isArray(handles) || handles.length === 0) {
      return;
    }
    const handleSet = new Set(handles.map(h => String(h).toLowerCase()));
    const pattern = /@([a-z0-9_-]{3,30})\b/gi;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node);
      node = walker.nextNode();
    }

    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      pattern.lastIndex = 0;
      if (!pattern.test(text)) {
        return;
      }
      pattern.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match = pattern.exec(text);
      let replaced = false;
      while (match) {
        const handle = match[1].toLowerCase();
        if (handleSet.has(handle)) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          const link = document.createElement('a');
          link.className = 'efc-mention';
          link.href = `/community/member/${encodeURIComponent(handle)}`;
          link.textContent = `@${match[1]}`;
          frag.appendChild(link);
          lastIndex = match.index + match[0].length;
          replaced = true;
        }
        match = pattern.exec(text);
      }
      if (!replaced) {
        return;
      }
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  /**
   * Linkify @mentions in every post body currently on the page.
   * @returns {void} Nothing.
   */
  function linkifyMentions() {
    root.querySelectorAll('[data-mentions]').forEach(linkifyMentionsIn);
  }

  /**
   * Bring a linked reply into view once the thread has rendered.
   *
   * Replies arrive from the API, so the browser resolves `#reply-…` against a
   * document that does not contain it yet and a shared link lands at the top of
   * the thread. Doing it here means a permalink works the way a reader expects.
   * @returns {void} Nothing.
   */
  function revealLinkedReply() {
    const hash = window.location.hash;
    if (!hash.startsWith('#reply-')) {
      return;
    }
    const target = document.getElementById(hash.slice(1));
    if (!target) {
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    target.classList.add('efc-post--linked');
  }

  /**
   * Attach all thread event handlers.
   * @returns {void} Nothing.
   */
  // skipcq: JS-R1005 -- One wiring pass keeps the handlers next to the markup they drive.
  function wire() {
    const save = root.querySelector('[data-save]');
    if (save) {
      save.addEventListener('click', () => toggle(save, 'save', 'saved'));
    }
    const follow = root.querySelector('[data-follow]');
    if (follow) {
      follow.addEventListener('click', () => toggle(follow, 'follow', 'following'));
    }

    const share = root.querySelector('[data-share]');
    if (share) {
      share.addEventListener('click', async () => {
        const url = window.location.href;
        if (navigator.share) {
          try {
            await navigator.share({ title: payload.discussion.title, url });
            return;
          } catch (_) {
            /* fall through to clipboard */
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          EFC.announce('Link copied to your clipboard.');
        } catch (_) {
          EFC.announce('Copy this page address to share the discussion.');
        }
      });
    }

    root.querySelectorAll('[data-react]').forEach(button => {
      button.addEventListener('click', async () => {
        const pressed = button.getAttribute('aria-pressed') === 'true';
        const reaction = button.dataset.reaction || 'helpful';
        try {
          await EFC.api(
            pressed
              ? `posts/${button.dataset.react}/reactions/${reaction}`
              : `posts/${button.dataset.react}/reactions`,
            pressed ? { method: 'DELETE' } : { method: 'POST', body: { reaction } }
          );
          await load();
        } catch (error) {
          handleAuthError(error);
        }
      });
    });

    root.querySelectorAll('[data-quote]').forEach(button => {
      button.addEventListener('click', () => {
        const reply = payload.replies.find(item => item.id === button.dataset.quote);
        const preview = document.getElementById('efc-quote-preview');
        const box = document.getElementById('efc-reply-body');
        if (!reply || !preview || !box) {
          return;
        }
        preview.dataset.quotedReplyId = reply.id;
        preview.innerHTML = `<div class="efc-notice efc-notice--info">Quoting ${EFC.esc(
          reply.author.displayName
        )}. <button type="button" class="efc-action" data-clear-quote>Remove quote</button></div>`;
        preview.querySelector('[data-clear-quote]').addEventListener('click', () => {
          delete preview.dataset.quotedReplyId;
          preview.innerHTML = '';
        });
        box.focus();
      });
    });

    root.querySelectorAll('[data-solve]').forEach(button => {
      button.addEventListener('click', async () => {
        const pressed = button.getAttribute('aria-pressed') === 'true';
        try {
          await EFC.api(`discussions/${stableId}/solve`, {
            method: 'POST',
            body: { replyId: pressed ? null : button.dataset.solve },
          });
          await load();
        } catch (error) {
          handleAuthError(error);
        }
      });
    });

    root.querySelectorAll('[data-official]').forEach(button => {
      button.addEventListener('click', async () => {
        const pressed = button.getAttribute('aria-pressed') === 'true';
        try {
          await EFC.api(`discussions/${stableId}/official-answer`, {
            method: 'POST',
            body: { replyId: button.dataset.official, official: !pressed },
          });
          await load();
        } catch (error) {
          handleAuthError(error);
        }
      });
    });

    root.querySelectorAll('[data-delete]').forEach(button => {
      button.addEventListener('click', async () => {
        if (
          !window.confirm(
            'Withdraw this reply? It will be replaced by a note saying you removed it.'
          )
        ) {
          return;
        }
        try {
          await EFC.api(`replies/${button.dataset.delete}`, { method: 'DELETE' });
          EFC.announce('Your reply has been withdrawn.');
          await load();
        } catch (error) {
          handleAuthError(error);
        }
      });
    });

    root.querySelectorAll('[data-poll-option]').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await EFC.api(`discussions/${stableId}/poll-vote`, {
            method: 'POST',
            body: { optionId: button.dataset.pollOption },
          });
          await load();
        } catch (error) {
          handleAuthError(error);
        }
      });
    });

    wireReport();
    wireReplyForm();
  }

  /**
   * Toggle a save or follow state.
   * @param {HTMLElement} button The control.
   * @param {string} action API segment.
   * @param {string} onLabelKey Label to show when active.
   * @returns {Promise<void>} Resolves when toggled.
   */
  async function toggle(button, action, onLabelKey) {
    const active = button.getAttribute('aria-pressed') === 'true';
    try {
      await EFC.api(`discussions/${stableId}/${action}`, { method: active ? 'DELETE' : 'POST' });
      button.setAttribute('aria-pressed', String(!active));
      const labels = { saved: ['Save', 'Saved'], following: ['Follow', 'Following'] };
      button.textContent = active ? labels[onLabelKey][0] : labels[onLabelKey][1];
      EFC.announce(active ? `Removed from your ${onLabelKey}.` : `Added to your ${onLabelKey}.`);
    } catch (error) {
      handleAuthError(error);
    }
  }

  /**
   * Redirect to login on 401, otherwise announce the error.
   * @param {Error} error The failure.
   * @returns {void} Nothing.
   */
  function handleAuthError(error) {
    if (error.status === 401) {
      window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    EFC.announce(error.message || 'That did not work. Please try again.', 'error');
  }

  /**
   * Wire the report dialog.
   * @returns {void} Nothing.
   */
  /**
   * Open the report dialog.
   *
   * `<dialog>` reached Safari only in 15.4, and `showModal` is simply absent
   * before that — calling it throws and leaves the report button dead. Reporting
   * is a safety path, so it degrades to a non-modal open state rather than
   * failing.
   * @param {HTMLElement} dialog Dialog element.
   * @returns {void} Nothing.
   */
  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      return;
    }
    dialog.setAttribute('open', '');
  }

  /**
   * Close the report dialog, mirroring openDialog's fallback.
   * @param {HTMLElement} dialog Dialog element.
   * @returns {void} Nothing.
   */
  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') {
      dialog.close();
      return;
    }
    dialog.removeAttribute('open');
  }

  function wireReport() {
    const dialog = document.getElementById('efc-report-dialog');
    const reasonSelect = document.getElementById('efc-report-reason');
    if (!dialog || !reasonSelect) {
      return;
    }
    let targetId = null;

    EFC.api('report-reasons')
      .then(data => {
        reasonSelect.innerHTML = data.reasons
          .map(reason => `<option value="${EFC.esc(reason.key)}">${EFC.esc(reason.label)}</option>`)
          .join('');
      })
      .catch(() => {
        reasonSelect.innerHTML = '<option value="other">Something else</option>';
      });

    root.querySelectorAll('[data-report]').forEach(button => {
      button.addEventListener('click', () => {
        targetId = button.dataset.report;
        openDialog(dialog);
      });
    });

    dialog.querySelector('[data-close]').addEventListener('click', () => closeDialog(dialog));
    dialog.querySelector('[data-submit-report]').addEventListener('click', async () => {
      try {
        const result = await EFC.api(`posts/${targetId}/report`, {
          method: 'POST',
          body: {
            reason: reasonSelect.value,
            detail: document.getElementById('efc-report-detail').value,
          },
        });
        closeDialog(dialog);
        EFC.announce(result.message);
      } catch (error) {
        EFC.announce(error.message, 'error');
      }
    });
  }

  /**
   * Wire the reply form.
   * @returns {void} Nothing.
   */
  function wireReplyForm() {
    const form = document.getElementById('efc-reply-box');
    if (!form || form.tagName !== 'FORM') {
      return;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const body = document.getElementById('efc-reply-body').value;
      const preview = document.getElementById('efc-quote-preview');
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const result = await EFC.api(`discussions/${stableId}/replies`, {
          method: 'POST',
          body: { body, quotedReplyId: preview ? preview.dataset.quotedReplyId : undefined },
        });
        EFC.announce(result.message);
        await load();
      } catch (error) {
        handleAuthError(error);
      } finally {
        submit.disabled = false;
      }
    });
  }

  /**
   * Load and render the thread.
   * @returns {Promise<void>} Resolves when rendered.
   */
  async function load() {
    try {
      [payload, viewer] = await Promise.all([
        EFC.api(`discussions/${stableId}?page=${page}`),
        EFC.me(),
      ]);
      EFC.hideFallback();
      render();
    } catch (error) {
      EFC.hideFallback();
      root.innerHTML = EFC.errorState('We could not load this discussion.');
      const retry = root.querySelector('[data-efc-retry]');
      if (retry) {
        retry.addEventListener('click', load);
      }
    }
  }

  window.addEventListener('popstate', () => {
    page = Number(new URLSearchParams(window.location.search).get('page') || 1);
    load();
  });

  load();
})();
