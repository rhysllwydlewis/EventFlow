'use strict';

/**
 * Budget maths used by the customer budget page (public/assets/js/budget-calc.js).
 * The rules mirror the dashboard: a line costs its actual amount, or its estimate when there is
 * no actual yet; remaining is budget minus that; a plan budget is read with parseFloat.
 */

const Calc = require('../../public/assets/js/budget-calc.js');

const line = (estimated, actual = 0, paid = 0, category = 'Venue') => ({
  id: `${category}-${estimated}-${actual}`,
  category,
  item: 'x',
  estimated,
  actual,
  paid,
  notes: '',
});

describe('toAmount', () => {
  test.each([
    [100, 100],
    ['1,200.50', 1200.5],
    ['£2,000', 2000],
    [' 15 ', 15],
    [0, 0],
    [-5, 0],
    [NaN, 0],
    [Infinity, 0],
    [null, 0],
    [undefined, 0],
    ['abc', 0],
    [{}, 0],
    [0.1 + 0.2, 0.3],
    [1.005, 1.01],
    [1e12, Calc.MAX_AMOUNT],
  ])('%p becomes %p', (input, expected) => {
    expect(Calc.toAmount(input)).toBe(expected);
  });
});

describe('sumMoney', () => {
  test('adds in pence so floats do not drift', () => {
    expect(Calc.sumMoney([0.1, 0.2])).toBe(0.3);
    expect(Calc.sumMoney([19.99, 19.99, 19.99])).toBe(59.97);
  });

  test('ignores junk and handles an empty or missing list', () => {
    expect(Calc.sumMoney([1, NaN, undefined, 2])).toBe(3);
    expect(Calc.sumMoney([])).toBe(0);
    expect(Calc.sumMoney(undefined)).toBe(0);
  });
});

describe('parseMoneyInput', () => {
  test.each([
    ['1200', { ok: true, value: 1200, empty: false }],
    ['1,200.50', { ok: true, value: 1200.5, empty: false }],
    ['£ 300', { ok: true, value: 300, empty: false }],
    ['0', { ok: true, value: 0, empty: false }],
    ['', { ok: true, value: 0, empty: true }],
    ['   ', { ok: true, value: 0, empty: true }],
    [null, { ok: true, value: 0, empty: true }],
  ])('accepts %p', (input, expected) => {
    expect(Calc.parseMoneyInput(input)).toEqual(expected);
  });

  test.each(['-5', 'abc', '12.345', '1e3', '12..5', '99999999999', 'NaN', 'Infinity'])(
    'rejects %p',
    input => {
      expect(Calc.parseMoneyInput(input).ok).toBe(false);
    }
  );
});

describe('parsePlanBudget (same reading as the dashboard)', () => {
  test.each([
    ['24000', 24000],
    [24000, 24000],
    ['£5,000', 0], // parseFloat stops at the pound sign: "not set", like the dashboard
    ['', 0],
    [null, 0],
    [undefined, 0],
    ['0', 0],
    ['-10', 0],
    [NaN, 0],
    ['5000-10000', 5000],
  ])('%p reads as %p', (input, expected) => {
    expect(Calc.parsePlanBudget(input)).toBe(expected);
  });
});

describe('lineCost and lineStatus', () => {
  test('actual wins over estimate, estimate is the fallback', () => {
    expect(Calc.lineCost(line(100, 150))).toBe(150);
    expect(Calc.lineCost(line(100, 0))).toBe(100);
    expect(Calc.lineCost(line(0, 0))).toBe(0);
    expect(Calc.lineCost(null)).toBe(0);
  });

  test('status is derived from paid versus cost', () => {
    expect(Calc.lineStatus(line(100, 0, 0))).toBe('unpaid');
    expect(Calc.lineStatus(line(100, 0, 40))).toBe('partial');
    expect(Calc.lineStatus(line(100, 0, 100))).toBe('paid');
    expect(Calc.lineStatus(line(100, 120, 100))).toBe('partial');
    expect(Calc.lineStatus(line(100, 120, 120))).toBe('paid');
    expect(Calc.lineStatus(line(0, 0, 0))).toBe('none');
    expect(Calc.lineStatus(undefined)).toBe('none');
  });

  test('pence rounding does not flip paid to part paid', () => {
    expect(Calc.lineStatus(line(0.3, 0, 0.1 + 0.2))).toBe('paid');
  });
});

