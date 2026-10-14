const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const SimpleFtpClient = require('./lib/ftp-client');
const MediaScanner = require('./lib/media-scanner');
const TmdbService = require('./lib/tmdb');

const PORT = process.env.PORT || 8999;
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load default or saved settings
function loadSettings() {
  const defaults = {
    host: '127.0.0.1',
    port: 21,
    user: 'anonymous',
    password: '',
    path: '/',
    secure: false,
    tmdbApiKey: '',
    directHttpUrl: ''
  };

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...defaults, ...data };
    }
  } catch (err) {
    console.error('Error reading settings file:', err.message);
  }
  return defaults;
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving settings:', err.message);
    return false;
  }
}

// Load and save playback progress
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading progress file:', err.message);
  }
  return {};
}

function saveProgress(fileId, data) {
  try {
    const all = loadProgress();
    all[fileId] = {
      ...data,
      updatedAt: Date.now()
    };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(all, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving progress:', err.message);
    return false;
  }
}

let appSettings = loadSettings();
const tmdb = new TmdbService(appSettings.tmdbApiKey);

// In-memory media cache to avoid repeated FTP directory scans
let mediaCache = {
  items: [],
  lastScan: 0
};

// Create a new FTP client from current settings
function createFtpClient(overrideConfig = null) {
  const cfg = overrideConfig || appSettings;
  return new SimpleFtpClient({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    secure: Boolean(cfg.secure),
    timeout: 10000
  });
}

/**
 * Recursively scan FTP directory for video files (up to maxDepth).
 */
async function scanFtpDirectory(ftp, remoteDir, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];

  const foundVideos = [];
  try {
    const list = await ftp.list(remoteDir);
    for (const item of list) {
      if (item.isDirectory) {
        // Skip common hidden or non-media folders
        if (item.name.startsWith('.') || item.name.toLowerCase() === '$recycle.bin') continue;
        const subVideos = await scanFtpDirectory(ftp, item.path, depth + 1, maxDepth);
        foundVideos.push(...subVideos);
      } else if (MediaScanner.isVideo(item.name)) {
        const metadata = MediaScanner.parseFilename(item.name, item.path);
        metadata.size = item.size;
        metadata.formattedSize = MediaScanner.formatBytes(item.size);
        foundVideos.push(metadata);
      }
    }
  } catch (err) {
    console.warn(`Scan error in ${remoteDir}:`, err.message);
  }

  return foundVideos;
}

// MIME types for video streaming and static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.vtt': 'text/vtt'
};

