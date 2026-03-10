/**
 * Blog Article Enhancements
 * Applies P3 features to blog articles
 */

(function () {
  'use strict';

  /**
   * Add reading time estimate to article — only if the article header
   * does not already contain a read-time element (guides articles do).
   */
  function addReadingTime() {
    // Skip if the article already has a meta/read-time block rendered in HTML
    if (document.querySelector('.article-header__meta, .article-header__meta-item')) {
      return;
    }

    const article = document.querySelector('article, .article-content, main');
    if (!article) {
      return;
    }

    const content = article.textContent || '';

    if (typeof calculateReadingTime === 'function') {
      const minutes = calculateReadingTime(content);

      let container = document.getElementById('reading-time');
      if (!container) {
        container = document.createElement('div');
        container.id = 'reading-time';
        container.className = 'reading-time';

        const title = article.querySelector('h1');
        if (title) {
          title.insertAdjacentElement('afterend', container);
        } else {
          article.insertBefore(container, article.firstChild);
        }
      }

      container.textContent = `${minutes} min read`;
      container.setAttribute('aria-label', `Estimated reading time: ${minutes} minutes`);
    }
  }

  /**
   * Add breadcrumbs to article — only if no breadcrumb nav already exists
   * (guides articles include .article-breadcrumb in their HTML).
   */
  function addArticleBreadcrumbs() {
    // Skip if an article-level breadcrumb is already present in the HTML
    if (document.querySelector('.article-breadcrumb, nav[aria-label="Breadcrumb"]')) {
      return;
    }

    const title = document.querySelector('h1')?.textContent || 'Article';

    const breadcrumbs = [
      { label: 'Home', url: '/' },
      { label: 'Guides', url: '/blog' },
      { label: title, url: window.location.pathname },
    ];

    if (typeof renderBreadcrumbs === 'function') {
      let container = document.getElementById('breadcrumb-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'breadcrumb-container';

        const main = document.querySelector('main, article, .container');
        if (main) {
          main.insertBefore(container, main.firstChild);
        }
      }

      renderBreadcrumbs(breadcrumbs);
    }
  }

  /**
   * Add print button to article
   */
  function addPrintButton() {
    const article = document.querySelector('article, .article-content, main');
    if (!article) {
      return;
    }

    // Check if print button already exists
    if (document.getElementById('print-article-btn')) {
      return;
    }

    const printBtn = document.createElement('button');
    printBtn.id = 'print-article-btn';
    printBtn.className = 'print-button';
    printBtn.textContent = 'Print Article';
    printBtn.setAttribute('aria-label', 'Print this article');
    printBtn.style.marginTop = '2rem';

    printBtn.addEventListener('click', () => {
      window.print();
    });

    // Add at the end of article
    article.appendChild(printBtn);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      addReadingTime();
      addArticleBreadcrumbs();
      addPrintButton();
    });
  } else {
    addReadingTime();
    addArticleBreadcrumbs();
    addPrintButton();
  }
})();
