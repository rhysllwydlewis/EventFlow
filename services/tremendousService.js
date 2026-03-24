/**
 * Tremendous Gift Card Service
 * Wraps the Tremendous API for gift card order management.
 *
 * Env vars:
 *   TREMENDOUS_API_KEY  — Bearer token from the Tremendous dashboard
 *   TREMENDOUS_ENV      — 'sandbox' (default) or 'production'
 *
 * Sandbox base URL:    https://testflight.tremendous.com/api/v2
 * Production base URL: https://www.tremendous.com/api/v2
 *
 * Docs: https://developers.tremendous.com/docs/introduction
 */

'use strict';

const https = require('https');
const logger = require('../utils/logger');

const BASE_URLS = {
  sandbox: 'testflight.tremendous.com',
  production: 'www.tremendous.com',
};

const API_PATH_PREFIX = '/api/v2';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Make a JSON request to the Tremendous API.
 *
 * @param {object} opts
 * @param {string} opts.method   - HTTP method (GET, POST, etc.)
 * @param {string} opts.path     - API path, e.g. '/products'
 * @param {object} [opts.body]   - Request body (will be JSON-serialised)
 * @param {string} opts.apiKey   - Bearer token
 * @param {string} opts.hostname - API hostname
 * @returns {Promise<{status: number, data: any}>}
 */
