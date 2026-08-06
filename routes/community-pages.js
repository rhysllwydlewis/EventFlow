/**
 * EventFlow Community — server-rendered pages
 *
 * Serves the community HTML shells at clean URLs and injects real content,
 * metadata and structured data on the server. Public pages are therefore
 * readable and indexable with JavaScript disabled; the client scripts enhance
 * the same markup rather than replacing it.
 */

'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { apiLimiter, publicReadLimiter } = require('../middleware/rateLimits');
const { getUserFromCookie } = require('../middleware/auth');
const community = require('../services/community.service');
const moderation = require('../services/communityModeration.service');
const { replacePlaceholders } = require('../utils/template-renderer');
const {
  COLLECTIONS,
  NOINDEX_STATES,
  COUNTABLE_STATES,
  EVENT_TYPE_LABELS,
  REGION_LABELS,
} = require('../models/CommunityContent');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BASE_URL = process.env.BASE_URL || 'https://event-flow.co.uk';
const SHELL_CACHE_MS = process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 0;

const shellCache = new Map();

/**
 * Escape text for safe inclusion in HTML.
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
 * Read an HTML shell from the public directory, with a short cache in
 * production.
 * @param {string} fileName Shell file name.
 * @returns {Promise<string|null>} File contents, or null when missing.
 */
async function readShell(fileName) {
  const cached = shellCache.get(fileName);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.html;
  }
  try {
    const html = replacePlaceholders(await fs.readFile(path.join(PUBLIC_DIR, fileName), 'utf8'));
    shellCache.set(fileName, { html, expiresAt: Date.now() + SHELL_CACHE_MS });
    return html;
  } catch (error) {
    logger.error(`Community shell missing: ${fileName}`, error.message);
    return null;
  }
}

/**
 * Replace the head metadata placeholders in a shell.
 * @param {string} html Shell HTML.
 * @param {Object} meta Metadata values.
 * @returns {string} HTML with metadata applied.
 */
