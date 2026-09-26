import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ImmersiveVisualizer } from "../demo/immersive-visualizer.js";

function visualizer() {
  return Object.assign(Object.create(ImmersiveVisualizer.prototype), {
    sidRegisterFeedback: new Map(), sidLastWriteCycle: -Infinity,
    sidVoices: [], sidTime: 0, signal: { flux: 0, high: 0 }, sceneSeed: .5
  });
}

function snapshot() {
  return {
    chip: 0, revision: 1, playing: true, writes: [],
    voices: Array.from({ length: 3 }, () => ({ frequency: 12000, pulseWidth: 2048, control: 0x41, envelopeLevel: .8 })),
    filter: { cutoff: 1024, resonance: 9, routing: 0, mode: 0x10, volume: 15, voice3Off: false },
    digi: new Float32Array([.25, .75, .5])
  };
}

test("adaptive quality preserves 240 Hz headroom, reduces overload, and recovers slowly", () => {
  const renderer = Object.assign(visualizer(), {
    quality: .65, frameBudget: { fastest: Infinity, elapsed: 0, frames: 0, stressed: 0, healthy: 0 },
    canvas: { dataset: {} }, resize() {}
  });
  for (let frame = 0; frame < 1200; frame++) renderer.adaptQuality(1000 / 240, .5);
  assert(renderer.quality >= .65);
  for (let frame = 0; frame < 240; frame++) renderer.adaptQuality(1000 / 120, 6);
  assert(renderer.quality < .65);
  for (let frame = 0; frame < 2400; frame++) renderer.adaptQuality(1000 / 60, 9);
  assert.equal(renderer.quality, .25);
  renderer.adaptQuality(3000, 500);
  assert.equal(renderer.quality, .25);
  for (let frame = 0; frame < 1500; frame++) renderer.adaptQuality(1000 / 240, .5);
  assert(renderer.quality > .25 && renderer.quality < .4);
});

test("every 240 Hz callback paints a frame without an FPS gate", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  let paints = 0;
  let scheduled = 0;
  const renderer = Object.assign(visualizer(), {
    lastTime: 0, elapsed: 0, pointer: { x: 0, y: 0, targetX: 0, targetY: 0 },
    readSignal() {}, analyzeMusic: () => ({}), updateCamera() {}, directScene() {},
    paint() { paints++; }, adaptQuality() {}
  });
  globalThis.requestAnimationFrame = () => ++scheduled;
  try {
    for (let frame = 1; frame <= 240; frame++) renderer.draw(frame * 1000 / 240);
    assert.equal(paints, 240);
    assert.equal(scheduled, 240);
  } finally { globalThis.requestAnimationFrame = originalRaf; }
});

test("revision caching avoids repeated audio analysis without freezing frame smoothing", () => {
  let reads = 0;
  let analyses = 0;
  let smoothing = 0;
  const source = { revision: 1, readChannels: () => { reads++; return [new Float32Array([0, .5, -.5])]; } };
  const renderer = Object.assign(visualizer(), {
    getSource: () => source, readTone: () => analyses++, smoothSignal: () => smoothing++
  });
  for (let frame = 0; frame < 10; frame++) renderer.readSignal();
  assert.equal(reads, 1);
  assert.equal(analyses, 1);
  assert.equal(smoothing, 10);
  source.revision++;
  renderer.readSignal();
  assert.equal(analyses, 2);
  source.revision = 0;
  renderer.readSignal();
  assert.equal(analyses, 3);
  delete source.revision;
  renderer.readSignal();
  renderer.readSignal();
  assert.equal(analyses, 5);
});

