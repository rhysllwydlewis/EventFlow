/**
 * Seed Founding Suppliers Script
 * Creates 25-30 realistic founding supplier profiles with full data
 * to fix empty marketplace perception
 * Now enhanced with Pexels API integration for profile photos
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('./logger');
const { uid } = require('../store');
const { getPexelsService } = require('./pexels-service');

// Founding supplier data template
// Note: Photos arrays are intentionally empty - real suppliers upload their own photos
// For demo suppliers with Pexels integration, see seed.js which uses getPexelsPhoto()
const SUPPLIER_DATA = {
  Venues: [
    {
      name: 'The Grand Manor Estate',
      location: 'London',
      blurb: 'Elegant Georgian manor with stunning gardens and grand ballroom',
      description_short: 'Historic manor house perfect for elegant celebrations',
      description_long:
        'Set in 50 acres of pristine gardens, The Grand Manor Estate offers a perfect blend of historic charm and modern luxury. Our Grade II listed Georgian manor features a grand ballroom, intimate drawing rooms, and beautifully manicured gardens ideal for outdoor ceremonies.',
      price_display: 'From £4,500',
      maxGuests: 150,
      amenities: ['Parking', 'Garden', 'Accommodation', 'Licensed', 'Catering'],
      photos: [],
    },
    {
      name: 'Riverside Pavilion',
      location: 'Manchester',
      blurb: 'Contemporary waterside venue with floor-to-ceiling windows',
      description_short: 'Modern riverside venue with stunning city views',
      description_long:
        'Experience breathtaking views of the Manchester skyline from our contemporary glass pavilion. Perfect for modern celebrations, our venue features floor-to-ceiling windows, a riverside terrace, and state-of-the-art facilities.',
      price_display: 'From £3,200',
      maxGuests: 120,
      amenities: ['Parking', 'City Views', 'Licensed', 'AV Equipment', 'Accessible'],
      photos: [],
    },
    {
      name: 'The Castle Keep',
      location: 'Edinburgh',
      blurb: 'Historic castle venue with panoramic Scottish views',
      description_short: 'Medieval castle with authentic period features',
      description_long:
        'Step back in time at The Castle Keep, a beautifully restored 14th-century castle offering authentic medieval charm combined with modern comforts. Spectacular views across the Scottish countryside, grand halls, and intimate chambers.',
      price_display: 'From £5,000',
      maxGuests: 100,
      amenities: ['Parking', 'Historic Setting', 'Accommodation', 'Licensed', 'Exclusive Use'],
      photos: [],
    },
    {
      name: 'Botanical Glasshouse',
      location: 'Birmingham',
      blurb: 'Unique glasshouse venue surrounded by exotic plants',
      description_short: 'Glass conservatory in botanical gardens',
      description_long:
        'Our stunning Victorian glasshouse is nestled within award-winning botanical gardens. Natural light floods through historic glass panels, surrounded by lush tropical plants. A truly unique and Instagram-worthy venue.',
      price_display: 'From £2,800',
      maxGuests: 80,
      amenities: ['Garden', 'Natural Light', 'Licensed', 'Catering', 'Unique Setting'],
      photos: [],
    },
  ],
  Photography: [
    {
      name: 'Emma Clarke Photography',
      location: 'London',
      blurb: 'Award-winning wedding photographer specializing in natural, candid moments',
      description_short: 'Natural light and documentary style wedding photography',
      description_long:
        'With over 10 years experience capturing love stories across the UK and Europe, I specialize in natural, unposed photography that tells your unique story. My approach is relaxed and fun, ensuring you feel comfortable while I capture the genuine emotions and candid moments of your special day.',
      price_display: 'From £1,800',
      maxGuests: null,
      amenities: ['Full Day Coverage', 'Engagement Shoot', 'Online Gallery', 'Print Rights'],
      photos: [],
    },
    {
      name: 'James Wilson Photography',
      location: 'Manchester',
      blurb: 'Creative photographer with a cinematic, editorial style',
      description_short: 'Cinematic wedding and portrait photography',
      description_long:
        'I bring a cinematic, fashion-forward approach to wedding photography. Inspired by film and editorial photography, my work is dramatic, romantic, and timeless. Every wedding is unique, and I work closely with couples to understand their vision and create stunning images they will treasure forever.',
      price_display: 'From £2,200',
      maxGuests: null,
      amenities: ['8 Hour Coverage', 'Second Shooter', 'USB & Online Gallery', 'Pre-Wedding Shoot'],
      photos: [],
    },
    {
      name: 'Sarah Mitchell Photo & Film',
      location: 'Bristol',
      blurb: 'Photography and videography packages for complete coverage',
      description_short: 'Professional photo and video wedding packages',
      description_long:
        'Why choose between photography and videography? We offer combined packages that capture your day from every angle. Our team works seamlessly together to document every moment, from getting ready to the last dance, in beautiful photos and cinematic film.',
      price_display: 'From £2,800',
      maxGuests: null,
      amenities: [
        'Photo + Video',
        'Drone Footage',
        'Highlight Film',
        'Full Day Coverage',
        'Online Galleries',
      ],
      photos: [],
    },
  ],
  Catering: [
    {
      name: 'The Artisan Kitchen',
      location: 'London',
      blurb: 'Farm-to-table catering with seasonal, locally-sourced ingredients',
      description_short: 'Sustainable catering with a focus on local produce',
      description_long:
        'We believe great food starts with great ingredients. Our menus celebrate the best of British seasonal produce, sourced from local farms and suppliers. From elegant canapés to stunning three-course meals, we create bespoke menus that reflect your taste and values.',
      price_display: 'From £65 per head',
      maxGuests: 200,
      amenities: ['Dietary Requirements', 'Tastings', 'Wait Staff', 'Bar Service', 'Sustainable'],
      photos: [],
    },
    {
      name: 'Spice Route Catering',
      location: 'Birmingham',
      blurb: 'Authentic Indian and fusion cuisine for modern celebrations',
      description_short: 'Contemporary Indian wedding catering',
      description_long:
        'Bringing the vibrant flavors of India to your celebration. Our award-winning chefs create contemporary menus that honor traditional recipes while embracing modern presentation. From intimate gatherings to grand celebrations, we deliver exceptional food and service.',
      price_display: 'From £45 per head',
      maxGuests: 500,
      amenities: [
        'Live Cooking Stations',
        'Vegetarian & Vegan',
        'Halal Options',
        'Buffet & Plated',
        'Cultural Menus',
      ],
      photos: [],
    },
    {
      name: 'Coastal Seafood Co.',
      location: 'Brighton',
      blurb: 'Fresh seafood and Mediterranean-inspired wedding menus',
      description_short: 'Seafood specialists for coastal celebrations',
      description_long:
        'Located in Brighton, we specialize in the freshest seafood and Mediterranean cuisine. Our menus feature daily catches from local fishermen, paired with seasonal vegetables and homemade pasta. Perfect for seaside celebrations and food lovers.',
      price_display: 'From £70 per head',
      maxGuests: 150,
      amenities: ['Fresh Seafood', 'Wine Pairing', 'Tastings', 'Outdoor BBQ', 'Wait Staff'],
      photos: [],
    },
  ],
  Entertainment: [
    {
      name: 'The Groove Collective',
      location: 'Manchester',
      blurb: '7-piece soul and funk band bringing energy to every celebration',
      description_short: 'Live soul, funk, and Motown band',
      description_long:
        'Get ready to dance! The Groove Collective is a high-energy 7-piece band featuring three powerhouse vocalists, horn section, and killer rhythm section. We specialize in classic soul, funk, and Motown, with modern hits reimagined in our signature style. Guaranteed to fill the dance floor!',
      price_display: 'From £2,500',
      maxGuests: null,
      amenities: ['PA System', 'Lighting', 'DJ Between Sets', 'First Dance', 'Song Requests'],
      photos: [],
    },
    {
      name: 'DJ Marcus Cole',
      location: 'London',
      blurb: 'Professional DJ with 15 years experience across all genres',
      description_short: 'Versatile DJ for weddings and corporate events',
      description_long:
        "I'm a professional DJ specializing in weddings and corporate events. With a music library spanning every decade and genre, I read the room and keep everyone dancing all night. Premium sound system, elegant setup, and a stress-free approach to music planning.",
      price_display: 'From £800',
      maxGuests: null,
      amenities: [
        'Premium Sound System',
        'Lighting',
        'Music Planning',
        'Ceremony Sound',
        'Wireless Mics',
      ],
      photos: [],
    },
    {
      name: 'String Quartet Elegance',
      location: 'Edinburgh',
      blurb: 'Classical string quartet for ceremonies and cocktail hours',
      description_short: 'Professional string quartet for elegant events',
      description_long:
        'Add sophistication to your ceremony and reception with live classical music. Our professional string quartet performs everything from traditional classical pieces to beautiful arrangements of modern love songs. Perfect for ceremonies, drinks receptions, and elegant dinners.',
      price_display: 'From £600',
      maxGuests: null,
      amenities: ['Classical Repertoire', 'Modern Arrangements', 'Ceremony Music', '2-3 Hours'],
      photos: [],
    },
  ],
  'Decor & Styling': [
    {
      name: 'Bloom & Co Floristry',
      location: 'Cardiff',
      blurb: 'Stunning floral designs and event styling for modern celebrations',
      description_short: 'Luxury floral design and wedding styling',
      description_long:
        'We create bespoke floral designs that transform spaces and bring your vision to life. From romantic garden-inspired arrangements to bold contemporary designs, every piece is crafted with passion and attention to detail. Full event styling services available.',
      price_display: 'From £1,200',
      maxGuests: null,
      amenities: [
        'Bespoke Designs',
        'Bridal Bouquets',
        'Ceremony Flowers',
        'Centerpieces',
        'Setup & Breakdown',
      ],
      photos: [],
    },
    {
      name: 'Luna Event Styling',
      location: 'London',
      blurb: 'Full-service event styling and decor hire',
      description_short: 'Complete event styling and decor packages',
      description_long:
        'Transform your venue with our full-service styling. We offer complete decor packages including table settings, lighting, backdrops, signage, and styling accessories. Our team handles everything from initial concept to setup and breakdown, ensuring your vision comes to life flawlessly.',
      price_display: 'From £2,000',
      maxGuests: 200,
      amenities: ['Full Styling', 'Prop Hire', 'Lighting', 'Table Settings', 'Setup Team'],
      photos: [],
    },
  ],
  'Event Planning': [
    {
      name: 'Perfect Day Planning',
      location: 'London',
      blurb: 'Full-service wedding planning from concept to completion',
      description_short: 'Experienced wedding planners for stress-free celebrations',
      description_long:
        'Let us handle the details while you enjoy the journey to your big day. With over 12 years experience, we offer full-service planning, partial coordination, and day-of management. Our calm, organized approach ensures every detail is perfect and you can relax and savor every moment.',
      price_display: 'From £3,500',
      maxGuests: null,
      amenities: [
        'Full Planning',
        'Vendor Management',
        'Timeline Creation',
        'Budget Tracking',
        'Day Coordination',
      ],
      photos: [],
    },
    {
      name: 'Northern Events Ltd',
      location: 'Leeds',
      blurb: 'Corporate and private event planning specialists',
      description_short: 'Professional event planning for all occasions',
      description_long:
        'From intimate gatherings to large corporate events, we bring professionalism, creativity, and attention to detail to every project. Our experienced team manages logistics, vendors, and timelines, ensuring seamless execution of your event.',
      price_display: 'From £2,000',
      maxGuests: null,
      amenities: [
        'Event Management',
        'Vendor Sourcing',
        'Budget Planning',
        'Day-of Coordination',
        'Corporate Events',
      ],
      photos: [],
    },
  ],
};

/**
 * Generate sample reviews for suppliers
 */
