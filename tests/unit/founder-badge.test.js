'use strict';

describe('founderBadge', () => {
  const ORIGINAL_ENV = process.env.FOUNDER_LAUNCH_TS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.FOUNDER_LAUNCH_TS;
    } else {
      process.env.FOUNDER_LAUNCH_TS = ORIGINAL_ENV;
    }
    jest.resetModules();
  });

  it('awards the founder badge within 6 months of the launch date', () => {
    process.env.FOUNDER_LAUNCH_TS = '2026-01-01T00:00:00Z';
    jest.resetModules();
    const { getFounderSignupBadges, isWithinFounderWindow } = require('../../utils/founderBadge');

    const insideWindow = new Date('2026-03-01T00:00:00Z');
    expect(isWithinFounderWindow(insideWindow)).toBe(true);
    expect(getFounderSignupBadges(insideWindow)).toEqual(['founder']);
  });

  it('does not award the founder badge once the 6-month window has passed', () => {
    process.env.FOUNDER_LAUNCH_TS = '2026-01-01T00:00:00Z';
    jest.resetModules();
    const { getFounderSignupBadges, isWithinFounderWindow } = require('../../utils/founderBadge');

    const afterWindow = new Date('2026-08-01T00:00:00Z');
    expect(isWithinFounderWindow(afterWindow)).toBe(false);
    expect(getFounderSignupBadges(afterWindow)).toEqual([]);
  });

  it('defaults to the 2026-01-01 launch date when FOUNDER_LAUNCH_TS is unset', () => {
    delete process.env.FOUNDER_LAUNCH_TS;
    jest.resetModules();
    const { isWithinFounderWindow } = require('../../utils/founderBadge');

    expect(isWithinFounderWindow(new Date('2026-02-01T00:00:00Z'))).toBe(true);
    expect(isWithinFounderWindow(new Date('2026-08-01T00:00:00Z'))).toBe(false);
  });
});
