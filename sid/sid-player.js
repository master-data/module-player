import { parseSidMetadata } from "./sid-metadata.js";

const PLAYER_OWNER = Symbol.for("module-player.sid.owner");
const CYCLES_PER_RENDER = 40_000;
const EMPTY_RENDER_LIMIT = 64;
const SID_WRITE_TRACE_LIMIT = 256;
const EMPTY_SID_WRITE_TRACE = Object.freeze([]);

function asArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  throw new TypeError("Input must be a File or ArrayBuffer.");
}

function copyRom(input, size, name) {
  if (!input) return undefined;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(asArrayBuffer(input));
  if (bytes.byteLength !== size) throw new RangeError(`${name} ROM must be exactly ${size} bytes.`);
  return bytes.slice();
}

function normalizeTimeout(value) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Timeout must be a non-negative number of seconds.");
  return value;
}

function moduleUrl(assetBaseUrl) {
  const base = String(assetBaseUrl).replace(/\/$/, "");
  return `${base}/libsidplayfp/dist/index.js`;
}

function causeMessage(cause) {
  if (cause instanceof Error && cause.message) return cause.message;
  return cause === undefined || cause === null ? "" : String(cause);
}

class SidVisualizationSource {
  constructor(player) {
    this._player = player;
    this._zoom = 3;
  }

  _refresh() {
    const analysers = this._player._analysers;
    if (!analysers) return;
    for (const [channel, analyser] of analysers.entries()) {
      const buffer = this._player._scopeBuffers[channel];
      if (buffer.length !== analyser.fftSize) this._player._scopeBuffers[channel] = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(this._player._scopeBuffers[channel]);
    }
  }
  get streamCount() { this._refresh(); return this._player._scopeBuffers[0]?.length ? 2 : 0; }
  get sampleLength() { return Math.ceil((this._player._scopeBuffers[0]?.length ?? 0) / this._zoom); }
  getZoom() { return this._zoom; }
  setZoom(level) {
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new RangeError("Visualization zoom must be an integer from 1 to 5.");
    this._zoom = level;
  }
  readChannel(channel) {
    this._refresh();
    const data = this._player._scopeBuffers[channel];
    if (!data) throw new RangeError("SID output channel is unavailable.");
    return data.subarray(Math.max(0, data.length - Math.ceil(data.length / this._zoom)));
  }
  readChannels() {
    this._refresh();
    return this._player._scopeBuffers;
  }
  get revision() { return this._player._scopeRevision; }
  readVu(channel) {
    const data = this.readChannel(channel);
    if (!data.length) return 0;
    let squareSum = 0;
    for (const sample of data) squareSum += sample * sample;
    return Math.sqrt(squareSum / data.length);
  }
  readOverallVu() { return this.streamCount ? Math.sqrt((this.readVu(0) ** 2 + this.readVu(1) ** 2) / 2) : 0; }
}

export class SidPlaybackError extends Error {
  constructor(operation, filename, cause) {
    const detail = causeMessage(cause);
    super(`SID ${operation} failed${filename ? ` for ${filename}` : ""}${detail ? `: ${detail}` : "."}`);
    this.name = "SidPlaybackError";
    this.operation = operation;
    this.filename = filename;
    this.cause = cause;
  }
}

