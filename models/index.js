/**
 * MongoDB Schema Definitions and Validation
 * Defines the structure and validation rules for all collections
 */

'use strict';
const logger = require('../utils/logger.js');

// Import subscription and invoice schemas
const { subscriptionSchema } = require('./Subscription');
const { invoiceSchema } = require('./Invoice');
const { marketplaceImageSchema } = require('./MarketplaceImage');

// Schema definitions don't need direct collection access

/**
 * User Schema
 * Stores user accounts for customers, suppliers, and admins
 */
const userSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'email', 'role', 'passwordHash'],
      properties: {
        id: { bsonType: 'string', description: 'Unique user identifier' },
        name: { bsonType: 'string', description: 'User full name' },
        firstName: { bsonType: 'string', description: 'User first name' },
        lastName: { bsonType: 'string', description: 'User last name' },
        email: { bsonType: 'string', description: 'User email address' },
        role: { enum: ['customer', 'supplier', 'admin'], description: 'User role' },
        passwordHash: { bsonType: 'string', description: 'Hashed password' },
        location: { bsonType: 'string', description: 'User location (UK county)' },
        postcode: { bsonType: 'string', description: 'User postcode (optional)' },
        company: { bsonType: 'string', description: 'Company name (required for suppliers)' },
        jobTitle: { bsonType: 'string', description: 'Job title (optional for suppliers)' },
        website: { bsonType: 'string', description: 'Website URL (optional for suppliers)' },
        socials: {
          bsonType: 'object',
          description: 'Social media URLs (optional)',
          properties: {
            instagram: { bsonType: 'string' },
            facebook: { bsonType: 'string' },
            twitter: { bsonType: 'string' },
            linkedin: { bsonType: 'string' },
          },
        },
        avatarUrl: { bsonType: 'string', description: 'User avatar/profile picture URL' },
        notify: {
          bsonType: 'bool',
          description: 'Email notification preference (deprecated, use notify_account)',
        },
        notify_account: {
          bsonType: 'bool',
          description: 'Transactional email notifications (account, security)',
        },
        notify_marketing: {
          bsonType: 'bool',
          description: 'Marketing and promotional email consent',
        },
        marketingOptIn: {
          bsonType: 'bool',
          description: 'Marketing email consent (deprecated, use notify_marketing)',
        },
        verified: { bsonType: 'bool', description: 'Email verification status' },
        verificationToken: { bsonType: 'string', description: 'Email verification token' },
        verificationTokenExpiresAt: {
          bsonType: 'string',
          description: 'Verification token expiration timestamp',
        },
        emailVerified: { bsonType: 'bool', description: 'Email address verified' },
        emailVerificationToken: { bsonType: 'string', description: 'Email verification token' },
        emailVerificationExpires: {
          bsonType: 'string',
          description: 'Email verification token expiration',
        },
        phoneNumber: { bsonType: 'string', description: 'Phone number' },
        phoneVerified: { bsonType: 'bool', description: 'Phone number verified' },
        phoneVerificationCode: { bsonType: 'string', description: 'Phone verification code' },
        phoneVerificationExpires: {
          bsonType: 'string',
          description: 'Phone verification code expiration',
        },
        phoneNumberToVerify: {
          bsonType: 'string',
          description: 'Phone number pending verification',
        },
        twoFactorEnabled: { bsonType: 'bool', description: '2FA enabled status' },
        twoFactorSecret: { bsonType: 'string', description: 'Encrypted 2FA secret' },
        twoFactorBackupCodes: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Hashed backup codes for 2FA recovery',
        },
        resetToken: { bsonType: 'string', description: 'Password reset token' },
        resetTokenExpiresAt: { bsonType: 'string', description: 'Reset token expiration' },
        isPro: { bsonType: 'bool', description: 'Pro subscription status' },
        subscriptionId: {
          bsonType: 'string',
          description: 'Reference to active subscription ID',
        },
        createdAt: { bsonType: 'string', description: 'Account creation timestamp' },
        lastLoginAt: { bsonType: 'string', description: 'Last login timestamp' },
        badges: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Badge IDs awarded to this user',
        },
      },
    },
  },
};

/**
 * Supplier Schema
 * Stores supplier/vendor business information
 */
const supplierSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'name', 'category'],
      properties: {
        id: { bsonType: 'string', description: 'Unique supplier identifier' },
        ownerUserId: { bsonType: 'string', description: 'User ID of the owner' },
        name: { bsonType: 'string', description: 'Business name' },
        logo: { bsonType: 'string', description: 'Business logo URL' },
        blurb: { bsonType: 'string', description: 'Short business blurb/tagline' },
        category: { bsonType: 'string', description: 'Supplier category' },
        location: { bsonType: 'string', description: 'Business location' },
        price_display: { bsonType: 'string', description: 'Price range display' },
        website: { bsonType: 'string', description: 'Business website URL' },
        email: { bsonType: 'string', description: 'Business contact email' },
        phone: { bsonType: 'string', description: 'Business contact phone' },
        license: { bsonType: 'string', description: 'Business license number' },
        amenities: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'List of amenities',
        },
        maxGuests: { bsonType: 'int', description: 'Maximum guest capacity' },
        description_short: { bsonType: 'string', description: 'Short description' },
        description_long: { bsonType: 'string', description: 'Detailed description' },
        photos: { bsonType: 'array', items: { bsonType: 'string' }, description: 'Photo URLs' },
        photosGallery: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              url: { bsonType: 'string' },
              approved: { bsonType: 'bool' },
              uploadedAt: { bsonType: 'number' },
            },
          },
          description: 'Photo gallery with approval status',
        },
        // Profile customization fields
        bannerUrl: { bsonType: 'string', description: 'Banner image URL' },
        tagline: { bsonType: 'string', description: 'Supplier tagline/headline' },
        highlights: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Key features/highlights',
        },
        featuredServices: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Featured services offered',
        },
        themeColor: { bsonType: 'string', description: 'Brand theme color (hex)' },
        socialLinks: {
          bsonType: 'object',
          description: 'Social media links',
          properties: {
            facebook: { bsonType: 'string' },
            instagram: { bsonType: 'string' },
            twitter: { bsonType: 'string' },
            linkedin: { bsonType: 'string' },
            youtube: { bsonType: 'string' },
            tiktok: { bsonType: 'string' },
          },
        },
        approved: { bsonType: 'bool', description: 'Admin approval status' },
        isPro: { bsonType: 'bool', description: 'Pro subscription status' },
        proExpiresAt: { bsonType: 'string', description: 'Pro subscription expiration' },
        aiTags: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'AI-generated tags',
        },
        aiScore: { bsonType: 'number', description: 'AI quality score' },
        aiUpdatedAt: { bsonType: 'string', description: 'Last AI update timestamp' },
        badges: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Badge IDs awarded to this supplier',
        },
        isTest: { bsonType: 'bool', description: 'Flag indicating test/seed data' },
        seedBatch: { bsonType: 'string', description: 'Seed batch identifier for cleanup' },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
      },
    },
  },
};

/**
 * Package Schema
 * Stores service packages offered by suppliers
 */
const packageSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'supplierId', 'title'],
      properties: {
        id: { bsonType: 'string', description: 'Unique package identifier' },
        supplierId: { bsonType: 'string', description: 'Associated supplier ID' },
        title: { bsonType: 'string', description: 'Package title' },
        slug: { bsonType: 'string', description: 'URL-friendly package slug' },
        description: { bsonType: 'string', description: 'Package description' },
        price: { bsonType: 'string', description: 'Package price' },
        price_display: {
          bsonType: 'string',
          description: 'Display price (e.g., "From £500" or "Contact for pricing")',
        },
        location: { bsonType: 'string', description: 'Package location' },
        image: { bsonType: 'string', description: 'Main package image URL' },
        gallery: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              url: { bsonType: 'string' },
              approved: { bsonType: 'bool' },
              uploadedAt: { bsonType: 'number' },
            },
          },
          description: 'Package image gallery',
        },
        categories: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Category slugs this package belongs to',
        },
        primaryCategoryKey: {
          bsonType: 'string',
          description: 'Primary category key/slug (required, single-select)',
        },
        eventTypes: {
          bsonType: 'array',
          items: { enum: ['wedding', 'other'] },
          description: 'Event types this package is suitable for (required, multi-select)',
        },
        tags: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Package tags for search and filtering',
        },
        approved: { bsonType: 'bool', description: 'Admin approval status' },
        featured: { bsonType: 'bool', description: 'Featured package flag' },
        isFeatured: { bsonType: 'bool', description: 'Featured package flag (alias)' },
        isTest: { bsonType: 'bool', description: 'Flag indicating test/seed data' },
        seedBatch: { bsonType: 'string', description: 'Seed batch identifier for cleanup' },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
      },
    },
  },
};

