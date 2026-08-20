import { configureAudioContext, loadUadeRuntime } from "./runtime-loader.js";
import { UadeVisualizationSource } from "./visualization.js";
import { scoutFile } from "./vendor/format-scout/index.js";

const PRELOAD_FILES = ["uaerc", "eagleplayer.conf", "system/score"];
const PLAYER_OWNER = Symbol.for("module-player.owner");

function joinUrl(base, path) {
  return `${base.replace(/\/$/, "")}/${path}`;
}

function sanitizeFilename(name) {
  const value = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = value.split("/").filter((segment) => segment && segment !== "." && segment !== "..");
  if (!segments.length) throw new TypeError("A non-empty filename is required.");
  return segments.join("/");
}

function normalizeTimeout(value) {
  if (value === undefined || value === null) return -1;
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Timeout must be a non-negative number of seconds.");
  return value;
}

export class UadePlaybackError extends Error {
  constructor(operation, filename, cause) {
    super(`UADE ${operation} failed${filename ? ` for ${filename}` : ""}.`);
    this.name = "UadePlaybackError";
    this.operation = operation;
    this.filename = filename;
    this.cause = cause;
  }
}

export class UadePlayer {
  constructor(options) {
    this._assetBaseUrl = options.assetBaseUrl;
    this._visualizationEnabled = Boolean(options.visualization);
    this._processorBufferSize = options.processorBufferSize ?? 2048;
    this._audioContextSampleRate = options.audioContextSampleRate;
    this._listeners = new Map();
    this._state = "initializing";
    this._volume = 1;
    this._uadePanning = undefined;
    this._looping = false;
    this._lastLoad = undefined;
    this._sequence = 0;
    this._operation = Promise.resolve();
    this._audioTiming = this._createAudioTiming();
    this._dependencyFailure = undefined;
    this._dependencyFailureReject = undefined;
  }

  get state() {
    return this._state;
  }

  get visualization() {
    return this._visualization;
  }

  getDiagnostics() {
    const audioContext = window.ScriptNodePlayer?.getWebAudioContext();
    const budgetMs = audioContext && this._backend ? this._backend.getProcessorBufSize() / audioContext.sampleRate * 1000 : undefined;
    const transformer = this._backend?._transformer;
    const wallElapsedSeconds = this._audioTiming.clockStartedAt ? (performance.now() - this._audioTiming.clockStartedAt) / 1000 : 0;
    const audioElapsedSeconds = audioContext && this._audioTiming.audioClockStartedAt !== undefined ? audioContext.currentTime - this._audioTiming.audioClockStartedAt : 0;
    const outputTimestamp = audioContext?.getOutputTimestamp?.();
    const wasmSourceFramesPerAudioSecond = audioElapsedSeconds ? this._audioTiming.wasmSourceFrames / audioElapsedSeconds : 0;
    return {
      audioContextSampleRate: audioContext?.sampleRate,
      requestedAudioContextSampleRate: this._audioContextSampleRate,
      audioContextState: audioContext?.state,
      processorBufferSize: this._backend?.getProcessorBufSize(),
      visualizationEnabled: Boolean(this._tracer),
      visualizationStreams: this._tracer?.getNumStreams() ?? 0,
      transformerOutputSampleRate: transformer?._sampleRate,
      transformerInputSampleRate: transformer?._inputSampleRate,
      audioCallbackBudgetMs: budgetMs,
      audioCallbackCount: this._audioTiming.callbackCount,
      audioGenerationAverageMs: this._audioTiming.callbackCount ? this._audioTiming.totalGenerationMs / this._audioTiming.callbackCount : 0,
      audioGenerationMaxMs: this._audioTiming.maxGenerationMs,
      audioCallbackIntervalAverageMs: this._audioTiming.callbackIntervalCount ? this._audioTiming.callbackIntervalTotalMs / this._audioTiming.callbackIntervalCount : 0,
      audioCallbackIntervalMaxMs: this._audioTiming.maxCallbackIntervalMs,
      lateAudioCallbackCount: this._audioTiming.lateCallbackCount,
      wasmComputeCallCount: this._audioTiming.wasmComputeCallCount,
      wasmComputeAverageMs: this._audioTiming.wasmComputeCallCount ? this._audioTiming.wasmComputeTotalMs / this._audioTiming.wasmComputeCallCount : 0,
      wasmComputeMaxMs: this._audioTiming.wasmComputeMaxMs,
      wasmSourceFrames: this._audioTiming.wasmSourceFrames,
      wasmSourceFramesPerAudioSecond,
      wasmSourceRateToConfiguredRatio: transformer?._inputSampleRate ? wasmSourceFramesPerAudioSecond / transformer._inputSampleRate : 0,
      wallElapsedSeconds,
      audioElapsedSeconds,
      audioClockToWallClockRatio: wallElapsedSeconds ? audioElapsedSeconds / wallElapsedSeconds : 0,
      outputTimestampContextTime: outputTimestamp?.contextTime,
      outputTimestampPerformanceTime: outputTimestamp?.performanceTime
    };
  }

