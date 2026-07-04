'use strict';

const fs = require('fs');
const path = require('path');

describe('Messenger contact picker supplier safeguards', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('loads the contact picker safeguard assets after the base picker', () => {
    const html = read('public/messenger/index.html');
    expect(html).toContain('/messenger/css/new-message-widget-safeguards.css?v=1.0.0');
    expect(html).toContain('/messenger/js/ContactPickerV4.js?v=1.0.2');
    expect(html).toContain('/messenger/js/ContactPickerV4Safeguards.js?v=1.0.3');
    expect(html.indexOf('ContactPickerV4.js?v=1.0.2')).toBeLessThan(
      html.indexOf('ContactPickerV4Safeguards.js?v=1.0.3')
    );
    expect(html.indexOf('ContactPickerV4Safeguards.js?v=1.0.3')).toBeLessThan(
      html.indexOf('MessengerAppV4.js')
    );
  });

  it('uses public supplier profiles for generic contact picker searches', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toMatch(/fetch\(\s*`\/api\/suppliers/);
    expect(js).toContain('normalizeSupplierProfile');
    expect(js).toContain('roleOf(contact) === SUPPLIER_ROLE');
    expect(js).toContain('supplierProfileId');
  });

  it('keeps visible existing conversations available while preventing archived reuse', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('Customers can only be opened here from an existing conversation');
    expect(js).toContain('_findVisibleExistingConversation');
    expect(js).toContain('isConversationVisibleFor(conversation, currentUserId)');
    expect(js).toContain('!participant.isArchived && !participant.isDeleted');
    expect(js).toContain('if (existing)');
    expect(js).toContain('if (!isSupplier(contact))');
  });

  it('matches supplier-profile context conversations before creating new context threads', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('isContextMatch');
    expect(js).toContain("clean(conversation.context.type) === 'supplier_profile'");
    expect(js).toContain('clean(conversation.context.referenceId) === clean(supplierProfileId)');
  });

  it('filters archived/deleted conversations out of recent contact rows', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('getRecentConversationContacts');
    expect(js).toContain('isConversationVisibleFor(c, currentUserId)');
  });

  it('supports profile images and stable initial placeholders', () => {
    const js = read('public/messenger/js/ContactPickerV4Safeguards.js');
    expect(js).toContain('publicProfileAvatarUrl');
    expect(js).toContain('profilePhotoUrl');
    expect(js).toContain('messenger-v4__avatar-image');
    expect(js).toContain('messenger-v4__avatar-initials');
  });
});
