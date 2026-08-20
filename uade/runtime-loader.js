const loadedScripts = new Map();

function withTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function loadScript(url) {
  if (loadedScripts.has(url)) return loadedScripts.get(url);

  const pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Unable to load UADE runtime script: ${url}`));
    document.head.appendChild(script);
  });
  loadedScripts.set(url, pending);
  return pending;
}

export async function loadUadeRuntime(assetBaseUrl, visualization) {
  if (typeof document === "undefined") {
    throw new Error("UADE preview requires a browser or Electron renderer process.");
  }

  const base = withTrailingSlash(assetBaseUrl);
  await loadScript(`${base}js/scriptprocessor_player.min.js`);
  window.WASM_SEARCH_PATH = base;
  await loadScript(`${base}js/backend_uade.min.js`);
  window.UADEBackendAdapter = UADEBackendAdapter;
  if (visualization) {
    await loadScript(`${base}js/channelstreamer.min.js`);
    window.ChannelStreamer = ChannelStreamer;
  }

  if (!window.ScriptNodePlayer || !window.UADEBackendAdapter) {
    throw new Error("UADE runtime did not expose its required APIs.");
  }
  if (visualization && !window.ChannelStreamer) {
    throw new Error("UADE visualization runtime did not load.");
  }
  return base;
}

export async function configureAudioContext(sampleRate) {
  if (sampleRate === undefined) return undefined;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError("AudioContext sample rate must be a positive integer.");
  }

  const existing = window._gPlayerAudioCtx;
  if (existing?.sampleRate === sampleRate) return existing;
  if (existing && existing.state !== "closed") await existing.close();

  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Web Audio API is not supported in this browser.");
  const context = new AudioContextConstructor({ sampleRate });
  window._gPlayerAudioCtx = context;
  if (context.sampleRate !== sampleRate) {
    throw new Error(`The browser selected ${context.sampleRate} Hz instead of the requested ${sampleRate} Hz AudioContext.`);
  }
  return context;
}