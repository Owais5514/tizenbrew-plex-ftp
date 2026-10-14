const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.m4v', '.wmv', '.flv'
]);

const SUBTITLE_EXTENSIONS = new Set([
  '.srt', '.vtt', '.sub'
]);

/**
 * Clean release group junk, codecs, resolutions from media titles.
 */
const QUALITY_REGEX = /(2160p|4k|1080p|720p|480p|uhd|fhd|hdr|remux|bluray|web-dl|webrip|hdtv|x264|x265|hevc|aac|dts)/i;
const TV_EPISODE_REGEX = /[sS](\d{1,2})[eE](\d{1,2})/i;
const ANIME_EPISODE_REGEX = /(?:-\s*|\b(?:ep|episode)\s*)(\d{1,4})(?:\b|\s|\.|$)/i;
const YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/;

class MediaScanner {
  static isVideo(filename) {
    const ext = path.extname(filename).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  }

  static isSubtitle(filename) {
    const ext = path.extname(filename).toLowerCase();
    return SUBTITLE_EXTENSIONS.has(ext);
  }

  /**
   * Parse a raw filename into clean metadata for a Plex/Netflix-like card.
   */
  static parseFilename(filename, fullPath = '') {
    const ext = path.extname(filename);
    const baseName = path.basename(filename, ext);

    // Strip bracketed hashes/groups e.g. [SubsPlease], [1080p], (2023)
    let cleanName = baseName
      .replace(/\[.*?\]|\(.*?\)/g, ' ')
      .replace(/[._]/g, ' ')
      .trim();

    // 1. Check TV show format (e.g. S01E05)
    const tvMatch = baseName.match(TV_EPISODE_REGEX);
    let isTvShow = false;
    let season = null;
    let episode = null;
    let showTitle = null;

    if (tvMatch) {
      isTvShow = true;
      season = parseInt(tvMatch[1], 10);
      episode = parseInt(tvMatch[2], 10);
      const splitIdx = baseName.search(TV_EPISODE_REGEX);
      if (splitIdx > 0) {
        showTitle = baseName.substring(0, splitIdx)
          .replace(/\[.*?\]|\(.*?\)/g, ' ')
          .replace(/[._]/g, ' ')
          .trim();
      }
    } else {
      // 2. Check Anime episode format (e.g. "Show Name - 05" or "Show Name Episode 12")
      const animeMatch = cleanName.match(ANIME_EPISODE_REGEX);
      if (animeMatch) {
        isTvShow = true;
        season = 1;
        episode = parseInt(animeMatch[1], 10);
        const splitIdx = cleanName.search(ANIME_EPISODE_REGEX);
        if (splitIdx > 0) {
          showTitle = cleanName.substring(0, splitIdx).trim();
        }
      }
    }

    // Extract Year
    const yearMatch = cleanName.match(YEAR_REGEX);
    let year = null;
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
      // Cut off title after year
      const yearIdx = cleanName.indexOf(yearMatch[0]);
      if (yearIdx > 0) {
        cleanName = cleanName.substring(0, yearIdx).trim();
      }
    }

    // Extract Quality Tag
    const qualityMatch = baseName.match(QUALITY_REGEX);
    let quality = 'HD';
    if (qualityMatch) {
      quality = qualityMatch[1].toUpperCase();
      if (quality === '2160P') quality = '4K';
    }

    // Final title cleanup
    let title = isTvShow && showTitle ? showTitle : cleanName;
    title = title.replace(/\s+/g, ' ').trim();
    if (!title) title = baseName;

    return {
      id: Buffer.from(fullPath || filename).toString('base64url'),
      filename,
      fullPath,
      ext: ext.toLowerCase(),
      title,
      year,
      quality,
      isTvShow,
      season,
      episode,
      displayTitle: isTvShow ? `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : title
    };
  }

  static formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

module.exports = MediaScanner;
