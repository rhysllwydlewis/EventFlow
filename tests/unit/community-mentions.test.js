/**
 * @mentions in the forum.
 *
 * Before this, the only `@` handling anywhere in the community code was a
 * spam-signal regex that counted `@word` occurrences for moderation scoring —
 * it never resolved a handle to a real member, linkified anything, or
 * notified anyone. This tests the three pieces that make it real:
 * extraction/resolution (services/community.service.js — see
 * tests/integration/community-api.test.js for the end-to-end route
 * behaviour), and the client-side linkification contract (source-level,
 * matching this codebase's existing convention for community frontend files
 * — see tests/unit/community-composer.test.js).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('extractMentionedHandles / resolveMentions (services/community.service.js)', () => {
  const { extractMentionedHandles } = require('../../services/community.service');

  it('extracts distinct, lower-cased handles', () => {
    expect(extractMentionedHandles('Ask @Alex or @alex, or maybe @Sam.')).toEqual(['alex', 'sam']);
  });

  it('ignores handles shorter than 3 characters (an email-like "@a" is not a mention)', () => {
    expect(extractMentionedHandles('reply to me @a')).toEqual([]);
  });

  it('returns nothing for text with no @ at all', () => {
    expect(extractMentionedHandles('No mentions in this post.')).toEqual([]);
  });

  it('caps extraction at 10 distinct handles', () => {
    const text = Array.from({ length: 15 }, (_unused, i) => `@handle${i}`).join(' ');
    expect(extractMentionedHandles(text)).toHaveLength(10);
  });
});

describe('client-side mention linkification (public/assets/js/community/thread.js)', () => {
  const threadSrc = read('public/assets/js/community/thread.js');

  it('stamps each post body with the handles the server already resolved', () => {
    expect(threadSrc).toMatch(
      /efc-post__body" data-mentions="\$\{EFC\.esc\(JSON\.stringify\(\(d\.mentions \|\| \[\]\)\.map/
    );
    expect(threadSrc).toMatch(
      /efc-post__body" data-mentions="\$\{EFC\.esc\(JSON\.stringify\(\(reply\.mentions \|\| \[\]\)\.map/
    );
  });

  it('walks real DOM text nodes rather than regexing the HTML string', () => {
    expect(threadSrc).toContain('document.createTreeWalker(container, NodeFilter.SHOW_TEXT');
    // The whole point: it never touches innerHTML directly for this pass.
    expect(threadSrc).not.toMatch(/container\.innerHTML\s*=\s*.*@/);
  });

  it('only linkifies handles present in the per-post data-mentions set', () => {
    expect(threadSrc).toContain('handleSet.has(handle)');
  });

  it('is wired into the render pass so every load re-applies it', () => {
    const renderFn = threadSrc.match(/function render\(\) \{[\s\S]*?\n {2}\}/);
    expect(renderFn).toBeTruthy();
    expect(renderFn[0]).toContain('linkifyMentions();');
  });
});

describe('mention notifications', () => {
  const communitySrc = read('services/community.service.js');
  const discussionsRouteSrc = read('routes/community.js');
  const repliesRouteSrc = read('routes/community-interactions.js');

  it('uses a deterministic notification id so a retry cannot double-notify', () => {
    expect(communitySrc).toContain('`cnotif_mention_${postId}_${mention.userId}`');
  });

  it('only notifies mentions on an immediately-published discussion, not one held for review', () => {
    const createRoute = discussionsRouteSrc.match(
      /router\.post\(\s*\n\s*'\/discussions',[\s\S]*?\n\);/
    );
    expect(createRoute).toBeTruthy();
    expect(createRoute[0]).toContain("if (verdict.decision === 'review') {");
    expect(createRoute[0]).toContain('} else if (mentions.length > 0) {');
    expect(createRoute[0]).toContain('community.notifyMentionedUsers(');
  });

  it('links a reply mention notification straight to the reply, not just the thread', () => {
    expect(repliesRouteSrc).toContain(
      'actionUrl: `${community.discussionPath(discussion)}#reply-${reply.id}`'
    );
  });
});

describe('efc-mention styling', () => {
  it('is defined in the community stylesheet', () => {
    const css = read('public/assets/css/community.css');
    expect(css).toContain('.efc-mention {');
  });
});
