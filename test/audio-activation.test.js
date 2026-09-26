import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createPlaybackAudioContext } from "../audio-context.js";
import { configureAudioContext } from "../uade/runtime-loader.js";
import { XmpPlayer } from "../xmp/xmp-player.js";

function browserMock(context) {
  const calls = [];
  const document = new EventTarget();
  document.createElement = () => ({ setAttribute() {} });
  const globals = ["document", "AudioContext", "window", "navigator"];
  const originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  context.after(() => {
    globals.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
      else delete globalThis[name];
    });
  });
  globalThis.document = document;
  globalThis.window = {};
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { audioSession: { type: "auto" } } });
  globalThis.AudioContext = class extends EventTarget {
    constructor(options) {
      super();
      this.sampleRate = options?.sampleRate ?? 48000;
      this.state = "suspended";
      this.destination = {};
      calls.push("create");
    }
    resume() { calls.push("resume"); return Promise.resolve(); }
    close() { calls.push("close"); this.setState("closed"); return Promise.resolve(); }
    setState(state) { this.state = state; this.dispatchEvent(new Event("statechange")); }
    createBuffer() { return {}; }
    createBufferSource() {
      return { connect() {}, disconnect() {}, start() { calls.push("start"); } };
    }
  };
  return { calls, document };
}

test("XMP creates and resumes its output context before loading the iframe", (context) => {
  const { calls } = browserMock(context);
  const player = new XmpPlayer({ audioContextSampleRate: 44100 });
  assert.deepEqual(calls, ["create", "resume", "start"]);
  assert.equal(player._frame.modulePlayerAudioContext.sampleRate, 44100);
});

test("locked audio retries on a touch and stops retrying once running", (context) => {
  const { calls, document } = browserMock(context);
  const audio = createPlaybackAudioContext();
  document.dispatchEvent(new Event("touchend"));
  assert.deepEqual(calls, ["create", "resume", "start", "resume", "start"]);
  audio.setState("running");
  document.dispatchEvent(new Event("click"));
  assert.equal(calls.length, 5);
  assert.equal(navigator.audioSession.type, "playback");
});

test("interrupted audio retries but intentionally suspended audio stays paused", (context) => {
  const { calls, document } = browserMock(context);
  const audio = createPlaybackAudioContext();
  audio.setState("running");
  audio.setState("suspended");
  document.dispatchEvent(new Event("click"));
  assert.equal(calls.length, 3);
  audio.setState("interrupted");
  document.dispatchEvent(new Event("touchend"));
  assert.deepEqual(calls.slice(3), ["resume", "start"]);
  audio.setState("running");
  document.dispatchEvent(new Event("keydown"));
  assert.equal(calls.length, 5);
});

test("closing a context removes its activation listeners", async (context) => {
  const { calls, document } = browserMock(context);
  const removed = [];
  const remove = document.removeEventListener.bind(document);
  context.mock.method(document, "removeEventListener", (...args) => { removed.push(args[0]); remove(...args); });
  const audio = createPlaybackAudioContext();
  await audio.close();
  document.dispatchEvent(new Event("touchend"));
  assert.deepEqual(removed, ["touchend", "click", "keydown"]);
  assert.deepEqual(calls, ["create", "resume", "start", "close"]);
});

test("UADE activates its default-rate context synchronously and reuses it", (context) => {
  const { calls } = browserMock(context);
  const audio = configureAudioContext();
  assert.equal(audio, window._gPlayerAudioCtx);
  assert.deepEqual(calls, ["create", "resume", "start"]);
  assert.equal(configureAudioContext(), audio);
  assert.equal(configureAudioContext(48000), audio);
  assert.equal(calls.length, 3);
});

test("UADE replaces closed or different-rate contexts without delaying activation", async (context) => {
  const { calls } = browserMock(context);
  const first = configureAudioContext(44100);
  const replacement = configureAudioContext(48000);
  assert.notEqual(first, replacement);
  assert.deepEqual(calls.slice(3), ["create", "resume", "start", "close"]);
  await replacement.close();
  assert.notEqual(configureAudioContext(48000), replacement);
});

test("invalid sample rates fail before creating an audio context", (context) => {
  const { calls } = browserMock(context);
  for (const rate of [0, -1, NaN, 44100.5]) assert.throws(() => createPlaybackAudioContext(rate), RangeError);
  assert.deepEqual(calls, []);
});

test("the XMP frame uses the already activated parent context", async () => {
  const source = await readFile(new URL("../xmp/frame.js", import.meta.url), "utf8");
  const audio = {};
  const window = { frameElement: { modulePlayerAudioContext: audio } };
  const runtime = vm.createContext({ window });
  vm.runInContext(source.slice(source.indexOf("function configureAudioContext()"), source.indexOf("function notify(")), runtime);
  runtime.configureAudioContext();
  assert.equal(window._gPlayerAudioCtx, audio);
});

test("demo prepares audio before fetching a selected module", async () => {
  const source = await readFile(new URL("../demo/main.js", import.meta.url), "utf8");
  const calls = [];
  const runtime = vm.createContext({
    lastSelection: { type: "bundled", filename: "song.mod" },
    useModuleAudio: () => calls.push("module"),
    prepareSelectedPlayer: () => calls.push("prepare"),
    selectionUrl: () => "song.mod",
    fetch: async () => { calls.push("fetch"); return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }; },
    loadBuffer: async () => calls.push("load")
  });
  vm.runInContext(source.slice(source.indexOf("async function playLastSelection("), source.indexOf("async function initializePlayer(")), runtime);
  await runtime.playLastSelection();
  assert.deepEqual(calls, ["module", "prepare", "fetch", "load"]);
});