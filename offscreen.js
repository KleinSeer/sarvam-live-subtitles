// Offscreen document: captures tab audio, chunks it into short WAV clips,
// sends each clip to Sarvam Speech-to-Text, then translates the transcript.

const TARGET_SAMPLE_RATE = 16000; // Sarvam recommends 16 kHz PCM
const CHUNK_MS = 3500;            // length of each audio chunk sent to the API
const STT_URL = 'https://api.sarvam.ai/speech-to-text';
const TRANSLATE_URL = 'https://api.sarvam.ai/translate';

// Languages Mayura handles directly (with automatic source detection).
// Everything else routes through Sarvam-Translate.
const CORE_LANGUAGES = new Set([
  'bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN',
  'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN',
]);

let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processor = null;
let buffers = [];
let flushTimer = null;
let inFlight = false;
let config = { targetLang: 'hi-IN', apiKey: '' };

// --- Control messages from the service worker -------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'start-capture') {
    startCapture(msg).catch((err) => report('Error: ' + err.message));
  } else if (msg.type === 'stop-capture') {
    stopCapture();
  }
});

async function startCapture(msg) {
  if (audioContext) await stopCapture();

  config.targetLang = msg.targetLang || 'hi-IN';
  config.apiKey = msg.apiKey || '';
  if (!config.apiKey) {
    report('No API key set. Open the extension and paste your Sarvam key.');
    return;
  }

  // Capture the audio of the tab whose stream id the service worker passed in.
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: msg.streamId,
      },
    },
    video: false,
  });

  audioContext = new AudioContext();
  await audioContext.resume();
  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  // Tab capture removes the audio from the normal output, so play it back
  // here — otherwise the user would see the video in silence.
  sourceNode.connect(audioContext.destination);

  // ScriptProcessorNode collects raw PCM samples. It is deprecated but still
  // functional in Chrome and keeps this file dependency-free.
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!e.inputBuffer) return;
    buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  sourceNode.connect(processor);
  processor.connect(audioContext.destination); // required to keep it firing

  flushTimer = setInterval(flush, CHUNK_MS);
  report('Listening — translating to ' + config.targetLang);
}

async function stopCapture() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  try { if (processor) processor.onaudioprocess = null; } catch (_) {}
  try { if (processor) processor.disconnect(); } catch (_) {}
  try { if (sourceNode) sourceNode.disconnect(); } catch (_) {}
  try { if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { if (audioContext) await audioContext.close(); } catch (_) {}
  audioContext = null;
  mediaStream = null;
  sourceNode = null;
  processor = null;
  buffers = [];
}

// --- Audio chunk -> transcript -> translation -------------------------------

async function flush() {
  if (inFlight || !audioContext || buffers.length === 0) return;

  const collected = buffers;
  buffers = [];
  const totalLen = collected.reduce((sum, c) => sum + c.length, 0);
  if (totalLen < audioContext.sampleRate * 0.5) return; // too short, skip

  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const c of collected) {
    merged.set(c, offset);
    offset += c.length;
  }

  const downsampled = downsample(merged, audioContext.sampleRate, TARGET_SAMPLE_RATE);
  const wav = encodeWav(downsampled, TARGET_SAMPLE_RATE);

  inFlight = true;
  try {
    const transcript = await transcribe(wav);
    if (!transcript) return;
    const translated = await translate(transcript);
    if (translated) {
      chrome.runtime.sendMessage({ type: 'SUBTITLE_FROM_OFFSCREEN', text: translated });
    }
  } catch (e) {
    report('API error: ' + e.message);
  } finally {
    inFlight = false;
  }
}

async function transcribe(wavBlob) {
  const form = new FormData();
  form.append('file', wavBlob, 'chunk.wav');
  form.append('model', 'saaras:v4');
  form.append('mode', 'transcribe');

  const res = await fetch(STT_URL, {
    method: 'POST',
    headers: { 'api-subscription-key': config.apiKey },
    body: form,
  });
  if (!res.ok) throw new Error('STT ' + res.status + ' ' + (await safeText(res)));
  const data = await res.json();
  return (data.transcript || '').trim();
}

async function translate(text) {
  const payload = {
    input: text,
    source_language_code: 'auto',
    target_language_code: config.targetLang,
  };
  // Languages outside Mayura's set need the Sarvam-Translate model.
  if (!CORE_LANGUAGES.has(config.targetLang)) {
    payload.model = 'sarvam-translate:v1';
  }

  const res = await fetch(TRANSLATE_URL, {
    method: 'POST',
    headers: {
      'api-subscription-key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Translate ' + res.status + ' ' + (await safeText(res)));
  const data = await res.json();
  return (data.translated_text || '').trim();
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 200); } catch (_) { return ''; }
}

function report(text) {
  try {
    chrome.runtime.sendMessage({ type: 'STATUS_FROM_OFFSCREEN', text });
  } catch (_) {
    /* service worker asleep; message will be retried on next event */
  }
}

// --- WAV encoding -----------------------------------------------------------

function downsample(buffer, inRate, outRate) {
  if (outRate === inRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let outOffset = 0;
  let inOffset = 0;
  while (outOffset < newLen) {
    const nextInOffset = Math.round((outOffset + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let i = inOffset; i < nextInOffset && i < buffer.length; i++) {
      sum += buffer[i];
      count++;
    }
    result[outOffset] = count ? sum / count : 0;
    outOffset++;
    inOffset = nextInOffset;
  }
  return result;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, 1, true);              // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
