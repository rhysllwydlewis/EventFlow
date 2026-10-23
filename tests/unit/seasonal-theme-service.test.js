'use strict';

const service = require('../../services/seasonalTheme.service');

const {
  THEME_KEYS,
  dayNumber,
  formatDayNumber,
  parseIsoDate,
  easterSunday,
  nthSunday,
  ukDayNumber,
  secondsUntilUkMidnight,
  resolveTheme,
  nextChange,
  upcomingWindows,
  normalizeSettings,
  validateSettingsInput,
  OCCASION_BY_KEY,
} = service;

const iso = day => formatDayNumber(day);
const auto = (overrides = {}) => ({ auto: true, ...overrides });
const manual = (manualTheme, overrides = {}) => ({ auto: false, manualTheme, ...overrides });
/** The theme the rule picks on a UK calendar day, evaluated at midday UTC. */
const on = (settings, date) => resolveTheme(settings, new Date(`${date}T12:00:00Z`)).theme;

describe('moving dates match the real calendar', () => {
  it.each([
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
    [2031, '2031-04-13'],
    [2032, '2032-03-28'],
    [2033, '2033-04-17'],
    [2034, '2034-04-09'],
    [2035, '2035-03-25'],
  ])('Easter Sunday %i is %s', (year, expected) => {
    expect(iso(easterSunday(year))).toBe(expected);
  });

  it.each([
    [2025, '2025-03-30'],
    [2026, '2026-03-15'],
    [2027, '2027-03-07'],
    [2028, '2028-03-26'],
    [2029, '2029-03-11'],
  ])('Mothering Sunday %i (three weeks before Easter) is %s', (year, expected) => {
    expect(iso(easterSunday(year) - 21)).toBe(expected);
  });

  it.each([
    [2025, '2025-06-15'],
    [2026, '2026-06-21'],
    [2027, '2027-06-20'],
    [2028, '2028-06-18'],
  ])("Father's Day %i (third Sunday of June) is %s", (year, expected) => {
    expect(iso(nthSunday(year, 6, 3))).toBe(expected);
  });

  it.each([
    [2025, '2025-11-09'],
    [2026, '2026-11-08'],
    [2027, '2027-11-14'],
  ])('Remembrance Sunday %i (second Sunday of November) is %s', (year, expected) => {
    expect(iso(nthSunday(year, 11, 2))).toBe(expected);
  });

  it('every occasion has a window for every year the service claims to cover', () => {
    for (let year = 2025; year <= service.CHINESE_NEW_YEAR_LAST_YEAR; year += 1) {
      for (const occasion of service.OCCASIONS) {
        const window = occasion.window(year);
        expect(window).not.toBeNull();
        expect(window[0]).toBeLessThanOrEqual(window[1]);
      }
    }
  });

  it('Chinese New Year has no window outside its table, rather than a wrong one', () => {
    expect(OCCASION_BY_KEY['chinese-new-year'].window(2024)).toBeNull();
    expect(
      OCCASION_BY_KEY['chinese-new-year'].window(service.CHINESE_NEW_YEAR_LAST_YEAR + 1)
    ).toBeNull();
  });
});

describe('UK calendar day', () => {
  it('turns over at UK midnight in summer (BST, UTC+1)', () => {
    expect(iso(ukDayNumber(new Date('2026-07-14T22:59:59Z')))).toBe('2026-07-14');
    expect(iso(ukDayNumber(new Date('2026-07-14T23:00:00Z')))).toBe('2026-07-15');
  });

  it('turns over at UK midnight in winter (GMT, UTC+0)', () => {
    expect(iso(ukDayNumber(new Date('2026-12-10T23:59:59Z')))).toBe('2026-12-10');
    expect(iso(ukDayNumber(new Date('2026-12-11T00:00:00Z')))).toBe('2026-12-11');
  });

  it('stays correct across the clock changes', () => {
    // Clocks went forward on 29 Mar 2026 and back on 25 Oct 2026.
    expect(iso(ukDayNumber(new Date('2026-03-29T00:30:00Z')))).toBe('2026-03-29');
    expect(iso(ukDayNumber(new Date('2026-03-29T23:30:00Z')))).toBe('2026-03-30');
    expect(iso(ukDayNumber(new Date('2026-10-25T00:30:00Z')))).toBe('2026-10-25');
    expect(iso(ukDayNumber(new Date('2026-10-25T23:30:00Z')))).toBe('2026-10-25');
    expect(iso(ukDayNumber(new Date('2026-10-26T00:00:00Z')))).toBe('2026-10-26');
  });

  it('counts seconds to the next UK midnight', () => {
    expect(secondsUntilUkMidnight(new Date('2026-07-14T22:59:00Z'))).toBe(60);
    expect(secondsUntilUkMidnight(new Date('2026-12-10T23:59:59Z'))).toBe(1);
    expect(secondsUntilUkMidnight(new Date('2026-12-10T00:00:00Z'))).toBe(24 * 3600);
  });
});

