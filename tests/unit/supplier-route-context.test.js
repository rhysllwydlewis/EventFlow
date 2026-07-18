'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/supplier-route-context.js'),
  'utf8'
);

function createWindow(
  metaContent,
  url = 'https://event-flow.co.uk/supplier/example--0123456789abcdef'
) {
  const parsedUrl = new URL(url);
  const meta =
    metaContent === '' || metaContent === null || metaContent === undefined
      ? null
      : {
          getAttribute(name) {
            return name === 'content' ? metaContent : null;
          },
        };
  const window = {
    location: { search: parsedUrl.search },
    URLSearchParams,
  };
  const document = {
    querySelector(selector) {
      return selector === 'meta[name="ef-public-supplier-id"]' ? meta : null;
    },
  };

  vm.runInNewContext(source, { document, URLSearchParams, window });
  return window;
}

describe('supplier clean URL context', () => {
  test('supplies the server-rendered supplier ID to existing URLSearchParams consumers', () => {
    const window = createWindow('supplier-123');

    expect(new window.URLSearchParams(window.location.search).get('id')).toBe('supplier-123');
    expect(window.__EF_PUBLIC_SUPPLIER_ID__).toBe('supplier-123');
  });

  test('does not overwrite an explicit legacy query-string ID', () => {
    const window = createWindow(
      'supplier-123',
      'https://event-flow.co.uk/supplier/example--0123456789abcdef?id=legacy-id'
    );

    expect(new window.URLSearchParams(window.location.search).get('id')).toBe('legacy-id');
  });

  test('does not inject the supplier ID into unrelated parameter collections', () => {
    const window = createWindow('supplier-123');

    expect(new window.URLSearchParams('q=photography').get('id')).toBeNull();
    expect(new window.URLSearchParams('q=photography').get('q')).toBe('photography');
  });

  test('does nothing when the server context is absent or invalid', () => {
    const missing = createWindow('');
    const invalid = createWindow('<bad>');

    expect(new missing.URLSearchParams(missing.location.search).get('id')).toBeNull();
    expect(new invalid.URLSearchParams(invalid.location.search).get('id')).toBeNull();
    expect(missing.__EF_PUBLIC_SUPPLIER_ID__).toBeUndefined();
    expect(invalid.__EF_PUBLIC_SUPPLIER_ID__).toBeUndefined();
  });
});
