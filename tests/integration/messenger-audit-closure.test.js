/**
 * Static audit tests for Messenger v4 production-grade completion work.
 *
 * These verify the code-level fixes made after PR #950 for the post-merge
 * audit: client context normalization, delivered socket event plumbing,
 * delivered-batch drain, catch-up cap, observer cleanup, deployment infra,
 * and preflight REDIS_URL check.
 *
 * All assertions are file/source inspections (no live server/db), matching
 * the style of other `tests/integration/messenger-*-static.test.js` files.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Messenger v4 post-PR950 audit fixes', () => {
  // -------------------------------------------------------------------------
  // Client-side context/type normalization
  // -------------------------------------------------------------------------

  describe('MessengerAppV4 context/type normalization', () => {
    const src = read('public/messenger/js/MessengerAppV4.js');

    it('exposes a static _resolveTypeAndContext helper', () => {
      expect(src).toMatch(/_resolveTypeAndContext\s*\(/);
    });

    it('maps legacy "supplier" alias to canonical supplier_profile', () => {
      expect(src).toMatch(/supplier:\s*'supplier_profile'/);
    });

    it('maps "package" context to the enquiry conversation type', () => {
      expect(src).toMatch(/package:\s*'enquiry'/);
    });

    it('maps "marketplace_listing" context to the marketplace conversation type', () => {
      expect(src).toMatch(/marketplace_listing:\s*'marketplace'/);
    });

    it('handleDeepLink builds a canonical context with referenceId / referenceTitle', () => {
      expect(src).toContain('referenceId: contextId || null');
      expect(src).toContain('referenceTitle: contextTitle || null');
      // Sanity: no more `{ type, id, title }` legacy object anywhere in the
      // handleDeepLink handler.  Scope the check to the handler body by
      // slicing from its signature to the next top-level method definition
      // so the test stays accurate even if the handler grows.
      const sigIdx = src.indexOf('handleDeepLink()');
      expect(sigIdx).toBeGreaterThan(-1);
      // Next method = next line that looks like `  name(` or `  async name(`
      // at method-indent (two spaces).  Fall back to end-of-file.
      const remainder = src.slice(sigIdx + 'handleDeepLink()'.length);
      const nextMethodMatch = remainder.match(/\n\s{2}(?:async\s+)?[_a-zA-Z][\w]*\s*\(/);
      const handlerBody = nextMethodMatch ? remainder.slice(0, nextMethodMatch.index) : remainder;
      expect(handlerBody).not.toMatch(/\{\s*type:\s*contextType,\s*id:/);
    });
  });

  describe('MessengerAppV4 reconciliation & receipts', () => {
    const src = read('public/messenger/js/MessengerAppV4.js');

    it('catch-up loop iterates up to MAX_CATCHUP_PAGES (not a hard-coded 20)', () => {
      expect(src).toContain('MAX_CATCHUP_PAGES');
      expect(src).not.toMatch(/for\s*\(let i = 0; i < 20; i\+\+\)/);
    });

    it('_flushDelivered drains each queue past the 50-id batch cap', () => {
      expect(src).toMatch(/while\s*\(idsSet\.size\s*>\s*0\)/);
    });

    it('tracks and disconnects the read MutationObserver in destroy()', () => {
      expect(src).toContain('_readMutationObserver');
      expect(src).toMatch(/_readMutationObserver\?\.disconnect\?\.\(\)/);
    });

    it('handles the messenger:v4:message-delivered socket event', () => {
      expect(src).toContain("'messenger:message-delivered'");
      expect(src).toContain('deliveredTo');
    });
  });

  // -------------------------------------------------------------------------
  // Socket client plumbing
  // -------------------------------------------------------------------------

  describe('MessengerSocket forwards delivery receipts', () => {
    const src = read('public/messenger/js/MessengerSocket.js');

    it('binds the messenger:v4:message-delivered event', () => {
      expect(src).toContain("'messenger:v4:message-delivered'");
    });

    it('re-dispatches it as a DOM CustomEvent for the app orchestrator', () => {
      expect(src).toContain("'messenger:message-delivered'");
    });
  });

  // -------------------------------------------------------------------------
  // Context banner understands canonical types
  // -------------------------------------------------------------------------

  describe('ContextBannerV4 canonical type support', () => {
    const src = read('public/messenger/js/ContextBannerV4.js');

    it('maps canonical context types (supplier_profile, marketplace_listing, find_a_supplier)', () => {
      expect(src).toContain('supplier_profile:');
      expect(src).toContain('marketplace_listing:');
      expect(src).toContain('find_a_supplier:');
    });

    it('reads referenceTitle from the context (falls back to legacy title)', () => {
      expect(src).toContain('referenceTitle');
    });

    it('derives "View" URL from referenceId for each canonical type', () => {
      // _deriveUrl should build relative paths for all four canonical types
      expect(src).toContain('_deriveUrl(');
      expect(src).toContain('/packages/${id}');
      expect(src).toContain('/suppliers/${id}');
      expect(src).toContain('/marketplace/${id}');
    });

    it('_safeUrl does NOT call this.escape() (would corrupt query strings)', () => {
      // The returned value is assigned to element.href (DOM property), not
      // interpolated into innerHTML, so HTML-encoding must not be applied.
      // Verify by checking the _safeUrl method doesn't call this.escape()
      // (it only trims + denies dangerous schemes).
      const safeFnStart = src.indexOf('_safeUrl(url)');
      expect(safeFnStart).toBeGreaterThan(-1);
      // Find the function body up to the next method definition or closing brace
      const afterFn = src.slice(safeFnStart);
      const methodEnd = afterFn.indexOf('\n  _deriveUrl(');
      const body = methodEnd > -1 ? afterFn.slice(0, methodEnd) : afterFn.slice(0, 300);
      expect(body).not.toContain('this.escape(');
    });
  });

  // -------------------------------------------------------------------------
  // QuickComposeV4 uses referenceTitle (not legacy title)
  // -------------------------------------------------------------------------

  describe('QuickComposeV4 canonical context fields', () => {
    const src = read('public/messenger/js/QuickComposeV4.js');

    it('uses referenceTitle (not title) on the context payload', () => {
      expect(src).toContain('context.referenceTitle = opts.contextTitle');
      expect(src).not.toMatch(/context\.title\s*=\s*opts\.contextTitle/);
    });
  });

  // -------------------------------------------------------------------------
  // Admin search query covers canonical field
  // -------------------------------------------------------------------------

  describe('Admin conversation search', () => {
    const src = read('routes/messenger-v4.js');

    it('query matches canonical context.referenceTitle', () => {
      expect(src).toContain("'context.referenceTitle'");
    });
  });

  // -------------------------------------------------------------------------
  // Supplier entry-point fallbacks use canonical context type
  // -------------------------------------------------------------------------

  describe('Supplier entry-points use supplier_profile (not "supplier")', () => {
    it('supplier-profile.js fallback URL uses supplier_profile', () => {
      const src = read('public/assets/js/supplier-profile.js');
      expect(src).not.toMatch(/contextType:\s*'supplier'\s*,/);
    });

    it('supplier-comparison.js uses supplier_profile', () => {
      const src = read('public/assets/js/components/supplier-comparison.js');
      expect(src).not.toMatch(/contextType:\s*'supplier'\s*,/);
    });
  });

  // -------------------------------------------------------------------------
  // Deployment and infra
  // -------------------------------------------------------------------------

  describe('Deployment & infra', () => {
    it('docker-compose defines a Redis service', () => {
      const src = read('docker-compose.yml');
      expect(src).toMatch(/redis:\s*\n\s*image:\s*redis/);
      expect(src).toContain('REDIS_URL: redis://redis:6379');
    });

    it('docker-compose defines the messenger queue worker', () => {
      const src = read('docker-compose.yml');
      expect(src).toContain('node scripts/worker.js');
    });

    it('Railway worker deployment template exists', () => {
      expect(fs.existsSync(path.join(ROOT, 'railway.worker.json'))).toBe(true);
      const src = read('railway.worker.json');
      expect(src).toContain('scripts/worker.js');
    });

    it('Procfile declares both web and worker processes', () => {
      const src = read('Procfile');
      expect(src).toMatch(/^web:/m);
      expect(src).toMatch(/^worker:.*scripts\/worker\.js/m);
    });

    it('preflight hard-fails in production when REDIS_URL is missing', () => {
      const src = read('scripts/preflight.mjs');
      expect(src).toContain('REDIS_URL');
      expect(src).toContain('REQUIRED_IN_PRODUCTION_SUBSYSTEMS');
    });

    it('server.js integration summary marks Redis as required in production', () => {
      const src = read('server.js');
      expect(src).toContain(
        "required: process.env.NODE_ENV === 'production' ? 'required' : 'optional'"
      );
    });
  });
});
