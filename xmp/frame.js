let xmpPlayer;
let scopeBuffers = [];
let scopeAnalysers = [];
let audioDiagnostics = {};
const frameOptions = new URLSearchParams(window.location.search);
const requestedAudioContextSampleRate = Number(frameOptions.get("audioContextSampleRate")) || undefined;
const processorBufferSize = Number(frameOptions.get("processorBufferSize")) || 2048;

function configureAudioContext() {
  if (!requestedAudioContextSampleRate) return;
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Web Audio API is not supported in this browser.");
  const audioContext = new AudioContextConstructor({ sampleRate: requestedAudioContextSampleRate });
  window._gPlayerAudioCtx = audioContext;
  if (audioContext.sampleRate !== requestedAudioContextSampleRate) {
    audioContext.close();
    throw new Error(`The browser selected ${audioContext.sampleRate} Hz instead of the requested ${requestedAudioContextSampleRate} Hz AudioContext.`);
  }
}

function notify(type, detail = {}) {
  window.parent.postMessage({ type, ...detail }, window.location.origin);
}

function trackerChannelCount(buffer, filename) {
  if (!filename.toLowerCase().endsWith(".xm") || buffer.byteLength < 70) return undefined;
  const signature = new TextDecoder().decode(new Uint8Array(buffer, 0, 17));
  return signature === "Extended Module: " ? new DataView(buffer).getUint16(68, true) : undefined;
}

function readScopeData() {
  if (!scopeAnalysers.length) return scopeBuffers;
  return scopeAnalysers.map((analyser) => {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    return data;
  });
}

configureAudioContext();
const backend = new XMPBackendAdapter();
backend.setProcessorBufSize(processorBufferSize);
const ready = ScriptNodePlayer.initialize(backend, () => notify("xmp-ended"), [], true, undefined).then(() => {
  xmpPlayer = ScriptNodePlayer.getInstance();
  notify("xmp-ready");
});

async function load(buffer, filename, options = {}) {
  await ready;
  const audioContext = ScriptNodePlayer.getWebAudioContext();
  if (audioContext.state === "suspended") await audioContext.resume();
  const file = new File([buffer], filename);
  file.xname = `/tmp/${filename}`;
  const [virtualName] = await ScriptNodePlayer.loadFileData([file]);
  await new Promise((resolve, reject) => {
    ScriptNodePlayer.loadMusicFromURL(virtualName, { trackId: options.track ?? 0, timeout: options.timeoutSeconds }, reject).then(resolve, reject);
  });
  const producer = xmpPlayer._producerNode;
  if (producer && !producer.webXmpScopeCapture) {
    const renderSamples = producer.onaudioprocess;
    producer.webXmpScopeCapture = true;
    audioDiagnostics = { callbackCount: 0, totalGenerationMs: 0, maxGenerationMs: 0, lateAudioCallbackCount: 0, lastCallbackAt: 0, startedAt: performance.now(), audioStartedAt: ScriptNodePlayer.getWebAudioContext().currentTime };
    producer.onaudioprocess = (event) => {
      const startedAt = performance.now();
      renderSamples(event);
      scopeBuffers = Array.from({ length: event.outputBuffer.numberOfChannels }, (_, channel) => new Float32Array(event.outputBuffer.getChannelData(channel)));
      const audioContext = ScriptNodePlayer.getWebAudioContext();
      const budgetMs = event.outputBuffer.length / audioContext.sampleRate * 1000;
      if (audioDiagnostics.lastCallbackAt && startedAt - audioDiagnostics.lastCallbackAt > budgetMs * 1.5) audioDiagnostics.lateAudioCallbackCount += 1;
      audioDiagnostics.lastCallbackAt = startedAt;
      audioDiagnostics.callbackCount += 1;
      const elapsedMs = performance.now() - startedAt;
      audioDiagnostics.totalGenerationMs += elapsedMs;
      audioDiagnostics.maxGenerationMs = Math.max(audioDiagnostics.maxGenerationMs, elapsedMs);
    };
    const gain = xmpPlayer._gainNode;
    if (gain && !gain.webXmpOutputLimited) {
      const audioContext = ScriptNodePlayer.getWebAudioContext();
      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0;
      limiter.release.value = 0.05;
      gain.disconnect();
      gain.connect(limiter);
      xmpPlayer._analyzerNode?.disconnect();
      limiter.connect(audioContext.destination);
      const splitter = audioContext.createChannelSplitter(2);
      const monitorGain = audioContext.createGain();
      monitorGain.gain.value = 0;
      limiter.connect(splitter);
      scopeAnalysers = [0, 1].map((channel) => {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        splitter.connect(analyser, channel);
        analyser.connect(monitorGain);
        return analyser;
      });
      monitorGain.connect(audioContext.destination);
      gain.webXmpOutputLimited = true;
    }
  }
  const songInfo = {
    ...xmpPlayer.getSongInfo(),
    maxPositions: xmpPlayer._backendAdapter.Module.ccall("emu_get_max_position", "number"),
    trackerChannels: trackerChannelCount(buffer, filename),
    instruments: String(xmpPlayer.getSongInfo().instNames || "").split(/\r?\n/).map((name) => name.trim()).filter(Boolean).map((name, index) => ({ index: index + 1, name }))
  };
  notify("xmp-metadata", { filename, songInfo });
  return songInfo;
}

