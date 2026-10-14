/**
 * Settings Controller
 * Manages FTP credentials, fixed home directory, TMDB API, and AniList QR authentication.
 */
class SettingsController {
  constructor() {
    this.modal = document.getElementById('settings-modal');
    this.form = document.getElementById('settings-form');
    this.hostInput = document.getElementById('cfg-host');
    this.portInput = document.getElementById('cfg-port');
    this.userInput = document.getElementById('cfg-user');
    this.passInput = document.getElementById('cfg-pass');
    this.pathInput = document.getElementById('cfg-path');
    this.tmdbInput = document.getElementById('cfg-tmdb');
    this.statusBox = document.getElementById('settings-status-box');
    this.testBtn = document.getElementById('btn-test-ftp');
    this.saveBtn = document.getElementById('btn-save-settings');
    this.closeBtn = document.getElementById('btn-close-settings');
    this.indicator = document.getElementById('connection-indicator');

    // AniList QR Modal elements
    this.qrModal = document.getElementById('anilist-qr-modal');
    this.qrContainer = document.getElementById('qr-code-container');
    this.qrUrlText = document.getElementById('qr-mobile-url');
    this.qrCloseBtn = document.getElementById('btn-close-qr-modal');
    this.openQrBtn = document.getElementById('btn-open-anilist-qr');
    this.logoutBtn = document.getElementById('btn-anilist-logout');
    this.pollInterval = null;

    this.init();
  }

