'use strict';

/**
 * Single source of truth for supplier "no photo" avatar placeholders:
 * the initials shown and the background color behind them. Every page
 * that renders a supplier avatar fallback should use this instead of
 * re-implementing its own initials/color logic, so the same supplier
 * looks the same everywhere.
 */

const SUPPLIER_AVATAR_PALETTE = [
  ['#13B6A2', '#0B8073'],
  ['#8B5CF6', '#6D28D9'],
  ['#F59E0B', '#D97706'],
  ['#10B981', '#059669'],
  ['#3B82F6', '#2563EB'],
  ['#EC4899', '#DB2777'],
];

const SUPPLIER_AVATAR_FALLBACK_INITIAL = '?';

/**
 * Two-letter initials for multi-word business names, one letter for a
 * single-word name, and a generic '?' (never a fabricated letter) when
 * no usable name is available.
 * @param {string} name
 * @returns {string}
 */
function getSupplierInitials(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return SUPPLIER_AVATAR_FALLBACK_INITIAL;
  }
  if (words.length === 1) {
    return words[0].charAt(0).toUpperCase();
  }
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
}

/**
 * A stable, well-distributed hash: djb2-style, folded to an unsigned
 * 32-bit int so it works the same in every JS engine.
 * @param {string} value
 * @returns {number}
 */
function hashToUint32(value) {
  const str = String(value || '');
  let hash = 5381;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * The key used to pick a color must be stable for a given supplier even
 * if its display name changes (e.g. a rebrand) — so an id is always
 * preferred over the name.
 * @param {object|string} supplierOrKey
 * @returns {string}
 */
function getSupplierAvatarKey(supplierOrKey) {
  if (supplierOrKey && typeof supplierOrKey === 'object') {
    return String(supplierOrKey.id || supplierOrKey.supplierId || supplierOrKey.name || '');
  }
  return String(supplierOrKey || '');
}

/**
 * @param {object|string} supplierOrKey A supplier object (uses .id, falling
 *   back to .supplierId then .name) or a plain string key.
 * @returns {[string, string]} A [from, to] hex color pair.
 */
function getSupplierAvatarColors(supplierOrKey) {
  const key = getSupplierAvatarKey(supplierOrKey);
  const index = key ? hashToUint32(key) % SUPPLIER_AVATAR_PALETTE.length : 0;
  return SUPPLIER_AVATAR_PALETTE[index];
}

/**
 * @param {object|string} supplierOrKey
 * @returns {string} A CSS linear-gradient() value.
 */
function getSupplierAvatarGradient(supplierOrKey) {
  const [from, to] = getSupplierAvatarColors(supplierOrKey);
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}

const api = {
  SUPPLIER_AVATAR_PALETTE,
  SUPPLIER_AVATAR_FALLBACK_INITIAL,
  getSupplierInitials,
  getSupplierAvatarKey,
  getSupplierAvatarColors,
  getSupplierAvatarGradient,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.EFSupplierAvatar = api;
}
