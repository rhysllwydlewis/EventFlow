/**
 * Seasonal navbar theme — the scheduling rule.
 *
 * Which theme (if any) the public navbar wears is a pure function of the saved
 * admin settings and today's date in the UK. There is deliberately no timed job
 * that "switches a theme on at midnight": a job can be missed by a restart or a
 * deploy, or run twice across instances, whereas a rule evaluated on demand
 * cannot. Midnight UK time simply arrives and the next request sees the new
 * answer (the public endpoint caps its cache so that happens within minutes).
 *
 * Everything here works on whole calendar days ("day numbers" — days since the
 * Unix epoch, counted in UTC so daylight-saving changes cannot shift a date).
 * The only place a clock is read is {@link ukDayNumber}, and every public
 * function takes `now` so tests can pin it.
 *
 * Settings shape (stored as `settings.seasonalTheme`):
 *   auto            true: follow each occasion's dates. false: use manualTheme.
 *   manualTheme     occasion key, or null for the normal site (auto === false).
 *   returnToAutoOn  optional 'YYYY-MM-DD'; from that day a manual choice hands
 *                   back to the automatic schedule.
 *   excluded        occasion keys the automatic schedule should skip.
 *
 * Nothing saved means no theme: shipping this changes nothing until an admin
 * opts in.
 */

'use strict';

const TIME_ZONE = 'Europe/London';
const MS_PER_DAY = 86400000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Chinese New Year (month, day) by year. Outside this table that occasion stays off. */
const CHINESE_NEW_YEAR = Object.freeze({
  2025: [1, 29],
  2026: [2, 17],
  2027: [2, 6],
  2028: [1, 26],
  2029: [2, 13],
  2030: [2, 3],
  2031: [1, 23],
  2032: [2, 11],
  2033: [1, 31],
  2034: [2, 19],
  2035: [2, 8],
});
const CHINESE_NEW_YEAR_LAST_YEAR = Math.max(...Object.keys(CHINESE_NEW_YEAR).map(Number));

const dayNumber = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);

