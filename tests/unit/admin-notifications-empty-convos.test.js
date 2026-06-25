'use strict';

/**
 * Tests for:
 *  Issue 1 — Mobile notification dropdown positioning fix
 *  Issue 2 — Empty (no-message) conversations excluded from inbox and admin
 */

const fs   = require('fs');
const path = require('path');

// ── Issue 1: notification dropdown positioning ─────────────────────────────

describe('notifications.js — mobile dropdown positioning', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/notifications.js'),
    'utf8'
  );

  test('uses left+right pin for narrow viewports (<= 480px)', () => {
    expect(src).toContain('viewportWidth <= 480');
    expect(src).toContain("dropdown.style.left     = '12px'");
    expect(src).toContain("dropdown.style.right    = '12px'");
  });

  test('mobile branch sets maxWidth none so left+right pins control width', () => {
    expect(src).toContain("dropdown.style.maxWidth = 'none'");
  });

  test('clears inline left style on desktop to prevent stale mobile style', () => {
    expect(src).toContain("dropdown.style.left     = ''");
  });

  test('restores CSS maxWidth on desktop by clearing the inline override', () => {
    expect(src).toContain("dropdown.style.maxWidth = ''");
  });

  test('guards against negative right on desktop with Math.max(0, right)', () => {
    expect(src).toContain('Math.max(0, right)');
  });

  test('mobile branch sets width to auto (overrides CSS fixed width)', () => {
    expect(src).toContain("dropdown.style.width    = 'auto'");
  });

  test('desktop branch restores CSS-defined width by clearing the inline width', () => {
    expect(src).toContain("dropdown.style.width    = ''");
  });
});

// ── Issue 2: empty conversation filtering ─────────────────────────────────

describe('messenger-v4.service.js — getConversations excludes empty conversations', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../services/messenger-v4.service.js'),
    'utf8'
  );

  test('getConversations filters on messageCount > 0', () => {
    const start = src.indexOf('async getConversations(');
    const end   = src.indexOf('  async ', start + 50);
    const fn    = src.slice(start, end);
    // messageCount is 0 at conversation creation and incremented on every
    // message send — it is the canonical signal that a conversation has content.
    expect(fn).toContain('messageCount');
    expect(fn).toContain('$gt: 0');
  });

  test('messageCount filter is applied to the query before .find()', () => {
    const start   = src.indexOf('async getConversations(');
    const end     = src.indexOf('  async ', start + 50);
    const fn      = src.slice(start, end);
    const filterIdx = fn.indexOf('query.messageCount');
    const findIdx   = fn.indexOf('.find(query)');
    expect(filterIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeLessThan(findIdx);
  });
});

describe('routes/messenger-v4.js — admin endpoint excludes empty conversations', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../routes/messenger-v4.js'),
    'utf8'
  );

  test('admin /admin/conversations query starts with messageCount > 0', () => {
    // Locate the admin route then find its query initialisation
    const adminRouteIdx = src.indexOf("'/admin/conversations'");
    expect(adminRouteIdx).toBeGreaterThan(-1);
    const queryStart = src.indexOf('const query =', adminRouteIdx);
    const queryInit  = src.slice(queryStart, queryStart + 100);
    expect(queryInit).toContain('messageCount');
    expect(queryInit).toContain('$gt: 0');
  });
});

describe('routes/messenger-v4.js — conversation-created WS only to creator', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../routes/messenger-v4.js'),
    'utf8'
  );

  test('does not emit conversation-created to all participants via emitToConversation', () => {
    // emitToConversation broadcasts to ALL participants; must NOT be used for empty creation
    const createStart = src.indexOf("router.post(\n  '/conversations'");
    const sendStart   = src.indexOf("router.post(\n  '/conversations/:id/messages'");
    expect(createStart).toBeGreaterThan(-1);
    expect(sendStart).toBeGreaterThan(createStart);
    const createSlice = src.slice(createStart, sendStart);
    expect(createSlice).not.toContain(
      "emitToConversation(conversation, 'messenger:v4:conversation-created'"
    );
  });

  test('emits conversation-created only to currentUserId (creator)', () => {
    const createStart = src.indexOf("router.post(\n  '/conversations'");
    const sendStart   = src.indexOf("router.post(\n  '/conversations/:id/messages'");
    const createSlice = src.slice(createStart, sendStart);
    expect(createSlice).toContain(
      "wsServer.to(currentUserId).emit('messenger:v4:conversation-created'"
    );
  });
});

// ── Issue 2: sendMessage still broadcasts to all participants ─────────────

describe('routes/messenger-v4.js — sendMessage keeps full broadcast', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../routes/messenger-v4.js'),
    'utf8'
  );

  test('sendMessage route still uses emitToConversation (broadcasts to all)', () => {
    const sendStart = src.indexOf("router.post(\n  '/conversations/:id/messages'");
    expect(sendStart).toBeGreaterThan(-1);
    const sendSlice = src.slice(sendStart, sendStart + 5000);
    expect(sendSlice).toContain('emitToConversation');
  });
});

// ── Issue 2: validation — whitespace-only messages ────────────────────────

describe('messenger-v4.service.js — message content validation', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../services/messenger-v4.service.js'),
    'utf8'
  );

  test('sendMessage sanitises content before persisting', () => {
    const start = src.indexOf('async sendMessage(');
    const end   = src.indexOf('  async ', start + 100);
    const fn    = src.slice(start, end);
    expect(fn).toMatch(/sanitize|sanitise|sanitized|trim|content.*empty|empty.*content/i);
  });
});
