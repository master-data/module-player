import { parseTrackerData } from "./tracker-data.js";

const PLAYER_OWNER = Symbol.for("webxmp-preview.owner");

export class XmpPlaybackError extends Error {
  constructor(operation, filename, cause) {
    super(`XMP ${operation} failed${filename ? ` for ${filename}` : ""}.`);
    this.name = "XmpPlaybackError";
    this.operation = operation;
    this.filename = filename;
    this.cause = cause;
  }
}

class XmpVisualizationSource {
  constructor(player) {
    this._player = player;
    this._zoom = 3;
    this._scopeBuffers = [];
  }

  _refreshScopeBuffers() {
    this._scopeBuffers = this._player._api?.getScopeData?.() ?? [];
  }

  get streamCount() {
    this._refreshScopeBuffers();
    return this._scopeBuffers.length;
  }
  get sampleLength() {
    const length = this._scopeBuffers[0]?.length ?? 0;
    return Math.ceil(length / this._zoom);
  }
  getZoom() { return this._zoom; }
  setZoom(level) {
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      throw new RangeError("Visualization zoom must be an integer from 1 to 5.");
    }
    this._zoom = level;
  }
  readChannel(channel) {
    const data = this._scopeBuffers[channel];
    if (!data) throw new RangeError("XMP output channel is unavailable.");
    return data.subarray(Math.max(0, data.length - Math.ceil(data.length / this._zoom)));
  }
  readVu(channel) {
    const data = this.readChannel(channel);
    return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
  }
  readOverallVu() { return this.streamCount ? this.readVu(0) : 0; }
}

class XmpTrackerSource {
  constructor(player) {
    this._player = player;
    this._data = undefined;
  }

  setModule(buffer, filename) {
    this._data = parseTrackerData(buffer, filename);
  }

  clear() {
    this._data = undefined;
  }

  get available() { return Boolean(this._data); }
  get synchronized() { return false; }
  get format() { return this._data?.format; }
  get channelCount() { return this._data?.channelCount ?? 0; }
  get orders() { return this._data?.orders ?? []; }
  get patterns() { return this._data?.patterns ?? []; }
  get patternCount() { return this._data?.patterns.length ?? 0; }
  get initialSpeed() { return this._data?.speed ?? 0; }
  get initialBpm() { return this._data?.bpm ?? 0; }
  getPosition() {
    const timeline = this._data?.timeline;
    const time = this._player._api?.getPlaybackPosition?.();
    if (!timeline?.length || !Number.isFinite(time)) return undefined;
    for (const position of timeline) if (time < position.endMs) return position;
    return timeline.at(-1);
  }
}

export class XmpPlayer {
  constructor(options = {}) {
    this._assetBaseUrl = options.assetBaseUrl ?? new URL("./", import.meta.url).href;
    this._audioContextSampleRate = options.audioContextSampleRate;
    this._processorBufferSize = options.processorBufferSize;
    this._listeners = new Map();
    this._state = "initializing";
    this._volume = 1;
    this._looping = false;
    this._lastLoad = undefined;
    this._frame = document.createElement("iframe");
    this._frame.hidden = true;
    this._frame.tabIndex = -1;
    this._frame.setAttribute("aria-hidden", "true");
    const query = new URLSearchParams();
    query.set("runtimeVersion", "4");
    if (this._audioContextSampleRate !== undefined) query.set("audioContextSampleRate", this._audioContextSampleRate);
    if (this._processorBufferSize !== undefined) query.set("processorBufferSize", this._processorBufferSize);
    this._frame.src = `${this._assetBaseUrl.replace(/\/$/, "")}/frame.html?${query}`;
    this._onMessage = this._onMessage.bind(this);
    this._ready = new Promise((resolve, reject) => { this._resolveReady = resolve; this._rejectReady = reject; });
  }

  get state() { return this._state; }
  get visualization() { return this._visualization; }
  get tracker() { return this._tracker; }
  getDiagnostics() { return this._api?.getDiagnostics?.() ?? { engine: "webXMP", audioContextState: this._state }; }

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

  async _initialize() {
    if (globalThis[PLAYER_OWNER] && globalThis[PLAYER_OWNER] !== this) throw new Error("Only one XMP preview player may be active per document.");
    globalThis[PLAYER_OWNER] = this;
    window.addEventListener("message", this._onMessage);
    document.body.append(this._frame);
    await this._ready;
    this._setState("ready");
  }

  _onMessage(event) {
    if (event.origin !== window.location.origin || event.source !== this._frame.contentWindow) return;
    if (event.data?.type === "xmp-ready") {
      this._api = this._frame.contentWindow.webXmpPlayer;
      this._resolveReady();
      return;
    }
    if (event.data?.type === "xmp-metadata") this._emit("metadata", event.data.songInfo);
    if (event.data?.type === "xmp-ended" && (this._state === "playing" || this._state === "paused")) {
      this._setState("ended");
      this._emit("ended");
      if (this._looping && this._lastLoad) this.load(this._lastLoad.buffer, this._lastLoad.options).catch(() => {});
    }
  }

  async load(input, options = {}) {
    if (this._state === "disposed") throw new Error("XMP player is disposed.");
    const isFile = typeof File !== "undefined" && input instanceof File;
    const filename = String(isFile ? input.name : options.filename || "");
    const buffer = isFile ? await input.arrayBuffer() : input;
    if (!filename || !(buffer instanceof ArrayBuffer)) throw new TypeError("XMP requires an ArrayBuffer and filename.");
    this._setState("loading");
    try {
      this._tracker.setModule(buffer, filename);
      this._looping = Boolean(options.loop);
      this._lastLoad = { buffer, options: { ...options, filename } };
      const songInfo = await this._api.load(buffer, filename, options);
      const metadata = { ...songInfo, fileName: filename, fileLengthBytes: buffer.byteLength, format: "libxmp" };
      this._api.setVolume(this._volume);
      this._setState("playing");
      this._emit("metadata", metadata);
      return metadata;
    } catch (cause) {
      this._tracker.clear();
      const error = new XmpPlaybackError("load", filename, cause);
      this._setState("error");
      this._emit("error", error);
      throw error;
    }
  }

  pause() { if (this._state === "playing") { this._api.pause(); this._setState("paused"); } }
  resume() { if (this._state === "paused") { this._api.resume(); this._setState("playing"); } }
  async stop() { this._api.pause(); this._setState("stopped"); }
  setVolume(value) { this._volume = value; this._api?.setVolume(value); }
  getVolume() { return this._volume; }
  setLooping(enabled) { this._looping = Boolean(enabled); }
  setPitchCoupledRate(rate) { this._api?.setRate(rate); }
  setTimeout(seconds) { this._api?.setTimeout(seconds); }
  setSilenceTimeout(seconds) { this._api?.setSilenceTimeout(seconds); }
  setPanning(pan) { this._api?.setPanning(pan); }
  setUadePanning(panning) { this.setPanning(panning - 1); }

  async dispose() {
    if (this._state === "disposed") return;
    await this._api?.dispose();
    window.removeEventListener("message", this._onMessage);
    this._frame.remove();
    if (globalThis[PLAYER_OWNER] === this) delete globalThis[PLAYER_OWNER];
    this._setState("disposed");
  }
}

export async function createXmpPlayer(options) {
  const player = new XmpPlayer(options);
  await player._initialize();
  player._visualization = new XmpVisualizationSource(player);
  player._tracker = new XmpTrackerSource(player);
  return player;
}