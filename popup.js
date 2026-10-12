// Popup: choose a language, save the API key, start/stop capture.

const LANGUAGES = [
  ['hi-IN', 'Hindi'],
  ['bn-IN', 'Bengali'],
  ['ta-IN', 'Tamil'],
  ['te-IN', 'Telugu'],
  ['mr-IN', 'Marathi'],
  ['gu-IN', 'Gujarati'],
  ['kn-IN', 'Kannada'],
  ['ml-IN', 'Malayalam'],
  ['pa-IN', 'Punjabi'],
  ['od-IN', 'Odia'],
  ['as-IN', 'Assamese'],
  ['ur-IN', 'Urdu'],
  ['ne-IN', 'Nepali'],
  ['kok-IN', 'Konkani'],
  ['ks-IN', 'Kashmiri'],
  ['sd-IN', 'Sindhi'],
  ['sa-IN', 'Sanskrit'],
  ['sat-IN', 'Santali'],
  ['mni-IN', 'Manipuri'],
  ['brx-IN', 'Bodo'],
  ['mai-IN', 'Maithili'],
  ['doi-IN', 'Dogri'],
  ['en-IN', 'English'],
];

const langSelect = document.getElementById('lang');
const keyInput = document.getElementById('key');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');

for (const [code, name] of LANGUAGES) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = name + ' (' + code + ')';
  langSelect.appendChild(opt);
}

function setStatus(text) {
  statusEl.textContent = text || '';
}

document.addEventListener('DOMContentLoaded', async () => {
  const { apiKey, targetLang } = await chrome.storage.local.get(['apiKey', 'targetLang']);
  if (apiKey) keyInput.value = apiKey;
  langSelect.value = targetLang || 'hi-IN';

  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (state && state.capturing) setStatus('Capturing this tab…');
  } catch (_) {
    /* service worker not up yet; fine */
  }
});

startBtn.addEventListener('click', async () => {
  const apiKey = keyInput.value.trim();
  const targetLang = langSelect.value;

  if (!apiKey) {
    setStatus('Enter your Sarvam API key first.');
    return;
  }

  await chrome.storage.local.set({ apiKey, targetLang });
  setStatus('Starting…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setStatus('No active tab found.');
      return;
    }

    // Must be called from the popup so the user-gesture requirement is met.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

    const res = await chrome.runtime.sendMessage({
      type: 'START',
      streamId,
      tabId: tab.id,
      targetLang,
      apiKey,
    });

    if (res && res.ok) setStatus('Running. Subtitles will appear on the page.');
    else setStatus('Failed: ' + ((res && res.error) || 'unknown error'));
  } catch (e) {
    setStatus('Error: ' + e.message);
  }
});

stopBtn.addEventListener('click', async () => {
  setStatus('Stopping…');
  try {
    await chrome.runtime.sendMessage({ type: 'STOP' });
    setStatus('Stopped.');
  } catch (e) {
    setStatus('Error: ' + e.message);
  }
});