function applyMeta(html, meta) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = escapeHtml(meta.canonical);

  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="${escapeHtml(meta.ogType || 'website')}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:site_name" content="EventFlow" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];

  if (meta.noindex) {
    tags.push('<meta name="robots" content="noindex,follow" />');
  }
  if (meta.prev) {
    tags.push(`<link rel="prev" href="${escapeHtml(meta.prev)}" />`);
  }
  if (meta.next) {
    tags.push(`<link rel="next" href="${escapeHtml(meta.next)}" />`);
  }
  if (meta.structuredData) {
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(meta.structuredData).replace(
        /</g,
        '\\u003c'
      )}</script>`
    );
  }

  return html.replace('<!--COMMUNITY_HEAD-->', tags.join('\n    '));
}

/**
 * Insert server-rendered content into the shell's no-JavaScript region.
 * @param {string} html Shell HTML.
 * @param {string} content Rendered HTML.
 * @returns {string} Combined HTML.
 */
function applyContent(html, content) {
  return html.replace('<!--COMMUNITY_CONTENT-->', content || '');
}

/**
 * Render the heading that opens a page's server-rendered fallback.
 *
 * Some shells carry their own `<h1>` in a hero band and some do not, and the
 * fallback is injected into all of them. Emitting an `<h1>` unconditionally
 * gave every shell in the first group two top-level headings. On the shells
 * whose client script hides the fallback that was invisible but still shipped
 * two `<h1>`s to any crawler that does not run JavaScript; on the fully static
 * pages — the guidelines and the help page, which load no view script and so
 * never hide the fallback — both headings rendered on screen, one directly
 * above the other.
 *
 * The heading steps down to `<h2>` when the shell already provides an `<h1>`,
 * which keeps the fallback's own outline intact either way.
 * @param {string} shell Shell HTML, before content injection.
 * @param {string} text Heading text, escaped here.
 * @returns {string} Heading HTML.
 */
function fallbackHeading(shell, text) {
  const level = /<h1[\s>]/i.test(shell) ? 'h2' : 'h1';
  return `<${level}>${escapeHtml(text)}</${level}>`;
}

/**
 * Resolve the viewer context for a server-rendered page.
 *
 * The page routes are mounted before the API stack, so they do not benefit from
 * its `userExtractionMiddleware`. This reads the same signed cookie so that an
 * author can still reach their own held content and a moderator can reach
 * anything, while everyone else is refused.
 * @param {Object} req Express request.
 * @returns {Promise<Object>} Viewer context accepted by `community.canView`.
 */
async function viewerFor(req) {
  const anonymous = { user: null, role: 'member' };
  try {
    const token = getUserFromCookie(req);
    if (!token || !token.id) {
      return anonymous;
    }
    const user = await dbUnified.findOne('users', { id: token.id });
    if (!user) {
      return anonymous;
    }
    return { user, role: community.communityRoleFor(user) };
  } catch (error) {
    logger.warn('Could not resolve the community page viewer:', error.message);
    return anonymous;
  }
}

/**
 * Send a rendered community page.
 * @param {Object} res Express response.
 * @param {string} html Final HTML.
 * @returns {void} Nothing.
 */
function send(res, html, options = {}) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  // Anything a signed-in viewer can see but the public cannot must never reach a
  // shared cache.
  res.set(
    'Cache-Control',
    options.private ? 'private, no-store' : 'public, max-age=60, stale-while-revalidate=300'
  );
  res.send(html);
}

/**
 * Render a list of discussion cards as server HTML.
 * @param {Object[]} cards Discussion cards.
 * @returns {string} HTML list.
 */
function renderDiscussionList(cards) {
  if (!cards.length) {
    return '<p class="ef-community-empty">No discussions here yet. Be the first to start one.</p>';
  }
  const items = cards
    .map(card => {
      const meta = [
        `${card.replyCount} ${card.replyCount === 1 ? 'reply' : 'replies'}`,
        `${card.uniqueViews} views`,
        card.category && card.category.name ? escapeHtml(card.category.name) : null,
        card.regionLabel ? escapeHtml(card.regionLabel) : null,
        card.eventTypeLabel ? escapeHtml(card.eventTypeLabel) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const flags = [
        card.solved ? '<span class="ef-community-flag">Solved</span>' : '',
        card.hasOfficialAnswer ? '<span class="ef-community-flag">Official answer</span>' : '',
        card.isOld
          ? '<span class="ef-community-flag ef-community-flag--age">Older discussion</span>'
          : '',
      ].join('');
      return `<li class="ef-community-card">
        <h3><a href="${escapeHtml(card.url)}">${escapeHtml(card.title)}</a></h3>
        ${flags}
        <p>${escapeHtml(card.excerpt)}</p>
        <p class="ef-community-card__meta">Started by ${escapeHtml(
          card.author.displayName
        )} · ${meta} · Last activity ${escapeHtml(
          new Date(card.lastActivityAt).toISOString().slice(0, 10)
        )}</p>
      </li>`;
    })
    .join('\n');
  return `<ul class="ef-community-list">${items}</ul>`;
}

// ─── Redirects ───────────────────────────────────────────────────────────────

router.get(['/forum', '/forum.html', '/forums', '/forums.html'], (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/community${qs}`);
});

// ─── Home ────────────────────────────────────────────────────────────────────

