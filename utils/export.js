/**
 * Export Utilities for EventFlow
 * Provides CSV, Excel, and PDF export functionality
 */

'use strict';

// eslint-plugin-node 11.x (unmaintained, predates nested conditional exports
// maps) can't resolve pdfkit >=0.20's `exports["."].node.require` field and
// reports it as missing, even though Node itself resolves it correctly.
// eslint-disable-next-line node/no-missing-require
const PDFDocument = require('pdfkit');
const logger = require('./logger');

/**
 * Convert array of objects to CSV string
 * @param {Array<Object>} data - Array of objects to convert
 * @param {Array<string>} headers - Optional array of header names
 * @returns {string} CSV string
 */
function arrayToCSV(data, headers = null) {
  if (!data || data.length === 0) {
    return '';
  }

  // Get headers from first object if not provided
  const csvHeaders = headers || Object.keys(data[0]);

  // Build CSV rows
  const rows = data.map(row => {
    return csvHeaders
      .map(header => {
        const value = row[header];
        // Handle null/undefined
        if (value === null || value === undefined) {
          return '';
        }
        // Handle strings with commas or quotes
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      })
      .join(',');
  });

  // Add header row
  const headerRow = csvHeaders.join(',');
  return [headerRow, ...rows].join('\n');
}

/**
 * Export data as CSV
 * @param {Array<Object>} data - Data to export
 * @param {Object} options - Export options
 * @returns {Object} CSV data and metadata
 */
function exportToCSV(data, options = {}) {
  const { filename = 'export.csv', headers = null } = options;

  const csv = arrayToCSV(data, headers);

  return {
    data: csv,
    filename,
    contentType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  };
}

/**
 * Export data as Excel
 * @param {Array<Object>} data - Data to export
 * @param {Object} options - Export options
 * @returns {Object} Excel data and metadata
 */
function exportToExcel(data, options = {}) {
  const { filename = 'export.xlsx', sheetName = 'Sheet1', headers = null } = options;

  // Feature flag: disable XLSX export in hardened environments
  if (process.env.DISABLE_XLSX_EXPORT === 'true') {
    logger.info('XLSX export disabled by DISABLE_XLSX_EXPORT flag, falling back to CSV');
    return exportToCSV(data, { filename: filename.replace('.xlsx', '.csv'), headers });
  }

  try {
    // eslint-disable-next-line global-require, node/no-missing-require, node/no-unpublished-require
    const XLSX = require('xlsx');

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Convert data to worksheet
    const worksheet = XLSX.utils.json_to_sheet(data, {
      header: headers || undefined,
    });

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // Generate buffer
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
    });

    return {
      data: buffer,
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    };
  } catch (error) {
    logger.error('Excel export error:', error);
    // Fallback to CSV if Excel export fails
    return exportToCSV(data, { filename: filename.replace('.xlsx', '.csv'), headers });
  }
}

/**
 * Export data as PDF
 * @param {Array<Object>} data - Data to export
 * @param {Object} options - Export options
 * @returns {Promise<Object>} PDF data and metadata
 */
function exportToPDF(data, options = {}) {
  const {
    filename = 'export.pdf',
    title = 'Export Report',
    headers = null,
    orientation = 'portrait',
  } = options;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: orientation,
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          data: buffer,
          filename,
          contentType: 'application/pdf',
          buffer,
        });
      });
      doc.on('error', reject);

      // Add title
      doc.fontSize(20).text(title, { align: 'center' });
      doc.moveDown();

      // Add timestamp
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
      doc.moveDown();

      if (data.length === 0) {
        doc.fontSize(12).text('No data to display');
      } else {
        // Get headers
        const pdfHeaders = headers || Object.keys(data[0]);

        // Add table header
        doc.fontSize(10).font('Helvetica-Bold');
        let y = doc.y;
        const columnWidth = (doc.page.width - 100) / pdfHeaders.length;

        pdfHeaders.forEach((header, i) => {
          doc.text(header, 50 + i * columnWidth, y, {
            width: columnWidth,
            align: 'left',
          });
        });

        doc.font('Helvetica');
        doc.moveDown();

        // Add data rows
        data.forEach((row, rowIndex) => {
          // Check if we need a new page
          if (doc.y > doc.page.height - 100) {
            doc.addPage();
          }

          y = doc.y;
          pdfHeaders.forEach((header, i) => {
            const value = row[header];
            const text = value !== null && value !== undefined ? String(value) : '';
            doc.text(text, 50 + i * columnWidth, y, {
              width: columnWidth,
              align: 'left',
              ellipsis: true,
            });
          });

          // Add separator line after every 5 rows
          if ((rowIndex + 1) % 5 === 0) {
            doc
              .moveTo(50, doc.y)
              .lineTo(doc.page.width - 50, doc.y)
              .stroke('#CCCCCC');
          }

          doc.moveDown(0.5);
        });
      }

      // Add footer
      const pageCount = doc.bufferedPageRange().count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .text(`Page ${i + 1} of ${pageCount}`, 50, doc.page.height - 50, { align: 'center' });
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Export middleware for Express routes
 * @param {Function} dataFetcher - Async function that returns data to export
 * @param {Object} defaultOptions - Default export options
 * @returns {Function} Express middleware
 */
function exportMiddleware(dataFetcher, defaultOptions = {}) {
  return async (req, res, next) => {
    try {
      const format = req.query.format || 'csv';
      const filename = req.query.filename || defaultOptions.filename;

      // Fetch data
      const data = await dataFetcher(req);

      if (!Array.isArray(data)) {
        return res.status(400).json({
          error: 'Export data must be an array',
        });
      }

      const options = {
        ...defaultOptions,
        filename,
      };

      let result;

      switch (format.toLowerCase()) {
        case 'csv':
          result = exportToCSV(data, options);
          break;
        case 'excel':
        case 'xlsx':
          if (process.env.DISABLE_XLSX_EXPORT === 'true') {
            return res.status(400).json({
              error: 'XLSX export is disabled in this environment',
              supportedFormats: ['csv', 'pdf'],
            });
          }
          result = exportToExcel(data, options);
          break;
        case 'pdf':
          result = await exportToPDF(data, options);
          break;
        default:
          return res.status(400).json({
            error: 'Unsupported export format',
            supportedFormats: ['csv', 'excel', 'xlsx', 'pdf'],
          });
      }

      // Set headers
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.setHeader('Content-Length', result.buffer.length);

      // Send file
      res.send(result.buffer);
    } catch (error) {
      logger.error('Export error:', error);
      next(error);
    }
  };
}

module.exports = {
  arrayToCSV,
  exportToCSV,
  exportToExcel,
  exportToPDF,
  exportMiddleware,
};