function generateReviews(supplierId, count = 3) {
  const reviewTemplates = [
    {
      rating: 5,
      text: 'Absolutely fantastic service from start to finish. Highly professional and delivered exactly what we wanted. Would recommend to anyone!',
      author: 'Sarah M.',
    },
    {
      rating: 5,
      text: "We couldn't have asked for better. Everything was perfect and exceeded our expectations. Thank you so much!",
      author: 'James & Emily',
    },
    {
      rating: 5,
      text: 'Outstanding quality and incredible attention to detail. Made our special day truly memorable.',
      author: 'Rachel T.',
    },
    {
      rating: 4,
      text: 'Really happy with the service provided. Professional, friendly, and great value for money.',
      author: 'Michael & Lisa',
    },
    {
      rating: 5,
      text: 'Exceptional service! They went above and beyond to make sure everything was perfect. Thank you!',
      author: 'David & Sophie',
    },
  ];

  return reviewTemplates.slice(0, count).map((template, index) => ({
    id: uid('rev'),
    supplierId,
    userId: uid('usr'),
    rating: template.rating,
    text: template.text,
    authorName: template.author,
    createdAt: new Date(Date.now() - (count - index) * 30 * 24 * 60 * 60 * 1000).toISOString(),
    approved: true,
  }));
}