test("canvas uses native display resolution regardless of adaptive quality and excludes startup timing", () => {
  const originalDpr = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 2;
  try {
    const renderer = Object.assign(visualizer(), {
      quality: .65, canvas: { width: 0, height: 0, getBoundingClientRect: () => ({ width: 3840, height: 2160 }) },
      frameBudget: { fastest: Infinity, skipFirst: true }
    });
    renderer.resize();
    renderer.applyResize();
    assert.equal(renderer.canvas.width, 7680);
    assert.equal(renderer.canvas.height, 4320);
    renderer.adaptQuality(.1, .1);
    assert.equal(renderer.frameBudget.fastest, Infinity);
    renderer.quality = .25;
    renderer.resize();
    renderer.applyResize();
    assert.equal(renderer.canvas.width, 7680);
    assert.equal(renderer.canvas.height, 4320);
    globalThis.devicePixelRatio = 3;
    renderer.applyResize();
    assert.equal(renderer.canvas.width, 11520);
    assert.equal(renderer.canvas.height, 6480);
  } finally {
    if (originalDpr === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = originalDpr;
  }
});

test("quality never resizes the canvas and display changes resize only immediately before paint", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalDpr = globalThis.devicePixelRatio;
  let painted = true;
  let width = 800;
  let height = 450;
  let boundsReads = 0;
  let frames = 0;
  const canvas = {
    dataset: {},
    get width() { return width; },
    set width(value) { width = value; painted = false; },
    get height() { return height; },
    set height(value) { height = value; painted = false; },
    getBoundingClientRect() { boundsReads++; return { width: 1920, height: 1080 }; }
  };
  const renderer = Object.assign(visualizer(), {
    canvas, quality: .65, lastTime: 0, elapsed: 0,
    pointer: { x: 0, y: 0, targetX: 0, targetY: 0 },
    frameBudget: { fastest: 1000 / 240, elapsed: 990, frames: 59, stressed: 59, healthy: 0 },
    readSignal() {}, analyzeMusic: () => ({}), updateCamera() {}, directScene() {},
    paint() { frames++; painted = true; }
  });
  globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = () => { assert(painted, "frame must remain painted when yielded to the browser"); return frames; };
  try {
    renderer.draw(16);
    assert(renderer.quality < .65);
    assert.notEqual(renderer.resizePending, true);
    assert.equal(width, 800);
    assert.equal(boundsReads, 0);
    renderer.resize();
    renderer.draw(32);
    assert.equal(width, 1920);
    assert.equal(height, 1080);
    assert.equal(renderer.resizePending, false);
    assert.equal(boundsReads, 1);
    renderer.resize();
    renderer.resize();
    assert(painted, "observer notifications must not erase the visible frame");
    assert.equal(boundsReads, 1);
    renderer.draw(48);
    assert.equal(boundsReads, 2);
    assert.equal(frames, 3);
    assert(painted);
    globalThis.devicePixelRatio = 2;
    renderer.draw(64);
    assert.equal(width, 3840);
    assert.equal(height, 2160);
    assert.equal(boundsReads, 3);
    assert.equal(frames, 4);
    assert(painted);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    if (originalDpr === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = originalDpr;
  }
});

test("opening immersive playback suspends dashboard scopes and prevents restart while hidden", async () => {
  const source = await readFile(new URL("../demo/main.js", import.meta.url), "utf8");
  let stops = 0;
  let starts = 0;
  const runtime = vm.createContext({
    visualizationInput: "module",
    setImmersiveMode() {}, updateImmersiveLabels() {}, openDialog() {}, updateSidWriteTracing() {}, showImmersiveCursor() {},
    stopScopeLoop: () => stops++, immersiveVisualizer: { start: () => starts++ }, document: { fullscreenElement: {} }
  });
  vm.runInContext(source.slice(source.indexOf("function openImmersive("), source.indexOf('$("open-visualizer").addEventListener')), runtime);
  runtime.openImmersive("mega", {});
  assert.equal(stops, 1);
  assert.equal(starts, 1);
  runtime.$ = () => ({ open: true });
  runtime.draw = () => assert.fail("Hidden scopes must not draw");
  const start = source.indexOf("function startScopeLoop(");
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), runtime);
  runtime.startScopeLoop();
  assert.equal(stops, 2);
  runtime.visualizationInput = "system";
  runtime.systemAudio = { state: "idle" };
  runtime.openImmersive("visualizer", {});
  assert.equal(starts, 1);
  runtime.systemAudio.state = "active";
  runtime.openImmersive("mega", {});
  assert.equal(starts, 1);
  runtime.openImmersive("visualizer", {});
  assert.equal(starts, 2);
});

