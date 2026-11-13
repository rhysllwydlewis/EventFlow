'use strict';

/**
 * Choosing which file of a Pexels video to hand to the browser.
 *
 * A Pexels video lists many renditions of the same clip (roughly 426x240 up to
 * 4K, landscape and sometimes portrait). Taking "the first `hd` file" ships
 * whatever Pexels happens to list first, which for the homepage collage was
 * regularly a 1080p or 1080x1920 file of 5-9 MB for a tile that renders at
 * a few hundred CSS pixels. The collage then cycles through several of them, so a
 * desktop visitor could download tens of megabytes without scrolling.
 *
 * `pickVideoFile` instead picks the smallest rendition that is still big
 * enough for the slot, using pixel area as the stand-in for file size (the
 * API does not report bytes).
 */

/** Smallest width the collage tiles are happy with: a 640x360 SD file. */
const COLLAGE_TILE_MIN_WIDTH = 640;

/** Larger slot (the hero video card), roughly a 960x540 file. */
const HERO_CARD_MIN_WIDTH = 960;

const area = file => (Number(file.width) || 0) * (Number(file.height) || 0);

const isPlayableVideo = file => {
  if (!file || typeof file.link !== 'string' || !file.link) {
    return false;
  }
  const type = file.fileType || file.file_type;
  // Pexels also lists HLS playlists; a <video src> pointed at one only plays in
  // Safari. Files with no declared type (the curated fallbacks) are mp4.
  return !type || /mp4/i.test(String(type));
};

/**
 * Pick the smallest rendition that is at least `minWidth` wide (16:9
 * equivalent), preferring landscape on a tie. When nothing is that large,
 * return the largest one available. Files that do not report dimensions fall
 * back to the old quality order (sd, then hd), so older or hand-written data
 * still resolves.
 *
 * @param {Array<Object>} files Video files (`videoFiles` or `video_files`).
 * @param {Object} [options] Options.
 * @param {number} [options.minWidth] Minimum width for the slot, in pixels.
 * @returns {Object|null} The chosen file, or null when none is playable.
 */
function pickVideoFile(files, { minWidth = COLLAGE_TILE_MIN_WIDTH } = {}) {
  const playable = (Array.isArray(files) ? files : []).filter(isPlayableVideo);
  if (playable.length === 0) {
    return null;
  }

  const sized = playable.filter(file => area(file) > 0);
  if (sized.length === 0) {
    return (
      playable.find(file => file.quality === 'sd') ||
      playable.find(file => file.quality === 'hd') ||
      playable[0]
    );
  }

  const minArea = minWidth * Math.round((minWidth * 9) / 16);
  const bigEnough = sized.filter(file => area(file) >= minArea);

  if (bigEnough.length === 0) {
    return sized.reduce((best, file) => (area(file) > area(best) ? file : best));
  }

  const isPortrait = file => Number(file.height) > Number(file.width);
  return bigEnough.reduce((best, file) => {
    if (area(file) !== area(best)) {
      return area(file) < area(best) ? file : best;
    }
    return isPortrait(best) && !isPortrait(file) ? file : best;
  });
}

module.exports = {
  COLLAGE_TILE_MIN_WIDTH,
  HERO_CARD_MIN_WIDTH,
  pickVideoFile,
};
