/**
 * Custom Fullscreen Video Player & OSD Controller
 * Handles HTML5 video streaming from FTP proxy, Range seeks, subtitles, and playback progress persistence.
 */
class VideoPlayer {
  constructor() {
    this.container = document.getElementById('player-container');
    this.video = document.getElementById('video-element');
    this.track = document.getElementById('video-track');
    this.osd = document.getElementById('player-osd');
    this.osdTitle = document.getElementById('osd-title');
    this.osdQuality = document.getElementById('osd-quality');
    this.progressBar = document.getElementById('osd-progress-bar');
    this.bufferBar = document.getElementById('osd-buffer-bar');
    this.currentTimeEl = document.getElementById('osd-current-time');
    this.totalTimeEl = document.getElementById('osd-total-time');
    this.toggleBtn = document.getElementById('btn-player-toggle');
    this.rewindBtn = document.getElementById('btn-player-rewind');
    this.forwardBtn = document.getElementById('btn-player-forward');
    this.exitBtn = document.getElementById('btn-player-exit');
    this.seekIndicator = document.getElementById('osd-seek-indicator');
    this.seekAmount = document.getElementById('seek-amount');

    this.currentMedia = null;
    this.osdTimer = null;
    this.progressSaveTimer = null;
    this.isSeeking = false;

    this.initEvents();
  }

  initEvents() {
    // Video element listeners
    this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.video.addEventListener('progress', () => this.onProgress());
    this.video.addEventListener('play', () => this.updatePlayPauseIcon());
    this.video.addEventListener('pause', () => this.updatePlayPauseIcon());
    this.video.addEventListener('ended', () => this.onEnded());
    this.video.addEventListener('loadedmetadata', () => {
      this.totalTimeEl.textContent = this.formatTime(this.video.duration);
      if (this.startOffset && this.startOffset > 0) {
        this.video.currentTime = this.startOffset;
        this.startOffset = 0;
      }
    });

    this.video.addEventListener('error', (e) => {
      const err = this.video.error;
      let msg = 'Playback error occurred';
      if (err) {
        switch (err.code) {
          case 1: msg = 'Playback aborted by user'; break;
          case 2: msg = 'Network error: could not fetch video stream from FTP'; break;
          case 3: msg = 'Video decode error: format may be corrupted'; break;
          case 4: msg = 'Format not supported by browser (codec unsupported)'; break;
          default: msg = err.message || 'Unknown media error';
        }
      }
      console.error('Video error:', msg, err);
      this.showErrorBanner(msg);
    });

    // OSD Button clicks
    this.toggleBtn.addEventListener('click', () => this.togglePlayPause());
    this.rewindBtn.addEventListener('click', () => this.seekRelative(-10));
    this.forwardBtn.addEventListener('click', () => this.seekRelative(10));
    this.exitBtn.addEventListener('click', () => this.exit());

    // Timeline direct click / remote seek
    const timeline = document.getElementById('osd-timeline');
    timeline.addEventListener('click', (e) => {
      const rect = timeline.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      if (this.video.duration) {
        this.video.currentTime = pct * this.video.duration;
      }
    });

    // Remote Hardware Key Events
    window.addEventListener('tv:playpause', () => this.togglePlayPause());
    window.addEventListener('tv:play', () => this.video.play());
    window.addEventListener('tv:pause', () => this.video.pause());
    window.addEventListener('tv:forward', () => this.seekRelative(15));
    window.addEventListener('tv:rewind', () => this.seekRelative(-15));
    window.addEventListener('tv:stop', () => this.exit());
    window.addEventListener('tv:exitplayer', () => this.exit());

    // Reset OSD auto-hide on any keypress while playing
    window.addEventListener('keydown', () => {
      if (!this.container.classList.contains('hidden')) {
        this.showOsd();
      }
    });
  }