test("SID megaboost follows envelope, pitch, duty and actual DAC swing", () => {
  const renderer = visualizer();
  const state = snapshot();
  let feedback = renderer.applySidRegisterFeedback(state, .05);
  assert(feedback.voices[0].energy > 0 && feedback.voices[0].energy < .8);
  assert(feedback.voices[0].pitch > 0);
  assert.equal(feedback.digiSwing, .5);
  state.voices[0].envelopeLevel = 0;
  for (let frame = 0; frame < 30; frame++) feedback = renderer.applySidRegisterFeedback(state, .05);
  assert(feedback.voices[0].energy < .001);
  state.digi.fill(.75);
  assert.equal(renderer.applySidRegisterFeedback(state, .05).digiSwing, 0);
});

test("TEST, disabled waveforms, routing, V3 OFF and master volume constrain voice energy", () => {
  const renderer = visualizer();
  const state = snapshot();
  state.voices[0].control |= 8;
  state.voices[1].control = 1;
  state.filter.voice3Off = true;
  let feedback = renderer.applySidRegisterFeedback(state, .05);
  assert(feedback.voices.every(voice => voice.energy === 0));
  state.filter.routing = 4;
  feedback = renderer.applySidRegisterFeedback(state, .05);
  assert(feedback.voices[2].energy > 0);
  state.filter.mode = 0;
  assert.equal(renderer.applySidRegisterFeedback(state, .05).voices[2].energy, 0);
  state.filter.mode = 0x10;
  assert(renderer.applySidRegisterFeedback(state, .05).voices[2].energy > 0);
  state.filter.volume = 0;
  assert.equal(renderer.applySidRegisterFeedback(state, .05).voices[2].energy, 0);
});

test("register feedback resets for chip switches and playback revision rollback", () => {
  const renderer = visualizer();
  const state = snapshot();
  state.writes = [{ address: 4, cyclePhi1: 100 }];
  assert.equal(renderer.applySidRegisterFeedback(state, .05).voiceActivity[0], .45);
  state.revision = 0;
  state.writes = [{ address: 11, cyclePhi1: 1 }];
  let feedback = renderer.applySidRegisterFeedback(state, .05);
  assert.equal(feedback.voiceActivity[0], 0);
  assert.equal(feedback.voiceActivity[1], .45);
  state.chip = 1;
  state.writes = [];
  feedback = renderer.applySidRegisterFeedback(state, .05);
  assert(feedback.voiceActivity.every(level => level === 0));
});

test("SID scene is bounded and draws finite geometry at desktop and mobile sizes", () => {
  const renderer = visualizer();
  const state = snapshot();
  state.voices[0].control = 0x17;
  state.voices[1].control = 0x81;
  state.filter.routing = 7;
  const feedback = renderer.applySidRegisterFeedback(state, .05);
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    let points = 0;
    const context = new Proxy({}, { get: (_, name) => (...values) => {
      if (["moveTo", "lineTo", "bezierCurveTo"].includes(name)) {
        assert(values.every(Number.isFinite));
        points++;
      }
    }, set: () => true });
    renderer.drawSidMachine(context, width, height, state, feedback);
    assert(points > 1000 && points < 10000);
  }
});

test("paused SID motion freezes and reduced motion slows the scene", () => {
  const renderer = visualizer();
  const state = snapshot();
  state.playing = false;
  renderer.applySidRegisterFeedback(state, .05);
  assert.equal(renderer.sidTime, 0);
  state.playing = true;
  renderer.reducedMotion = true;
  renderer.applySidRegisterFeedback(state, .05);
  assert(renderer.sidTime > 0 && renderer.sidTime < .01);
});

