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

// System/cache directories to skip during recursive scan to ensure high speed
const SKIP_DIRS = new Set([
  'Android', 'tencent', 'OSSLog', 'apminsight', 'monitor', 'qvs', 'apm',
  'Facebook Messenger', 'Voice Recorder', 'Backups', '.thumbnails', '$RECYCLE.BIN'
]);

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

let mediaCache = {
  items: [],
  lastScan: 0
};

// Scan concurrency lock
let isScanning = false;
let activeScanPromise = null;

function createFtpClient(overrideConfig = null) {
  const cfg = overrideConfig || appSettings;
  return new SimpleFtpClient({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    secure: Boolean(cfg.secure),
    timeout: 12000
  });
}

/**
 * Recursively scan FTP directory for video files.
 */
async function scanFtpDirectory(ftp, remoteDir, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];

  const foundVideos = [];
  try {
    const list = await ftp.list(remoteDir);
    for (const item of list) {
      if (item.isDirectory) {
        if (item.name.startsWith('.') || SKIP_DIRS.has(item.name)) continue;
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
    console.warn(`Scan warning at ${remoteDir}:`, err.message);
  }

  return foundVideos;
}

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

  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

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
      return sendJson(200, { ...appSettings });
    }

    // API: Save Settings
    if (pathname === '/api/settings' && req.method === 'POST') {
      const newSettings = await readBody();
      appSettings = { ...appSettings, ...newSettings };
      saveSettings(appSettings);
      tmdb.setApiKey(appSettings.tmdbApiKey || '');
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
        const testDir = (testConfig.path && testConfig.path !== '/') ? testConfig.path : (testClient.workingDirectory || '/');
        const rootItems = await testClient.list(testDir);
        const videoCount = rootItems.filter(i => !i.isDirectory && MediaScanner.isVideo(i.name)).length;
        const dirCount = rootItems.filter(i => i.isDirectory).length;
        testClient.destroy();

        return sendJson(200, {
          success: true,
          workingDirectory: testClient.workingDirectory,
          message: `Connected successfully! Starting directory: ${testDir} (${dirCount} folders, ${videoCount} videos found)`
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

      if (!forceRefresh && mediaCache.items.length > 0 && (Date.now() - mediaCache.lastScan) < 300000) {
        return sendJson(200, formatLibraryResponse(mediaCache.items));
      }

      if (isScanning && activeScanPromise) {
        console.log('[Scan] Scan already in progress, awaiting result...');
        const existingResult = await activeScanPromise;
        return sendJson(200, existingResult);
      }

      isScanning = true;
      activeScanPromise = (async () => {
        const ftp = createFtpClient();
        try {
          await ftp.connect();
          const rootDir = (appSettings.path && appSettings.path !== '/') ? appSettings.path : (ftp.workingDirectory || '/');
          console.log(`[Scan] Scanning starting from: ${rootDir}`);
          const rawVideos = await scanFtpDirectory(ftp, rootDir);
          ftp.destroy();

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

          console.log(`[Scan] Completed! Found ${rawVideos.length} total videos.`);
          return formatLibraryResponse(rawVideos);
        } catch (err) {
          ftp.destroy();
          throw err;
        } finally {
          isScanning = false;
          activeScanPromise = null;
        }
      })();

      try {
        const scanResult = await activeScanPromise;
        return sendJson(200, scanResult);
      } catch (err) {
        return sendJson(500, { error: `FTP Scan failed: ${err.message}` });
      }
    }

    // API: Browse raw folder
    if (pathname === '/api/browse' && req.method === 'GET') {
      const ftp = createFtpClient();
      try {
        await ftp.connect();
        let targetDir = parsedUrl.query.path;
        if (!targetDir || targetDir === '/') {
          targetDir = (appSettings.path && appSettings.path !== '/') ? appSettings.path : (ftp.workingDirectory || '/');
        }
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

    // API: Subtitle Fetching (Convert SRT -> WebVTT)
    if (pathname === '/api/subtitle' && req.method === 'GET') {
      const videoPath = parsedUrl.query.file;
      if (!videoPath) return sendJson(400, { error: 'file param required' });

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
          const vttData = 'WEBVTT\n\n' + srtData.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
          res.writeHead(200, {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(vttData);
        });
        subStream.stream.on('error', () => {
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

    // API: Video Streaming Proxy with Exact Capped Chunk Support
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

      let start = 0;
      let end = totalSize > 0 ? totalSize - 1 : 0;
      let isPartial = false;

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0], 10) || 0;
        if (parts[1]) {
          end = parseInt(parts[1], 10);
        }
        isPartial = true;
      }

      const chunkSize = (end - start) + 1;

      console.log(`[Stream] ${isPartial ? 'Range' : 'Full'} request: ${start}-${end}/${totalSize} for ${path.basename(filePath)}`);

      let ftpStreamInfo;
      try {
        ftpStreamInfo = await ftp.getStream(filePath, start, totalSize);
      } catch (err) {
        console.error(`[Stream] Failed to getStream for ${path.basename(filePath)}:`, err.message);
        ftp.destroy();
        if (!res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('Streaming proxy busy, please retry');
        }
        return;
      }

      res.writeHead(isPartial ? 206 : 200, {
        ...(isPartial ? { 'Content-Range': `bytes ${start}-${end}/${totalSize}` } : {}),
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Connection': 'close'
      });

      let sent = 0;
      let isDone = false;

      const cleanup = () => {
        if (isDone) return;
        isDone = true;
        if (ftpStreamInfo.stream && !ftpStreamInfo.stream.destroyed) {
          ftpStreamInfo.stream.destroy();
        }
        ftp.destroy();
        if (!res.writableEnded) {
          res.end();
        }
      };

      ftpStreamInfo.stream.on('data', (chunk) => {
        if (isDone) return;
        const remaining = chunkSize - sent;
        if (remaining <= 0) {
          cleanup();
          return;
        }

        if (chunk.length <= remaining) {
          sent += chunk.length;
          res.write(chunk);
          if (sent >= chunkSize) {
            cleanup();
          }
        } else {
          res.write(chunk.slice(0, remaining));
          sent += remaining;
          cleanup();
        }
      });

      ftpStreamInfo.stream.on('end', cleanup);
      ftpStreamInfo.stream.on('error', cleanup);
      req.on('close', cleanup);
      return;
    }

    // Serve Static UI Files
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