  _createAudioTiming() {
    return {
      callbackCount: 0,
      totalGenerationMs: 0,
      maxGenerationMs: 0,
      callbackIntervalCount: 0,
      callbackIntervalTotalMs: 0,
      maxCallbackIntervalMs: 0,
      lateCallbackCount: 0,
      lastCallbackAt: 0,
      wasmComputeCallCount: 0,
      wasmComputeTotalMs: 0,
      wasmComputeMaxMs: 0,
      wasmSourceFrames: 0,
      clockStartedAt: 0,
      audioClockStartedAt: undefined
    };
  }

  _monitorWasmCompute() {
    const computeAudioSamples = this._backend?.computeAudioSamples;
    if (!computeAudioSamples || this._backend.__uadePreviewComputeMonitored) return;
    this._backend.__uadePreviewComputeMonitored = true;
    this._backend.computeAudioSamples = () => {
      const startedAt = performance.now();
      try {
        const result = computeAudioSamples.call(this._backend);
        if (result === 0) this._audioTiming.wasmSourceFrames += this._backend.getAudioBufferLength();
        return result;
      } finally {
        const elapsedMs = performance.now() - startedAt;
        this._audioTiming.wasmComputeCallCount += 1;
        this._audioTiming.wasmComputeTotalMs += elapsedMs;
        this._audioTiming.wasmComputeMaxMs = Math.max(this._audioTiming.wasmComputeMaxMs, elapsedMs);
      }
    };
  }

  _beginPlaybackDiagnostics() {
    this._audioTiming = this._createAudioTiming();
    const audioContext = window.ScriptNodePlayer.getWebAudioContext();
    this._audioTiming.clockStartedAt = performance.now();
    this._audioTiming.audioClockStartedAt = audioContext.currentTime;
  }

  _monitorAudioCallbacks() {
    const transformer = this._backend?._transformer;
    if (!transformer || transformer.__uadePreviewMonitored) return;
    const generateSamples = transformer.genSamples.bind(transformer);
    transformer.__uadePreviewMonitored = true;
    transformer.genSamples = (event) => {
      const startedAt = performance.now();
      const audioContext = window.ScriptNodePlayer.getWebAudioContext();
      const budgetMs = this._backend.getProcessorBufSize() / audioContext.sampleRate * 1000;
      const intervalMs = startedAt - this._audioTiming.lastCallbackAt;
      if (this._audioTiming.lastCallbackAt) {
        this._audioTiming.callbackIntervalCount += 1;
        this._audioTiming.callbackIntervalTotalMs += intervalMs;
        this._audioTiming.maxCallbackIntervalMs = Math.max(this._audioTiming.maxCallbackIntervalMs, intervalMs);
      }
      if (this._audioTiming.lastCallbackAt && intervalMs > budgetMs * 1.5) {
        this._audioTiming.lateCallbackCount += 1;
      }
      this._audioTiming.lastCallbackAt = startedAt;
      try {
        return generateSamples(event);
      } finally {
        const elapsedMs = performance.now() - startedAt;
        this._audioTiming.callbackCount += 1;
        this._audioTiming.totalGenerationMs += elapsedMs;
        this._audioTiming.maxGenerationMs = Math.max(this._audioTiming.maxGenerationMs, elapsedMs);
      }
    };
  }