function makeRequest({ method, path, body, apiKey, hostname }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname,
      path: `${API_PATH_PREFIX}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}),
      },
      timeout: DEFAULT_TIMEOUT_MS,
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => {
        raw += chunk;
      });
      res.on('end', () => {
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (_) {
          data = { _raw: raw };
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const err = new Error('Tremendous API request timed out');
      err.code = 'ETIMEOUT';
      reject(err);
    });

    req.on('error', err => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Map a Tremendous API error response into a normalised Error.
 *
 * @param {number} status  - HTTP status code
 * @param {any}    data    - Parsed response body
 * @returns {Error}
 */
function mapApiError(status, data) {
  const message =
    (data && data.errors && data.errors[0] && data.errors[0].message) ||
    (data && data.error && data.error.message) ||
    (data && data.message) ||
    `Tremendous API error (HTTP ${status})`;

  const err = new Error(message);
  err.statusCode = status;
  err.tremendousError = data;
  return err;
}

// ─── Service class ────────────────────────────────────────────────────────────

class TremendousService {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiKey]  - Overrides TREMENDOUS_API_KEY env var
   * @param {string} [opts.env]     - 'sandbox' | 'production'; overrides TREMENDOUS_ENV
   */
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || process.env.TREMENDOUS_API_KEY || '';
    const env = (opts.env || process.env.TREMENDOUS_ENV || 'sandbox').toLowerCase();
    this.hostname = BASE_URLS[env] || BASE_URLS.sandbox;
    this.env = env in BASE_URLS ? env : 'sandbox';

    if (!this.apiKey) {
      logger.warn(
        'TremendousService: TREMENDOUS_API_KEY is not set. Gift card features will fail.'
      );
    }
  }

  /**
   * Ensure the API key is configured; throws a 503 error if missing.
   * @private
   */
  _requireApiKey() {
    if (!this.apiKey) {
      const err = new Error('Gift card service is not configured. Please contact support.');
      err.statusCode = 503;
      throw err;
    }
  }

  /**
   * List products from Tremendous, optionally filtered to GIFT_CARD type.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.giftCardsOnly=true] - When true, filter to GIFT_CARD category
   * @returns {Promise<Array>} Array of product objects
   */
  async listProducts({ giftCardsOnly = true } = {}) {
    this._requireApiKey();

    const { status, data } = await makeRequest({
      method: 'GET',
      path: '/products',
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status !== 200) {
      throw mapApiError(status, data);
    }

    const products = (data && data.products) || [];

    if (giftCardsOnly) {
      return products.filter(
        p => p.category === 'GIFT_CARD' || (p.type && p.type.toUpperCase() === 'GIFT_CARD')
      );
    }

    return products;
  }

  /**
   * Create a gift card order / reward for a recipient.
   *
   * @param {object} params
   * @param {string} params.productId       - Tremendous product ID
   * @param {number} params.value           - Reward value (currency unit, e.g. 5.00)
   * @param {string} params.currency        - ISO 4217 currency code (default: 'GBP')
   * @param {object} params.recipient       - { name, email }
   * @param {string} [params.fundingSourceId] - Funding source ID; defaults to 'BALANCE'
   * @param {string} [params.externalId]    - Optional idempotency / reference ID
   * @param {string} [params.message]       - Optional message to the recipient
   * @returns {Promise<object>} Created order object
   */
  async createOrder({
    productId,
    value,
    currency = 'GBP',
    recipient,
    fundingSourceId,
    externalId,
    message,
  }) {
    this._requireApiKey();

    if (!productId) {
      throw new Error('productId is required');
    }
    if (!value || typeof value !== 'number' || value <= 0) {
      throw new Error('value must be a positive number');
    }
    if (!recipient || !recipient.email) {
      throw new Error('recipient.email is required');
    }
    if (!recipient.name) {
      throw new Error('recipient.name is required');
    }

    const orderPayload = {
      payment: {
        funding_source_id: fundingSourceId || 'BALANCE',
      },
      reward: {
        value: {
          denomination: value,
          currency_code: currency,
        },
        products: [productId],
        recipient: {
          name: String(recipient.name).slice(0, 100),
          email: String(recipient.email).slice(0, 200),
        },
        delivery: {
          method: 'EMAIL',
        },
        ...(message ? { message: String(message).slice(0, 500) } : {}),
        ...(externalId ? { custom_identifier: String(externalId).slice(0, 100) } : {}),
      },
    };

    const { status, data } = await makeRequest({
      method: 'POST',
      path: '/orders',
      body: orderPayload,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status !== 200 && status !== 201) {
      throw mapApiError(status, data);
    }

    return (data && data.order) || data;
  }

  /**
   * Fetch the status of an existing order.
   *
   * @param {string} orderId - Tremendous order ID
   * @returns {Promise<object>} Order object
   */
  async getOrder(orderId) {
    this._requireApiKey();

    if (!orderId) {
      throw new Error('orderId is required');
    }

    const { status, data } = await makeRequest({
      method: 'GET',
      path: `/orders/${encodeURIComponent(orderId)}`,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status === 404) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    if (status !== 200) {
      throw mapApiError(status, data);
    }

    return (data && data.order) || data;
  }

  /**
   * Resend a reward email for the given reward ID.
   *
   * @param {string} rewardId - Tremendous reward ID (found inside an order's rewards array)
   * @returns {Promise<object>} Empty object on success
   */
  async resendReward(rewardId) {
    this._requireApiKey();

    if (!rewardId) {
      throw new Error('rewardId is required');
    }

    const { status, data } = await makeRequest({
      method: 'POST',
      path: `/rewards/${encodeURIComponent(rewardId)}/resend`,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status !== 200 && status !== 204) {
      throw mapApiError(status, data);
    }

    return {};
  }

  /**
   * List all orders (paginated).
   *
   * @param {object} [opts]
   * @param {number} [opts.offset] - Pagination offset
   * @param {number} [opts.limit]  - Number of results (max 100)
   * @returns {Promise<{orders: Array, total_count: number}>}
   */
  async listOrders({ offset, limit } = {}) {
    this._requireApiKey();

    const params = new URLSearchParams();
    if (offset !== null && offset !== undefined) {
      params.set('offset', String(offset));
    }
    if (limit !== null && limit !== undefined) {
      params.set('limit', String(limit));
    }
    const qs = params.toString();

    const { status, data } = await makeRequest({
      method: 'GET',
      path: `/orders${qs ? `?${qs}` : ''}`,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status !== 200) {
      throw mapApiError(status, data);
    }

    return {
      orders: (data && data.orders) || [],
      total_count: (data && data.total_count) || 0,
    };
  }

  /**
   * List all rewards (paginated).
   *
   * @param {object} [opts]
   * @param {number} [opts.offset] - Pagination offset
   * @returns {Promise<{rewards: Array}>}
   */
  async listRewards({ offset } = {}) {
    this._requireApiKey();

    const params = new URLSearchParams();
    if (offset !== null && offset !== undefined) {
      params.set('offset', String(offset));
    }
    const qs = params.toString();

    const { status, data } = await makeRequest({
      method: 'GET',
      path: `/rewards${qs ? `?${qs}` : ''}`,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status !== 200) {
      throw mapApiError(status, data);
    }

    return {
      rewards: (data && data.rewards) || [],
    };
  }

  /**
   * Retrieve a single reward by its ID.
   *
   * @param {string} rewardId - Tremendous reward ID
   * @returns {Promise<object>} Reward object
   */
  async getReward(rewardId) {
    this._requireApiKey();

    if (!rewardId) {
      throw new Error('rewardId is required');
    }

    const { status, data } = await makeRequest({
      method: 'GET',
      path: `/rewards/${encodeURIComponent(rewardId)}`,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status === 404) {
      const err = new Error('Reward not found');
      err.statusCode = 404;
      throw err;
    }

    if (status !== 200) {
      throw mapApiError(status, data);
    }

    return (data && data.reward) || data;
  }

  /**
   * Cancel a reward that has not yet been redeemed.
   *
   * @param {string} rewardId - Tremendous reward ID
   * @returns {Promise<object>} Cancelled reward object
   */
  async cancelReward(rewardId) {
    this._requireApiKey();

    if (!rewardId) {
      throw new Error('rewardId is required');
    }

    const { status, data } = await makeRequest({
      method: 'POST',
      path: `/rewards/${encodeURIComponent(rewardId)}/cancel`,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status === 404) {
      const err = new Error('Reward not found');
      err.statusCode = 404;
      throw err;
    }

    if (status !== 200 && status !== 204) {
      throw mapApiError(status, data);
    }

    return (data && data.reward) || {};
  }

  /**
   * Generate a redemption link for a reward (delivery method must be LINK).
   *
   * @param {string} rewardId - Tremendous reward ID
   * @returns {Promise<{link: string, reward: object}>}
   */
  async generateRewardLink(rewardId) {
    this._requireApiKey();

    if (!rewardId) {
      throw new Error('rewardId is required');
    }

    const { status, data } = await makeRequest({
      method: 'POST',
      path: `/rewards/${encodeURIComponent(rewardId)}/generate_link`,
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status === 404) {
      const err = new Error('Reward not found');
      err.statusCode = 404;
      throw err;
    }

    if (status !== 200 && status !== 201) {
      throw mapApiError(status, data);
    }

    return {
      link:
        (data && data.link) ||
        (data && data.reward && data.reward.delivery && data.reward.delivery.link) ||
        null,
      reward: (data && data.reward) || data,
    };
  }

  /**
   * List available funding sources for the account.
   *
   * @returns {Promise<Array>} Array of funding source objects
   */
  async listFundingSources() {
    this._requireApiKey();

    const { status, data } = await makeRequest({
      method: 'GET',
      path: '/funding_sources',
      apiKey: this.apiKey,
      hostname: this.hostname,
    });

    if (status !== 200) {
      throw mapApiError(status, data);
    }

    return (data && data.funding_sources) || [];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get (or create) the singleton TremendousService.
 * In tests, pass opts to inject a fresh instance.
 *
 * @param {object} [opts] - Optional constructor overrides (apiKey, env)
 * @returns {TremendousService}
 */
function getTremendousService(opts) {
  if (opts) {
    return new TremendousService(opts);
  }
  if (!_instance) {
    _instance = new TremendousService();
  }
  return _instance;
}

module.exports = {
  TremendousService,
  getTremendousService,
};
