'use strict';

const { escapeCsvCell, serializeCsv } = require('../../utils/csv');

describe('CSV serialization', () => {
  test.each(['=2+2', '+SUM(A1:A2)', '-10+20', '@command'])(
    'neutralises spreadsheet formula value %s',
    value => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    }
  );

  test('escapes quotes, commas and line breaks without changing the cell structure', () => {
    expect(escapeCsvCell('Hello, "Rhys"\r\nSecond line')).toBe('"Hello, ""Rhys""\nSecond line"');
  });

  test('serialises a fixed-width UTF-8 CSV with a BOM by default', () => {
    const csv = serializeCsv(
      ['Name', 'Message'],
      [['Cŵm Events', '=HYPERLINK("https://example.test")'], ['Second supplier']]
    );

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Cŵm Events","\'=HYPERLINK(""https://example.test"")"');
    expect(csv.endsWith('"Second supplier",""')).toBe(true);
  });

  test('rejects malformed row inputs', () => {
    expect(() => serializeCsv('Name', [])).toThrow('CSV headers must be an array');
    expect(() => serializeCsv(['Name'], [{}])).toThrow('Each CSV row must be an array');
  });
});
