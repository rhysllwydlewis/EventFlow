'use strict';
(function () {
  const context = document.querySelector('meta[name="ef-public-supplier-id"]');
  const supplierId = String(context?.getAttribute('content') || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(supplierId)) {
    return;
  }

  const NativeURLSearchParams = window.URLSearchParams;
  const currentSearch = String(window.location.search || '');

  window.__EF_PUBLIC_SUPPLIER_ID__ = supplierId;
  window.EventFlowSupplierRoute = Object.freeze({
    supplierId,
    isCanonicalProfile: true,
    getSupplierId() {
      return supplierId;
    },
    getSearchParams() {
      return new NativeURLSearchParams(currentSearch);
    },
  });

  // Temporary boot compatibility for older supplier-page modules that still read
  // `id` from location.search. The replacement is removed immediately after the
  // DOMContentLoaded listeners have run, so unrelated code keeps the native API.
  if (
    typeof NativeURLSearchParams !== 'function' ||
    new NativeURLSearchParams(currentSearch).has('id') ||
    window.__EF_SUPPLIER_URL_SEARCH_PARAMS_PATCHED__ === true
  ) {
    return;
  }

  class SupplierAwareURLSearchParams extends NativeURLSearchParams {
    constructor(init) {
      super(init);
      this.__efUsesSupplierLocationSearch =
        typeof init === 'string' && String(init) === currentSearch;
    }

    get(name) {
      if (name === 'id' && this.__efUsesSupplierLocationSearch) {
        return supplierId;
      }
      return super.get(name);
    }
  }

  const restoreNativeSearchParams = () => {
    if (window.URLSearchParams === SupplierAwareURLSearchParams) {
      window.URLSearchParams = NativeURLSearchParams;
    }
    window.__EF_SUPPLIER_URL_SEARCH_PARAMS_PATCHED__ = false;
  };
  const scheduleRestore =
    typeof window.setTimeout === 'function'
      ? window.setTimeout.bind(window)
      : typeof setTimeout === 'function'
        ? setTimeout
        : null;

  window.URLSearchParams = SupplierAwareURLSearchParams;
  window.__EF_SUPPLIER_URL_SEARCH_PARAMS_PATCHED__ = true;

  if (!scheduleRestore) {
    return;
  }

  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        scheduleRestore(restoreNativeSearchParams, 0);
      },
      { once: true }
    );
  } else {
    scheduleRestore(restoreNativeSearchParams, 0);
  }
})();
