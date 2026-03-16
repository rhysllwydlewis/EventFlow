// FAQ Search functionality
(function () {
  // Wait for DOM to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFAQSearch);
  } else {
    initFAQSearch();
  }

  function initFAQSearch() {
    const searchInput = document.getElementById('faq-search');
    const faqItems = document.querySelectorAll('.faq-item');
    const countDisplay = document.getElementById('faq-count');
    const noResultsEl = document.getElementById('faq-no-results');
    const faqList = document.getElementById('faq-list');

    // Store original content for each FAQ item
    const originalContent = new Map();
    faqItems.forEach(item => {
      const summary = item.querySelector('summary');
      const content = item.querySelector('p');

      // Add null checks
      if (summary && content) {
        originalContent.set(item, {
          summaryText: summary.textContent,
          contentText: content.textContent,
          summaryHTML: summary.innerHTML,
          contentHTML: content.innerHTML,
        });
      }
    });

    function searchFAQ(query) {
      const keywords = query
        .toLowerCase()
        .split(' ')
        .filter(k => k.trim());
      let visibleCount = 0;

      faqItems.forEach(item => {
        const original = originalContent.get(item);
        if (!original) {
          item.style.display = 'none';
          return;
        }

        const text = `${original.summaryText} ${original.contentText}`.toLowerCase();
        const matches = keywords.length === 0 || keywords.every(kw => text.includes(kw));

        item.style.display = matches ? 'block' : 'none';

        if (matches) {
          visibleCount++;

          const summary = item.querySelector('summary');
          const content = item.querySelector('p');

          if (!summary || !content) {
            return;
          }

          // Apply highlighting if there's a query
          if (query.trim() && window.TextHighlighting) {
            summary.innerHTML = window.TextHighlighting.highlightQuery(original.summaryText, query);
            content.innerHTML = window.TextHighlighting.highlightQuery(original.contentText, query);
          } else {
            // Restore original HTML when no query
            summary.innerHTML = original.summaryHTML;
            content.innerHTML = original.contentHTML;
          }
        }
      });

      // Update count display
      if (keywords.length > 0) {
        countDisplay.textContent = `${visibleCount} result${visibleCount !== 1 ? 's' : ''} found`;
      } else {
        countDisplay.textContent = `Showing all ${visibleCount} questions`;
      }

      // Show/hide no results message and FAQ list
      if (visibleCount === 0) {
        noResultsEl.style.display = 'block';
        faqList.style.display = 'none';
      } else {
        noResultsEl.style.display = 'none';
        faqList.style.display = 'block';
      }
    }

    // Initialize count display
    searchFAQ('');

    // Attach event listener
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        searchFAQ(e.target.value);
      });
    }
  }
})();
