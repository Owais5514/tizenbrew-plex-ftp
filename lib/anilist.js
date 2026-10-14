const https = require('https');
const crypto = require('crypto');
const { generateQrSvg } = require('./qr');

const ANILIST_CLIENT_ID = '38624'; // Standard registered community AniList Client ID
const GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';

class AniListService {
  constructor() {
    this.authSessions = new Map(); // sid -> { createdAt, token, user }
  }

  // --- Mobile QR Authentication Session Management ---

  createAuthSession(hostIp, port = 8999) {
    const sid = crypto.randomBytes(8).toString('hex');
    const mobileUrl = `http://${hostIp}:${port}/auth/anilist?sid=${sid}`;
    const qrSvg = generateQrSvg(mobileUrl, 260);

    const session = {
      sid,
      mobileUrl,
      qrSvg,
      token: null,
      user: null,
      createdAt: Date.now()
    };

    this.authSessions.set(sid, session);

    // Auto-expire after 10 minutes
    setTimeout(() => {
      this.authSessions.delete(sid);
    }, 10 * 60 * 1000);

    return session;
  }

  getSessionStatus(sid) {
    if (!this.authSessions.has(sid)) {
      return { status: 'expired' };
    }
    const session = this.authSessions.get(sid);
    if (session.token) {
      return {
        status: 'authorized',
        token: session.token,
        user: session.user
      };
    }
    return { status: 'pending', mobileUrl: session.mobileUrl };
  }

  async completeAuthSession(sid, token) {
    if (!this.authSessions.has(sid)) return false;
    const session = this.authSessions.get(sid);
    session.token = token;

    try {
      const user = await this.getViewer(token);
      session.user = user;
      return true;
    } catch (_) {
      return false;
    }
  }

  // --- GraphQL Queries & Mutations ---

  async getViewer(token) {
    const query = `
      query {
        Viewer {
          id
          name
          avatar {
            large
            medium
          }
          unreadNotificationCount
        }
      }
    `;
    const data = await this._graphql(query, {}, token);
    return data && data.Viewer ? data.Viewer : null;
  }

  async getUserAnimeList(token, userId) {
    const query = `
      query ($userId: Int) {
        MediaListCollection(userId: $userId, type: ANIME) {
          lists {
            name
            status
            entries {
              id
              status
              score
              progress
              updatedAt
              media {
                id
                idMal
                title {
                  english
                  romaji
                  native
                }
                coverImage {
                  extraLarge
                  large
                }
                bannerImage
                format
                episodes
                genres
                averageScore
                description(asHtml: false)
                nextAiringEpisode {
                  episode
                  airingAt
                }
              }
            }
          }
        }
      }
    `;

    const data = await this._graphql(query, { userId }, token);
    if (!data || !data.MediaListCollection) return { watching: [], planning: [], completed: [] };

    const lists = data.MediaListCollection.lists || [];
    const watching = [];
    const planning = [];
    const completed = [];

    for (const list of lists) {
      const entries = (list.entries || []).map(e => ({
        listEntryId: e.id,
        status: e.status,
        score: e.score,
        progress: e.progress,
        updatedAt: e.updatedAt,
        mediaId: e.media.id,
        malId: e.media.idMal,
        title: e.media.title.english || e.media.title.romaji,
        romajiTitle: e.media.title.romaji,
        posterUrl: e.media.coverImage.extraLarge || e.media.coverImage.large,
        backdropUrl: e.media.bannerImage || e.media.coverImage.extraLarge,
        totalEpisodes: e.media.episodes,
        format: e.media.format,
        genres: e.media.genres,
        rating: e.media.averageScore ? (e.media.averageScore / 10).toFixed(1) : null,
        overview: e.media.description ? e.media.description.replace(/<[^>]*>?/gm, '').trim() : '',
        nextAiring: e.media.nextAiringEpisode
      }));

      if (list.status === 'CURRENT') watching.push(...entries);
      else if (list.status === 'PLANNING') planning.push(...entries);
      else if (list.status === 'COMPLETED') completed.push(...entries);
    }

    return { watching, planning, completed };
  }

  /**
   * Two-Way Scrobbling: Update anime progress on AniList!
   */
  async updateProgress(token, { mediaId, progress, status }) {
    const mutation = `
      mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
        SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
          id
          mediaId
          status
          progress
        }
      }
    `;

    const variables = { mediaId: parseInt(mediaId, 10), progress: parseInt(progress, 10) };
    if (status) variables.status = status;

    return await this._graphql(mutation, variables, token);
  }

