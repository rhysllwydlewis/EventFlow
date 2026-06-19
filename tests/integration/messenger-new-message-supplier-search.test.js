'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Messenger v4 new-message supplier search rules', () => {
  const contactPickerSrc = read('public/messenger/js/ContactPickerV4.js');
  const apiSrc = read('public/messenger/js/MessengerAPI.js');
  const appSrc = read('public/messenger/js/MessengerAppV4.js');
  const routeSrc = read('routes/messenger-v4.js');
  const serviceSrc = read('services/messenger-v4.service.js');
  const polishCss = read('public/messenger/css/messenger-v4-polish.css');

  it('generic contact picker sends supplier-only search intent', () => {
    expect(contactPickerSrc).toContain("{ role: 'supplier', mode: 'supplier_search' }");
    expect(apiSrc).toContain("params.append('mode', options.mode)");
  });

  it('generic picker copy explains supplier search and recent conversations', () => {
    expect(contactPickerSrc).toContain('Search suppliers by business name...');
    expect(contactPickerSrc).toContain(
      'Search suppliers to start a new message. Recent conversations show people you have already spoken to.'
    );
    expect(contactPickerSrc).toContain('People you have already spoken to will appear here.');
  });

  it('recent contacts are derived from loaded direct conversations, not localStorage', () => {
    expect(contactPickerSrc).toContain('_getRecentConversationContacts');
    expect(contactPickerSrc).toContain('appState?.conversations');
    expect(contactPickerSrc).toContain('data-conversation-id');
    expect(contactPickerSrc).not.toContain('messenger_v4_recent_contacts');
  });

  it('selecting a recent conversation opens the existing thread', () => {
    expect(contactPickerSrc).toContain("new CustomEvent('messenger:conversation-selected'");
    expect(contactPickerSrc).toContain('detail: { id: conversationId }');
  });

  it('supplier search rows prefer backend-provided business labels and supplier detail', () => {
    expect(serviceSrc).toContain('primaryLabel');
    expect(serviceSrc).toContain('secondaryLabel');
    expect(serviceSrc).toContain("'info'");
    expect(serviceSrc).toContain('businessName');
    expect(contactPickerSrc).toContain('user.primaryLabel');
  });

  it('backend contacts endpoint enforces supplier_search as supplier-only', () => {
    expect(routeSrc).toContain("mode === 'supplier_search'");
    expect(routeSrc).toContain("const requestedRole = supplierOnlyMode ? 'supplier' : role");
    expect(serviceSrc).toContain("filters.mode === 'supplier_search'");
    expect(serviceSrc).toContain("searchQuery.role = 'supplier'");
    expect(serviceSrc).toContain('id: { $ne: currentUserId }');
  });

  it('generic widget conversation creation carries source metadata and blocks cold customer messages', () => {
    expect(contactPickerSrc).toContain("source: 'generic_new_message'");
    expect(appSrc).toContain('metadata: options.metadata || {}');
    expect(routeSrc).toContain("metadata?.source === 'generic_new_message'");
    expect(routeSrc).toContain('existingDirectConversation');
    expect(routeSrc).toContain('GENERIC_CUSTOMER_COLD_MESSAGE_BLOCKED');
  });

  it('contact rows render safe existing profile photos when avatar data is available', () => {
    expect(contactPickerSrc).toContain('messenger-v4__avatar-image');
    expect(contactPickerSrc).toContain('_safeImageUrl');
    expect(contactPickerSrc).toContain('loading="lazy"');
    expect(serviceSrc).toContain('avatarUrl: 1');
    expect(serviceSrc).toContain('profilePhoto: 1');
  });

  it('close button has square flex-centred hit area with hover and focus states', () => {
    expect(polishCss).toContain('.messenger-v4__new-message-close.ef-cta');
    expect(polishCss).toContain('display: flex !important');
    expect(polishCss).toContain('align-items: center !important');
    expect(polishCss).toContain('justify-content: center !important');
    expect(polishCss).toContain('width: 40px');
    expect(polishCss).toContain('.messenger-v4__new-message-close.ef-cta:hover');
    expect(polishCss).toContain('.messenger-v4__new-message-close.ef-cta:focus-visible');
  });
});