router.get(['/community', '/community.html'], publicReadLimiter, async (req, res, next) => {
  try {
    if (!(await community.isCommunityEnabled())) {
      return next();
    }
    const shell = await readShell('community.html');
    if (!shell) {
      return next();
    }

    const now = new Date();
    const [categories, discussions] = await Promise.all([
      community.listCategories(),
      community.loadPublicDiscussions(),
    ]);
    const categoriesBySlug = new Map(categories.map(item => [item.slug, item]));
    const recent = discussions
      .slice()
      .sort(community.comparatorFor('latest-activity', now))
      .slice(0, 10)
      .map(item =>
        community.toDiscussionCard(item, { category: categoriesBySlug.get(item.categorySlug), now })
      );

    const countsBySlug = new Map();
    discussions.forEach(item => {
      countsBySlug.set(item.categorySlug, (countsBySlug.get(item.categorySlug) || 0) + 1);
    });

    const categoryList = categories
      .slice()
      .sort(
        (a, b) =>
          (countsBySlug.get(b.slug) || 0) - (countsBySlug.get(a.slug) || 0) ||
          a.name.localeCompare(b.name)
      )
      .map(item => {
        const count = countsBySlug.get(item.slug) || 0;
        return `<li><a href="/community/category/${escapeHtml(item.slug)}">${escapeHtml(
          item.name
        )}</a> — ${escapeHtml(item.description || '')} (${count} ${
          count === 1 ? 'discussion' : 'discussions'
        })</li>`;
      })
      .join('\n');

    // No <h1> here: the shell already carries the page heading in the hero, and
    // emitting a second one gave the page two competing top-level headings for
    // as long as the fallback was on screen.
    const content = `
      <h2>Categories</h2>
      <ul class="ef-community-list">${categoryList}</ul>
      <h2>Recent discussions</h2>
      ${renderDiscussionList(recent)}
    `;

    const html = applyContent(
      applyMeta(shell, {
        title: 'EventFlow Community — event planning questions and advice',
        description:
          'Ask questions, share experiences and get practical advice from people planning weddings, parties, corporate events and more, plus verified EventFlow suppliers.',
        canonical: `${BASE_URL}/community`,
        structuredData: {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'EventFlow Community',
          url: `${BASE_URL}/community`,
          description: 'Event planning questions, answers and advice from the EventFlow community.',
        },
      }),
      content
    );
    return send(res, html);
  } catch (error) {
    logger.error('Could not render the community homepage:', error);
    return next();
  }
});

// ─── All discussions ─────────────────────────────────────────────────────────

/** Discussions listed per page on the server-rendered index. */
const INDEX_PAGE_SIZE = 20;

// This is the community's main index and the target of the homepage's "Browse
// discussions" call to action, so it is the page a crawler is most likely to
// follow into the forum. It used to be served as a simple shell whose entire
// no-JavaScript fallback was `<h1>All discussions</h1>` — no discussion links
// at all, while the homepage rendered ten and every category page rendered its
// own. It now renders a real paginated list, like the category pages do.
router.get(['/community/discussions'], publicReadLimiter, async (req, res, next) => {
  try {
    if (!(await community.isCommunityEnabled())) {
      return next();
    }
    const shell = await readShell('community-discussions.html');
    if (!shell) {
      return next();
    }

    const now = new Date();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [categories, discussions] = await Promise.all([
      community.listCategories(),
      community.loadPublicDiscussions(),
    ]);
    const categoriesBySlug = new Map(categories.map(item => [item.slug, item]));
    const ordered = discussions.slice().sort(community.comparatorFor('latest-activity', now));
    const totalPages = Math.max(1, Math.ceil(ordered.length / INDEX_PAGE_SIZE));
    const cards = ordered
      .slice((page - 1) * INDEX_PAGE_SIZE, page * INDEX_PAGE_SIZE)
      .map(item =>
        community.toDiscussionCard(item, { category: categoriesBySlug.get(item.categorySlug), now })
      );

    // Page 2 and beyond are paginated slices of one list rather than pages in
    // their own right, so they point their canonical at themselves and rely on
    // rel=prev/next, exactly as the category pages do.
    const canonical = `${BASE_URL}/community/discussions${page > 1 ? `?page=${page}` : ''}`;
    const content = `
      ${fallbackHeading(shell, 'All discussions')}
      <p>Every published discussion in the EventFlow Community, most recently active first.</p>
      ${renderDiscussionList(cards)}
      <p class="ef-community-pagination">Page ${page} of ${totalPages}</p>
    `;

    return send(
      res,
      applyContent(
        applyMeta(shell, {
          title:
            page > 1
              ? `All discussions (page ${page}) — EventFlow Community`
              : 'All discussions — EventFlow Community',
          description:
            'Browse every discussion in the EventFlow Community. Filter by category, event type, UK region, freshness and whether a question has been answered.',
          canonical,
          // Page one is the bare URL, not `?page=1`: pointing rel=prev at a
          // second address for the same page would advertise a duplicate.
          prev:
            page > 1
              ? `${BASE_URL}/community/discussions${page > 2 ? `?page=${page - 1}` : ''}`
              : null,
          next: page < totalPages ? `${BASE_URL}/community/discussions?page=${page + 1}` : null,
          structuredData: {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: 'Community',
                item: `${BASE_URL}/community`,
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: 'All discussions',
                item: `${BASE_URL}/community/discussions`,
              },
            ],
          },
        }),
        content
      )
    );
  } catch (error) {
    logger.error('Could not render the community discussions index:', error);
    return next();
  }
});

