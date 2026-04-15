/**
 * Tests that skeleton.css is loaded on all pages that use skeleton loader
 * and error-state CSS classes introduced in Phase 2.
 *
 * supplier.html uses:
 *   - .skeleton-supplier-card-full, .skeleton-supplier-header, .skeleton-avatar-large
 *     (inline HTML + supplier-profile.js showLoadingState)
 *   - .error-state, .error-state-icon, .error-state-title,
 *     .error-state-description, .error-state-action
 *     (supplier-profile.js loadSupplierData error path)
 *
 * suppliers.html uses:
 *   - .skeleton-supplier-card-full (inline HTML + suppliers-init.js createSkeletonCards)
 *   - .error-state, .error-state-description, .error-state-action
 *     (suppliers-init.js renderResults error path)
 *
 * All of these classes are defined in skeleton.css.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../../public');

const PAGES_NEEDING_SKELETON_CSS = ['supplier.html', 'suppliers.html'];

describe('skeleton.css loading on pages with skeleton/error-state markup', () => {
  PAGES_NEEDING_SKELETON_CSS.forEach(page => {
    describe(page, () => {
      let content;

      beforeAll(() => {
        content = fs.readFileSync(path.join(publicDir, page), 'utf8');
      });

      it('loads skeleton.css for skeleton loader and error-state styles', () => {
        expect(content).toContain('skeleton.css');
      });
    });
  });
});

describe('suppliers-init.js trust badge logic', () => {
  let suppliersInitContent;

  beforeAll(() => {
    suppliersInitContent = fs.readFileSync(
      path.join(publicDir, 'assets/js/pages/suppliers-init.js'),
      'utf8'
    );
  });

  it('renders founding badge when isFounding/founding/badges array is set', () => {
    expect(suppliersInitContent).toContain('supplier.isFounding');
    expect(suppliersInitContent).toContain('supplier.founding');
    expect(suppliersInitContent).toContain("supplier.badges.includes('founding')");
    expect(suppliersInitContent).toContain('badge-founding');
  });

  it('renders founding badge with foundingYear when present', () => {
    expect(suppliersInitContent).toContain('supplier.foundingYear');
  });

  it('renders verified badge for both verified and approved suppliers', () => {
    expect(suppliersInitContent).toContain('supplier.verified || supplier.approved');
    expect(suppliersInitContent).toContain('badge-verified');
  });

  it('renders email verification badge', () => {
    expect(suppliersInitContent).toContain('badge-email-verified');
    expect(suppliersInitContent).toContain('supplier.verifications.email');
  });

  it('renders phone verification badge', () => {
    expect(suppliersInitContent).toContain('badge-phone-verified');
    expect(suppliersInitContent).toContain('supplier.verifications.phone');
  });

  it('renders business verification badge', () => {
    expect(suppliersInitContent).toContain('badge-business-verified');
    expect(suppliersInitContent).toContain('supplier.verifications.business');
  });

  it('renders error-state with retry button on load failure', () => {
    expect(suppliersInitContent).toContain('error-state');
    expect(suppliersInitContent).toContain('error-state-action');
    expect(suppliersInitContent).toContain('retry-suppliers-btn');
  });

  it('escapes priceDisplay in card HTML to prevent XSS', () => {
    expect(suppliersInitContent).toContain('escapeHtml(priceDisplay)');
  });
});

describe('supplier-profile.js skeleton and error-state usage', () => {
  let supplierProfileContent;

  beforeAll(() => {
    supplierProfileContent = fs.readFileSync(
      path.join(publicDir, 'assets/js/supplier-profile.js'),
      'utf8'
    );
  });

  it('shows skeleton list items in showLoadingState', () => {
    expect(supplierProfileContent).toContain('skeleton-list-item');
  });

  it('clears aria-hidden in showLoadingState', () => {
    expect(supplierProfileContent).toContain("container.setAttribute('aria-hidden', 'true')");
  });

  it('removes aria-hidden when reviews render', () => {
    expect(supplierProfileContent).toContain("container.removeAttribute('aria-hidden')");
  });

  it('renders error-state with retry button on supplier load failure', () => {
    expect(supplierProfileContent).toContain('error-state-action');
    expect(supplierProfileContent).toContain('retry-supplier-btn');
  });

  it('uses map index instead of indexOf in renderReviews', () => {
    expect(supplierProfileContent).toContain('.map((review, index) =>');
    expect(supplierProfileContent).not.toContain('reviews.indexOf(review)');
  });

  it('provides a fallback error message when errorMessage is falsy', () => {
    expect(supplierProfileContent).toContain("errorMessage || 'An unexpected error occurred.'");
  });
});

describe('reviews.js badge base class — regression guard', () => {
  // Regression: all badge <span> elements in renderReviewCard() must carry the
  // base `.badge` class alongside their modifier. Without it, all structural
  // styles (padding, border-radius, display: inline-flex, etc.) are absent and
  // the badges render as unstyled inline text.
  let reviewsJsContent;

  beforeAll(() => {
    reviewsJsContent = fs.readFileSync(path.join(publicDir, 'assets/js/reviews.js'), 'utf8');
  });

  it('renders Verified Customer badge with both badge and badge-verified classes', () => {
    expect(reviewsJsContent).toContain('"badge badge-verified"');
    // Regression guard: modifier class must not appear without the base class
    expect(reviewsJsContent).not.toContain('"badge-verified"');
  });

  it('renders Email Verified badge with both badge and badge-email-verified classes', () => {
    expect(reviewsJsContent).toContain('"badge badge-email-verified"');
    // Regression guard: modifier class must not appear without the base class
    expect(reviewsJsContent).not.toContain('"badge-email-verified"');
  });

  it('renders Verified Supplier badge with both badge and badge-supplier classes', () => {
    expect(reviewsJsContent).toContain('"badge badge-supplier"');
    // Regression guard: modifier class must not appear without the base class
    expect(reviewsJsContent).not.toContain('"badge-supplier"');
  });

  it('renders Verified Supplier badge with the correct label text', () => {
    expect(reviewsJsContent).toContain('Verified Supplier');
  });
});

describe('reviews.css completeness', () => {
  let reviewsCssContent;

  beforeAll(() => {
    reviewsCssContent = fs.readFileSync(path.join(publicDir, 'assets/css/reviews.css'), 'utf8');
  });

  it('defines .reviews-error style for the review error state', () => {
    expect(reviewsCssContent).toContain('.reviews-error');
  });

  it('defines .reviews-empty style for the empty reviews state', () => {
    expect(reviewsCssContent).toContain('.reviews-empty');
  });
});
