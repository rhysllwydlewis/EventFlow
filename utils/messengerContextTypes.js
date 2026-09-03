/**
 * Messenger Context Type Constants
 *
 * Single source of truth for:
 *   - CONVERSATION_CONTEXT_TYPES  – valid values for conversation.context.type
 *   - CONVERSATION_V4_TYPES       – valid values for conversation.type (re-exported
 *                                   from models/ConversationV4 to allow import without
 *                                   pulling in the MongoDB dependency from the model file)
 *
 * Both the route layer (routes/messenger-v4.js) and the model layer
 * (models/ConversationV4.js) import from here so that adding a new context
 * type only requires a change in one place.
 *
 * Frontend code uses the matching JS globals injected via the messenger bundle;
 * keep these values in sync with MessengerContextTypes in the public scripts.
 */

'use strict';

/**
 * Valid values for the `context.type` field on a conversation.
 * Controls which "context banner" is shown in the conversation view.
 *
 * @type {string[]}
 */
const CONVERSATION_CONTEXT_TYPES = [
  'package',
  'supplier_profile',
  'marketplace_listing',
  'find_a_supplier',
];

/**
 * Valid values for the top-level `type` field on a conversation.
 * Determines routing, permissions, and UI treatment.
 *
 * @type {string[]}
 */
const CONVERSATION_V4_TYPES = ['direct', 'marketplace', 'enquiry', 'supplier_network', 'support'];

/**
 * Roles a user is allowed to discover through the messenger contact search
 * (GET /api/v4/messenger/contacts). Deliberately excludes 'admin' and any
 * other staff/privileged role so that endpoint can't be used to enumerate
 * privileged accounts by name or email substring.
 *
 * @type {string[]}
 */
const MESSENGER_CONTACT_SEARCHABLE_ROLES = ['customer', 'supplier'];

module.exports = {
  CONVERSATION_CONTEXT_TYPES,
  CONVERSATION_V4_TYPES,
  MESSENGER_CONTACT_SEARCHABLE_ROLES,
};
