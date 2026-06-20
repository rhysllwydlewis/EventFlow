'use strict';

const fs = require('fs');
const path = require('path');

describe('Messenger selection and supplier profile hardening', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('loads selection hardening after MessengerAppV4 and before bootstrap', () => {
    const html = read('public/messenger/index.html');
    expect(html).toContain('/messenger/js/MessengerAppV4.js?v=1.0.1');
    expect(html).toContain('/messenger/js/MessengerSelectionProfileHardening.js?v=1.0.0');
    expect(html.indexOf('MessengerAppV4.js?v=1.0.1')).toBeLessThan(
      html.indexOf('MessengerSelectionProfileHardening.js?v=1.0.0')
    );
    expect(html.indexOf('MessengerSelectionProfileHardening.js?v=1.0.0')).toBeLessThan(
      html.indexOf('new-conversation-bootstrap.js')
    );
  });

  it('uses public supplier profile search for the generic new-message picker', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('fetch(`/api/suppliers');
    expect(js).toContain('normalizeSupplierProfile');
    expect(js).toContain('supplierProfileId');
    expect(js).toContain("type: 'supplier_profile'");
  });

  it('forces conversation selection to reload stale or blank active panes', () => {
    const js = read('public/messenger/js/MessengerSelectionProfileHardening.js');
    expect(js).toContain('hardenedSelectConversation');
    expect(js).toContain('!chatReady || options.force');
    expect(js).toContain('app._activeConversationId = null');
    expect(js).toContain('updateUrlConversation(conversationId)');
    expect(js).toContain('patchMessengerAppInstance');
  });

  it('makes supplier header links use supplier profile ids rather than user ids', () => {
    const js = read('public/messenger/js/MessengerSelectionProfileHardening.js');
    expect(js).toContain('safeSupplierProfileId');
    expect(js).toContain("conversation?.context?.type === 'supplier_profile'");
    expect(js).toContain('lookupSupplierProfileIdForParticipant');
    expect(js).toContain('/supplier?id=');
    expect(js).toContain('View supplier profile');
  });
});