/**
 * Plan Schema
 * Stores customer event plans (saved suppliers and event details)
 */
const planSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'userId'],
      properties: {
        id: { bsonType: 'string', description: 'Unique plan identifier' },
        userId: { bsonType: 'string', description: 'Customer user ID' },
        supplierId: { bsonType: 'string', description: 'Saved supplier ID' },
        plan: { bsonType: 'object', description: 'Complete plan data structure' },
        eventType: { bsonType: 'string', description: 'Event type (Wedding, Other, etc.)' },
        eventName: { bsonType: 'string', description: 'Event name/title' },
        location: { bsonType: 'string', description: 'Event location' },
        date: { bsonType: 'string', description: 'Event date' },
        guests: { bsonType: 'int', description: 'Number of guests' },
        budget: { bsonType: 'string', description: 'Budget range' },
        packages: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Package IDs selected in wizard',
        },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Note Schema
 * Stores customer notes for event planning
 */
const noteSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'userId'],
      properties: {
        id: { bsonType: 'string', description: 'Unique note identifier' },
        userId: { bsonType: 'string', description: 'Note owner user ID' },
        text: { bsonType: 'string', description: 'Note content' },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Category Schema
 * Stores package categories for browsing and filtering
 */
const categorySchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'name', 'slug'],
      properties: {
        id: { bsonType: 'string', description: 'Unique category identifier' },
        name: { bsonType: 'string', description: 'Category display name' },
        slug: { bsonType: 'string', description: 'URL-friendly category slug' },
        description: { bsonType: 'string', description: 'Category description' },
        heroImage: { bsonType: 'string', description: 'Hero image URL for category page' },
        icon: { bsonType: 'string', description: 'Icon or emoji for category' },
        order: { bsonType: 'int', description: 'Display order' },
      },
    },
  },
};

/**
 * Event Schema
 * Stores event records (if used)
 */
const eventSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id'],
      properties: {
        id: { bsonType: 'string', description: 'Unique event identifier' },
        userId: { bsonType: 'string', description: 'Event creator user ID' },
        title: { bsonType: 'string', description: 'Event title' },
        date: { bsonType: 'string', description: 'Event date' },
        location: { bsonType: 'string', description: 'Event location' },
        description: { bsonType: 'string', description: 'Event description' },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Badge Schema
 * Stores badges that can be awarded to users and suppliers
 */
const badgeSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'name', 'type'],
      properties: {
        id: { bsonType: 'string', description: 'Unique badge identifier' },
        name: { bsonType: 'string', description: 'Badge name' },
        slug: { bsonType: 'string', description: 'URL-friendly badge slug' },
        type: {
          enum: ['founder', 'pro', 'pro-plus', 'verified', 'featured', 'custom'],
          description: 'Badge type',
        },
        description: { bsonType: 'string', description: 'Badge description' },
        icon: { bsonType: 'string', description: 'Badge icon/emoji' },
        color: { bsonType: 'string', description: 'Badge color (hex code)' },
        autoAssign: { bsonType: 'bool', description: 'Whether badge is auto-assigned' },
        autoAssignCriteria: {
          bsonType: 'object',
          description: 'Criteria for auto-assignment',
        },
        displayOrder: { bsonType: 'int', description: 'Display order priority' },
        active: { bsonType: 'bool', description: 'Whether badge is active' },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Payment Schema
 * Stores payment and subscription records from Stripe
 */
const paymentSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'userId', 'amount', 'currency', 'status'],
      properties: {
        id: { bsonType: 'string', description: 'Unique payment identifier' },
        stripePaymentId: { bsonType: 'string', description: 'Stripe payment intent ID' },
        stripeCustomerId: { bsonType: 'string', description: 'Stripe customer ID' },
        stripeSubscriptionId: {
          bsonType: 'string',
          description: 'Stripe subscription ID (if applicable)',
        },
        userId: { bsonType: 'string', description: 'User ID who made the payment' },
        amount: { bsonType: 'number', description: 'Payment amount' },
        currency: { bsonType: 'string', description: 'Payment currency (e.g., GBP, USD)' },
        status: {
          enum: ['pending', 'succeeded', 'failed', 'cancelled', 'refunded'],
          description: 'Payment status',
        },
        type: {
          enum: ['one_time', 'subscription'],
          description: 'Payment type',
        },
        subscriptionDetails: {
          bsonType: 'object',
          description: 'Subscription information if type is subscription',
          properties: {
            planId: { bsonType: 'string', description: 'Subscription plan ID' },
            planName: { bsonType: 'string', description: 'Subscription plan name' },
            interval: {
              enum: ['month', 'year'],
              description: 'Billing interval',
            },
            currentPeriodStart: {
              bsonType: 'string',
              description: 'Current billing period start date',
            },
            currentPeriodEnd: {
              bsonType: 'string',
              description: 'Current billing period end date',
            },
            cancelAtPeriodEnd: {
              bsonType: 'bool',
              description: 'Whether subscription will cancel at period end',
            },
            canceledAt: { bsonType: 'string', description: 'When subscription was canceled' },
          },
        },
        metadata: {
          bsonType: 'object',
          description: 'Additional metadata from Stripe',
        },
        createdAt: { bsonType: 'string', description: 'Payment creation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Review Schema
 * Stores customer reviews and ratings for suppliers with anti-abuse protection
 */
const reviewSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'supplierId', 'userId', 'rating'],
      properties: {
        id: { bsonType: 'string', description: 'Unique review identifier' },
        supplierId: { bsonType: 'string', description: 'Reviewed supplier ID' },
        userId: { bsonType: 'string', description: 'Reviewer user ID' },
        userName: { bsonType: 'string', description: 'Reviewer display name' },
        rating: {
          bsonType: 'int',
          minimum: 1,
          maximum: 5,
          description: 'Star rating (1-5)',
        },
        title: { bsonType: 'string', description: 'Review title' },
        comment: { bsonType: 'string', description: 'Review text content' },
        recommend: { bsonType: 'bool', description: 'Would recommend supplier' },
        eventType: { bsonType: 'string', description: 'Type of event' },
        eventDate: { bsonType: 'string', description: 'Event date' },
        verified: {
          bsonType: 'bool',
          description: 'Verified customer (has message history)',
        },
        emailVerified: {
          bsonType: 'bool',
          description: 'Email address verified',
        },
        approved: {
          bsonType: 'bool',
          description: 'Admin approval status',
        },
        approvedAt: { bsonType: 'string', description: 'Approval timestamp' },
        approvedBy: { bsonType: 'string', description: 'Admin user ID who approved' },
        flagged: {
          bsonType: 'bool',
          description: 'Flagged for moderation',
        },
        flagReason: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Reasons for flagging',
        },
        ipAddress: { bsonType: 'string', description: 'Reviewer IP address (hashed)' },
        userAgent: { bsonType: 'string', description: 'Browser user agent' },
        helpfulCount: { bsonType: 'int', description: 'Helpful votes count' },
        unhelpfulCount: { bsonType: 'int', description: 'Unhelpful votes count' },
        supplierResponse: {
          bsonType: 'object',
          description: 'Supplier response to review',
          properties: {
            text: { bsonType: 'string', description: 'Response text' },
            respondedAt: { bsonType: 'string', description: 'Response timestamp' },
            respondedBy: { bsonType: 'string', description: 'Supplier user ID' },
          },
        },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Review Vote Schema
 * Tracks helpful/unhelpful votes on reviews
 */
const reviewVoteSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'reviewId', 'userId', 'voteType'],
      properties: {
        id: { bsonType: 'string', description: 'Unique vote identifier' },
        reviewId: { bsonType: 'string', description: 'Reviewed review ID' },
        userId: { bsonType: 'string', description: 'Voter user ID (optional for anonymous)' },
        voteType: {
          enum: ['helpful', 'unhelpful'],
          description: 'Type of vote',
        },
        ipAddress: { bsonType: 'string', description: 'Voter IP address (hashed)' },
        createdAt: { bsonType: 'string', description: 'Vote timestamp' },
      },
    },
  },
};

/**
 * Supplier Analytics Schema
 * Stores aggregated supplier metrics and trust scores
 */
const supplierAnalyticsSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'supplierId'],
      properties: {
        id: { bsonType: 'string', description: 'Unique analytics identifier' },
        supplierId: { bsonType: 'string', description: 'Supplier ID' },
        averageRating: { bsonType: 'number', description: 'Average star rating' },
        totalReviews: { bsonType: 'int', description: 'Total approved reviews' },
        ratingDistribution: {
          bsonType: 'object',
          description: 'Count of each star rating',
          properties: {
            1: { bsonType: 'int' },
            2: { bsonType: 'int' },
            3: { bsonType: 'int' },
            4: { bsonType: 'int' },
            5: { bsonType: 'int' },
          },
        },
        recommendationRate: {
          bsonType: 'number',
          description: 'Percentage of customers who recommend',
        },
        trustScore: {
          bsonType: 'number',
          description: 'Overall trust score (0-100)',
        },
        responseRate: {
          bsonType: 'number',
          description: 'Percentage of reviews with supplier response',
        },
        averageResponseTime: {
          bsonType: 'number',
          description: 'Average response time in hours',
        },
        badges: {
          bsonType: 'array',
          items: { bsonType: 'string' },
          description: 'Earned badges (top-rated, responsive, etc.)',
        },
        lastCalculated: { bsonType: 'string', description: 'Last calculation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Review Moderation Schema
 * Audit trail for review moderation actions
 */
const reviewModerationSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'reviewId', 'moderatorId', 'action'],
      properties: {
        id: { bsonType: 'string', description: 'Unique moderation record identifier' },
        reviewId: { bsonType: 'string', description: 'Moderated review ID' },
        moderatorId: { bsonType: 'string', description: 'Moderator user ID' },
        action: {
          enum: ['approve', 'reject', 'flag', 'unflag'],
          description: 'Moderation action taken',
        },
        reason: { bsonType: 'string', description: 'Reason for action' },
        notes: { bsonType: 'string', description: 'Internal moderator notes' },
        previousState: {
          bsonType: 'object',
          description: 'Review state before action',
        },
        createdAt: { bsonType: 'string', description: 'Action timestamp' },
      },
    },
  },
};

/**
 * Notification Schema
 * Stores user notifications for real-time updates
 */
const notificationSchema = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['id', 'userId', 'type', 'title', 'message'],
      properties: {
        id: { bsonType: 'string', description: 'Unique notification identifier' },
        userId: { bsonType: 'string', description: 'Recipient user ID' },
        type: {
          enum: [
            'message',
            'booking',
            'payment',
            'review',
            'system',
            'marketing',
            'reminder',
            'approval',
            'update',
          ],
          description: 'Notification type/category',
        },
        title: { bsonType: 'string', description: 'Notification title' },
        message: { bsonType: 'string', description: 'Notification message content' },
        actionUrl: { bsonType: 'string', description: 'URL for notification action/link' },
        actionText: { bsonType: 'string', description: 'Text for action button' },
        icon: { bsonType: 'string', description: 'Icon identifier or emoji' },
        priority: {
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Notification priority level',
        },
        category: { bsonType: 'string', description: 'Custom category tag' },
        metadata: {
          bsonType: 'object',
          description: 'Additional structured data',
        },
        isRead: {
          bsonType: 'bool',
          description: 'Whether notification has been read',
        },
        readAt: { bsonType: 'string', description: 'Timestamp when marked as read' },
        isDismissed: {
          bsonType: 'bool',
          description: 'Whether notification has been dismissed',
        },
        dismissedAt: {
          bsonType: 'string',
          description: 'Timestamp when dismissed',
        },
        expiresAt: {
          bsonType: 'string',
          description: 'Expiration timestamp for temporary notifications',
        },
        createdAt: { bsonType: 'string', description: 'Creation timestamp' },
        updatedAt: { bsonType: 'string', description: 'Last update timestamp' },
      },
    },
  },
};

/**
 * Initialize collections with schemas and indexes
 * @param {Object} db - MongoDB database instance
 */
