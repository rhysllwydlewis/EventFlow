/* EventFlow Homepage V2 Preview */
(function () {
  'use strict';

  window.__EF_PAGE__ = 'home-v2-preview';

  function queryAll(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function enhanceSearchForm() {
    var form = document.querySelector('.efv2-search');
    if (!form) {
      return;
    }

    form.addEventListener('submit', function (event) {
      var category = document.querySelector('#efv2-category');
      var location = document.querySelector('#efv2-location');
      var categoryValue = category ? category.value : '';
      var locationValue = location ? location.value.trim() : '';

      if (!categoryValue && !locationValue) {
        event.preventDefault();
        window.location.href = '/suppliers';
      }
    });
  }

  function initRevealMotion() {
    if (!('IntersectionObserver' in window)) {
      return;
    }

    var items = queryAll('.efv2-journey article, .efv2-category-card, .efv2-tool-grid article, .efv2-product-card, .efv2-compare-grid article');
    items.forEach(function (item) {
      item.classList.add('efv2-reveal');
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('efv2-reveal--visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    items.forEach(function (item) {
      observer.observe(item);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    enhanceSearchForm();
    initRevealMotion();
  });
})();
