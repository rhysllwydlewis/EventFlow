(function () {
  'use strict';

  const context = document.querySelector('meta[name="ef-public-supplier-id"]');
  const supplierId = String(context?.getAttribute('content') || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(supplierId)) {
    return;
  }

  window.__EF_PUBLIC_SUPPLIER_ID__ = supplierId;

  const NativeURLSearchParams = window.URLSearchParams;
  if (
    typeof NativeURLSearchParams !== 'function' ||
    window.__EF_SUPPLIER_URL_SEARCH_PARAMS_PATCHED__ === true
  ) {
    return;
  }

  const currentSearch = String(window.location.search || '');

  class SupplierAwareURLSearchParams extends NativeURLSearchParams {
    constructor(init) {
      super(init);
      this.__efUsesSupplierLocationSearch =
        typeof init === 'string' && String(init) === currentSearch;
    }

    get(name) {
      const value = super.get(name);
      if (value === null && name === 'id' && this.__efUsesSupplierLocationSearch) {
        return supplierId;
      }
      return value;
    }
  }

  window.URLSearchParams = SupplierAwareURLSearchParams;
  window.__EF_SUPPLIER_URL_SEARCH_PARAMS_PATCHED__ = true;
})();
