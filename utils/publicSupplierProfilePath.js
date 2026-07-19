'use strict';

const { buildPublicSupplierSlug } = require('../services/publicSupplierSeo.service');

function addPublicProfilePath(supplier) {
  if (!supplier || typeof supplier !== 'object') {
    return supplier;
  }

  const supplierName = supplier.name || supplier.businessName || supplier.company;
  if (!supplier.id || !supplierName) {
    return supplier;
  }

  const slug = buildPublicSupplierSlug({ ...supplier, name: supplierName });
  if (!slug) {
    return supplier;
  }

  return {
    ...supplier,
    publicProfilePath: `/supplier/${slug}`,
  };
}

function addPublicProfilePaths(searchResults) {
  const output = { ...(searchResults || {}) };

  if (Array.isArray(output.results)) {
    output.results = output.results.map(addPublicProfilePath);
  }

  if (output.fallback && Array.isArray(output.fallback.suggestions)) {
    output.fallback = {
      ...output.fallback,
      suggestions: output.fallback.suggestions.map(addPublicProfilePath),
    };
  }

  return output;
}

module.exports = {
  addPublicProfilePath,
  addPublicProfilePaths,
};
