/**
 * Keys for counting a supplier profile view once per visitor per hour.
 *
 * Nothing here is stored as a plain hash of an address. Every key is an HMAC-SHA256 under a server
 * secret, so a stored key cannot be reversed by trying every address. An IPv6 address is reduced
 * to its /64 prefix first, because one household or device rotates through the whole /64.
 */

'use strict';

const crypto = require('crypto');
const net = require('net');

/**
 * The secret the keys are derived with. An existing configured secret is reused, so no new
 * environment variable is required; PROFILE_VIEW_SALT overrides it if one is ever wanted.
 *
 * @returns {string} The secret, or '' when none is configured
 */
function getSecret() {
  return process.env.PROFILE_VIEW_SALT || process.env.JWT_SECRET || '';
}

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * @param {string} address - A valid IPv6 address (no zone id)
 * @returns {string[]|null} Eight lowercase 4-digit hex groups, or null when it cannot be parsed
 */
function expandIpv6(address) {
  let text = address.toLowerCase();
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const tail = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    if ([a, b, c, d].some(part => part > 255)) {
      return null;
    }
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    text = `${text.slice(0, tail.index)}${high}:${low}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null;
  }
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  return groups.map(group => group.padStart(4, '0'));
}

/**
 * The part of a network address that identifies one client for counting: an IPv4 address as it is,
 * an IPv6 address as its /64 prefix.
 *
 * @param {string} address - req.ip
 * @returns {string} Normalised address, or '' when it is missing or not an address
 */
function normaliseAddress(address) {
  const text = String(address || '')
    .trim()
    .replace(/%.*$/, '');
  if (!text) {
    return '';
  }
  if (net.isIPv4(text)) {
    return text;
  }
  if (!net.isIPv6(text)) {
    return '';
  }
  const groups = expandIpv6(text);
  if (!groups) {
    return '';
  }
  // ::ffff:a.b.c.d is an IPv4 client reaching a dual-stack socket.
  if (groups.slice(0, 5).every(group => group === '0000') && groups[5] === 'ffff') {
    const high = parseInt(groups[6], 16);
    const low = parseInt(groups[7], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `${groups.slice(0, 4).join(':')}::/64`;
}

/**
 * HMAC-SHA256 of some material for one purpose. The purpose is part of what is signed, so a key
 * made for one use can never equal a key made for another.
 *
 * @param {string} purpose - What the key is for (e.g. "visitor", "cap")
 * @param {string} material - What to key on
 * @returns {string} 32 hex characters, or '' when no secret is configured
 */
function hmacKey(purpose, material) {
  const secret = getSecret();
  if (!secret) {
    return '';
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`profile-view:v1:${purpose}|${material}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Key for "the same anonymous visitor": network address (IPv6 as /64) plus browser family.
 *
 * @param {string} address - req.ip
 * @param {string} family - Browser family, e.g. "chrome/windows"
 * @returns {string} "a:<hex>", or '' when there is no secret to key it with
 */
function anonymousVisitorKey(address, family) {
  const digest = hmacKey('visitor', `${normaliseAddress(address)}|${family}`);
  return digest ? `a:${digest}` : '';
}

/**
 * Key for "this network address", used only as part of a short-lived counter row.
 *
 * @param {string} address - req.ip
 * @returns {string} Key, or '' when the address is unknown or there is no secret
 */
function addressKey(address) {
  const normalised = normaliseAddress(address);
  return normalised ? hmacKey('address', normalised) : '';
}

module.exports = { normaliseAddress, anonymousVisitorKey, addressKey, getSecret };