async function initializeCollections(db) {
  const collections = {
    users: userSchema,
    suppliers: supplierSchema,
    packages: packageSchema,
    categories: categorySchema,
    plans: planSchema,
    notes: noteSchema,
    events: eventSchema,
    badges: badgeSchema,
    payments: paymentSchema,
    subscriptions: subscriptionSchema,
    invoices: invoiceSchema,
    reviews: reviewSchema,
    reviewVotes: reviewVoteSchema,
    supplierAnalytics: supplierAnalyticsSchema,
    reviewModerations: reviewModerationSchema,
    notifications: notificationSchema,
    marketplace_images: marketplaceImageSchema,
  };

  for (const [name, schema] of Object.entries(collections)) {
    try {
      // Check if collection exists
      const existingCollections = await db.listCollections({ name }).toArray();

      if (existingCollections.length === 0) {
        // Create collection with schema validation
        await db.createCollection(name, schema);
        logger.info(`Created collection: ${name}`);
      } else {
        // Update validation rules for existing collection
        await db.command({
          collMod: name,
          validator: schema.validator,
        });
        logger.info(`Updated validation for collection: ${name}`);
      }
    } catch (error) {
      logger.error(`Error initializing collection ${name}:`, error.message);
    }
  }

  // Create indexes for better query performance
  await createIndexes(db);
}

/**
 * Create database indexes for performance optimization
 * @param {Object} db - MongoDB database instance
 */