// ─── Simple shells ───────────────────────────────────────────────────────────

const SIMPLE_PAGES = [
  {
    routes: ['/community/new'],
    file: 'community-new.html',
    title: 'Start a discussion — EventFlow Community',
    description: 'Start a new discussion in the EventFlow Community.',
    canonical: '/community/new',
    noindex: true,
  },
  {
    routes: ['/community/search'],
    file: 'community-search.html',
    title: 'Search — EventFlow Community',
    description: 'Search discussions, replies and members across the EventFlow Community.',
    canonical: '/community/search',
    noindex: true,
  },
  {
    routes: ['/community/saved'],
    file: 'community-saved.html',
    title: 'Saved discussions — EventFlow Community',
    description: 'Discussions you have saved in the EventFlow Community.',
    canonical: '/community/saved',
    noindex: true,
  },
  {
    routes: ['/community/following'],
    file: 'community-following.html',
    title: 'Following — EventFlow Community',
    description: 'Categories and discussions you follow in the EventFlow Community.',
    canonical: '/community/following',
    noindex: true,
  },
  {
    routes: ['/community/guidelines'],
    file: 'community-guidelines.html',
    title: 'Community guidelines — EventFlow',
    description:
      'The rules for taking part in the EventFlow Community, including our supplier code of conduct and how moderation works.',
    canonical: '/community/guidelines',
  },
  {
    routes: ['/community/help'],
    file: 'community-help.html',
    title: 'Community help and appeals — EventFlow',
    description:
      'How to report content, how moderation decisions are made, and how to appeal a decision in the EventFlow Community.',
    canonical: '/community/help',
  },
];

SIMPLE_PAGES.forEach(page => {
  router.get(page.routes, publicReadLimiter, async (req, res, next) => {
    try {
      if (!(await community.isCommunityEnabled())) {
        return next();
      }
      const shell = await readShell(page.file);
      if (!shell) {
        return next();
      }
      return send(
        res,
        applyContent(
          applyMeta(shell, {
            title: page.title,
            description: page.description,
            canonical: `${BASE_URL}${page.canonical}`,
            noindex: page.noindex,
          }),
          fallbackHeading(shell, page.title.split(' — ')[0])
        )
      );
    } catch (error) {
      logger.error(`Could not render ${page.canonical}:`, error);
      return next();
    }
  });
});

// ─── Category pages ──────────────────────────────────────────────────────────

router.get('/community/category/:slug', publicReadLimiter, async (req, res, next) => {
  try {
    if (!(await community.isCommunityEnabled())) {
      return next();
    }
    const slug = String(req.params.slug || '').trim();
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
      return next();
    }
    const category = await dbUnified.findOne(COLLECTIONS.categories, { slug });
    if (!category || category.visible === false) {
      return next();
    }
    const shell = await readShell('community-category.html');
    if (!shell) {
      return next();
    }

    const now = new Date();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const all = await community.loadPublicDiscussions({ category: slug }, now);
    const ordered = all.sort(community.comparatorFor('latest-activity', now));
    const cards = ordered
      .slice((page - 1) * 20, page * 20)
      .map(item => community.toDiscussionCard(item, { category, now }));
    const totalPages = Math.max(1, Math.ceil(ordered.length / 20));

    const canonical = `${BASE_URL}/community/category/${slug}${page > 1 ? `?page=${page}` : ''}`;
    const content = `
      ${fallbackHeading(shell, category.name)}
      <p>${escapeHtml(category.description || '')}</p>
      ${renderDiscussionList(cards)}
      <p class="ef-community-pagination">Page ${page} of ${totalPages}</p>
    `;

    return send(
      res,
      applyContent(
        applyMeta(shell, {
          title: `${category.name} — EventFlow Community`,
          description:
            category.description ||
            `Discussions about ${category.name.toLowerCase()} in the EventFlow Community.`,
          canonical,
          prev: page > 1 ? `${BASE_URL}/community/category/${slug}?page=${page - 1}` : null,
          next:
            page < totalPages ? `${BASE_URL}/community/category/${slug}?page=${page + 1}` : null,
          structuredData: {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: 'Community',
                item: `${BASE_URL}/community`,
              },
              { '@type': 'ListItem', position: 2, name: category.name, item: canonical },
            ],
          },
        }),
        content
      )
    );
  } catch (error) {
    logger.error('Could not render a community category page:', error);
    return next();
  }
});

