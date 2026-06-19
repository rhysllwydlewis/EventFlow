'use strict';

const fs = require('fs');
const path = require('path');

describe('Messenger contact picker supplier safeguards', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('loads the contact picker safeguard assets after the base picker', () => {
    const html = read('public/messenger/index.html');
    expect(html).toContain('/messenger/css/new-message-widget-safeguards.css?v=1.0.0');
    expect(html).toContain('/messenger/js/ContactPickerV4.js?v=1.0.1');
    expect(html).toContain('/messenger/js/ContactPickerV4Safeguards.js?v=1.0.0');
    expect(html.indexOf('ContactPickerV4.js?v=1.0.1')).toBeLessThan(
      html.indexOf('ContactPickerV4Safeguards.js?v=1.0.0')
    );
    expect(html.indexOf('ContactPickerV4Safeguards.js?v=1.0.0')).toBeLessThan(
      html.indexOf('MessengerAppV4.js')
    );
  });

  it('forces generic contact searches into supplier mode', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('role: SUPPLIER_ROLE');
    expect(js).toContain("mode: options.mode || 'supplier_search'");
    expect(js).toContain("roleOf(contact) === SUPPLIER_ROLE");
  });

  it('blocks cold non-supplier starts while keeping existing conversations available', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('Customers can only be opened here from an existing conversation');
    expect(js).toContain('const existing = participantId ? await this._findExistingConversation(participantId) : null');
    expect(js).toContain('if (!existing && !isSupplier(contact))');
  });

  it('supports profile images and stable initial placeholders', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('publicProfileAvatarUrl');
    expect(js).toContain('profilePhotoUrl');
    expect(js).toContain('messenger-v4__avatar-image');
    expect(js).toContain('messenger-v4__avatar-initials');
  });
});
