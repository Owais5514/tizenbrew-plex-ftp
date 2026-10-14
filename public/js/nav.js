/**
 * 2D Spatial Navigation Engine for TV Remote Control D-pad
 * Fully compatible with Samsung Tizen TV remote controls and standard keyboard arrows.
 */
window.API_BASE = (window.location.port === '8999' || !window.location.port)
  ? ''
  : `${window.location.protocol}//${window.location.hostname || '127.0.0.1'}:8999`;

class SpatialNav {
  constructor() {
    this.currentFocus = null;
    this.focusHistory = [];
    this.initKeyListeners();
    this.registerTizenKeys();
  }

  /**
   * Register Samsung Tizen remote hardware keys via Tizen Web Device API.
   */
  registerTizenKeys() {
    if (window.tizen && tizen.tvinputdevice) {
      const keysToRegister = [
        'MediaPlayPause',
        'MediaPlay',
        'MediaPause',
        'MediaStop',
        'MediaFastForward',
        'MediaRewind',
        'ColorF0Red',
        'ColorF1Green',
        'ColorF2Yellow',
        'ColorF3Blue'
      ];

      keysToRegister.forEach(key => {
        try {
          tizen.tvinputdevice.registerKey(key);
        } catch (_) {}
      });
    }
  }

  /**
   * Listen to remote control and keyboard events.
   */
  initKeyListeners() {
    window.addEventListener('keydown', (e) => {
      const keyCode = e.keyCode || e.which;
      const keyName = e.key;

      // Check if user is typing inside an input box
      const isInputFocused = document.activeElement && 
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      // Tizen Back / Return Key (10009) or Escape / Backspace
      if (keyCode === 10009 || keyCode === 27 || (keyCode === 8 && !isInputFocused)) {
        e.preventDefault();
        this.handleBack();
        return;
      }

      // Media keys dispatch
      if (keyName === 'MediaPlayPause' || keyCode === 10252) {
        window.dispatchEvent(new CustomEvent('tv:playpause'));
        return;
      }
      if (keyName === 'MediaPlay' || keyCode === 415) {
        window.dispatchEvent(new CustomEvent('tv:play'));
        return;
      }
      if (keyName === 'MediaPause' || keyCode === 19) {
        window.dispatchEvent(new CustomEvent('tv:pause'));
        return;
      }
      if (keyName === 'MediaFastForward' || keyCode === 417) {
        window.dispatchEvent(new CustomEvent('tv:forward'));
        return;
      }
      if (keyName === 'MediaRewind' || keyCode === 412) {
        window.dispatchEvent(new CustomEvent('tv:rewind'));
        return;
      }
      if (keyName === 'MediaStop' || keyCode === 413) {
        window.dispatchEvent(new CustomEvent('tv:stop'));
        return;
      }

      // Directional navigation
      switch (keyCode) {
        case 38: // Up
          if (!isInputFocused) {
            e.preventDefault();
            this.moveFocus('up');
          }
          break;
        case 40: // Down
          if (!isInputFocused) {
            e.preventDefault();
            this.moveFocus('down');
          }
          break;
        case 37: // Left
          if (!isInputFocused) {
            e.preventDefault();
            this.moveFocus('left');
          }
          break;
        case 39: // Right
          if (!isInputFocused) {
            e.preventDefault();
            this.moveFocus('right');
          }
          break;
        case 13: // Enter / OK
          if (this.currentFocus) {
            e.preventDefault();
            this.currentFocus.click();
          }
          break;
      }
    });
  }

