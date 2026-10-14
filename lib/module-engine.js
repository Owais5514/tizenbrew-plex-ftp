const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const MODULES_FILE = path.join(__dirname, '..', 'data', 'modules.json');

// Default built-in provider: Gogoanime via Consumet public provider
const DEFAULT_BUILTIN_MODULE = {
  id: 'builtin-gogoanime',
  sourceName: 'Gogoanime (Fast Stream)',
  iconUrl: 'https://gogoanime.news/img/icon/logo.png',
  version: '1.0.0',
  type: 'anime',
  baseUrl: 'https://anitaku.to',
  isBuiltin: true,
  author: { name: 'TizenFlix' },
  description: 'Built-in high-speed anime streaming scraper'
};

class ModuleEngine {
  constructor() {
    this.modules = this._loadModules();
    this.activeModuleId = this._loadActiveModuleId();
  }

  _loadModules() {
    try {
      if (fs.existsSync(MODULES_FILE)) {
        return JSON.parse(fs.readFileSync(MODULES_FILE, 'utf8'));
      }
    } catch (_) {}

    // Initial setup with default provider
    const initial = [DEFAULT_BUILTIN_MODULE];
    this._saveModules(initial);
    return initial;
  }

  _saveModules(mods) {
    try {
      const dir = path.dirname(MODULES_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(MODULES_FILE, JSON.stringify(mods, null, 2), 'utf8');
    } catch (_) {}
  }

  _loadActiveModuleId() {
    if (this.modules.length > 0) {
      return this.modules[0].id;
    }
    return DEFAULT_BUILTIN_MODULE.id;
  }

  getModules() {
    return this.modules.map(m => ({
      id: m.id,
      sourceName: m.sourceName,
      iconUrl: m.iconUrl,
      version: m.version,
      type: m.type,
      author: m.author,
      isActive: m.id === this.activeModuleId
    }));
  }

  getActiveModule() {
    return this.modules.find(m => m.id === this.activeModuleId) || this.modules[0];
  }

  setActiveModule(id) {
    const found = this.modules.find(m => m.id === id);
    if (found) {
      this.activeModuleId = id;
      return true;
    }
    return false;
  }

  /**
   * Install module from URL (JSON manifest or direct .js script)
   * Follows redirects, supports Shirox and Luna keys, relative paths, and handles errors with detailed messages.
   */
  async installModule(manifestUrl) {
    manifestUrl = (manifestUrl || '').trim();
    if (!manifestUrl) {
      throw new Error('Please enter a valid module manifest or script URL.');
    }

    // 1. Fetch manifest or script
    const res = await this._httpGet(manifestUrl);
    const rawContent = (res.body || '').trim();

    let manifest = null;
    let scriptContent = '';
    let scriptUrl = manifestUrl;

    // Check if the user pasted a raw JS script directly (e.g. ends in .js or contains module functions)
    const isDirectJs = manifestUrl.endsWith('.js') ||
                       (rawContent.includes('searchResults') && !rawContent.startsWith('{')) ||
                       (rawContent.includes('extractEpisodes') && !rawContent.startsWith('{'));

    if (isDirectJs) {
      scriptContent = rawContent;
      let baseName = 'Custom Module';
      try {
        baseName = path.basename(new URL(manifestUrl).pathname, '.js') || 'Custom Module';
      } catch (_) {}
      manifest = {
        sourceName: baseName.charAt(0).toUpperCase() + baseName.slice(1),
        scriptUrl: manifestUrl,
        version: '1.0.0',
        type: 'anime',
        author: { name: 'Community' },
        iconUrl: null
      };
    } else {
      // Parse JSON manifest
      try {
        manifest = JSON.parse(rawContent);
        if (Array.isArray(manifest)) {
          manifest = manifest[0];
        }
      } catch (err) {
        throw new Error(`The URL did not return a valid JSON manifest. Server responded with: "${rawContent.substring(0, 120)}..."`);
      }

      if (!manifest || typeof manifest !== 'object') {
        throw new Error('Invalid manifest: Expected a JSON object.');
      }

      // Support Luna and alternative keys: scriptURL, scriptUrl, script_url, entry
      scriptUrl = manifest.scriptUrl || manifest.scriptURL || manifest.script_url || manifest.entry || manifest.script;
      if (!scriptUrl) {
        throw new Error('Invalid manifest: missing "scriptUrl" (or "scriptURL") field.');
      }

      // If scriptUrl is relative, resolve it relative to manifestUrl
      try {
        scriptUrl = new URL(scriptUrl, manifestUrl).href;
      } catch (_) {}

      // Download the script
      const scriptRes = await this._httpGet(scriptUrl);
      scriptContent = scriptRes.body;
      if (!scriptContent) {
        throw new Error(`Script at ${scriptUrl} was empty.`);
      }
    }

    const sourceName = manifest.sourceName || manifest.name || manifest.title || 'Custom Module';
    const iconUrl = manifest.iconUrl || manifest.iconURL || manifest.icon_url || manifest.icon || null;
    const author = manifest.author || { name: 'Unknown' };
    const version = manifest.version || '1.0.0';
    const baseUrl = manifest.baseUrl || manifest.baseURL || manifest.url || null;
    const type = manifest.type || 'anime';

    const newModule = {
      id: scriptUrl,
      sourceName,
      iconUrl,
      author,
      version,
      baseUrl,
      scriptUrl,
      type,
      scriptContent,
      installedAt: Date.now()
    };

    // Replace if existing, or add
    const idx = this.modules.findIndex(m => m.id === newModule.id);
    if (idx >= 0) {
      this.modules[idx] = newModule;
    } else {
      this.modules.push(newModule);
    }

    this._saveModules(this.modules);
    this.activeModuleId = newModule.id;
    return newModule;
  }

  removeModule(id) {
    if (id === DEFAULT_BUILTIN_MODULE.id) return false; // Prevent removing built-in
    this.modules = this.modules.filter(m => m.id !== id);
    if (this.activeModuleId === id) {
      this.activeModuleId = this.modules[0]?.id || DEFAULT_BUILTIN_MODULE.id;
    }
    this._saveModules(this.modules);
    return true;
  }

  // --- Execution Engine ---

  async search(keyword) {
    const mod = this.getActiveModule();
    if (mod.isBuiltin) {
      return this._builtinSearch(keyword);
    }
    const res = await this._runInSandbox(mod, 'searchResults', [keyword]);
    return Array.isArray(res) ? res : [];
  }

  async getEpisodes(url) {
    const mod = this.getActiveModule();
    if (mod.isBuiltin) {
      return this._builtinEpisodes(url);
    }
    const res = await this._runInSandbox(mod, 'extractEpisodes', [url]);
    return Array.isArray(res) ? res : [];
  }

  async getStream(episodeUrl) {
    const mod = this.getActiveModule();
    if (mod.isBuiltin) {
      return this._builtinStream(episodeUrl);
    }
    let res = await this._runInSandbox(mod, 'extractStreamUrl', [episodeUrl]);

    // Normalize output from string, array, or object
    if (typeof res === 'string') {
      res = {
        streams: [{
          title: 'HD',
          streamUrl: res,
          isM3U8: res.includes('.m3u8')
        }],
        headers: {}
      };
    } else if (Array.isArray(res)) {
      res = {
        streams: res.map((s, idx) => typeof s === 'string' ? {
          title: `Stream ${idx + 1}`,
          streamUrl: s,
          isM3U8: s.includes('.m3u8')
        } : {
          title: s.title || s.quality || 'HD',
          streamUrl: s.url || s.streamUrl,
          isM3U8: Boolean(s.isM3U8 || (s.url && s.url.includes('.m3u8')))
        }),
        headers: {}
      };
    } else if (res && res.streams) {
      res.streams = res.streams.map((s, idx) => typeof s === 'string' ? {
        title: `Stream ${idx + 1}`,
        streamUrl: s,
        isM3U8: s.includes('.m3u8')
      } : {
        title: s.title || s.quality || 'HD',
        streamUrl: s.url || s.streamUrl,
        isM3U8: Boolean(s.isM3U8 || (s.url && s.url.includes('.m3u8')))
      });
    }

    return res || { streams: [] };
  }

  // --- Shirox/Sora Compatible Sandbox Runner ---

  async _runInSandbox(moduleDef, funcName, args) {
    if (!moduleDef.scriptContent) {
      throw new Error(`Module ${moduleDef.sourceName} has no cached script.`);
    }

    // Shirox/Sora compatibility shims
    const soraShims = `
      var _0xB4F2 = function() { return "shirox-cranci-10"; };
      var sendLog = function(msg) { console.log('[Module] ' + msg); };
      function getElementsByTag(html, tag) {
        var regex = new RegExp('<' + tag + '[^>]*>([\\\\s\\\\S]*?)</' + tag + '>', 'gi');
        var matches = [], match;
        while ((match = regex.exec(html)) !== null) { matches.push(match[0]); }
        return matches;
      }
      function getAttribute(element, attr) {
        var regex = new RegExp(attr + '=[\\"\\\'](.+?)[\\"\\\']');
        var match = (element || '').match(regex);
        return match ? match[1] : '';
      }
      function getInnerText(element) { return (element || '').replace(/<[^>]*>/g, '').trim(); }
      function stripHtml(html) { return (html || '').replace(/<[^>]*>/g, ''); }
      function soraFetch(url, options) { return fetch(url, options); }
      function fetchv2(url, headers, method, body, extra) {
        var h = headers || {};
        var m = method || 'GET';
        var b = body || null;
        var opt = extra || {};
        if (typeof headers === 'object' && headers !== null && (headers.method || headers.headers || headers.body)) {
          h = headers.headers || {};
          m = headers.method || m;
          b = headers.body || b;
          opt = headers;
        }
        return fetch(url, { method: m, headers: h, body: b });
      }
    `;

    const sandbox = {
      console: {
        log: (...a) => console.log(`[Module:${moduleDef.sourceName}]`, ...a),
        error: (...a) => console.error(`[Module:${moduleDef.sourceName}]`, ...a),
        warn: (...a) => console.warn(`[Module:${moduleDef.sourceName}]`, ...a)
      },
      fetch: (url, opts) => this._sandboxFetch(url, opts),
      btoa: (str) => Buffer.from(str, 'utf8').toString('base64'),
      atob: (b64) => Buffer.from(b64, 'base64').toString('utf8'),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
      JSON
    };

    const context = vm.createContext(sandbox);
    // Execute compatibility shims first
    vm.runInContext(soraShims, context);
    // Execute module script
    vm.runInContext(moduleDef.scriptContent, context);

    if (typeof context[funcName] !== 'function') {
      throw new Error(`Module does not export function '${funcName}'`);
    }

    return await context[funcName](...args);
  }

  _sandboxFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      this._httpGet(url, 5, opts).then(res => {
        resolve({
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          headers: res.headers,
          text: async () => res.body,
          json: async () => JSON.parse(res.body)
        });
      }).catch(reject);
    });
  }

  // --- Built-in Provider Implementation (Gogoanime / Consumet) ---

  async _builtinSearch(keyword) {
    try {
      const url = `https://api.consumet.org/anime/gogoanime/${encodeURIComponent(keyword)}`;
      const res = await this._httpGet(url);
      const data = JSON.parse(res.body);
      if (data && data.results) {
        return data.results.map(r => ({
          title: r.title,
          image: r.image,
          href: r.id
        }));
      }
    } catch (_) {}

    // Fallback: search Gogo direct endpoint
    try {
      const fallbackUrl = `https://anitaku.to/search.html?keyword=${encodeURIComponent(keyword)}`;
      const res = await this._httpGet(fallbackUrl);
      const html = res.body;
      const items = [];
      const regex = /<p class="name"><a href="\/category\/([^"]+)" title="([^"]+)">/g;
      let match;
      while ((match = regex.exec(html)) !== null) {
        items.push({
          title: match[2],
          href: match[1],
          image: 'https://gogoanime.news/img/icon/logo.png'
        });
      }
      return items;
    } catch (_) {}

    return [];
  }

  async _builtinEpisodes(animeId) {
    try {
      const url = `https://api.consumet.org/anime/gogoanime/info/${encodeURIComponent(animeId)}`;
      const res = await this._httpGet(url);
      const data = JSON.parse(res.body);
      if (data && data.episodes) {
        return data.episodes.map(e => ({
          number: e.number,
          title: `Episode ${e.number}`,
          href: e.id
        }));
      }
    } catch (_) {}

    return [];
  }

  async _builtinStream(episodeId) {
    try {
      const url = `https://api.consumet.org/anime/gogoanime/watch/${episodeId}`;
      const res = await this._httpGet(url);
      const data = JSON.parse(res.body);
      if (data && data.sources) {
        return {
          streams: data.sources.map(s => ({
            title: s.quality || 'Auto',
            streamUrl: s.url,
            isM3U8: s.isM3U8
          })),
          headers: data.headers || { Referer: 'https://anitaku.to/' }
        };
      }
    } catch (_) {}

    return { streams: [] };
  }

  // --- Network Helpers (With Redirect Following and Timeout) ---

  _httpGet(targetUrl, maxRedirects = 5, opts = {}) {
    return new Promise((resolve, reject) => {
      if (maxRedirects < 0) {
        return reject(new Error('Too many redirects while fetching ' + targetUrl));
      }

      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch (e) {
        return reject(new Error('Invalid URL: ' + targetUrl));
      }

      const transport = parsed.protocol === 'https:' ? https : http;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, text/plain, */*',
        ...(opts.headers || {})
      };

      const req = transport.request(targetUrl, {
        method: opts.method || 'GET',
        headers,
        timeout: 12000
      }, (res) => {
        // Follow HTTP redirects automatically (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).href;
          return resolve(this._httpGet(redirectUrl, maxRedirects - 1, opts));
        }

        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            let errorDetail = `HTTP ${res.statusCode} ${res.statusMessage || 'Error'}`;
            if (body && body.includes('error code: 1042')) {
              errorDetail += ' (Cloudflare Worker not found or disabled - error code 1042)';
            } else if (body && body.length < 200 && !body.includes('<html')) {
              errorDetail += ` - ${body.trim()}`;
            }
            return reject(new Error(errorDetail));
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Connection timed out after 12s while reaching ${targetUrl}`));
      });

      req.on('error', (err) => {
        reject(new Error(`Network error connecting to ${targetUrl}: ${err.message}`));
      });

      if (opts.body) {
        req.write(opts.body);
      }
      req.end();
    });
  }
}

module.exports = ModuleEngine;