  async getTrendingAnime(page = 1, perPage = 20) {
    const query = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, sort: TRENDING_DESC) {
            id
            idMal
            title {
              english
              romaji
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            episodes
            format
            genres
            averageScore
            description(asHtml: false)
          }
        }
      }
    `;

    const data = await this._graphql(query, { page, perPage });
    if (!data || !data.Page) return [];

    return (data.Page.media || []).map(m => ({
      mediaId: m.id,
      malId: m.idMal,
      title: m.title.english || m.title.romaji,
      romajiTitle: m.title.romaji,
      posterUrl: m.coverImage.extraLarge || m.coverImage.large,
      backdropUrl: m.bannerImage || m.coverImage.extraLarge,
      totalEpisodes: m.episodes,
      format: m.format,
      genres: m.genres,
      rating: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
      overview: m.description ? m.description.replace(/<[^>]*>?/gm, '').trim() : ''
    }));
  }

  async searchAnime(query, page = 1, perPage = 20) {
    const gql = `
      query ($query: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(search: $query, type: ANIME, sort: SEARCH_MATCH) {
            id
            idMal
            title {
              english
              romaji
            }
            coverImage {
              extraLarge
              large
            }
            bannerImage
            episodes
            format
            genres
            averageScore
            description(asHtml: false)
          }
        }
      }
    `;

    const data = await this._graphql(gql, { query, page, perPage });
    if (!data || !data.Page) return [];

    return (data.Page.media || []).map(m => ({
      mediaId: m.id,
      malId: m.idMal,
      title: m.title.english || m.title.romaji,
      romajiTitle: m.title.romaji,
      posterUrl: m.coverImage.extraLarge || m.coverImage.large,
      backdropUrl: m.bannerImage || m.coverImage.extraLarge,
      totalEpisodes: m.episodes,
      format: m.format,
      genres: m.genres,
      rating: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
      overview: m.description ? m.description.replace(/<[^>]*>?/gm, '').trim() : ''
    }));
  }

  _graphql(query, variables = {}, token = null) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ query, variables });
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'TizenFlix/1.0'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const req = https.request(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.errors && parsed.errors.length > 0) {
              console.warn('[AniList GraphQL Warning]', parsed.errors[0].message);
            }
            resolve(parsed.data || null);
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[AniList Error]', err.message);
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  getMobileAuthHtml(sid, clientId = ANILIST_CLIENT_ID) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TizenFlix — Connect AniList</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #0b0e14; color: #ffffff; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #181d26; border: 1px solid #2a3342; border-radius: 20px; max-width: 420px; width: 100%; padding: 32px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .brand { font-size: 26px; font-weight: 900; margin-bottom: 20px; letter-spacing: 1px; }
    .brand-tizen { color: #fff; }
    .brand-flix { color: #e50914; }
    .icon { width: 64px; height: 64px; margin: 0 auto 16px; background: #02a9ff; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; }
    h2 { font-size: 20px; margin-bottom: 8px; }
    p { color: #9aa4b2; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 12px; background: #02a9ff; color: #fff; font-size: 16px; font-weight: bold; cursor: pointer; text-decoration: none; transition: 0.2s; }
    .btn:hover { background: #0098e6; }
    .btn:active { transform: scale(0.98); }
    .status { margin-top: 16px; font-size: 14px; }
    .success { color: #10b981; }
    .error { color: #ef4444; }
    .manual-box { margin-top: 24px; border-top: 1px solid #2a3342; padding-top: 18px; }
    input[type="text"] { width: 100%; padding: 10px 14px; background: #0b0e14; border: 1px solid #2a3342; border-radius: 8px; color: #fff; margin-bottom: 10px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <span class="brand-tizen">TIZEN</span><span class="brand-flix">FLIX</span>
    </div>
    <div class="icon">A</div>
    <h2>Connect to AniList</h2>
    <p>Sign in to sync your anime library, track episode watch history, and update your watchlist directly from your TV.</p>

    <div id="auth-actions">
      <a id="btn-login" class="btn" href="#">Sign in with AniList</a>
    </div>

    <div id="status-msg" class="status"></div>

    <div class="manual-box">
      <p style="font-size: 12px; margin-bottom: 8px;">Or paste an AniList access token manually:</p>
      <input type="text" id="manual-token" placeholder="Paste token here">
      <button class="btn" style="background: #2a3342; padding: 10px;" onclick="submitToken(document.getElementById('manual-token').value)">Submit Token</button>
    </div>
  </div>

  <script>
    const sid = new URLSearchParams(window.location.search).get('sid') || '${sid}';
    const authUrl = 'https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token';

    document.getElementById('btn-login').href = authUrl;

    // Check if AniList redirected back with #access_token=...
    if (window.location.hash) {
      const params = new URLSearchParams(window.location.hash.substring(1));
      const token = params.get('access_token');
      if (token) {
        submitToken(token);
      }
    }

    async function submitToken(token) {
      token = (token || '').trim();
      if (!token) return;

      const statusBox = document.getElementById('status-msg');
      statusBox.className = 'status';
      statusBox.textContent = 'Connecting to your Samsung TV...';

      try {
        const res = await fetch('/api/auth/anilist/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sid, token })
        });
        const data = await res.json();
        if (data.success) {
          statusBox.className = 'status success';
          statusBox.innerHTML = '✔ Connected successfully as <strong>@' + (data.user?.name || 'User') + '</strong>!<br><br>You can now look at your TV screen.';
          document.getElementById('auth-actions').style.display = 'none';
        } else {
          statusBox.className = 'status error';
          statusBox.textContent = '✖ Authorization failed: ' + (data.error || 'Invalid token');
        }
      } catch (err) {
        statusBox.className = 'status error';
        statusBox.textContent = '✖ Network error: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
  }
}

module.exports = AniListService;