  _monitorCompanionFileLoads() {
    const player = window.ScriptNodePlayer.getInstance();
    if (!player?._preloadFile || player.__uadePreviewCompanionLoadMonitored) return;
    const preloadFile = player._preloadFile.bind(player);
    player.__uadePreviewCompanionLoadMonitored = true;
    player._preloadFile = (filename, onComplete, isInitialPreload) => preloadFile(filename, () => {
      if (!isInitialPreload && player._getCache().getFile(filename) === 0) {
        this._handleMissingCompanionFile(filename);
        return;
      }
      onComplete();
    }, isInitialPreload);
  }

  _handleMissingCompanionFile(filename) {
    if (this._dependencyFailure || this._state === "disposed") return;
    this._looping = false;
    this._lastLoad = undefined;
    const error = new UadePlaybackError("load dependency", filename, new Error(`UADE could not load required companion file: ${filename}`));
    this._dependencyFailure = error;
    if (this._dependencyFailureReject) {
      this._dependencyFailureReject(error);
      return;
    }
    this._setState("error");
    this._emit("error", error);
  }

  on(event, listener) {
    if (typeof listener !== "function") throw new TypeError("Event listener must be a function.");
    const listeners = this._listeners.get(event) ?? new Set();
    listeners.add(listener);
    this._listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  _emit(event, payload) {
    for (const listener of this._listeners.get(event) ?? []) listener(payload);
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this._emit("state", state);
  }

  _queue(operation) {
    const pending = this._operation.then(operation, operation);
    this._operation = pending.catch(() => {});
    return pending;
  }

  async _startSession() {
    await configureAudioContext(this._audioContextSampleRate);
    const assetBaseUrl = await loadUadeRuntime(this._assetBaseUrl, this._visualizationEnabled);
    const tracer = this._visualizationEnabled ? new window.ChannelStreamer(3, true) : undefined;
    const uadeBasePath = joinUrl(assetBaseUrl, "uade");
    const backend = new window.UADEBackendAdapter(uadeBasePath, true, 0, (metadata) => {
      const songInfo = window.ScriptNodePlayer.getInstance()?.getSongInfo();
      this._emit("metadata", songInfo ?? metadata);
    });
    backend.setProcessorBufSize(this._processorBufferSize);
    const preload = PRELOAD_FILES.map((path) => joinUrl(uadeBasePath, path));

    await window.ScriptNodePlayer.initialize(backend, () => {
      if (this._state === "playing" || this._state === "paused") {
        this._setState("ended");
        this._emit("ended");
        if (this._looping && this._lastLoad) {
          queueMicrotask(() => {
            this.load(this._lastLoad.buffer, this._lastLoad.options).catch(() => {});
          });
        }
      }
    }, preload, false, tracer);

    this._backend = backend;
    this._tracer = tracer;
    this._visualization = tracer ? new UadeVisualizationSource(tracer) : undefined;
    this._audioTiming = this._createAudioTiming();
    this._monitorWasmCompute();
    this._monitorAudioCallbacks();
    this._monitorCompanionFileLoads();
    window.ScriptNodePlayer.getInstance().setVolume(this._volume === 0 ? 0.001 : this._volume);
    if (this._uadePanning !== undefined) this._backend.setPanning(this._uadePanning - 1);
    this._setState("ready");
  }

  async _initialize() {
    if (globalThis[PLAYER_OWNER] && globalThis[PLAYER_OWNER] !== this) {
      throw new Error("Only one UADE preview player may be active per document.");
    }
    globalThis[PLAYER_OWNER] = this;
    try {
      await this._startSession();
    } catch (error) {
      delete globalThis[PLAYER_OWNER];
      this._setState("error");
      throw new UadePlaybackError("initialization", undefined, error);
    }
  }

  async load(input, options = {}) {
    return this._queue(async () => {
      if (this._state === "disposed") throw new Error("UADE player is disposed.");
      const isFile = typeof File !== "undefined" && input instanceof File;
      const filename = sanitizeFilename(isFile ? input.name : options.filename);
      const buffer = isFile ? await input.arrayBuffer() : input;
      if (!(buffer instanceof ArrayBuffer)) throw new TypeError("Input must be a File or ArrayBuffer.");
      const track = options.track ?? 0;
      if (!Number.isInteger(track) || track < 0) throw new RangeError("Track must be a non-negative integer.");
      const timeout = normalizeTimeout(options.timeoutSeconds);
      const loop = Boolean(options.loop);
      const virtualName = `/preview/${++this._sequence}/${filename}`;
      const player = window.ScriptNodePlayer.getInstance();
      const formatScout = scoutFile(buffer, { filename });
      let rejectDependencyFailure;
      const dependencyFailure = new Promise((resolve, reject) => {
        rejectDependencyFailure = reject;
      });

      this._setState("loading");
      try {
        this._dependencyFailure = undefined;
        this._dependencyFailureReject = rejectDependencyFailure;
        this._looping = loop;
        this._lastLoad = { buffer, options: { filename, track, timeoutSeconds: timeout < 0 ? undefined : timeout, loop } };
        await window.ScriptNodePlayer.loadFileData([{ xname: virtualName, fileBuffer: buffer }]);
        await Promise.race([window.ScriptNodePlayer.loadMusicFromURL(virtualName, { track, timeout }), dependencyFailure]);
        this._beginPlaybackDiagnostics();
        player.play();
        const songInfo = { ...player.getSongInfo(), formatScout };
        this._setState("playing");
        this._emit("format-scout", formatScout);
        this._emit("metadata", songInfo);
        return songInfo;
      } catch (error) {
        this._setState("error");
        const wrapped = error instanceof UadePlaybackError ? error : new UadePlaybackError("load", filename, error);
        this._emit("error", wrapped);
        throw wrapped;
      } finally {
        if (this._dependencyFailureReject === rejectDependencyFailure) this._dependencyFailureReject = undefined;
      }
    });
  }

  pause() {
    if (this._state !== "playing") return;
    window.ScriptNodePlayer.getInstance().pause();
    this._setState("paused");
  }

  resume() {
    if (this._state !== "paused") return;
    window.ScriptNodePlayer.getInstance().resume();
    this._setState("playing");
  }

  stop() {
    return this._queue(async () => {
      if (this._state === "disposed" || this._state === "ready") return;
      this._setState("stopped");
      window.ScriptNodePlayer.getInstance()?.pause();
      this._backend?.teardown();
      await this._startSession();
    });
  }

  setVolume(level) {
    if (!Number.isFinite(level) || level < 0 || level > 1) throw new RangeError("Volume must be between 0 and 1.");
    this._volume = level;
    window.ScriptNodePlayer.getInstance()?.setVolume(level === 0 ? 0.001 : level);
  }

  getVolume() {
    return this._volume;
  }

  setLooping(enabled) {
    this._looping = Boolean(enabled);
    if (this._lastLoad) this._lastLoad.options.loop = this._looping;
  }

  setPitchCoupledRate(rate) {
    if (!Number.isFinite(rate) || rate < 0.8 || rate > 1.2) throw new RangeError("Rate must be between 0.8 and 1.2.");
    const sampleRate = window.ScriptNodePlayer.getWebAudioSampleRate();
    window.ScriptNodePlayer.getInstance().resetSampleRate(Math.round(sampleRate * rate));
  }

  setTimeout(seconds) {
    const timeout = normalizeTimeout(seconds);
    window.ScriptNodePlayer.getInstance()?.setPlaybackTimeout(timeout < 0 ? -1 : timeout * 1000);
  }

  setSilenceTimeout(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Silence timeout must be a non-negative number of seconds.");
    window.ScriptNodePlayer.getInstance()?.setSilenceTimeout(seconds);
  }

  setPanning(pan) {
    if (pan !== null && (!Number.isFinite(pan) || pan < -1 || pan > 1)) throw new RangeError("Panning must be null or between -1 and 1.");
    window.ScriptNodePlayer.getInstance()?.setPanning(pan);
  }

  setUadePanning(panning) {
    if (!Number.isFinite(panning) || panning < 0 || panning > 2) throw new RangeError("UADE panning must be between 0 and 2.");
    this._uadePanning = panning;
    this._backend?.setPanning(panning - 1);
  }

  dispose() {
    return this._queue(async () => {
      if (this._state === "disposed") return;
      window.ScriptNodePlayer.getInstance()?.pause();
      this._backend?.teardown();
      if (globalThis[PLAYER_OWNER] === this) delete globalThis[PLAYER_OWNER];
      this._setState("disposed");
    });
  }
}

export async function createUadePlayer(options) {
  if (!options?.assetBaseUrl) throw new TypeError("assetBaseUrl is required.");
  const player = new UadePlayer(options);
  await player._initialize();
  return player;
}