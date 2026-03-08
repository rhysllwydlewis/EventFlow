/**
 * Integration tests for messenger client-side fixes.
 * Validates correctness of file content/structure without importing
 * Node-native modules (e.g. mongodb) that are absent from this test env.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MESSENGER_DIR = path.resolve(__dirname, '..', '..', 'public', 'messenger');
const SERVICES_DIR = path.resolve(__dirname, '..', '..', 'services');

describe('Messenger client-side fixes', () => {
  let indexHtml;
  let messengerAppSrc;
  let messengerApiSrc;
  let chatViewSrc;
  let conversationListSrc;
  let contactPickerSrc;
  let triggerSrc;
  let serviceSrc;

  beforeAll(() => {
    indexHtml = fs.readFileSync(path.join(MESSENGER_DIR, 'index.html'), 'utf8');
    messengerAppSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerAppV4.js'), 'utf8');
    messengerApiSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerAPI.js'), 'utf8');
    chatViewSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ChatViewV4.js'), 'utf8');
    conversationListSrc = fs.readFileSync(
      path.join(MESSENGER_DIR, 'js', 'ConversationListV4.js'),
      'utf8'
    );
    contactPickerSrc = fs.readFileSync(
      path.join(MESSENGER_DIR, 'js', 'ContactPickerV4.js'),
      'utf8'
    );
    triggerSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerTrigger.js'), 'utf8');
    serviceSrc = fs.readFileSync(path.join(SERVICES_DIR, 'messenger-v4.service.js'), 'utf8');
  });

  // ── Favicon fix ─────────────────────────────────────────────────────────────

  it('index.html uses /favicon.svg (correct path)', () => {
    expect(indexHtml).toContain('href="/favicon.svg"');
  });

  it('index.html does NOT reference the broken /assets/icons/favicon.svg path', () => {
    expect(indexHtml).not.toContain('/assets/icons/favicon.svg');
  });

  // ── MessengerAPI CSRF freshness ──────────────────────────────────────────────

  it('MessengerAPI does not cache csrfToken in constructor (reads fresh per-request)', () => {
    expect(messengerApiSrc).not.toContain('this.csrfToken = this.getCsrfToken()');
  });

  it('MessengerAPI calls getCsrfToken() in request() not this.csrfToken', () => {
    expect(messengerApiSrc).toContain('getCsrfToken()');
    // Should NOT rely on a stored property
    expect(messengerApiSrc).not.toMatch(/config\.headers\[.X-CSRF-Token.\]\s*=\s*this\.csrfToken/);
  });

  // ── markAsUnread sends correct payload ──────────────────────────────────────

  it('MessengerAPI.markAsUnread sends { markUnread: true } (not the old { isUnread: true })', () => {
    expect(messengerApiSrc).toContain('markUnread: true');
    expect(messengerApiSrc).not.toContain('isUnread: true');
  });

  // ── Server-side markUnread support ─────────────────────────────────────────

  it('messenger-v4.service.js handles markUnread to increment unreadCount', () => {
    expect(serviceSrc).toContain('updates.markUnread');
    expect(serviceSrc).toContain('unreadCount');
  });

  // ── getContacts supports role filter ────────────────────────────────────────

  it('MessengerAPI.getContacts accepts and forwards role option as query param', () => {
    expect(messengerApiSrc).toContain('options.role');
    expect(messengerApiSrc).toContain("params.append('role'");
  });

  // ── ContactPickerV4 passes role to API ──────────────────────────────────────

  it('ContactPickerV4.search passes role=supplier for customer users', () => {
    expect(contactPickerSrc).toContain("role: 'supplier'");
  });

  // ── MessengerTrigger uses correct auth global ────────────────────────────────

  it('MessengerTrigger uses AuthStateManager (not the non-existent AuthState)', () => {
    expect(triggerSrc).toContain('AuthStateManager');
    // The old broken check should be gone
    expect(triggerSrc).not.toContain('window.AuthState && window.AuthState.isAuthenticated');
  });

  // ── handleDeepLink handles ?new=true ───────────────────────────────────────

  it("handleDeepLink checks openNew === 'true' (from MessengerTrigger ?new=true)", () => {
    expect(messengerAppSrc).toContain("openNew === 'true'");
  });

  it("handleDeepLink also handles openNew === '1' (legacy)", () => {
    expect(messengerAppSrc).toContain("openNew === '1'");
  });

  // ── messenger:open-contact-by-id is handled ────────────────────────────────

  it('MessengerAppV4 listens for messenger:open-contact-by-id event', () => {
    expect(messengerAppSrc).toContain("'messenger:open-contact-by-id'");
  });

  // ── Composer guards against null conversationId ─────────────────────────────

  it('ChatViewV4 uses server hasMore flag for infinite scroll pagination', () => {
    expect(chatViewSrc).toContain('data.hasMore');
  });

  it('ChatViewV4 hasMore falls back to count heuristic when server omits the flag', () => {
    // The fallback expression: data.hasMore !== undefined ? data.hasMore : messages.length >= 40
    expect(chatViewSrc).toMatch(/data\.hasMore !== undefined/);
    // Both the initial load (>=40) and pagination (>=30) fallbacks are present
    expect(chatViewSrc).toContain('messages.length >= 40');
    expect(chatViewSrc).toContain('older.length >= 30');
  });

  // ── Right-click context menu ────────────────────────────────────────────────

  it('ConversationListV4 has contextmenu event listener on items', () => {
    expect(conversationListSrc).toContain("'contextmenu'");
  });

  it('ConversationListV4 right-click menu dispatches messenger:mark-unread', () => {
    expect(conversationListSrc).toContain("'messenger:mark-unread'");
  });

  it('ConversationListV4 right-click menu dispatches messenger:delete-conversation', () => {
    expect(conversationListSrc).toContain("'messenger:delete-conversation'");
  });

  // ── Delete conversation cleans up socket/context ────────────────────────────

  it('MessengerAppV4 delete handler calls contextBanner.hide() on delete', () => {
    expect(messengerAppSrc).toContain('contextBanner?.hide()');
  });

  it('MessengerAppV4 delete handler leaves WebSocket conversation room', () => {
    expect(messengerAppSrc).toContain('socket?.leaveConversation(id)');
  });

  // ── Uses branded confirm dialog ──────────────────────────────────────────────

  it('MessengerAppV4 uses MessengerModals.showConfirm for delete (not native confirm)', () => {
    // Should reference showConfirm for delete conversation
    expect(messengerAppSrc).toContain('showConfirm');
  });

  it('MessengerAppV4 calls showEditPrompt (correct method name, not showEdit)', () => {
    expect(messengerAppSrc).toContain('showEditPrompt');
    expect(messengerAppSrc).not.toContain('showEdit(');
  });

  // ── Security: URL sanitization ──────────────────────────────────────────────

  it('MessageBubbleV4 has safeUrl() method to block javascript: URIs in file hrefs', () => {
    const bubbleSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessageBubbleV4.js'), 'utf8');
    expect(bubbleSrc).toContain('static safeUrl(');
    expect(bubbleSrc).toContain('javascript');
    // File attachment href uses safeUrl, not just escape
    expect(bubbleSrc).toContain('MessageBubbleV4.safeUrl(attachment.url)');
  });

  it('ContextBannerV4 sanitises context.url before assigning to link.href', () => {
    const bannerSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ContextBannerV4.js'), 'utf8');
    expect(bannerSrc).toContain('_safeUrl(');
    // Should NOT assign href directly from context.url without sanitisation
    expect(bannerSrc).not.toContain('link.href = context.url');
  });

  it('ContextBannerV4 only allows relative (same-origin) paths for thumbnail src', () => {
    const bannerSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ContextBannerV4.js'), 'utf8');
    // Validates imageUrl starts with '/' (relative path)
    expect(bannerSrc).toContain('/^\\//');
  });

  // ── MessengerState filter fixes ─────────────────────────────────────────────

  it('MessengerState.getFilteredConversations excludes archived from the all tab', () => {
    const stateSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerState.js'), 'utf8');
    // The 'all' else branch should filter out archived conversations
    expect(stateSrc).toContain('isArchived');
  });

  it('MessengerState.getFilteredConversations uses currentUser.id || currentUser._id for uid lookup', () => {
    const stateSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerState.js'), 'utf8');
    expect(stateSrc).toContain('currentUser?.id || this.currentUser?._id');
  });

  // ── selectConversation immediately updates local unread count ───────────────

  it('MessengerAppV4 selectConversation updates local unreadCount after mark-read API call', () => {
    // Should mutate the participant's unreadCount in local state (not wait for next full reload)
    expect(messengerAppSrc).toContain('participant.unreadCount = 0');
    expect(messengerAppSrc).toContain('state.updateConversation(conv)');
  });

  // ── Incoming message unread badge increment ─────────────────────────────────

  it('MessengerAppV4 new-message handler increments local unreadCount for background convs', () => {
    // Should optimistically update me.unreadCount when a WS message arrives for a non-active conv
    expect(messengerAppSrc).toContain('me.unreadCount = (me.unreadCount || 0) + 1');
  });

  // ── MessengerAPI query param alignment ─────────────────────────────────────

  it("MessengerAPI.getConversations sends 'unread=true' (matching server param, not 'unreadOnly')", () => {
    expect(messengerApiSrc).toContain("params.append('unread', 'true')");
    expect(messengerApiSrc).not.toContain("params.append('unreadOnly'");
  });

  // ── MessengerModals keyboard accessibility ──────────────────────────────────

  it('MessengerModals.showConfirm Enter key only confirms when confirm button has focus', () => {
    const modalsSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerModals.js'), 'utf8');
    // Should guard against confirming when cancel button has focus
    expect(modalsSrc).toContain('document.activeElement !== cancelBtn');
  });

  it('MessengerModals uses requestAnimationFrame (not setTimeout) for focus management', () => {
    const modalsSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerModals.js'), 'utf8');
    expect(modalsSrc).not.toMatch(/setTimeout.*focus.*100/);
    expect(modalsSrc).toContain('requestAnimationFrame');
  });

  // ── Admin XSS hardening ─────────────────────────────────────────────────────

  it('admin-init.js escapes user.name and user.email before inserting into table rows', () => {
    const adminSrc = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'assets', 'js', 'pages', 'admin-init.js'),
      'utf8'
    );
    expect(adminSrc).toContain("escapeHtml(u.name || '')");
    expect(adminSrc).toContain("escapeHtml(u.email || '')");
    // Should also escape role names in analytics
    expect(adminSrc).toContain('escapeHtml(r)');
  });

  // ── CSRF token base64 safety ────────────────────────────────────────────────

  it('MessengerAPI.getCsrfToken uses indexOf (not split) so base64 tokens with = work', () => {
    expect(messengerApiSrc).toContain("trimmed.indexOf('=')");
    // Should NOT use the broken split('=') destructuring (outside comments)
    const codeWithoutComments = messengerApiSrc.replace(/\/\/[^\n]*/g, '');
    expect(codeWithoutComments).not.toContain("split('=')");
  });

  it('MessengerAPI.getCsrfToken falls back to window.__CSRF_TOKEN__ and window.csrfToken', () => {
    expect(messengerApiSrc).toContain('window.__CSRF_TOKEN__');
    expect(messengerApiSrc).toContain('window.csrfToken');
  });

  // ── Archive active conversation navigates back ──────────────────────────────

  it('MessengerAppV4 archive handler resets chat view when active conversation is archived', () => {
    expect(messengerAppSrc).toContain("'messenger:archive-conversation'");
    // Should check if the archived id matches the active conversation
    expect(messengerAppSrc).toContain('id === this._activeConversationId');
  });

  // ── Optimistic pin/archive state update ─────────────────────────────────────

  it('_togglePin does optimistic local state update (me.isPinned) instead of full reload', () => {
    expect(messengerAppSrc).toContain('me.isPinned = newPinned');
  });

  it('_toggleArchive does optimistic local state update (me.isArchived) instead of full reload', () => {
    expect(messengerAppSrc).toContain('me.isArchived = newArchived');
  });

  // ── conversation-deleted WebSocket event ────────────────────────────────────

  it('MessengerSocket forwards messenger:v4:conversation-deleted to window event', () => {
    const socketSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerSocket.js'), 'utf8');
    expect(socketSrc).toContain("'messenger:v4:conversation-deleted'");
    expect(socketSrc).toContain("'messenger:conversation-deleted'");
  });

  it('MessengerAppV4 handles messenger:conversation-deleted event from other sessions', () => {
    expect(messengerAppSrc).toContain("'messenger:conversation-deleted'");
  });

  // ── A) Image unavailable placeholder readability ────────────────────────────

  it('messenger-v4-polish.css error label uses a neutral grey text color on a light background', () => {
    const cssSrc = fs.readFileSync(
      path.join(MESSENGER_DIR, 'css', 'messenger-v4-polish.css'),
      'utf8'
    );
    expect(cssSrc).toContain('.messenger-v4__attachment-error-label');
    // Uses a light background (low opacity black overlay) so grey text is readable
    expect(cssSrc).toMatch(
      /\.messenger-v4__attachment-error-label\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0,/
    );
    // Uses a neutral grey text color (readable on light background)
    expect(cssSrc).toMatch(/\.messenger-v4__attachment-error-label\s*\{[^}]*color:\s*#9ca3af/);
  });

  it('messenger-v4-polish.css error label has a secondary hint class defined', () => {
    const cssSrc = fs.readFileSync(
      path.join(MESSENGER_DIR, 'css', 'messenger-v4-polish.css'),
      'utf8'
    );
    expect(cssSrc).toContain('.messenger-v4__attachment-error-hint');
  });

  it('MessageBubbleV4 onerror handler adds title attribute for accessibility', () => {
    const bubbleSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessageBubbleV4.js'), 'utf8');
    expect(bubbleSrc).toContain("w.title='Image unavailable'");
  });

  it('MessageBubbleV4 onerror handler appends a secondary hint about file removal', () => {
    const bubbleSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessageBubbleV4.js'), 'utf8');
    expect(bubbleSrc).toContain('messenger-v4__attachment-error-hint');
    expect(bubbleSrc).toContain('The file may have been removed');
  });

  // ── B2) ConversationView image onerror & XSS hardening ─────────────────────

  it('ConversationView.renderAttachments has an onerror handler matching MessageBubbleV4 pattern', () => {
    const cvSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ConversationView.js'), 'utf8');
    // Must have onerror on the img tag
    expect(cvSrc).toContain('onerror=');
    // onerror must show the "Image unavailable" label
    expect(cvSrc).toContain('Image unavailable');
    // onerror must include the hint about file removal
    expect(cvSrc).toContain('The file may have been removed');
  });

  it('ConversationView.renderAttachments escapes att.url and att.name to prevent XSS', () => {
    const cvSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ConversationView.js'), 'utf8');
    // URL and name must both be escaped before injection into HTML
    expect(cvSrc).toContain('this.escapeHtml(att.url');
    expect(cvSrc).toContain('this.escapeHtml(att.name');
  });

  it('ConversationView.renderAttachments has a null guard for missing att objects', () => {
    const cvSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ConversationView.js'), 'utf8');
    // Should guard against null/undefined attachment entries in the array
    expect(cvSrc).toContain('if (!att)');
  });

  it('ConversationView.renderAttachments uses rel=noopener noreferrer on file links', () => {
    const cvSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ConversationView.js'), 'utf8');
    expect(cvSrc).toContain('rel="noopener noreferrer"');
  });

  // ── B3) CSS: message-content min-width prevents vertical text ───────────────

  it('messenger-v4.css sets a non-zero min-width on .messenger-v4__message-content', () => {
    const cssSrc = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'assets', 'css', 'messenger-v4.css'),
      'utf8'
    );
    // The base rule must have a positive pixel min-width (not 0) to prevent collapse
    expect(cssSrc).toMatch(/\.messenger-v4__message-content\s*\{[^}]*min-width:\s*[1-9]\d*px/);
    // Must NOT be min-width: 0 in the base rule
    expect(cssSrc).not.toMatch(/\.messenger-v4__message-content\s*\{[^}]*min-width:\s*0[;\s]/);
  });

  it('messenger-v4.css sets word-break and overflow-wrap on .messenger-v4__message-content', () => {
    const cssSrc = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'public', 'assets', 'css', 'messenger-v4.css'),
      'utf8'
    );
    // Both text-wrapping properties must be set on the content wrapper
    expect(cssSrc).toContain('word-break: break-word');
    expect(cssSrc).toContain('overflow-wrap: anywhere');
  });

  // ── C) Mark read/unread toggle ──────────────────────────────────────────────

  it('ChatViewV4 _updateMarkUnreadBtn updates aria-label based on unread state', () => {
    expect(chatViewSrc).toContain('_updateMarkUnreadBtn(');
    expect(chatViewSrc).toContain("'Mark as read'");
    expect(chatViewSrc).toContain("'Mark as unread'");
  });

  it('ChatViewV4 mark-unread button dispatches messenger:mark-read when conversation is unread', () => {
    expect(chatViewSrc).toContain("'messenger:mark-read'");
  });

  it('ChatViewV4 mark-unread button dispatches messenger:mark-unread when conversation is read', () => {
    expect(chatViewSrc).toContain("'messenger:mark-unread'");
  });

  it('ChatViewV4 _renderHeader calls _updateMarkUnreadBtn to reflect conversation state', () => {
    expect(chatViewSrc).toContain('_updateMarkUnreadBtn(');
  });

  it('MessengerAppV4 handles messenger:mark-read event (toggle counterpart)', () => {
    expect(messengerAppSrc).toContain("'messenger:mark-read'");
  });

  it('MessengerAppV4 mark-read handler calls api.markAsRead', () => {
    expect(messengerAppSrc).toContain('api.markAsRead(id)');
  });

  it('MessengerAppV4 mark-unread handler does optimistic local state update', () => {
    expect(messengerAppSrc).toMatch(/mark-unread[\s\S]*?me\.unreadCount\s*=/);
  });

  it('MessengerAppV4 mark-unread handler calls chatView._updateMarkUnreadBtn(true)', () => {
    expect(messengerAppSrc).toContain('chatView._updateMarkUnreadBtn(true)');
  });

  it('MessengerAppV4 mark-read handler calls chatView._updateMarkUnreadBtn(false)', () => {
    expect(messengerAppSrc).toContain('chatView._updateMarkUnreadBtn(false)');
  });

  // ── D) New conversation plus icon and defensive picker handling ─────────────

  it('ConversationListV4 empty-state CTA includes a plus sign prefix', () => {
    expect(conversationListSrc).toContain('+ New Conversation');
  });

  it('MessengerAppV4 open-contact-picker handler warns when contact picker is unavailable', () => {
    expect(messengerAppSrc).toContain('Contact picker is not available');
  });

  // ── ESLint strict-equality fixes (== null → === null || === undefined) ───────

  it('ContactPickerV4 escape() uses strict equality (=== null || === undefined)', () => {
    expect(contactPickerSrc).not.toContain('str == null');
    expect(contactPickerSrc).toContain('str === null || str === undefined');
  });

  it('ContextBannerV4 escape() uses strict equality (=== null || === undefined)', () => {
    const bannerSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'ContextBannerV4.js'), 'utf8');
    expect(bannerSrc).not.toContain('str == null');
    expect(bannerSrc).toContain('str === null || str === undefined');
  });

  it('TypingIndicatorV4 _escape() uses strict equality (=== null || === undefined)', () => {
    const typingSrc = fs.readFileSync(
      path.join(MESSENGER_DIR, 'js', 'TypingIndicatorV4.js'),
      'utf8'
    );
    expect(typingSrc).not.toContain('str == null');
    expect(typingSrc).toContain('str === null || str === undefined');
  });

  it('MessageComposerV4 escape() uses strict equality (=== null || === undefined)', () => {
    const composerSrc = fs.readFileSync(
      path.join(MESSENGER_DIR, 'js', 'MessageComposerV4.js'),
      'utf8'
    );
    expect(composerSrc).not.toContain('str == null');
    expect(composerSrc).toContain('str === null || str === undefined');
  });

  // ── ConversationListV4 context menu read/unread toggle ──────────────────────

  it('ConversationListV4 right-click menu dispatches messenger:mark-read', () => {
    expect(conversationListSrc).toContain("'messenger:mark-read'");
  });

  it('ConversationListV4 context menu uses dynamic mark action based on unread state', () => {
    // The menu action should be determined at menu-show time from the conversation state
    expect(conversationListSrc).toContain("'mark-read'");
    expect(conversationListSrc).toContain("'mark-unread'");
    // Should branch on isUnread to choose the right action and label
    expect(conversationListSrc).toContain('isUnread');
    expect(conversationListSrc).toContain('Mark as Read');
    expect(conversationListSrc).toContain('Mark as Unread');
  });

  it('ConversationListV4 context menu reads participant unreadCount for toggle', () => {
    expect(conversationListSrc).toContain('isUnread = me ? (me.unreadCount || 0) > 0 : false');
  });

  // ── Backend: unused variables / imports fixed ────────────────────────────────

  if (fs.existsSync(path.resolve(__dirname, '..', '..', 'services', 'messenger.service.js'))) {
    it('messenger.service.js does not fetch creator info unnecessarily in existing-conv path', () => {
      const svcSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'services', 'messenger.service.js'),
        'utf8'
      );
      // The dead getUserInfo call before sendMessage in existing-conv branch should be gone
      // If it existed it would appear right before sendMessage inside the initialMessage block
      expect(svcSrc).not.toMatch(/if\s*\(initialMessage\)\s*\{[^}]*getUserInfo\(creatorId\)/s);
    });
  }

  if (fs.existsSync(path.resolve(__dirname, '..', '..', 'routes', 'messenger.js'))) {
    it('routes/messenger.js applies applyUploadLimiter to the attachment route', () => {
      const routeSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'routes', 'messenger.js'),
        'utf8'
      );
      // applyUploadLimiter must be applied to the POST messages route
      expect(routeSrc).toContain('applyUploadLimiter');
      // It should appear in the route definition (not just in the function declaration)
      expect(routeSrc).toMatch(/router\.post\([^)]*messages[\s\S]*?applyUploadLimiter/);
    });
  }

  if (fs.existsSync(path.resolve(__dirname, '..', '..', 'services', 'LabelService.js'))) {
    it('LabelService does not import unused withTransaction/validateObjectId', () => {
      const svcSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'services', 'LabelService.js'),
        'utf8'
      );
      expect(svcSrc).not.toContain("require('../utils/mongoHelpers')");
      expect(svcSrc).not.toContain("require('../utils/validators')");
    });
  }

  it('models/ConversationV4.js does not import unused ObjectId', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'models', 'ConversationV4.js'),
      'utf8'
    );
    expect(src).not.toContain("require('mongodb')");
  });

  if (fs.existsSync(path.resolve(__dirname, '..', '..', 'routes', 'advanced-search.js'))) {
    it('routes/advanced-search.js applies CSRF protection to POST /validate', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'routes', 'advanced-search.js'),
        'utf8'
      );
      expect(src).toContain('applyCsrfProtection');
      // Should appear in the POST validate route handler (may be inline or multi-line)
      expect(src).toMatch(/router\.post\([\s\S]*?['"]\/validate['"][\s\S]*?applyCsrfProtection/);
    });
  }

  // ── messenger.service.js markUnread support ─────────────────────────────────

  if (fs.existsSync(path.resolve(__dirname, '..', '..', 'services', 'messenger.service.js'))) {
    it('messenger.service.js handles markUnread by setting unreadCount=1 and resetting lastReadAt', () => {
      const svc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'services', 'messenger.service.js'),
        'utf8'
      );
      expect(svc).toContain('updates.markUnread');
      expect(svc).toContain('participants.$[participant].unreadCount');
      expect(svc).toContain('participants.$[participant].lastReadAt');
    });
  }

  // ── routes/messenger.js: ObjectId validation + markUnread passthrough ────────

  if (fs.existsSync(path.resolve(__dirname, '..', '..', 'routes', 'messenger.js'))) {
    it('routes/messenger.js has isValidObjectId helper', () => {
      const routeSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'routes', 'messenger.js'),
        'utf8'
      );
      expect(routeSrc).toContain('function isValidObjectId');
      expect(routeSrc).toContain('/^[a-fA-F0-9]{24}$/');
    });

    it('routes/messenger.js validates conversation ID in GET /conversations/:id', () => {
      const routeSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'routes', 'messenger.js'),
        'utf8'
      );
      expect(routeSrc).toContain('isValidObjectId(id)');
      expect(routeSrc).toContain('Invalid conversation ID');
    });

    it('routes/messenger.js passes markUnread from body to updateConversation', () => {
      const routeSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'routes', 'messenger.js'),
        'utf8'
      );
      expect(routeSrc).toContain('markUnread');
      expect(routeSrc).toContain('updates.markUnread = markUnread');
    });
  }

  // ── ChatInboxWidget: currentUserId resolved from cookie/API ─────────────────

  if (
    fs.existsSync(path.resolve(__dirname, '..', '..', 'public', 'chat', 'js', 'ChatInboxWidget.js'))
  ) {
    it('ChatInboxWidget._loadCurrentUser resolves user from cookie then API', () => {
      const widgetSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'public', 'chat', 'js', 'ChatInboxWidget.js'),
        'utf8'
      );
      expect(widgetSrc).toContain('_loadCurrentUser');
      expect(widgetSrc).toContain('_getCookie');
      expect(widgetSrc).toContain('/api/v1/auth/me');
      expect(widgetSrc).toContain('this.currentUserId');
    });

    it('ChatInboxWidget.getOtherParticipant uses currentUserId to find the other party', () => {
      const widgetSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'public', 'chat', 'js', 'ChatInboxWidget.js'),
        'utf8'
      );
      // Should filter participants by userId !== currentUserId
      expect(widgetSrc).toContain('p.userId !== this.currentUserId');
      // Should no longer have the TODO comment
      expect(widgetSrc).not.toContain('TODO: Get current user ID from cookie/session');
    });

    it('ChatInboxWidget.getUnreadCount uses currentUserId to find own participant', () => {
      const widgetSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'public', 'chat', 'js', 'ChatInboxWidget.js'),
        'utf8'
      );
      expect(widgetSrc).toContain('p.userId === this.currentUserId');
      expect(widgetSrc).not.toContain('TODO: Get current user ID');
    });
  }
});
