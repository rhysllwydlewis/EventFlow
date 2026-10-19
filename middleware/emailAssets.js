/**
 * Email logo assets
 *
 * The PNGs under `public/assets/email/` are embedded in outgoing email and loaded
 * by webmail clients from another origin. Helmet's default
 * `Cross-Origin-Resource-Policy: same-origin` would make browsers refuse them, so
 * this directory opts back in. Keep it narrow: everything else under `/assets`
 * keeps the same-origin default.
 */

'use strict';

/**
 * Express middleware for the `/assets/email` mount point.
 * @returns {Function} Express middleware
 */
function emailAssetsCrossOrigin() {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  };
}

module.exports = { emailAssetsCrossOrigin };
