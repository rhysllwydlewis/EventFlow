'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const pickerSrc = fs.readFileSync(
  path.join(root, 'public/messenger/js/ContactPickerV4.js'),
  'utf8'
);
const appSrc = fs.readFileSync(path.join(root, 'public/messenger/js/MessengerAppV4.js'), 'utf8');
const listSrc = fs.readFileSync(
  path.join(root, 'public/messenger/js/ConversationListV4.js'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(root, 'public/messenger/css/messenger-v4-polish.css'),
  'utf8'
);

describe('Messenger v4 new message liquid-glass picker', () => {
  it('renders an accessible liquid-glass dialog that opens visibly and autofocuses search', () => {
    expect(pickerSrc).toContain('messenger-v4__new-message-popout');
    expect(pickerSrc).toContain('role="dialog"');
    expect(pickerSrc).toContain('aria-modal="true"');
    expect(pickerSrc).toContain('aria-labelledby="v4ContactPickerTitle"');
    expect(pickerSrc).toContain('aria-describedby="v4ContactPickerDescription"');
    expect(pickerSrc).toContain('this.modalEl.hidden = false');
    expect(pickerSrc).toContain('messenger-v4__new-message-popout--open');
    expect(pickerSrc).toContain('requestAnimationFrame(() => this.searchInput.focus())');
    expect(css).toMatch(/\.messenger-v4__new-message-popout\s*{[^}]*z-index:\s*30000;/s);
    expect(css).toMatch(/\.messenger-v4__new-message-popout--open\s*{[^}]*opacity:\s*1;/s);
  });

  it('closes with Escape, close button, outside click, and returns focus', () => {
    expect(pickerSrc).toContain("if (e.key === 'Escape')");
    expect(pickerSrc).toContain("querySelector('#v4ContactPickerClose')");
    expect(pickerSrc).toContain("querySelector('#v4ContactPickerOverlay')");
    expect(pickerSrc).toContain('this._returnFocusEl.focus()');
    expect(pickerSrc).toContain('this.modalEl.hidden = true');
  });

  it('keeps generic compose direct-only and does not expose package/marketplace context options', () => {
    expect(pickerSrc).toContain("const payload = { contact: user, context: 'direct' }");
    expect(pickerSrc).not.toContain('data-context="package"');
    expect(pickerSrc).not.toContain('data-context="marketplace_listing"');
    expect(appSrc).toContain("this.createConversation([contact._id || contact.id], 'direct'");
  });

  it('supports search, loading, empty, error, recent contacts, keyboard selection, and double-click prevention', () => {
    expect(pickerSrc).toContain('setTimeout(() => this.search(q), 300)');
    expect(pickerSrc).toContain('messenger-v4__skeleton--long');
    expect(pickerSrc).toContain('No contacts found for');
    expect(pickerSrc).toContain('We could not search contacts right now');
    expect(pickerSrc).toContain('Recent contacts');
    expect(pickerSrc).toContain("e.key === 'Enter' || e.key === ' '");
    expect(pickerSrc).toContain('if (this._isSelecting)');
    expect(pickerSrc).toContain('messenger-v4__new-message-contact--pending');
  });

  it('reuses existing conversations and keeps the widget open on creation failures', () => {
    expect(pickerSrc).toContain('_findExistingConversation(participantId)');
    expect(pickerSrc).toContain('_isDirectConversationWithParticipant(c, participantId)');
    expect(pickerSrc).toContain("conversation.type !== 'direct'");
    expect(pickerSrc).toContain('messenger:conversation-selected');
    expect(pickerSrc).toContain('await this.options.onSelect(payload)');
    expect(pickerSrc).toContain('this._showError(this._friendlyError(err))');
    expect(appSrc).toContain('throwOnError: true');
    expect(appSrc).toContain('if (options.throwOnError)');
  });

  it('keeps clean event wiring through one open event', () => {
    expect(listSrc).toContain('messenger:open-contact-picker');
    expect(appSrc).toContain("window.addEventListener('messenger:open-contact-picker'");
    expect(appSrc).toContain('this.contactPicker.open()');
  });

  it('adds desktop popout, mobile bottom-sheet, focus, reduced-motion, and glass styling', () => {
    expect(css).toContain('backdrop-filter: blur(24px) saturate(1.25)');
    expect(css).toMatch(/box-shadow:\s*0 28px 80px/);
    expect(css).toMatch(/@media \(max-width:\s*720px\)/);
    expect(css).toMatch(/align-items:\s*flex-end;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/\.messenger-v4__new-message-search:focus-within/);
  });
});
