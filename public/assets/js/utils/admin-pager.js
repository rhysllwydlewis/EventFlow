/**
 * Admin list paging: the "Showing 51–100 of 349" line and Previous / Next buttons that were missing
 * from lists which quietly stopped after their first rows.
 *
 *   const pager = AdminPager.mount({ after: tableWrapper, onChange: page => draw(page) });
 *   pager.update({ page, size: 50, total: 349, noun: 'tickets' });
 *
 * Plain functions (range, label, slice) are exposed too so the numbers can be tested.
 */
(function (root) {
  'use strict';

  /**
   * Which rows a page covers.
   * @param {number} page - 1-based page number
   * @param {number} size - Rows per page
   * @param {number} total - Rows in all
   * @returns {{page: number, pages: number, first: number, last: number}} first/last are 1-based, 0 when empty
   */
  function range(page, size, total) {
    const rowsPerPage = Math.max(1, Math.floor(size) || 1);
    const count = Math.max(0, Math.floor(total) || 0);
    const pages = Math.max(1, Math.ceil(count / rowsPerPage));
    const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    const first = count === 0 ? 0 : (current - 1) * rowsPerPage + 1;
    const last = Math.min(current * rowsPerPage, count);
    return { page: current, pages, first, last };
  }

  /**
   * The rows of one page.
   * @param {Array} items - All rows
   * @param {number} page - 1-based page number
   * @param {number} size - Rows per page
   * @returns {Array} The rows on that page
   */
  function slice(items, page, size) {
    const { first, last } = range(page, size, items.length);
    return first === 0 ? [] : items.slice(first - 1, last);
  }

  /**
   * "Showing 51–100 of 349 tickets", or "Showing all 12 tickets" when there is one page.
   * @param {number} page - 1-based page number
   * @param {number} size - Rows per page
   * @param {number} total - Rows in all
   * @param {string} [noun] - What the rows are, plural ("tickets")
   * @returns {string} Text for the line above or below the list
   */
  function label(page, size, total, noun) {
    const what = noun || 'items';
    const { first, last, pages } = range(page, size, total);
    if (total === 0) {
      return `No ${what}`;
    }
    if (pages === 1) {
      return `Showing all ${total} ${what}`;
    }
    return `Showing ${first}–${last} of ${total} ${what}`;
  }

  /**
   * Adds the paging line and buttons to a page.
   * @param {Object} options
   * @param {Element} options.after - The list's wrapper; the pager is inserted just after it
   * @param {function(number): void} options.onChange - Called with the new page number
   * @returns {{update: function(Object): void}} Call update({page, size, total, noun}) after each draw
   */
  function mount(options) {
    const nav = document.createElement('nav');
    nav.className = 'admin-pager';
    nav.setAttribute('aria-label', 'Pages');

    const text = document.createElement('p');
    text.className = 'admin-pager__label small';
    text.setAttribute('role', 'status');
    text.setAttribute('aria-live', 'polite');

    const newer = document.createElement('button');
    newer.type = 'button';
    newer.className = 'btn btn-secondary btn-sm';
    newer.textContent = '← Previous';

    const older = document.createElement('button');
    older.type = 'button';
    older.className = 'btn btn-secondary btn-sm';
    older.textContent = 'Next →';

    nav.append(text, newer, older);
    options.after.insertAdjacentElement('afterend', nav);

    let current = 1;
    newer.addEventListener('click', () => options.onChange(current - 1));
    older.addEventListener('click', () => options.onChange(current + 1));

    return {
      update({ page, size, total, noun }) {
        const info = range(page, size, total);
        current = info.page;
        text.textContent = label(info.page, size, total, noun);
        newer.hidden = info.pages === 1;
        older.hidden = info.pages === 1;
        newer.disabled = info.page <= 1;
        older.disabled = info.page >= info.pages;
      },
    };
  }

  root.AdminPager = { range, slice, label, mount };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.AdminPager;
  }
})(typeof window !== 'undefined' ? window : globalThis);
