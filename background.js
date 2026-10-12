// Service worker: orchestrates tab-audio capture and relays subtitles to the page.

const OFFSCREEN_PATH = 'offscreen.html';

// --- Offscreen document lifecycle -------------------------------------------

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Capture the active tab audio to generate live translated subtitles.',
  });
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length > 0) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (_) {
      /* already gone */
    }
  }
}

// --- Messaging helpers ------------------------------------------------------

// Send a message to the offscreen document, retrying briefly while it boots.
async function sendToOffscreen(payload, retries = 12) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.runtime.sendMessage(payload);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr || new Error('Offscreen document did not respond');
}

// Send a message to the content script in the active tab, injecting it if the
// page was loaded before the extension (so no content script is present yet).
async function forwardToTab(payload) {
  const { tabId } = await chrome.storage.session.get('tabId');
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, payload);
    } catch (e) {
      // Tab closed or not injectable (e.g. chrome:// pages). Nothing to do.
    }
  }
}

// --- Start / stop -----------------------------------------------------------

async function startCapture(msg) {
  await ensureOffscreen();
  await chrome.storage.session.set({ capturing: true, tabId: msg.tabId });
  await sendToOffscreen({
    type: 'start-capture',
    streamId: msg.streamId,
    targetLang: msg.targetLang,
    apiKey: msg.apiKey,
  });
}

async function stopCapture() {
  try {
    await sendToOffscreen({ type: 'stop-capture' }, 5);
  } catch (_) {
    /* offscreen may already be gone */
  }
  const { tabId } = await chrome.storage.session.get('tabId');
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'CLEAR' });
    } catch (_) {
      /* tab gone */
    }
  }
  await chrome.storage.session.set({ capturing: false });
  await closeOffscreen();
}

// --- Message router ---------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START') {
    startCapture(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // async response
  }

  if (msg.type === 'STOP') {
    stopCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  if (msg.type === 'GET_STATE') {
    chrome.storage.session.get('capturing').then((s) => sendResponse({ capturing: !!s.capturing }));
    return true;
  }

  // Relay from the offscreen document down to the page.
  if (msg.type === 'SUBTITLE_FROM_OFFSCREEN') {
    forwardToTab({ type: 'SUBTITLE', text: msg.text });
  } else if (msg.type === 'STATUS_FROM_OFFSCREEN') {
    forwardToTab({ type: 'STATUS', text: msg.text });
  }

  return undefined;
});

// If the user closes the captured tab, tear everything down.
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  const { tabId, capturing } = await chrome.storage.session.get(['tabId', 'capturing']);
  if (capturing && tabId === closedTabId) {
    await chrome.storage.session.set({ capturing: false });
    await closeOffscreen();
  }
});
