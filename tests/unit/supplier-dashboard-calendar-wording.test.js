'use strict';

/**
 * The calendar card tells public publishing apart from the supplier's own private calendar, in
 * the words the owner asked for, and the request for publishing access is a dialog (no prompt()).
 * The server decides who may publish (see tests/unit/public-calendar-enforcement.test.js); the
 * page only reflects it.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const calendarJs = read('public/assets/js/pages/dashboard-supplier-calendar.js');

describe('supplier calendar card wording', () => {
  test("a supplier who cannot publish is told so in the owner's words, and that the private calendar is fine", () => {
    expect(calendarJs).toContain(
      "Public calendar publishing isn't available for your supplier type."
    );
    expect(calendarJs).toContain('Your private calendar is not affected.');
    expect(calendarJs).not.toContain("Calendar publishing isn\\'t included for your category");
    expect(calendarJs).not.toContain('included for your category');
  });

  test('the notice uses textContent, never markup strings', () => {
    const start = calendarJs.indexOf('function updateCalendarHeader');
    const body = calendarJs.slice(start, calendarJs.indexOf('/** Wires the request dialog'));
    expect(body).not.toContain('.innerHTML');
    expect(body).toContain('lead.textContent =');
    expect(body).toContain('reassurance.textContent =');
  });

  test('public and private are named apart: buttons, legend, subtitle and link', () => {
    expect(html).toContain('Add private entry');
    // The visible words are the name (an aria-label that differs from them fails WCAG 2.5.3).
    expect(html).not.toContain('aria-label="Add private calendar entry"');
    expect(html).toContain('Add public event');
    expect(html).toContain('View public calendar');
    expect(html).toContain('Private entries');
    expect(html).toContain('Your private calendar.');
    expect(calendarJs).toContain('Your private calendar: entries only you can see.');
  });

  test('public publishing is reflected from the server flag, not decided on the page', () => {
    expect(calendarJs).toContain('currentSupplier.canPublishPublicCalendar === true');
    // The hidden buttons are a courtesy; the server enforces. Nothing here lists categories.
    expect(calendarJs).not.toMatch(/category\s*===|\.includes\(.*category/);
  });

  test('asking for access opens a dialog and posts the reason; there is no native prompt', () => {
    expect(calendarJs).not.toContain('window.prompt');
    expect(html).toMatch(
      /<dialog id="sdh-publisher-dialog"[^>]*aria-labelledby="sdh-publisher-title"/
    );
    expect(calendarJs).toContain('/api/v1/public-calendar/publisher-request');
    expect(calendarJs).toContain('submitPublishingRequest');
    expect(calendarJs).toContain('Request sent. An administrator will review it.');
  });

  test('the calendar is also there for a supplier with no profile yet (the private calendar needs none)', () => {
    const start = html.indexOf('id="availability-calendar"');
    const tag = html.slice(start, html.indexOf('>', start));
    expect(tag).not.toContain('data-needs-profile');
  });
});
