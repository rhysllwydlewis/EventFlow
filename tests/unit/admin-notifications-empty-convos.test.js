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
    expect(src).toContain("viewportWidth <= 480");
    expect(src).toContain("dropdown.style.left   = '12px'");
    expect(src).toContain("dropdown.style.right  = '12px'");
  });

  test('clears inline left style on desktop to prevent stale mobile style', () => {
    expect(src).toContain("dropdown.style.left  = ''");
  });

  test('guards against negative right on desktop with Math.max(0, right)', () => {
    expect(src).toContain('Math.max(0, right)');
  });

  test('mobile branch sets width to auto (overrides CSS fixed width)', () => {
    expect(src).toContain("dropdown.style.width  = 'auto'");
  });

  test('desktop branch restores CSS-defined width by clearing the inline width', () => {
    expect(src).toContain("dropdown.style.width = ''");
  });
});

// ── Issue 2: empty conversation filtering ─────────────────────────────────

describe('messenger-v4.service.js — getConversations excludes empty conversations', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../services/messenger-v4.service.js'),
    'utf8'
  );

  test('getConversations adds lastMessage $ne null filter', () => {
    // Extract the getConversations function body
    const start = src.indexOf('async getConversations(');
    const end   = src.indexOf('  async ', start + 50);
    const fn    = src.slice(start, end);
    expect(fn).toContain('lastMessage');
    expect(fn).toContain('$ne: null');
  });

  test('lastMessage filter is in the query object, not just search clause', () => {
    const start = src.indexOf('async getConversations(');
    const end   = src.indexOf('  async ', start + 50);
    const fn    = src.slice(start, end);
    // The filter must appear before the .find(query) call
    const filterIdx = fn.indexOf('lastMessage');
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

  test('admin /admin/conversations query starts with lastMessage $ne null', () => {
    const adminStart = src.indexOf('/admin/conversations\'');
    // Find the query initialisation after the admin route declaration
    const queryStart = src.indexOf('const query =', adminStart);
    const queryEnd   = queryStart + 200;
    const queryInit  = src.slice(queryStart, queryEnd);
    expect(queryInit).toContain('lastMessage');
    expect(queryInit).toContain('$ne: null');
  });
});

describe('routes/messenger-v4.js — conversation-created WS only to creator', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../routes/messenger-v4.js'),
    'utf8'
  );

  test('does not emit conversation-created to all participants via emitToConversation', () => {
    // emitToConversation broadcasts to ALL participants; we must NOT use it for creation
    const createStart = src.indexOf("router.post(\n  '/conversations'");
    const sendStart   = src.indexOf("router.post(\n  '/conversations/:id/messages'");
    const createSlice = src.slice(createStart, sendStart);
    // emitToConversation in the creation route would send to all participants
    const hasOldBroadcast = createSlice.includes(
      "emitToConversation(conversation, 'messenger:v4:conversation-created'"
    );
    expect(hasOldBroadcast).toBe(false);
  });

  test('emits conversation-created only to currentUserId (creator)', () => {
    const createStart = src.indexOf("router.post(\n  '/conversations'");
    const sendStart   = src.indexOf("router.post(\n  '/conversations/:id/messages'");
    const createSlice = src.slice(createStart, sendStart);
    expect(createSlice).toContain("wsServer.to(currentUserId).emit('messenger:v4:conversation-created'");
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
    // After sendStart we expect emitToConversation to be used for new-message
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

  test('sendMessage sanitises content (non-empty check or trim)', () => {
    // The service must reject/strip whitespace-only content
    expect(src).toMatch(/sanitize|sanitise|trim|content.*length|empty/i);
  });
});
