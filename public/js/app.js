/**
 * TizenFlix Main Application Controller
 * Handles Home, Movies, TV Shows, AniList Discovery, Module Streaming Scrapers,
 * Folder Browser with Fixed Home Folder setting, Details Modal, and Ambient Backdrop Engine.
 */
class TizenFlixApp {
  constructor() {
    this.currentView = 'home';
    this.currentFolder = '/';
    this.selectedMedia = null;
    this.currentAnimeTab = 'watching';
    this.activeModule = null;
    this.selectedModuleItem = null;

    this.libraryData = {
      all: [],
      movies: [],
      tvShows: [],
      recentlyAdded: [],
      continueWatching: []
    };

    this.aniListData = {
      watching: [],
      planning: [],
      completed: [],
      trending: []
    };

    this.ambientBackdrop = document.getElementById('ambient-backdrop');
    this.detailsModal = document.getElementById('details-modal');
    this.episodesModal = document.getElementById('episodes-modal');
    this.moduleManagerModal = document.getElementById('module-manager-modal');

    this.initSidebar();
    this.initDetailsModal();
    this.initBrowseView();
    this.initAnimeView();
    this.initModulesView();

    // Initial Data Loads
    this.loadLibrary(false);
    this.loadAniList();
    this.loadModules();

    // Focus initial sidebar item
    setTimeout(() => {
      const homeBtn = document.getElementById('nav-home');
      if (window.nav && homeBtn) {
        window.nav.focus(homeBtn);
      }
    }, 200);
  }

  // --- Sidebar Navigation ---