const server = http.createServer(async (req, res) => {
  // CORS headers so Tizen webview or external browser can talk to API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // JSON helper
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Read request body helper
  const readBody = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

  try {
    // API: Status
    if (pathname === '/api/status' && req.method === 'GET') {
      return sendJson(200, {
        status: 'online',
        server: 'PlexFTP Backend',
        version: '1.0.0',
        configured: Boolean(appSettings.host && appSettings.host !== '127.0.0.1')
      });
    }

    // API: Get Settings
    if (pathname === '/api/settings' && req.method === 'GET') {
      const safe = { ...appSettings };
      // Keep password for TV remote ease, or mask if needed
      return sendJson(200, safe);
    }

    // API: Save Settings
    if (pathname === '/api/settings' && req.method === 'POST') {
      const newSettings = await readBody();
      appSettings = { ...appSettings, ...newSettings };
      saveSettings(appSettings);
      tmdb.setApiKey(appSettings.tmdbApiKey || '');
      // Clear cache on config change
      mediaCache.items = [];
      mediaCache.lastScan = 0;
      return sendJson(200, { success: true, settings: appSettings });
    }

    // API: Test FTP Connection
    if (pathname === '/api/test' && req.method === 'POST') {
      const testConfig = await readBody();
      const testClient = createFtpClient(testConfig);
      try {
        await testClient.connect();
        const rootItems = await testClient.list(testConfig.path || '/');
        const videoCount = rootItems.filter(i => !i.isDirectory && MediaScanner.isVideo(i.name)).length;
        const dirCount = rootItems.filter(i => i.isDirectory).length;
        testClient.destroy();

        return sendJson(200, {
          success: true,
          message: `Connected successfully! Found ${dirCount} folders and ${videoCount} videos in ${testConfig.path || '/'}`
        });
      } catch (err) {
        testClient.destroy();
        return sendJson(400, {
          success: false,
          error: err.message
        });
      }
    }

    // API: Scan Library / Fetch Organized Media
    if (pathname === '/api/scan' && req.method === 'GET') {
      const forceRefresh = parsedUrl.query.refresh === 'true';

      // Use cache if within 5 minutes and not forced
      if (!forceRefresh && mediaCache.items.length > 0 && (Date.now() - mediaCache.lastScan) < 300000) {
        return sendJson(200, formatLibraryResponse(mediaCache.items));
      }

      const ftp = createFtpClient();
      try {
        await ftp.connect();
        const rootDir = appSettings.path || '/';
        const rawVideos = await scanFtpDirectory(ftp, rootDir);
        ftp.destroy();

        // Enrich with TMDB metadata if API key configured
        if (appSettings.tmdbApiKey) {
          for (const item of rawVideos) {
            const meta = await tmdb.search(item.title, item.year, item.isTvShow);
            if (meta) {
              item.overview = meta.overview;
              item.rating = meta.rating;
              item.posterUrl = meta.posterUrl;
              item.backdropUrl = meta.backdropUrl;
            }
          }
        }

        mediaCache.items = rawVideos;
        mediaCache.lastScan = Date.now();

        return sendJson(200, formatLibraryResponse(rawVideos));
      } catch (err) {
        ftp.destroy();
        return sendJson(500, { error: `FTP Scan failed: ${err.message}` });
      }
    }

    // API: Browse raw folder
    if (pathname === '/api/browse' && req.method === 'GET') {
      const targetDir = parsedUrl.query.path || appSettings.path || '/';
      const ftp = createFtpClient();
      try {
        await ftp.connect();
        const list = await ftp.list(targetDir);
        ftp.destroy();

        const formatted = list.map(item => {
          if (item.isDirectory) {
            return {
              name: item.name,
              path: item.path,
              isDirectory: true
            };
          }
          const isVid = MediaScanner.isVideo(item.name);
          const meta = isVid ? MediaScanner.parseFilename(item.name, item.path) : null;
          return {
            name: item.name,
            path: item.path,
            size: item.size,
            formattedSize: MediaScanner.formatBytes(item.size),
            isDirectory: false,
            isVideo: isVid,
            ...(meta || {})
          };
        });

        return sendJson(200, { path: targetDir, items: formatted });
      } catch (err) {
        ftp.destroy();
        return sendJson(500, { error: err.message });
      }
    }

    // API: Playback Progress (GET / POST)
    if (pathname === '/api/progress' && req.method === 'GET') {
      return sendJson(200, loadProgress());
    }

    if (pathname === '/api/progress' && req.method === 'POST') {
      const body = await readBody();
      if (body.fileId) {
        saveProgress(body.fileId, body);
        return sendJson(200, { success: true });
      }
      return sendJson(400, { error: 'Missing fileId' });
    }

    // API: Subtitle Fetching (Convert SRT -> WebVTT on the fly)
    if (pathname === '/api/subtitle' && req.method === 'GET') {
      const videoPath = parsedUrl.query.file;
      if (!videoPath) return sendJson(400, { error: 'file param required' });

      // Look for same filename with .srt or .vtt
      const ext = path.extname(videoPath);
      const srtPath = videoPath.substring(0, videoPath.length - ext.length) + '.srt';

      const ftp = createFtpClient();
      try {
        await ftp.connect();
        const subStream = await ftp.getStream(srtPath, 0);
        let srtData = '';
        subStream.stream.on('data', chunk => srtData += chunk.toString('utf8'));
        subStream.stream.on('end', () => {
          ftp.destroy();
          // Convert SRT to WebVTT
          const vttData = 'WEBVTT\n\n' + srtData.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
          res.writeHead(200, {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(vttData);
        });
        subStream.stream.on('error', (e) => {
          ftp.destroy();
          res.writeHead(404);
          res.end();
        });
      } catch (err) {
        ftp.destroy();
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // API: Video Streaming Proxy with HTTP Range Requests!
    if (pathname === '/api/stream' && req.method === 'GET') {
      const filePath = parsedUrl.query.file;
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('File path parameter is required');
      }

      const ftp = createFtpClient();
      await ftp.connect();

      const totalSize = await ftp.size(filePath);
      const rangeHeader = req.headers.range;

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'video/mp4';

      if (rangeHeader) {
        // e.g. "bytes=1048576-" or "bytes=1048576-2097151"
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? parseInt(parts[1], 10) : (totalSize > 0 ? totalSize - 1 : start + 10485760);
        const chunkSize = (end - start) + 1;

        console.log(`[Stream] Range request: ${start}-${end}/${totalSize} for ${path.basename(filePath)}`);

        const ftpStreamInfo = await ftp.getStream(filePath, start);

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType
        });

        ftpStreamInfo.stream.pipe(res);

        // Abort FTP socket on client disconnect (e.g. user seeking or navigating away)
        req.on('close', () => {
          ftp.destroy();
        });
      } else {
        console.log(`[Stream] Full stream requested for ${path.basename(filePath)}`);
        const ftpStreamInfo = await ftp.getStream(filePath, 0);

        res.writeHead(200, {
          'Content-Length': totalSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType
        });

        ftpStreamInfo.stream.pipe(res);

        req.on('close', () => {
          ftp.destroy();
        });
      }
      return;
    }

    // Serve Static UI Files (from public directory)
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') safePath = '/index.html';
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // 404 Fallback
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    console.error('Unhandled request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
});

// Helper: Organize scanned media items into Plex categories
function formatLibraryResponse(items) {
  const progress = loadProgress();

  const enriched = items.map(item => {
    const p = progress[item.id] || null;
    return {
      ...item,
      progress: p
    };
  });

  const continueWatching = enriched.filter(i => {
    if (!i.progress || !i.progress.currentTime) return false;
    const pct = (i.progress.currentTime / (i.progress.duration || 1)) * 100;
    return pct > 3 && pct < 93;
  });

  const movies = enriched.filter(i => !i.isTvShow);
  const tvShows = enriched.filter(i => i.isTvShow);

  return {
    total: enriched.length,
    continueWatching,
    recentlyAdded: enriched.slice(0, 15),
    movies,
    tvShows,
    all: enriched
  };
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🎬 Plex FTP Player Backend running on port ${PORT}`);
  console.log(`📺 TV Access: http://127.0.0.1:${PORT}`);
  console.log(`===============================================`);
});

module.exports = server;
