/**
 * Which network hops in front of the app may tell us who the visitor is.
 *
 * Express works out `req.ip` from the connection and the `X-Forwarded-For` list that each proxy
 * appends to. The site is served through two proxies: Cloudflare, then Railway's edge. Trusting
 * "one hop" (the old setting) stops at whichever address Railway saw connecting, which is a
 * Cloudflare address whenever Cloudflare is in front, so every visitor would look like one of a
 * few Cloudflare addresses. That breaks anything keyed on the visitor's address: rate limits, the
 * per-address cap on counted profile views, and the addresses written to audit logs.
 *
 * This trusts the first hop (Railway's edge, as before) and then keeps trusting further hops only
 * while they are Cloudflare's published addresses. The first address that is not a trusted proxy is
 * the visitor. A request that reaches the app without Cloudflare (a direct Railway address, local
 * development) behaves exactly as before, and a forged `X-Forwarded-For` value placed by the
 * visitor sits to the left of the visitor's real address, so it is never reached.
 *
 * Source of the ranges: https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.
 * If Cloudflare adds a range that is missing here, requests through it simply look like they come
 * from that Cloudflare address, which is the previous behaviour.
 */
'use strict';

const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/**
 * Parse a dotted IPv4 address into a number.
 *
 * @param {string} text - Address such as "104.16.0.1"
 * @returns {bigint|null} The address, or null when it is not a valid IPv4 address
 */
function parseIPv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
      return null;
    }
    value = (value << 8n) | BigInt(Number(part));
  }
  return value;
}

/**
 * Parse an IPv6 address into a number.
 *
 * @param {string} text - Address such as "2606:4700::1"
 * @returns {bigint|null} The address, or null when it is not a valid IPv6 address
 */
function parseIPv6(text) {
  let address = text;
  // A dotted IPv4 tail (::ffff:1.2.3.4) counts as the last two 16-bit groups.
  const dotted = address.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = parseIPv4(dotted[2]);
    if (v4 === null) {
      return null;
    }
    address = `${dotted[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return null;
  }
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return null;
    }
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/**
 * Turn "address/length" into the numbers needed to test membership quickly.
 *
 * @param {string} cidr - Range such as "104.16.0.0/13"
 * @param {boolean} v6 - Whether the range is IPv6
 * @returns {{v6: boolean, network: bigint, mask: bigint}} The compiled range
 */
function compileRange(cidr, v6) {
  const [address, length] = cidr.split('/');
  const bits = v6 ? 128n : 32n;
  const prefix = BigInt(length);
  const full = (1n << bits) - 1n;
  const mask = (full << (bits - prefix)) & full;
  const network = (v6 ? parseIPv6(address) : parseIPv4(address)) & mask;
  return { v6, network, mask };
}

/** Longest text accepted as an address (45 for IPv6 with an IPv4 tail, plus room for a zone id). */
const MAX_ADDRESS_LENGTH = 64;

const RANGES = [
  ...CLOUDFLARE_IPV4.map(cidr => compileRange(cidr, false)),
  ...CLOUDFLARE_IPV6.map(cidr => compileRange(cidr, true)),
];

/**
 * Whether an address belongs to Cloudflare's published ranges.
 *
 * @param {string} address - An IPv4 or IPv6 address, as Express reports it
 * @returns {boolean} True for a Cloudflare address
 */
function isCloudflareAddress(address) {
  // The longest textual IP address is 45 characters (IPv6 with an embedded IPv4 tail); a zone id
  // adds a few more. Anything longer is not an address, and `X-Forwarded-For` is attacker-controlled
  // text, so it is rejected before any pattern is applied to it.
  if (typeof address !== 'string' || !address || address.length > MAX_ADDRESS_LENGTH) {
    return false;
  }
  // Drop an IPv6 zone ("fe80::1%eth0") and unwrap an IPv4 address carried inside IPv6.
  let text = address.split('%')[0].trim();
  const mapped = text.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) {
    text = mapped[1];
  }
  const v6 = text.includes(':');
  const value = v6 ? parseIPv6(text) : parseIPv4(text);
  if (value === null) {
    return false;
  }
  return RANGES.some(range => range.v6 === v6 && (value & range.mask) === range.network);
}

/**
 * The value for `app.set('trust proxy', ...)`.
 *
 * @returns {function(string, number): boolean} Express "trust" function: the first hop is trusted
 *   (Railway's edge), then only Cloudflare's addresses
 */
function createTrustProxy() {
  return (address, hop) => hop === 0 || isCloudflareAddress(address);
}

module.exports = { createTrustProxy, isCloudflareAddress, CLOUDFLARE_IPV4, CLOUDFLARE_IPV6 };