export class SidPlayer {
  constructor(options = {}) {
    this._assetBaseUrl = options.assetBaseUrl ?? new URL("./assets", import.meta.url).href;
    this._audioContextSampleRate = options.audioContextSampleRate;
    this._processorBufferSize = options.processorBufferSize ?? 4096;
    this._engine = options.engine ?? "sidlite";
    this._emulationConfig = options.emulationConfig ?? {};
    this._listeners = new Map();
    this._state = "initializing";
    this._volume = 1;
    this._streamPanning = undefined;
    this._looping = false;
    this._timeoutSeconds = undefined;
    this._operation = Promise.resolve();
    this._source = undefined;
    this._metadata = undefined;
    this._pendingPcm = undefined;
    this._pendingOffset = 0;
    this._emptyRenders = 0;
    this._scopeBuffers = [new Float32Array(0), new Float32Array(0)];
    this._scopeRevision = 0;
    this._sidWriteTraces = new Map();
    this._sidWriteTraceEnabled = false;
    this._diagnostics = { audioCallbackCount: 0, audioGenerationTotalMs: 0, audioGenerationMaxMs: 0, wasmRenderCount: 0, wasmRenderTotalMs: 0, wasmRenderMaxMs: 0, underrunCount: 0 };
    this._roms = {
      kernal: copyRom(options.systemRoms?.kernal, 8192, "KERNAL"),
      basic: copyRom(options.systemRoms?.basic, 8192, "BASIC"),
      chargen: copyRom(options.systemRoms?.chargen, 4096, "CHARGEN")
    };
  }

  get state() { return this._state; }
  get visualization() { return this._visualization; }

  on(event, listener) {
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
    const next = this._operation.then(operation, operation);
    this._operation = next.catch(() => {});
    return next;
  }

  async _initialize() {
    if (globalThis[PLAYER_OWNER] && globalThis[PLAYER_OWNER] !== this) throw new Error("Only one SID player may be active per document.");
    const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error("Web Audio is unavailable in this browser.");
    const context = new AudioContextConstructor(this._audioContextSampleRate ? { sampleRate: this._audioContextSampleRate } : undefined);
    if (this._audioContextSampleRate && context.sampleRate !== this._audioContextSampleRate) {
      await context.close();
      throw new Error(`The browser selected ${context.sampleRate} Hz instead of the requested ${this._audioContextSampleRate} Hz.`);
    }
    if (!context.createScriptProcessor) {
      await context.close();
      throw new Error("This browser does not support the SID audio bridge.");
    }
    this._audioContext = context;
    this._gain = context.createGain();
    this._gain.gain.value = this._volume;
    this._processor = context.createScriptProcessor(this._processorBufferSize, 0, 2);
    this._splitter = context.createChannelSplitter(2);
    this._merger = context.createChannelMerger(2);
    this._analysers = [context.createAnalyser(), context.createAnalyser()];
    for (const analyser of this._analysers) {
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
    }
    this._processor.onaudioprocess = (event) => this._processAudio(event);
    this._processor.connect(this._gain);
    this._gain.connect(this._splitter);
    this._splitter.connect(this._analysers[0], 0);
    this._splitter.connect(this._analysers[1], 1);
    this._analysers[0].connect(this._merger, 0, 0);
    this._analysers[1].connect(this._merger, 0, 1);
    this._merger.connect(context.destination);
    try {
      const runtime = await import(moduleUrl(this._assetBaseUrl));
      this._module = await runtime.loadLibsidplayfp({ engine: this._engine });
      globalThis[PLAYER_OWNER] = this;
      this._setState("ready");
    } catch (cause) {
      this._processor.disconnect();
      this._gain.disconnect();
      this._splitter.disconnect();
      this._merger.disconnect();
      for (const analyser of this._analysers) analyser.disconnect();
      await context.close();
      throw new SidPlaybackError("initialize", undefined, cause);
    }
  }

  _createContext() {
    const context = new this._module.SidPlayerContext();
    if (!context.configure(this._audioContext.sampleRate, true)) throw new Error(context.getLastError());
    if (Object.keys(this._emulationConfig).length && !context.setEmulationConfig(this._emulationConfig)) throw new Error(context.getLastError());
    if (this._roms.kernal || this._roms.basic || this._roms.chargen) {
      if (!context.setSystemROMs(this._roms.kernal ?? null, this._roms.basic ?? null, this._roms.chargen ?? null)) throw new Error(context.getLastError());
    }
    return context;
  }

  _releaseContext(context = this._sidContext) {
    if (!context) return;
    try { if (!context.isDeleted?.()) context.delete(); } catch { /* Embind may release after a failed load. */ }
    if (context === this._sidContext) this._sidContext = undefined;
  }