// ─── Discussion pages ────────────────────────────────────────────────────────

/**
 * Build the JSON-LD payload for a discussion.
 * @param {Object} discussion Discussion document.
 * @param {Object[]} replies Visible replies.
 * @param {string} canonical Canonical URL.
 * @returns {Object} Structured data.
 */
function discussionStructuredData(discussion, replies, canonical) {
  const posting = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: discussion.title,
    url: canonical,
    datePublished: discussion.createdAt,
    dateModified: discussion.lastActivityAt || discussion.createdAt,
    author: {
      '@type': 'Person',
      name: (discussion.author && discussion.author.displayName) || 'EventFlow member',
    },
    articleBody: community.buildExcerpt(discussion.bodyText, 500),
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: replies.length,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/ViewAction',
        userInteractionCount: Number(discussion.uniqueViews || 0),
      },
    ],
  };

  // A thread is three levels deep, so it earns a breadcrumb trail in results
  // the same way category pages already do. Emitted alongside the posting
  // rather than instead of it: JSON-LD allows several objects in one block.
  const trail = [
    { '@type': 'ListItem', position: 1, name: 'Community', item: `${BASE_URL}/community` },
  ];
  if (discussion.categorySlug) {
    trail.push({
      '@type': 'ListItem',
      position: 2,
      name: discussion.categoryName || discussion.categorySlug,
      item: `${BASE_URL}/community/category/${discussion.categorySlug}`,
    });
  }
  trail.push({
    '@type': 'ListItem',
    position: trail.length + 1,
    name: discussion.title,
    item: canonical,
  });

  return [
    posting,
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: trail },
  ];
}

