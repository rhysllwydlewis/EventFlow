'use strict';

const FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

function csvText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Serialise one spreadsheet-safe CSV cell.
 *
 * All cells are quoted, embedded quotes are doubled and formula-leading values
 * are prefixed with an apostrophe so spreadsheet applications treat them as text.
 */
function escapeCsvCell(value) {
  let text = csvText(value).replace(/\r\n?/g, '\n');
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeCsv(headers, rows, options = {}) {
  if (!Array.isArray(headers)) {
    throw new TypeError('CSV headers must be an array');
  }
  if (!Array.isArray(rows)) {
    throw new TypeError('CSV rows must be an array');
  }

  const width = headers.length;
  const lines = [headers.map(escapeCsvCell).join(',')];

  for (const row of rows) {
    if (!Array.isArray(row)) {
      throw new TypeError('Each CSV row must be an array');
    }
    const normalised = Array.from({ length: width }, (_, index) => row[index]);
    lines.push(normalised.map(escapeCsvCell).join(','));
  }

  const csv = lines.join('\r\n');
  return options.bom === false ? csv : `\uFEFF${csv}`;
}

module.exports = {
  escapeCsvCell,
  serializeCsv,
};
