'use strict';

/**
 * Guest list manager (/guests): pure helpers, the escaping guarantee, and the page's invariants.
 * The app is run against the real guests.html in jsdom (child process) with a mocked fetch.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');
const html = fs.readFileSync(path.join(PUBLIC, 'guests.html'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'assets/css/guests.css'), 'utf8');
const lib = require('../../public/assets/js/guests.js');

const guest = (over = {}) =>
  lib.normalizeGuest({ id: 'g1', name: 'Jane Smith', rsvpStatus: 'pending', ...over });

describe('normalizeGuest', () => {
  test('reads the fields the server actually stores', () => {
    const g = lib.normalizeGuest({
      id: 'a',
      name: ' Jane Smith ',
      rsvpStatus: 'attending',
      partySize: 3,
      dietaryRequirements: 'Vegan',
      tableName: 'Top',
      tableId: 't1',
    });
    expect(g).toMatchObject({
      name: 'Jane Smith',
      status: 'attending',
      partySize: 3,
      dietary: 'Vegan',
      table: 'Top',
      seated: true,
    });
  });

  test('falls back safely for missing or unknown values', () => {
    const g = lib.normalizeGuest({ id: 'b', rsvpStatus: 'wat', partySize: 'lots' });
    expect(g).toMatchObject({ status: 'pending', partySize: 1, dietary: '', table: '', name: '' });
    expect(lib.normalizeGuest({ partySize: 99 }).partySize).toBe(20);
  });
});

describe('summarise', () => {
  const guests = [
    guest({ id: '1', rsvpStatus: 'attending', partySize: 2, dietaryRequirements: 'Vegan, Nuts' }),
    guest({ id: '2', rsvpStatus: 'attending', dietaryRequirements: 'vegan' }),
    guest({ id: '3', rsvpStatus: 'declined', dietaryRequirements: 'Gluten-free' }),
    guest({ id: '4', rsvpStatus: 'maybe', partySize: 2 }),
    guest({ id: '5' }),
  ];

  test('counts each reply and the people attending', () => {
    expect(lib.summarise(guests)).toMatchObject({
      total: 5,
      attending: 2,
      declined: 1,
      maybe: 1,
      pending: 1,
      attendingPeople: 3,
      totalPeople: 7,
      replied: 4,
    });
  });

  test('statuses add up to the total', () => {
    const s = lib.summarise(guests);
    expect(s.attending + s.declined + s.maybe + s.pending).toBe(s.total);
  });

  test('dietary needs come from attending guests only, grouped without regard to case', () => {
    expect(lib.summarise(guests).dietary).toEqual([
      { label: 'Vegan', count: 2 },
      { label: 'Nuts', count: 1 },
    ]);
  });

  test('an empty list is all zeros', () => {
    expect(lib.summarise([])).toMatchObject({ total: 0, attending: 0, replied: 0, dietary: [] });
  });
});

describe('filterGuests and sortGuests', () => {
  const guests = [
    guest({ id: '1', name: 'Zoe Adams', email: 'zoe@x.com', rsvpStatus: 'declined' }),
    guest({ id: '2', name: 'Ann Brown', tableName: 'Rose', rsvpStatus: 'attending' }),
    guest({ id: '3', name: 'Cy Carter', phone: '07700 111', rsvpStatus: 'attending' }),
  ];

  test('searches name, email, phone and table, ignoring case', () => {
    const ids = query => lib.filterGuests(guests, { query }).map(g => g.id);
    expect(ids('ANN')).toEqual(['2']);
    expect(ids('zoe@')).toEqual(['1']);
    expect(ids('7700')).toEqual(['3']);
    expect(ids('rose')).toEqual(['2']);
    expect(ids('')).toEqual(['1', '2', '3']);
  });

  test('combines search with a reply filter', () => {
    expect(lib.filterGuests(guests, { query: 'c', status: 'attending' }).map(g => g.id)).toEqual([
      '3',
    ]);
    expect(lib.filterGuests(guests, { status: 'declined' }).map(g => g.id)).toEqual(['1']);
  });

  test('sorts by surname, newest first, or reply, without mutating the input', () => {
    const copy = [...guests];
    expect(lib.sortGuests(guests, 'name').map(g => g.id)).toEqual(['1', '2', '3']);
    expect(lib.sortGuests(guests, 'status').map(g => g.status)).toEqual([
      'attending',
      'attending',
      'declined',
    ]);
    const dated = [
      guest({ id: 'a', createdAt: '2026-01-01' }),
      guest({ id: 'b', createdAt: '2026-03-01' }),
    ];
    expect(lib.sortGuests(dated, 'recent').map(g => g.id)).toEqual(['b', 'a']);
    expect(guests).toEqual(copy);
  });
});

describe('CSV', () => {
  test.each(['=1+1', '+44 7700', '-2', '@SUM(A1)'])(
    'csvCell neutralises the formula prefix in %s',
    value => {
      expect(lib.csvCell(value)).toBe(`"'${value}"`);
    }
  );

  test('csvCell quotes and doubles embedded quotes, and leaves normal text alone', () => {
    expect(lib.csvCell('Say "hi", ok')).toBe('"Say ""hi"", ok"');
    expect(lib.csvCell(null)).toBe('""');
    expect(lib.csvCell('Jane')).toBe('"Jane"');
  });

  test('buildCsv writes a header and one guarded row per guest', () => {
    const csv = lib.buildCsv([guest({ name: '=HYPERLINK("x")', rsvpStatus: 'attending' })]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('"Name","Email","Phone","RSVP","Party size","Dietary","Table","Notes"');
    expect(row.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(row).toContain('"Attending"');
  });

  test('parseCsv handles quotes, commas, line breaks inside cells, CRLF and a BOM', () => {
    const rows = lib.parseCsv('﻿Name,Notes\r\n"Smith, Jane","line1\nline2 ""q"""\r\nBob,\r\n');
    expect(rows).toEqual([
      ['Name', 'Notes'],
      ['Smith, Jane', 'line1\nline2 "q"'],
      ['Bob', ''],
    ]);
  });

  test('an export imports back to the same guests, including guarded cells', () => {
    const original = [
      guest({ name: 'Jane, "JJ" Smith', rsvpStatus: 'attending', partySize: 2, tableName: 'T1' }),
      guest({ id: 'g2', name: '=cmd|x', phone: '+44 7700 900000', dietaryRequirements: 'Vegan' }),
    ];
    const { guests, skipped, error } = lib.guestsFromCsv(lib.parseCsv(lib.buildCsv(original)));
    expect(error).toBe('');
    expect(skipped).toEqual([]);
    expect(guests).toHaveLength(2);
    expect(guests[0]).toMatchObject({
      name: 'Jane, "JJ" Smith',
      rsvpStatus: 'attending',
      partySize: 2,
      table: 'T1',
    });
    expect(guests[1]).toMatchObject({
      name: '=cmd|x',
      phone: '+44 7700 900000',
      dietary: 'Vegan',
    });
  });

  test('guestsFromCsv accepts the older FirstName/LastName/PlusOne layout', () => {
    const rows = lib.parseCsv(
      'FirstName,LastName,Email,Phone,RSVP,PlusOne,Dietary,Table,Notes\nJohn,Smith,j@x.com,,accepted,yes,Veg,T1,\n'
    );
    expect(lib.guestsFromCsv(rows).guests[0]).toMatchObject({
      name: 'John Smith',
      rsvpStatus: 'attending',
      partySize: 2,
      table: 'T1',
    });
  });

  test('rows without a name are reported, not dropped silently; a missing name column is an error', () => {
    const result = lib.guestsFromCsv(lib.parseCsv('Name,Email\nAnn,a@x.com\n,b@x.com\n'));
    expect(result.guests).toHaveLength(1);
    expect(result.skipped).toEqual([{ line: 3, reason: 'No name' }]);
    expect(lib.guestsFromCsv(lib.parseCsv('Email\na@x.com\n')).error).toMatch(/Name column/);
    expect(lib.guestsFromCsv([]).error).toMatch(/empty/);
  });
});

describe('toPayload', () => {
  test('sends nulls for empty fields, clamps party size and drops unknown statuses', () => {
    expect(
      lib.toPayload({ name: ' Ann ', email: ' ', rsvpStatus: 'bogus', partySize: '500', table: '' })
    ).toEqual({
      name: 'Ann',
      email: null,
      phone: null,
      rsvpStatus: 'pending',
      partySize: 20,
      dietary: null,
      notes: null,
      table: null,
    });
  });

  test('leaves the table out for guests seated by the seating plan', () => {
    expect(lib.toPayload({ name: 'Ann' }, { includeTable: false })).not.toHaveProperty('table');
  });
});

describe('isWeddingPlan', () => {
  test.each([
    [{ eventType: 'wedding' }, true],
    [{ name: 'Our Wedding' }, true],
    [{ weddingWebsite: { slug: 'x' } }, true],
    [{ eventType: 'party', name: 'Birthday' }, false],
    [null, false],
  ])('%j -> %s', (plan, expected) => {
    expect(lib.isWeddingPlan(plan)).toBe(expected);
  });
});

describe('the app, rendered into guests.html (jsdom)', () => {
  const runner = path.join(__dirname, '../helpers/guests-manager-scenario.js');
  const run = scenario =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [runner, Buffer.from(JSON.stringify(scenario), 'utf8').toString('base64')],
        {
          cwd: path.join(__dirname, '../..'),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 15000,
        }
      )
    );

  test('a script or image tag in a guest name is shown as text and never becomes markup', () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const result = run({
      guests: [
        {
          id: 'a',
          name: evil,
          email: '"><script>window.__pwned=2</script>',
          rsvpStatus: 'attending',
          dietaryRequirements: evil,
          tableName: evil,
        },
      ],
    });
    expect(result.results.imgs).toBe(0);
    expect(result.results.text).toContain(evil);
    expect(result.editDialog.imgs).toBe(0);
    expect(result.editDialog.nameValue).toBe(evil);
    expect(result.deleteDialog.imgs).toBe(0);
    expect(result.deleteDialog.title).toContain(evil);
    expect(result.pwned).toBeNull();
  });

  test('a guest id cannot break out of its data-id attribute', () => {
    const result = run({ guests: [{ id: 'x" onclick="window.__pwned=3', name: 'Sneaky' }] });
    expect(result.results.editOnclick).toBeNull();
    expect(result.results.editId).toBe('x" onclick="window.__pwned=3');
    expect(result.pwned).toBeNull();
  });

  test('shows the counts, the rows and a pointer to the wedding app for wedding plans', () => {
    const result = run({
      guests: [
        { id: '1', name: 'A One', rsvpStatus: 'attending', partySize: 2 },
        { id: '2', name: 'B Two', rsvpStatus: 'declined' },
      ],
    });
    expect(result.stats).toEqual([
      'Guests|2|3 people invited',
      'Attending|1|2 people',
      'Awaiting reply|0|No maybes',
      'Declined|1|Not coming',
    ]);
    expect(result.rows).toBe(2);
    expect(result.noteHref).toBe('/dashboard/customer#wedding-website-dashboard-card');
  });

  test('with no guests it offers to add or import, and shows no summary, filters or pointer', () => {
    const result = run({
      guests: [],
      plans: [{ id: 'p1', name: 'Birthday', eventType: 'party' }],
    });
    expect(result.emptyTitle).toBe('No guests yet');
    expect(result.summaryHidden).toBe(true);
    expect(result.toolbarHidden).toBe(true);
    expect(result.hasNote).toBe(false);
    expect(result.addHidden).toBe(false);
  });

  test('a failed guests request shows an error with a retry, not an empty list', () => {
    const result = run({ guestsStatus: 500 });
    expect(result.emptyTitle).toMatch(/could not load/);
    expect(result.retry).toBe(true);
    expect(result.addHidden).toBe(true);
  });

  test('an account with no plans is sent to create one', () => {
    const result = run({ plans: [] });
    expect(result.emptyTitle).toMatch(/Start a plan/);
    expect(result.addHidden).toBe(true);
  });
});

describe('signing in from the guest list', () => {
  test('the sign-in link returns to /guests, which the customer redirect allowlist permits', () => {
    const js = fs.readFileSync(path.join(PUBLIC, 'assets/js/guests.js'), 'utf8');
    expect(js).toContain('/auth?redirect=%2Fguests');
    const app = fs.readFileSync(path.join(PUBLIC, 'assets/js/app.js'), 'utf8');
    const customer = app.slice(app.indexOf('    customer: ['));
    expect(customer.slice(0, customer.indexOf('    ],'))).toMatch(/'\/guests',\s+'\/guests\.html'/);
  });
});

describe('formatDate', () => {
  /** Runs formatDate in a child process whose time zone is west of Greenwich. */
  const inNewYork = value =>
    require('child_process')
      .execFileSync(
        process.execPath,
        [
          '-e',
          `process.stdout.write(require(${JSON.stringify(require.resolve('../../public/assets/js/guests.js'))}).formatDate(${JSON.stringify(value)}))`,
        ],
        { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }
      )
      .trim();

  test('shows a plan date as the same calendar day in a time zone west of Greenwich', () => {
    expect(inNewYork('2027-06-19')).toBe('19 Jun 2027');
    expect(inNewYork('2027-06-19T00:00:00.000Z')).toBe('19 Jun 2027');
  });

  test('returns an empty string for a missing or invalid date', () => {
    expect(lib.formatDate('')).toBe('');
    expect(lib.formatDate('not a date')).toBe('');
  });
});

