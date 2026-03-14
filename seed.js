const bcrypt = require('bcryptjs');
const logger = require('./utils/logger');
const dbUnified = require('./db-unified');
const { uid } = require('./store');
const { getPexelsService } = require('./utils/pexels-service');

/**
 * Helper function to get a photo from Pexels API
 * @param {string} query - Search query for Pexels
 * @param {string} size - Size variant to return (e.g., 'medium', 'large', 'small')
 * @param {string} fallback - Fallback URL if Pexels is not available
 * @returns {Promise<string>} Photo URL or fallback
 */
async function getPexelsPhoto(query, size = 'medium', fallback = '') {
  const pexels = getPexelsService();

  if (!pexels.isConfigured()) {
    return fallback;
  }

  try {
    const result = await pexels.searchPhotos(query, 1, 1);
    if (result.photos && result.photos.length > 0) {
      return result.photos[0].src[size] || fallback;
    }
    return fallback;
  } catch (error) {
    logger.warn(`Failed to fetch Pexels photo for "${query}":`, error.message);
    return fallback;
  }
}

// Seed the database with default records.
// MongoDB-first: Data goes to MongoDB when available, local storage as fallback.
//
// Options:
// - skipIfExists: Don't overwrite existing data (for production)
// - seedUsers: Include default users (admin, supplier, customer)
// - seedSuppliers: Include demo suppliers
// - seedPackages: Include demo packages
async function seed(options = {}) {
  const {
    skipIfExists = false,
    seedUsers = true,
    seedSuppliers = true,
    seedPackages = true,
    autoMigrateFromLocal = true, // New option to auto-migrate from local storage
  } = options;

  // AUTO-MIGRATION: If MongoDB is being used and local data exists, migrate it first
  if (autoMigrateFromLocal) {
    try {
      // Wait for database to be initialized
      await dbUnified.initializeDatabase();
      const dbType = dbUnified.getDatabaseType();

      if (dbType === 'mongodb') {
        // Check if MongoDB is empty and local storage has data
        const usersInMongo = await dbUnified.read('users');
        const packagesInMongo = await dbUnified.read('packages');
        const suppliersInMongo = await dbUnified.read('suppliers');

        const mongoIsEmpty =
          usersInMongo.length <= 1 && // Allow owner account
          packagesInMongo.length === 0 &&
          suppliersInMongo.length === 0;

        if (mongoIsEmpty) {
          // Try to read from local storage
          const store = require('./store');
          const localPackages = store.read('packages');
          const localSuppliers = store.read('suppliers');
          const localUsers = store.read('users');

          const hasLocalData =
            (Array.isArray(localPackages) && localPackages.length > 0) ||
            (Array.isArray(localSuppliers) && localSuppliers.length > 0) ||
            (Array.isArray(localUsers) && localUsers.length > 1); // More than just owner

          if (hasLocalData) {
            logger.info('');
            logger.info('🔄 Auto-migration: Detected local data, migrating to MongoDB...');
            const dbUtils = require('./db-utils');
            const migrationResults = await dbUtils.migrateFromJson(store);

            logger.info('✅ Auto-migration complete!');
            logger.info(`   Migrated: ${migrationResults.success.join(', ')}`);
            if (migrationResults.failed.length > 0) {
              logger.info(`   Failed: ${migrationResults.failed.join(', ')}`);
            }
            logger.info('');

            // Skip seeding since we just migrated real data
            return;
          }
        }
      }
    } catch (error) {
      logger.info('Auto-migration check skipped:', error.message);
      // Continue with normal seeding
    }
  }

  // Users (owner account, and optional demo users)
  if (seedUsers) {
    const existingUsers = await dbUnified.read('users');
    const now = new Date().toISOString();
    let usersModified = false;

    // Always ensure owner account exists (protected from deletion)
    const ownerEmail = process.env.OWNER_EMAIL || 'admin@event-flow.co.uk';
    // In production, OWNER_PASSWORD must be explicitly set — no default fallback.
    // In development, fall back to 'Admin123!' so the app starts without configuration.
    const isProduction = process.env.NODE_ENV === 'production';
    const ownerPassword = process.env.OWNER_PASSWORD || (isProduction ? null : 'Admin123!');
    if (!ownerPassword) {
      // In production, refuse to create the owner account with a default password.
      // This prevents accidentally deploying with a known weak credential.
      logger.error(
        '❌ CRITICAL: OWNER_PASSWORD is not set. Refusing to create owner account in production. ' +
          'Set the OWNER_PASSWORD environment variable to a strong, unique password.'
      );
    } else {
      const ownerExists = existingUsers.find(
        u => u.email.toLowerCase() === ownerEmail.toLowerCase()
      );
      if (!ownerExists) {
        const owner = {
          id: uid('usr'),
          name: 'EventFlow Owner',
          email: ownerEmail,
          role: 'admin',
          passwordHash: bcrypt.hashSync(ownerPassword, 10),
          createdAt: now,
          notify: true,
          notify_account: true, // Transactional emails enabled
          notify_marketing: false, // No marketing emails for owner
          marketingOptIn: false,
          verified: true, // Owner is always verified (skip email verification)
          isOwner: true, // Special flag to protect from deletion
        };
        existingUsers.push(owner);
        usersModified = true;
        logger.info(`✅ Created owner account: ${ownerEmail}`);
        if (!process.env.OWNER_PASSWORD) {
          // Dev-only fallback password is in use; warn so developers know to set it.
          logger.warn(
            '⚠️  Using dev-only default owner password. Set OWNER_PASSWORD before deploying to production.'
          );
        }
      } else {
        // Owner exists - ensure it has the correct flags
        const ownerIdx = existingUsers.findIndex(
          u => u.email.toLowerCase() === ownerEmail.toLowerCase()
        );
        if (!existingUsers[ownerIdx].isOwner || !existingUsers[ownerIdx].verified) {
          existingUsers[ownerIdx].isOwner = true;
          existingUsers[ownerIdx].verified = true;
          existingUsers[ownerIdx].role = 'admin';
          usersModified = true;
          logger.info(`✅ Updated owner account flags: ${ownerEmail}`);
        }
      }
    }

    // Create demo users only if skipIfExists is false (demo/dev mode).
    // Never create demo accounts with known passwords in production.
    if (!skipIfExists && process.env.NODE_ENV !== 'production') {
      // Check and create demo admin if it doesn't exist
      const demoAdminEmail = 'admin@eventflow.local';
      if (!existingUsers.find(u => u.email === demoAdminEmail)) {
        const admin = {
          id: uid('usr'),
          name: 'Admin',
          email: demoAdminEmail,
          role: 'admin',
          passwordHash: bcrypt.hashSync('Admin123!', 10),
          createdAt: now,
          notify: true,
          marketingOptIn: false,
          verified: true,
        };
        existingUsers.push(admin);
        usersModified = true;
        logger.info(`Created demo admin user: ${demoAdminEmail}`);
      }

      // Check and create demo supplier if it doesn't exist
      const demoSupplierEmail = 'supplier@eventflow.local';
      if (!existingUsers.find(u => u.email === demoSupplierEmail)) {
        const supplier = {
          id: uid('usr'),
          name: 'Supplier Demo',
          email: demoSupplierEmail,
          role: 'supplier',
          passwordHash: bcrypt.hashSync('Supplier123!', 10),
          createdAt: now,
          notify: true,
          marketingOptIn: false,
          verified: true,
        };
        existingUsers.push(supplier);
        usersModified = true;
        logger.info(`Created demo supplier user: ${demoSupplierEmail}`);
      }

      // Check and create demo customer if it doesn't exist
      const demoCustomerEmail = 'customer@eventflow.local';
      if (!existingUsers.find(u => u.email === demoCustomerEmail)) {
        const customer = {
          id: uid('usr'),
          name: 'Customer Demo',
          email: demoCustomerEmail,
          role: 'customer',
          passwordHash: bcrypt.hashSync('Customer123!', 10),
          createdAt: now,
          notify: true,
          marketingOptIn: false,
          verified: true,
        };
        existingUsers.push(customer);
        usersModified = true;
        logger.info(`Created demo customer user: ${demoCustomerEmail}`);
      }
    }

    // Only write if we made changes
    if (usersModified) {
      await dbUnified.write('users', existingUsers);
    }

    if (skipIfExists && existingUsers.length > 0) {
      logger.info(`User seed complete (production mode): ${existingUsers.length} users exist`);
    }
  }

  // Categories - 2x3 grid (6 visible cards)
  const existingCategories = await dbUnified.read('categories');
  if (!Array.isArray(existingCategories) || existingCategories.length === 0) {
    const categories = [
      {
        id: 'cat_venues',
        name: 'Venues',
        slug: 'venues',
        description:
          'Find the perfect space for your event, from grand ballrooms to intimate gardens',
        heroImage: '/assets/images/collage-venue.jpg',
        icon: '⛪',
        order: 1,
        visible: true,
      },
      {
        id: 'cat_catering',
        name: 'Catering',
        slug: 'catering',
        description: 'Delicious food and drink options to suit every taste and budget',
        heroImage: '/assets/images/collage-catering.jpg',
        icon: '🍽️',
        order: 2,
        visible: true,
      },
      {
        id: 'cat_entertainment',
        name: 'Entertainment',
        slug: 'entertainment',
        description: 'Live music, DJs, performers and entertainment to make your event memorable',
        heroImage: '/assets/images/collage-entertainment.jpg',
        icon: '🎵',
        order: 3,
        visible: true,
      },
      {
        id: 'cat_photography',
        name: 'Photography',
        slug: 'photography',
        description: 'Professional photographers to capture every special moment',
        heroImage: '/assets/images/collage-photography.jpg',
        icon: '📸',
        order: 4,
        visible: true,
      },
      {
        id: 'cat_videography',
        name: 'Videography',
        slug: 'videography',
        description: 'Capture your special moments with professional video production',
        heroImage: '',
        icon: '🎥',
        order: 5,
        visible: true,
      },
      {
        id: 'cat_decor',
        name: 'Decorations',
        slug: 'decorations',
        description: 'Transform your venue with beautiful decorations and styling',
        heroImage: '',
        icon: '🎨',
        order: 6,
        visible: true,
      },
      // Additional categories (hidden by default, can be enabled via admin)
      {
        id: 'cat_floristry',
        name: 'Floristry',
        slug: 'floristry',
        description: 'Stunning floral arrangements and bouquets for your event',
        heroImage: '',
        icon: '💐',
        order: 7,
        visible: false,
      },
      {
        id: 'cat_music_djs',
        name: 'Music & DJs',
        slug: 'music-djs',
        description: 'Professional DJs and music services to keep the party going',
        heroImage: '',
        icon: '🎧',
        order: 8,
        visible: false,
      },
      {
        id: 'cat_lighting',
        name: 'Lighting',
        slug: 'lighting',
        description: 'Create the perfect ambiance with professional lighting solutions',
        heroImage: '',
        icon: '💡',
        order: 9,
        visible: false,
      },
      {
        id: 'cat_transport',
        name: 'Transport',
        slug: 'transport',
        description: 'Luxury cars, coaches, and transportation services for your guests',
        heroImage: '',
        icon: '🚗',
        order: 10,
        visible: false,
      },
    ];
    await dbUnified.write('categories', categories);
    logger.info('Created categories for 2x3 grid (6 visible, 4 hidden)');
  }

  // Suppliers
  if (seedSuppliers) {
    const existingSuppliers = await dbUnified.read('suppliers');
    if (skipIfExists && existingSuppliers.length > 0) {
      logger.info(
        `Supplier seed skipped (production mode): ${existingSuppliers.length} suppliers exist`
      );
    } else if (!Array.isArray(existingSuppliers) || existingSuppliers.length === 0) {
      // Generate seed batch identifier for this seeding run (shared with packages)
      const seedBatch = `seed_${Date.now()}`;
      const now = new Date().toISOString();

      // Store batch ID for use in package seeding
      global.__SEED_BATCH__ = seedBatch;

      // Fetch Pexels photos if API key is available
      const barnLogo = await getPexelsPhoto(
        'barn logo wooden',
        'small',
        '/assets/images/placeholders/supplier-venue.svg'
      );
      const barnPhoto = await getPexelsPhoto(
        'rustic wedding barn venue',
        'large',
        '/assets/images/placeholders/package-event.svg'
      );
      const cateringLogo = await getPexelsPhoto(
        'catering food logo',
        'small',
        '/assets/images/placeholders/supplier-catering.svg'
      );
      const cateringPhoto = await getPexelsPhoto(
        'wedding catering buffet food',
        'large',
        '/assets/images/placeholders/package-event.svg'
      );
      const photoLogo = await getPexelsPhoto(
        'camera photography logo',
        'small',
        '/assets/images/placeholders/supplier-photography.svg'
      );
      const photoPhoto = await getPexelsPhoto(
        'wedding photography camera',
        'large',
        '/assets/images/placeholders/package-event.svg'
      );

      const defaults = [
        {
          id: 'sup_xmkgxc6kd04f',
          ownerUserId: null,
          name: 'The Willow Barn Venue',
          logo: barnLogo,
          blurb: 'Your perfect rustic wedding venue',
          category: 'Venues',
          location: 'Monmouthshire, South Wales',
          price_display: 'From £1,500',
          website: '',
          email: 'willowbarn@example.com',
          phone: '01234 567890',
          license: '',
          amenities: ['Parking', 'Garden'],
          maxGuests: 120,
          photos: [barnPhoto],
          description_short: 'Rustic countryside venue.',
          description_long: 'Converted barn with indoor/outdoor spaces.',
          approved: true,
          isTest: true,
          seedBatch,
          createdAt: now,
        },
        {
          id: 'sup_suj0sb6kd04f',
          ownerUserId: null,
          name: 'Green Oak Catering',
          logo: cateringLogo,
          blurb: 'Seasonal menus with local produce',
          category: 'Catering',
          location: 'Cardiff & South Wales',
          price_display: '££',
          website: '',
          email: 'greenoakcatering@example.com',
          phone: '01234 567891',
          license: '',
          amenities: ['Vegan options', 'Serving staff'],
          maxGuests: 500,
          photos: [cateringPhoto],
          description_short: 'Seasonal menus with local produce.',
          description_long: 'Buffets and formal dining. Vegan options.',
          approved: true,
          isTest: true,
          seedBatch,
          createdAt: now,
        },
        {
          id: 'sup_5n2run6kd04f',
          ownerUserId: null,
          name: 'Snapshot Photography',
          logo: photoLogo,
          blurb: 'Capturing your special moments',
          category: 'Photography',
          location: 'Bristol & South West',
          price_display: 'From £800',
          website: '',
          email: 'snapshotphoto@example.com',
          phone: '01234 567892',
          license: '',
          amenities: ['Online gallery'],
          maxGuests: 0,
          photos: [photoPhoto],
          description_short: 'Relaxed documentary style.',
          description_long: 'Full-day or hourly packages.',
          approved: true,
          isTest: true,
          seedBatch,
          createdAt: now,
        },
      ];
      await dbUnified.write('suppliers', defaults);
      logger.info('Created demo suppliers with test data flags');
    }
  }

  // Packages
  if (seedPackages) {
    const existingPackages = await dbUnified.read('packages');
    if (skipIfExists && existingPackages.length > 0) {
      logger.info('Packages already exist, skipping package seed');
    } else if (!Array.isArray(existingPackages) || existingPackages.length === 0) {
      // Use same seed batch from suppliers if available, or generate new one
      const seedBatch = global.__SEED_BATCH__ || `seed_${Date.now()}`;
      const now = new Date().toISOString();

      // Fetch Pexels photos if API key is available
      const barnVenueImg = await getPexelsPhoto(
        'rustic barn wedding venue interior',
        'large',
        '/assets/images/placeholders/package-event.svg'
      );
      const barnInteriorImg = await getPexelsPhoto(
        'barn interior wedding setup',
        'large',
        '/assets/images/placeholders/package-event.svg'
      );
      const cateringImg = await getPexelsPhoto(
        'wedding banquet catering food',
        'large',
        '/assets/images/placeholders/package-event.svg'
      );
      const photographyImg = await getPexelsPhoto(
        'professional camera wedding photography',
        'large',
        '/assets/images/placeholders/package-event.svg'
      );

      const defaults = [
        {
          id: 'pkg_pk1uq76kd04h',
          supplierId: 'sup_xmkgxc6kd04f',
          slug: 'barn-exclusive',
          title: 'Barn Exclusive',
          price: '£3,500',
          location: 'Monmouthshire, South Wales',
          description:
            'Full-day venue hire, ceremony & reception areas. Includes indoor and outdoor spaces, tables and chairs, parking for 50 cars.',
          image: barnVenueImg,
          gallery: [
            {
              url: barnVenueImg,
              approved: true,
              uploadedAt: Date.now(),
            },
            {
              url: barnInteriorImg,
              approved: true,
              uploadedAt: Date.now(),
            },
          ],
          categories: ['venues'],
          tags: ['rustic', 'barn', 'countryside', 'outdoor'],
          approved: true,
          featured: true,
          isFeatured: true,
          isTest: true,
          seedBatch,
          createdAt: now,
        },
        {
          id: 'pkg_3e3fdh6kd04h',
          supplierId: 'sup_suj0sb6kd04f',
          slug: 'seasonal-feast',
          title: 'Seasonal Feast',
          price: '£45 pp',
          location: 'Cardiff & South Wales',
          description:
            'Three-course seasonal menu with staff & setup. Includes locally sourced ingredients, vegan options available.',
          image: cateringImg,
          gallery: [
            {
              url: cateringImg,
              approved: true,
              uploadedAt: Date.now(),
            },
          ],
          categories: ['catering'],
          tags: ['seasonal', 'local', 'vegan-friendly'],
          approved: true,
          featured: false,
          isFeatured: false,
          isTest: true,
          seedBatch,
          createdAt: now,
        },
        {
          id: 'pkg_8b6fmw6kd04h',
          supplierId: 'sup_5n2run6kd04f',
          slug: 'full-day-capture',
          title: 'Full Day Capture',
          price: '£1,200',
          location: 'Bristol & South West',
          description:
            'Prep through first dance, private gallery. Includes all edited photos, online gallery access, and print rights.',
          image: photographyImg,
          gallery: [
            {
              url: photographyImg,
              approved: true,
              uploadedAt: Date.now(),
            },
          ],
          categories: ['photography'],
          tags: ['documentary', 'candid', 'full-day'],
          approved: true,
          featured: true,
          isFeatured: true,
          isTest: true,
          seedBatch,
          createdAt: now,
        },
      ];
      await dbUnified.write('packages', defaults);
      logger.info('Created demo packages with test data flags');
    }
  }

  // Always ensure these collections exist as arrays
  for (const name of [
    'categories',
    'plans',
    'notes',
    'messages',
    'threads',
    'events',
    'reviews',
    'reports',
    'audit_logs',
    'search_history',
    'photos',
    'badges',
  ]) {
    const items = await dbUnified.read(name);
    if (!Array.isArray(items) || items.length === 0) {
      await dbUnified.write(name, []);
    }
  }

  // Seed default badges
  await seedBadges();

  logger.info('Seed complete');
}