describe('percent', () => {
  test('rounds to whole numbers and is 0 without a usable whole', () => {
    expect(Calc.percent(1, 3)).toBe(33);
    expect(Calc.percent(2, 3)).toBe(67);
    expect(Calc.percent(5, 0)).toBe(0);
    expect(Calc.percent(5, -10)).toBe(0);
    expect(Calc.percent(NaN, 10)).toBe(0);
    expect(Calc.percent(10, NaN)).toBe(0);
    expect(Calc.percent(-5, 10)).toBe(0);
  });

  test('can exceed 100 when over', () => {
    expect(Calc.percent(150, 100)).toBe(150);
  });
});

describe('summarise', () => {
  const items = [line(1000, 1200, 500), line(500, 0, 0), line(200, 200, 200)];

  test('headline figures', () => {
    const s = Calc.summarise(items, 3000);
    expect(s.budget).toBe(3000);
    expect(s.planned).toBe(1700);
    expect(s.committed).toBe(1900); // 1200 + 500 + 200
    expect(s.paid).toBe(700);
    expect(s.toPay).toBe(1200);
    expect(s.remaining).toBe(1100);
    expect(s.percentCommitted).toBe(63);
    expect(s.isOver).toBe(false);
    expect(s.overBy).toBe(0);
  });

  test('over budget gives negative remaining and a positive shortfall', () => {
    const s = Calc.summarise(items, 1500);
    expect(s.remaining).toBe(-400);
    expect(s.isOver).toBe(true);
    expect(s.overBy).toBe(400);
    expect(s.percentCommitted).toBe(127);
  });

  test('exactly on budget is not over', () => {
    const s = Calc.summarise(items, 1900);
    expect(s.remaining).toBe(0);
    expect(s.isOver).toBe(false);
  });

  test('zero or missing budget: nothing is "over", percentages are 0', () => {
    for (const budget of [0, undefined, null, NaN, -100, 'abc']) {
      const s = Calc.summarise(items, budget);
      expect(s.hasBudget).toBe(false);
      expect(s.isOver).toBe(false);
      expect(s.overBy).toBe(0);
      expect(s.percentCommitted).toBe(0);
      expect(s.percentPaid).toBe(0);
      expect(s.committed).toBe(1900);
    }
  });

  test('empty, missing and malformed lists', () => {
    expect(Calc.summarise([], 1000).remaining).toBe(1000);
    expect(Calc.summarise(undefined, 1000).committed).toBe(0);
    expect(Calc.summarise([null, {}, { estimated: 'x' }], 1000).committed).toBe(0);
  });

  test('NaN, negative and string amounts never leak into the totals', () => {
    const s = Calc.summarise(
      [
        { estimated: NaN, actual: 'abc', paid: -4 },
        { estimated: '£1,000', actual: '', paid: '250' },
      ],
      '2,000'
    );
    expect(Number.isFinite(s.committed)).toBe(true);
    expect(s.committed).toBe(1000);
    expect(s.paid).toBe(250);
    expect(s.remaining).toBe(1000);
  });

  test('paid beyond the cost is capped so "still to pay" never goes negative', () => {
    const s = Calc.summarise([line(100, 0, 500)], 1000);
    expect(s.paid).toBe(100);
    expect(s.toPay).toBe(0);
  });

  test('pence add up exactly', () => {
    const s = Calc.summarise([line(0.1), line(0.2)], 1);
    expect(s.committed).toBe(0.3);
    expect(s.remaining).toBe(0.7);
  });

  test('matches the dashboard rule: spent = sum(actual || estimated)', () => {
    const plan = { budget: '24000', budgetItems: [line(100, 0), line(200, 250), line(0, 40)] };
    const dashboardSpent = plan.budgetItems.reduce(
      (sum, i) => sum + (parseFloat(i.actual || i.estimated || 0) || 0),
      0
    );
    const s = Calc.summarise(plan.budgetItems, Calc.parsePlanBudget(plan.budget));
    expect(s.committed).toBe(dashboardSpent);
    expect(s.remaining).toBe(24000 - dashboardSpent);
  });
});