describe('decodeCsvBytes', () => {
  test('reads UTF-8 files, with or without a byte-order mark', () => {
    const utf8 = Buffer.from('\uFEFFName\nZoë Brontë\n', 'utf8');
    expect(lib.parseCsv(lib.decodeCsvBytes(utf8))).toEqual([['Name'], ['Zoë Brontë']]);
  });

  test('reads a Windows-1252 file (what Excel saves as "CSV") without corrupting accents', () => {
    const legacy = Buffer.from([0x4e, 0x0a, 0x5a, 0x6f, 0xeb, 0x20, 0x4a, 0x6f, 0x73, 0xe9]);
    expect(lib.decodeCsvBytes(legacy)).toBe('N\nZoë José');
  });
});

describe('pickFocusPlan', () => {
  const day = offset => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  test('picks the next upcoming plan, as the dashboard summary does', () => {
    const plans = [
      { id: 'far', eventDate: day(200) },
      { id: 'past', eventDate: day(-30) },
      { id: 'soon', eventDate: day(20) },
      { id: 'undated' },
    ];
    expect(lib.pickFocusPlan(plans).id).toBe('soon');
  });

  test('falls back to the latest dated plan when all have passed, then to the first plan', () => {
    expect(
      lib.pickFocusPlan([
        { id: 'old', eventDate: day(-90) },
        { id: 'recent', eventDate: day(-5) },
      ]).id
    ).toBe('recent');
    expect(lib.pickFocusPlan([{ id: 'a' }, { id: 'b' }]).id).toBe('a');
  });

  test('a plan dated today still counts as upcoming', () => {
    expect(
      lib.pickFocusPlan([
        { id: 'later', eventDate: day(10) },
        { id: 'today', eventDate: day(0) },
      ]).id
    ).toBe('today');
  });
});

