'use strict';

const UK_POSTCODE_RE =
  /^(GIR 0AA|(?:[A-PR-UWYZ][0-9][0-9]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9]?|[A-PR-UWYZ][0-9][A-HJKSTUW]|[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRV-Y]) [0-9][ABD-HJLNP-UW-Z]{2})$/;
const STATUSES = Object.freeze({
  AVAILABLE: 'available',
  PROVISIONAL: 'provisional',
  BOOKED: 'booked',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});
const EARTH_RADIUS_MILES = 3958.7613;
const MAX_PUBLIC_RANGE_DAYS = 366;
const STATUS_PRECEDENCE = [
  STATUSES.BOOKED,
  STATUSES.UNAVAILABLE,
  STATUSES.PROVISIONAL,
  STATUSES.AVAILABLE,
];

function normaliseUkPostcode(value) {
  const compact = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length < 5 || compact.length > 7) {
    return { ok: false, error: 'invalid_postcode' };
  }

  const postcode = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  if (!UK_POSTCODE_RE.test(postcode)) {
    return { ok: false, error: 'invalid_postcode' };
  }

  return { ok: true, postcode };
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

function normaliseGeoPoint(point) {
  if (!point || point.type !== 'Point' || !Array.isArray(point.coordinates)) {
    return null;
  }
  if (point.coordinates.length !== 2) {
    return null;
  }
  return createGeoPoint(point.coordinates[0], point.coordinates[1]);
}

function distanceMiles(origin, destination) {
  const safeOrigin = normaliseGeoPoint(origin);
  const safeDestination = normaliseGeoPoint(destination);
  if (!safeOrigin || !safeDestination) {
    throw new Error('invalid_geo_point');
  }

  const [lon1, lat1] = safeOrigin.coordinates;
  const [lon2, lat2] = safeDestination.coordinates;
  const toRad = degrees => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const boundedA = Math.min(1, Math.max(0, a));
  return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
}

function assertLocalDate(value, fieldName = 'date') {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName}_must_be_local_date`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName}_must_be_valid_local_date`);
  }

  return text;
}

function assertDateRange(startDate, endDate = startDate, fieldName = 'range') {
  const start = assertLocalDate(startDate, `${fieldName}Start`);
  const end = assertLocalDate(endDate || startDate, `${fieldName}End`);
  if (start > end) {
    throw new Error(`${fieldName}_start_must_not_be_after_end`);
  }
  return { start, end };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const a = assertDateRange(aStart, aEnd || aStart, 'a');
  const b = assertDateRange(bStart, bEnd || bStart, 'b');
  return a.start <= b.end && b.start <= a.end;
}

function addLocalDays(localDate, days) {
  const date = assertLocalDate(localDate);
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function datesInRange(startDate, endDate = startDate) {
  const { start, end } = assertDateRange(startDate, endDate, 'availability');
  const dates = [];
  for (let date = start; date <= end; date = addLocalDays(date, 1)) {
    dates.push(date);
    if (dates.length > MAX_PUBLIC_RANGE_DAYS) {
      throw new Error('availability_range_too_large');
    }
  }
  return dates;
}

function weeklyDefaultStatus(calendar, date) {
  const localDate = assertLocalDate(date);
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const weekly = calendar?.weeklyPattern || {};
  const key = String(weekday);
  if (!Object.prototype.hasOwnProperty.call(weekly, key)) {
    return STATUSES.UNKNOWN;
  }
  return weekly[key] === true ? STATUSES.AVAILABLE : STATUSES.UNAVAILABLE;
}

function appliesToPackage(entry, packageId) {
  if (!entry.packageId) {
    return true;
  }
  return Boolean(packageId) && entry.packageId === packageId;
}

function publicStatusForDate(calendar, date, packageId) {
  const entries = Array.isArray(calendar.exceptions) ? calendar.exceptions : [];
  const overlapping = entries.filter(
    entry =>
      entry &&
      appliesToPackage(entry, packageId) &&
      STATUS_PRECEDENCE.includes(entry.status) &&
      rangesOverlap(date, date, entry.startDate, entry.endDate || entry.startDate)
  );

  for (const status of STATUS_PRECEDENCE) {
    const matching = overlapping.find(entry => entry.status === status);
    if (matching) {
      return {
        status: status === STATUSES.BOOKED ? STATUSES.UNAVAILABLE : status,
        reason: matching.source || 'exception',
      };
    }
  }

  return {
    status: weeklyDefaultStatus(calendar, date),
    reason: 'weekly_pattern',
  };
}

function publicAvailabilityForRange(calendar, startDate, endDate = startDate, packageId = null) {
  if (!calendar) {
    return { status: STATUSES.UNKNOWN, reason: 'no_calendar' };
  }

  const dates = datesInRange(startDate, endDate || startDate);
  const dailyStatuses = dates.map(date => publicStatusForDate(calendar, date, packageId));

  const unavailable = dailyStatuses.find(result => result.status === STATUSES.UNAVAILABLE);
  if (unavailable) {
    return unavailable;
  }

  const provisional = dailyStatuses.find(result => result.status === STATUSES.PROVISIONAL);
  if (provisional) {
    return provisional;
  }

  if (dailyStatuses.every(result => result.status === STATUSES.AVAILABLE)) {
    return {
      status: STATUSES.AVAILABLE,
      reason: dailyStatuses.some(result => result.reason !== 'weekly_pattern')
        ? 'exception_or_weekly_pattern'
        : 'weekly_pattern',
    };
  }

  return { status: STATUSES.UNKNOWN, reason: 'range_not_fully_confirmed' };
}

function classifyCalendarFreshness(lastConfirmedAt, now = new Date()) {
  if (!lastConfirmedAt) {
    return 'never_confirmed';
  }

  const confirmedAt = new Date(lastConfirmedAt);
  if (
    Number.isNaN(confirmedAt.getTime()) ||
    Number.isNaN(now.getTime()) ||
    confirmedAt.getTime() > now.getTime() + 5 * 60 * 1000
  ) {
    return 'never_confirmed';
  }

  const ageDays = (now.getTime() - confirmedAt.getTime()) / 86400000;
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
      collection: 'suppliers',
      key: { 'geocoding.status': 1, 'geocoding.updatedAt': 1 },
      options: { sparse: true, name: 'suppliers_geocoding_status_updatedAt' },
    },
    {
      collection: 'supplierAvailabilityCalendars',
      key: { supplierId: 1 },
      options: { unique: true, name: 'availability_supplierId_unique' },
    },
    {
      collection: 'supplierAvailabilityExceptions',
      key: { supplierId: 1, startDate: 1, endDate: 1, status: 1 },
      options: { name: 'availability_exception_range' },
    },
  ];
}

module.exports = {
  STATUSES,
  normaliseUkPostcode,
  createGeoPoint,
  distanceMiles,
  assertLocalDate,
  assertDateRange,
  rangesOverlap,
  datesInRange,
  publicAvailabilityForRange,
  classifyCalendarFreshness,
  supplierAvailabilityIndexes,
};
