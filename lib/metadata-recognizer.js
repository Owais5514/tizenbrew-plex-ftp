const fs = require('fs');
const path = require('path');
const https = require('https');
const MediaScanner = require('./media-scanner');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'metadata-cache.json');

class MetadataRecognizer {
  constructor(tmdbApiKey = '') {
    this.tmdbApiKey = tmdbApiKey;
    this.cache = this._loadCache();
  }

  setTmdbApiKey(key) {
    this.tmdbApiKey = key;
  }

  _loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      }
    } catch (_) {}
    return {};
  }

  _saveCache() {
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (_) {}
  }

  /**
   * Recognize and enrich a media item with clean title, poster, backdrop, and overview.
   */
  async recognize(mediaItem) {
    const rawTitle = mediaItem.title;
    const cacheKey = `${mediaItem.isTvShow ? 'tv' : 'movie'}:${rawTitle.toLowerCase().trim()}`;

    if (this.cache[cacheKey]) {
      return { ...mediaItem, ...this.cache[cacheKey] };
    }

    let meta = null;

    // 1. Try AniList GraphQL first (Ideal for anime, fast, high-res posters, no API key needed!)
    meta = await this._queryAniList(rawTitle);

    // 2. If not found or not anime, try TMDB (if user provided API key)
    if (!meta && this.tmdbApiKey) {
      meta = await this._queryTmdb(rawTitle, mediaItem.year, mediaItem.isTvShow);
    }

    // 3. Fallback: TVMaze for TV shows (Completely free, no key required)
    if (!meta && mediaItem.isTvShow) {
      meta = await this._queryTvMaze(rawTitle);
    }

    if (meta) {
      this.cache[cacheKey] = meta;
      this._saveCache();
      return { ...mediaItem, ...meta };
    }

    return mediaItem;
  }

  /**
   * Search AniList for Anime titles, posters, banners, and descriptions.
   */
  async _queryAniList(title) {
    const query = `
      query ($search: String) {
        Media(search: $search, type: ANIME) {
          id
          title {
            english
            romaji
          }
          coverImage {
            extraLarge
            large
          }
          bannerImage
          description(asHtml: false)
          averageScore
          episodes
          seasonYear
          genres
        }
      }
    `;

    try {
      const res = await this._postJson('https://graphql.anilist.co', {
        query,
        variables: { search: title }
      });

      if (res && res.data && res.data.Media) {
        const m = res.data.Media;
        const cleanOverview = m.description ? m.description.replace(/<[^>]*>?/gm, '').trim() : '';
        return {
          anilistId: m.id,
          displayTitle: m.title.english || m.title.romaji || title,
          posterUrl: m.coverImage.extraLarge || m.coverImage.large,
          backdropUrl: m.bannerImage || m.coverImage.extraLarge,
          overview: cleanOverview,
          rating: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
          year: m.seasonYear || null,
          genres: m.genres || []
        };
      }
    } catch (_) {}

    return null;
  }

  /**
   * Query TMDB for Movie or TV metadata.
   */
  async _queryTmdb(title, year, isTv) {
    const type = isTv ? 'tv' : 'movie';
    let url = `https://api.themoviedb.org/3/search/${type}?api_key=${this.tmdbApiKey}&query=${encodeURIComponent(title)}`;
    if (year) {
      url += isTv ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`;
    }

    try {
      const data = await this._getJson(url);
      if (data && data.results && data.results.length > 0) {
        const item = data.results[0];
        return {
          tmdbId: item.id,
          displayTitle: item.title || item.name || title,
          overview: item.overview,
          rating: item.vote_average ? item.vote_average.toFixed(1) : null,
          year: (item.release_date || item.first_air_date || '').substring(0, 4) || year,
          posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
          backdropUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null
        };
      }
    } catch (_) {}

    return null;
  }

  /**
   * Query TVMaze for free TV show details and posters.
   */
  async _queryTvMaze(title) {
    try {
      const url = `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}`;
      const show = await this._getJson(url);
      if (show && show.id) {
        const cleanOverview = show.summary ? show.summary.replace(/<[^>]*>?/gm, '').trim() : '';
        return {
          tvmazeId: show.id,
          displayTitle: show.name || title,
          overview: cleanOverview,
          rating: show.rating && show.rating.average ? show.rating.average.toFixed(1) : null,
          year: (show.premiered || '').substring(0, 4) || null,
          posterUrl: show.image ? (show.image.original || show.image.medium) : null,
          backdropUrl: show.image ? show.image.original : null,
          genres: show.genres || []
        };
      }
    } catch (_) {}

    return null;
  }

  _getJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'TizenFlix/1.0' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  }

  _postJson(url, data) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const postData = JSON.stringify(data);
      const req = https.request({
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'TizenFlix/1.0'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.write(postData);
      req.end();
    });
  }
}

module.exports = MetadataRecognizer;
