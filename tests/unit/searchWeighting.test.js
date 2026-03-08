/**
 * Unit tests for search weighting and relevance scoring
 */

'use strict';

const {
  calculateRelevanceScore,
  calculateQualityScore,
  calculateProfileCompleteness,
  getMatchingSnippets,
  getMatchingFields,
  FIELD_WEIGHTS,
  BOOSTS,
} = require('../../utils/searchWeighting');

describe('Search Weighting Utilities', () => {
  describe('calculateRelevanceScore', () => {
    it('should return quality score when no query provided', () => {
      const item = {
        name: 'Test Supplier',
        averageRating: 4.5,
        reviewCount: 20,
        viewCount: 100,
      };

      const score = calculateRelevanceScore(item, '');
      expect(score).toBeGreaterThan(0);
    });

    it('should calculate higher score for better field matches', () => {
      const nameMatchItem = {
        name: 'Wedding Photography',
        description_short: 'Professional services',
        category: 'Photography',
      };

      const descOnlyItem = {
        name: 'Photo Services',
        description_short: 'Wedding photography services',
        category: 'Photography',
      };

      const nameScore = calculateRelevanceScore(nameMatchItem, 'wedding');
      const descScore = calculateRelevanceScore(descOnlyItem, 'wedding');

      // Name match should score higher than description-only match
      expect(nameScore).toBeGreaterThan(descScore);
    });

    it('should apply featured boost correctly', () => {
      const regularItem = {
        name: 'Test Supplier',
        featured: false,
      };

      const featuredItem = {
        name: 'Test Supplier',
        featured: true,
      };

      const regularScore = calculateRelevanceScore(regularItem, 'Test');
      const featuredScore = calculateRelevanceScore(featuredItem, 'Test');

      expect(featuredScore).toBeGreaterThan(regularScore);
      expect(featuredScore / regularScore).toBeCloseTo(BOOSTS.featured, 1);
    });

    it('should apply high rating boost for 4.5+ ratings', () => {
      const lowRatingItem = {
        name: 'Test Supplier',
        averageRating: 3.5,
      };

      const highRatingItem = {
        name: 'Test Supplier',
        averageRating: 4.8,
      };

      const lowScore = calculateRelevanceScore(lowRatingItem, 'Test');
      const highScore = calculateRelevanceScore(highRatingItem, 'Test');

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should apply verified boost correctly', () => {
      const unverifiedItem = {
        name: 'Test Supplier',
        verified: false,
      };

      const verifiedItem = {
        name: 'Test Supplier',
        verified: true,
      };

      const unverifiedScore = calculateRelevanceScore(unverifiedItem, 'Test');
      const verifiedScore = calculateRelevanceScore(verifiedItem, 'Test');

      expect(verifiedScore).toBeGreaterThan(unverifiedScore);
    });

    it('should score tag matches', () => {
      const itemWithTags = {
        name: 'Test Supplier',
        tags: ['wedding', 'photography', 'professional'],
      };

      const itemWithoutTags = {
        name: 'Test Supplier',
        tags: [],
      };

      const withTagsScore = calculateRelevanceScore(itemWithTags, 'wedding');
      const withoutTagsScore = calculateRelevanceScore(itemWithoutTags, 'wedding');

      expect(withTagsScore).toBeGreaterThan(withoutTagsScore);
    });

    it('should apply category filter bonus', () => {
      const item = {
        name: 'Test Supplier',
        category: 'Photography',
      };

      const filters = { category: 'Photography' };
      const withBonus = calculateRelevanceScore(item, 'Test', filters);
      const withoutBonus = calculateRelevanceScore(item, 'Test', {});

      expect(withBonus).toBeGreaterThan(withoutBonus);
    });

    it('should apply amenities filter bonus', () => {
      const item = {
        name: 'Test Supplier',
        amenities: ['WiFi', 'Parking', 'Catering'],
      };

      const filters = { amenities: ['WiFi', 'Parking'] };
      const withBonus = calculateRelevanceScore(item, 'Test', filters);
      const withoutBonus = calculateRelevanceScore(item, 'Test', {});

      expect(withBonus).toBeGreaterThan(withoutBonus);
    });

    it('should handle items without optional fields', () => {
      const minimalItem = {
        name: 'Test',
      };

      expect(() => {
        calculateRelevanceScore(minimalItem, 'Test');
      }).not.toThrow();

      const score = calculateRelevanceScore(minimalItem, 'Test');
      expect(score).toBeGreaterThan(0);
    });

    it('should return rounded scores to 2 decimal places', () => {
      const item = {
        name: 'Test Supplier',
        averageRating: 4.7,
      };

      const score = calculateRelevanceScore(item, 'Test');
      const decimalPlaces = (score.toString().split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });

  describe('calculateQualityScore', () => {
    it('should score based on rating', () => {
      const highRatingItem = { averageRating: 5.0 };
      const lowRatingItem = { averageRating: 2.0 };

      const highScore = calculateQualityScore(highRatingItem);
      const lowScore = calculateQualityScore(lowRatingItem);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should score based on review count', () => {
      const manyReviews = { reviewCount: 100 };
      const fewReviews = { reviewCount: 5 };

      const highScore = calculateQualityScore(manyReviews);
      const lowScore = calculateQualityScore(fewReviews);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should score based on view count', () => {
      const manyViews = { viewCount: 1000 };
      const fewViews = { viewCount: 10 };

      const highScore = calculateQualityScore(manyViews);
      const lowScore = calculateQualityScore(fewViews);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should handle items with no metrics', () => {
      const emptyItem = {};
      const score = calculateQualityScore(emptyItem);

      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('should give higher score to a supplier with a complete profile', () => {
      const complete = {
        averageRating: 4.0,
        reviewCount: 10,
        logo: 'https://example.com/logo.png',
        description_short: 'A wonderful supplier for your events',
        description_long:
          'We have been providing exceptional event services for over a decade, with hundreds of happy clients.',
        amenities: ['WiFi', 'Parking'],
        images: ['img1.jpg', 'img2.jpg'],
        tags: ['wedding', 'events'],
      };

      const sparse = {
        averageRating: 4.0,
        reviewCount: 10,
        // no logo, description, amenities, images, tags
      };

      const completeScore = calculateQualityScore(complete);
      const sparseScore = calculateQualityScore(sparse);

      expect(completeScore).toBeGreaterThan(sparseScore);
    });
  });

  describe('getMatchingSnippets', () => {
    it('should extract snippets around matching text', () => {
      const text =
        'This is a long description about wedding photography services in London. We offer professional wedding photography for all occasions.';
      const query = 'wedding';

      const snippets = getMatchingSnippets(text, query, 40);

      expect(snippets.length).toBeGreaterThan(0);
      expect(snippets[0].toLowerCase()).toContain('wedding');
    });

    it('should limit number of snippets to 3', () => {
      const text =
        'wedding wedding wedding wedding wedding wedding wedding wedding wedding wedding';
      const query = 'wedding';

      const snippets = getMatchingSnippets(text, query, 20);

      expect(snippets.length).toBeLessThanOrEqual(3);
    });

    it('should add ellipsis when text is truncated', () => {
      const text =
        'This is a very long description that contains the word photography somewhere in the middle of a long sentence.';
      const query = 'photography';

      const snippets = getMatchingSnippets(text, query, 30);

      expect(snippets[0]).toMatch(/\.\.\./);
    });

    it('should return empty array for no matches', () => {
      const text = 'This text does not contain the search term';
      const query = 'wedding';

      const snippets = getMatchingSnippets(text, query);

      expect(snippets).toEqual([]);
    });

    it('should return empty array for empty inputs', () => {
      expect(getMatchingSnippets('', 'query')).toEqual([]);
      expect(getMatchingSnippets('text', '')).toEqual([]);
      expect(getMatchingSnippets(null, 'query')).toEqual([]);
    });
  });

  describe('getMatchingFields', () => {
    it('should identify fields that match the query', () => {
      const item = {
        name: 'Wedding Photography',
        description_short: 'Professional wedding photos',
        category: 'Photography',
        tags: ['wedding', 'events'],
      };

      const fields = getMatchingFields(item, 'wedding');

      expect(fields).toContain('name');
      expect(fields).toContain('description');
      expect(fields).toContain('tags');
    });

    it('should return empty array when no fields match', () => {
      const item = {
        name: 'Test',
        description_short: 'Test description',
      };

      const fields = getMatchingFields(item, 'nomatch');

      expect(fields).toEqual([]);
    });

    it('should not duplicate field names', () => {
      const item = {
        description_short: 'wedding services',
        description_long: 'wedding photography and wedding videos',
      };

      const fields = getMatchingFields(item, 'wedding');

      const uniqueFields = [...new Set(fields)];
      expect(fields.length).toBe(uniqueFields.length);
    });

    it('should handle items with missing fields', () => {
      const item = {
        name: 'Test',
      };

      expect(() => {
        getMatchingFields(item, 'test');
      }).not.toThrow();
    });

    it('should return empty array for empty query', () => {
      const item = {
        name: 'Test',
        description_short: 'Description',
      };

      const fields = getMatchingFields(item, '');

      expect(fields).toEqual([]);
    });

    it('should match in amenities array', () => {
      const item = {
        name: 'Venue',
        amenities: ['WiFi', 'Parking', 'Catering'],
      };

      const fields = getMatchingFields(item, 'parking');

      expect(fields).toContain('amenities');
    });
  });

  describe('Field Weights', () => {
    it('should define weights for all searchable fields', () => {
      expect(FIELD_WEIGHTS.supplierName).toBeDefined();
      expect(FIELD_WEIGHTS.packageTitle).toBeDefined();
      expect(FIELD_WEIGHTS.description).toBeDefined();
      expect(FIELD_WEIGHTS.tags).toBeDefined();
      expect(FIELD_WEIGHTS.category).toBeDefined();
      expect(FIELD_WEIGHTS.amenities).toBeDefined();
    });

    it('should have supplierName as highest weight', () => {
      const weights = Object.values(FIELD_WEIGHTS);
      const maxWeight = Math.max(...weights);

      expect(FIELD_WEIGHTS.supplierName).toBe(maxWeight);
    });
  });

  describe('Boost Factors', () => {
    it('should define all boost factors', () => {
      expect(BOOSTS.featured).toBeDefined();
      expect(BOOSTS.newSupplier).toBeDefined();
      expect(BOOSTS.highRating).toBeDefined();
      expect(BOOSTS.verifiedSupplier).toBeDefined();
      expect(BOOSTS.activeSubscription).toBeDefined();
    });

    it('should have boosts greater than 1', () => {
      Object.values(BOOSTS).forEach(boost => {
        expect(boost).toBeGreaterThan(1);
      });
    });
  });

  describe('calculateProfileCompleteness', () => {
    it('should return 0 for an empty item', () => {
      expect(calculateProfileCompleteness({})).toBe(0);
    });

    it('should award points for logo presence', () => {
      const withLogo = { logo: 'https://example.com/logo.png' };
      const withoutLogo = {};
      expect(calculateProfileCompleteness(withLogo)).toBeGreaterThan(
        calculateProfileCompleteness(withoutLogo)
      );
    });

    it('should award points for a non-trivial short description', () => {
      const long = { description_short: 'We are a professional wedding photography studio.' };
      const trivial = { description_short: 'Hi' }; // < 20 chars, no bonus
      expect(calculateProfileCompleteness(long)).toBeGreaterThan(
        calculateProfileCompleteness(trivial)
      );
    });

    it('should award points for a non-trivial long description', () => {
      const long = {
        description_long:
          'We have been providing exceptional event services for over a decade, with hundreds of happy clients.',
      };
      const trivial = { description_long: 'Short.' }; // < 50 chars, no bonus
      expect(calculateProfileCompleteness(long)).toBeGreaterThan(
        calculateProfileCompleteness(trivial)
      );
    });

    it('should award points for amenities', () => {
      const withAmenities = { amenities: ['WiFi', 'Parking'] };
      const withoutAmenities = { amenities: [] };
      expect(calculateProfileCompleteness(withAmenities)).toBeGreaterThan(
        calculateProfileCompleteness(withoutAmenities)
      );
    });

    it('should award points for gallery images', () => {
      const withImages = { images: ['img1.jpg', 'img2.jpg'] };
      const withoutImages = {};
      expect(calculateProfileCompleteness(withImages)).toBeGreaterThan(
        calculateProfileCompleteness(withoutImages)
      );
    });

    it('should award points for tags', () => {
      const withTags = { tags: ['wedding', 'photography'] };
      const withoutTags = {};
      expect(calculateProfileCompleteness(withTags)).toBeGreaterThan(
        calculateProfileCompleteness(withoutTags)
      );
    });

    it('should return maximum 15 points for a fully complete profile', () => {
      const full = {
        logo: 'https://example.com/logo.png',
        description_short: 'A wonderful supplier for your events',
        description_long: 'We have been providing exceptional event services for over a decade.',
        amenities: ['WiFi', 'Parking'],
        images: ['img1.jpg'],
        tags: ['wedding'],
      };
      expect(calculateProfileCompleteness(full)).toBe(15);
    });
  });
});
