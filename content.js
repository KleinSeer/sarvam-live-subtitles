// Content script: draws the subtitle overlay at the bottom of the page.

if (!window.__sarvamSubtitleLoaded) {
  window.__sarvamSubtitleLoaded = true;

  let overlay = null;
  let textEl = null;
  let statusEl = null;
  let hideTimer = null;

  function ensureOverlay() {
    if (overlay && document.documentElement.contains(overlay)) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'sarvam-subtitle-overlay';

    textEl = document.createElement('span');
    textEl.id = 'sarvam-subtitle-text';

    statusEl = document.createElement('div');
    statusEl.id = 'sarvam-subtitle-status';

    overlay.appendChild(textEl);
    overlay.appendChild(statusEl);

    // Attach to the fullscreen element when a video is fullscreen, so the
    // subtitles stay visible; otherwise attach to the document.
    const parent = document.fullscreenElement || document.documentElement;
    parent.appendChild(overlay);
    return overlay;
  }

  function showSubtitle(text) {
    ensureOverlay();
    textEl.textContent = text;
    statusEl.textContent = '';
    overlay.classList.add('sarvam-visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 5000);
  }

  function showStatus(text) {
    ensureOverlay();
    statusEl.textContent = text;
    overlay.classList.add('sarvam-visible');
  }

  function hide() {
    if (overlay) overlay.classList.remove('sarvam-visible');
  }

  function clearAll() {
    if (!overlay) return;
    overlay.classList.remove('sarvam-visible');
    textEl.textContent = '';
    statusEl.textContent = '';
    clearTimeout(hideTimer);
  }

  // Keep the overlay inside whatever element is fullscreen.
  document.addEventListener('fullscreenchange', () => {
    if (!overlay) return;
    const parent = document.fullscreenElement || document.documentElement;
    if (overlay.parentElement !== parent) parent.appendChild(overlay);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SUBTITLE') showSubtitle(msg.text);
    else if (msg.type === 'STATUS') showStatus(msg.text);
    else if (msg.type === 'CLEAR') clearAll();
  });
}
