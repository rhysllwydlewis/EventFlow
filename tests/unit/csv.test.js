'use strict';

const { escapeCsvCell, serializeCsv } = require('../../utils/csv');

describe('CSV serialization', () => {
  test.each(['=2+2', '+SUM(A1:A2)', '-10+20', '@command'])(
    'neutralises spreadsheet formula value %s',
    value => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    }
  );

  test.each(['\t=1+1', '\tplain', '\r=1+1', '\rplain'])(
    'neutralises a cell that begins with a tab or carriage return: %j',
    value => {
      expect(escapeCsvCell(value).startsWith(`"'`)).toBe(true);
    }
  );

  test('leaves ordinary text, numbers and inner formula characters alone', () => {
    expect(escapeCsvCell('Hello = world')).toBe('"Hello = world"');
    expect(escapeCsvCell(42)).toBe('"42"');
    expect(escapeCsvCell('a\tb')).toBe('"a\tb"');
  });

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
