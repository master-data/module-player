import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../demo/main.js", import.meta.url), "utf8");
const updateSource = source.slice(source.indexOf("function updateSidVoiceMonitor("), source.indexOf("function renderSidTrackerView("));
const flagsSource = source.slice(source.indexOf("function sidControlFlags("), source.indexOf("function sidVoiceMonitor("));
const drawingSource = source.slice(source.indexOf("function drawSidEnvelopeReconstruction("), source.indexOf("function sidControlFlags("));

function scopeCanvas() {
  const backgrounds = [];
  const context = {
    fillRect() { backgrounds.push(this.fillStyle); },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
    fill() { assert.fail("Scope traces must not fill an area"); },
    closePath() { assert.fail("Scope traces must remain open lines"); }
  };
  const canvas = { width: 320, height: 100, clientWidth: 320, clientHeight: 100, getContext: () => context };
  const runtime = vm.createContext({ sidPhosphorEnabled: true, performance: { now: () => 100 }, phosphorDecayMs: () => 250, SID_TRACKER_TRACE_FRAME_INTERVAL_MS: 1000 / 60 });
  vm.runInContext(drawingSource, runtime);
  return { canvas, backgrounds, runtime };
}

test("ADSR envelopes draw open traces without an area fill", () => {
  const { canvas, backgrounds, runtime } = scopeCanvas();
  for (const history of [[0, 0, 0], [0, 1, 0.5], [1, 1, 1]]) {
    runtime.drawSidEnvelopeReconstruction(canvas, { sustain: 8, history });
  }
  assert.deepEqual(backgrounds, ["#08191e", "#08191e", "#08191e"]);
});

test("idle, zero-envelope and TEST oscillators clear phosphor to a dark baseline", () => {
  const { canvas, backgrounds, runtime } = scopeCanvas();
  for (const state of [{ control: 0, envelopeLevel: 0 }, { control: 0x41, envelopeLevel: 0 }, { control: 0x49, envelopeLevel: 1 }]) {
    canvas._sidPhosphorPainted = true;
    canvas._sidPhosphorUntil = 500;
    canvas._sidPhosphorUpdatedAt = 100;
    runtime.drawSidOscillatorReconstruction(canvas, { frequency: 1000, pulseWidth: 2048, ...state });
    assert.equal(canvas._sidPhosphorPainted, false);
    assert.equal(canvas._sidPhosphorUntil, undefined);
  }
  assert.deepEqual(backgrounds, ["#08191e", "#08191e", "#08191e"]);
});

test("hidden idle scopes paint their first visible frame and repaint immediately on resize", () => {
  const { canvas, backgrounds, runtime } = scopeCanvas();
  canvas._sidOscillator = { frequency: 0, pulseWidth: 0, control: 0, envelopeLevel: 0, noiseLfsr: 0, phase: 0 };
  canvas.clientWidth = 0;
  canvas.clientHeight = 0;
  runtime.renderSidOscillatorFrame(canvas);
  assert.equal(backgrounds.length, 0);
  assert.equal(canvas._sidRenderKey, undefined);
  canvas.clientWidth = 600;
  canvas.clientHeight = 240;
  runtime.renderSidOscillatorFrame(canvas);
  assert.equal(canvas.width, 600);
  assert.equal(canvas.height, 240);
  assert.equal(backgrounds.length, 1);
  const idleKey = canvas._sidRenderKey;
  canvas.clientHeight = 360;
  runtime.renderSidOscillatorFrame(canvas);
  assert.equal(canvas.height, 360);
  assert.equal(canvas._sidRenderKey, idleKey);
  assert.equal(backgrounds.length, 2);
  runtime.renderSidOscillatorFrame(canvas);
  assert.equal(backgrounds.length, 2);
});

function monitor(voice = 0) {
  const settings = Array.from({ length: 4 }, () => ({ textContent: "" }));
  const facts = Array.from({ length: 3 }, () => ({ textContent: "" }));
  const phase = { textContent: "" };
  const oscillator = {};
  const flags = Array.from({ length: voice === 2 ? 4 : 3 }, () => {
    const badge = { active: false, label: "" };
    badge.classList = { toggle: (_, active) => { badge.active = active; } };
    badge.setAttribute = (_, label) => { badge.label = label; };
    return badge;
  });
  const card = {
    dataset: {},
    classList: { toggle() {} },
    querySelector: selector => selector === ".sid-envelope-phase" ? phase : oscillator,
    querySelectorAll: selector => selector === "[data-sid-flag]" ? flags : selector === ".sid-envelope-settings strong" ? settings : selector === ".sid-voice-values strong" ? facts : Array.from({ length: 5 }, () => ({ classList: { toggle() {} } }))
  };
  const context = vm.createContext({
    sidWaveforms: () => [],
    sidVoiceFacts: (frequency, pulseWidth, routing) => [String(frequency), String(pulseWidth), String(routing)],
    updateSidNoiseState: () => 0,
    updateSidOscillatorPhase: () => 0
  });
  vm.runInContext(flagsSource + updateSource, context);
  return { card, settings, facts, phase, flags, update: context.updateSidVoiceMonitor };
}

test("all three voice monitors refresh ADSR and voice facts when registers change", () => {
  for (const voice of [0, 1, 2]) {
    const view = monitor(voice);
    const status = new Uint8Array(25);
    const offset = voice * 7;
    status[offset + 5] = 0x01;
    status[offset + 6] = 0xf7;
    view.update(view.card, voice, status, 0, { phase: "attack", level: 0.2 });
    assert.deepEqual(view.settings.map(element => element.textContent), ["0", "1", "15", "7"]);
    status[offset] = 42;
    status[offset + 2] = 90;
    status[offset + 5] = 0xa3;
    status[offset + 6] = 0x58;
    view.update(view.card, voice, status, 7, { phase: "decay", level: 0.8 });
    assert.deepEqual(view.settings.map(element => element.textContent), ["10", "3", "5", "8"]);
    assert.deepEqual(view.facts.map(element => element.textContent), ["42", "90", "7"]);
  }
});

test("envelope phase updates even when every register remains unchanged", () => {
  const view = monitor();
  const status = new Uint8Array(25);
  for (const phase of ["attack", "decay", "sustain", "release", "idle"]) {
    view.update(view.card, 0, status, 0, { phase, level: 0.5 });
    assert.equal(view.phase.textContent, phase.toUpperCase());
  }
});

test("SYNC, RING and TEST independently follow each voice's control bits", () => {
  for (const voice of [0, 1, 2]) {
    const view = monitor(voice);
    const status = new Uint8Array(25);
    for (const mask of [2, 4, 8, 14, 0]) {
      status[voice * 7 + 4] = mask;
      view.update(view.card, voice, status, 0, { phase: "idle", level: 0 });
      assert.deepEqual(view.flags.slice(0, 3).map(flag => flag.active), [Boolean(mask & 2), Boolean(mask & 4), Boolean(mask & 8)]);
      assert(view.flags.every(flag => flag.label.endsWith(flag.active ? ": on" : ": off")));
    }
  }
});

test("V3 OFF refreshes on D418-only changes, independent of filter routing", () => {
  const view = monitor(2);
  const status = new Uint8Array(25);
  for (const routing of [0, 4]) {
    for (const value of [0x0f, 0x8f, 0x0f]) {
      status[0x18] = value;
      view.update(view.card, 2, status, routing, { phase: "idle", level: 0 });
      assert.equal(view.flags[3].active, Boolean(value & 0x80));
    }
  }
  assert.equal(monitor(0).flags.length, 3);
  assert.equal(monitor(1).flags.length, 3);
});