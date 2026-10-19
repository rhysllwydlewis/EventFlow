'use strict';
/**
 * Budget maths for the customer budget page.
 *
 * Pure functions with no DOM access, shared by public/assets/js/pages/budget-page.js (browser,
 * exposed as window.EFBudgetCalc) and the unit tests (CommonJS).
 *
 * The rules deliberately match the customer dashboard (dashboard-customer-module.js), so both
 * places agree on the numbers:
 *   - the cost of a line is its actual amount when there is one, otherwise its estimate;
 *   - "committed" is the sum of those costs, "remaining" is budget minus committed;
 *   - a plan budget is read with parseFloat, and anything that is not a positive number is "not set".
 *
 * Money is added in whole pence so 0.1 + 0.2 style float drift never reaches the screen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EFBudgetCalc = factory();
  }
})(typeof self !== 'undefined' ? self : this, () => {
  const MAX_AMOUNT = 1000000000;

  const DEFAULT_CATEGORIES = [
    'Venue',
    'Catering',
    'Photography',
    'Entertainment',
    'Decor',
    'Transport',
    'Attire',
    'Other',
  ];

  /** Rounds to whole pence the way a person would: 1.005 becomes 1.01, not 1. */
  function roundPence(n) {
    const text = String(n);
    if (text.includes('e')) {
      return Math.round(n * 100) / 100;
    }
    return Math.round(Number(`${text}e2`)) / 100;
  }

  /** Finite, non-negative amount in pounds, rounded to pence. Anything else becomes 0. */
  function toAmount(value) {
    let n = value;
    if (typeof n === 'string') {
      n = parseFloat(n.replace(/[£,\s]/g, ''));
    }
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.min(roundPence(n), MAX_AMOUNT);
  }

  const toPence = value => Math.round(toAmount(value) * 100);

  /** Adds amounts exactly (in pence) and returns pounds. */
  function sumMoney(values) {
    const pence = (values || []).reduce((sum, v) => sum + Math.round((Number(v) || 0) * 100), 0);
    return pence / 100;
  }

  /**
   * Reads what a person typed into an amount field.
   * Returns { ok, value, empty }: empty input is ok with value 0 and empty true; negatives,
   * letters, more than two decimals and absurd sizes are not ok.
   */
  function parseMoneyInput(text) {
    const raw = String(text ?? '')
      .replace(/[£\s]/g, '')
      .replace(/,/g, '');
    if (raw === '') {
      return { ok: true, value: 0, empty: true };
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      return { ok: false, value: 0, empty: false };
    }
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value > MAX_AMOUNT) {
      return { ok: false, value: 0, empty: false };
    }
    return { ok: true, value: Math.round(value * 100) / 100, empty: false };
  }

  /** The plan budget the way the dashboard reads it: parseFloat, positive or "not set" (0). */
  function parsePlanBudget(value) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_AMOUNT) : 0;
  }

  /** What a line costs: the actual amount once known, otherwise the estimate. */
  function lineCost(item) {
    const actual = toAmount(item && item.actual);
    return actual > 0 ? actual : toAmount(item && item.estimated);
  }

  /** 'none' (no cost yet), 'unpaid', 'partial' or 'paid'. */
  function lineStatus(item) {
    const cost = toPence(lineCost(item));
    if (cost === 0) {
      return 'none';
    }
    const paid = toPence(item && item.paid);
    if (paid >= cost) {
      return 'paid';
    }
    return paid > 0 ? 'partial' : 'unpaid';
  }

  /** Whole-number percentage of part in whole; 0 when there is no usable whole. */
  function percent(part, whole) {
    const p = Number(part);
    const w = Number(whole);
    if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0 || p <= 0) {
      return 0;
    }
    return Math.round((p / w) * 100);
  }

  /**
   * Headline figures for the page.
   * remaining can be negative (over budget); overBy is the positive shortfall.
   */
  function summarise(items, total) {
    const list = Array.isArray(items) ? items : [];
    const budget = toAmount(total);
    const planned = sumMoney(list.map(i => toAmount(i && i.estimated)));
    const committed = sumMoney(list.map(lineCost));
    const paid = sumMoney(list.map(i => Math.min(toAmount(i && i.paid), lineCost(i))));
    const remaining = sumMoney([budget, -committed]);
    const hasBudget = budget > 0;
    return {
      budget,
      hasBudget,
      planned,
      committed,
      paid,
      toPay: Math.max(0, sumMoney([committed, -paid])),
      remaining,
      overBy: hasBudget && remaining < 0 ? -remaining : 0,
      isOver: hasBudget && remaining < 0,
      percentCommitted: hasBudget ? percent(committed, budget) : 0,
      percentPaid: hasBudget ? percent(paid, budget) : 0,
    };
  }

  /**
   * How the progress bar is split, as percentages of the bar (they add up to at most 100).
   * The bar is as wide as the larger of budget and committed, so overspending never hides the
   * budget: money up to the budget is paid (dark) or still to pay (light), and only the part
   * beyond the budget is "over". Without a budget there is no bar.
   */
  function meterSegments(summary) {
    const s = summary || {};
    if (!s.hasBudget) {
      return { paid: 0, rest: 0, over: 0 };
    }
    const scale = Math.max(s.budget, s.committed);
    const within = Math.min(s.committed, s.budget);
    const paid = Math.min(s.paid, within);
    const pct = amount => Math.round((amount / scale) * 10000) / 100;
    return {
      paid: pct(paid),
      rest: pct(within - paid),
      over: pct(Math.max(0, s.committed - s.budget)),
    };
  }

  /**
   * Planned versus committed per category, in the given category order (unknown categories
   * follow alphabetically). Categories without any lines are left out.
   * diff > 0 means the category is running over what was planned for it; share is its percentage
   * of everything committed.
   */
  function byCategory(items, order) {
    const list = Array.isArray(items) ? items : [];
    const known = Array.isArray(order) ? order : DEFAULT_CATEGORIES;
    const groups = new Map();
    list.forEach(item => {
      const name = String((item && item.category) || '').trim() || 'Other';
      if (!groups.has(name)) {
        groups.set(name, []);
      }
      groups.get(name).push(item);
    });
    const names = [...groups.keys()].sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      }
      return a.localeCompare(b, 'en-GB');
    });
    const grand = sumMoney([...groups.values()].map(rows => sumMoney(rows.map(lineCost))));
    return names.map(category => {
      const rows = groups.get(category);
      const planned = sumMoney(rows.map(i => toAmount(i.estimated)));
      const committed = sumMoney(rows.map(lineCost));
      const diff = sumMoney([committed, -planned]);
      return {
        category,
        count: rows.length,
        planned,
        committed,
        diff,
        isOver: planned > 0 && diff > 0,
        percentOfPlanned: percent(committed, planned),
        share: percent(committed, grand),
      };
    });
  }

  /** British pounds: £1,234 for whole amounts, £1,234.50 otherwise. Never NaN. */
  function formatGBP(value) {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    const pence = Math.round(Math.abs(n) * 100);
    const whole = pence % 100 === 0;
    const text = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(pence / 100);
    return n < 0 && pence > 0 ? `-${text}` : text;
  }

  /** Accepts the server shape and the older planner shape (label / estimate strings). */
  function normaliseItem(raw, fallbackId) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      id: String(r.id || fallbackId || ''),
      category: String(r.category || '').trim() || 'Other',
      item: String(r.item ?? (r.label || '')).trim(),
      estimated: toAmount(r.estimated ?? r.estimate),
      actual: toAmount(r.actual),
      paid: toAmount(r.paid),
      notes: String(r.notes || '').trim(),
    };
  }

  /**
   * Converts the data the old page kept on this device ({ total, expenses: [...] }) to budget
   * lines. An expense becomes a line whose estimate and actual are its amount; "paid" expenses
   * count as fully paid. Dates, supplier names and the pending/overdue split have no home in the
   * plan's budget lines, so the supplier name is kept in the notes and the rest is dropped.
   */
  function fromLegacy(legacy) {
    const data = legacy && typeof legacy === 'object' ? legacy : {};
    const expenses = Array.isArray(data.expenses) ? data.expenses : [];
    const items = expenses
      .map((e, index) => {
        const amount = toAmount(e && e.amount);
        const vendor = String((e && e.vendor) || '').trim();
        const notes = String((e && e.notes) || '').trim();
        return normaliseItem(
          {
            id: (e && e.id) || `legacy_${index}`,
            category: e && e.category,
            item: e && e.name,
            estimated: amount,
            actual: amount,
            paid: e && e.status === 'paid' ? amount : 0,
            notes: [vendor ? `Supplier: ${vendor}` : '', notes].filter(Boolean).join('. '),
          },
          `legacy_${index}`
        );
      })
      .filter(i => i.item && i.estimated > 0);
    return { total: toAmount(data.total), items };
  }

  /** One CSV cell: quoted, quotes doubled, and spreadsheet formulas defused. */
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  const STATUS_LABELS = { none: '', unpaid: 'Unpaid', partial: 'Part paid', paid: 'Paid' };

  function toCsv(items) {
    const header = ['Item', 'Category', 'Planned', 'Actual', 'Paid', 'Status', 'Notes'];
    const rows = (Array.isArray(items) ? items : []).map(i => [
      i.item,
      i.category,
      toAmount(i.estimated).toFixed(2),
      toAmount(i.actual).toFixed(2),
      toAmount(i.paid).toFixed(2),
      STATUS_LABELS[lineStatus(i)],
      i.notes || '',
    ]);
    return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  }

  return {
    MAX_AMOUNT,
    DEFAULT_CATEGORIES,
    STATUS_LABELS,
    toAmount,
    sumMoney,
    parseMoneyInput,
    parsePlanBudget,
    lineCost,
    lineStatus,
    percent,
    summarise,
    meterSegments,
    byCategory,
    formatGBP,
    normaliseItem,
    fromLegacy,
    toCsv,
  };
});
