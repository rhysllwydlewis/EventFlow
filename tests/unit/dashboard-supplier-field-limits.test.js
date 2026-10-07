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

describe('dashboard website length check (app.js)', () => {
  // app.js is a browser script with no exports, so lift the validator out of
  // its source and run it against a stand-in input element.
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');
  const limit = Number(appJs.match(/const SUPPLIER_WEBSITE_MAX_LENGTH = (\d+);/)[1]);
  const fnSource = appJs.match(
    /function normalizeAndValidateWebsiteInput[\s\S]*?\n {2}\}\n(?=\n {2}const supForm)/
  )[0];
  // eslint-disable-next-line no-new-func
  const validate = new Function(
    'SUPPLIER_WEBSITE_MAX_LENGTH',
    'SUPPLIER_WEBSITE_INVALID_MESSAGE',
    'SUPPLIER_WEBSITE_TOO_LONG_MESSAGE',
    `${fnSource}; return normalizeAndValidateWebsiteInput;`
  )(limit, 'INVALID', 'TOO_LONG');
  const check = value => validate({ value });

  test('client limit matches the server limit', () => {
    expect(limit).toBe(PATCH_FIELD_MAX_LENGTHS.website);
  });

  test('accepts a scheme-less URL whose https:// form still fits', () => {
    const host = `example.com/${'a'.repeat(limit - 'https://example.com/'.length)}`;
    expect(host.length).toBeLessThan(limit);
    expect(check(host).ok).toBe(true);
  });

  test('rejects a scheme-less URL that only overflows once https:// is prepended', () => {
    const raw = `example.com/${'a'.repeat(limit - 'example.com/'.length)}`;
    expect(raw.length).toBe(limit);
    expect(check(raw)).toMatchObject({ ok: false, message: 'TOO_LONG' });
  });

  test('rejects an over-long URL that already has a scheme', () => {
    expect(check(`https://example.com/${'a'.repeat(limit)}`)).toMatchObject({
      ok: false,
      message: 'TOO_LONG',
    });
  });

  test('malformed input is not flagged as too long', () => {
    expect(check('not a url')).toMatchObject({ ok: false, message: 'INVALID' });
  });
});
