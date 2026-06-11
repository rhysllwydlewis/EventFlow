/**
 * FAQ Category Filter
 * Provides category filtering for the FAQ page.
 * Coordinates with faq-search-init.js: the two features are mutually exclusive
 * — clicking a category clears the search; typing in search resets to "All topics".
 */

(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCategoryFilter);
  } else {
    initCategoryFilter();
  }

  function initCategoryFilter() {
    var filterBtns  = document.querySelectorAll('.faq-filter-btn');
    var searchInput = document.getElementById('faq-search');
    var countEl     = document.getElementById('faq-count');

    if (!filterBtns.length) return;

    /* ── Helpers ──────────────────────────────────────────────────────────── */

    function setDisplay(el, show) {
      // Use style.display to match the mechanism used by faq-search-init.js
      el.style.display = show ? '' : 'none';
    }

    function applyFilter(filter) {
      var items    = document.querySelectorAll('.faq-item[data-category]');
      var headings = document.querySelectorAll('.faq-group-heading[data-group]');
      var visibleGroups = new Set();

      // Show / hide items and track which groups have visible items
      items.forEach(function (item) {
        var show = filter === 'all' || item.dataset.category === filter;
        setDisplay(item, show);
        if (!show) { item.open = false; } // collapse hidden items
        if (show)  { visibleGroups.add(item.dataset.category); }
      });

      // Show headings only for groups that have at least one visible item
      headings.forEach(function (h) {
        setDisplay(h, filter === 'all' || visibleGroups.has(h.dataset.group));
      });

      // Update count display
      if (countEl) {
        if (filter !== 'all') {
          var n = document.querySelectorAll(
            '.faq-item[data-category="' + filter + '"]'
          ).length;
          countEl.textContent = n + ' question' + (n === 1 ? '' : 's') + ' in this category';
        } else {
          countEl.textContent = '';
        }
      }
    }

    function setActiveBtn(activeFilter) {
      filterBtns.forEach(function (b) {
        var isActive = b.dataset.filter === activeFilter;
        b.classList.toggle('faq-filter-btn--active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }

    /* ── Category button clicks ───────────────────────────────────────────── */

    filterBtns.forEach(function (btn) {
      // Set initial aria-pressed from the HTML class state
      btn.setAttribute(
        'aria-pressed',
        btn.classList.contains('faq-filter-btn--active') ? 'true' : 'false'
      );

      btn.addEventListener('click', function () {
        var filter = btn.dataset.filter;
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
    // When the user types: reset category to "All" and show all headings so
    // search results appear correctly across all categories.

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var q = searchInput.value.trim();

        if (q) {
          // Active search — reset to "All topics"
          setActiveBtn('all');
          // Show all headings (search handles item visibility per-item)
          document.querySelectorAll('.faq-group-heading[data-group]').forEach(function (h) {
            h.style.display = '';
          });
          if (countEl) { countEl.textContent = ''; }
        } else {
          // Search cleared — restore "All topics" default view
          setActiveBtn('all');
          applyFilter('all');
        }
      }, true /* capture: runs before faq-search-init.js bubble listener */);
    }
  }
})();