/**
 * Seed default badges
 */
async function seedBadges() {
  const existingBadges = await dbUnified.read('badges');

  if (existingBadges.length > 0) {
    logger.info(`Badge seed skipped: ${existingBadges.length} badges already exist`);
    return;
  }

  const now = new Date().toISOString();
  const defaultBadges = [
    {
      id: uid('bdg'),
      name: 'Founder',
      slug: 'founder',
      type: 'founder',
      description: 'Founding member of EventFlow',
      icon: '🌟',
      color: '#FFD700',
      autoAssign: false,
      autoAssignCriteria: null,
      displayOrder: 1,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('bdg'),
      name: 'Pro',
      slug: 'pro',
      type: 'pro',
      description: 'Professional tier member',
      icon: '💎',
      color: '#667eea',
      autoAssign: true,
      autoAssignCriteria: { isPro: true },
      displayOrder: 2,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('bdg'),
      name: 'Pro Plus',
      slug: 'pro-plus',
      type: 'pro-plus',
      description: 'Premium tier member',
      icon: '👑',
      color: '#764ba2',
      autoAssign: false,
      autoAssignCriteria: null,
      displayOrder: 3,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('bdg'),
      name: 'Verified',
      slug: 'verified',
      type: 'verified',
      description: 'Verified supplier',
      icon: '✓',
      color: '#13B6A2',
      autoAssign: false,
      autoAssignCriteria: null,
      displayOrder: 4,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('bdg'),
      name: 'Featured',
      slug: 'featured',
      type: 'featured',
      description: 'Featured on EventFlow',
      icon: '⭐',
      color: '#F59E0B',
      autoAssign: false,
      autoAssignCriteria: null,
      displayOrder: 5,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  await dbUnified.write('badges', defaultBadges);
  logger.info(`Seeded ${defaultBadges.length} default badges`);
}

module.exports = { seed };