async function createIndexes(db) {
  try {
    // User indexes
    await db.collection('users').createIndex({ id: 1 }, { unique: true });
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ role: 1 });
    await db.collection('users').createIndex({ verificationToken: 1 }, { sparse: true });
    await db.collection('users').createIndex({ verificationTokenExpiresAt: 1 }, { sparse: true });
    await db.collection('users').createIndex({ resetToken: 1 }, { sparse: true });

    // Supplier indexes
    await db.collection('suppliers').createIndex({ id: 1 }, { unique: true });
    await db.collection('suppliers').createIndex({ ownerUserId: 1 });
    await db.collection('suppliers').createIndex({ category: 1 });
    await db.collection('suppliers').createIndex({ approved: 1 });
    await db.collection('suppliers').createIndex({ isPro: 1 });

    // Package indexes
    await db.collection('packages').createIndex({ id: 1 }, { unique: true });
    await db.collection('packages').createIndex({ slug: 1 }, { unique: true, sparse: true });
    await db.collection('packages').createIndex({ supplierId: 1 });
    await db.collection('packages').createIndex({ approved: 1 });
    await db.collection('packages').createIndex({ featured: 1 });
    await db.collection('packages').createIndex({ isFeatured: 1 });
    await db.collection('packages').createIndex({ categories: 1 });
    await db.collection('packages').createIndex({ primaryCategoryKey: 1 });
    await db.collection('packages').createIndex({ eventTypes: 1 });

    // Category indexes
    await db.collection('categories').createIndex({ id: 1 }, { unique: true });
    await db.collection('categories').createIndex({ slug: 1 }, { unique: true });
    await db.collection('categories').createIndex({ order: 1 });

    // Plan indexes
    await db.collection('plans').createIndex({ id: 1 }, { unique: true });
    await db.collection('plans').createIndex({ userId: 1 });
    await db.collection('plans').createIndex({ supplierId: 1 });

    // Note indexes
    await db.collection('notes').createIndex({ id: 1 }, { unique: true });
    await db.collection('notes').createIndex({ userId: 1 });

    // Event indexes
    await db.collection('events').createIndex({ id: 1 }, { unique: true });
    await db.collection('events').createIndex({ userId: 1 });

    // Badge indexes
    await db.collection('badges').createIndex({ id: 1 }, { unique: true });
    await db.collection('badges').createIndex({ slug: 1 }, { unique: true, sparse: true });
    await db.collection('badges').createIndex({ type: 1 });
    await db.collection('badges').createIndex({ active: 1 });

    // Payment indexes
    await db.collection('payments').createIndex({ id: 1 }, { unique: true });
    await db.collection('payments').createIndex({ userId: 1 });
    await db.collection('payments').createIndex({ stripePaymentId: 1 }, { sparse: true });
    await db.collection('payments').createIndex({ stripeCustomerId: 1 }, { sparse: true });
    await db.collection('payments').createIndex({ stripeSubscriptionId: 1 }, { sparse: true });
    await db.collection('payments').createIndex({ status: 1 });
    await db.collection('payments').createIndex({ createdAt: 1 });

    // Subscription indexes
    await db.collection('subscriptions').createIndex({ id: 1 }, { unique: true });
    await db.collection('subscriptions').createIndex({ userId: 1 });
    await db.collection('subscriptions').createIndex({ status: 1 });
    await db.collection('subscriptions').createIndex({ plan: 1 });
    await db
      .collection('subscriptions')
      .createIndex({ stripeSubscriptionId: 1 }, { sparse: true, unique: true });
    await db.collection('subscriptions').createIndex({ nextBillingDate: 1 }, { sparse: true });

    // Invoice indexes
    await db.collection('invoices').createIndex({ id: 1 }, { unique: true });
    await db.collection('invoices').createIndex({ userId: 1 });
    await db.collection('invoices').createIndex({ subscriptionId: 1 }, { sparse: true });
    await db.collection('invoices').createIndex({ status: 1 });
    await db
      .collection('invoices')
      .createIndex({ stripeInvoiceId: 1 }, { sparse: true, unique: true });
    await db.collection('invoices').createIndex({ dueDate: 1 }, { sparse: true });

    // Review indexes
    await db.collection('reviews').createIndex({ id: 1 }, { unique: true });
    await db.collection('reviews').createIndex({ supplierId: 1 });
    await db.collection('reviews').createIndex({ userId: 1 });
    await db.collection('reviews').createIndex({ approved: 1 });
    await db.collection('reviews').createIndex({ flagged: 1 });
    await db.collection('reviews').createIndex({ verified: 1 });
    await db.collection('reviews').createIndex({ rating: 1 });
    await db.collection('reviews').createIndex({ createdAt: 1 });
    await db.collection('reviews').createIndex({ supplierId: 1, approved: 1 });
    await db.collection('reviews').createIndex({ supplierId: 1, createdAt: -1 });

    // Review vote indexes
    await db.collection('reviewVotes').createIndex({ id: 1 }, { unique: true });
    await db.collection('reviewVotes').createIndex({ reviewId: 1 });
    await db.collection('reviewVotes').createIndex({ userId: 1 }, { sparse: true });
    await db
      .collection('reviewVotes')
      .createIndex({ reviewId: 1, userId: 1 }, { unique: true, sparse: true });
    await db.collection('reviewVotes').createIndex({ ipAddress: 1 });

    // Supplier analytics indexes
    await db.collection('supplierAnalytics').createIndex({ id: 1 }, { unique: true });
    await db.collection('supplierAnalytics').createIndex({ supplierId: 1 }, { unique: true });
    await db.collection('supplierAnalytics').createIndex({ averageRating: 1 });
    await db.collection('supplierAnalytics').createIndex({ trustScore: 1 });
    await db.collection('supplierAnalytics').createIndex({ totalReviews: 1 });

    // Review moderation indexes
    await db.collection('reviewModerations').createIndex({ id: 1 }, { unique: true });
    await db.collection('reviewModerations').createIndex({ reviewId: 1 });
    await db.collection('reviewModerations').createIndex({ moderatorId: 1 });
    await db.collection('reviewModerations').createIndex({ createdAt: 1 });

    // Notification indexes
    await db.collection('notifications').createIndex({ id: 1 }, { unique: true });
    await db.collection('notifications').createIndex({ userId: 1 });
    await db.collection('notifications').createIndex({ userId: 1, createdAt: -1 });
    await db.collection('notifications').createIndex({ userId: 1, isRead: 1 });
    await db.collection('notifications').createIndex({ type: 1 });
    await db.collection('notifications').createIndex({ priority: 1 });
    await db.collection('notifications').createIndex({ createdAt: -1 });
    await db.collection('notifications').createIndex({ expiresAt: 1 }, { sparse: true });

    // Marketplace image indexes
    await db.collection('marketplace_images').createIndex({ _id: 1 }, { unique: true });
    await db.collection('marketplace_images').createIndex({ listingId: 1 });
    await db.collection('marketplace_images').createIndex({ userId: 1 });
    await db.collection('marketplace_images').createIndex({ listingId: 1, order: 1 });
    await db.collection('marketplace_images').createIndex({ uploadedAt: -1 });

    logger.info('Database indexes created successfully');
  } catch (error) {
    logger.error('Error creating indexes:', error.message);
  }
}

module.exports = {
  initializeCollections,
  createIndexes,
};