describe('automatic schedule', () => {
  it.each([
    ['2026-10-19', null],
    ['2026-10-20', 'halloween'],
    ['2026-11-01', 'halloween'],
    ['2026-11-02', 'bonfire'],
    ['2026-11-06', 'bonfire'],
    ['2026-11-07', 'remembrance'],
    ['2026-11-11', 'remembrance'],
    ['2026-11-12', null],
    ['2026-11-30', null],
    ['2026-12-01', 'christmas'],
    ['2026-12-26', 'christmas'],
    ['2026-12-27', 'new-year'],
    ['2027-01-02', 'new-year'],
    ['2027-01-03', null],
    ['2026-02-07', null],
    ['2026-02-08', 'valentines'],
    ['2026-02-14', 'valentines'],
    ['2026-02-15', null],
    ['2026-02-16', 'chinese-new-year'],
    ['2026-02-24', 'chinese-new-year'],
    ['2026-02-25', null],
    ['2026-03-08', 'mothers-day'],
    ['2026-03-15', 'mothers-day'],
    ['2026-03-26', 'easter'],
    ['2026-04-06', 'easter'],
    ['2026-04-07', null],
    ['2026-06-13', null],
    ['2026-06-14', 'fathers-day'],
    ['2026-06-21', 'fathers-day'],
    ['2026-06-22', null],
    ['2026-08-15', null],
  ])('on %s shows %s', (date, expected) => {
    expect(on(auto(), date)).toBe(expected);
  });

  it('Remembrance runs to Remembrance Sunday when that falls after the 11th', () => {
    // 2027: second Sunday of November is the 14th.
    expect(on(auto(), '2027-11-14')).toBe('remembrance');
    expect(on(auto(), '2027-11-15')).toBeNull();
  });

  it('the occasion whose date moves wins an overlap, and the other resumes afterwards', () => {
    // Chinese New Year 2027 runs 5-13 Feb, over Valentine\'s Day (8-14 Feb).
    expect(on(auto(), '2027-02-10')).toBe('chinese-new-year');
    expect(on(auto(), '2027-02-13')).toBe('chinese-new-year');
    expect(on(auto(), '2027-02-14')).toBe('valentines');
  });

  it('switches on at UK midnight, not UTC midnight, in summer time', () => {
    // 20 Oct 2026 is still BST, so UK midnight is 23:00 UTC the evening before.
    expect(resolveTheme(auto(), new Date('2026-10-19T22:59:59Z')).theme).toBeNull();
    expect(resolveTheme(auto(), new Date('2026-10-19T23:00:00Z')).theme).toBe('halloween');
  });

  it('hands over from Halloween to Bonfire Night at UK midnight', () => {
    expect(resolveTheme(auto(), new Date('2026-11-01T23:59:59Z')).theme).toBe('halloween');
    expect(resolveTheme(auto(), new Date('2026-11-02T00:00:00Z')).theme).toBe('bonfire');
  });

  it('skips occasions an admin excluded', () => {
    expect(on(auto({ excluded: ['christmas'] }), '2026-12-10')).toBeNull();
    expect(on(auto({ excluded: ['christmas'] }), '2026-12-28')).toBe('new-year');
    expect(on(auto({ excluded: ['chinese-new-year'] }), '2027-02-10')).toBe('valentines');
  });

  it('reports its source', () => {
    expect(resolveTheme(auto(), new Date('2026-10-23T12:00:00Z')).source).toBe('auto');
  });
});

describe('manual choice', () => {
  it('shows the chosen theme whatever the date', () => {
    expect(on(manual('halloween'), '2026-12-01')).toBe('halloween');
    expect(on(manual('easter'), '2026-08-15')).toBe('easter');
  });

  it('shows the normal site for None, even inside an occasion', () => {
    expect(on(manual(null), '2026-10-23')).toBeNull();
  });

  it('hands back to the automatic schedule on the return date', () => {
    const settings = manual('halloween', { returnToAutoOn: '2026-12-05' });
    expect(on(settings, '2026-12-04')).toBe('halloween');
    expect(on(settings, '2026-12-05')).toBe('christmas');
    expect(resolveTheme(settings, new Date('2026-12-05T12:00:00Z')).source).toBe('returned');
    expect(resolveTheme(settings, new Date('2026-12-04T12:00:00Z')).source).toBe('manual');
  });

  it('honours exclusions after returning to the automatic schedule', () => {
    const settings = manual('halloween', { returnToAutoOn: '2026-12-05', excluded: ['christmas'] });
    expect(on(settings, '2026-12-06')).toBeNull();
  });

  it('ignores the return date while auto is on', () => {
    expect(on(auto({ manualTheme: 'easter', returnToAutoOn: '2026-01-01' }), '2026-10-23')).toBe(
      'halloween'
    );
  });
});

describe('nothing saved', () => {
  it.each([undefined, null, {}, 'junk', 42, []])('shows no theme for %p', stored => {
    expect(resolveTheme(stored, new Date('2026-10-23T12:00:00Z')).theme).toBeNull();
  });

  it('reports the UK date it evaluated', () => {
    expect(resolveTheme(undefined, new Date('2026-07-14T23:30:00Z')).ukDate).toBe('2026-07-15');
  });
});

