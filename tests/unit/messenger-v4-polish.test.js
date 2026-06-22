'use strict';

/**
 * Messenger v4 polish tests
 * Covers fixes from the "Polish Messenger v4 UI and harden message state handling" PR:
 *  1. Conversation preview — no duplicate "You: You:" prefix
 *  2. Rate limit enforcement — messagesPerDay and threadsPerDay
 *  3. Route validation — self-only and duplicate participant rejection
 *  4. messengerErrorStatus — 429 for all rate-limit variants
 */

const path = require('path');
const fs = require('fs');
const nodeVm = require('vm');

// ─── 1. Preview formatting ─────────────────────────────────────────────────

describe('ConversationListV4._buildPreview — no duplicate prefix', () => {
  // Load the module via vm so we can call _buildPreview directly without a DOM
  let ConversationListV4;

  beforeAll(() => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../public/messenger/js/ConversationListV4.js'),
      'utf8'
    );
    // Stub the global env expected by the module
    const sandbox = {
      window: { ConversationListV4: null },
      document: { querySelector: () => null },
      console,
    };
    nodeVm.runInNewContext(src, sandbox);
    ConversationListV4 = sandbox.window.ConversationListV4;
  });

  function buildPreview(content, senderId, currentUserId) {
    const inst = Object.create(ConversationListV4.prototype);
    // Minimal escape implementation
    inst.escape = str =>
      String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const conv = { lastMessage: { content, senderId } };
    const user = { id: currentUserId, _id: currentUserId };
    return inst._buildPreview(conv, user);
  }

  test('own message with clean content shows "You: test"', () => {
    const result = buildPreview('test', 'user-1', 'user-1');
    expect(result).toContain('>You: test<');
    expect(result).not.toContain('You: You:');
  });

  test('own message with already-prefixed content strips duplicate', () => {
    // Simulates old stored data where content itself was "You: test"
    const result = buildPreview('You: test', 'user-1', 'user-1');
    expect(result).toContain('>You: test<');
    expect(result).not.toContain('You: You:');
  });

  test('own message with case-insensitive prefix is stripped', () => {
    const result = buildPreview('you: something', 'user-1', 'user-1');
    expect(result).not.toContain('you: you:');
    expect(result).not.toContain('You: you:');
  });

  test('received message shows content without You: prefix', () => {
    const result = buildPreview('Hello there', 'user-2', 'user-1');
    expect(result).toBe('Hello there');
    expect(result).not.toContain('You:');
  });

  test('empty lastMessage content shows attachment placeholder', () => {
    const result = buildPreview('', 'user-1', 'user-1');
    expect(result).toContain('📎 Attachment');
  });

  test('null lastMessage returns empty state HTML', () => {
    const inst = Object.create(ConversationListV4.prototype);
    inst.escape = str => String(str ?? '');
    const conv = { lastMessage: null };
    const user = { id: 'u1' };
    const result = inst._buildPreview(conv, user);
    expect(result).toContain('No messages yet');
  });
});

// ─── 2. CSS — no duplicate ::before rule ─────────────────────────────────

describe('messenger-v4.css — You: prefix is not duplicated in CSS', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../../public/assets/css/messenger-v4.css'),
    'utf8'
  );

  test('CSS does not have ::before content adding "You: "', () => {
    // The pseudo-element was removed; prefix is now solely in JS
    expect(css).not.toMatch(/message-preview--you::before\s*\{[^}]*content:\s*['"]You:/);
  });

  test('CSS still has the .messenger-v4__message-preview--you selector', () => {
    expect(css).toMatch(/\.messenger-v4__message-preview--you/);
  });
});

// ─── 3. Route validation — participant checks ─────────────────────────────

describe('routes/messenger-v4.js — createConversation participant validation', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '../../routes/messenger-v4.js'), 'utf8');

  test('rejects self-only conversations (no other participant)', () => {
    expect(routeSrc).toContain("'A conversation must include at least one other participant'");
  });

  test('rejects duplicate participant IDs', () => {
    expect(routeSrc).toContain("'Duplicate participant IDs are not allowed'");
  });

  test('self-only check filters out current user from participantIds', () => {
    // The check: filter(id => id !== currentUserId) then check length === 0
    expect(routeSrc).toContain('participantIds.filter(id => id !== currentUserId)');
  });

  test('duplicate check uses Set comparison', () => {
    expect(routeSrc).toContain('new Set(participantIds).size !== participantIds.length');
  });
});

// ─── 4. messengerErrorStatus returns 429 for all rate-limit patterns ──────

