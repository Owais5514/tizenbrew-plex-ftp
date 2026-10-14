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

  async installModule(manifestUrl) {
    const manifest = await this._fetchJson(manifestUrl);
    if (!manifest || !manifest.scriptUrl) {
      throw new Error('Invalid manifest: missing scriptUrl');
    }

    const scriptContent = await this._fetchText(manifest.scriptUrl);
    if (!scriptContent) {
      throw new Error('Failed to download module script from ' + manifest.scriptUrl);
    }

    const newModule = {
      id: manifest.scriptUrl,
      sourceName: manifest.sourceName || 'Custom Module',
      iconUrl: manifest.iconUrl || null,
      author: manifest.author || { name: 'Unknown' },
      version: manifest.version || '1.0.0',
      baseUrl: manifest.baseUrl || null,
      scriptUrl: manifest.scriptUrl,
      type: manifest.type || 'anime',
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
    return this._runInSandbox(mod, 'searchResults', [keyword]);
  }

  async getEpisodes(url) {
    const mod = this.getActiveModule();
    if (mod.isBuiltin) {
      return this._builtinEpisodes(url);
    }
    return this._runInSandbox(mod, 'extractEpisodes', [url]);
  }

  async getStream(episodeUrl) {
    const mod = this.getActiveModule();
    if (mod.isBuiltin) {
      return this._builtinStream(episodeUrl);
    }
    return this._runInSandbox(mod, 'extractStreamUrl', [episodeUrl]);
  }

  // --- Sandbox Runner ---

  async _runInSandbox(moduleDef, funcName, args) {
    if (!moduleDef.scriptContent) {
      throw new Error(`Module ${moduleDef.sourceName} has no cached script.`);
    }

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
      clearTimeout
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(moduleDef.scriptContent, context);

    if (typeof context[funcName] !== 'function') {
      throw new Error(`Module does not export function '${funcName}'`);
    }

    return await context[funcName](...args);
  }

  _sandboxFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const isHttps = u.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers = opts.headers || {};
      if (!headers['User-Agent']) {
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      }

      const req = transport.request(url, {
        method: opts.method || 'GET',
        headers
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => body,
            json: async () => JSON.parse(body)
          });
        });
      });

      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  // --- Built-in Provider Implementation (Gogoanime / Consumet) ---

  async _builtinSearch(keyword) {
    try {
      const url = `https://api.consumet.org/anime/gogoanime/${encodeURIComponent(keyword)}`;
      const data = await this._fetchJson(url);
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
      const html = await this._fetchText(fallbackUrl);
      const items = [];
      const regex = /<p class="name"><a href="\/category\/([^"]+)" title="([^"]+)">/g;
      const imgRegex = /<img src="([^"]+)"/g;
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
      const url = `https://api.consumet.org/anime/gogoanime/info/${animeId}`;
      const data = await this._fetchJson(url);
      if (data && data.episodes) {
        return data.episodes.map(e => ({
          number: e.number,
          href: e.id
        }));
      }
    } catch (_) {}

    return [];
  }

  async _builtinStream(episodeId) {
    try {
      const url = `https://api.consumet.org/anime/gogoanime/watch/${episodeId}`;
      const data = await this._fetchJson(url);
      if (data && data.sources) {
        const defaultSrc = data.sources.find(s => s.isM3U8) || data.sources[0];
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

  // --- Network Helpers ---

  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const transport = u.protocol === 'https:' ? https : http;
      transport.get(url, { headers: { 'User-Agent': 'TizenFlix/1.0' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  _fetchText(url) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const transport = u.protocol === 'https:' ? https : http;
      transport.get(url, { headers: { 'User-Agent': 'TizenFlix/1.0' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      }).on('error', () => resolve(null));
    });
  }
}

module.exports = ModuleEngine;