  initSidebar() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        if (view === 'settings') {
          window.settings.open();
        } else {
          this.switchView(view);
        }
      });
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      this.loadLibrary(true);
      this.loadAniList();
    });

    const goSettingsBtn = document.getElementById('btn-go-settings');
    if (goSettingsBtn) {
      goSettingsBtn.addEventListener('click', () => {
        window.settings.open();
      });
    }
  }

  switchView(viewName) {
    this.currentView = viewName;

    // Update sidebar active class
    document.querySelectorAll('.nav-item').forEach(el => {
      if (el.getAttribute('data-view') === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Hide all view sections
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));

    const breadcrumb = document.getElementById('breadcrumb-title');

    if (viewName === 'home') {
      breadcrumb.textContent = 'Home';
      document.getElementById('view-home').classList.add('active');
    } else if (viewName === 'anime') {
      breadcrumb.textContent = 'Anime Library & Discovery';
      document.getElementById('view-anime').classList.add('active');
      this.renderAnimeTab(this.currentAnimeTab);
    } else if (viewName === 'modules') {
      breadcrumb.textContent = 'Streaming Modules';
      document.getElementById('view-modules').classList.add('active');
    } else if (viewName === 'movies') {
      breadcrumb.textContent = 'Movies';
      this.renderGrid(this.libraryData.movies, 'Movies');
      document.getElementById('view-grid').classList.add('active');
    } else if (viewName === 'tv') {
      breadcrumb.textContent = 'TV Shows';
      this.renderGrid(this.libraryData.tvShows, 'TV Shows');
      document.getElementById('view-grid').classList.add('active');
    } else if (viewName === 'browse') {
      breadcrumb.textContent = 'Folder Browser';
      document.getElementById('view-browse').classList.add('active');
      this.loadFolder(this.currentFolder);
    }
  }

  // --- FTP Library Scanner ---

  async loadLibrary(forceRefresh = false) {
    const refreshBtn = document.getElementById('btn-refresh');
    refreshBtn.classList.add('scanning');
    refreshBtn.querySelector('span').textContent = 'Scanning FTP...';

    try {
      const res = await fetch(`${window.API_BASE}/api/scan${forceRefresh ? '?refresh=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        this.libraryData = data;
        this.renderHome();
        window.settings.updateConnectionPill(true, 'FTP Connected');
      } else {
        this.showEmptyState();
      }
    } catch (err) {
      console.warn('Library load error:', err.message);
      this.showEmptyState();
    } finally {
      refreshBtn.classList.remove('scanning');
      refreshBtn.querySelector('span').textContent = 'Scan Library';
    }
  }

  renderHome() {
    const emptyState = document.getElementById('home-empty-state');
    const hasFtpMedia = this.libraryData.all && this.libraryData.all.length > 0;
    const hasAniListMedia = this.aniListData.watching.length > 0 || this.aniListData.trending.length > 0;

    if (!hasFtpMedia && !hasAniListMedia) {
      this.showEmptyState();
      return;
    }
    emptyState.classList.add('hidden');

    // Continue Watching Section (FTP)
    const contSection = document.getElementById('section-continue');
    const contTrack = document.getElementById('track-continue');
    contTrack.innerHTML = '';
    if (this.libraryData.continueWatching && this.libraryData.continueWatching.length > 0) {
      contSection.classList.remove('hidden');
      this.libraryData.continueWatching.forEach(item => {
        contTrack.appendChild(this.createCard(item));
      });
    } else {
      contSection.classList.add('hidden');
    }

    // Recently Added Section
    const recentSection = document.getElementById('section-recent');
    const recentTrack = document.getElementById('track-recent');
    recentTrack.innerHTML = '';
    if (this.libraryData.recentlyAdded && this.libraryData.recentlyAdded.length > 0) {
      recentSection.classList.remove('hidden');
      this.libraryData.recentlyAdded.forEach(item => {
        recentTrack.appendChild(this.createCard(item));
      });
    } else {
      recentSection.classList.add('hidden');
    }

    // Movies Section
    const moviesSection = document.getElementById('section-movies');
    const moviesTrack = document.getElementById('track-movies');
    moviesTrack.innerHTML = '';
    if (this.libraryData.movies && this.libraryData.movies.length > 0) {
      moviesSection.classList.remove('hidden');
      this.libraryData.movies.forEach(item => {
        moviesTrack.appendChild(this.createCard(item));
      });
    } else {
      moviesSection.classList.add('hidden');
    }

    // TV Shows Section
    const tvSection = document.getElementById('section-tv');
    const tvTrack = document.getElementById('track-tv');
    tvTrack.innerHTML = '';
    if (this.libraryData.tvShows && this.libraryData.tvShows.length > 0) {
      tvSection.classList.remove('hidden');
      this.libraryData.tvShows.forEach(item => {
        tvTrack.appendChild(this.createCard(item));
      });
    } else {
      tvSection.classList.add('hidden');
    }
  }

  showEmptyState() {
    document.getElementById('home-empty-state').classList.remove('hidden');
    document.getElementById('section-continue').classList.add('hidden');
    document.getElementById('section-recent').classList.add('hidden');
    document.getElementById('section-movies').classList.add('hidden');
    document.getElementById('section-tv').classList.add('hidden');
  }

  renderGrid(items, title) {
    const grid = document.getElementById('grid-container');
    grid.innerHTML = '';
    if (!items || items.length === 0) {
      grid.innerHTML = `<div class="empty-state"><h2>No ${title} found</h2><p>Check your FTP directory or rescan library.</p></div>`;
      return;
    }
    items.forEach(item => {
      grid.appendChild(this.createCard(item));
    });
  }

  // --- AniList Discovery & Tracking ---

  async loadAniList() {
    try {
      // 1. Fetch User Anime Lists
      const userRes = await fetch(`${window.API_BASE}/api/anilist/user`);
      const userData = await userRes.json();

      const continueSection = document.getElementById('section-anilist-continue');
      const continueTrack = document.getElementById('track-anilist-continue');
      continueTrack.innerHTML = '';

      if (userData && userData.loggedIn) {
        this.aniListData.watching = userData.watching || [];
        this.aniListData.planning = userData.planning || [];
        this.aniListData.completed = userData.completed || [];

        if (this.aniListData.watching.length > 0) {
          continueSection.classList.remove('hidden');
          this.aniListData.watching.forEach(item => {
            continueTrack.appendChild(this.createCard({
              ...item,
              isAniList: true,
              quality: item.format || 'Anime',
              displayTitle: `${item.title}${item.progress ? ` (Ep ${item.progress})` : ''}`
            }));
          });
        } else {
          continueSection.classList.add('hidden');
        }
      } else {
        continueSection.classList.add('hidden');
      }

      // 2. Fetch Trending Anime
      const trendRes = await fetch(`${window.API_BASE}/api/anilist/trending`);
      const trendData = await trendRes.json();

      const trendingSection = document.getElementById('section-anilist-trending');
      const trendingTrack = document.getElementById('track-anilist-trending');
      trendingTrack.innerHTML = '';

      if (trendData && trendData.items && trendData.items.length > 0) {
        this.aniListData.trending = trendData.items;
        trendingSection.classList.remove('hidden');
        trendData.items.forEach(item => {
          trendingTrack.appendChild(this.createCard({
            ...item,
            isAniList: true,
            quality: item.format || 'Anime',
            displayTitle: item.title
          }));
        });
      }

      // If currently on anime view, update grid
      if (this.currentView === 'anime') {
        this.renderAnimeTab(this.currentAnimeTab);
      }
    } catch (err) {
      console.warn('AniList fetch error:', err.message);
    }
  }

  initAnimeView() {
    const tabs = [
      { id: 'tab-anime-watching', key: 'watching' },
      { id: 'tab-anime-planning', key: 'planning' },
      { id: 'tab-anime-completed', key: 'completed' },
      { id: 'tab-anime-trending', key: 'trending' }
    ];

    tabs.forEach(({ id, key }) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          tabs.forEach(t => {
            const b = document.getElementById(t.id);
            if (b) b.classList.remove('active');
          });
          btn.classList.add('active');
          this.renderAnimeTab(key);
        });
      }
    });
  }

  renderAnimeTab(tabKey) {
    this.currentAnimeTab = tabKey;
    const grid = document.getElementById('anime-grid-container');
    grid.innerHTML = '';

    const items = this.aniListData[tabKey] || [];
    if (items.length === 0) {
      if (tabKey !== 'trending') {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1; margin-top: 40px;">
            <div class="empty-icon">🌸</div>
            <h2>No ${tabKey} anime found</h2>
            <p>Connect your AniList account in Settings using your phone QR code to sync your watchlist.</p>
            <button class="primary-btn focusable" id="btn-anime-open-settings" tabindex="0">📲 Connect AniList</button>
          </div>
        `;
        const btn = document.getElementById('btn-anime-open-settings');
        if (btn) {
          btn.addEventListener('click', () => window.settings.open());
          window.nav.focus(btn);
        }
      } else {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1; margin-top: 40px;">
            <div class="empty-icon">📺</div>
            <h2>No trending anime found</h2>
            <p>Please check your internet connection or rescan.</p>
          </div>
        `;
      }
      return;
    }

    items.forEach(item => {
      grid.appendChild(this.createCard({
        ...item,
        isAniList: true,
        quality: item.format || 'Anime',
        displayTitle: tabKey === 'watching' && item.progress
          ? `${item.title} (Ep ${item.progress})`
          : item.title
      }));
    });
  }

  // --- Shirox-Compatible Modules Engine ---

  initModulesView() {
    const searchInput = document.getElementById('module-search-input');
    const searchBtn = document.getElementById('btn-module-search');
    const mgrBtn = document.getElementById('btn-open-module-manager');
    const closeMgrBtn = document.getElementById('btn-close-modules-modal');
    const installBtn = document.getElementById('btn-install-module');
    const closeEpisodesBtn = document.getElementById('btn-close-episodes');

    const doSearch = () => {
      const q = searchInput.value.trim();
      if (q) this.searchModule(q);
    };

    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    }

    if (searchBtn) searchBtn.addEventListener('click', doSearch);
    if (mgrBtn) mgrBtn.addEventListener('click', () => this.openModuleManager());
    if (closeMgrBtn) closeMgrBtn.addEventListener('click', () => this.closeModuleManager());
    if (closeEpisodesBtn) closeEpisodesBtn.addEventListener('click', () => this.closeEpisodesModal());

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        const urlInput = document.getElementById('input-module-url');
        const url = urlInput.value.trim();
        if (!url) return;
        installBtn.textContent = 'Installing...';
        try {
          const res = await fetch(`${window.API_BASE}/api/modules/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          const data = await res.json();
          if (data.success) {
            urlInput.value = '';
            installBtn.textContent = 'Installed!';
            setTimeout(() => { installBtn.textContent = 'Install'; }, 2000);
            this.loadModules();
            this.renderModuleManager();
          } else {
            alert('Install failed: ' + (data.error || 'Unknown error'));
            installBtn.textContent = 'Install';
          }
        } catch (err) {
          alert('Install error: ' + err.message);
          installBtn.textContent = 'Install';
        }
      });
    }

    document.querySelectorAll('.suggested-module').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const input = document.getElementById('input-module-url');
        if (input && el.dataset.url) {
          input.value = el.dataset.url;
          if (installBtn) window.nav.focus(installBtn);
        }
      });
    });
  }

  async loadModules() {
    try {
      const res = await fetch(`${window.API_BASE}/api/modules`);
      const data = await res.json();
      this.activeModule = data.active || null;
      const nameEl = document.getElementById('active-module-name');
      if (nameEl) {
        nameEl.textContent = this.activeModule ? this.activeModule.sourceName : 'None';
      }
    } catch (_) {}
  }

  async searchModule(query) {
    const container = document.getElementById('module-results-container');
    container.innerHTML = '<div style="padding: 24px; color: var(--text-secondary); grid-column: 1 / -1;">Searching active provider...</div>';

    const searchInput = document.getElementById('module-search-input');
    if (searchInput && searchInput.value !== query) {
      searchInput.value = query;
    }

    try {
      const res = await fetch(`${window.API_BASE}/api/module/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      container.innerHTML = '';

      if (!data.results || data.results.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <h2>No streaming results found</h2>
            <p>Try searching with romaji title or switch provider in Module Manager.</p>
          </div>
        `;
        return;
      }

      data.results.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card focusable';
        card.tabIndex = 0;

        const img = item.image || this.generateFallbackPoster(item.title, '', 'STREAM');
        card.innerHTML = `
          <div class="card-poster-wrap">
            <img class="card-poster" src="${img}" alt="${item.title}" loading="lazy">
            <span class="card-badge">ONLINE</span>
          </div>
          <div class="card-info">
            <span class="card-title" title="${item.title}">${item.title}</span>
            <div class="card-subtitle">
              <span>Streaming Module</span>
            </div>
          </div>
        `;

        card.addEventListener('tv:focused', () => {
          this.ambientBackdrop.style.backgroundImage = `url('${img}')`;
        });

        card.addEventListener('click', () => {
          this.openEpisodePicker(item);
        });

        container.appendChild(card);
      });
    } catch (err) {
      container.innerHTML = `<div style="padding: 24px; color: var(--danger); grid-column: 1 / -1;">Search error: ${err.message}</div>`;
    }
  }

  async openEpisodePicker(item) {
    this.selectedModuleItem = item;
    const titleEl = document.getElementById('episodes-modal-title');
    const listEl = document.getElementById('episodes-list-container');

    titleEl.textContent = item.title;
    listEl.innerHTML = '<div style="grid-column: 1 / -1; padding: 20px; color: var(--text-secondary);">Fetching episodes...</div>';

    this.episodesModal.classList.remove('hidden');
    window.nav.focus(document.getElementById('btn-close-episodes'));

    try {
      const res = await fetch(`${window.API_BASE}/api/module/episodes?url=${encodeURIComponent(item.href)}`);
      const data = await res.json();
      listEl.innerHTML = '';

      if (!data.episodes || data.episodes.length === 0) {
        listEl.innerHTML = '<div style="grid-column: 1 / -1; padding: 20px; color: var(--text-secondary);">No episodes found for this entry.</div>';
        return;
      }

      data.episodes.forEach((ep, idx) => {
        const epBtn = document.createElement('button');
        epBtn.className = 'episode-btn focusable';
        epBtn.tabIndex = 0;
        epBtn.textContent = ep.number ? `Ep ${ep.number}` : (ep.title || `Episode ${idx + 1}`);

        epBtn.addEventListener('click', () => {
          this.playModuleEpisode(item, ep);
        });

        listEl.appendChild(epBtn);
      });

      // Auto-focus first episode
      const firstEp = listEl.querySelector('.episode-btn');
      if (firstEp) {
        window.nav.focus(firstEp);
      }
    } catch (err) {
      listEl.innerHTML = `<div style="grid-column: 1 / -1; padding: 20px; color: var(--danger);">Failed to load episodes: ${err.message}</div>`;
    }
  }

  async playModuleEpisode(item, ep) {
    this.closeEpisodesModal();

    try {
      const res = await fetch(`${window.API_BASE}/api/module/stream?url=${encodeURIComponent(ep.href)}`);
      const data = await res.json();

      if (!data.streams || data.streams.length === 0) {
        alert('Could not resolve stream URL from provider.');
        return;
      }

      // Prefer highest quality or default stream
      const best = data.streams.find(s => s.isM3U8) || data.streams[0];
      let streamUrl = best.streamUrl;

      // Wrap with streaming proxy if referer headers are present to bypass 403 Forbidden
      if (data.headers && (data.headers.Referer || data.headers.referer)) {
        const ref = data.headers.Referer || data.headers.referer;
        streamUrl = `${window.API_BASE}/api/module/proxy?url=${encodeURIComponent(streamUrl)}&referer=${encodeURIComponent(ref)}`;
      }

      const mediaPayload = {
        title: `${item.title} - Episode ${ep.number || 1}`,
        displayTitle: `${item.title} - Ep ${ep.number || 1}`,
        quality: best.title || 'HD',
        streamUrl,
        posterUrl: item.image,
        anilistId: item.anilistId || null,
        episode: parseInt(ep.number, 10) || 1
      };

      window.player.play(mediaPayload, 0);
    } catch (err) {
      alert('Error starting stream: ' + err.message);
    }
  }

  closeEpisodesModal() {
    if (this.episodesModal) this.episodesModal.classList.add('hidden');
    const firstCard = document.querySelector('#module-results-container .media-card');
    if (firstCard) window.nav.focus(firstCard);
  }

  async openModuleManager() {
    this.moduleManagerModal.classList.remove('hidden');
    window.nav.focus(document.getElementById('btn-close-modules-modal'));
    await this.renderModuleManager();
  }

  async renderModuleManager() {
    const container = document.getElementById('installed-modules-container');
    container.innerHTML = '<div style="padding: 10px; color: var(--text-secondary);">Loading modules...</div>';

    try {
      const res = await fetch(`${window.API_BASE}/api/modules`);
      const data = await res.json();
      container.innerHTML = '';

      (data.modules || []).forEach(mod => {
        const row = document.createElement('div');
        row.className = 'module-item-row';
        row.innerHTML = `
          <div class="module-item-info">
            <span class="module-item-name">${mod.sourceName} ${mod.isActive ? '<span style="color:#10b981;font-size:12px;">(Active)</span>' : ''}</span>
            <span class="module-item-sub">v${mod.version || '1.0.0'} • By ${mod.author?.name || 'Unknown'}</span>
          </div>
          <div style="display:flex;gap:8px;">
            ${!mod.isActive ? `<button class="secondary-btn focusable btn-set-active" data-id="${mod.id}" style="padding:6px 14px;font-size:13px;" tabindex="0">Set Active</button>` : ''}
            ${mod.id !== 'builtin-gogoanime' ? `<button class="secondary-btn focusable btn-del-mod" data-id="${mod.id}" style="padding:6px 14px;font-size:13px;color:#ef4444;" tabindex="0">✕</button>` : ''}
          </div>
        `;

        const setBtn = row.querySelector('.btn-set-active');
        if (setBtn) {
          setBtn.addEventListener('click', async () => {
            await fetch(`${window.API_BASE}/api/modules/active`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: mod.id })
            });
            this.loadModules();
            this.renderModuleManager();
          });
        }

        const delBtn = row.querySelector('.btn-del-mod');
        if (delBtn) {
          delBtn.addEventListener('click', async () => {
            await fetch(`${window.API_BASE}/api/modules`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: mod.id })
            });
            this.loadModules();
            this.renderModuleManager();
          });
        }

        container.appendChild(row);
      });
    } catch (err) {
      container.innerHTML = `<div style="color:var(--danger);padding:10px;">Error: ${err.message}</div>`;
    }
  }

  closeModuleManager() {
    if (this.moduleManagerModal) this.moduleManagerModal.classList.add('hidden');
    const mgrBtn = document.getElementById('btn-open-module-manager');
    if (mgrBtn) window.nav.focus(mgrBtn);
  }

  // --- Folder Browser & Fixed Home Folder ---

  initBrowseView() {
    document.getElementById('btn-folder-up').addEventListener('click', () => {
      if (this.currentFolder === '/' || this.currentFolder === '') return;
      const parts = this.currentFolder.replace(/\/$/, '').split('/');
      parts.pop();
      const parent = parts.join('/') || '/';
      this.loadFolder(parent);
    });

    const setHomeBtn = document.getElementById('btn-set-home-folder');
    if (setHomeBtn) {
      setHomeBtn.addEventListener('click', async () => {
        try {
          const res = await fetch(`${window.API_BASE}/api/settings/home-folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: this.currentFolder })
          });
          if (res.ok) {
            setHomeBtn.textContent = '✔ Home Folder Set!';
            setTimeout(() => { setHomeBtn.textContent = '📌 Set as Home Folder'; }, 2200);
            this.loadLibrary(true);
          }
        } catch (err) {
          alert('Failed to set home folder: ' + err.message);
        }
      });
    }
  }

  async loadFolder(folderPath) {
    this.currentFolder = folderPath;
    document.getElementById('current-folder-path').textContent = folderPath;
    const container = document.getElementById('folder-items-container');
    container.innerHTML = '<div style="padding: 20px; color: var(--text-secondary);">Loading directory...</div>';

    try {
      const res = await fetch(`${window.API_BASE}/api/browse?path=${encodeURIComponent(folderPath)}`);
      const data = await res.json();
      if (data.path) {
        this.currentFolder = data.path;
        document.getElementById('current-folder-path').textContent = data.path;
      }
      container.innerHTML = '';

      if (!data.items || data.items.length === 0) {
        container.innerHTML = '<div style="padding: 20px; color: var(--text-secondary);">Directory is empty.</div>';
        return;
      }

      data.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'folder-item focusable';
        row.tabIndex = 0;

        const icon = item.isDirectory ? '📁' : (item.isVideo ? '🎬' : '📄');
        row.innerHTML = `
          <div class="folder-item-left">
            <span class="folder-icon">${icon}</span>
            <span class="folder-item-name">${item.name}</span>
          </div>
          <span class="folder-item-size">${item.isDirectory ? 'Folder' : item.formattedSize}</span>
        `;

        row.addEventListener('click', () => {
          if (item.isDirectory) {
            this.loadFolder(item.path);
          } else if (item.isVideo) {
            this.openDetails(item);
          }
        });

        container.appendChild(row);
      });
    } catch (err) {
      container.innerHTML = `<div style="padding: 20px; color: var(--danger);">Error loading directory: ${err.message}</div>`;
    }
  }

  // --- Details Modal & Media Cards ---

  createCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card focusable';
    card.tabIndex = 0;

    const posterSrc = item.posterUrl || this.generateFallbackPoster(item.title, item.year, item.quality);

    let progressHtml = '';
    if (item.progress && item.progress.currentTime && item.progress.duration) {
      const pct = (item.progress.currentTime / item.progress.duration) * 100;
      progressHtml = `
        <div class="card-progress-bar">
          <div class="card-progress-fill" style="width: ${pct}%"></div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-poster-wrap">
        <img class="card-poster" src="${posterSrc}" alt="${item.title}" loading="lazy">
        <span class="card-badge">${item.quality || 'HD'}</span>
        ${progressHtml}
      </div>
      <div class="card-info">
        <span class="card-title" title="${item.displayTitle || item.title}">${item.displayTitle || item.title}</span>
        <div class="card-subtitle">
          <span>${item.year || ''}</span>
          <span>${item.formattedSize || (item.totalEpisodes ? `${item.totalEpisodes} eps` : '')}</span>
        </div>
      </div>
    `;

    // Dynamic Ambient Backdrop when card receives focus
    card.addEventListener('tv:focused', () => {
      const bgImg = item.backdropUrl || item.posterUrl || posterSrc;
      this.ambientBackdrop.style.backgroundImage = `url('${bgImg}')`;
    });

    // Click opens Details Modal
    card.addEventListener('click', () => {
      this.openDetails(item);
    });

    return card;
  }

  generateFallbackPoster(title, year, quality) {
    const colors = [
      ['#1e3c72', '#2a5298'],
      ['#3a1c71', '#d76d77'],
      ['#134e5e', '#71b280'],
      ['#2c3e50', '#4ca1af'],
      ['#4b1248', '#f0c27b']
    ];
    const hash = (title || 'T').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const [c1, c2] = colors[hash % colors.length];

    const safeTitle = (title || 'Media').replace(/[<>&'"]/g, '');
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${c1}" />
            <stop offset="100%" stop-color="${c2}" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
        <circle cx="150" cy="180" r="45" fill="rgba(255,255,255,0.12)" />
        <polygon points="142,162 166,180 142,198" fill="#ffffff" />
        <text x="150" y="270" font-family="sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">${safeTitle.substring(0, 22)}</text>
        <text x="150" y="300" font-family="sans-serif" font-size="14" fill="rgba(255,255,255,0.8)" text-anchor="middle">${year || ''}</text>
      </svg>
    `;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  initDetailsModal() {
    const playBtn = document.getElementById('btn-detail-play');
    const resumeBtn = document.getElementById('btn-detail-resume');
    const streamOnlineBtn = document.getElementById('btn-detail-stream-online');
    const closeBtn = document.getElementById('btn-detail-close');

    playBtn.addEventListener('click', () => {
      this.detailsModal.classList.add('hidden');
      window.player.play(this.selectedMedia, 0);
    });

    resumeBtn.addEventListener('click', () => {
      this.detailsModal.classList.add('hidden');
      const offset = (this.selectedMedia.progress && this.selectedMedia.progress.currentTime) || 0;
      window.player.play(this.selectedMedia, offset);
    });

    if (streamOnlineBtn) {
      streamOnlineBtn.addEventListener('click', () => {
        this.detailsModal.classList.add('hidden');
        this.switchView('modules');
        const searchTitle = this.selectedMedia.romajiTitle || this.selectedMedia.title;
        this.searchModule(searchTitle);
      });
    }

    closeBtn.addEventListener('click', () => {
      this.detailsModal.classList.add('hidden');
    });
  }

  openDetails(item) {
    this.selectedMedia = item;
    const poster = document.getElementById('detail-poster');
    const title = document.getElementById('detail-title');
    const year = document.getElementById('detail-year');
    const quality = document.getElementById('detail-quality');
    const size = document.getElementById('detail-size');
    const rating = document.getElementById('detail-rating');
    const overview = document.getElementById('detail-overview');
    const playBtn = document.getElementById('btn-detail-play');
    const resumeBtn = document.getElementById('btn-detail-resume');
    const streamOnlineBtn = document.getElementById('btn-detail-stream-online');

    poster.src = item.posterUrl || this.generateFallbackPoster(item.title, item.year, item.quality);
    title.textContent = item.displayTitle || item.title;
    year.textContent = item.year || (item.seasonYear ? `${item.seasonYear}` : '2024');
    quality.textContent = item.quality || (item.format || 'HD');
    size.textContent = item.formattedSize || (item.totalEpisodes ? `${item.totalEpisodes} Episodes` : '');

    if (item.rating) {
      rating.textContent = `★ ${item.rating}`;
      rating.classList.remove('hidden');
    } else {
      rating.classList.add('hidden');
    }

    overview.textContent = item.overview || `File: ${item.filename || item.title}\nPath: ${item.fullPath || 'Online Media'}`;

    // Configure Action Buttons
    const isLocalFtpFile = Boolean(item.fullPath);

    if (isLocalFtpFile) {
      playBtn.classList.remove('hidden');
      if (streamOnlineBtn) streamOnlineBtn.classList.remove('hidden');

      if (item.progress && item.progress.currentTime > 15 && !item.progress.completed) {
        resumeBtn.textContent = `↺ Resume (${window.player.formatTime(item.progress.currentTime)})`;
        resumeBtn.classList.remove('hidden');
        this.detailsModal.classList.remove('hidden');
        window.nav.focus(resumeBtn);
      } else {
        resumeBtn.classList.add('hidden');
        this.detailsModal.classList.remove('hidden');
        window.nav.focus(playBtn);
      }
    } else {
      // Online AniList Item
      playBtn.classList.add('hidden');
      resumeBtn.classList.add('hidden');
      if (streamOnlineBtn) {
        streamOnlineBtn.classList.remove('hidden');
        streamOnlineBtn.textContent = '🌐 Stream Online with Module';
        this.detailsModal.classList.remove('hidden');
        window.nav.focus(streamOnlineBtn);
      }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new TizenFlixApp();
});
