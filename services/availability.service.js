'use strict';

const UK_POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
const STATUSES = Object.freeze({
  AVAILABLE: 'available',
  PROVISIONAL: 'provisional',
  BOOKED: 'booked',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});
const BLOCKING_STATUSES = new Set([STATUSES.PROVISIONAL, STATUSES.BOOKED, STATUSES.UNAVAILABLE]);
const EARTH_RADIUS_MILES = 3958.7613;

function normaliseUkPostcode(value) {
  const compact = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length < 5 || compact.length > 7 || !UK_POSTCODE_RE.test(compact)) {
    return { ok: false, error: 'invalid_postcode' };
  }
  return { ok: true, postcode: `${compact.slice(0, -3)} ${compact.slice(-3)}` };
}

function createGeoPoint(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    return null;
  }
  return { type: 'Point', coordinates: [lon, lat] };
}

function distanceMiles(origin, destination) {
  const [lon1, lat1] = origin.coordinates.map(Number);
  const [lon2, lat2] = destination.coordinates.map(Number);
  const toRad = degrees => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function assertLocalDate(value, fieldName = 'date') {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName}_must_be_local_date`);
  }
  return text;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = assertLocalDate(aStart, 'aStart');
  const ae = assertLocalDate(aEnd || aStart, 'aEnd');
  const bs = assertLocalDate(bStart, 'bStart');
  const be = assertLocalDate(bEnd || bStart, 'bEnd');
  return as <= be && bs <= ae;
}

function weeklyDefaultStatus(calendar, date) {
  const localDate = assertLocalDate(date);
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const weekly = calendar?.weeklyPattern || {};
  return weekly[String(weekday)] === true ? STATUSES.AVAILABLE : STATUSES.UNKNOWN;
}

function publicAvailabilityForRange(calendar, startDate, endDate = startDate, packageId = null) {
  if (!calendar) {
    return { status: STATUSES.UNKNOWN, reason: 'no_calendar' };
  }

  const start = assertLocalDate(startDate, 'startDate');
  const end = assertLocalDate(endDate || startDate, 'endDate');
  const entries = Array.isArray(calendar.exceptions) ? calendar.exceptions : [];
  const overlapping = entries.filter(entry => {
    if (packageId && entry.packageId && entry.packageId !== packageId) {
      return false;
    }
    return rangesOverlap(start, end, entry.startDate, entry.endDate || entry.startDate);
  });

  const blocking = overlapping.find(entry => BLOCKING_STATUSES.has(entry.status));
  if (blocking) {
    return {
      status: blocking.status === STATUSES.BOOKED ? STATUSES.UNAVAILABLE : blocking.status,
      reason: blocking.source || 'exception',
    };
  }

  if (overlapping.some(entry => entry.status === STATUSES.AVAILABLE)) {
    return { status: STATUSES.AVAILABLE, reason: 'exception' };
  }

  if (start === end) {
    return { status: weeklyDefaultStatus(calendar, start), reason: 'weekly_pattern' };
  }

  return { status: STATUSES.UNKNOWN, reason: 'multi_day_requires_exception' };
}

function classifyCalendarFreshness(lastConfirmedAt, now = new Date()) {
  if (!lastConfirmedAt) {
    return 'never_confirmed';
  }
  const ageDays = (now.getTime() - new Date(lastConfirmedAt).getTime()) / 86400000;
  if (ageDays <= 30) {
    return 'up_to_date';
  }
  if (ageDays <= 60) {
    return 'needs_review_soon';
  }
  return 'stale';
}

function supplierAvailabilityIndexes() {
  return [
    {
      collection: 'suppliers',
      key: { locationGeo: '2dsphere' },
      options: { sparse: true, name: 'suppliers_locationGeo_2dsphere' },
    },
    {
      collection: 'suppliers',
      key: { normalisedPostcode: 1 },
      options: { sparse: true, name: 'suppliers_normalisedPostcode_1' },
    },
    {
      collection: 'supplierAvailabilityCalendars',
      key: { supplierId: 1 },
      options: { unique: true, name: 'availability_supplierId_unique' },
    },
    {
      collection: 'supplierAvailabilityCalendars',
      key: { 'exceptions.startDate': 1, 'exceptions.endDate': 1, supplierId: 1 },
      options: { name: 'availability_exception_range' },
    },
  ];
}

module.exports = {
  STATUSES,
  normaliseUkPostcode,
  createGeoPoint,
  distanceMiles,
  rangesOverlap,
  publicAvailabilityForRange,
  classifyCalendarFreshness,
  supplierAvailabilityIndexes,
};