describe('meterSegments', () => {
  test('no budget, no bar', () => {
    expect(Calc.meterSegments(Calc.summarise([line(100)], 0))).toEqual({
      paid: 0,
      rest: 0,
      over: 0,
    });
  });

  test('within budget: paid and still to pay, nothing over', () => {
    const seg = Calc.meterSegments(Calc.summarise([line(400, 0, 100)], 1000));
    expect(seg).toEqual({ paid: 10, rest: 30, over: 0 });
  });

  test('over budget: the bar is as wide as the spend and only the excess is "over"', () => {
    const seg = Calc.meterSegments(Calc.summarise([line(1500, 0, 200)], 1000));
    expect(seg.over).toBeCloseTo(33.33, 1);
    expect(seg.paid + seg.rest + seg.over).toBeCloseTo(100, 1);
  });

  test('paid beyond the budget never exceeds the bar', () => {
    const seg = Calc.meterSegments(Calc.summarise([line(1500, 0, 1500)], 1000));
    expect(seg.paid + seg.rest + seg.over).toBeLessThanOrEqual(100.01);
  });
});

describe('byCategory', () => {
  const items = [
    line(1000, 1200, 0, 'Venue'),
    line(300, 0, 0, 'Venue'),
    line(500, 400, 0, 'Catering'),
    line(100, 0, 0, 'Zebra hire'),
    line(100, 0, 0, 'Aardvark'),
    { estimated: 50 },
  ];

  test('groups, orders by the given list then alphabetically, and totals', () => {
    const rows = Calc.byCategory(items, ['Venue', 'Catering', 'Other']);
    expect(rows.map(r => r.category)).toEqual([
      'Venue',
      'Catering',
      'Other',
      'Aardvark',
      'Zebra hire',
    ]);
    const venue = rows[0];
    expect(venue.count).toBe(2);
    expect(venue.planned).toBe(1300);
    expect(venue.committed).toBe(1500);
    expect(venue.diff).toBe(200);
    expect(venue.isOver).toBe(true);
  });

  test('under plan is not over; no plan is not over', () => {
    const rows = Calc.byCategory(items, ['Venue', 'Catering']);
    const catering = rows.find(r => r.category === 'Catering');
    expect(catering.diff).toBe(-100);
    expect(catering.isOver).toBe(false);
    const noPlan = Calc.byCategory([line(0, 90, 0, 'Decor')]);
    expect(noPlan[0].isOver).toBe(false);
    expect(noPlan[0].percentOfPlanned).toBe(0);
  });

  test('shares of the committed total add up to about 100', () => {
    const rows = Calc.byCategory(items, ['Venue', 'Catering']);
    const total = rows.reduce((sum, r) => sum + r.share, 0);
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
  });

  test('empty input', () => {
    expect(Calc.byCategory([])).toEqual([]);
    expect(Calc.byCategory(undefined)).toEqual([]);
  });
});

describe('formatGBP', () => {
  test.each([
    [0, '£0'],
    [1234, '£1,234'],
    [1234.5, '£1,234.50'],
    [0.1 + 0.2, '£0.30'],
    [1234567, '£1,234,567'],
    [-300, '-£300'],
    [-0.004, '£0'],
    [NaN, '£0'],
    [undefined, '£0'],
    [Infinity, '£0'],
    ['12.5', '£12.50'],
  ])('%p formats as %p', (input, expected) => {
    expect(Calc.formatGBP(input)).toBe(expected);
  });
});