  _resetRenderState() {
    this._pendingPcm = undefined;
    this._pendingOffset = 0;
    this._emptyRenders = 0;
    this._sidWriteTraces.clear();
  }

  _captureSidWriteTraces() {
    const writes = this._sidContext?.getAndClearSidWriteTracesPacked?.();
    if (!writes?.length) return;
    for (let index = 0; index < writes.length; index += 4) {
      const sidNumber = writes[index];
      const trace = this._sidWriteTraces.get(sidNumber) ?? [];
      trace.push({ address: writes[index + 1], value: writes[index + 2], cyclePhi1: writes[index + 3] });
      if (trace.length > SID_WRITE_TRACE_LIMIT) trace.splice(0, trace.length - SID_WRITE_TRACE_LIMIT);
      this._sidWriteTraces.set(sidNumber, trace);
    }
  }

  _hasCompleteRoms() {
    return Boolean(this._roms.kernal && this._roms.basic && this._roms.chargen);
  }

  _patchTrack(track) {
    const bytes = new Uint8Array(this._source.slice(0));
    bytes[16] = ((track + 1) >> 8) & 0xff;
    bytes[17] = (track + 1) & 0xff;
    return bytes;
  }

  _loadTrack(track) {
    const metadata = parseSidMetadata(this._source, { filename: this._filename, track });
    if (metadata.requiresRoms && !this._hasCompleteRoms()) throw new Error("RSID playback requires KERNAL (8192 bytes), BASIC (8192 bytes), and CHARGEN (4096 bytes) ROM images.");
    const previous = this._sidContext;
    const context = this._createContext();
    try {
      if (!context.loadSidBuffer(this._patchTrack(metadata.currentSong))) throw new Error(context.getLastError());
      if (!context.reset()) throw new Error(context.getLastError());
      context.setSidWriteTraceEnabled?.(this._sidWriteTraceEnabled);
      this._releaseContext(previous);
      this._sidContext = context;
      this._metadata = { ...metadata, raw: context.getTuneInfo(), engine: this._module.getSidEngineName?.(), md5: context.getTuneMd5() || undefined };
      this._resetRenderState();
      return this._metadata;
    } catch (error) {
      this._releaseContext(context);
      throw error;
    }
  }

  async load(input, options = {}) {
    return this._queue(async () => {
      if (this._state === "disposed") throw new Error("SID player is disposed.");
      const isFile = typeof File !== "undefined" && input instanceof File;
      const filename = String(isFile ? input.name : options.filename || "");
      const buffer = isFile ? await input.arrayBuffer() : asArrayBuffer(input);
      if (!filename) throw new TypeError("SID requires a filename when loading an ArrayBuffer.");
      this._setState("loading");
      try {
        this._source = buffer.slice(0);
        this._filename = filename;
        this._looping = Boolean(options.loop);
        this._timeoutSeconds = normalizeTimeout(options.timeoutSeconds);
        const metadata = this._loadTrack(options.track ?? 0);
        await this._audioContext.resume();
        this._playStartedAt = this._audioContext.currentTime;
        this._setState("playing");
        this._emit("metadata", metadata);
        return metadata;
      } catch (cause) {
        const error = new SidPlaybackError("load", filename, cause);
        this._setState("error");
        this._emit("error", error);
        throw error;
      }
    });
  }

  async selectSong(track) {
    return this._queue(async () => {
      if (!Number.isInteger(track) || track < 0) throw new RangeError("Track must be a non-negative integer.");
      if (!this._source) throw new Error("Load a SID before selecting a song.");
      const wasPlaying = this._state === "playing";
      const metadata = this._loadTrack(track);
      if (wasPlaying) this._playStartedAt = this._audioContext.currentTime;
      this._emit("metadata", metadata);
      return metadata.currentSong;
    });
  }

