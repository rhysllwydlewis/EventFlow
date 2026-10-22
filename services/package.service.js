/**
 * Package Service
 * Handles package CRUD operations and business logic
 */

'use strict';

const { NotFoundError, AuthorizationError, ValidationError } = require('../errors');
const logger = require('../utils/logger');
const { paginationHelper } = require('../utils/database');
const { priceFields } = require('../utils/packagePrice');

class PackageService {
  constructor(dbUnified, uid) {
    this.db = dbUnified;
    this.uid = uid;
  }

  /**
   * Create a new package
   * @param {Object} data - Package data
   * @param {string} userId - User ID creating the package
   * @param {string} userRole - User role
   * @returns {Promise<Object>} - Created package
   */
  async createPackage(data, userId, userRole) {
    // Validate required fields
    if (!data.name) {
      throw new ValidationError('Package name is required');
    }
    if (!data.price) {
      throw new ValidationError('Package price is required');
    }

    // Get supplier ID
    let supplierId = data.supplierId;

    // If user is a supplier, find their supplier profile
    if (userRole === 'supplier') {
      const suppliers = await this.db.read('suppliers');
      const supplierProfile = suppliers.find(s => s.ownerUserId === userId);
      if (!supplierProfile) {
        throw new ValidationError('Supplier profile not found');
      }
      supplierId = supplierProfile.id;
    }

    if (!supplierId) {
      throw new ValidationError('Supplier ID is required');
    }

    // Create package
    const packageData = {
      id: this.uid('pkg'),
      name: String(data.name).trim(),
      description: data.description ? String(data.description).trim() : '',
      ...priceFields(data.price),
      category: data.category || 'other',
      supplierId,
      images: data.images || [],
      features: data.features || [],
      available: data.available !== false,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const packages = await this.db.read('packages');
    packages.push(packageData);
    await this.db.insertOne('packages', packageData);

    logger.info(`Package created: ${packageData.id} by user ${userId}`);

    return packageData;
  }

  /**
   * Get package by ID
   * @param {string} id - Package ID
   * @returns {Promise<Object>} - Package data
   */
  async getPackageById(id) {
    const packages = await this.db.read('packages');
    const pkg = packages.find(p => p.id === id);

    if (!pkg) {
      throw new NotFoundError('Package not found');
    }

    // Get supplier info
    const suppliers = await this.db.read('suppliers');
    const supplier = suppliers.find(s => s.id === pkg.supplierId);

    // Get reviews
    const reviews = await this.db.read('reviews');
    const packageReviews = reviews.filter(r => r.packageId === id);

    return {
      ...pkg,
      supplier: supplier || null,
      reviews: packageReviews,
      reviewCount: packageReviews.length,
      averageRating:
        packageReviews.length > 0
          ? packageReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / packageReviews.length
          : 0,
    };
  }

  /**
   * Update package
   * @param {string} id - Package ID
   * @param {Object} updates - Package updates
   * @param {string} userId - User ID making the update
   * @param {string} userRole - User role
   * @returns {Promise<Object>} - Updated package
   */
  async updatePackage(id, updates, userId, userRole) {
    const pkg = await this.db.findOne('packages', { id });

    if (!pkg) {
      throw new NotFoundError('Package not found');
    }

    // Authorization check
    if (userRole !== 'admin') {
      // Get supplier ID for this user
      const supplier = await this.db.findOne('suppliers', { ownerUserId: userId });

      if (!supplier || pkg.supplierId !== supplier.id) {
        throw new AuthorizationError('You do not have permission to update this package');
      }
    }

    // Apply updates
    const allowedFields = [
      'name',
      'description',
      'price',
      'category',
      'images',
      'features',
      'available',
    ];
    const setFields = { updatedAt: new Date().toISOString() };
    allowedFields.forEach(field => {
      if (updates[field] === undefined) {
        return;
      }
      if (field === 'price') {
        // Both price fields hold the one price (utils/packagePrice).
        Object.assign(setFields, priceFields(updates.price));
      } else {
        setFields[field] = updates[field];
      }
    });

    await this.db.updateOne('packages', { id }, { $set: setFields });

    logger.info(`Package updated: ${id} by user ${userId}`);

    return { ...pkg, ...setFields };
  }

  /**
   * Delete package
   * @param {string} id - Package ID
   * @param {string} userId - User ID deleting the package
   * @param {string} userRole - User role
   * @returns {Promise<void>}
   */
  async deletePackage(id, userId, userRole) {
    const pkg = await this.db.findOne('packages', { id });

    if (!pkg) {
      throw new NotFoundError('Package not found');
    }

    // Authorization check
    if (userRole !== 'admin') {
      const supplier = await this.db.findOne('suppliers', { ownerUserId: userId });

      if (!supplier || pkg.supplierId !== supplier.id) {
        throw new AuthorizationError('You do not have permission to delete this package');
      }
    }

    // Remove package
    await this.db.deleteOne('packages', id);

    logger.info(`Package deleted: ${id} by user ${userId}`);
  }

  /**
   * Search packages with filters
   * @param {Object} filters - Search filters
   * @returns {Promise<Object>} - Search results
   */
  async searchPackages(filters = {}) {
    let packages = await this.db.read('packages');

    // Apply filters
    if (filters.name) {
      const searchTerm = filters.name.toLowerCase();
      packages = packages.filter(
        p =>
          p.name.toLowerCase().includes(searchTerm) ||
          (p.description && p.description.toLowerCase().includes(searchTerm))
      );
    }

    if (filters.category) {
      packages = packages.filter(p => p.category === filters.category);
    }

    if (filters.supplierId) {
      packages = packages.filter(p => p.supplierId === filters.supplierId);
    }

    if (filters.priceMin !== undefined) {
      packages = packages.filter(p => p.price >= parseFloat(filters.priceMin));
    }

    if (filters.priceMax !== undefined) {
      packages = packages.filter(p => p.price <= parseFloat(filters.priceMax));
    }

    if (filters.available !== undefined) {
      packages = packages.filter(p => p.available === filters.available);
    }

    // Sort
    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
    packages.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal < bVal) {
        return -sortOrder;
      }
      if (aVal > bVal) {
        return sortOrder;
      }
      return 0;
    });

    // Pagination
    const { skip, limit, page } = paginationHelper(filters.page, filters.limit);
    const total = packages.length;
    const paginatedPackages = packages.slice(skip, skip + limit);

    return {
      packages: paginatedPackages,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    };
  }

  /**
   * Get packages by supplier ID
   * @param {string} supplierId - Supplier ID
   * @returns {Promise<Array>} - Supplier packages
   */
  async getPackagesBySupplier(supplierId) {
    const packages = await this.db.read('packages');
    return packages.filter(p => p.supplierId === supplierId);
  }

  /**
   * Get featured/popular packages
   * @param {number} limit - Number of packages to return
   * @returns {Promise<Array>} - Featured packages
   */
  async getFeaturedPackages(limit = 10) {
    let packages = await this.db.read('packages');

    // Filter available packages
    packages = packages.filter(p => p.available);

    // Get reviews for rating calculation
    const reviews = await this.db.read('reviews');

    // Add rating to each package
    packages = packages.map(pkg => {
      const packageReviews = reviews.filter(r => r.packageId === pkg.id);
      const averageRating =
        packageReviews.length > 0
          ? packageReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / packageReviews.length
          : 0;

      return {
        ...pkg,
        reviewCount: packageReviews.length,
        averageRating,
      };
    });

    // Sort by rating and review count
    packages.sort((a, b) => {
      if (a.averageRating !== b.averageRating) {
        return b.averageRating - a.averageRating;
      }
      return b.reviewCount - a.reviewCount;
    });

    return packages.slice(0, limit);
  }
}

module.exports = PackageService;