describe('normaliseItem', () => {
  test('server shape', () => {
    expect(
      Calc.normaliseItem({
        id: 'a',
        category: 'Venue',
        item: 'Hall',
        estimated: 10,
        actual: 12,
        paid: 5,
      })
    ).toEqual({
      id: 'a',
      category: 'Venue',
      item: 'Hall',
      estimated: 10,
      actual: 12,
      paid: 5,
      notes: '',
    });
  });

  test('older planner shape (label and estimate strings)', () => {
    const n = Calc.normaliseItem({ id: 'b_1', label: 'Cake', estimate: '£150', actual: '' }, 'x');
    expect(n.item).toBe('Cake');
    expect(n.estimated).toBe(150);
    expect(n.actual).toBe(0);
    expect(n.category).toBe('Other');
  });

  test('junk input still yields a safe line', () => {
    const n = Calc.normaliseItem(null, 'fallback');
    expect(n).toEqual({
      id: 'fallback',
      category: 'Other',
      item: '',
      estimated: 0,
      actual: 0,
      paid: 0,
      notes: '',
    });
  });
});

describe('fromLegacy (data the old page kept on the device)', () => {
  const legacy = {
    total: 15000,
    expenses: [
      {
        id: 'e1',
        name: 'Deposit',
        category: 'Venue',
        amount: 3000,
        status: 'paid',
        vendor: 'Hill Farm',
        notes: 'March',
      },
      { id: 'e2', name: 'Cake', category: 'Catering', amount: 400, status: 'pending' },
      { id: 'e3', name: 'Late fee', category: 'Other', amount: 90, status: 'overdue' },
      { id: 'e4', name: '', category: 'Other', amount: 50, status: 'paid' },
      { id: 'e5', name: 'Zero', category: 'Other', amount: 0, status: 'paid' },
    ],
  };

  test('converts amounts, paid state and keeps the supplier in the notes', () => {
    const { total, items } = Calc.fromLegacy(legacy);
    expect(total).toBe(15000);
    expect(items.map(i => i.item)).toEqual(['Deposit', 'Cake', 'Late fee']);
    expect(items[0]).toMatchObject({
      estimated: 3000,
      actual: 3000,
      paid: 3000,
      notes: 'Supplier: Hill Farm. March',
    });
    expect(items[1]).toMatchObject({ estimated: 400, paid: 0 });
    expect(items[2].paid).toBe(0);
  });

  test('keeps the committed total the old page showed', () => {
    const { items } = Calc.fromLegacy(legacy);
    expect(Calc.summarise(items, 15000).committed).toBe(3490);
  });

  test('missing or broken data', () => {
    expect(Calc.fromLegacy(null)).toEqual({ total: 0, items: [] });
    expect(Calc.fromLegacy({ total: 'x', expenses: 'no' })).toEqual({ total: 0, items: [] });
  });
});

describe('toCsv', () => {
  test('header, status words and amounts to the penny', () => {
    const csv = Calc.toCsv([
      {
        id: '1',
        category: 'Venue',
        item: 'Hall',
        estimated: 100,
        actual: 120,
        paid: 120,
        notes: '',
      },
      {
        id: '2',
        category: 'Decor',
        item: 'Flowers',
        estimated: 50.5,
        actual: 0,
        paid: 0,
        notes: 'n',
      },
    ]);
    const rows = csv.split('\n');
    expect(rows[0]).toBe('"Item","Category","Planned","Actual","Paid","Status","Notes"');
    expect(rows[1]).toBe('"Hall","Venue","100.00","120.00","120.00","Paid",""');
    expect(rows[2]).toBe('"Flowers","Decor","50.50","0.00","0.00","Unpaid","n"');
  });

  test('quotes are doubled so a name with a quote cannot break the row', () => {
    const csv = Calc.toCsv([line(1)].map(i => ({ ...i, item: 'The "big" day, part 1' })));
    expect(csv.split('\n')[1].startsWith('"The ""big"" day, part 1","Venue"')).toBe(true);
  });

  test('spreadsheet formulas are defused', () => {
    const csv = Calc.toCsv([{ ...line(1), item: '=HYPERLINK("http://x")', notes: '+1' }]);
    const row = csv.split('\n')[1];
    expect(row.startsWith(`"'=HYPERLINK`)).toBe(true);
    expect(row.endsWith(`"'+1"`)).toBe(true);
  });

  test('no items still gives a header', () => {
    expect(Calc.toCsv([]).split('\n')).toHaveLength(1);
  });
});
