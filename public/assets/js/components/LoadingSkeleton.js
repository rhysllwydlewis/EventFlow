/**
 * Loading Skeleton Component
 * Displays skeleton loaders while content is loading
 */

class LoadingSkeleton {
  constructor() {
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('skeleton-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'skeleton-styles';
    style.textContent = `
      .skeleton {

      @keyframes skeleton-loading {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .skeleton-text {
        height: 16px;
        margin-bottom: 8px;
      }

      .skeleton-title {
        height: 24px;
        margin-bottom: 12px;
        width: 70%;
      }

      .skeleton-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
      }

      .skeleton-card {

      .skeleton-image {
        width: 100%;
        height: 200px;
        border-radius: 8px;
      }

      .skeleton-button {
        width: 120px;
        height: 40px;
        border-radius: 4px;
      }

      .skeleton-paragraph {
        display: flex;
        flex-direction: column;
      }

      .skeleton-paragraph .skeleton-text:last-child {
        width: 80%;
      }
    `;
    document.head.appendChild(style);
  }

  // Create a text skeleton
  text(options = {}) {
    const { width = '100%', lines = 1, className = '' } = options;
    const container = document.createElement('div');
    container.className = `skeleton-paragraph ${className}`;

    for (let i = 0; i < lines; i++) {
      const line = document.createElement('div');
      line.className = 'skeleton skeleton-text';
      if (i === lines - 1 && lines > 1) {
        line.style.width = width === '100%' ? '80%' : width;
      } else {
        line.style.width = width;
      }
      container.appendChild(line);
    }

    return container;
  }

  // Create a title skeleton
  title(options = {}) {
    const { width = '70%', className = '' } = options;
    const title = document.createElement('div');
    title.className = `skeleton skeleton-title ${className}`;
    title.style.width = width;
    return title;
  }

  // Create an avatar skeleton
  avatar(options = {}) {
    const { size = 48, className = '' } = options;
    const avatar = document.createElement('div');
    avatar.className = `skeleton skeleton-avatar ${className}`;
    avatar.style.width = `${size}px`;
    avatar.style.height = `${size}px`;
    return avatar;
  }

  // Create an image skeleton
  image(options = {}) {
    const { width = '100%', height = '200px', className = '' } = options;
    const image = document.createElement('div');
    image.className = `skeleton skeleton-image ${className}`;
    image.style.width = width;
    image.style.height = height;
    return image;
  }

  // Create a button skeleton
  button(options = {}) {
    const { width = '120px', height = '40px', className = '' } = options;
    const button = document.createElement('div');
    button.className = `skeleton skeleton-button ${className}`;
    button.style.width = width;
    button.style.height = height;
    return button;
  }

  // Create a card skeleton
  card(options = {}) {
    const {
      hasAvatar = false,
      hasImage = false,
      titleLines = 1,
      textLines = 3,
      className = '',
    } = options;

    const card = document.createElement('div');
    card.className = `skeleton-card ${className}`;

    if (hasImage) {
      card.appendChild(this.image());
    }

    if (hasAvatar) {
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.marginBottom = '16px';
      header.appendChild(this.avatar());

      const titleContainer = document.createElement('div');
      titleContainer.style.flex = '1';
      titleContainer.style.marginLeft = '12px';
      titleContainer.appendChild(this.title());
      header.appendChild(titleContainer);

      card.appendChild(header);
    } else if (titleLines > 0) {
      card.appendChild(this.title());
    }

    if (textLines > 0) {
      card.appendChild(this.text({ lines: textLines }));
    }

    return card;
  }

  // Create multiple card skeletons
  cards(count = 3, options = {}) {
    const container = document.createElement('div');
    for (let i = 0; i < count; i++) {
      container.appendChild(this.card(options));
    }
    return container;
  }

  // Replace element with skeleton
  replace(element, options = {}) {
    if (!element) {
      return;
    }

    const skeleton = this.card(options);
    element.innerHTML = '';
    element.appendChild(skeleton);
  }

  // Remove skeleton and restore content
  restore(element, content) {
    if (!element) {
      return;
    }

    element.innerHTML = content;
  }
}

// Create global instance
if (typeof window !== 'undefined') {
  window.skeleton = new LoadingSkeleton();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoadingSkeleton;
}
