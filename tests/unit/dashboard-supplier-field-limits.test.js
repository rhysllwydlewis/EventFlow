/**
 * The dashboard form's maxlength attributes must match the limits the
 * supplier create/PATCH routes enforce, so a value the form accepts is never
 * rejected or silently shortened server-side.
 */
const fs = require('fs');
const path = require('path');

const { PATCH_FIELD_MAX_LENGTHS } = require('../../routes/supplier-management');

const html = fs.readFileSync(path.join(__dirname, '../../public/dashboard-supplier.html'), 'utf8');

const maxlengthFor = id => {
  const tag = html.match(new RegExp(`<(?:input|textarea)[^>]*\\bid="${id}"[^>]*>`, 'i'));
  expect(tag).not.toBeNull();
  const m = tag[0].match(/maxlength="(\d+)"/i);
  return m ? Number(m[1]) : null;
};

describe('dashboard supplier form field limits', () => {
  const fields = {
    'sup-name': 'name',
    'sup-location': 'location',
    'sup-website': 'website',
    'sup-license': 'license',
    'sup-short': 'description_short',
    'sup-long': 'description_long',
  };

  test.each(Object.entries(fields))('#%s maxlength matches server limit for %s', (id, key) => {
    expect(maxlengthFor(id)).toBe(PATCH_FIELD_MAX_LENGTHS[key]);
  });
});
