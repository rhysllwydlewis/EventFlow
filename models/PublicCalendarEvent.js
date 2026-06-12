/**
 * Public Calendar Event Model
 *
 * Documents the schema for events published to the shared public calendar.
 */

'use strict';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_LOCATION_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 100;
const MAX_URL_LENGTH = 500;
const MAX_SHORT_TEXT_LENGTH = 160;
const MAX_MEDIUM_TEXT_LENGTH = 500;
const MAX_PHONE_LENGTH = 40;
const MAX_EMAIL_LENGTH = 254;

const EVENT_STATUSES = ['draft', 'pending_review', 'published', 'rejected', 'cancelled', 'expired'];
const PUBLIC_EVENT_STATUSES = ['published'];
const EVENT_TYPES = [
  'Wedding Fayre',
  'Open Day',
  'Supplier Showcase',
  'Workshop',
  'Venue Tour',
  'Planning Event',
  'Networking Event',
  'Online Event',
  'Other',
];
const PRICE_TYPES = ['free', 'paid', 'donation', 'unknown'];

const VALIDATION_RULES = {
  title: { required: true, maxLength: MAX_TITLE_LENGTH },
  description: { maxLength: MAX_DESCRIPTION_LENGTH },
  startDate: { required: true },
  endDate: {},
  location: { maxLength: MAX_LOCATION_LENGTH },
  category: { maxLength: MAX_CATEGORY_LENGTH },
  eventType: { enum: EVENT_TYPES },
  venueName: { maxLength: MAX_SHORT_TEXT_LENGTH },
  addressLine1: { maxLength: MAX_SHORT_TEXT_LENGTH },
  addressLine2: { maxLength: MAX_SHORT_TEXT_LENGTH },
  townCity: { maxLength: MAX_SHORT_TEXT_LENGTH },
  county: { maxLength: MAX_SHORT_TEXT_LENGTH },
  postcode: { maxLength: 20 },
  onlineUrl: { maxLength: MAX_URL_LENGTH, format: 'url' },
  priceType: { enum: PRICE_TYPES },
  ticketPrice: { type: 'number' },
  externalBookingUrl: { maxLength: MAX_URL_LENGTH, format: 'url' },
  capacity: { type: 'integer' },
  organiserName: { maxLength: MAX_SHORT_TEXT_LENGTH },
  contactEmail: { maxLength: MAX_EMAIL_LENGTH, format: 'email' },
  contactPhone: { maxLength: MAX_PHONE_LENGTH },
  accessibilityNotes: { maxLength: MAX_MEDIUM_TEXT_LENGTH },
  parkingInfo: { maxLength: MAX_MEDIUM_TEXT_LENGTH },
  ageSuitability: { maxLength: MAX_SHORT_TEXT_LENGTH },
  imageUrl: { maxLength: MAX_URL_LENGTH, format: 'url' },
  featuredImageUrl: { maxLength: MAX_URL_LENGTH, format: 'url' },
  externalUrl: { maxLength: MAX_URL_LENGTH, format: 'url' },
  status: { enum: EVENT_STATUSES },
  slug: { maxLength: MAX_TITLE_LENGTH },
};

module.exports = {
  VALIDATION_RULES,
  EVENT_STATUSES,
  PUBLIC_EVENT_STATUSES,
  EVENT_TYPES,
  PRICE_TYPES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_CATEGORY_LENGTH,
  MAX_URL_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  MAX_MEDIUM_TEXT_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_EMAIL_LENGTH,
};
