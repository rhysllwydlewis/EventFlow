/**
 * Pexels Client-Side Service
 * Fetches photos from Pexels API through our backend proxy
 * Used for test supplier avatars and home page imagery
 */

class PexelsClient {
  constructor() {
    this.cache = new Map();
    this.categoryQueries = {
      Venues: 'elegant venue hall interior',
      Catering: 'elegant catering food buffet',
      Photography: 'professional camera photography equipment',
      Entertainment: 'live music band performance',
      'Flowers & décor': 'wedding flowers decoration arrangement',
      Transport: 'luxury wedding car vehicle',
      'Extras & add-ons': 'event decoration details elegant',
    };
  }

  /**
   * Search photos via backend proxy
   * @param {string} query - Search query
   * @param {number} perPage - Results per page (default: 5)
   * @returns {Promise<Object>} Search results
   */
  async searchPhotos(query, perPage = 5) {
    // Check cache first
    const cacheKey = `${query}-${perPage}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await fetch(
        `/api/pexels/search?q=${encodeURIComponent(query)}&per_page=${perPage}`
      );

      if (!response.ok) {
        throw new Error(`Pexels API error: ${response.status}`);
      }

      const data = await response.json();

      // Cache the result
      this.cache.set(cacheKey, data);

      return data;
    } catch (error) {
      console.warn('Failed to fetch Pexels photos:', error);
      return { photos: [] };
    }
  }

  /**
   * Get a photo for a specific supplier category
   * @param {string} category - Supplier category
   * @param {string} size - Photo size (small, medium, large)
   * @returns {Promise<string|null>} Photo URL or null
   */
  async getPhotoForCategory(category, size = 'medium') {
    const query = this.categoryQueries[category] || 'professional business elegant';

    try {
      const result = await this.searchPhotos(query, 1);

      if (result.photos && result.photos.length > 0) {
        return result.photos[0].src[size] || result.photos[0].src.medium;
      }

      return null;
    } catch (error) {
      console.warn(`Failed to get photo for category "${category}":`, error);
      return null;
    }
  }

  /**
   * Get curated photos via backend proxy
   * @param {number} perPage - Results per page (default: 5)
   * @returns {Promise<Object>} Curated photos
   */
  async getCuratedPhotos(perPage = 5) {
    const cacheKey = `curated-${perPage}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await fetch(`/api/v1/pexels/curated?per_page=${perPage}`);

      if (!response.ok) {
        throw new Error(`Pexels API error: ${response.status}`);
      }

      const data = await response.json();

      // Cache the result
      this.cache.set(cacheKey, data);

      return data;
    } catch (error) {
      console.warn('Failed to fetch curated photos:', error);
      return { photos: [] };
    }
  }

  /**
   * Get a random photo from a set of queries
   * Useful for diverse backgrounds
   * @param {Array<string>} queries - Array of search queries
   * @param {string} size - Photo size
   * @returns {Promise<string|null>} Photo URL or null
   */
  getRandomPhoto(queries, size = 'medium') {
    if (!queries || queries.length === 0) {
      return null;
    }

    const randomQuery = queries[Math.floor(Math.random() * queries.length)];
    return this.getPhotoForCategory(randomQuery, size);
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Create singleton instance
const pexelsClient = new PexelsClient();

// Export to window
if (typeof window !== 'undefined') {
  window.PexelsClient = PexelsClient;
  window.pexelsClient = pexelsClient;
}
