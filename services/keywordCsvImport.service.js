/**
 * Fallback keyword-volume ingestion: parses a CSV exported from the
 * Google Keyword Planner UI ("Download keyword ideas") and stores it in
 * the same seo_keyword_ideas shape the Google Ads API path uses. This
 * needs no API/developer-token approval — just a manual export/upload,
 * done whenever the admin wants fresher volume data.
 *
 * No CSV parsing library is added for this: the export format is simple
 * enough (a handful of metadata lines, then a standard header row) that
 * a small RFC4180-ish parser here is less overhead than a dependency.
 */

'use strict';

const logger = require('../utils/logger');
const seoDataStore = require('./seoDataStore');
const {
  COLLECTIONS,
  KEYWORD_SOURCES,
  INGESTION_SOURCES,
  INGESTION_STATUS,
  normaliseKeyword,
} = require('../models/SeoInsights');

/** Splits one CSV line into fields, honouring double-quoted fields that may contain commas. */
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map(f => f.trim());
}

/**
 * Parses one side of a volume figure, e.g. "1,000" or "1.5K". Plain
 * character-by-character validation, not a regex — no quantifiers at all,
 * so there is no backtracking of any kind to worry about, adversarial
 * input or not. Returns a number, or null if the text isn't a plain figure.
 */
function parseSingleFigure(rawText) {
  let text = String(rawText || '').trim();
  if (!text) {
    return null;
  }

  let hasK = false;
  const lastChar = text[text.length - 1];
  if (lastChar === 'k' || lastChar === 'K') {
    hasK = true;
    text = text.slice(0, -1).trimEnd();
  }
  if (!text) {
    return null;
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const isDigit = ch >= '0' && ch <= '9';
    if (!isDigit && ch !== ',' && ch !== '.') {
      return null;
    }
  }

  const n = parseFloat(text.replaceAll(',', ''));
  if (!Number.isFinite(n)) {
    return null;
  }
  return hasK ? n * 1000 : n;
}

/**
 * Google's "Avg. monthly searches" column is sometimes an exact number and
 * sometimes a bucketed range like "1K – 10K" for accounts without enough
 * ad spend history. Returns { value, isBucketed }.
 *
 * The range case is split on the dash first (plain string search, not
 * regex) and each side parsed independently — matching the whole "low -
 * high" shape with one regex let an adversarial string with many
 * repetitions of digits/spaces and no dash force polynomial backtracking
 * before the match failed.
 */
function parseVolume(raw) {
  const text = String(raw || '').trim();
  if (!text || text === '-' || text.toLowerCase() === 'n/a') {
    return { value: null, isBucketed: false };
  }

  const dashIndex = text.search(/[-–]/u);
  if (dashIndex !== -1) {
    const low = parseSingleFigure(text.slice(0, dashIndex));
    const high = parseSingleFigure(text.slice(dashIndex + 1));
    if (low !== null && high !== null) {
      return { value: Math.round((low + high) / 2), isBucketed: true };
    }
  }

  const single = parseSingleFigure(text);
  if (single !== null) {
    return { value: Math.round(single), isBucketed: false };
  }

  return { value: null, isBucketed: false };
}

/**
 * Parses a Keyword Planner CSV export. Google's export includes a few
 * metadata lines before the real header row, so we scan for the row whose
 * first cell is "Keyword" rather than assuming line 1 is the header.
 */
function parseKeywordPlannerCsv(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0);

  const headerIndex = lines.findIndex(line => splitCsvLine(line)[0]?.toLowerCase() === 'keyword');
  if (headerIndex === -1) {
    throw new Error(
      'Could not find a "Keyword" header row in this file. Export it from Keyword Planner via ' +
        '"Download keyword ideas" as CSV and upload it unedited.'
    );
  }

  const header = splitCsvLine(lines[headerIndex]).map(h => h.toLowerCase());
  const keywordCol = header.indexOf('keyword');
  const volumeCol = header.findIndex(
    h => h.includes('avg. monthly searches') || h.includes('avg monthly searches')
  );
  const competitionCol = header.findIndex(h => h === 'competition');

  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const fields = splitCsvLine(lines[i]);
    const keyword = normaliseKeyword(fields[keywordCol]);
    if (!keyword) {
      continue;
    }
    const { value, isBucketed } = parseVolume(volumeCol >= 0 ? fields[volumeCol] : null);
    rows.push({
      keyword,
      avgMonthlySearches: value,
      volumeIsBucketed: isBucketed,
      competition: competitionCol >= 0 ? fields[competitionCol] || null : null,
    });
  }

  return rows;
}

/**
 * Parses and stores a Keyword Planner CSV export, source = 'csv_import'.
 */
async function importCsv({ csvText, importedBy }) {
  const rows = parseKeywordPlannerCsv(csvText);

  const importedAt = new Date().toISOString();
  let written = 0;
  for (const row of rows) {
    const docId = `${KEYWORD_SOURCES.csvImport}:${row.keyword}`;
    await seoDataStore.upsertById(COLLECTIONS.seoKeywordIdeas, docId, {
      keyword: row.keyword,
      avgMonthlySearches: row.avgMonthlySearches,
      volumeIsBucketed: row.volumeIsBucketed,
      competition: row.competition,
      source: KEYWORD_SOURCES.csvImport,
      importedAt,
      importedBy: importedBy || 'admin',
    });
    written += 1;
  }

  await seoDataStore.recordIngestionStatus(INGESTION_SOURCES.keywordCsv, INGESTION_STATUS.success, {
    lastError: null,
    rowsWritten: written,
    triggeredBy: importedBy,
  });

  logger.info(`SEO: imported ${written} keyword rows from CSV (by ${importedBy || 'admin'})`);
  return { rowsParsed: rows.length, rowsWritten: written };
}

module.exports = { parseKeywordPlannerCsv, parseVolume, importCsv };