describe('page invariants', () => {
  test('loads one page stylesheet and the single guests script, both versioned', () => {
    expect(html).toMatch(/\/assets\/css\/guests\.css\?v=[\w.]+/);
    expect(html).toMatch(/\/assets\/js\/guests\.js\?v=[\w.]+/);
    expect(html).not.toMatch(/guests-init\.js/);
    expect(html).not.toMatch(/chart(\.umd)?(\.min)?\.js/i);
  });

  test('uses no inline event handlers or inline styles in the main content', () => {
    const main = html.match(/<main[\s\S]*?<\/main>/)[0];
    expect(main).not.toMatch(/\son[a-z]+\s*=/i);
    expect(main).not.toMatch(/\sstyle\s*=/i);
    expect(fs.readFileSync(path.join(PUBLIC, 'assets/js/guests.js'), 'utf8')).not.toMatch(
      /\sonclick\s*=/
    );
  });

  test('every selector in guests.css is scoped under .gm', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [];
    stripped.replace(/(?:^|})\s*([^{}@]+)\{/g, (_, sel) => {
      sel.split(/,(?![^(]*\))/).forEach(s => selectors.push(s.trim()));
      return '';
    });
    const unscoped = selectors.filter(s => s && !/^(\.gm|\d+%|from|to)\b/.test(s));
    expect(unscoped).toEqual([]);
  });

  test('no pill radii and no font sizes off the type scale', () => {
    expect(css).not.toMatch(/border-radius:\s*(999|9999)/);
    const scale = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];
    const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map(m => Number(m[1]));
    expect(sizes.filter(px => !scale.includes(px))).toEqual([]);
  });

  test('the table undoes the global nowrap that mobile-optimizations.css gives every table', () => {
    const rule = css.match(/\.gm \.gm-table \{[\s\S]*?\n\}/)[0];
    expect(rule).toMatch(/white-space: normal;/);
  });

  test('a party size outside 1 to the server maximum is reported, not quietly changed', () => {
    const js = fs.readFileSync(path.join(PUBLIC, 'assets/js/guests.js'), 'utf8');
    expect(js).toContain('id="gm-party-error"');
    expect(js).toMatch(/party > MAX_PARTY/);
  });

  test('Enter in a field submits with the primary button, not "Save and add another"', () => {
    const js = fs.readFileSync(path.join(PUBLIC, 'assets/js/guests.js'), 'utf8');
    expect(js).toContain(
      'form.requestSubmit(form.querySelector(\'[type="submit"][value="done"]\'))'
    );
  });

  test('links back to the dashboard', () => {
    expect(html).toContain('href="/dashboard/customer"');
  });

  test('editing warns that a guest who is not attending loses their table', () => {
    const js = fs.readFileSync(path.join(PUBLIC, 'assets/js/guests.js'), 'utf8');
    expect(js).toContain('id="gm-seat-note"');
    expect(js).toMatch(/replySelect\.value !== 'attending'/);
  });

  test('respects reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
