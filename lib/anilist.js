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

  getMobileAuthHtml(sid, clientId = '', hostIp = '127.0.0.1', port = 8999) {
    const callbackUrl = `http://${hostIp}:${port}/auth/anilist`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TizenFlix — Connect AniList</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #0b0e14; color: #ffffff; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #181d26; border: 1px solid #2a3342; border-radius: 20px; max-width: 440px; width: 100%; padding: 32px 24px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
    .brand { font-size: 26px; font-weight: 900; margin-bottom: 16px; letter-spacing: 1px; }
    .brand-tizen { color: #fff; }
    .brand-flix { color: #e50914; }
    .icon { width: 64px; height: 64px; margin: 0 auto 16px; background: #02a9ff; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; }
    h2 { font-size: 20px; margin-bottom: 8px; }
    p { color: #9aa4b2; font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
    .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 12px; background: #02a9ff; color: #fff; font-size: 16px; font-weight: bold; cursor: pointer; text-decoration: none; transition: 0.2s; }
    .btn:hover { background: #0098e6; }
    .btn:active { transform: scale(0.98); }
    .spinner { border: 4px solid rgba(255,255,255,0.1); border-left-color: #02a9ff; border-radius: 50%; width: 44px; height: 44px; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .status { margin-top: 16px; font-size: 14px; }
    .success { color: #10b981; }
    .error { color: #ef4444; }
    .setup-box { background: rgba(2, 169, 255, 0.08); border: 1px solid rgba(2, 169, 255, 0.25); border-radius: 14px; padding: 18px; text-align: left; margin-bottom: 20px; }
    .setup-title { font-size: 14px; font-weight: 700; color: #02a9ff; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
    .setup-step { font-size: 13px; color: #cbd5e1; margin-bottom: 10px; line-height: 1.4; }
    .code-pill { background: #0b0e14; border: 1px solid #2a3342; border-radius: 6px; padding: 6px 10px; font-family: monospace; font-size: 12px; color: #38bdf8; word-break: break-all; display: block; margin-top: 4px; }
    input[type="text"] { width: 100%; padding: 12px 14px; background: #0b0e14; border: 1px solid #2a3342; border-radius: 10px; color: #fff; margin-bottom: 12px; font-size: 14px; }
    input[type="text"]:focus { outline: none; border-color: #02a9ff; }
    .manual-box { margin-top: 24px; border-top: 1px solid #2a3342; padding-top: 16px; text-align: left; }
    .copy-btn { background: #2a3342; border: none; border-radius: 6px; color: #fff; padding: 4px 8px; font-size: 11px; cursor: pointer; float: right; margin-top: -24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <span class="brand-tizen">TIZEN</span><span class="brand-flix">FLIX</span>
    </div>

    <!-- Loading / Redirect State -->
    <div id="loading-state" style="display: none;">
      <div class="spinner"></div>
      <h2 id="loading-title">Connecting with TV...</h2>
      <p id="loading-desc">Synchronizing your AniList account with TizenFlix.</p>
    </div>

    <!-- Success State -->
    <div id="success-state" style="display: none;">
      <div style="font-size: 52px; margin-bottom: 12px;">🎉</div>
      <h2 style="color: #10b981; margin-bottom: 8px;">Connected Successfully!</h2>
      <p id="success-username" style="font-size: 16px; color: #fff; font-weight: 700; margin-bottom: 10px;">@AniListUser</p>
      <p style="color: #9aa4b2; font-size: 14px;">Your Samsung TV is now synchronized with your AniList watchlist and watch history.<br><br><strong>You can now look at your TV screen!</strong></p>
    </div>

    <!-- Main Auth State -->
    <div id="main-auth-state">
      <div class="icon">A</div>
      <h2>Connect to AniList</h2>
      <p>Seamlessly sync your anime library, track episode watch progress, and update your watchlist directly from your TV.</p>

      <div id="client-ready-box" style="display: none;">
        <button type="button" id="btn-login-oauth" class="btn">✨ Sign in with AniList</button>
        <p style="font-size: 12px; color: #9aa4b2; margin-top: 12px; line-height: 1.4;">
          Zero-touch login: Tap above, click <strong>Authorize</strong> on AniList, and your TV screen will log in automatically!
        </p>
      </div>

      <!-- One-time Setup Box (Shown if Client ID is missing or invalid) -->
      <div id="setup-client-box" class="setup-box">
        <div class="setup-title">⚡ 30-Second Setup for Zero-Touch Login</div>
        <div class="setup-step">
          <strong>1.</strong> Open <a href="https://anilist.co/settings/developer" target="_blank" style="color: #02a9ff; text-decoration: underline;">AniList Developer Settings ↗</a>
        </div>
        <div class="setup-step">
          <strong>2.</strong> Tap <strong>"Create New Client"</strong>:
          <br>• Name: <code style="color: #fff;">TizenFlix</code>
          <br>• Redirect URL:
          <span class="code-pill" id="copy-url-text">${callbackUrl}</span>
          <button type="button" class="copy-btn" onclick="copyCallbackUrl()">📋 Copy</button>
        </div>
        <div class="setup-step" style="margin-top: 14px;">
          <strong>3.</strong> Enter your generated <strong>Client ID</strong>:
          <input type="text" id="input-client-id" placeholder="e.g. 26840 or 38624" value="${clientId}">
          <button type="button" class="btn" style="background: #10b981; padding: 12px;" onclick="saveAndAuthorize()">Save & Connect TV</button>
        </div>
      </div>

      <div id="status-msg" class="status"></div>

      <div class="manual-box">
        <p style="font-size: 12px; margin-bottom: 6px; color: #9aa4b2;">Advanced fallback (optional manual token):</p>
        <input type="text" id="manual-token" placeholder="Paste token or callback URL here">
        <button class="btn" style="background: #2a3342; padding: 10px; font-size: 13px;" onclick="submitToken(document.getElementById('manual-token').value)">Submit Token</button>
      </div>
    </div>
  </div>

  <script>
    const sid = new URLSearchParams(window.location.search).get('sid') || '${sid}';
    let currentClientId = '${clientId}'.trim();
    const serverHost = '${hostIp}:${port}';
    const callbackUrl = '${callbackUrl}';

    function copyCallbackUrl() {
      navigator.clipboard.writeText(callbackUrl).then(() => {
        alert('Copied redirect URL to clipboard: ' + callbackUrl);
      }).catch(() => {
        prompt('Copy this Redirect URL:', callbackUrl);
      });
    }

    function updateUiState() {
      const readyBox = document.getElementById('client-ready-box');
      const setupBox = document.getElementById('setup-client-box');
      if (currentClientId && currentClientId !== '38624') {
        readyBox.style.display = 'block';
        setupBox.style.display = 'none';
      } else {
        readyBox.style.display = 'none';
        setupBox.style.display = 'block';
      }
    }

    document.getElementById('btn-login-oauth').addEventListener('click', () => {
      startOAuth(currentClientId);
    });

    function startOAuth(cid) {
      if (!cid) return;
      const stateObj = { sid, ip: '${hostIp}', port: ${port} };
      const authUrl = 'https://anilist.co/api/v2/oauth/authorize?client_id=' + encodeURIComponent(cid) +
                      '&response_type=token' +
                      '&state=' + encodeURIComponent(JSON.stringify(stateObj));
      window.location.href = authUrl;
    }

    async function saveAndAuthorize() {
      const cid = document.getElementById('input-client-id').value.trim();
      if (!cid) {
        alert('Please enter your AniList Client ID.');
        return;
      }
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anilistClientId: cid })
        });
        currentClientId = cid;
        startOAuth(cid);
      } catch (err) {
        alert('Failed to save Client ID: ' + err.message);
      }
    }

    function extractToken(str) {
      str = (str || '').trim();
      if (str.includes('access_token=')) {
        const match = str.match(/access_token=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
      return str;
    }

    // Auto-detect token in hash (#access_token=...) or query string (?token=...)
    function checkIncomingToken() {
      let token = null;
      if (window.location.hash) {
        const hParams = new URLSearchParams(window.location.hash.substring(1));
        token = hParams.get('access_token') || hParams.get('token');
      }
      if (!token && window.location.search) {
        const qParams = new URLSearchParams(window.location.search);
        token = qParams.get('token') || qParams.get('access_token');
      }
      if (token) {
        document.getElementById('main-auth-state').style.display = 'none';
        document.getElementById('loading-state').style.display = 'block';
        submitToken(token);
        return true;
      }
      return false;
    }

    async function submitToken(rawInput) {
      const token = extractToken(rawInput);
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
          document.getElementById('main-auth-state').style.display = 'none';
          document.getElementById('loading-state').style.display = 'none';
          const successBox = document.getElementById('success-state');
          successBox.style.display = 'block';
          document.getElementById('success-username').textContent = '@' + (data.user?.name || 'User');
        } else {
          document.getElementById('loading-state').style.display = 'none';
          document.getElementById('main-auth-state').style.display = 'block';
          statusBox.className = 'status error';
          statusBox.textContent = '✖ Authorization failed: ' + (data.error || 'Invalid token');
        }
      } catch (err) {
        document.getElementById('loading-state').style.display = 'none';
        document.getElementById('main-auth-state').style.display = 'block';
        statusBox.className = 'status error';
        statusBox.textContent = '✖ Network error: ' + err.message;
      }
    }

    // Initialize state
    if (!checkIncomingToken()) {
      updateUiState();
    }
  </script>
</body>
</html>`;
  }
}

module.exports = AniListService;