/**
 * Generate sample packages for suppliers
 */
function generatePackages(supplierId, supplierName, category, location) {
  const packageTemplates = {
    Venues: [
      {
        title: 'Full Day Wedding Package',
        description:
          'Complete venue hire from 10am-midnight including ceremony space, reception area, and exclusive use of grounds',
        price: '£4,500',
      },
      {
        title: 'Evening Reception Package',
        description:
          'Evening venue hire from 6pm-midnight, perfect for those having ceremony elsewhere',
        price: '£2,200',
      },
    ],
    Photography: [
      {
        title: 'Full Day Coverage',
        description:
          '10 hours coverage, online gallery, print rights, and engagement shoot included',
        price: '£2,200',
      },
      {
        title: 'Half Day Package',
        description: '6 hours coverage from preparations to first dance, online gallery included',
        price: '£1,400',
      },
    ],
    Catering: [
      {
        title: 'Three Course Wedding Breakfast',
        description: 'Canapés on arrival, three course meal, wine service, and evening buffet',
        price: '£75 per head',
      },
      {
        title: 'Cocktail Reception',
        description: 'Selection of canapés and drinks for 2 hours',
        price: '£35 per head',
      },
    ],
    Entertainment: [
      {
        title: 'Full Evening Performance',
        description: '2 x 60 minute sets, PA system, lighting, and DJ service between sets',
        price: '£2,500',
      },
    ],
    'Decor & Styling': [
      {
        title: 'Complete Floral Package',
        description:
          'Bridal bouquet, bridesmaid bouquets, buttonholes, ceremony arrangements, and table centerpieces',
        price: '£1,800',
      },
    ],
    'Event Planning': [
      {
        title: 'Full Wedding Planning',
        description:
          'Complete planning service from 12 months out, including vendor management and day-of coordination',
        price: '£4,500',
      },
      {
        title: 'Day-of Coordination',
        description:
          'Professional coordination on your wedding day to ensure everything runs smoothly',
        price: '£750',
      },
    ],
  };

  const templates = packageTemplates[category] || [];

  // Package image placeholders based on category
  const packageImages = {
    Venues: '/assets/images/placeholders/venue-package.svg',
    Photography: '/assets/images/placeholders/photography-package.svg',
    Catering: '/assets/images/placeholders/catering-package.svg',
    Entertainment: '/assets/images/placeholders/entertainment-package.svg',
    'Decor & Styling': '/assets/images/placeholders/decor-package.svg',
    'Event Planning': '/assets/images/placeholders/planning-package.svg',
  };

  const defaultImage = packageImages[category] || '/assets/images/placeholders/package-event.svg';

  return templates.map((template, index) => ({
    id: uid('pkg'),
    supplierId,
    title: template.title,
    slug: `${supplierName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${template.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    description: template.description,
    price: template.price,
    price_display: template.price, // Ensure price_display is set
    image: defaultImage,
    location,
    categories: [category.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
    approved: true,
    featured: index === 0,
    isFeatured: index === 0,
  }));
}

/**
 * Fetch profile photo from Pexels based on category
 * @param {string} category - Supplier category
 * @returns {Promise<string>} Photo URL from Pexels
 */
async function fetchPexelsPhoto(category) {
  const pexels = getPexelsService();

  if (!pexels.isConfigured()) {
    logger.warn('⚠️  Pexels not configured, using placeholder images');
    return null;
  }

  // Map category to search query
  const searchQueries = {
    Venues: 'wedding venue elegant',
    Photography: 'professional photographer',
    Catering: 'chef catering food',
    Entertainment: 'musician band entertainment',
    'Decor & Styling': 'florist wedding flowers',
    'Event Planning': 'event planner professional',
  };

  const query = searchQueries[category] || 'professional business person';

  try {
    const results = await pexels.searchPhotos(query, 15, 1);
    if (results.photos && results.photos.length > 0) {
      // Pick a random photo from results
      const randomPhoto = results.photos[Math.floor(Math.random() * results.photos.length)];
      return randomPhoto.src.medium; // Use medium size for profile photos
    }
  } catch (error) {
    logger.warn(`⚠️  Could not fetch Pexels photo for ${category}:`, error.message);
  }

  return null;
}

/**
 * Fetch package/venue photos from Pexels
 * @param {string} category - Supplier category
 * @param {number} count - Number of photos to fetch
 * @returns {Promise<string[]>} Array of photo URLs
 */
async function fetchPexelsPhotos(category, count = 3) {
  const pexels = getPexelsService();

  if (!pexels.isConfigured()) {
    return [];
  }

  const searchQueries = {
    Venues: 'wedding venue hall',
    Photography: 'wedding photography',
    Catering: 'catering buffet food',
    Entertainment: 'live music band',
    'Decor & Styling': 'wedding flowers decoration',
    'Event Planning': 'event planning decoration',
  };

  const query = searchQueries[category] || 'event';

  try {
    const results = await pexels.searchPhotos(query, Math.min(count * 2, 30), 1);
    if (results.photos && results.photos.length > 0) {
      // Return requested number of photos
      return results.photos.slice(0, count).map(photo => photo.src.large);
    }
  } catch (error) {
    logger.warn(`⚠️  Could not fetch Pexels photos for ${category}:`, error.message);
  }

  return [];
}

/**
 * Seed founding suppliers into database
 */
async function seedFoundingSuppliers() {
  logger.info('🌱 Starting founding suppliers seed...');

  try {
    await dbUnified.initializeDatabase();

    const existingSuppliers = await dbUnified.read('suppliers');
    const existingPackages = await dbUnified.read('packages');
    const existingReviews = await dbUnified.read('reviews');

    const allSuppliers = [];
    const allPackages = [];
    const allReviews = [];

    // Check if Pexels is configured
    const pexels = getPexelsService();
    const usePexels = pexels.isConfigured();

    if (usePexels) {
      logger.info('📸 Pexels API configured - will fetch profile photos');
    } else {
      logger.info('⚠️  Pexels API not configured - using placeholder images');
    }

    // Generate suppliers for each category
    for (const [category, suppliers] of Object.entries(SUPPLIER_DATA)) {
      logger.info(`\n📦 Processing ${category} suppliers...`);

      for (const supplierData of suppliers) {
        const supplierId = uid('sup');

        // Fetch profile photo from Pexels if available
        let logoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(supplierData.name)}&size=200&background=0B8073&color=fff`;

        if (usePexels) {
          const pexelsLogo = await fetchPexelsPhoto(category);
          if (pexelsLogo) {
            logoUrl = pexelsLogo;
            logger.info(`  ✓ Fetched profile photo for ${supplierData.name}`);
          }
        }

        // Fetch venue/package photos from Pexels if available
        let photos = supplierData.photos || [];

        if (usePexels && photos.length === 0) {
          const pexelsPhotos = await fetchPexelsPhotos(category, 3);
          if (pexelsPhotos.length > 0) {
            photos = pexelsPhotos;
            logger.info(`  ✓ Fetched ${pexelsPhotos.length} photos for ${supplierData.name}`);
          }
        }

        // Convert flat URL array to photosGallery structured format
        const photosGallery = photos.map(url => ({
          url,
          approved: true,
          uploadedAt: new Date().toISOString(),
        }));

        // Create supplier with complete data
        const supplier = {
          id: supplierId,
          ownerUserId: null,
          name: supplierData.name,
          logo: logoUrl,
          blurb: supplierData.blurb,
          category,
          location: supplierData.location,
          price_display: supplierData.price_display,
          website: `https://www.${supplierData.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.co.uk`,
          email: `hello@${supplierData.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.co.uk`,
          phone: `0${Math.floor(Math.random() * 9000000000) + 1000000000}`,
          license:
            category === 'Venues' ? `LIC-${Math.floor(Math.random() * 900000) + 100000}` : '',
          amenities: supplierData.amenities || [],
          maxGuests: supplierData.maxGuests || null,
          photosGallery,
          description_short: supplierData.description_short,
          description_long: supplierData.description_long,
          approved: true,
          isPro: false,
          isFounding: true, // Founding supplier badge
          foundingYear: 2025,
          badges: ['founding'], // Badge system
          rating: 4.5 + Math.random() * 0.5, // Random rating between 4.5-5.0
          reviewCount: 3,
        };

        allSuppliers.push(supplier);

        // Generate packages
        const packages = generatePackages(
          supplierId,
          supplierData.name,
          category,
          supplierData.location
        );
        allPackages.push(...packages);

        // Generate reviews
        const reviews = generateReviews(supplierId, 3);
        allReviews.push(...reviews);
      }
    }

    // Add a few more venues and photographers in different locations
    const additionalSuppliers = [
      {
        category: 'Venues',
        name: 'The Clocktower',
        location: 'Liverpool',
        blurb: 'Industrial chic venue in converted warehouse',
        description_short: 'Urban warehouse venue with exposed brick',
        description_long:
          'Converted Victorian warehouse with original features, exposed brick, and modern amenities.',
        price_display: 'From £2,500',
        maxGuests: 100,
        amenities: ['Parking', 'Urban Setting', 'Licensed', 'Flexible Space'],
        photos: [],
      },
      {
        category: 'Photography',
        name: 'Highland Lens Photography',
        location: 'Glasgow',
        blurb: 'Capturing Scottish celebrations with a creative eye',
        description_short: 'Wedding photography across Scotland',
        description_long:
          'Based in Glasgow, specializing in creative, documentary-style wedding photography across Scotland.',
        price_display: 'From £1,600',
        maxGuests: null,
        amenities: ['Full Day Coverage', 'Second Shooter', 'Online Gallery', 'Print Rights'],
        photos: [],
      },
    ];

    logger.info('\n📦 Processing additional suppliers...');

    for (const supplierData of additionalSuppliers) {
      const supplierId = uid('sup');

      // Fetch profile photo from Pexels if available
      let logoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(supplierData.name)}&size=200&background=0B8073&color=fff`;

      if (usePexels) {
        const pexelsLogo = await fetchPexelsPhoto(supplierData.category);
        if (pexelsLogo) {
          logoUrl = pexelsLogo;
          logger.info(`  ✓ Fetched profile photo for ${supplierData.name}`);
        }
      }

      // Fetch venue/package photos from Pexels if available
      let photos = supplierData.photos || [];

      if (usePexels && photos.length === 0) {
        const pexelsPhotos = await fetchPexelsPhotos(supplierData.category, 3);
        if (pexelsPhotos.length > 0) {
          photos = pexelsPhotos;
          logger.info(`  ✓ Fetched ${pexelsPhotos.length} photos for ${supplierData.name}`);
        }
      }

      // Convert flat URL array to photosGallery structured format
      const photosGallery = photos.map(url => ({
        url,
        approved: true,
        uploadedAt: new Date().toISOString(),
      }));

      const supplier = {
        id: supplierId,
        ownerUserId: null,
        name: supplierData.name,
        logo: logoUrl,
        blurb: supplierData.blurb,
        category: supplierData.category,
        location: supplierData.location,
        price_display: supplierData.price_display,
        website: `https://www.${supplierData.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.co.uk`,
        email: `hello@${supplierData.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.co.uk`,
        phone: `0${Math.floor(Math.random() * 9000000000) + 1000000000}`,
        license:
          supplierData.category === 'Venues'
            ? `LIC-${Math.floor(Math.random() * 900000) + 100000}`
            : '',
        amenities: supplierData.amenities || [],
        maxGuests: supplierData.maxGuests || null,
        photosGallery,
        description_short: supplierData.description_short,
        description_long: supplierData.description_long,
        approved: true,
        isPro: false,
        isFounding: true,
        foundingYear: 2025,
        badges: ['founding'],
        rating: 4.5 + Math.random() * 0.5,
        reviewCount: 3,
      };

      allSuppliers.push(supplier);

      const packages = generatePackages(
        supplierId,
        supplierData.name,
        supplierData.category,
        supplierData.location
      );
      allPackages.push(...packages);

      const reviews = generateReviews(supplierId, 3);
      allReviews.push(...reviews);
    }

    // Write to database
    const updatedSuppliers = [...existingSuppliers, ...allSuppliers];
    const updatedPackages = [...existingPackages, ...allPackages];
    const updatedReviews = [...(existingReviews || []), ...allReviews];

    await dbUnified.write('suppliers', updatedSuppliers);
    await dbUnified.write('packages', updatedPackages);

    // Create reviews collection if it doesn't exist
    try {
      await dbUnified.write('reviews', updatedReviews);
    } catch (error) {
      logger.warn('Could not write reviews:', error.message);
    }

    logger.info(`✅ Created ${allSuppliers.length} founding suppliers`);
    logger.info(`✅ Created ${allPackages.length} packages`);
    logger.info(`✅ Created ${allReviews.length} reviews`);
    logger.info('🌱 Founding suppliers seed complete!');

    return {
      suppliers: allSuppliers.length,
      packages: allPackages.length,
      reviews: allReviews.length,
    };
  } catch (error) {
    logger.error('❌ Error seeding founding suppliers:', error);
    throw error;
  }
}

// Allow running directly from command line
if (require.main === module) {
  seedFoundingSuppliers()
    .then(result => {
      logger.info('Seed completed:', result);
      process.exit(0);
    })
    .catch(error => {
      logger.error('Seed failed:', error);
      process.exit(1);
    });
}

module.exports = { seedFoundingSuppliers };