describe('messengerErrorStatus — 429 for rate-limit messages', () => {
  // Extract the helper function into an isolated VM context for focused testing.
  const routeSrc = fs.readFileSync(path.join(__dirname, '../../routes/messenger-v4.js'), 'utf8');

  let messengerErrorStatus;
  beforeAll(() => {
    const fnMatch = routeSrc.match(/function messengerErrorStatus\(msg\)\s*\{[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    messengerErrorStatus = nodeVm.runInNewContext(`(${fnMatch[0]})`);
  });

  test('old "Rate limit" string → 429', () => {
    expect(messengerErrorStatus('Rate limit: 20 messages per hour')).toBe(429);
  });

  test('new friendly "You\'ve reached" string → 429', () => {
    expect(messengerErrorStatus("You've reached the limit of 20 messages per hour.")).toBe(429);
  });

  test('"Too many" → 429', () => {
    expect(messengerErrorStatus('Too many messages')).toBe(429);
  });

  test('"spam" → 429', () => {
    expect(messengerErrorStatus('Message flagged as spam')).toBe(429);
  });

  test('"rate limit" lowercase → 429', () => {
    expect(messengerErrorStatus('rate limit exceeded')).toBe(429);
  });

  test('"not found" → 404', () => {
    expect(messengerErrorStatus('conversation not found')).toBe(404);
  });

  test('"not a participant" → 403', () => {
    expect(messengerErrorStatus('not a participant')).toBe(403);
  });

  test('generic error → 500', () => {
    expect(messengerErrorStatus('Unexpected database error')).toBe(500);
  });
});

// ─── 5. messenger-v4.service.js — rate limit checks ─────────────────────

describe('messenger-v4.service.js — checkRateLimit coverage', () => {
  const svcSrc = fs.readFileSync(
    path.join(__dirname, '../../services/messenger-v4.service.js'),
    'utf8'
  );

  test('messagesPerDay check is present', () => {
    expect(svcSrc).toContain('messagesPerDay');
    expect(svcSrc).toContain('todayCount >= limits.messagesPerDay');
  });

  test('checkThreadRateLimit method exists', () => {
    expect(svcSrc).toContain('async checkThreadRateLimit(userId)');
  });

  test('threadsPerDay is referenced in checkThreadRateLimit', () => {
    const fnStart = svcSrc.indexOf('async checkThreadRateLimit');
    const fnEnd = svcSrc.indexOf('\n  }', fnStart) + 4;
    const fn = svcSrc.slice(fnStart, fnEnd);
    expect(fn).toContain('threadsPerDay');
  });

  test('friendly retryAfter is set on day limit response', () => {
    expect(svcSrc).toContain('retryAfter: 86400');
  });

  test('friendly retryAfter is set on hour limit response', () => {
    expect(svcSrc).toContain('retryAfter: 3600');
  });

  test('per-day check uses UTC day boundary (startOfDay.setUTCHours)', () => {
    expect(svcSrc).toContain('setUTCHours(0, 0, 0, 0)');
  });
});

// ─── 6. Thread rate limit wired into createConversation route ────────────

describe('routes/messenger-v4.js — thread rate limit in createConversation', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '../../routes/messenger-v4.js'), 'utf8');

  test('createConversation calls checkThreadRateLimit before creating', () => {
    expect(routeSrc).toContain('checkThreadRateLimit(currentUserId)');
  });

  test('returns 429 when thread limit is hit', () => {
    // The rejection block includes status 429
    const idx = routeSrc.indexOf('checkThreadRateLimit');
    const nearby = routeSrc.slice(idx, idx + 400);
    expect(nearby).toContain('429');
  });
});

// ─── 7. MessageComposerV4 — friendly error copy ──────────────────────────

describe('MessageComposerV4 — friendly send error messages', () => {
  const composerSrc = fs.readFileSync(
    path.join(__dirname, '../../public/messenger/js/MessageComposerV4.js'),
    'utf8'
  );

  test('catch block handles rate-limit errors with friendly copy', () => {
    expect(composerSrc).toMatch(/rate limit|you've reached|too many/i);
    expect(composerSrc).toContain('_showInlineError');
  });

  test('catch block handles spam errors with friendly copy', () => {
    expect(composerSrc).toMatch(/spam/i);
  });

  test('_showInlineError has role="alert" for screen readers', () => {
    expect(composerSrc).toContain("setAttribute('role', 'alert')");
  });

  test('error auto-dismisses after timeout', () => {
    expect(composerSrc).toContain('_errorTimer');
    expect(composerSrc).toContain('setTimeout');
  });
});
