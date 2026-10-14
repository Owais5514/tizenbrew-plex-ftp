/**
 * Plex FTP Player Main Application
 * View switcher, carousel & grid renderer, ambient backdrop engine, and details modal.
 */
class PlexApp {
  constructor() {
    this.currentView = 'home';
    this.libraryData = {
      all: [],
      movies: [],
      tvShows: [],
      recentlyAdded: [],
      continueWatching: []
    };
    this.currentFolder = '/';
    this.selectedMedia = null;

    this.ambientBackdrop = document.getElementById('ambient-backdrop');
    this.detailsModal = document.getElementById('details-modal');

    this.initSidebar();
    this.initDetailsModal();
    this.initBrowseView();

    // Start library scan
    this.loadLibrary(false);

    // Focus initial sidebar item
    setTimeout(() => {
      const homeBtn = document.getElementById('nav-home');
      window.nav.focus(homeBtn);
    }, 200);
  }

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
    });

    document.getElementById('btn-go-settings').addEventListener('click', () => {
      window.settings.open();
    });
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

  async loadLibrary(forceRefresh = false) {
    const refreshBtn = document.getElementById('btn-refresh');
    refreshBtn.classList.add('scanning');
    refreshBtn.querySelector('span').textContent = 'Scanning FTP...';

    try {
      const res = await fetch(`/api/scan${forceRefresh ? '?refresh=true' : ''}`);
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
    if (!this.libraryData.all || this.libraryData.all.length === 0) {
      this.showEmptyState();
      return;
    }
    emptyState.classList.add('hidden');

    // Continue Watching Section
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
    const recentTrack = document.getElementById('track-recent');
    recentTrack.innerHTML = '';
    this.libraryData.recentlyAdded.forEach(item => {
      recentTrack.appendChild(this.createCard(item));
    });

    // Movies Section
    const moviesTrack = document.getElementById('track-movies');
    moviesTrack.innerHTML = '';
    this.libraryData.movies.forEach(item => {
      moviesTrack.appendChild(this.createCard(item));
    });

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

  createCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card focusable';
    card.tabIndex = 0;

    // Poster fallback generator if no TMDB poster
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
          <span>${item.formattedSize || ''}</span>
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
    // Generate inline SVG poster with gradient and typography
    const colors = [
      ['#1e3c72', '#2a5298'],
      ['#3a1c71', '#d76d77'],
      ['#134e5e', '#71b280'],
      ['#2c3e50', '#4ca1af'],
      ['#4b1248', '#f0c27b']
    ];
    const hash = (title || 'P').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
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
    const resumeBtn = document.getElementById('btn-detail-resume');

    poster.src = item.posterUrl || this.generateFallbackPoster(item.title, item.year, item.quality);
    title.textContent = item.displayTitle || item.title;
    year.textContent = item.year || 'Unknown Year';
    quality.textContent = item.quality || 'HD';
    size.textContent = item.formattedSize || '';

    if (item.rating) {
      rating.textContent = `★ ${item.rating}`;
      rating.classList.remove('hidden');
    } else {
      rating.classList.add('hidden');
    }

    overview.textContent = item.overview || `File: ${item.filename}\nLocation on FTP: ${item.fullPath}`;

    // Handle Resume Button visibility
    if (item.progress && item.progress.currentTime > 15 && !item.progress.completed) {
      resumeBtn.textContent = `↺ Resume (${window.player.formatTime(item.progress.currentTime)})`;
      resumeBtn.classList.remove('hidden');
      this.detailsModal.classList.remove('hidden');
      window.nav.focus(resumeBtn);
    } else {
      resumeBtn.classList.add('hidden');
      this.detailsModal.classList.remove('hidden');
      window.nav.focus(document.getElementById('btn-detail-play'));
    }
  }

  initBrowseView() {
    document.getElementById('btn-folder-up').addEventListener('click', () => {
      if (this.currentFolder === '/' || this.currentFolder === '') return;
      const parts = this.currentFolder.replace(/\/$/, '').split('/');
      parts.pop();
      const parent = parts.join('/') || '/';
      this.loadFolder(parent);
    });
  }

  async loadFolder(folderPath) {
    this.currentFolder = folderPath;
    document.getElementById('current-folder-path').textContent = folderPath;
    const container = document.getElementById('folder-items-container');
    container.innerHTML = '<div style="padding: 20px; color: var(--text-secondary);">Loading directory...</div>';

    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(folderPath)}`);
      const data = await res.json();
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
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new PlexApp();
});
