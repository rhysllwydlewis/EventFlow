'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { serializeCsv } = require('../utils/csv');
const legacySupplierRoutes = require('./supplier-legacy');

const router = express.Router();

function formatDate(value) {
  if (!value) {
    return 'N/A';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString('en-GB');
}

/**
 * GET /api/supplier/enquiries/export
 *
 * This route is intentionally registered before the legacy supplier router so
 * every enquiry export uses the shared spreadsheet-safe CSV serializer.
 */
router.get('/enquiries/export', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can export enquiries' });
    }

    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const [supplierEnquiries, users] = await Promise.all([
      dbUnified.find('quoteRequests', { supplierId: supplier.id }),
      dbUnified.read('users'),
    ]);
    const userMap = new Map((users || []).filter(Boolean).map(user => [user.id, user]));

    const headers = [
      'Date',
      'Customer Name',
      'Customer Email',
      'Event Type',
      'Event Date',
      'Location',
      'Budget',
      'Guest Count',
      'Status',
      'Message',
    ];

    const rows = (supplierEnquiries || []).map(enquiry => {
      const user = userMap.get(enquiry.customerId) || {};
      return [
        formatDate(enquiry.createdAt),
        user.name || 'N/A',
        user.email || 'N/A',
        enquiry.eventType || 'N/A',
        formatDate(enquiry.eventDate),
        enquiry.location || 'N/A',
        enquiry.budget || 'N/A',
        enquiry.guestCount ?? 'N/A',
        enquiry.status || 'pending',
        enquiry.message || '',
      ];
    });

    const csv = serializeCsv(headers, rows);
    const filenameDate = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="enquiries-${filenameDate}.csv"`);
    return res.send(csv);
  } catch (error) {
    logger.error('Error exporting enquiries:', error);
    return res.status(500).json({
      error: 'Failed to export enquiries',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

router.use(legacySupplierRoutes);

module.exports = router;
