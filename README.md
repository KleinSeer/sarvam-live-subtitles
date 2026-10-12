# Sarvam Live Subtitles

A Chrome extension that listens to whatever video is playing in your browser
tab, transcribes the audio with Sarvam's Speech-to-Text model, translates it
into an Indian language of your choice, and paints the translation as live
subtitles at the bottom of the page.

Works on any site that plays audio in a tab — YouTube, course platforms,
news sites, webinars — because it captures the **tab's** audio, not your
microphone.

---

## How it works

```
tab audio ──► offscreen document ──► Sarvam STT (saaras:v4) ──► Sarvam Translate ──► subtitle overlay
   (Chrome)      (chunks to WAV)          (transcribe)            (mayura / sarvam-translate)   (content script)
```

1. The **popup** asks Chrome for a stream id for the current tab.
2. The **service worker** (`background.js`) opens an **offscreen document**.
3. The offscreen document captures the tab audio, plays it back so you still
   hear the video, and every ~3.5 seconds encodes the audio into a small WAV
   clip.
4. Each clip is sent to `POST /speech-to-text` (`saaras:v4`, `mode=transcribe`).
5. The transcript is sent to `POST /translate` with your chosen target language.
6. The translated text is sent to the **content script**, which shows it in an
   overlay at the bottom of the page (and inside the fullscreen video, if the
   player is fullscreen).

## Files

| File | Role |
|------|------|
| `manifest.json` | Extension definition (MV3) |
| `background.js` | Service worker — orchestrates capture, relays subtitles |
| `offscreen.html` / `offscreen.js` | Captures tab audio and calls the Sarvam APIs |
| `content.js` / `content.css` | The on-page subtitle overlay |
| `popup.html` / `popup.js` / `popup.css` | Settings and Start/Stop button |
| `icons/` | Toolbar icons |

## Install (load unpacked)

1. Keep this whole folder together — do not split the files.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder (`sarvam-live-subtitles`).
5. The extension appears in your toolbar. Pin it if you like.

## Use

1. Open a page with a video and start playing it.
2. Click the **Sarvam Live Subtitles** icon.
3. Pick your **target language**.
4. Paste your **Sarvam API key** (from https://dashboard.sarvam.ai). It is
   stored only in this browser's local storage and is never sent anywhere
   except `api.sarvam.ai`.
5. Press **Start**. Subtitles appear at the bottom of the page within a few
   seconds.
6. Press **Stop** when you're done.

Note: capture is tied to the tab you started it on. If you switch to a video in
another tab, press Stop, then Start again from that tab.

## Cost and limits

- Every ~3.5 seconds of audio is one Speech-to-Text request plus one Translate
  request, so a one-hour video is roughly a thousand small calls. Check current
  per-request pricing on Sarvam's pricing page and keep an eye on your credits.
- Subtitles lag the speech by a few seconds — this build waits for a full chunk
  before transcribing. For lower latency you can switch to Sarvam's realtime
  WebSocket API (`/speech-to-text-realtime/ws`), which streams partial
  transcripts as the speaker talks.
- The Speech-to-Text REST endpoint accepts up to 30 seconds per clip, so you
  can raise `CHUNK_MS` in `offscreen.js` for fewer, larger requests at the cost
  of more delay.

## Troubleshooting

- **Nothing appears.** Make sure the video is actually audible (not muted) and
  that you started capture on the same tab the video is in.
- **"Error: STT 403".** Your API key is wrong or has no credits. Check it on the
  Sarvam dashboard.
- **"Error: STT 429".** You are hitting a rate limit — wait, or increase
  `CHUNK_MS` so you send fewer requests.
- **Subtitles show but no sound.** Playback is re-routed through the offscreen
  document; if audio is silent, stop and restart capture.
- **Extension doesn't run on a page.** `chrome://` pages and the Chrome Web
  Store cannot be scripted. Use it on normal http/https pages.
- **Reload after changes.** After editing any file, go to `chrome://extensions`
  and click the reload arrow on the extension card.

## Extending it

- Add the missing 11 languages: they are already in the dropdown; the code
  routes them through `sarvam-translate:v1`. If a translation fails, pass an
  explicit `source_language_code` instead of `auto`.
- Show the original text too: the transcript is available in `offscreen.js`
  before translation — send both and render two lines in `content.js`.
- Lower latency: replace the REST calls with the realtime WebSocket API.

## Security note

This is a local development build. The API key lives in `chrome.storage.local`,
which is fine for personal use but is **not** safe for a published extension —
anyone with access to the machine can read it. For distribution, proxy the
Sarvam calls through your own server and keep the key there.
