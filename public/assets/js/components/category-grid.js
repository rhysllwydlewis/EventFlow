/**
 * CategoryGrid Component
 * Displays a grid of category cards for browsing
 */

class CategoryGrid {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`CategoryGrid: Container ${containerId} not found`);
      return;
    }
    this.options = {
      showFeaturedPackages: false,
      ...options,
    };
    this.categories = [];
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('category-grid-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'category-grid-styles';
    style.textContent = `
      .category-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 28px;
        margin-top: 24px;
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
      }

      .category-card {
        position: relative;
        border-radius: 14px;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        background-color: var(--color-card-bg, #ffffff);
        border: 1px solid var(--color-border, #dee2e6);
      }

      .category-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      }

      .category-card-image {
        width: 100%;
        height: 240px;
        object-fit: cover;
        display: block;
      }

      .category-card-content {
        padding: 24px;
      }

      .category-card-header {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 14px;
      }

      .category-card-icon {
        font-size: 38px;
        flex-shrink: 0;
      }

      .category-card-name {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0;
        color: var(--color-text-primary, #212529);
        display: inline-block;
      }

      .category-card-description {
        font-size: 1.08rem;
        color: var(--color-text-secondary, #6c757d);
        margin: 0;
        line-height: 1.5;
      }

      .category-empty-state {
        text-align: center;
        padding: 48px 24px;
        color: var(--color-text-secondary, #6c757d);
        grid-column: 1 / -1;
      }

      /* Pexels Attribution */
      .category-card-credit {
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 10px;
        padding: 4px 8px;
        border-radius: 4px;
        z-index: 1;
      }

      .category-card-credit a {
        color: white;
        text-decoration: none;
      }

      .category-card-credit a:hover {
        text-decoration: underline;
      }

      /* Responsive breakpoints for 2x3 grid */
      @media (max-width: 768px) {
        .category-grid {
          grid-template-columns: 1fr;
          gap: 20px;
        }
        
        .category-card-image {
          height: 200px;
        }
        
        .category-card-content {
          padding: 20px;
        }
        
        .category-card-icon {
          font-size: 32px;
        }
        
        .category-card-name {
          font-size: 1.25rem;
        }
        
        .category-card-description {
          font-size: 0.9rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  async loadCategories() {
    try {
      const response = await fetch('/api/v1/categories');
      if (!response.ok) {
        throw new Error('Failed to load categories');
      }
      const data = await response.json();
      // Filter to only show visible categories
      this.categories = (data.items || []).filter(cat => cat.visible !== false);
      this.render();
    } catch (error) {
      console.error('Error loading categories:', error);
      this.container.innerHTML =
        '<div class="category-empty-state">Unable to load categories. Please try again later.</div>';
    }
  }

  render() {
    if (this.categories.length === 0) {
      this.container.innerHTML =
        '<div class="category-empty-state">No categories available at the moment.</div>';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'category-grid';

    this.categories.forEach(category => {
      const card = this.createCategoryCard(category);
      grid.appendChild(card);
    });

    this.container.innerHTML = '';
    this.container.appendChild(grid);
  }

  createCategoryCard(category) {
    const card = document.createElement('div');
    card.className = 'category-card';
    card.addEventListener('click', () => {
      window.location.href = `/category?slug=${category.slug}`;
    });

    const hasImage = category.heroImage && category.heroImage.trim() !== '';
    const imageHtml = hasImage
      ? `<img class="category-card-image" src="${category.heroImage}" alt="${category.name}" loading="lazy">`
      : '';

    // Add Pexels attribution if present
    // Note: pexelsAttribution is created by admin with validated URLs and escaped text
    // URLs are validated to be from pexels.com domain only, and photographer names are HTML-escaped
    // This is acceptable as admin-controlled content that has been properly sanitized
    const creditHtml = category.pexelsAttribution
      ? `<div class="category-card-credit">${category.pexelsAttribution}</div>`
      : '';

    card.innerHTML = `
      ${imageHtml}
      ${creditHtml}
      <div class="category-card-content">
        <div class="category-card-header">
          ${category.icon ? `<span class="category-card-icon">${category.icon}</span>` : ''}
          <h3 class="category-card-name">${category.name}</h3>
        </div>
        <p class="category-card-description">${category.description || ''}</p>
      </div>
    `;

    return card;
  }
}

// Export to window
if (typeof window !== 'undefined') {
  window.CategoryGrid = CategoryGrid;
}