router.get(
  ['/community/discussion/:stableId', '/community/discussion/:stableId/:slug'],
  publicReadLimiter,
  // skipcq: JS-R1005 -- Rendering a thread server-side is one linear sequence.
  async (req, res, next) => {
    try {
      if (!(await community.isCommunityEnabled())) {
        return next();
      }
      const stableId = String(req.params.stableId || '').trim();
      if (!/^[a-f0-9]{6,32}$/i.test(stableId)) {
        return next();
      }

      const discussion = await dbUnified.findOne(COLLECTIONS.discussions, { stableId });
      if (!discussion) {
        return next();
      }

      // Authorisation, not just indexing. A quarantined, hidden, removed or
      // draft discussion must be unreachable here exactly as it is on the API —
      // otherwise anyone holding the stable id could read content moderation has
      // taken down. `noindex` metadata alone is not an access control.
      const viewer = await viewerFor(req);
      if (!community.canView(discussion, viewer)) {
        return next();
      }

      const expectedSlug = discussion.slug || community.slugify(discussion.title);
      if (req.params.slug !== expectedSlug) {
        // The stable id is the identity; the slug is decoration, so an old or
        // missing slug redirects rather than 404s.
        return res.redirect(301, `/community/discussion/${stableId}/${expectedSlug}`);
      }

      const shell = await readShell('community-discussion.html');
      if (!shell) {
        return next();
      }

      const now = new Date();
      const isPublic = !NOINDEX_STATES.includes(discussion.state);
      const replies = (
        (await dbUnified.find(COLLECTIONS.replies, { discussionId: discussion.id })) || []
      )
        .filter(reply => COUNTABLE_STATES.includes(reply.state))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const canonical = `${BASE_URL}/community/discussion/${stableId}/${expectedSlug}`;
      const freshness = moderation.assessFreshness(discussion, now);

      const ageNotice = freshness.isOld
        ? `<p class="ef-community-notice">This discussion was started ${Math.floor(
            freshness.ageDays / 365
          )} year(s) ago. Advice may be out of date — <a href="/community/new">start a new discussion</a> for current answers.</p>`
        : '';

      const lockedNotice = discussion.locked
        ? '<p class="ef-community-notice">This discussion is locked and no longer accepts replies.</p>'
        : '';

      const contextBits = [
        discussion.eventType ? EVENT_TYPE_LABELS[discussion.eventType] : null,
        discussion.region ? REGION_LABELS[discussion.region] : null,
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');

      const repliesHtml = replies
        .map(
          reply => `<article class="ef-community-reply" id="reply-${escapeHtml(reply.id)}">
            <h3>${escapeHtml((reply.author || {}).displayName || 'EventFlow member')}${
              reply.isOfficialAnswer ? ' — official EventFlow answer' : ''
            }${reply.isHelpfulAnswer ? ' — marked helpful' : ''}</h3>
            ${
              reply.supplierDisclosure && reply.supplierDisclosure.selfRecommendation
                ? '<p class="ef-community-disclosure">This supplier is recommending their own business.</p>'
                : ''
            }
            <div>${reply.bodyHtml || ''}</div>
            <p class="ef-community-card__meta">${escapeHtml(
              new Date(reply.createdAt).toISOString().slice(0, 10)
            )}</p>
          </article>`
        )
        .join('\n');

      const content = `
        <nav aria-label="Breadcrumb"><a href="/community">Community</a> › <a href="/community/category/${escapeHtml(
          discussion.categorySlug
        )}">${escapeHtml(discussion.categoryName || discussion.categorySlug)}</a></nav>
        ${fallbackHeading(shell, discussion.title)}
        ${ageNotice}
        ${lockedNotice}
        <p class="ef-community-card__meta">Started by ${escapeHtml(
          (discussion.author || {}).displayName || 'EventFlow member'
        )} on ${escapeHtml(new Date(discussion.createdAt).toISOString().slice(0, 10))}${
          contextBits ? ` · ${contextBits}` : ''
        }</p>
        <div class="ef-community-body">${discussion.bodyHtml || ''}</div>
        <h2>${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</h2>
        ${repliesHtml}
      `;

      return send(
        res,
        applyContent(
          applyMeta(shell, {
            title: `${discussion.title} — EventFlow Community`,
            description: community.buildExcerpt(discussion.bodyText, 155),
            canonical,
            ogType: 'article',
            noindex: !isPublic,
            structuredData: isPublic
              ? discussionStructuredData(discussion, replies, canonical)
              : null,
          }),
          content
        ),
        // A non-public state here means the viewer is the author or a
        // moderator, so the response is personal and must not be shared-cached.
        { private: !isPublic }
      );
    } catch (error) {
      logger.error('Could not render a community discussion page:', error);
      return next();
    }
  }
);

// ─── Member profiles ─────────────────────────────────────────────────────────

router.get('/community/member/:handle', publicReadLimiter, async (req, res, next) => {
  try {
    if (!(await community.isCommunityEnabled())) {
      return next();
    }
    const handle = String(req.params.handle || '').trim();
    if (!/^[a-zA-Z0-9]{2,32}$/.test(handle)) {
      return next();
    }
    const shell = await readShell('community-member.html');
    if (!shell) {
      return next();
    }
    return send(
      res,
      applyContent(
        applyMeta(shell, {
          title: `${handle} — EventFlow Community`,
          description: `Community profile for ${handle} on EventFlow.`,
          canonical: `${BASE_URL}/community/member/${handle}`,
          ogType: 'profile',
        }),
        `${fallbackHeading(shell, handle)}<p>Community profile.</p>`
      )
    );
  } catch (error) {
    logger.error('Could not render a community member page:', error);
    return next();
  }
});

// ─── Admin page ──────────────────────────────────────────────────────────────

router.get('/admin/community', apiLimiter, async (req, res, next) => {
  const shell = await readShell('admin-community.html');
  if (!shell) {
    return next();
  }
  return send(
    res,
    applyContent(
      applyMeta(shell, {
        title: 'Community centre — EventFlow admin',
        description: 'Moderation, categories, reports and community health.',
        canonical: `${BASE_URL}/admin/community`,
        noindex: true,
      }),
      ''
    )
  );
});

module.exports = router;
module.exports.__internal = {
  applyMeta,
  applyContent,
  renderDiscussionList,
  escapeHtml,
  fallbackHeading,
};