  /**
   * Start playback of a media item with optional resume offset.
   */
  play(mediaItem, resumeOffset = 0) {
    this.currentMedia = mediaItem;
    this.startOffset = resumeOffset;

    // Build backend stream URL
    const streamUrl = `/api/stream?file=${encodeURIComponent(mediaItem.fullPath)}`;
    const subtitleUrl = `/api/subtitle?file=${encodeURIComponent(mediaItem.fullPath)}`;

    this.osdTitle.textContent = mediaItem.displayTitle || mediaItem.title;
    this.osdQuality.textContent = mediaItem.quality || 'HD';

    this.video.src = streamUrl;
    this.track.src = subtitleUrl;

    this.container.classList.remove('hidden');
    this.showOsd();

    // Focus Play/Pause button in OSD
    window.nav.focus(this.toggleBtn);

    this.video.play().catch(err => {
      console.warn('Video auto-play blocked or failed:', err);
    });

    // Start periodic progress saving
    this.startProgressTracker();
  }

  togglePlayPause() {
    if (this.video.paused) {
      this.video.play();
    } else {
      this.video.pause();
    }
    this.showOsd();
  }

  updatePlayPauseIcon() {
    this.toggleBtn.textContent = this.video.paused ? '▶' : '⏸';
  }

  seekRelative(seconds) {
    if (!this.video.duration) return;
    const target = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    this.video.currentTime = target;
    this.showSeekIndicator(seconds);
    this.showOsd();
  }

  showSeekIndicator(seconds) {
    this.seekAmount.textContent = `${seconds > 0 ? '+' : ''}${seconds}s`;
    this.seekIndicator.classList.remove('hidden');
    clearTimeout(this._seekTimer);
    this._seekTimer = setTimeout(() => {
      this.seekIndicator.classList.add('hidden');
    }, 900);
  }

  onTimeUpdate() {
    if (!this.video.duration) return;
    const current = this.video.currentTime;
    const total = this.video.duration;
    const pct = (current / total) * 100;

    this.progressBar.style.width = `${pct}%`;
    const thumb = document.getElementById('osd-thumb');
    if (thumb) thumb.style.left = `${pct}%`;

    this.currentTimeEl.textContent = this.formatTime(current);
  }

  onProgress() {
    if (!this.video.duration || this.video.buffered.length === 0) return;
    const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
    const pct = (bufferedEnd / this.video.duration) * 100;
    this.bufferBar.style.width = `${pct}%`;
  }

  onEnded() {
    this.saveCurrentProgress(true);
    this.exit();
  }

  showOsd() {
    this.osd.classList.remove('hidden-osd');
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => {
      if (!this.video.paused) {
        this.osd.classList.add('hidden-osd');
      }
    }, 3800);
  }

  startProgressTracker() {
    clearInterval(this.progressSaveTimer);
    this.progressSaveTimer = setInterval(() => {
      this.saveCurrentProgress(false);
    }, 5000);
  }

  saveCurrentProgress(isCompleted = false) {
    if (!this.currentMedia || !this.video.duration) return;
    const payload = {
      fileId: this.currentMedia.id,
      title: this.currentMedia.title,
      currentTime: isCompleted ? 0 : Math.floor(this.video.currentTime),
      duration: Math.floor(this.video.duration),
      completed: isCompleted,
      posterUrl: this.currentMedia.posterUrl || null
    };

    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  exit() {
    clearInterval(this.progressSaveTimer);
    this.saveCurrentProgress(false);

    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();

    const errBanner = document.getElementById('player-error-banner');
    if (errBanner) errBanner.classList.add('hidden');

    this.container.classList.add('hidden');
    this.currentMedia = null;

    // Refresh Continue Watching carousel
    if (window.app && window.app.loadLibrary) {
      window.app.loadLibrary(false);
    }

    // Restore focus to main view
    const homeBtn = document.getElementById('nav-home');
    window.nav.focus(homeBtn);
  }

  showErrorBanner(msg) {
    let errEl = document.getElementById('player-error-banner');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.id = 'player-error-banner';
      errEl.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(220,38,38,0.95);color:#fff;padding:24px 38px;border-radius:14px;font-size:18px;font-weight:600;z-index:99999;box-shadow:0 12px 40px rgba(0,0,0,0.8);text-align:center;max-width:80%;line-height:1.5;';
      this.container.appendChild(errEl);
    }
    errEl.innerHTML = `⚠️ ${msg}<br><span style="font-size:14px;font-weight:400;margin-top:10px;opacity:0.85;display:block;">Press Return/Back or Escape to return to menu</span>`;
    errEl.classList.remove('hidden');
    this.showOsd();
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '00:00:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
}

window.player = new VideoPlayer();
