/**
 * Supplier Model
 *
 * Documents the supplier schema shape used throughout the EventFlow platform.
 * This serves as documentation and a single source of truth for supplier fields,
 * types, defaults, and validation rules.
 *
 * Schema includes:
 * - Core identity (id, name, category, ownerUserId)
 * - Contact details (phone, email, website)
 * - Publishing workflow (status, slug, publishedAt)
 * - SEO & social (metaDescription, openGraphImage, tags)
 * - Business details (amenities, priceRange, businessHours)
 * - Media & content (images, logo, coverImage, bookingUrl, videoUrl)
 * - Analytics (viewCount, enquiryCount)
 * - Admin approval (approved, approvedAt, approvedBy)
 * - Subscription (isPro, proExpiresAt, subscriptionStatus, trialUsed)
 */

'use strict';

/**
 * Valid supplier category values (must match the HTML <select> options in dashboard-supplier.html)
 *
 * Publisher types: suppliers whose category is in PUBLISHER_CATEGORIES can
 * create/update/delete public calendar events (unless overridden by
 * publicCalendarPublisherOverride).
 */
const VALID_CATEGORIES = [
  'Venues',
  'Catering',
  'Photography',
  'Videography',
  'Entertainment',
  'Music/DJ',
  'Florist',
  'Decor',
  'Transport',
  'Cake',
  'Stationery',
  'Hair & Makeup',
  'Beauty',
  'Bridalwear',
  'Jewellery',
  'Celebrant',
  'Event Planner',
  'Wedding Fayre',
  'Planning',
  'Other',
];

/**
 * Supplier categories that grant public-calendar publishing rights by default.
 * A supplier whose category is in this list can create/update/delete public
 * calendar events (subject to publicCalendarPublisherOverride).
 */
const PUBLISHER_CATEGORIES = ['Event Planner', 'Wedding Fayre'];

/**
 * Valid supplier status values
 */
const VALID_STATUSES = ['draft', 'published', 'suspended'];

/**
 * Supplier field validation rules
 */
const VALIDATION_RULES = {
  name: { required: true, maxLength: 100 },
  category: { required: true, enum: VALID_CATEGORIES },
  description: { maxLength: 5000 },
  email: { maxLength: 254, format: 'email' },
  phone: { maxLength: 20, format: 'phone' },
  website: { maxLength: 500, format: 'url' },
  bookingUrl: { maxLength: 500, format: 'url' },
  videoUrl: { maxLength: 500, format: 'url' },
  location: { maxLength: 200 },
  metaDescription: { maxLength: 300 },
};

/**
 * Supplier schema definition
 *
 * @typedef {Object} Supplier
 *
 * Core Identity
 * @property {string} id - Unique supplier identifier (format: sup_xxxxx)
 * @property {string} ownerUserId - ID of the user who owns this profile
 * @property {string} name - Business name (required, max 100 chars)
 * @property {string} category - Business category (required, must be one of VALID_CATEGORIES)
 *
 * Contact Details
 * @property {string} phone - Contact phone number (max 20 chars)
 * @property {string} email - Contact email address (max 254 chars, valid email format)
 * @property {string} website - Business website URL (max 500 chars, valid URL format)
 * @property {Object} socials - Social media links { platform: url }
 *
 * Description
 * @property {string} description - Long description (max 5000 chars)
 * @property {string} location - City/region (max 200 chars)
 * @property {string} postcode - Postcode
 *
 * Publishing Workflow
 * @property {string} status - Profile status ('draft' | 'published' | 'suspended'), default 'draft'
 * @property {string} slug - SEO-friendly URL slug (unique)
 * @property {string|null} publishedAt - ISO timestamp when profile was published
 *
 * SEO & Social
 * @property {string} metaDescription - Custom meta description (max 300 chars)
 * @property {string} openGraphImage - URL for OG image
 * @property {string[]} tags - Tags/keywords for discovery
 *
 * Business Details
 * @property {string[]} amenities - Available amenities list
 * @property {string} priceRange - Price indicator (e.g. '£', '££', '£££'), default '£'
 * @property {Object} businessHours - Opening hours { day: { open, close } }
 * @property {string|null} responseTime - Typical response time description
 *
 * Media & Content
 * @property {string} logo - Logo image URL
 * @property {string} coverImage - Banner/cover image URL
 * @property {string[]} images - Gallery image URLs
 * @property {string} bookingUrl - Direct booking URL (max 500 chars, valid URL format)
 * @property {string} videoUrl - Intro video URL (max 500 chars, valid URL format)
 * @property {Object[]} faqs - FAQ entries [{ question, answer }]
 * @property {Object[]} testimonials - Testimonials [{ author, text, date }]
 * @property {string[]} awards - Awards/accolades list
 * @property {string[]} certifications - Certifications/accreditations list
 *
 * Analytics (denormalized — never set from user input on create)
 * @property {number} viewCount - Profile view count, default 0
 * @property {number} enquiryCount - Enquiry count, default 0
 * @property {number} rating - Average rating (0–5), default 0
 * @property {number} reviewCount - Number of reviews, default 0
 *
 * Admin Approval (never set from user input on create)
 * @property {boolean} approved - Whether admin has approved the profile, default false
 * @property {string|null} approvedAt - ISO timestamp of approval
 * @property {string|null} approvedBy - Admin user ID who approved
 * @property {boolean} verified - Whether supplier has been verified, default false
 *
 * Subscription
 * @property {boolean} isPro - Whether supplier has an active Pro subscription, default false
 * @property {string|null} proExpiresAt - ISO timestamp when Pro expires
 * @property {string} subscriptionStatus - Subscription state ('free' | 'trial' | 'active' | 'expired')
 * @property {boolean} trialUsed - Whether the free trial has been used, default false
 * @property {string|null} trialStartedAt - ISO timestamp when trial started
 * @property {string|null} trialEndsAt - ISO timestamp when trial ends
 * @property {string|null} stripeCustomerId - Stripe customer ID for billing
 *
 * Public Calendar Publishing
 * @property {boolean|null} publicCalendarPublisherOverride - Admin override for publish rights:
 *   true  → can publish regardless of category
 *   false → cannot publish regardless of category
 *   null  → derive from category (Event Planner / Wedding Fayre → publisher)
 *
 * Timestamps
 * @property {string} createdAt - ISO timestamp of record creation
 * @property {string} updatedAt - ISO timestamp of last update
 */

module.exports = {
  VALID_CATEGORIES,
  PUBLISHER_CATEGORIES,
  VALID_STATUSES,
  VALIDATION_RULES,
};
