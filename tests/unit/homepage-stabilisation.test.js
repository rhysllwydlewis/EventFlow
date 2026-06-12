'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const scenarioRunner = path.join(__dirname, '../helpers/homepage-stabilisation-scenario.js');

function runHomepageScenario({ stats, listings = [], reviews = [] } = {}) {
  const payload = Buffer.from(JSON.stringify({ stats, listings, reviews }), 'utf8').toString(
    'base64'
  );
  const output = execFileSync(process.execPath, [scenarioRunner, payload], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });

  return JSON.parse(output);
}

describe('homepage stabilisation layer', () => {
  it('hides public stats instead of showing inflated fallback counters when stats are all zero', () => {
    const result = runHomepageScenario();

    expect(result.statsDisplay).toBe('none');
    expect(result.statsHidden).toBe('true');
    expect(result.numbers[0]).toBe('0');
  });

  it('renders only real non-zero stats returned by the public stats API', () => {
    const result = runHomepageScenario({
      stats: {
        suppliersVerified: 3,
        packagesApproved: 0,
        marketplaceListingsActive: 2,
        reviewsApproved: 0,
      },
    });

    expect(result.statsDisplay).toBe('');
    expect(result.numbers).toEqual(['3+', '0', '2+', '0']);
  });

  it('shows an honest marketplace launch state when there are no live listings', () => {
    const result = runHomepageScenario();

    expect(result.marketplaceTitle).toBe('Marketplace launching soon');
    expect(result.marketplaceText).toContain('Marketplace launching soon');
  });

  it('hides static testimonials when no real approved reviews are returned', () => {
    const result = runHomepageScenario();

    expect(result.testimonialsDisplay).toBe('none');
    expect(result.testimonialsHidden).toBe('true');
  });

  it('replaces the inflated supplier CTA claim with an honest growth message', () => {
    const result = runHomepageScenario();

    expect(result.supplierCta).toBe('Join EventFlow as we grow our verified supplier network');
  });
});