function fromDayNumber(n) {
  const date = new Date(n * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const pad = value => String(value).padStart(2, '0');

function formatDayNumber(n) {
  const { year, month, day } = fromDayNumber(n);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Parse a strict 'YYYY-MM-DD' calendar date.
 * @param {*} value Candidate string.
 * @returns {number|null} Day number, or null when not a real calendar date.
 */
function parseIsoDate(value) {
  const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = dayNumber(year, month, day);
  const back = fromDayNumber(parsed);
  return back.year === year && back.month === month && back.day === day ? parsed : null;
}

const makeFormatter = timeZone =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

/**
 * This module is loaded when the server starts, so a runtime without timezone data
 * must not stop it booting over a decorative feature. UTC is at worst an hour out
 * during summer time, which only moves a changeover by an hour.
 */
const ukPartsFormatter = (() => {
  try {
    return makeFormatter(TIME_ZONE);
  } catch {
    return makeFormatter('UTC');
  }
})();

function ukParts(now) {
  const parts = {};
  for (const { type, value } of ukPartsFormatter.formatToParts(now)) {
    parts[type] = Number(value);
  }
  return parts;
}

/**
 * Today's calendar day in the UK.
 * @param {Date} [now] Instant to evaluate.
 * @returns {number} Day number.
 */
function ukDayNumber(now = new Date()) {
  const { year, month, day } = ukParts(now);
  return dayNumber(year, month, day);
}

/**
 * Seconds until the UK date next changes. Used to stop the public endpoint's
 * cache outliving a changeover. (Daylight-saving shifts happen in the small
 * hours, so this is exact for the only case that matters: the minutes before
 * midnight.)
 * @param {Date} [now] Instant to evaluate.
 * @returns {number} Whole seconds, at least 1.
 */
function secondsUntilUkMidnight(now = new Date()) {
  const { hour, minute, second } = ukParts(now);
  return Math.max(1, 24 * 3600 - (hour * 3600 + minute * 60 + second));
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(year) {
  // Variable names follow the published algorithm (Meeus/Jones/Butcher).
  const cycle = year % 19;
  const century = Math.floor(year / 100);
  const yearInCentury = year % 100;
  const centuryLeaps = Math.floor(century / 4);
  const centuryRemainder = century % 4;
  const correction = Math.floor((8 * century + 13) / 25);
  const epact = (19 * cycle + century - centuryLeaps - correction + 15) % 30;
  const leapsInCentury = Math.floor(yearInCentury / 4);
  const leapRemainder = yearInCentury % 4;
  const weekdayOffset =
    (32 + 2 * centuryRemainder + 2 * leapsInCentury - epact - leapRemainder) % 7;
  const adjustment = Math.floor((cycle + 11 * epact + 22 * weekdayOffset) / 451);
  const month = Math.floor((epact + weekdayOffset - 7 * adjustment + 114) / 31);
  const day = ((epact + weekdayOffset - 7 * adjustment + 114) % 31) + 1;
  return dayNumber(year, month, day);
}

/** The nth Sunday of a month (n = 1 for the first). */
function nthSunday(year, month, n) {
  const first = dayNumber(year, month, 1);
  const weekday = new Date(first * MS_PER_DAY).getUTCDay();
  return first + ((7 - weekday) % 7) + (n - 1) * 7;
}

/**
 * Occasions, in priority order: when windows overlap the earlier entry wins, so
 * the occasions whose date moves each year come first (Chinese New Year beats
 * Valentine's Day in the years they collide). `window(year)` returns the first
 * and last day (inclusive) of that year's occurrence, or null.
 */
const OCCASIONS = Object.freeze([
  {
    key: 'chinese-new-year',
    name: 'Chinese New Year',
    moves: true,
    window(year) {
      const date = CHINESE_NEW_YEAR[year];
      if (!date) {
        return null;
      }
      const day = dayNumber(year, date[0], date[1]);
      return [day - 1, day + 7];
    },
  },
  {
    key: 'easter',
    name: 'Easter',
    moves: true,
    window(year) {
      const easter = easterSunday(year);
      return [easter - 10, easter + 1];
    },
  },
  {
    key: 'mothers-day',
    name: "Mother's Day",
    moves: true,
    window(year) {
      const mothering = easterSunday(year) - 21;
      return [mothering - 7, mothering];
    },
  },
  {
    key: 'fathers-day',
    name: "Father's Day",
    moves: true,
    window(year) {
      const sunday = nthSunday(year, 6, 3);
      return [sunday - 7, sunday];
    },
  },
  {
    key: 'halloween',
    name: 'Halloween',
    moves: false,
    window: year => [dayNumber(year, 10, 20), dayNumber(year, 11, 1)],
  },
  {
    key: 'bonfire',
    name: 'Bonfire Night',
    moves: false,
    window: year => [dayNumber(year, 11, 2), dayNumber(year, 11, 6)],
  },
  {
    key: 'remembrance',
    name: 'Remembrance',
    moves: true,
    window(year) {
      const sunday = nthSunday(year, 11, 2);
      return [dayNumber(year, 11, 7), Math.max(sunday, dayNumber(year, 11, 11))];
    },
  },
  {
    key: 'christmas',
    name: 'Christmas',
    moves: false,
    window: year => [dayNumber(year, 12, 1), dayNumber(year, 12, 26)],
  },
  {
    key: 'new-year',
    name: 'New Year',
    moves: false,
    window: year => [dayNumber(year, 12, 27), dayNumber(year + 1, 1, 2)],
  },
  {
    key: 'valentines',
    name: "Valentine's Day",
    moves: false,
    window: year => [dayNumber(year, 2, 8), dayNumber(year, 2, 14)],
  },
]);

const THEME_KEYS = Object.freeze(OCCASIONS.map(occasion => occasion.key));
const OCCASION_BY_KEY = Object.freeze(
  Object.fromEntries(OCCASIONS.map(occasion => [occasion.key, occasion]))
);

const DEFAULT_SETTINGS = Object.freeze({
  auto: false,
  manualTheme: null,
  returnToAutoOn: null,
  excluded: Object.freeze([]),
});

/**
 * Coerce whatever is stored into a well-formed settings object, so a hand-edited
 * or partly written record can never make the rule throw or pick a bad theme.
 * @param {*} raw Stored `settings.seasonalTheme` value.
 * @returns {{auto: boolean, manualTheme: string|null, returnToAutoOn: string|null, excluded: string[]}} Clean settings.
 */
function normalizeSettings(raw) {
  const record = raw && typeof raw === 'object' ? raw : {};
  const excluded = Array.isArray(record.excluded)
    ? THEME_KEYS.filter(key => record.excluded.includes(key))
    : [];
  return {
    auto: record.auto === true,
    manualTheme: THEME_KEYS.includes(record.manualTheme) ? record.manualTheme : null,
    returnToAutoOn: parseIsoDate(record.returnToAutoOn) === null ? null : record.returnToAutoOn,
    excluded,
  };
}

/**
 * Validate an admin's submitted settings. Unlike {@link normalizeSettings} this
 * rejects bad input with a message rather than quietly dropping it.
 * @param {*} body Request body.
 * @returns {{ok: true, value: object}|{ok: false, error: string}} Result.
 */
function validateSettingsInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A settings object is required' };
  }
  if (typeof body.auto !== 'boolean') {
    return { ok: false, error: 'auto must be true or false' };
  }

  const manualTheme = body.manualTheme === undefined ? null : body.manualTheme;
  if (manualTheme !== null && !THEME_KEYS.includes(manualTheme)) {
    return { ok: false, error: `manualTheme must be null or one of: ${THEME_KEYS.join(', ')}` };
  }

  let returnToAutoOn = body.returnToAutoOn === undefined ? null : body.returnToAutoOn;
  if (returnToAutoOn === '') {
    returnToAutoOn = null;
  }
  if (returnToAutoOn !== null && parseIsoDate(returnToAutoOn) === null) {
    return { ok: false, error: 'returnToAutoOn must be a real date in YYYY-MM-DD format' };
  }

  const excludedInput = body.excluded === undefined ? [] : body.excluded;
  if (!Array.isArray(excludedInput) || excludedInput.some(key => !THEME_KEYS.includes(key))) {
    return { ok: false, error: `excluded must be a list of: ${THEME_KEYS.join(', ')}` };
  }

  return {
    ok: true,
    value: {
      auto: body.auto,
      // A manual theme and a return date only mean something while auto is off.
      manualTheme: body.auto ? null : manualTheme,
      returnToAutoOn: body.auto ? null : returnToAutoOn,
      excluded: THEME_KEYS.filter(key => excludedInput.includes(key)),
    },
  };
}

/** The occasion whose window contains the day, honouring skipped occasions. */
function activeOccasion(day, excluded = []) {
  const { year } = fromDayNumber(day);
  for (const occasion of OCCASIONS) {
    if (excluded.includes(occasion.key)) {
      continue;
    }
    // A window can start in the previous year (New Year) or, rarely, reach into the next.
    for (let candidate = year - 1; candidate <= year + 1; candidate += 1) {
      const window = occasion.window(candidate);
      if (window && day >= window[0] && day <= window[1]) {
        return occasion.key;
      }
    }
  }
  return null;
}

/**
 * The rule itself, for one calendar day.
 * @param {object} settings Normalised settings.
 * @param {number} day Day number.
 * @returns {{theme: string|null, source: 'auto'|'manual'|'returned'}} Result.
 */
function resolveForDay(settings, day) {
  const automatic = activeOccasion(day, settings.excluded);
  if (settings.auto) {
    return { theme: automatic, source: 'auto' };
  }
  const returnOn = parseIsoDate(settings.returnToAutoOn);
  if (returnOn !== null && day >= returnOn) {
    return { theme: automatic, source: 'returned' };
  }
  return { theme: settings.manualTheme, source: 'manual' };
}

/**
 * Which theme the public navbar should wear right now.
 * @param {*} rawSettings Stored `settings.seasonalTheme` (any shape).
 * @param {Date} [now] Instant to evaluate.
 * @returns {{theme: string|null, source: string, ukDate: string}} Result.
 */
function resolveTheme(rawSettings, now = new Date()) {
  const day = ukDayNumber(now);
  return { ...resolveForDay(normalizeSettings(rawSettings), day), ukDate: formatDayNumber(day) };
}

/**
 * The next day the answer changes, for the admin screen.
 * @param {*} rawSettings Stored settings.
 * @param {Date} [now] Instant to evaluate.
 * @returns {{date: string, theme: string|null}|null} The changeover, or null when nothing will change by itself.
 */
function nextChange(rawSettings, now = new Date()) {
  const settings = normalizeSettings(rawSettings);
  const today = ukDayNumber(now);
  const current = resolveForDay(settings, today).theme;
  for (let offset = 1; offset <= 420; offset += 1) {
    const result = resolveForDay(settings, today + offset);
    if (result.theme !== current) {
      return { date: formatDayNumber(today + offset), theme: result.theme };
    }
  }
  return null;
}

/**
 * Every occasion's current-or-next window, for the admin screen.
 * @param {Date} [now] Instant to evaluate.
 * @returns {Array<{key: string, name: string, moves: boolean, start: string|null, end: string|null}>} Occasions in date order.
 */
function upcomingWindows(now = new Date()) {
  const today = ukDayNumber(now);
  const { year } = fromDayNumber(today);
  return OCCASIONS.map(occasion => {
    let found = null;
    for (let candidate = year - 1; candidate <= year + 2 && !found; candidate += 1) {
      const window = occasion.window(candidate);
      if (window?.[1] >= today) {
        found = window;
      }
    }
    return {
      key: occasion.key,
      name: occasion.name,
      moves: occasion.moves,
      start: found ? formatDayNumber(found[0]) : null,
      end: found ? formatDayNumber(found[1]) : null,
    };
  }).sort((a, b) => {
    if (!a.start || !b.start) {
      return a.start ? -1 : b.start ? 1 : 0;
    }
    return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });
}

module.exports = {
  TIME_ZONE,
  OCCASIONS,
  THEME_KEYS,
  OCCASION_BY_KEY,
  DEFAULT_SETTINGS,
  CHINESE_NEW_YEAR_LAST_YEAR,
  normalizeSettings,
  validateSettingsInput,
  resolveTheme,
  nextChange,
  upcomingWindows,
  secondsUntilUkMidnight,
  // Exposed for tests.
  dayNumber,
  formatDayNumber,
  parseIsoDate,
  ukDayNumber,
  easterSunday,
  nthSunday,
  activeOccasion,
};