  init() {
    this.loadSettings();
    this.checkAniListUser();

    this.testBtn.addEventListener('click', () => this.testConnection());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSettings();
    });
    this.closeBtn.addEventListener('click', () => this.close());

    if (this.openQrBtn) {
      this.openQrBtn.addEventListener('click', () => this.openAniListQr());
    }
    if (this.qrCloseBtn) {
      this.qrCloseBtn.addEventListener('click', () => this.closeAniListQr());
    }
    if (this.logoutBtn) {
      this.logoutBtn.addEventListener('click', () => this.logoutAniList());
    }
  }

  async loadSettings() {
    try {
      const res = await fetch(`${window.API_BASE}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        this.populateForm(data);
        if (data.host && data.host !== '127.0.0.1') {
          this.updateConnectionPill(true, `FTP: ${data.host}`);
        } else {
          this.updateConnectionPill(false, 'FTP Not Configured');
        }
      }
    } catch (_) {
      // Fallback from localStorage
      const local = localStorage.getItem('tizenflix_settings') || localStorage.getItem('plexftp_settings');
      if (local) {
        this.populateForm(JSON.parse(local));
      }
    }
  }

  populateForm(data) {
    if (data.host) this.hostInput.value = data.host;
    if (data.port) this.portInput.value = data.port;
    if (data.user) this.userInput.value = data.user;
    if (data.password) this.passInput.value = data.password;
    if (data.path) this.pathInput.value = data.path;
    if (data.tmdbApiKey) this.tmdbInput.value = data.tmdbApiKey;
  }

  getFormData() {
    return {
      host: this.hostInput.value.trim(),
      port: parseInt(this.portInput.value.trim(), 10) || 21,
      user: this.userInput.value.trim() || 'anonymous',
      password: this.passInput.value,
      path: this.pathInput.value.trim() || '/',
      tmdbApiKey: this.tmdbInput.value.trim()
    };
  }

  async testConnection() {
    const config = this.getFormData();
    this.statusBox.className = 'settings-status-box';
    this.statusBox.textContent = 'Connecting to FTP server...';
    this.testBtn.disabled = true;

    try {
      const res = await fetch(`${window.API_BASE}/api/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();

      if (data.success) {
        this.statusBox.className = 'settings-status-box success';
        this.statusBox.textContent = `✔ ${data.message}`;
        this.updateConnectionPill(true, 'FTP Connected');
      } else {
        this.statusBox.className = 'settings-status-box error';
        this.statusBox.textContent = `✖ Connection failed: ${data.error || 'Check host, port and credentials.'}`;
        this.updateConnectionPill(false, 'Connection Failed');
      }
    } catch (err) {
      this.statusBox.className = 'settings-status-box error';
      this.statusBox.textContent = `✖ Error: ${err.message}`;
    } finally {
      this.testBtn.disabled = false;
    }
  }

  async saveSettings() {
    const config = this.getFormData();
    localStorage.setItem('tizenflix_settings', JSON.stringify(config));
    localStorage.setItem('plexftp_settings', JSON.stringify(config));

    try {
      const res = await fetch(`${window.API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        this.close();
        if (window.app && window.app.loadLibrary) {
          window.app.loadLibrary(true);
        }
      }
    } catch (err) {
      this.statusBox.className = 'settings-status-box error';
      this.statusBox.textContent = `Failed to save: ${err.message}`;
    }
  }

  // --- AniList Authentication & Status ---

  async checkAniListUser() {
    try {
      const res = await fetch(`${window.API_BASE}/api/anilist/user`);
      const data = await res.json();
      const loggedInBox = document.getElementById('anilist-logged-in-state');
      const loggedOutBox = document.getElementById('anilist-logged-out-state');

      if (data && data.loggedIn && data.user) {
        if (loggedOutBox) loggedOutBox.classList.add('hidden');
        if (loggedInBox) {
          loggedInBox.classList.remove('hidden');
          document.getElementById('anilist-user-name').textContent = `@${data.user.name}`;
          document.getElementById('anilist-user-avatar').src = data.user.avatar.medium || data.user.avatar.large;
        }
      } else {
        if (loggedOutBox) loggedOutBox.classList.remove('hidden');
        if (loggedInBox) loggedInBox.classList.add('hidden');
      }
    } catch (_) {}
  }

  async openAniListQr() {
    try {
      const res = await fetch(`${window.API_BASE}/api/auth/anilist/qr`);
      const data = await res.json();
      if (!data || !data.sid) return;

      this.qrContainer.innerHTML = data.qrSvg;
      this.qrUrlText.textContent = data.mobileUrl;
      this.qrModal.classList.remove('hidden');

      window.nav.focus(this.qrCloseBtn);

      // Start polling for user confirmation on phone
      clearInterval(this.pollInterval);
      this.pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`${window.API_BASE}/api/auth/anilist/status?sid=${data.sid}`);
          const pollData = await pollRes.json();
          if (pollData.status === 'authorized') {
            clearInterval(this.pollInterval);
            this.closeAniListQr();
            this.checkAniListUser();
            if (window.app && window.app.loadAniList) {
              window.app.loadAniList();
            }
          }
        } catch (_) {}
      }, 1500);
    } catch (err) {
      alert('Could not start QR auth: ' + err.message);
    }
  }

  closeAniListQr() {
    clearInterval(this.pollInterval);
    if (this.qrModal) this.qrModal.classList.add('hidden');
    window.nav.focus(this.openQrBtn || this.closeBtn);
  }

  async logoutAniList() {
    try {
      await fetch(`${window.API_BASE}/api/anilist/logout`, { method: 'POST' });
      this.checkAniListUser();
      if (window.app && window.app.loadAniList) {
        window.app.loadAniList();
      }
    } catch (_) {}
  }

  updateConnectionPill(connected, text) {
    if (connected) {
      this.indicator.className = 'connection-pill connected';
      this.indicator.querySelector('.status-text').textContent = text || 'FTP Online';
    } else {
      this.indicator.className = 'connection-pill disconnected';
      this.indicator.querySelector('.status-text').textContent = text || 'FTP Offline';
    }
  }

  open() {
    this.modal.classList.remove('hidden');
    this.checkAniListUser();
    window.nav.focus(this.hostInput);
  }

  close() {
    this.modal.classList.add('hidden');
    const settingsNav = document.getElementById('nav-settings');
    window.nav.focus(settingsNav);
  }
}

window.settings = new SettingsController();