test("SID director visits all eight effects before repeating and transitions without detected beats", () => {
  const renderer = Object.assign(visualizer(), {
    canvas: { dataset: {} }, camera: { phase: 0 },
    music: { beatInterval: .5, toneFast: [], toneCentroidFast: .5 },
    transitionDuration: 1, sceneTransition: 1
  });
  const state = snapshot();
  renderer.directScene(0, {}, state);
  assert.equal(renderer.scene, "sid-warp");
  const visited = new Set([renderer.scene]);
  for (let change = 0; change < 7; change++) {
    const previous = renderer.scene;
    renderer.directScene(15, {}, state);
    assert.equal(renderer.previousScene, previous);
    assert(renderer.sceneTransition < 1);
    visited.add(renderer.scene);
  }
  assert.equal(visited.size, 8);
  const previous = renderer.scene;
  renderer.directScene(15, {}, state);
  assert.notEqual(renderer.scene, previous);
  state.playing = false;
  renderer.directScene(100, {}, state);
  assert.equal(renderer.sceneElapsed, 0);
  renderer.directScene(0);
  assert(!renderer.scene.startsWith("sid-"));
});

test("all SID effects draw distinct finite geometry on desktop and mobile", () => {
  const renderer = visualizer();
  const state = snapshot();
  const feedback = renderer.applySidRegisterFeedback(state, .05);
  const scenes = ["sid-warp", "sid-weave", "sid-crystal", "sid-storm", "sid-matrix", "sid-lissajous", "sid-radar", "sid-machine"];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const signatures = new Set();
    for (const scene of scenes) {
      let points = 0;
      let signature = 0;
      const context = new Proxy({}, { get: (_, name) => (...values) => {
        if (["moveTo", "lineTo", "bezierCurveTo", "arc", "fillRect", "translate", "rotate"].includes(name)) {
          assert(values.filter(value => typeof value === "number").every(Number.isFinite), scene);
          signature += values.filter(value => typeof value === "number").reduce((sum, value) => sum + value, 0);
          points++;
        }
      }, set: () => true });
      renderer.drawSidScene(context, scene, width, height, state, feedback);
      assert(points > 100 && points < 15000, `${scene}: ${points}`);
      signatures.add(Math.round(signature));
    }
    assert.equal(signatures.size, scenes.length);
  }
});

