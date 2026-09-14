/**
 * Unit tests for supplier tier badge / icon rendering logic
 * Mirrors helpers in public/assets/js/utils/verification-badges.js and
 * public/assets/js/utils/tier-icon.js
 */

'use strict';

// --------------------------------------------------------------------------
// Helpers (extracted from verification-badges.js for testability)
// --------------------------------------------------------------------------

function resolveSupplierTier(supplier) {
  if (!supplier) {
    return 'free';
  }
  const tier =
    supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free');
  return tier === 'pro_plus' ? 'pro_plus' : tier === 'pro' ? 'pro' : 'free';
}

function renderTierIcon(supplier) {
  const tier = resolveSupplierTier(supplier);
  if (tier === 'pro_plus') {
    return `<span class="tier-icon tier-icon-pro-plus" title="Professional Plus subscriber" aria-label="Pro Plus">💎</span>`;
  }
  if (tier === 'pro') {
    return `<span class="tier-icon tier-icon-pro" title="Professional subscriber" aria-label="Pro">⭐</span>`;
  }
  return '';
}

function renderTierBadge(supplier, options = {}) {
  const tier = resolveSupplierTier(supplier);
  const styleAttr = options.style ? ` style="${options.style}"` : '';
  const labelSuffix = options.ariaLabelSuffix || '';
  if (tier === 'pro_plus') {
    return `<span class="badge badge-pro-plus"${styleAttr} aria-label="Pro Plus${labelSuffix}">Pro Plus</span>`;
  }
  if (tier === 'pro') {
    return `<span class="badge badge-pro"${styleAttr} aria-label="Pro${labelSuffix}">Pro</span>`;
  }
  return `<span class="badge badge-starter"${styleAttr} aria-label="Starter${labelSuffix}">Starter</span>`;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('resolveSupplierTier', () => {
  it('returns free for null', () => {
    expect(resolveSupplierTier(null)).toBe('free');
  });

  it('returns free for empty supplier', () => {
    expect(resolveSupplierTier({})).toBe('free');
  });

  it('returns pro from subscriptionTier field', () => {
    expect(resolveSupplierTier({ subscriptionTier: 'pro' })).toBe('pro');
  });

  it('returns pro_plus from subscriptionTier field', () => {
    expect(resolveSupplierTier({ subscriptionTier: 'pro_plus' })).toBe('pro_plus');
  });

  it('returns pro from subscription.tier (nested)', () => {
    expect(resolveSupplierTier({ subscription: { tier: 'pro' } })).toBe('pro');
  });

  it('returns pro_plus from subscription.tier (nested)', () => {
    expect(resolveSupplierTier({ subscription: { tier: 'pro_plus' } })).toBe('pro_plus');
  });

  it('returns pro from isPro legacy boolean', () => {
    expect(resolveSupplierTier({ isPro: true })).toBe('pro');
  });

  it('returns free when isPro is false', () => {
    expect(resolveSupplierTier({ isPro: false })).toBe('free');
  });

  it('prefers subscriptionTier over isPro', () => {
    expect(resolveSupplierTier({ subscriptionTier: 'pro_plus', isPro: true })).toBe('pro_plus');
  });

  it('returns free for unknown tier strings', () => {
    expect(resolveSupplierTier({ subscriptionTier: 'enterprise' })).toBe('free');
    expect(resolveSupplierTier({ subscriptionTier: 'basic' })).toBe('free');
  });
});

describe('renderTierIcon', () => {
  it('returns empty string for free tier supplier', () => {
    expect(renderTierIcon({ subscriptionTier: 'free' })).toBe('');
    expect(renderTierIcon(null)).toBe('');
    expect(renderTierIcon({})).toBe('');
  });

  it('returns gold star icon for pro tier', () => {
    const icon = renderTierIcon({ subscriptionTier: 'pro' });
    expect(icon).toContain('tier-icon-pro');
    expect(icon).toContain('⭐');
    expect(icon).not.toContain('tier-icon-pro-plus');
  });

  it('returns diamond icon for pro_plus tier', () => {
    const icon = renderTierIcon({ subscriptionTier: 'pro_plus' });
    expect(icon).toContain('tier-icon-pro-plus');
    expect(icon).toContain('💎');
  });

  it('returns pro icon via isPro legacy field', () => {
    const icon = renderTierIcon({ isPro: true });
    expect(icon).toContain('tier-icon-pro');
    expect(icon).toContain('⭐');
  });

  it('icon contains aria-label for accessibility', () => {
    expect(renderTierIcon({ subscriptionTier: 'pro' })).toContain('aria-label="Pro"');
    expect(renderTierIcon({ subscriptionTier: 'pro_plus' })).toContain('aria-label="Pro Plus"');
  });
});

describe('renderTierBadge', () => {
  it('renders a Starter badge for a free-tier or unclaimed bot supplier', () => {
    const badge = renderTierBadge({});
    expect(badge).toContain('badge-starter');
    expect(badge).toContain('>Starter<');
  });

  it('renders a Pro badge for a pro-tier supplier', () => {
    const badge = renderTierBadge({ subscriptionTier: 'pro' });
    expect(badge).toContain('badge-pro"');
    expect(badge).toContain('>Pro<');
    expect(badge).not.toContain('badge-pro-plus');
  });

  it('renders a Pro Plus badge for a pro_plus-tier supplier', () => {
    const badge = renderTierBadge({ subscriptionTier: 'pro_plus' });
    expect(badge).toContain('badge-pro-plus');
    expect(badge).toContain('>Pro Plus<');
  });

  it('applies an optional inline style attribute (package-list.js usage)', () => {
    const badge = renderTierBadge({}, { style: 'font-size: 0.6875rem;' });
    expect(badge).toContain('style="font-size: 0.6875rem;"');
  });

  it('never renders a tier badge that implies a real subscription for a bot-managed unclaimed listing', () => {
    // Unclaimed bot listings never set subscriptionTier/subscription.tier/isPro,
    // so they always fall through to Starter here -- consistent with the
    // MAX_PUBLIC_BOT_PACKAGES cap in supplierBotMarketplaceParity.service.js,
    // which caps their packages the same way a real Starter supplier's are.
    const botSupplier = { ownershipStatus: 'unclaimed', isSupplierBotProfile: true };
    const badge = renderTierBadge(botSupplier);
    expect(badge).toContain('badge-starter');
    expect(badge).not.toContain('badge-pro');
  });
});