describe('nextChange', () => {
  const now = new Date('2026-10-23T12:00:00Z');

  it('finds the next changeover on the automatic schedule', () => {
    expect(nextChange(auto(), now)).toEqual({ date: '2026-11-02', theme: 'bonfire' });
  });

  it('reports a return to the plain site when an occasion ends', () => {
    expect(nextChange(auto(), new Date('2026-11-09T12:00:00Z'))).toEqual({
      date: '2026-11-12',
      theme: null,
    });
  });

  it('is null when nothing will change by itself', () => {
    expect(nextChange(manual('halloween'), now)).toBeNull();
    expect(nextChange(manual(null), now)).toBeNull();
  });

  it('reports the return date of a manual choice', () => {
    expect(nextChange(manual('easter', { returnToAutoOn: '2026-11-03' }), now)).toEqual({
      date: '2026-11-03',
      theme: 'bonfire',
    });
  });
});

describe('upcomingWindows', () => {
  it('lists every occasion with its current or next window, in date order', () => {
    const list = upcomingWindows(new Date('2026-10-23T12:00:00Z'));
    expect(list.map(item => item.key).sort()).toEqual([...THEME_KEYS].sort());
    expect(list[0]).toMatchObject({ key: 'halloween', start: '2026-10-20', end: '2026-11-01' });
    const starts = list.map(item => item.start);
    expect(starts).toEqual([...starts].sort());
  });

  it('shows an occasion that has no window as null and sorts it last', () => {
    const list = upcomingWindows(new Date('2040-06-01T12:00:00Z'));
    const cny = list.find(item => item.key === 'chinese-new-year');
    expect(cny.start).toBeNull();
    expect(list[list.length - 1].key).toBe('chinese-new-year');
  });
});

describe('normalizeSettings', () => {
  it('turns anything malformed into safe defaults', () => {
    expect(
      normalizeSettings({
        auto: 'yes',
        manualTheme: 'diwali',
        returnToAutoOn: '2026-13-45',
        excluded: 'christmas',
      })
    ).toEqual({
      auto: false,
      manualTheme: null,
      returnToAutoOn: null,
      excluded: [],
    });
  });

  it('keeps valid values and drops unknown excluded keys', () => {
    expect(
      normalizeSettings({
        auto: true,
        manualTheme: 'easter',
        returnToAutoOn: '2026-12-05',
        excluded: ['christmas', 'nope', 'easter'],
      })
    ).toEqual({
      auto: true,
      manualTheme: 'easter',
      returnToAutoOn: '2026-12-05',
      excluded: ['easter', 'christmas'],
    });
  });
});

describe('validateSettingsInput', () => {
  it('accepts a complete auto configuration', () => {
    expect(validateSettingsInput({ auto: true, excluded: ['christmas'] })).toEqual({
      ok: true,
      value: { auto: true, manualTheme: null, returnToAutoOn: null, excluded: ['christmas'] },
    });
  });

  it('accepts a manual theme with a return date', () => {
    expect(
      validateSettingsInput({ auto: false, manualTheme: 'easter', returnToAutoOn: '2026-12-05' })
    ).toEqual({
      ok: true,
      value: { auto: false, manualTheme: 'easter', returnToAutoOn: '2026-12-05', excluded: [] },
    });
  });

  it('drops a manual theme and return date that are meaningless while auto is on', () => {
    const result = validateSettingsInput({
      auto: true,
      manualTheme: 'easter',
      returnToAutoOn: '2026-12-05',
    });
    expect(result.value).toMatchObject({ manualTheme: null, returnToAutoOn: null });
  });

  it('treats an empty return date as none', () => {
    expect(
      validateSettingsInput({ auto: false, manualTheme: null, returnToAutoOn: '' }).value
        .returnToAutoOn
    ).toBeNull();
  });

  it.each([
    [undefined, /settings object/],
    [null, /settings object/],
    [[], /settings object/],
    [{}, /auto must be/],
    [{ auto: 'true' }, /auto must be/],
    [{ auto: false, manualTheme: 'diwali' }, /manualTheme/],
    [{ auto: false, manualTheme: 5 }, /manualTheme/],
    [{ auto: false, returnToAutoOn: '05/12/2026' }, /returnToAutoOn/],
    [{ auto: false, returnToAutoOn: '2026-02-31' }, /returnToAutoOn/],
    [{ auto: true, excluded: 'christmas' }, /excluded/],
    [{ auto: true, excluded: ['christmas', 'diwali'] }, /excluded/],
  ])('rejects %j', (body, message) => {
    const result = validateSettingsInput(body);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(message);
  });
});

describe('date helpers', () => {
  it('round-trips day numbers', () => {
    expect(iso(dayNumber(2026, 10, 23))).toBe('2026-10-23');
    expect(iso(dayNumber(2027, 1, 1))).toBe('2027-01-01');
  });

  it('parses only real calendar dates', () => {
    expect(parseIsoDate('2026-02-28')).not.toBeNull();
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('2026-02-29')).toBeNull();
    expect(parseIsoDate('2026-2-9')).toBeNull();
    expect(parseIsoDate(20261023)).toBeNull();
  });
});