  pause() { if (this._state === "playing") { this._audioContext.suspend(); this._setState("paused"); } }
  resume() { if (this._state === "paused") { this._audioContext.resume(); this._setState("playing"); } }
  async stop() { return this._queue(async () => { if (this._state !== "disposed") { await this._audioContext.suspend(); this._resetRenderState(); this._setState("stopped"); } }); }

  setVolume(level) {
    if (!Number.isFinite(level) || level < 0 || level > 1) throw new RangeError("Volume must be between 0 and 1.");
    this._volume = level;
    if (this._gain) this._gain.gain.value = level;
  }

  getVolume() { return this._volume; }
  setLooping(enabled) { this._looping = Boolean(enabled); }
  setTimeout(seconds) { this._timeoutSeconds = normalizeTimeout(seconds); }
  setSidWriteTraceEnabled(enabled) {
    this._sidWriteTraceEnabled = Boolean(enabled);
    this._sidContext?.setSidWriteTraceEnabled?.(this._sidWriteTraceEnabled);
    if (!this._sidWriteTraceEnabled) this._sidWriteTraces.clear();
  }
  setStreamPanning(panning) {
    if (!Number.isFinite(panning) || panning < 0 || panning > 2) throw new RangeError("Stereo panning must be between 0 and 2.");
    this._streamPanning = panning;
  }

  setSystemRoms(roms) {
    this._roms = { kernal: copyRom(roms?.kernal, 8192, "KERNAL"), basic: copyRom(roms?.basic, 8192, "BASIC"), chargen: copyRom(roms?.chargen, 4096, "CHARGEN") };
  }

  setEmulationConfig(config) {
    if (!config || typeof config !== "object") throw new TypeError("SID emulation config must be an object.");
    this._emulationConfig = { ...this._emulationConfig, ...config };
    if (!this._source) return;
    const wasPlaying = this._state === "playing";
    const metadata = this._loadTrack(this._metadata.currentSong);
    if (wasPlaying) this._playStartedAt = this._audioContext.currentTime;
    this._emit("metadata", metadata);
  }

  getEmulationConfig() { return this._sidContext?.getEmulationConfig?.(); }

  getSidStatus(sidNumber = 0) {
    if (!Number.isInteger(sidNumber) || sidNumber < 0) throw new RangeError("SID chip number must be a non-negative integer.");
    const status = this._sidContext?.getSidStatus?.(sidNumber);
    return status ? status.slice() : undefined;
  }

  getSidWriteTrace(sidNumber = 0) {
    if (!Number.isInteger(sidNumber) || sidNumber < 0) throw new RangeError("SID chip number must be a non-negative integer.");
    return (this._sidWriteTraces.get(sidNumber) ?? []).map((write) => ({ ...write }));
  }
  getSidWriteTraceSnapshot(sidNumber = 0) {
    if (!Number.isInteger(sidNumber) || sidNumber < 0) throw new RangeError("SID chip number must be a non-negative integer.");
    return this._sidWriteTraces.get(sidNumber) ?? EMPTY_SID_WRITE_TRACE;
  }

  getInstalledSids() { return this._sidContext?.getInstalledSids?.() ?? 0; }

  getDiagnostics() {
    const callbacks = this._diagnostics.audioCallbackCount;
    const renders = this._diagnostics.wasmRenderCount;
    return {
      engine: this._module?.getSidEngineName?.(),
      audioContextSampleRate: this._audioContext?.sampleRate,
      requestedAudioContextSampleRate: this._audioContextSampleRate,
      audioContextState: this._audioContext?.state,
      processorBufferSize: this._processorBufferSize,
      audioCallbackBudgetMs: this._audioContext ? this._processorBufferSize / this._audioContext.sampleRate * 1000 : undefined,
      audioCallbackCount: callbacks,
      audioGenerationAverageMs: callbacks ? this._diagnostics.audioGenerationTotalMs / callbacks : 0,
      audioGenerationMaxMs: this._diagnostics.audioGenerationMaxMs,
      wasmRenderCount: renders,
      wasmRenderAverageMs: renders ? this._diagnostics.wasmRenderTotalMs / renders : 0,
      wasmRenderMaxMs: this._diagnostics.wasmRenderMaxMs,
      underrunCount: this._diagnostics.underrunCount,
      playbackTimeMs: this._sidContext?.getTimeMs?.(),
      installedSids: this._sidContext?.getInstalledSids?.() ?? 0,
      romStatus: { requested: Boolean(this._roms.kernal || this._roms.basic || this._roms.chargen), active: this._hasCompleteRoms() }
    };
  }

