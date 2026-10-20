/**
 * Shared field-presence checks for "is this supplier profile complete
 * enough" questions.
 *
 * These two checks were previously copy-pasted (with a "mirrors X" comment
 * asking readers to hand-keep them in sync) across services/actionPromptService.js
 * and routes/supplier.js, with actionPromptService's copy using a looser
 * raw-array-length check that could disagree with the deduplicated count
 * used everywhere else. Centralising them here means there's one place to
 * fix a schema change (e.g. a new photo-storage field) instead of several.
 *
 * public/assets/js/components/profile-health-widget.js runs in the browser
 * and has no access to this module — it stays a hand-synced mirror of
 * getSupplierGalleryCount()/hasSupplierPostcode() by design, documented at
 * its own call sites.
 */

'use strict';

/**
 * Count of a supplier's unique gallery photos, merging the canonical
 * photosGallery array with the legacy images array so a photo stored under
 * either schema generation counts once.
 *
 * @param {Object} supplier - Supplier document
 * @returns {number} Unique photo count
 */
function getSupplierGalleryCount(supplier) {
  return new Set(
    [
      ...(Array.isArray(supplier.photosGallery) ? supplier.photosGallery : []),
      ...(Array.isArray(supplier.images) ? supplier.images : []),
    ]
      .map(item =>
        typeof item === 'string'
          ? item.trim()
          : String(
              item?.url ||
                item?.large ||
                item?.optimized ||
                item?.original ||
                item?.thumbnail ||
                item?.src ||
                ''
            ).trim()
      )
      .filter(Boolean)
  ).size;
}

/**
 * Whether a supplier has at least one gallery photo under either schema
 * generation.
 *
 * @param {Object} supplier - Supplier document
 * @returns {boolean}
 */
function hasSupplierGalleryPhotos(supplier) {
  return getSupplierGalleryCount(supplier) > 0;
}

/**
 * Whether a supplier has a postcode on file. basePostcode is what the
 * dashboard's postcode input actually saves to (sup-base-postcode);
 * venuePostcode is the Venues-category alternative. Plain `postcode` isn't
 * written anywhere by any supplier-facing form.
 *
 * @param {Object} supplier - Supplier document
 * @returns {boolean}
 */
function hasSupplierPostcode(supplier) {
  return Boolean(String(supplier.basePostcode || supplier.venuePostcode || '').trim());
}

/**
 * Merge a supplier's canonical socialLinks with the legacy socials object.
 *
 * A populated legacy value survives an empty canonical key (migrated records
 * can carry both schema generations); a non-empty canonical value always wins.
 * This is the same rule as socialLinks() in profile-health-widget.js.
 *
 * @param {Object} supplier - Supplier document
 * @returns {Object} Merged platform -> url map
 */
function mergeSupplierSocialLinks(supplier) {
  const asPlainObject = value =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const merged = { ...asPlainObject(supplier?.socials) };
  Object.entries(asPlainObject(supplier?.socialLinks)).forEach(([platform, url]) => {
    if (url || !merged[platform]) {
      merged[platform] = url;
    }
  });
  return merged;
}

/**
 * Count of a supplier's populated social platforms across both schema generations.
 *
 * @param {Object} supplier - Supplier document
 * @returns {number} Populated social-platform count
 */
function getSupplierSocialLinkCount(supplier) {
  return Object.values(mergeSupplierSocialLinks(supplier)).filter(Boolean).length;
}

/**
 * The seven weighted profile-completeness checks, in display order.
 *
 * THIS LIST MUST STAY IN AGREEMENT with HEALTH_CRITERIA in
 * public/assets/js/components/profile-health-widget.js: same ids, same labels,
 * same weights, same pass/fail rules. tests/unit/supplier-profile-completeness.test.js
 * loads that browser file and feeds both implementations the same fixtures, so
 * a change to one without the other fails CI.
 *
 * The browser widget scores the hydrated /api/me/suppliers item (profile photo
 * falls back to the owner account's avatar), so callers should pass a supplier
 * that has gone through hydrateSupplierProfilePhoto() to get the same answer.
 *
 * `href` is a navigation hint for the page that lets the supplier fix the item.
 */
const PROFILE_COMPLETENESS_CHECKS = [
  {
    id: 'logo',
    label: 'Profile photo',
    weight: 15,
    href: '/dashboard/supplier#my-suppliers',
    test: supplier =>
      Boolean(
        supplier.logo || supplier.profileImage || supplier.profilePhotoUrl || supplier.avatarUrl
      ),
  },
  {
    id: 'description',
    label: 'Description (100+ characters)',
    weight: 15,
    href: '/dashboard/supplier#my-suppliers',
    test: supplier =>
      String(
        supplier.description_long ||
          supplier.description_short ||
          supplier.description ||
          supplier.blurb ||
          ''
      ).trim().length >= 100,
  },
  {
    id: 'location',
    label: 'Location & postcode',
    weight: 15,
    href: '/dashboard/supplier#my-suppliers',
    test: supplier =>
      Boolean(supplier.location) && Boolean(supplier.basePostcode || supplier.venuePostcode),
  },
  {
    id: 'coverImage',
    label: 'Banner image',
    weight: 15,
    href: '/supplier/profile-customization#sup-banner-drop',
    test: supplier => Boolean(supplier.bannerUrl || supplier.coverImage),
  },
  {
    id: 'gallery',
    label: 'Gallery (3+ images)',
    weight: 15,
    href: '/dashboard/supplier#my-suppliers',
    test: supplier => getSupplierGalleryCount(supplier) >= 3,
  },
  {
    id: 'socials',
    label: 'Social media (2+ platforms)',
    weight: 15,
    href: '/supplier/profile-customization#sup-social-facebook',
    test: supplier => getSupplierSocialLinkCount(supplier) >= 2,
  },
  {
    id: 'website',
    label: 'Website URL',
    weight: 10,
    href: '/dashboard/supplier#my-suppliers',
    test: supplier => Boolean(supplier.website),
  },
];

/**
 * Compute the one server-side profile-completeness score.
 *
 * @param {Object} supplier - Supplier document (ideally photo-hydrated)
 * @returns {{score: number, checks: Array<{id: string, label: string, weight: number, done: boolean, href: string}>}}
 *   `score` is 0-100 and equals the browser widget's `percentage`.
 */
function computeProfileCompleteness(supplier) {
  const source = supplier && typeof supplier === 'object' ? supplier : {};
  const checks = PROFILE_COMPLETENESS_CHECKS.map(check => ({
    id: check.id,
    label: check.label,
    weight: check.weight,
    done: check.test(source),
    href: check.href,
  }));
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earnedWeight = checks.reduce((sum, check) => sum + (check.done ? check.weight : 0), 0);
  return { score: Math.round((earnedWeight / totalWeight) * 100), checks };
}

module.exports = {
  getSupplierGalleryCount,
  getSupplierSocialLinkCount,
  hasSupplierGalleryPhotos,
  hasSupplierPostcode,
  computeProfileCompleteness,
  PROFILE_COMPLETENESS_CHECKS,
};