test("SID paint follows the selected scene and crossfades both renderers", () => {
  const calls = [];
  const context = new Proxy({}, { get: (_, name) => name === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  const renderer = Object.assign(visualizer(), {
    context, canvas: { width: 1440, height: 900 }, pointer: { x: 0, y: 0 },
    camera: { x: 0, y: 0, microX: 0, microY: 0, roll: 0, zoom: 1 },
    previousSceneSeed: .3, sceneTransition: .3, elapsed: 1,
    scene: "sid-crystal", previousScene: "sid-warp",
    drawStarfield: () => calls.push("stars"),
    drawSidScene: (_, scene) => calls.push(scene), drawVignette() {}
  });
  renderer.paint(.016, snapshot(), {});
  assert.deepEqual(calls, ["stars", "sid-warp", "sid-crystal"]);
  calls.length = 0;
  renderer.sceneTransition = 1;
  renderer.paint(.016, snapshot(), {});
  assert.deepEqual(calls, ["stars", "sid-crystal"]);
});

test("all eight SID effects reduce geometry under load without dropping any scene", () => {
  const renderer = visualizer();
  const state = snapshot();
  const feedback = renderer.applySidRegisterFeedback(state, .05);
  for (const scene of ["sid-warp", "sid-weave", "sid-crystal", "sid-storm", "sid-matrix", "sid-lissajous", "sid-radar", "sid-machine"]) {
    const counts = [];
    for (const quality of [1, .25]) {
      renderer.quality = quality;
      let points = 0;
      const context = new Proxy({}, { get: (_, name) => (...values) => {
        if (["moveTo", "lineTo", "arc", "fillRect"].includes(name)) {
          assert(values.filter(value => typeof value === "number").every(Number.isFinite));
          points++;
        }
      }, set: () => true });
      renderer.drawSidScene(context, scene, 390, 844, state, feedback);
      counts.push(points);
    }
    assert(counts[1] > 0 && counts[1] < counts[0] * .75, `${scene}: ${counts}`);
  }
});

test("SID telemetry updates independently of the animation refresh rate", async () => {
  const source = await readFile(new URL("../demo/main.js", import.meta.url), "utf8");
  let updates = 0;
  const stage = { classList: { toggle() {} }, style: { setProperty() {} } };
  const runtime = vm.createContext({
    visualizationInput: "module", immersiveMode: "mega", activeEngine: "sid", lastMegaTelemetryAt: -Infinity,
    $: name => name === "immersive-dialog" ? { open: true } : stage,
    renderMegaSid: () => updates++, renderMegaChannels: () => assert.fail("Hidden meters must not update")
  });
  vm.runInContext(source.slice(source.indexOf("function renderMegaFrame("), source.indexOf("function setImmersiveMode(")), runtime);
  for (let frame = 0; frame < 240; frame++) runtime.renderMegaFrame({
    time: frame * 1000 / 240, sidState: {}, signal: { level: 0, low: 0, high: 0 }, musicalEvent: {}
  });
  assert(updates >= 12 && updates <= 13);
  const before = updates;
  runtime.visualizationInput = "system";
  runtime.renderMegaFrame({ time: 2000, sidState: {} });
  assert.equal(updates, before);
});

test("megaboost snapshot exposes tracker data and caches only matching player, chip, revision and playback state", async () => {
  const source = (await readFile(new URL("../demo/main.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const callback = source.slice(source.indexOf("getSidState: () => {") + "getSidState: ".length, source.indexOf(",\n  onFrame: renderMegaFrame"));
  const status = new Uint8Array(25);
  status.set([0x34, 0x12, 0x56, 0x07, 0x41, 0x24, 0xa8]);
  status.set([5, 100, 0xb5, 0xd9], 21);
  let reads = 0;
  const envelopes = [];
  const player = {
    visualization: { revision: 5 }, state: "playing",
    getSidStatus: () => { reads++; return status; },
    getSidEnvelopeWriteHistorySnapshot: () => [],
    getSidWriteTraceSnapshot: () => [],
    readSidDigiTrace: () => new Float32Array([0, 1])
  };
  const runtime = vm.createContext({
    visualizationInput: "module", immersiveMode: "mega", activeEngine: "sid", sidRegisterDetailEnabled: false,
    selectedSidChip: 0, lastMegaSidStateRevision: -1, lastMegaSidState: undefined,
    lastMegaSidPlayer: undefined, sidPlayer: player,
    updateSidEnvelope: (...args) => { envelopes.push(args); return { level: .7, phase: "decay" }; }
  });
  const read = vm.runInContext(`(${callback})`, runtime);
  const state = read();
  assert.equal(state.voices[0].frequency, 0x1234);
  assert.equal(state.voices[0].pulseWidth, 0x756);
  assert.equal(state.voices[0].envelopeLevel, .7);
  assert.deepEqual(envelopes[0].slice(0, 6), [0, 2, 4, 10, 8, true]);
  assert.equal(state.filter.cutoff, 805);
  assert.equal(state.filter.resonance, 11);
  assert.equal(state.filter.routing, 5);
  assert.equal(state.filter.mode, 0x50);
  assert.equal(state.filter.volume, 9);
  assert.equal(state.filter.voice3Off, true);
  assert.equal(state.digi.length, 2);
  assert.equal(read(), state);
  assert.equal(reads, 1);
  player.state = "paused";
  assert.equal(read().playing, false);
  assert.equal(reads, 2);
  runtime.selectedSidChip = 1;
  assert.equal(read().chip, 1);
  player.visualization.revision++;
  read();
  runtime.sidPlayer = { ...player };
  read();
  assert.equal(reads, 5);
  runtime.visualizationInput = "system";
  assert.equal(read(), undefined);
  assert.equal(reads, 5);
  runtime.visualizationInput = "module";
  runtime.immersiveMode = "visualizer";
  assert.equal(read(), undefined);
  runtime.immersiveMode = "mega";
  runtime.activeEngine = "xmp";
  assert.equal(read(), undefined);
});