  _processAudio(event) {
    const startedAt = performance.now();
    const output = event.outputBuffer;
    const left = output.getChannelData(0);
    const right = output.getChannelData(1);
    left.fill(0);
    right.fill(0);
    if (this._state !== "playing" || !this._sidContext) return;
    if (this._timeoutSeconds !== undefined && this._audioContext.currentTime - this._playStartedAt >= this._timeoutSeconds) {
      this._finish();
      return;
    }
    const crossfeed = this._streamPanning === undefined ? 0 : this._streamPanning / 2;
    let frame = 0;
    while (frame < left.length) {
      if (!this._pendingPcm || this._pendingOffset >= this._pendingPcm.length) {
        const renderStartedAt = performance.now();
        const chunk = this._sidContext.render(CYCLES_PER_RENDER);
        if (this._sidWriteTraceEnabled) this._captureSidWriteTraces();
        const elapsed = performance.now() - renderStartedAt;
        this._diagnostics.wasmRenderCount += 1;
        this._diagnostics.wasmRenderTotalMs += elapsed;
        this._diagnostics.wasmRenderMaxMs = Math.max(this._diagnostics.wasmRenderMaxMs, elapsed);
        if (!chunk?.length) {
          this._emptyRenders += 1;
          if (this._emptyRenders > EMPTY_RENDER_LIMIT) { this._finish(); break; }
          continue;
        }
        this._emptyRenders = 0;
        this._pendingPcm = chunk.slice();
        this._pendingOffset = 0;
      }
      const frames = Math.min(left.length - frame, Math.floor((this._pendingPcm.length - this._pendingOffset) / 2));
      for (let index = 0; index < frames; index += 1) {
        const sourceLeft = this._pendingPcm[this._pendingOffset + index * 2] / 32768;
        const sourceRight = this._pendingPcm[this._pendingOffset + index * 2 + 1] / 32768;
        const difference = (sourceRight - sourceLeft) * crossfeed;
        left[frame + index] = sourceLeft + difference;
        right[frame + index] = sourceRight - difference;
      }
      frame += frames;
      this._pendingOffset += frames * 2;
    }
    if (frame < left.length && this._state === "playing") this._diagnostics.underrunCount += 1;
    const elapsed = performance.now() - startedAt;
    this._diagnostics.audioCallbackCount += 1;
    this._diagnostics.audioGenerationTotalMs += elapsed;
    this._diagnostics.audioGenerationMaxMs = Math.max(this._diagnostics.audioGenerationMaxMs, elapsed);
    this._scopeRevision++;
    this._emit("audio");
  }

  _finish() {
    if (this._looping && this._source) {
      try { this._loadTrack(this._metadata.currentSong); this._playStartedAt = this._audioContext.currentTime; return; } catch { /* Report the normal terminal event below. */ }
    }
    this._setState("ended");
    this._emit("ended");
  }

  dispose() {
    return this._queue(async () => {
      if (this._state === "disposed") return;
      this._processor.onaudioprocess = null;
      this._processor.disconnect();
      this._gain.disconnect();
      this._splitter.disconnect();
      this._merger.disconnect();
      for (const analyser of this._analysers) analyser.disconnect();
      this._releaseContext();
      await this._audioContext.close();
      if (globalThis[PLAYER_OWNER] === this) delete globalThis[PLAYER_OWNER];
      this._setState("disposed");
    });
  }
}

export async function createSidPlayer(options) {
  const player = new SidPlayer(options);
  await player._initialize();
  player._visualization = new SidVisualizationSource(player);
  return player;
}