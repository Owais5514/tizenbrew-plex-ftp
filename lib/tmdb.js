const https = require('https');

class TmdbService {
  constructor(apiKey = '') {
    this.apiKey = apiKey;
    this.cache = new Map();
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  /**
   * Search for movie or TV show metadata by title and optional year.
   */
  async search(title, year = null, isTv = false) {
    if (!this.apiKey) return null;

    const cacheKey = `${isTv ? 'tv' : 'movie'}:${title}:${year || ''}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const type = isTv ? 'tv' : 'movie';
    let url = `https://api.themoviedb.org/3/search/${type}?api_key=${this.apiKey}&query=${encodeURIComponent(title)}`;
    if (year) {
      url += isTv ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`;
    }

    try {
      const data = await this._fetchJson(url);
      if (data && data.results && data.results.length > 0) {
        const item = data.results[0];
        const result = {
          tmdbId: item.id,
          title: item.title || item.name,
          originalTitle: item.original_title || item.original_name,
          overview: item.overview,
          rating: item.vote_average ? item.vote_average.toFixed(1) : null,
          releaseDate: item.release_date || item.first_air_date,
          posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
          backdropUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null
        };
        this.cache.set(cacheKey, result);
        return result;
      }
    } catch (err) {
      console.warn(`TMDB lookup failed for ${title}:`, err.message);
    }

    return null;
  }

  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }
}

module.exports = TmdbService;