window.webXmpPlayer = Object.freeze({
  load,
  pause: () => xmpPlayer?.pause(),
  resume: () => xmpPlayer?.resume(),
  setVolume: (value) => xmpPlayer?.setVolume(value),
  setRate: (rate) => xmpPlayer?.resetSampleRate(Math.round(ScriptNodePlayer.getWebAudioSampleRate() * rate)),
  setPanning: (value) => xmpPlayer?.setPanning(value),
  setSilenceTimeout: (seconds) => xmpPlayer?.setSilenceTimeout(seconds),
  setTimeout: (seconds) => xmpPlayer?.setPlaybackTimeout(seconds == null ? -1 : seconds * 1000),
  dispose: async () => {
    xmpPlayer?.pause();
    const audioContext = ScriptNodePlayer.getWebAudioContext();
    if (audioContext?.state !== "closed") await audioContext.close();
  },
  getScopeData: readScopeData,
  getDiagnostics: () => {
    const audioContext = ScriptNodePlayer.getWebAudioContext();
    const processorBufferSize = xmpPlayer?._backendAdapter?.getProcessorBufSize();
    const audioElapsedSeconds = audioContext && audioDiagnostics.audioStartedAt !== undefined ? audioContext.currentTime - audioDiagnostics.audioStartedAt : 0;
    const wallElapsedSeconds = audioDiagnostics.startedAt ? (performance.now() - audioDiagnostics.startedAt) / 1000 : 0;
    const average = audioDiagnostics.callbackCount ? audioDiagnostics.totalGenerationMs / audioDiagnostics.callbackCount : 0;
    return {
      engine: "webXMP",
      audioContextState: audioContext?.state,
      audioContextSampleRate: audioContext?.sampleRate,
      requestedAudioContextSampleRate,
      processorBufferSize,
      audioCallbackBudgetMs: processorBufferSize && audioContext ? processorBufferSize / audioContext.sampleRate * 1000 : 0,
      audioCallbackCount: audioDiagnostics.callbackCount ?? 0,
      audioGenerationAverageMs: average,
      audioGenerationMaxMs: audioDiagnostics.maxGenerationMs ?? 0,
      wasmComputeAverageMs: 0,
      wasmComputeMaxMs: 0,
      lateAudioCallbackCount: audioDiagnostics.lateAudioCallbackCount ?? 0,
      wasmSourceFramesPerAudioSecond: audioContext?.sampleRate ?? 0,
      wasmSourceRateToConfiguredRatio: 1,
      audioElapsedSeconds,
      wallElapsedSeconds,
      audioClockToWallClockRatio: wallElapsedSeconds ? audioElapsedSeconds / wallElapsedSeconds : 0
    };
  }
});