  /**
   * Set focus to a specific element.
   */
  focus(element, saveHistory = true) {
    if (!element) return;

    if (this.currentFocus && this.currentFocus !== element) {
      this.currentFocus.classList.remove('focused');
      if (saveHistory) {
        this.focusHistory.push(this.currentFocus);
        if (this.focusHistory.length > 20) this.focusHistory.shift();
      }
    }

    this.currentFocus = element;
    element.classList.add('focused');
    element.focus();

    // Scroll element smoothly into view if in a carousel or container
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });

    // Dispatch focus event for dynamic ambient backdrop changes
    element.dispatchEvent(new CustomEvent('tv:focused', { bubbles: true }));
  }

  /**
   * Move focus in given direction using 2D geometric distance.
   */
  moveFocus(direction) {
    if (!this.currentFocus) {
      // Focus first available item
      const first = this.getVisibleFocusables()[0];
      if (first) this.focus(first);
      return;
    }

    // Determine current active container scope (e.g., if a modal is open, stay inside modal)
    const activeModal = document.querySelector('.modal-overlay:not(.hidden)');
    const playerActive = !document.getElementById('player-container').classList.contains('hidden');

    let containerScope = document.body;
    if (playerActive) {
      containerScope = document.getElementById('player-container');
    } else if (activeModal) {
      containerScope = activeModal;
    }

    const candidates = this.getVisibleFocusables(containerScope);
    const currentRect = this.currentFocus.getBoundingClientRect();
    let bestCandidate = null;
    let minDistance = Infinity;

    for (const el of candidates) {
      if (el === this.currentFocus) continue;

      const rect = el.getBoundingClientRect();
      if (!this._isInDirection(currentRect, rect, direction)) continue;

      const dist = this._calcSpatialDistance(currentRect, rect, direction);
      if (dist < minDistance) {
        minDistance = dist;
        bestCandidate = el;
      }
    }

    if (bestCandidate) {
      this.focus(bestCandidate);
    }
  }

  _isInDirection(from, to, direction) {
    const threshold = 5;
    switch (direction) {
      case 'left':
        return to.right <= from.left + threshold;
      case 'right':
        return to.left >= from.right - threshold;
      case 'up':
        return to.bottom <= from.top + threshold;
      case 'down':
        return to.top >= from.bottom - threshold;
      default:
        return false;
    }
  }

  _calcSpatialDistance(from, to, direction) {
    const fromCenter = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
    const toCenter = { x: to.left + to.width / 2, y: to.top + to.height / 2 };

    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;

    // Weight orthogonal distance heavier to favor straight alignment
    if (direction === 'left' || direction === 'right') {
      return Math.abs(dx) + Math.abs(dy) * 2.5;
    } else {
      return Math.abs(dy) + Math.abs(dx) * 2.5;
    }
  }

  getVisibleFocusables(scope = document.body) {
    const all = Array.from(scope.querySelectorAll('.focusable'));
    return all.filter(el => {
      if (el.classList.contains('hidden')) return false;
      // Check if parent is hidden
      let p = el.parentElement;
      while (p && p !== document.body) {
        if (p.classList.contains('hidden')) return false;
        p = p.parentElement;
      }
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });
  }

  /**
   * Handle Back / Return button hierarchically.
   */
  handleBack() {
    // 1. If Video Player is open, exit player
    const player = document.getElementById('player-container');
    if (player && !player.classList.contains('hidden')) {
      window.dispatchEvent(new CustomEvent('tv:exitplayer'));
      return;
    }

    // 2. If Details Modal is open, close details
    const details = document.getElementById('details-modal');
    if (details && !details.classList.contains('hidden')) {
      details.classList.add('hidden');
      if (this.focusHistory.length > 0) {
        this.focus(this.focusHistory.pop(), false);
      }
      return;
    }

    // 3. If Settings Modal is open, close settings
    const settings = document.getElementById('settings-modal');
    if (settings && !settings.classList.contains('hidden')) {
      settings.classList.add('hidden');
      const navSettings = document.getElementById('nav-settings');
      this.focus(navSettings);
      return;
    }

    // 4. If focus is inside main content, move focus to active Sidebar item
    const sidebar = document.getElementById('sidebar');
    if (this.currentFocus && !sidebar.contains(this.currentFocus)) {
      const activeNav = sidebar.querySelector('.nav-item.active') || document.getElementById('nav-home');
      this.focus(activeNav);
      return;
    }

    // 5. Exit application if on Tizen
    if (window.tizen && tizen.application) {
      try {
        tizen.application.getCurrentApplication().exit();
      } catch (_) {}
    }
  }
}

window.nav = new SpatialNav();
