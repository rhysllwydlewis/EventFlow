/**
 * FAQ Category Filter
 * Provides category filtering for the FAQ page.
 * Coordinates with faq-search-init.js: the two features are mutually exclusive
 * — clicking a category clears the search; typing in search resets to "All topics".
 */

'use strict';
(function () {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCategoryFilter);
  } else {
    initCategoryFilter();
  }

  function initCategoryFilter() {
    const filterBtns = document.querySelectorAll('.faq-filter-btn');
    const searchInput = document.getElementById('faq-search');
    const countEl = document.getElementById('faq-count');
    const faqList = document.getElementById('faq-list');
    const noResultsEl = document.getElementById('faq-no-results');

    if (!filterBtns.length) {
      return;
    }

    /* ── Helpers ──────────────────────────────────────────────────────────── */

    // Populate each filter button's (N) count from the actual number of
    // .faq-item elements in that category, so the label can never drift
    // out of sync with the content.
    function populateCounts() {
      const totalItems = document.querySelectorAll('.faq-item[data-category]').length;

      filterBtns.forEach(btn => {
        const countEl = btn.querySelector('.faq-filter-count');
        if (!countEl) {
          return;
        }
        const filter = btn.dataset.filter;
        const n =
          filter === 'all'
            ? totalItems
            : document.querySelectorAll(`.faq-item[data-category="${filter}"]`).length;
        countEl.textContent = ` (${n})`;
      });
    }

    populateCounts();

    function setDisplay(el, show) {
      el.style.display = show ? '' : 'none';
      if (el.hidden !== undefined) {
        el.hidden = !show;
      }
    }

    function applyFilter(filter) {
      const items = document.querySelectorAll('.faq-item[data-category]');
      const headings = document.querySelectorAll('.faq-group-heading[data-group]');
      const visibleGroups = new Set();

      // Show / hide items and track which groups have visible items
      items.forEach(item => {
        const show = filter === 'all' || item.dataset.category === filter;
        setDisplay(item, show);
        if (!show) {
          item.open = false;
        } // collapse hidden items
        if (show) {
          visibleGroups.add(item.dataset.category);
        }
      });

      // Show headings only for groups that have at least one visible item
      headings.forEach(h => {
        setDisplay(h, filter === 'all' || visibleGroups.has(h.dataset.group));
      });

      if (faqList) {
        faqList.hidden = false;
      }
      if (noResultsEl) {
        noResultsEl.hidden = true;
      }

      // Update count display
      if (countEl) {
        if (filter !== 'all') {
          const n = document.querySelectorAll(`.faq-item[data-category="${filter}"]`).length;
          countEl.textContent = `${n} question${n === 1 ? '' : 's'} in this category`;
        } else {
          countEl.textContent = '';
        }
      }
    }

    function setActiveBtn(activeFilter) {
      filterBtns.forEach(b => {
        const isActive = b.dataset.filter === activeFilter;
        b.classList.toggle('faq-filter-btn--active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    /* ── Category button clicks ───────────────────────────────────────────── */

    filterBtns.forEach(btn => {
      // Set initial aria-pressed from the HTML class state
      btn.setAttribute(
        'aria-pressed',
        btn.classList.contains('faq-filter-btn--active') ? 'true' : 'false'
      );

      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        setActiveBtn(filter);

        // Clear search so the two features don't conflict.
        // Dispatching 'input' triggers faq-search-init.js which resets
        // item visibility before we apply our category filter.
        if (searchInput && searchInput.value) {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
        }

        applyFilter(filter);
      });
    });

    /* ── Search resets category filter ───────────────────────────────────── */
    // Capture phase so this fires BEFORE faq-search-init.js's bubble listener.
    // When the user types: reset category to "All" and search results appear
    // correctly across all categories.

    if (searchInput) {
      searchInput.addEventListener(
        'input',
        () => {
          const q = searchInput.value.trim();

          if (q) {
            // Active search — reset to "All topics"
            setActiveBtn('all');
            // Reset category-hidden elements before search handles item and heading visibility.
            document
              .querySelectorAll('.faq-item[data-category], .faq-group-heading[data-group]')
              .forEach(el => {
                el.hidden = false;
                el.style.display = '';
              });
            if (faqList) {
              faqList.hidden = false;
            }
            if (noResultsEl) {
              noResultsEl.hidden = true;
            }
            if (countEl) {
              countEl.textContent = '';
            }
          } else {
            // Search cleared — restore "All topics" default view
            setActiveBtn('all');
            applyFilter('all');
          }
        },
        true /* capture: runs before faq-search-init.js bubble listener */
      );
    }
  }
})();
