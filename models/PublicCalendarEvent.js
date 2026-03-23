/**
 * Public Calendar Event Model
 *
 * Documents the schema for events published to the shared public calendar.
 * Only suppliers whose category is 'Event Planner' or 'Wedding Fayre' (or who
 * have publicCalendarPublisherOverride set to true by an admin) may create,
 * update or delete these records.
 *
 * Schema:
 * @property {string}  id              - Unique event ID (format: pce_<hex><timestamp36>)
 * @property {string}  title           - Event title (required, max 200 chars)
 * @property {string}  description     - Event description (max 5000 chars)
 * @property {string}  startDate       - ISO 8601 date/datetime (required)
 * @property {string}  endDate         - ISO 8601 date/datetime (optional; >= startDate)
 * @property {string}  location        - Venue/location name (max 200 chars)
 * @property {string}  category        - Event category for filtering (max 100 chars)
 * @property {string}  imageUrl        - Optional cover image URL (max 500 chars)
 * @property {string}  externalUrl     - Optional link to more info / booking (max 500 chars)
 *
 * Ownership (immutable after creation — admin can change via direct DB update):
 * @property {string}  createdByUserId - ID of the user who created the event
 * @property {string}  supplierId      - ID of the supplier profile used to publish
 *
 * Timestamps:
 * @property {string}  createdAt       - ISO timestamp of creation
 * @property {string}  updatedAt       - ISO timestamp of last update
 */

'use strict';

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_LOCATION_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 100;
const MAX_URL_LENGTH = 500;

const VALIDATION_RULES = {
  title: { required: true, maxLength: MAX_TITLE_LENGTH },
  description: { maxLength: MAX_DESCRIPTION_LENGTH },
  startDate: { required: true },
  endDate: {},
  location: { maxLength: MAX_LOCATION_LENGTH },
  category: { maxLength: MAX_CATEGORY_LENGTH },
  imageUrl: { maxLength: MAX_URL_LENGTH, format: 'url' },
  externalUrl: { maxLength: MAX_URL_LENGTH, format: 'url' },
};

module.exports = {
  VALIDATION_RULES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_CATEGORY_LENGTH,
  MAX_URL_LENGTH,
};
