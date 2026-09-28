import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GENERAL_SCENES, drawGeneralScene, updateGeneralMotion } from "../demo/general-scenes.js";
import { CurveSceneGeometry, CurveScenes } from "../demo/curve-scenes.js";
import { ImmersiveVisualizer } from "../demo/immersive-visualizer.js";
import { SHADER_SCENES, ShaderScenes, WAVEFORM_POINTS, createFlightHeightTexture, flightSkyDirections } from "../demo/shader-scenes.js";
import { AdditiveBlending, NormalBlending, DataUtils, RepeatWrapping, LinearFilter, Vector4 } from "../demo/vendor/three/three.module.min.js";

function renderer() {
  return Object.assign(Object.create(ImmersiveVisualizer.prototype), {
    elapsed: 12, sceneSeed: .4, quality: 1, sceneTransition: 1,
    channels: [
      Float32Array.from({ length: 256 }, (_, index) => Math.sin(index * .15) * .5),
      Float32Array.from({ length: 256 }, (_, index) => Math.sin(index * .09) * .4)
    ],
    signal: { low: .6, mid: .4, high: .3, level: .5 },
    tone: { bands: [.3, .2, .15, .15, .1, .1] }
  });
}

function capture() {
  let depth = 0;
  let points = 0;
  let signature = 0;
  let curves = 0;
  let minimumWidth = Infinity;
  let globalAlpha = 1;
  const coordinates = [];
  const hash = value => { signature = (signature * 31 + Math.round(value * 100)) % 1000000007; };
  const context = new Proxy({}, {
    get: (_, name) => name === "globalAlpha" ? globalAlpha : (...values) => {
      if (name === "createLinearGradient") return { addColorStop: (offset, color) => {
        assert(Number.isFinite(offset));
        for (const character of color) hash(character.charCodeAt(0));
      } };
      if (name === "save") depth++;
      if (name === "restore") depth--;
      assert(depth >= 0);
      for (const value of values) {
        if (typeof value === "number") { assert(Number.isFinite(value), `${name}: ${value}`); hash(value); }
      }
      if (["quadraticCurveTo", "bezierCurveTo"].includes(name)) curves++;
      if (["lineTo", "moveTo", "quadraticCurveTo", "bezierCurveTo", "fillRect"].includes(name)) points++;
      if (["lineTo", "moveTo", "quadraticCurveTo", "bezierCurveTo", "fillRect"].includes(name)) coordinates.push(...values);
    },
    set: (_, name, value) => {
      if (name === "globalAlpha") globalAlpha = value;
      if (name === "lineWidth") minimumWidth = Math.min(minimumWidth, value);
      if (typeof value === "number") assert(Number.isFinite(value), name);
      if (typeof value === "string") {
        assert(!/NaN|undefined/.test(value));
        for (const character of value) hash(character.charCodeAt(0));
      }
      return true;
    }
  });
  return { context, result: () => ({ depth, points, signature, curves, minimumWidth, coordinates }) };
}

function render(view, scene, width = 1440, height = 900) {
  const drawing = capture();
  view.drawScene(drawing.context, scene, width, height, width / 2, height / 2);
  return drawing.result();
}

test("Cascade spectral bars settle to baseline regardless of silent spectral balance", () => {
  const view = renderer();
  view.channels = [new Float32Array(256)];
  view.signal = { low: 0, mid: 0, high: 0, level: 0 };
  view.tone.bands = [1, 0, 0, 0, 0, 0];
  const heights = () => {
    const rectangles = [];
    const drawing = capture();
    const context = new Proxy(drawing.context, {
      get: (target, name) => name === "fillRect" ? (...values) => {
        rectangles.push(values);
        target.fillRect(...values);
      } : target[name]
    });
    view.drawScene(context, "cascade", 1440, 900, 720, 450);
    const stride = 29;
    return rectangles.filter((_, index) => (index + 1) % stride === 0).map(rectangle => rectangle[3]);
  };
  const silent = heights();
  assert(silent.every(height => Math.abs(height - 7.2) < 1e-9));
  view.tone.bands = [0, 0, 0, 0, 0, 1];
  assert.deepEqual(heights(), silent);
  view.tone.bands = [1, 0, 0, 0, 0, 0];
  view.signal.level = .0001;
  assert.deepEqual(heights(), silent, "Normalized low-level noise must not lift the bars");
  view.signal.level = .5;
  assert(heights()[0] > 100, "Audible bass should still raise the left bars");
  updateGeneralMotion(view, 1);
  view.signal.level = 0;
  for (let frame = 0; frame < 120; frame++) updateGeneralMotion(view, 1 / 60);
  assert.deepEqual(heights(), silent, "Bars must settle after playback stops");
});

test("Cascade keeps its grid fixed through transitions and adaptive quality changes", () => {
  for (const [width, height, columns] of [[1440, 900, 60], [390, 844, 36], [780, 1688, 36]]) {
    const view = renderer();
    const initial = render(view, "cascade", width, height);
    assert.equal(initial.points, columns * 29);
    for (const quality of [.25, .64, .88, 1]) {
      for (const sceneTransition of [0, .5, .999, 1]) {
        Object.assign(view, { quality, sceneTransition });
        const result = render(view, "cascade", width, height);
        assert.equal(result.points, initial.points);
        assert.deepEqual(result.coordinates, initial.coordinates, "Grid positions and audio sampling cannot jump with detail level");
      }
    }
  }
});

test("waveform inertia retains momentum and matches across 30, 60 and 240 Hz", () => {
  const results = [];
  for (const rate of [30, 60, 240]) {
    const view = renderer();
    view.channels = [new Float32Array(256).fill(1), new Float32Array(256).fill(-1)];
    const motion = updateGeneralMotion(view, 0);
    const storage = motion.values;
    updateGeneralMotion(view, 1 / rate);
    assert(motion.channels[0][48] > 0 && motion.channels[0][48] < .18);
    for (let frame = 1; frame < rate / 2; frame++) updateGeneralMotion(view, 1 / rate);
    assert.equal(motion.values, storage);
    assert(motion.channels[0][48] > .98 && motion.channels[0][48] < 1);
    assert.equal(motion.channels[0][48], -motion.channels[1][48]);
    results.push([...motion.values]);
    view.channels = [];
    const previous = motion.channels[0][48];
    updateGeneralMotion(view, 1 / rate);
    assert(motion.channels[0][48] > previous * .8);
    for (let frame = 0; frame < rate; frame++) updateGeneralMotion(view, 1 / rate);
    assert(Math.abs(motion.channels[0][48]) < .001);
    assert(motion.bands.every(value => Math.abs(value) < .001));
  }
  for (const result of results.slice(1)) result.forEach((value, index) => assert(Math.abs(value - results[0][index]) < 1e-10));
});

test("waveform snapshots preserve fresh signed PCM without temporal cancellation or source mutation", () => {
  const view = renderer();
  const left = Float32Array.from({ length: 256 }, (_, index) => index < 80 ? -.4 : index < 160 ? .3 : .1);
  const right = Float32Array.from(left, value => -value * .5);
  view.channels = [left, right];
  const original = [...left];
  const motion = updateGeneralMotion(view, 1 / 240);
  const storage = motion.traceChannels[0];
  assert.deepEqual([...storage], original);
  assert.deepEqual([...motion.traceChannels[1]], [...right]);
  assert.deepEqual([...left], original);
  left.forEach((value, index) => { left[index] = -value; });
  updateGeneralMotion(view, 1 / 240);
  assert.equal(motion.traceChannels[0], storage);
  assert.deepEqual([...storage], [...left], "A new buffer must not be averaged with the previous waveform phase");
  view.channels = [right];
  updateGeneralMotion(view, 0);
  assert.deepEqual([...storage], [...motion.traceChannels[1]], "Mono must feed both strands");
  view.channels = [];
  updateGeneralMotion(view, 0);
  assert(motion.traceChannels.every(channel => channel.every(value => value === 0)));
});

test("shader waveform smoothing holds targets, aligns stereo phase and settles without losing fresh traces", () => {
  const view = renderer();
  const left = Float32Array.from({ length: 256 }, (_, index) => Math.sin(index / 256 * Math.PI * 4) * .6);
  const right = Float32Array.from(left, value => -value * .5);
  view.channels = [left, right];
  updateGeneralMotion(view, 0);
  const state = view.generalMotion.shaderWaveform;
  const storage = state.channels[0];
  assert(state.channels[0].every(value => value === 0));
  updateGeneralMotion(view, .1);
  assert(state.channels[0][32] > .1 && state.channels[0][32] < .25, "The surface must ease into the waveform");
  const targets = state.targets.map(channel => [...channel]);
  view.channels = [Float32Array.from(left, value => -value), Float32Array.from(right, value => -value)];
  updateGeneralMotion(view, .04);
  assert.deepEqual(state.targets.map(channel => [...channel]), targets, "Rapid reads cannot replace a held target");
  assert.equal(view.generalMotion.traceChannels[0][32], -left[32], "Fresh audio snapshots remain available");
  updateGeneralMotion(view, .02);
  state.targets[0].forEach((value, index) => {
    assert(Math.abs(value - left[index]) < 1e-6, "A phase inversion must not flatten a steady waveform");
    assert(Math.abs(state.targets[1][index] + value * .5) < 1e-6, "Both channels must use the same phase alignment");
  });
  assert.equal(state.channels[0], storage);
  view.channels = [new Float32Array(256).fill(.25)];
  updateGeneralMotion(view, .2);
  view.channels[0].fill(.75);
  updateGeneralMotion(view, .12);
  assert(state.targets[0].every(value => value === .25), "A delayed frame cannot shorten the next refractory period");
  view.channels = [];
  for (let frame = 0; frame < 120; frame++) updateGeneralMotion(view, 1 / 120);
  assert(state.channels.every(channel => channel.every(value => Math.abs(value) < .001)));
  assert(state.targets.every(channel => channel.every(value => value === 0)));
});

test("shader waveform easing matches across refresh rates and drawing cannot advance it", () => {
  const results = [];
  for (const rate of [30, 60, 120, 144, 240, 360]) {
    const view = renderer();
    view.channels = [new Float32Array(256).fill(.5)];
    updateGeneralMotion(view, 0);
    for (let frame = 0; frame < rate / 2; frame++) updateGeneralMotion(view, 1 / rate);
    const state = view.generalMotion.shaderWaveform;
    results.push([...state.channels[0]]);
    assert.deepEqual([...state.channels[0]], [...state.channels[1]]);
    const gpu = Object.assign(Object.create(ShaderScenes.prototype), { waveform: new Float32Array(WAVEFORM_POINTS * 2), waveformTexture: {} });
    const before = [...state.channels[0]];
    gpu.updateWaveform(state.channels);
    gpu.updateWaveform(state.channels);
    assert.deepEqual([...state.channels[0]], before);
  }
  results.forEach(result => result.forEach((value, index) => assert(Math.abs(value - results[0][index]) < 1e-10)));
});

test("terrain pigment currents follow spectral balance, freeze in silence and respect reduced motion", () => {
  const advance = (bands, rate, reducedMotion = false) => {
    const view = Object.assign(renderer(), { reducedMotion });
    view.tone.bands = bands;
    const motion = updateGeneralMotion(view, 5);
    motion.pigmentFlow.fill(0);
    for (let frame = 0; frame < rate; frame++) updateGeneralMotion(view, 1 / rate);
    return { view, motion, phases: [...motion.pigmentFlow] };
  };
  const bass = [1, 0, 0, 0, 0, 0];
  const result = advance(bass, 60);
  assert(result.phases[0] > result.phases[1] * 3);
  const treble = advance([0, 0, 0, 0, 0, 1], 60);
  assert(treble.phases[2] > treble.phases[0] * 3);
  treble.view.tone.bands = bass;
  updateGeneralMotion(treble.view, 0);
  assert.deepEqual([...treble.motion.pigmentFlow], treble.phases, "Changing audio cannot jump the current positions");
  updateGeneralMotion(treble.view, 1 / 60);
  treble.motion.pigmentFlow.forEach((phase, index) => assert(phase > treble.phases[index] && phase - treble.phases[index] < .04));
  for (const rate of [30, 144, 240]) {
    advance(bass, rate).phases.forEach((phase, index) => assert(Math.abs(phase - result.phases[index]) < 1e-9));
  }
  advance(bass, 60, true).phases.forEach((phase, index) => assert(Math.abs(phase - result.phases[index] * .2) < 1e-9));
  const storage = result.motion.pigmentFlow;
  result.view.channels = [];
  updateGeneralMotion(result.view, 1);
  assert.equal(result.motion.pigmentFlow, storage);
  assert.deepEqual([...storage], result.phases);
  const quiet = renderer();
  quiet.channels = [new Float32Array(256)];
  quiet.signal = { low: 0, mid: 0, high: 0, level: 0 };
  assert.deepEqual([...updateGeneralMotion(quiet, 1).pigmentFlow], [0, 0, 0]);
});

test("terrain shape envelopes follow audio smoothly across refresh rates and settle without input", () => {
  const results = [];
  for (const rate of [30, 60, 144, 240]) {
    const view = renderer();
    const motion = updateGeneralMotion(view, 0);
    const storage = motion.terrain.values;
    assert.deepEqual([...storage], [0, 0, 0, 0]);
    updateGeneralMotion(view, 1 / rate);
    assert(storage[0] > 0 && storage[0] < .05, "Mountain height must ease in instead of snapping");
    for (let frame = 1; frame < rate; frame++) updateGeneralMotion(view, 1 / rate);
    results.push([...storage]);
    assert(storage[0] > .59 && storage[1] > .39 && storage[2] > .29);
    const phases = [...motion.pigmentFlow];
    updateGeneralMotion(view, 0);
    assert.deepEqual([...motion.pigmentFlow], phases);
    view.channels = [];
    for (let frame = 0; frame < rate * 2; frame++) updateGeneralMotion(view, 1 / rate);
    assert.equal(motion.terrain.values, storage);
    assert(storage.every(value => Math.abs(value) < .001));
  }
  for (const result of results.slice(1)) result.forEach((value, index) => assert(Math.abs(value - results[0][index]) < 1e-10));
  const reduced = Object.assign(renderer(), { reducedMotion: true });
  const values = updateGeneralMotion(reduced, 4).terrain.values;
  assert(values[0] < .121 && values[1] < .081 && values[2] < .061);
  const view = renderer();
  const motion = updateGeneralMotion(view, 0, { beat: true, strongBeat: true });
  for (let frame = 0; frame < 9; frame++) updateGeneralMotion(view, 1 / 60);
  assert(motion.terrain.values[3] > .3, "Beat momentum must drive a broad terrain swell");
});

test("camera audio eases independently of refresh rate and settles without a source", () => {
  const snapshots = [];
  for (const rate of [30, 60, 144, 240]) {
    const view = renderer();
    view.channels = [new Float32Array(96).fill(.5), new Float32Array(96).fill(.1)];
    const motion = updateGeneralMotion(view, 0);
    const storage = motion.flight.values;
    assert.deepEqual([...storage], [0, 0, 0, 0]);
    updateGeneralMotion(view, 1 / rate, { strongBeat: true, beat: true });
    assert(storage[0] > 0 && storage[0] < .005, "Bass must ease in without a camera kick");
    for (let frame = 1; frame < rate; frame++) updateGeneralMotion(view, 1 / rate);
    assert.equal(motion.flight.values, storage);
    assert(storage[0] > .5 && storage[0] < .6);
    assert(storage[3] < -.5 && storage[3] > -1, "Energy on the left must steer left");
    snapshots.push([...storage]);
    view.channels = [];
    for (let frame = 0; frame < rate * 4; frame++) updateGeneralMotion(view, 1 / rate);
    assert(storage.every(value => Math.abs(value) < .001), "Missing audio restores the base flight");
  }
  for (const result of snapshots.slice(1)) result.forEach((value, index) => assert(Math.abs(value - snapshots[0][index]) < 1e-10));
});

test("camera stereo follows channel energy, duplicates mono and reduces motion", () => {
  const camera = (channels, reducedMotion = false) => {
    const view = Object.assign(renderer(), { channels, reducedMotion });
    return [...updateGeneralMotion(view, 1).flight.values];
  };
  const left = new Float32Array(96).fill(.5);
  const right = new Float32Array(96).fill(.1);
  const normal = camera([left, right]);
  const reversed = camera([right, left]);
  assert.equal(normal[3], -reversed[3]);
  assert.deepEqual(camera([Float32Array.from(left, value => -value), right]), normal);
  assert.equal(camera([left])[3], 0);
  assert.equal(camera([left, left])[3], 0);
  camera([left, right], true).forEach((value, index) => assert(Math.abs(value - normal[index] * .2) < 1e-10));
});

test("music has a fast attack and beat momentum decays consistently without a flash or step", () => {
  const impacts = [];
  for (const rate of [30, 60, 240]) {
    const view = renderer();
    view.channels = [new Float32Array(256).fill(1)];
    view.signal.level = 1;
    const motion = updateGeneralMotion(view, 0, { beat: true, strongBeat: true });
    assert.equal(motion.impact, 0);
    for (let frame = 0; frame < rate / 10; frame++) updateGeneralMotion(view, 1 / rate);
    assert(motion.signal.level > .82);
    assert(motion.channels[0][48] > .64);
    assert(motion.impact > .7 && motion.impact < 1);
    impacts.push(motion.impact);
    for (let frame = 0; frame < rate; frame++) updateGeneralMotion(view, 1 / rate);
    assert(motion.impact < .001);
  }
  for (const impact of impacts) assert(Math.abs(impact - impacts[0]) < 1e-10);
  const normal = renderer();
  const reduced = Object.assign(renderer(), { reducedMotion: true });
  updateGeneralMotion(normal, .05, { beat: true });
  updateGeneralMotion(reduced, .05, { beat: true });
  assert(reduced.generalMotion.impact < normal.generalMotion.impact * .3);
});

test("every scene has a substantial geometric beat response, not just a color change", () => {
  for (const scene of GENERAL_SCENES) {
    const view = renderer();
    updateGeneralMotion(view, .2);
    const resting = render(view, scene);
    view.generalMotion.impact = 1;
    const hit = render(view, scene);
    assert.equal(resting.coordinates.length, hit.coordinates.length);
    const displacement = Math.max(...hit.coordinates.map((value, index) => Math.abs(value - resting.coordinates[index])));
    assert(displacement > 18, `${scene}: ${displacement}px`);
  }
});

test("every scene uses inertial audio and drawing never advances its shared crossfade state", () => {
  const view = renderer();
  const motion = updateGeneralMotion(view, .1);
  for (const scene of GENERAL_SCENES) {
    const before = render(view, scene).signature;
    view.channels = [new Float32Array(256).fill(-1)];
    view.signal = { low: 1, mid: 1, high: 1, level: 1 };
    view.tone.bands.fill(1);
    assert.equal(render(view, scene).signature, before, scene);
    const values = [...motion.values];
    render(view, scene);
    assert.deepEqual([...motion.values], values);
  }
});

test("all general scenes are distinct, finite and adapt geometry at desktop and mobile sizes", () => {
  assert.equal(GENERAL_SCENES.length, 20);
  const view = renderer();
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    const signatures = new Set();
    for (const scene of GENERAL_SCENES) {
      view.quality = 1;
      const full = render(view, scene, width, height);
      assert.equal(full.depth, 0, scene);
      assert(full.points >= 38 && full.points < 10000, `${scene}: ${full.points}`);
      signatures.add(full.signature);
      view.quality = .25;
      const low = render(view, scene, width, height);
      assert.equal(low.depth, 0, scene);
      if (scene === "monolith") assert.equal(low.points, 38);
      else if (scene === "aperture") assert.equal(low.points, full.points, "Rigid iris leaves retain their corners at every detail level");
      else if (scene === "cascade") assert.equal(low.points, full.points, "Cascade retains its grid at every detail level");
      else assert(low.points > 30 && low.points < full.points * .7, scene);
    }
    assert.equal(signatures.size, GENERAL_SCENES.length);
  }
});

test("every scene responds to music, evolves over time and renders silence and mono safely", () => {
  for (const scene of GENERAL_SCENES) {
    const view = renderer();
    const active = render(view, scene).signature;
    view.elapsed += 3;
    assert.notEqual(render(view, scene).signature, active, `${scene} motion`);
    view.elapsed -= 3;
    view.channels = [];
    view.signal = { low: 0, mid: 0, high: 0, level: 0 };
    view.tone.bands = Array(6).fill(0);
    assert.notEqual(render(view, scene).signature, active, `${scene} audio`);
    view.channels = [new Float32Array([1, -1, 1, -1])];
    render(view, scene);
    view.reducedMotion = true;
    view.quality = .25;
    render(view, scene);
  }
});

test("waveforms stay broad in CSS pixels and curved even at minimum adaptive detail", () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const resolution of [.4, 1, 2]) {
      const view = Object.assign(renderer(), { quality: .25, canvas: { clientWidth: width } });
      for (const scene of GENERAL_SCENES) {
        const result = render(view, scene, width * resolution, height * resolution);
        if (!["aperture", "terrain", "voxel-flight", "prism", "helix", "copper", "silk", "particle-assembly", "feedback-bloom"].includes(scene)) assert(result.minimumWidth / resolution >= 4.5, scene);
        if (!["aperture", "cascade", "prism", "monolith", "checker-tunnel", "raster-twist", "dot-vortex"].includes(scene)) assert(result.curves > 0, scene);
      }
    }
  }
});

test("GPU scenes dispatch at native dimensions with shared motion and fall back without WebGL", () => {
  assert.deepEqual(SHADER_SCENES, ["checker-tunnel", "voxel-flight", "raster-twist", "metaball-foundry"]);
  const view = renderer();
  const motion = updateGeneralMotion(view, .1);
  const calls = [];
  view.scene = "metaball-foundry";
  view.sceneArc = { reveal: .5, development: .3, climax: 0, release: 0 };
  view.previousSceneArc = { reveal: 1, development: 1, climax: 0, release: 1 };
  view.shaderScenes = { draw: (...args) => { calls.push(args); return true; } };
  view.canvas = { getContext() {} };
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: {}, configurable: true });
  try {
    for (const scene of SHADER_SCENES) {
      const result = render(view, scene, 2880, 1800);
      assert.equal(result.points, 0);
      const args = calls.at(-1);
      assert.equal(args[1], scene);
      assert.deepEqual(args.slice(2, 4), [2880, 1800]);
      assert.equal(args[4], motion);
      assert.equal(args[5], view.sceneSeed);
      assert.equal(args[6], view.quality);
      assert.equal(args[9], scene === view.scene ? view.sceneArc : view.previousSceneArc);
    }
    view.shaderScenes.draw = () => false;
    for (const scene of SHADER_SCENES) assert(render(view, scene).points > 38, scene);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete globalThis.document;
  }
});

test("Foundry body uniforms fuse at the peak and stay bounded without advancing shared state", () => {
  const shader = Object.assign(Object.create(ShaderScenes.prototype), { uniforms: {
    composition: { value: new Vector4() },
    foundryBodies: { value: Array.from({ length: 6 }, () => new Vector4()) }
  } });
  const state = updateGeneralMotion(renderer(), .1);
  const before = structuredClone(state);
  const arc = { reveal: 1, development: 1, climax: 0, release: 0 };
  const bodies = shader.uniforms.foundryBodies.value;
  shader.updateFoundry(state, .4, arc);
  const developed = bodies.map(body => body.clone());
  shader.updateFoundry(state, .4, { ...arc, climax: 1 });
  assert(bodies[0].w > developed[0].w);
  for (let body = 1; body < bodies.length; body++) {
    assert(Math.hypot(bodies[body].x, bodies[body].y, bodies[body].z)
      < Math.hypot(developed[body].x, developed[body].y, developed[body].z) * .2);
  }
  shader.updateFoundry(state, .4, arc);
  assert.deepEqual(bodies, developed);
  assert.deepEqual(state, before);
  assert.equal(shader.uniforms.foundryBodies.value, bodies);
  for (const release of [0, .5, 1]) {
    shader.updateFoundry({ time: 300, signal: { low: 8, mid: 8, high: 8 }, impact: 8 }, .9, { ...arc, release });
    for (const body of bodies) assert(Math.hypot(body.x, body.y, body.z) + body.w < 3);
  }
  const view = renderer();
  view.scene = "metaball-foundry";
  view.sceneArc = arc;
  const fallback = render(view, view.scene);
  view.sceneArc = { ...arc, climax: 1 };
  assert.notEqual(render(view, view.scene).signature, fallback.signature);
});

test("Foundry reflects stereo waveforms without using them to deform its surface", async () => {
  const source = await readFile(new URL("../demo/shader-scenes.js", import.meta.url), "utf8");
  const shader = source.slice(source.indexOf("const foundryShader"), source.indexOf("function heightTexture"));
  assert.match(shader, /common \+ waveformShader/);
  const distance = shader.slice(shader.indexOf("float foundryDistance"), shader.indexOf("vec3 studio"));
  assert.doesNotMatch(distance, /waveAt|waveform/);
  assert.match(shader, /vec2 wave = waveAt\(direction\.x/);
  assert.match(shader, /studio\(reflection\)/);
  assert.match(shader, /ribbon\.x[\s\S]*ribbon\.y/);
  assert.doesNotMatch(shader, /float seam|float strip|float rim/);
});

test("Particle Assembly gathers deterministically and preserves its outgoing composition", () => {
  const view = Object.assign(renderer(), { scene: "particle-assembly", sceneDuration: 36,
    sceneArc: { reveal: 1, development: 1, climax: 0, release: 0 } });
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    for (const quality of [1, .25]) {
      view.quality = quality;
      const drawing = capture();
      let particles = 0;
      const context = new Proxy(drawing.context, { get(target, name) {
        if (name === "fill") return () => { particles++; target.fill(); };
        return target[name];
      } });
      drawGeneralScene(view, context, view.scene, width, height, width / 2, height / 2);
      assert(particles >= 240 && particles <= 900);
      assert.equal(view.assemblyProjection.camera.aspect, width / height);
      assert(drawing.result().coordinates.every(value => Number.isFinite(value) && Math.abs(value) < Math.max(width, height) * 4));
    }
  }
  const developed = render(view, view.scene).signature;
  const projection = view.assemblyProjection;
  view.sceneArc = { ...view.sceneArc, climax: 1 };
  const peak = render(view, view.scene).signature;
  assert.notEqual(peak, developed);
  assert.equal(render(view, view.scene).signature, peak);
  assert.equal(view.assemblyProjection, projection);
  const outgoing = view.sceneArc;
  view.scene = "silk";
  view.previousSceneArc = outgoing;
  view.sceneArc = { reveal: 0, development: 0, climax: 0, release: 0 };
  assert.equal(render(view, "particle-assembly").signature, peak, "The outgoing assembly retains its own composition");
  view.scene = "particle-assembly";
  view.sceneArc = undefined;
  view.elapsed = view.sceneElapsed = 14;
  view.updateSceneArc({ returnFromDrop: true });
  view.elapsed = view.sceneElapsed = 15;
  view.updateSceneArc();
  assert.equal(view.sceneArc.phase, "peak");
  assert.equal(view.sceneArc.climax, 1);
});

test("Particle Assembly reacts before gathering and pans gently with audio time held fixed", () => {
  const view = Object.assign(renderer(), { scene: "particle-assembly",
    sceneArc: { reveal: 1, development: 0, climax: 0, release: 0 } });
  const motion = updateGeneralMotion(view, .1);
  const resting = render(view, view.scene);
  const camera = view.assemblyProjection.camera;
  const position = camera.position.clone();
  motion.impact = 1;
  assert.notDeepEqual(render(view, view.scene).coordinates, resting.coordinates);
  motion.impact = 0;
  const flat = [new Float64Array(256), new Float64Array(256)];
  motion.shaderWaveform.channels = flat;
  const neutral = render(view, view.scene);
  flat[0].fill(.6);
  assert.notDeepEqual(render(view, view.scene).coordinates, neutral.coordinates);
  flat[0].fill(0);
  flat[1].fill(.6);
  assert.notDeepEqual(render(view, view.scene).coordinates, neutral.coordinates);
  const clock = motion.time;
  view.elapsed += 12;
  render(view, view.scene);
  assert.notDeepEqual(camera.position, position);
  assert(Math.abs(camera.position.x) <= .3 && Math.abs(camera.position.y) <= .22);
  assert(camera.position.z >= 11.2 && camera.position.z <= 12);
  assert.equal(motion.time, clock);
  motion.signal = { low: 8, mid: 8, high: 8, level: 8 };
  const loud = render(view, view.scene);
  assert(camera.position.z >= 11.2 && camera.position.z <= 12);
  motion.signal = { low: 1, mid: 1, high: 1, level: 1 };
  assert.deepEqual(render(view, view.scene).coordinates, loud.coordinates, "Above-unity input must not cause runaway camera or particle deformation");
});

test("Feedback Bloom retains bounded stereo history, expires silence and never advances during drawing", () => {
  for (const rate of [30, 60, 120]) {
    const view = Object.assign(renderer(), { scene: "feedback-bloom",
      channels: [new Float32Array(256).fill(.4), new Float32Array(256).fill(-.2)] });
    for (let frame = 0; frame < rate * 3; frame++) updateGeneralMotion(view, 1 / rate);
    const motion = view.generalMotion;
    const history = motion.feedback;
    assert.equal(history.count, 24);
    assert.equal(history.frames.length, 24);
    assert.equal(history.tick, 25);
    const latest = history.frames[(history.head + 23) % 24];
    assert(latest.channels[0][48] > .1 && latest.channels[1][48] < -.05);
    const before = structuredClone(history);
    const signature = render(view, view.scene).signature;
    assert.equal(render(view, view.scene).signature, signature);
    assert.deepEqual(history, before);
    const buffers = history.frames.map(frame => frame.channels);
    view.channels = [];
    view.signal = { low: 0, mid: 0, high: 0, level: 0 };
    updateGeneralMotion(view, .2);
    const trails = render(view, view.scene).signature;
    motion.feedback = undefined;
    assert.notEqual(render(view, view.scene).signature, trails, "Old audio must remain visible in the fading trails");
    motion.feedback = history;
    updateGeneralMotion(view, 3.1);
    assert(history.frames.every(frame => history.time - frame.time > 3 || frame.level === 0));
    history.frames.forEach((frame, index) => assert.equal(frame.channels, buffers[index]));
    view.scene = "silk";
    view.previousScene = "feedback-bloom";
    view.sceneTransition = .5;
    updateGeneralMotion(view, .01);
    assert.equal(motion.feedback, history);
    view.sceneTransition = 1;
    updateGeneralMotion(view, .01);
    assert.equal(motion.feedback, undefined);
  }
});

test("GPU curve batches retain original scene geometry, gradient stops and reusable buffers", () => {
  const paths = new CurveSceneGeometry();
  const transform = { a: 1.035, b: .02, c: -.02, d: 1.035, e: 17, f: -11 };
  const view = renderer();
  updateGeneralMotion(view, .2);
  const before = [...view.generalMotion.values];
  for (const [width, height] of [[1440, 900], [780, 1688]]) {
    for (const scene of ["aperture", "diffraction", "silk", "contours", "interference", "weave", "wavegarden", "helix", "terrain", "particle-assembly", "feedback-bloom"]) {
      paths.begin(transform, .37);
      drawGeneralScene(view, paths, scene, width, height, width / 2, height / 2);
      assert(paths.vertexCount > 100);
      assert.equal(paths.indexCount % 3, 0);
      assert(paths.indexCount > paths.vertexCount * 2, "Triangle vertices should be shared");
      assert(paths.indices.subarray(0, paths.indexCount).every(index => index < paths.vertexCount));
      assert.equal(paths.stack.length, 0);
      assert.equal(paths.paintCount, scene === "aperture" ? 24 : scene === "terrain" ? 5 : 0);
      for (let offset = 0; offset < paths.vertexCount * 9; offset += 9) {
        for (let component = 0; component < 9; component++) assert(Number.isFinite(paths.vertices[offset + component]));
        assert(paths.vertices[offset + 5] <= .37 + 1e-7);
        assert(paths.vertices[offset + 8] >= 0 && paths.vertices[offset + 8] <= 1);
      }
      if (scene === "aperture") {
        assert.deepEqual([...paths.paints.slice(20, 24)].map(value => Math.round(value * 100)), [28, 52, 78, 100]);
      }
      const count = paths.vertexCount;
      const snapshot = paths.vertices.slice(0, count * 9);
      const indices = paths.indices.slice(0, paths.indexCount);
      const buffer = paths.vertices;
      paths.begin(transform, .37);
      drawGeneralScene(view, paths, scene, width, height, width / 2, height / 2);
      assert.equal(paths.vertices, buffer);
      assert.equal(paths.vertexCount, count);
      assert.deepEqual(paths.vertices.subarray(0, count * 9), snapshot);
      assert.deepEqual(paths.indices.subarray(0, paths.indexCount), indices);
    }
  }
  assert.deepEqual([...view.generalMotion.values], before, "GPU drawing must not advance shared audio");
});

test("GPU curves preserve crossfade alpha and bypass both raster allocation and CPU paths", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
  const calls = [];
  const view = renderer();
  view.curveScenes = { draw: (...args) => { calls.push(args); return true; }, dispose() {} };
  const context = { globalAlpha: .37 };
  try {
    for (const scene of ["aperture", "wavegarden", "helix", "terrain"]) {
      view.drawScene(context, scene, 3840, 2160, 1920, 1080, .4);
      assert.equal(calls.at(-1)[0], view);
      assert.equal(calls.at(-1)[1], context);
      assert.deepEqual(calls.at(-1).slice(2), [scene, 3840, 2160, 1920, 1080, .4]);
    }
    assert.equal(calls.length, 4);
    assert.equal(view.sceneCanvas, undefined);
    assert.equal(context.globalAlpha, .37);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  }
});

test("additive GPU scenes preserve parent alpha and restore blending when switching scenes", () => {
  const paths = new CurveSceneGeometry();
  const buffer = array => ({ array, clearUpdateRanges() {}, addUpdateRange() {} });
  const composites = [];
  const blends = [];
  const gpu = Object.assign(Object.create(CurveScenes.prototype), {
    paths, buffer: buffer(paths.vertices), indexBuffer: buffer(paths.indices), texture: {},
    geometry: { setDrawRange() {} },
    material: { uniforms: { resolution: { value: { set() {} } } } },
    renderer: {
      domElement: { width: 1440, height: 900 },
      getContext: () => ({ isContextLost: () => false }),
      render: () => blends.push(gpu.material.blending)
    }
  });
  const stack = [];
  const context = {
    globalAlpha: .37, globalCompositeOperation: "source-over",
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    resetTransform() {},
    save() { stack.push([this.globalAlpha, this.globalCompositeOperation]); },
    restore() { [this.globalAlpha, this.globalCompositeOperation] = stack.pop(); },
    drawImage() { composites.push([this.globalAlpha, this.globalCompositeOperation]); }
  };
  const view = renderer();
  updateGeneralMotion(view, .5);
  for (const scene of ["wavegarden", "helix", "terrain", "aperture"]) {
    assert(gpu.draw(view, context, scene, 1440, 900, 720, 450, .4));
    assert.equal(context.globalAlpha, .37);
    assert.equal(context.globalCompositeOperation, "source-over");
    for (let offset = 5; offset < paths.vertexCount * 9; offset += 9) assert(paths.vertices[offset] <= .37 + 1e-7);
  }
  assert.deepEqual(blends, [AdditiveBlending, AdditiveBlending, AdditiveBlending, NormalBlending]);
  assert.deepEqual(composites, [[1, "lighter"], [1, "lighter"], [1, "lighter"], [1, "source-over"]]);
});

test("two-stop terrain gradients interpolate straight colors before fragment premultiplication", () => {
  const paths = new CurveSceneGeometry();
  paths.begin({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, .4);
  const gradient = paths.createLinearGradient(0, 0, 0, 100);
  gradient.addColorStop(0, "hsla(180 100% 50% / .5)");
  gradient.addColorStop(1, "hsla(0 100% 50% / .1)");
  assert.deepEqual(paths.paint(gradient).shade, [1, 0, 0, 0]);
  assert.equal(paths.paints[1], 1);
  assert.equal(paths.paints[16], 1);
  assert.deepEqual([...paths.paints.slice(20, 24)], [.25, .5, .75, 1]);
  for (let stop = 0; stop < 5; stop++) {
    for (let component = 0; component < 4; component++) {
      const expected = paths.paints[component] + (paths.paints[16 + component] - paths.paints[component]) * stop / 4;
      assert(Math.abs(paths.paints[stop * 4 + component] - expected) < 1e-7);
    }
  }
  assert(Math.abs(paths.paints[3] - .2) < 1e-7);
  assert(Math.abs(paths.paints[19] - .04) < 1e-7);
});

test("GPU curve resources are released and context loss requests the raster fallback", () => {
  const released = [];
  const gpu = Object.assign(Object.create(CurveScenes.prototype), {
    geometry: { dispose: () => released.push("geometry") },
    material: { dispose: () => released.push("material") },
    texture: { dispose: () => released.push("texture") },
    renderer: {
      getContext: () => ({ isContextLost: () => true }),
      dispose: () => released.push("renderer"), forceContextLoss: () => released.push("context")
    }
  });
  assert.equal(gpu.draw(), false);
  const view = renderer();
  view.stop = () => {};
  view.resizeObserver = { disconnect() {} };
  view.curveScenes = gpu;
  view.dispose();
  view.dispose();
  assert.deepEqual(released, ["geometry", "material", "texture", "renderer", "context"]);
  assert.equal(view.curveScenes, undefined);
});

test("dense curve scenes reuse a native raster surface with camera and per-path crossfade alpha", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
  const surfaces = [];
  const transforms = [];
  const drawing = capture();
  const raster = new Proxy(drawing.context, {
    get: (target, name) => name === "setTransform" ? transform => transforms.push(transform) : target[name]
  });
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: class {
    constructor(width, height) { this.width = width; this.height = height; surfaces.push(this); }
    getContext(type, options) {
      assert.equal(type, "2d");
      assert.deepEqual(options, { willReadFrequently: true });
      return raster;
    }
  } });
  const transform = { a: 1.04, b: .02, c: -.02, d: 1.04, e: 24, f: -12 };
  const copies = [];
  let savedAlpha;
  const output = {
    globalAlpha: .37,
    getTransform: () => transform,
    save() { savedAlpha = this.globalAlpha; },
    resetTransform() {},
    restore() { this.globalAlpha = savedAlpha; },
    drawImage(surface, horizontal, vertical) {
      assert.equal(this.globalAlpha, 1, "Crossfade alpha must not be applied twice");
      assert.equal(raster.globalAlpha, .37);
      copies.push([surface.width, surface.height, horizontal, vertical]);
    }
  };
  try {
    const view = renderer();
    for (const scene of ["aperture", "diffraction", "silk", "contours", "interference", "weave"]) {
      view.drawScene(output, scene, 3840, 2160, 1920, 1080);
      assert.equal(output.globalAlpha, .37);
    }
    assert.equal(surfaces.length, 1);
    assert.deepEqual(copies, Array.from({ length: 6 }, () => [3840, 2160, 0, 0]));
    assert(transforms.every(value => value === transform));
    view.quality = .25;
    view.drawScene(output, "diffraction", 3840, 2160, 1920, 1080);
    assert.deepEqual(copies.at(-1), [3840, 2160, 0, 0]);
    view.drawScene(output, "diffraction", 780, 1688, 390, 844);
    assert.equal(surfaces.length, 1);
    assert.deepEqual(copies.at(-1), [780, 1688, 0, 0]);
    view.stop = () => {};
    view.resizeObserver = { disconnect() {} };
    view.dispose();
    assert.equal(surfaces[0].width, 1);
    assert.equal(view.sceneCanvas, undefined);
    assert.equal(view.sceneContext, undefined);
  } finally {
    if (original) Object.defineProperty(globalThis, "OffscreenCanvas", original);
    else delete globalThis.OffscreenCanvas;
  }
});

test("dense curve scenes fall back when the native raster surface is unavailable", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
  let attempts = 0;
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: class {
    constructor() { attempts++; }
    getContext() { return null; }
  } });
  try {
    const view = renderer();
    assert(render(view, "diffraction").curves > 0);
    assert(render(view, "silk").curves > 0);
    assert.equal(attempts, 1);
    assert.equal(view.sceneRasterUnavailable, true);
  } finally {
    if (original) Object.defineProperty(globalThis, "OffscreenCanvas", original);
    else delete globalThis.OffscreenCanvas;
  }
});

test("Aperture retains four six-leaf iris layers and an open center at every detail level", () => {
  for (const quality of [.25, 1]) {
    for (const impact of [0, 1.2]) {
      const view = Object.assign(renderer(), { quality });
      updateGeneralMotion(view, .2);
      view.generalMotion.impact = impact;
      const drawing = capture();
      let fills = 0;
      let gradients = 0;
      const context = new Proxy(drawing.context, {
        get: (target, name) => {
          if (name === "fill") return (...args) => { fills++; return target.fill(...args); };
          if (name === "createLinearGradient") return (...args) => { gradients++; return target.createLinearGradient(...args); };
          return target[name];
        }
      });
      view.drawScene(context, "aperture", 1440, 900, 720, 450);
      assert.equal(fills, 169);
      assert.equal(gradients, 24);
      const coordinates = drawing.result().coordinates;
      for (let index = 0; index < coordinates.length; index += 2) {
        const radius = Math.hypot(coordinates[index], coordinates[index + 1]);
        assert(radius >= 0, "Tunnel coordinates must remain finite");
        assert(radius < Math.hypot(1440, 900) * 1.1, "Zoomed blades must remain bounded beyond the viewport");
      }
      assert(Math.max(...coordinates.map(Math.abs)) > 1440 * .5, "The iris must extend across the landscape viewport");
      assert.equal(drawing.result().depth, 0);
    }
  }
});

test("Aperture leaves share a straight-sided hexagonal opening without decorative overlays", () => {
  const view = renderer();
  updateGeneralMotion(view, .2);
  const drawing = capture();
  const leaves = [];
  let path = [];
  let strokes = 0;
  let foreground = false;
  const context = new Proxy(drawing.context, {
    get: (target, name) => (...values) => {
      if (name === "createLinearGradient") foreground = true;
      if (name === "beginPath") path = [];
      if (name === "moveTo" || name === "lineTo") path.push(values);
      if (name === "fill" && foreground) leaves.push(path.slice());
      if (name === "stroke" && foreground) strokes++;
      if (foreground && (name === "quadraticCurveTo" || name === "bezierCurveTo")) assert.fail("Mechanical leaves must not become rounded splines");
      return target[name](...values);
    }
  });
  drawGeneralScene(view, context, "aperture", 1440, 900, 720, 450);
  assert.equal(leaves.length, 24);
  for (let layer = 0; layer < 4; layer++) {
    for (let blade = 0; blade < 6; blade++) {
      const leaf = leaves[layer * 6 + blade];
      const next = leaves[layer * 6 + (blade + 1) % 6];
      assert.equal(leaf.length, 4);
      assert(Math.hypot(leaf[3][0] - next[0][0], leaf[3][1] - next[0][1]) < 1e-8);
      const radius = Math.hypot(...leaf[0]);
      assert(radius > 900 * .06, "Foreground leaves retain an open center over the tunnel");
      const chord = Math.hypot(leaf[3][0] - leaf[0][0], leaf[3][1] - leaf[0][1]);
      assert(Math.abs(chord - radius) < 1e-8, "Six shared edges form a regular hexagon");
    }
  }
  assert.equal(strokes, 48, "Only blade seams and opening edges remain");
});

test("Aperture mirrors smooth iris reflections into a six-fold center without outlines", () => {
  const view = renderer();
  updateGeneralMotion(view, .2);
  const snapshot = () => {
    const drawing = capture();
    const surfaces = [];
    let foreground = false;
    let path = [];
    let curves = 0;
    const context = new Proxy(drawing.context, {
      get: (target, name) => (...values) => {
        if (name === "createLinearGradient") foreground = true;
        if (name === "beginPath") path = [];
        if (name === "moveTo" || name === "lineTo") path.push(values);
        if (name === "quadraticCurveTo" && !foreground) {
          curves++;
          path.push(values.slice(0, 2), values.slice(2));
        }
        if (name === "stroke" && !foreground) assert.fail("Reflections must not have sharp outlines");
        if (name === "fill" && !foreground) surfaces.push(path.slice());
        return target[name](...values);
      }
    });
    drawGeneralScene(view, context, "aperture", 1440, 900, 720, 450);
    assert.equal(curves, 144 * 4);
    return surfaces;
  };
  const before = snapshot();
  assert.equal(before.length, 145, "A backing surface and four sets of mirrored iris fragments precede the blades");
  assert.equal(before[0].length, 12);
  assert(before.slice(1).every(surface => surface.length === 9));
  for (let index = 1; index < before.length; index += 2) {
    const axis = view.sceneSeed * Math.PI * 2 + ((index - 1) % 12) / 2 * Math.PI / 3;
    for (let corner = 0; corner < before[index].length; corner++) {
      const first = before[index][corner];
      const second = before[index + 1][corner];
      const along = point => point[0] * Math.cos(axis) + point[1] * Math.sin(axis);
      const across = point => -point[0] * Math.sin(axis) + point[1] * Math.cos(axis);
      assert(Math.abs(along(first) - along(second)) < 1e-8);
      assert(Math.abs(across(first) + across(second)) < 1e-8);
    }
  }
  assert.deepEqual(snapshot(), before);
  view.generalMotion.time += .5;
  assert.notDeepEqual(snapshot(), before, "Reflections move with iris rotation even without fresh audio");
  view.generalMotion.bands.fill(0);
  const quiet = snapshot();
  for (const [layer, band] of [0, 1, 3, 5].entries()) {
    view.generalMotion.bands[band] = .1;
    const active = snapshot();
    for (let other = 0; other < 4; other++) {
      const start = 1 + other * 36;
      const reflections = active.slice(start, start + 36);
      const baseline = quiet.slice(start, start + 36);
      if (layer === other) assert.notDeepEqual(reflections, baseline, "The assigned iris drives its mirrored fragments");
      else assert.deepEqual(reflections, baseline);
    }
    view.generalMotion.bands[band] = 0;
  }
});

test("Aperture zoom and drift continue with musical state held fixed", () => {
  const view = renderer();
  updateGeneralMotion(view, .2);
  view.elapsed = (Math.PI * 2.5 - view.sceneSeed * Math.PI * 2) / .14;
  const before = render(view, "aperture");
  const state = [...view.generalMotion.values];
  view.elapsed += Math.PI / .14;
  const after = render(view, "aperture");
  assert(Math.max(...after.coordinates.map((value, index) => Math.abs(value - before.coordinates[index]))) > 100);
  assert.notEqual(after.signature, before.signature);
  assert.deepEqual([...view.generalMotion.values], state);
  assert.deepEqual(render(view, "aperture"), after);
});

test("Aperture uses restrained cyan and warm accents with broad silver highlights", () => {
  const view = renderer();
  const drawing = capture();
  const paints = [];
  const context = new Proxy(drawing.context, {
    get: (target, name) => name === "createLinearGradient" ? () => {
      const stops = [];
      paints.push(stops);
      return { addColorStop: (offset, color) => stops.push({ offset, color }) };
    } : target[name]
  });
  drawGeneralScene(view, context, "aperture", 1440, 900, 720, 450);
  assert.equal(paints.length, 24);
  assert.deepEqual(paints.slice(0, 6).map(stops => Number(stops[0].color.match(/hsla\((\d+)/)[1])), [188, 205, 188, 28, 205, 188]);
  for (const stops of paints) {
    assert.deepEqual(stops.map(stop => stop.offset), [0, .28, .52, .78, 1]);
    assert.match(stops[0].color, / 18% /, "Highlights should be silver-tinted, not saturated rainbow bands");
    assert(stops.every(stop => {
      const alpha = Number(stop.color.match(/\/ ([\d.]+)/)[1]);
      return alpha >= .18 && alpha <= .6;
    }));
  }
});

test("Aperture irises counter-rotate and respond independently to four frequency groups", () => {
  const view = renderer();
  const motion = updateGeneralMotion(view, .2);
  motion.bands.fill(0);
  motion.signal.level = .5;
  const snapshot = () => {
    const drawing = capture();
    const leaves = [];
    let tip;
    let paint;
    const context = new Proxy(drawing.context, {
      get: (target, name) => (...values) => {
        if (name === "moveTo") tip = values;
        if (name === "createLinearGradient") {
          paint = [];
          return { addColorStop: (offset, color) => paint.push([offset, color]) };
        }
        if (name === "fill" && paint) leaves.push({ tip, paint });
        return target[name](...values);
      }
    });
    drawGeneralScene(view, context, "aperture", 1440, 900, 720, 450);
    return [0, 6, 12, 18].map(index => leaves[index]);
  };
  const baseline = snapshot();
  for (const [layer, indices] of [[0, [0]], [1, [1, 2]], [2, [3, 4]], [3, [5]]]) {
    for (const index of indices) {
      motion.bands[index] = .25;
      const active = snapshot();
      for (let other = 0; other < 4; other++) {
        if (other === layer) {
          assert(Math.hypot(...active[other].tip) > Math.hypot(...baseline[other].tip) + 10);
          assert.notDeepEqual(active[other].paint, baseline[other].paint);
        } else assert.deepEqual(active[other], baseline[other], "Unrelated frequency groups must retain their shape and opacity");
      }
      assert.deepEqual(snapshot(), active, "Drawing must not advance a layer's response");
      motion.bands[index] = 0;
    }
  }
  motion.time += .5;
  const rotated = snapshot();
  for (let layer = 0; layer < 4; layer++) {
    const before = baseline[layer].tip;
    const after = rotated[layer].tip;
    const turn = Math.atan2(before[0] * after[1] - before[1] * after[0], before[0] * after[0] + before[1] * after[1]);
    assert.equal(Math.sign(turn), layer % 2 ? 1 : -1);
    assert(Math.abs(turn) > .03 && Math.abs(turn) < .08);
  }
});

test("Aperture retains geometric audio response when signed PCM cancels between frames", () => {
  const view = renderer();
  view.channels = [new Float32Array(256), new Float32Array(256)];
  view.signal = { low: 0, mid: 0, high: 0, level: 0 };
  const motion = updateGeneralMotion(view, 1);
  const fixedTime = motion.time;
  const silent = render(view, "aperture");
  for (let frame = 0; frame < 120; frame++) {
    view.channels[0].fill(frame % 2 ? -.5 : .5);
    view.channels[1].fill(frame % 2 ? .3 : -.3);
    updateGeneralMotion(view, 1 / 240);
  }
  motion.time = fixedTime;
  motion.channels.forEach(channel => channel.fill(0));
  const active = render(view, "aperture");
  assert(Math.max(...active.coordinates.map((value, index) => Math.abs(value - silent.coordinates[index]))) > 40);
  assert.deepEqual(render(view, "aperture"), active, "Crossfade drawing must not advance audio or geometry");
  view.channels.forEach(channel => channel.fill(0));
  updateGeneralMotion(view, 2);
  motion.time = fixedTime;
  const settled = render(view, "aperture");
  assert(Math.max(...settled.coordinates.map((value, index) => Math.abs(value - silent.coordinates[index]))) < .01);
});

test("Aperture moves on the first beat frame without waiting for free-running rotation", () => {
  const view = renderer();
  const motion = updateGeneralMotion(view, 1);
  const fixedTime = motion.time;
  const before = render(view, "aperture");
  updateGeneralMotion(view, 1 / 60, { beat: true, strongBeat: true });
  motion.time = fixedTime;
  const after = render(view, "aperture");
  assert(Math.max(...after.coordinates.map((value, index) => Math.abs(value - before.coordinates[index]))) > 40);
});

test("Copper uses one smooth gradient per bar at every detail level", () => {
  for (const quality of [.25, 1]) {
    const view = Object.assign(renderer(), { quality });
    const drawing = capture();
    let gradients = 0;
    let rectangles = 0;
    const context = new Proxy(drawing.context, {
      get: (target, name) => {
        if (name === "createLinearGradient") return (...args) => { gradients++; return target.createLinearGradient(...args); };
        if (name === "fillRect") return (...args) => { rectangles++; return target.fillRect(...args); };
        return target[name];
      }
    });
    view.drawScene(context, "copper", 1440, 900, 720, 450);
    assert.equal(gradients, 9);
    assert.equal(rectangles, 9, "Bars must not split into flat raster strips");
  }
});

test("waveform-driven shaders upload signed stereo without changing shared samples", () => {
  const gpu = Object.assign(Object.create(ShaderScenes.prototype), { waveform: new Float32Array(WAVEFORM_POINTS * 2), waveformTexture: {} });
  const left = Float32Array.from({ length: 96 }, (_, index) => Math.sin(index / 95 * Math.PI * 4) * .5);
  const right = Float32Array.from(left, value => -value);
  const original = [...left];
  const storage = gpu.waveform;
  gpu.updateWaveform([left, right]);
  assert(gpu.waveform.some(value => value > .5));
  assert(gpu.waveform.some(value => value < -.5));
  for (let point = 0; point < WAVEFORM_POINTS; point++) assert.equal(gpu.waveform[point * 2], -gpu.waveform[point * 2 + 1]);
  assert.deepEqual([...left], original);
  const first = [...gpu.waveform];
  gpu.updateWaveform([left, right]);
  assert.deepEqual([...gpu.waveform], first);
  assert.equal(gpu.waveform, storage);
  gpu.updateWaveform([left]);
  for (let point = 0; point < WAVEFORM_POINTS; point++) assert.equal(gpu.waveform[point * 2], gpu.waveform[point * 2 + 1]);
  gpu.updateWaveform([new Float32Array([NaN, Infinity, -20, 20])]);
  assert(gpu.waveform.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  gpu.updateWaveform([]);
  assert(gpu.waveform.every(value => value === 0));
  assert.equal(gpu.waveformTexture.needsUpdate, true);
});

test("spatial waveform filtering removes fine serrations while retaining broad stereo shapes", () => {
  const gpu = Object.assign(Object.create(ShaderScenes.prototype), { waveform: new Float32Array(WAVEFORM_POINTS * 2), waveformTexture: {} });
  const broad = Float32Array.from({ length: WAVEFORM_POINTS }, (_, index) => Math.sin(index / WAVEFORM_POINTS * Math.PI * 4) * .5);
  const fine = Float32Array.from({ length: WAVEFORM_POINTS }, (_, index) => index % 2 ? -.5 : .5);
  gpu.updateWaveform([broad, fine]);
  const storage = gpu.waveformSource;
  assert(gpu.waveform[64] > .7, "Broad waveform crests must remain visible");
  for (let point = 20; point < WAVEFORM_POINTS - 20; point++) assert(Math.abs(gpu.waveform[point * 2 + 1]) < .02);
  gpu.updateWaveform([new Float32Array(WAVEFORM_POINTS).fill(.25)]);
  assert.equal(gpu.waveformSource, storage);
  assert(gpu.waveform.every(value => Math.abs(value - 1 / 1.75) < 1e-6), "Smoothing must preserve constant displacement and duplicate mono");
});

test("fresh waveform textures preserve peaks between old sample points", () => {
  const view = renderer();
  const samples = new Float32Array(1024);
  samples[513] = -.8;
  view.channels = [samples];
  updateGeneralMotion(view, 1 / 240);
  assert.equal(view.generalMotion.traceChannels[0][128], samples[513]);
  assert(view.generalMotion.channels[0].every(value => value === 0), "The transient falls between the smoothed geometry samples");
  const gpu = Object.assign(Object.create(ShaderScenes.prototype), { waveform: new Float32Array(WAVEFORM_POINTS * 2), waveformTexture: {} });
  gpu.updateWaveform(view.generalMotion.traceChannels);
  assert(gpu.waveform[256] < -.05 && gpu.waveform[256] > -.8);
  assert(gpu.waveform[240] < 0 && gpu.waveform[272] < 0, "Fine peaks must spread into smooth relief rather than narrow ridges");
  assert.equal(samples[513], Math.fround(-.8));
});

test("flight sky follows unit-length solar and lunar paths through day and night", () => {
  const buffer = new Float64Array(6);
  const heights = [];
  for (let time = 0; time <= 1200; time += 60) {
    assert.equal(flightSkyDirections(time, .4, buffer), buffer);
    assert(Math.abs(Math.hypot(...buffer.subarray(0, 3)) - 1) < 1e-12);
    assert(Math.abs(Math.hypot(...buffer.subarray(3)) - 1) < 1e-12);
    heights.push(buffer[1]);
    const previous = [...buffer];
    flightSkyDirections(time + 1 / 120, .4, buffer);
    assert(buffer.every((value, index) => Math.abs(value - previous[index]) < .0001));
  }
  assert(Math.min(...heights) < -.3 && Math.max(...heights) > .8);
  const first = flightSkyDirections(0, .4);
  const later = flightSkyDirections(1200, .4);
  assert(Math.hypot(...first.subarray(3).map((value, index) => value - later[index + 3])) > .1, "The Moon must have its own orbital motion");
  assert.deepEqual(flightSkyDirections(12, .4), flightSkyDirections(12, .4));
});

test("terrain, twister and Foundry refresh waveform uniforms on each draw", () => {
  const gpu = Object.assign(Object.create(ShaderScenes.prototype), {
    waveform: new Float32Array(WAVEFORM_POINTS * 2), waveformTexture: {}, mesh: {}, materials: [{}, {}, {}, {}],
    renderer: {
      domElement: { width: 1440, height: 900 },
      getContext: () => ({ isContextLost: () => false }), render() {}
    },
    uniforms: {
      resolution: { value: { set() {} } }, clock: {}, flightClock: {}, seed: {}, terrainMap: {},
      audio: { value: { set() {} } }, cameraAudio: { value: { set() {} } }, impact: {}, detail: {}, beaconPulse: {},
      pigmentFlow: { value: { set() {} } }, pigmentSpectrum: { value: { set() {} } }, terrainAudio: { value: { set() {} } },
      sunDirection: { value: { set() {} } }, moonDirection: { value: { set() {} } },
      composition: { value: new Vector4() }, foundryBodies: { value: Array.from({ length: 6 }, () => new Vector4()) }
    }
  });
  const state = { time: 12, signal: renderer().signal, channels: [new Float32Array(96)], traceChannels: [new Float32Array([.5, -.5])] };
  const cameraUploads = [];
  gpu.texture = { name: "original" };
  gpu.mountainTexture = { name: "smooth" };
  gpu.uniforms.cameraAudio.value.set = (...values) => cameraUploads.push(values);
  for (const scene of ["raster-twist", "voxel-flight", "metaball-foundry"]) {
    gpu.waveform.fill(0);
    assert.equal(gpu.draw({ drawImage() {} }, scene, 1440, 900, state, .4, 1), true);
    assert.equal(gpu.uniforms.terrainMap.value, scene === "voxel-flight" ? gpu.mountainTexture : gpu.texture);
    assert(gpu.waveform[0] > .5, scene);
    assert(gpu.waveform[(WAVEFORM_POINTS - 1) * 2] < -.5, scene);
    gpu.draw({ drawImage() {} }, scene, 1440, 900, { ...state, channels: [], traceChannels: [] }, .4, 1);
    assert(gpu.waveform.every(value => value === 0), `${scene} must not retain another scene's waveform`);
    const eased = new Float64Array(WAVEFORM_POINTS).fill(.2);
    gpu.draw({ drawImage() {} }, scene, 1440, 900, { ...state, shaderWaveform: { channels: [eased] } }, .4, 1);
    assert(gpu.waveform.every(value => Math.abs(value - .5) < 1e-6), `${scene} must prefer the eased waveform over raw snapshots`);
    assert(eased.every(value => value === .2), "Crossfade draws cannot mutate the waveform envelope");
  }
  for (const [pulse, expected] of [[1, 1], [.25, .25], [-1, 0], [2, 1], [NaN, 0], [undefined, 0]]) {
    gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, state, .4, 1, pulse);
    assert.equal(gpu.uniforms.beaconPulse.value, expected);
  }
  const sunUploads = [];
  const moonUploads = [];
  gpu.uniforms.sunDirection.value.set = (...values) => sunUploads.push(values);
  gpu.uniforms.moonDirection.value.set = (...values) => moonUploads.push(values);
  gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, state, .4, 1, 1, 7);
  assert.equal(gpu.uniforms.flightClock.value, 7);
  assert.equal(gpu.uniforms.clock.value, state.time);
  const expectedSky = flightSkyDirections(7, .4);
  assert.deepEqual(sunUploads.at(-1), [...expectedSky.subarray(0, 3)]);
  assert.deepEqual(moonUploads.at(-1), [...expectedSky.subarray(3)]);
  gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, { ...state, time: 999, signal: { low: 1, mid: 1, high: 1, level: 1 } }, .4, 1, 0, 7);
  assert.deepEqual(sunUploads.at(-1), [...expectedSky.subarray(0, 3)], "Music-driven time and energy must not move the Sun");
  assert.deepEqual(moonUploads.at(-1), [...expectedSky.subarray(3)]);
  const flight = { values: new Float64Array([.5, .2, .1, -.6]) };
  const before = [...flight.values];
  gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, { ...state, flight }, .4, 1);
  assert.deepEqual(cameraUploads.at(-1), before);
  assert.deepEqual([...flight.values], before, "Drawing cannot advance camera smoothing");
  gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, state, .4, 1);
  assert.deepEqual(cameraUploads.at(-1), [0, 0, 0, 0]);
  const colorUploads = [];
  gpu.uniforms.audio.value.set = (...values) => colorUploads.push(values);
  for (const values of [[.8, 0, 0, .7], [0, .8, 0, .7], [0, 0, .8, .7], [1, 1, 1, 1], [0, 0, 0, 0]]) {
    const signal = Object.freeze(Object.fromEntries(["low", "mid", "high", "level"].map((key, index) => [key, values[index]])));
    gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, { ...state, signal }, .4, 1);
    assert.deepEqual(colorUploads.at(-1), values, "Terrain pigments must receive each current band and silence without stale values");
    assert.equal(gpu.uniforms.flightClock.value, state.time, "Color changes cannot advance the flight clock");
  }
  const flowUploads = [];
  const spectrumUploads = [];
  gpu.uniforms.pigmentFlow.value.set = (...values) => flowUploads.push(values);
  gpu.uniforms.pigmentSpectrum.value.set = (...values) => spectrumUploads.push(values);
  const pigmentFlow = new Float64Array([1, 2, 3]);
  const bands = Object.freeze([.125, .125, .25, .25, .125, .125]);
  for (let draw = 0; draw < 2; draw++) {
    gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, { ...state, pigmentFlow, bands }, .4, 1);
    assert.deepEqual(flowUploads.at(-1), [1, 2, 3]);
    assert.deepEqual(spectrumUploads.at(-1), [.25, .5, .25]);
    assert.deepEqual([...pigmentFlow], [1, 2, 3], "Crossfade draws cannot advance color currents");
  }
  gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, state, .4, 1);
  assert.deepEqual(flowUploads.at(-1), [0, 0, 0]);
  assert.deepEqual(spectrumUploads.at(-1), [state.signal.low, state.signal.mid, state.signal.high]);
  const terrainUploads = [];
  gpu.uniforms.terrainAudio.value.set = (...values) => terrainUploads.push(values);
  const terrain = { values: new Float64Array([.4, .6, .2, .8]) };
  for (let draw = 0; draw < 2; draw++) {
    gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, { ...state, terrain }, .4, 1);
    assert.deepEqual(terrainUploads.at(-1), [.4, .6, .2, .8]);
    assert.deepEqual([...terrain.values], [.4, .6, .2, .8], "Rendering cannot advance terrain deformation");
  }
  gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, { ...state, terrain: { values: [-1, 3, 5, 4] } }, .4, 1);
  assert.deepEqual(terrainUploads.at(-1), [0, 1, 1, 1.2], "Shape uploads must stay inside the camera-clearance bounds");
  gpu.draw({ drawImage() {} }, "voxel-flight", 1440, 900, state, .4, 1);
  assert.deepEqual(terrainUploads.at(-1), [state.signal.low, state.signal.mid, state.signal.high, 0]);
});

test("Voxel Flight's terrain shape uses signed stereo rather than generic band-driven pulses", async () => {
  const source = await readFile(new URL("../demo/shader-scenes.js", import.meta.url), "utf8");
  const geometry = source.slice(source.indexOf("float mountainMass("), source.indexOf("const float flightRange"));
  assert.match(geometry, /return pow\(coarse, 2\.2\) \* 93\.2;/, "The noise field remains a static clearance envelope");
  assert.match(geometry, /vec2 along = waveAt\(/);
  assert.match(geometry, /vec2 across = waveAt\(/);
  assert.match(geometry, /crest = clamp\(\.5 \+ along\.x \* \.3 \+ across\.y \* \.2, 0\.0, 1\.0\)/);
  assert.match(geometry, /separation = abs\(along\.x - across\.y\)/);
  assert.match(geometry, /ridges = mass \* \(\.18 \+ crest \* \.82\)/, "Waveforms must control the main relief, not a small surface ripple");
  assert.match(geometry, /- separation \* 9\.0/);
  assert.doesNotMatch(geometry, /terrainAudio|pigmentFlow|flightClock|impact|audio\./, "Band or beat changes alone must not pump the ground");
  assert.match(source, /vec3 color = sky\(direction, true\)/);
  assert.match(source, /color = mix\(sky\(direction, false\), color, visibility\)/, "Terrain fog must not reveal sun, moon or stars through the ground");
  assert.match(source, /float shade = terrainShadow\(point, normal, dominantLight\)/);
  assert.doesNotMatch(source, /float altitude = max\(direction.y, 0.0\)/, "Sky must not have a hard horizon crease");
  assert.match(source, /star \* \(\.22 \+ \.95 \* \(1.0 - daylight\)\)/, "Stylized stars remain visible during daylight");
  assert.match(source, /cone \* clear \* exp/, "The brighter beam must still respect terrain shadows");
  assert.match(source, /\(float\(beamIndex\) \+ jitter\)/, "Volume samples must not form coherent overlapping planes");
});

test("flight clearance map smooths peaks while conservatively covering terrain and wrapped edges", () => {
  const size = 512;
  const data = new Uint16Array(size * size * 4).fill(DataUtils.toHalfFloat(.15));
  for (const [column, row] of [[0, 0], [511, 511], [252, 256], [126, 384]]) {
    data[(row * size + column) * 4] = DataUtils.toHalfFloat(1);
  }
  const before = data.slice();
  const texture = createFlightHeightTexture({ image: { width: size, data } });
  try {
    assert.deepEqual(data, before);
    assert.equal(texture.wrapS, RepeatWrapping);
    assert.equal(texture.wrapT, RepeatWrapping);
    assert.equal(texture.magFilter, LinearFilter);
    const heightAt = (column, row) => DataUtils.fromHalfFloat(texture.image.data[
      (((row + 128) % 128) * 128 + (column + 128) % 128) * 4]);
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const horizontal = (column + .5) / 4 - .5;
        const vertical = (row + .5) / 4 - .5;
        const left = Math.floor(horizontal);
        const top = Math.floor(vertical);
        let lowerBound = Infinity;
        for (let offsetY = -1; offsetY <= 2; offsetY++) {
          for (let offsetX = -1; offsetX <= 2; offsetX++) {
            lowerBound = Math.min(lowerBound, heightAt(left + offsetX, top + offsetY));
          }
        }
        const mountain = Math.pow(DataUtils.fromHalfFloat(data[(row * size + column) * 4]), 2.2) * 93.2;
        assert(lowerBound + .08 >= mountain, `Clearance at ${column},${row}`);
      }
    }
    let largestStep = 0;
    for (let row = 0; row < 128; row++) {
      for (let column = 0; column < 128; column++) {
        largestStep = Math.max(largestStep, Math.abs(heightAt(column, row) - heightAt(column + 1, row)),
          Math.abs(heightAt(column, row) - heightAt(column, row + 1)));
      }
    }
    assert(largestStep < 24, "A sharp peak must not become a sudden camera-height step");
  } finally {
    texture.dispose();
  }
});

test("Voxel beacon shares the exact strobe envelope without advancing scene state", () => {
  const view = renderer();
  const motion = updateGeneralMotion(view, .1);
  const pulses = [];
  view.prepareShaderScenes = () => true;
  view.shaderScenes = { draw: (...args) => {
    assert.equal(args[4], motion);
    assert.equal(args[8], view.elapsed, "Flight must use elapsed time, not the music-driven clock");
    pulses.push(args[7]);
    return true;
  } };
  const draw = () => view.drawShaderScene({}, "voxel-flight", 1440, 900, .4);
  view.setStrobeEnabled(true);
  view.updateStrobe(1 / 60, { beat: true });
  draw();
  draw();
  view.updateStrobe(.08);
  draw();
  view.updateStrobe(.08);
  draw();
  assert.deepEqual(pulses, [1, 1, .25, 0]);
  view.updateStrobe(1 / 60, { beat: true });
  view.reducedMotion = true;
  draw();
  assert.equal(pulses.at(-1), 1);
  view.reducedMotion = false;
  view.setStrobeEnabled(false);
  draw();
  assert.equal(pulses.at(-1), 0);
});

test("GPU scene resources are released with the visualizer", () => {
  const view = renderer();
  let released = 0;
  view.stop = () => {};
  view.resizeObserver = { disconnect() {} };
  view.shaderScenes = { dispose: () => released++ };
  view.dispose();
  view.dispose();
  assert.equal(released, 1);
  assert.equal(view.shaderScenes, undefined);
  const resources = [];
  const gpu = Object.assign(Object.create(ShaderScenes.prototype), {
    materials: [{ dispose: () => resources.push("material") }],
    geometry: { dispose: () => resources.push("geometry") },
    texture: { dispose: () => resources.push("terrain") },
    mountainTexture: { dispose: () => resources.push("mountain") },
    flightTexture: { dispose: () => resources.push("flight") },
    waveformTexture: { dispose: () => resources.push("waveform") },
    renderer: { dispose: () => resources.push("renderer"), forceContextLoss: () => resources.push("context") }
  });
  gpu.dispose();
  assert.deepEqual(resources, ["material", "geometry", "terrain", "mountain", "flight", "waveform", "renderer", "context"]);
});

test("Dot Vortex occupies the portrait height even at minimum detail", () => {
  const view = Object.assign(renderer(), { quality: .25 });
  const result = render(view, "dot-vortex", 390, 844);
  const vertical = result.coordinates.filter((_, index) => index % 4 === 1);
  assert(Math.max(...vertical) - Math.min(...vertical) > 844 * .6);
  assert(result.points >= 250);
});

test("restored bars and thick vertically sweeping waves remain in the general deck", () => {
  assert(GENERAL_SCENES.includes("monolith"));
  assert(GENERAL_SCENES.includes("wavegarden"));
  const view = renderer();
  const bars = render(view, "monolith", 1920, 1080);
  assert.equal(bars.points, 19 * 2);
  for (let bar = 0; bar < 19; bar++) {
    const offset = bar * 8;
    const distance = Math.abs(bar - 9) / 9;
    assert(Math.abs(bars.coordinates[offset + 2] - 1920 * (.018 + (1 - distance) * .016)) < 1e-8);
    assert(Math.abs(bars.coordinates[offset + 1] + bars.coordinates[offset + 3] - 1080 * .32) < 1e-8);
    assert.equal(bars.coordinates[offset + 7], bars.coordinates[offset + 3] * .38);
  }
  const waves = render(view, "wavegarden", 1920, 1080);
  assert(waves.minimumWidth > 12);
  view.elapsed += 4;
  const moved = render(view, "wavegarden", 1920, 1080);
  let verticalTravel = 0;
  for (let index = 1; index < waves.coordinates.length; index += 2) {
    verticalTravel = Math.max(verticalTravel, Math.abs(moved.coordinates[index] - waves.coordinates[index]));
  }
  assert(verticalTravel > 10);
});

test("waveform-led scenes draw flat PCM flat and expose a localized audio transient", () => {
  for (const scene of ["helix", "wavegarden", "silk"]) {
    const view = renderer();
    view.channels = [new Float32Array(256), new Float32Array(256)];
    view.signal = { low: 0, mid: 0, high: 0, level: 0 };
    updateGeneralMotion(view, 1);
    const pathRanges = () => {
      const drawing = capture();
      const ranges = [];
      let ordinates = [];
      const context = new Proxy(drawing.context, {
        get: (target, name) => (...values) => {
          if (name === "beginPath") ordinates = [];
          if (["moveTo", "lineTo", "quadraticCurveTo"].includes(name)) {
            for (let index = 1; index < values.length; index += 2) ordinates.push(values[index]);
          }
          if (name === "stroke") ranges.push(Math.max(...ordinates) - Math.min(...ordinates));
          return target[name](...values);
        }
      });
      view.drawScene(context, scene, 1440, 900, 720, 450);
      return ranges;
    };
    assert(pathRanges().every(range => range < 1e-9), `${scene} must not invent sine waves for flat input`);
    view.channels[0].fill(.8, 80, 100);
    view.channels[1].fill(-.5, 140, 166);
    updateGeneralMotion(view, .5);
    assert(Math.max(...pathRanges()) > 40, `${scene} must display a real PCM transient after easing`);
    const before = render(view, scene);
    view.channels[0].fill(0);
    assert.deepEqual(render(view, scene), before, "Drawing must read the shared snapshot, not mutable source buffers");
  }
});

test("Silk filters dense detail, preserves stereo and reads eased snapshots without advancing them", () => {
  const view = renderer();
  view.channels = [Float32Array.from({ length: 256 }, (_, index) => Math.sin(index * .025) * .5 + Math.sin(index * 1.9) * .15)];
  view.channels.push(Float32Array.from(view.channels[0], value => -value * .5));
  updateGeneralMotion(view, 1);
  const state = view.generalMotion.shaderWaveform;
  const original = state.channels.map(channel => [...channel]);
  const before = render(view, "silk");
  const storage = view.curveWaveform[0];
  for (let index = 16; index < 240; index++) {
    assert(Math.abs(storage[index] - Math.sin(index * .025) * .5) < .012);
    assert(Math.abs(view.curveWaveform[1][index] + storage[index] * .5) < 1e-10);
  }
  view.generalMotion.traceChannels.forEach(channel => channel.fill(1));
  assert.deepEqual(render(view, "silk"), before, "Raw phase jumps cannot change Silk between motion updates");
  assert.equal(view.curveWaveform[0], storage);
  assert.deepEqual(state.channels.map(channel => [...channel]), original);
  view.channels = [];
  updateGeneralMotion(view, 2);
  render(view, "silk");
  assert(view.curveWaveform.every(channel => channel.every(value => Math.abs(value) < .001)));
});

test("Wavegarden, Helix and Terrain read eased stereo without raw phase jumps or draw-time integration", () => {
  for (const scene of ["wavegarden", "helix", "terrain"]) {
    const view = renderer();
    updateGeneralMotion(view, .5);
    const state = view.generalMotion.shaderWaveform;
    const original = state.channels.map(channel => [...channel]);
    const before = render(view, scene);
    view.generalMotion.traceChannels.forEach(channel => channel.fill(1));
    assert.deepEqual(render(view, scene), before, scene);
    assert.deepEqual(state.channels.map(channel => [...channel]), original);
    state.channels[0].fill(.7);
    assert.notDeepEqual(render(view, scene).coordinates, before.coordinates, `${scene} retains signed stereo response`);
  }
});

test("Silk strand thickness stays below sample spacing at desktop, portrait and high DPI", () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const resolution of [1, 2, 3]) {
      for (const quality of [.25, 1]) {
        const view = Object.assign(renderer(), { quality, canvas: { clientWidth: width } });
        const result = render(view, "silk", width * resolution, height * resolution);
        assert(result.minimumWidth > 0);
        assert(result.minimumWidth <= width * resolution * 1.12 / 160 * .45 + 1e-9);
        assert(result.curves > 0);
      }
    }
  }
});

test("helix connects the actual opposing stereo waveforms with 26 full-width rungs", () => {
  assert(GENERAL_SCENES.includes("helix"));
  const view = renderer();
  view.channels = [new Float32Array(256).fill(.4), new Float32Array(256).fill(-.2)];
  const drawing = capture();
  const paths = [];
  let path;
  const context = new Proxy(drawing.context, {
    get: (target, name) => (...values) => {
      if (name === "beginPath") path = [];
      if (["moveTo", "lineTo"].includes(name)) path.push(values);
      if (name === "stroke") paths.push(path);
      return target[name](...values);
    }
  });
  view.drawScene(context, "helix", 1920, 1080, 960, 540);
  assert.equal(paths.length, 28);
  assert(drawing.result().curves > 0);
  for (let rung = 0; rung <= 25; rung++) {
    const [first, second] = paths[rung + 2];
    const position = rung / 25;
    const amplitude = 1080 * (.3 + view.signal.low * .0675);
    assert.equal(first[0], position * 1920 - 960);
    assert.equal(second[0], first[0]);
    assert(Math.abs(first[1] - view.channels[0][0] * amplitude) < 1e-8);
    assert(Math.abs(second[1] + view.channels[1][0] * amplitude) < 1e-8);
  }
});

test("terrain energy contours survive alternating waveform polarity and fade to silence", () => {
  const view = renderer();
  const samples = new Float32Array(256).fill(.3);
  view.channels = [samples];
  for (let frame = 0; frame < 120; frame++) {
    samples.fill(frame % 2 ? -.3 : .3);
    updateGeneralMotion(view, 1 / 60);
  }
  assert(Math.abs(view.generalMotion.channels[0][48]) < .02);
  assert(view.generalMotion.energyChannels[0][48] > .29);
  assert.equal(view.generalMotion.bands.length, 6);
  view.channels = [];
  for (let frame = 0; frame < 120; frame++) updateGeneralMotion(view, 1 / 60);
  assert(view.generalMotion.energyChannels[0][48] < .001);
});

test("terrain ridges respond to independent audio features with time held fixed", () => {
  const ridgeCoordinates = view => {
    const values = [];
    const drawing = capture();
    const context = new Proxy(drawing.context, {
      get: (target, name) => name === "quadraticCurveTo" ? (...coordinates) => values.push(...coordinates) : target[name]
    });
    view.drawScene(context, "terrain", 1920, 1080, 960, 540);
    return values;
  };
  for (const feature of ["low", "mid", "high", "bands", "stereo", "impact"]) {
    const view = renderer();
    const motion = updateGeneralMotion(view, .4);
    const before = ridgeCoordinates(view);
    if (feature === "bands") motion.bands.fill(.5);
    else if (feature === "stereo") motion.energyChannels[1].fill(.8);
    else if (feature === "impact") motion.impact = 1;
    else motion.signal[feature] = 1;
    const after = ridgeCoordinates(view);
    const movement = Math.max(...after.map((value, index) => Math.abs(value - before[index])));
    assert(movement > 10, `${feature}: ${movement}px`);
    assert.deepEqual(ridgeCoordinates(view), after);
  }
});

test("terrain restores five full-width gradient surfaces extending to the floor", () => {
  assert(GENERAL_SCENES.includes("terrain"));
  const drawing = capture();
  let fills = 0;
  let gradients = 0;
  const context = new Proxy(drawing.context, {
    get: (target, name) => {
      if (name === "fill") return () => fills++;
      if (name === "createLinearGradient") return (...values) => {
        gradients++;
        assert.equal(values[3], 540);
        return target[name](...values);
      };
      return target[name];
    }
  });
  renderer().drawScene(context, "terrain", 1920, 1080, 960, 540);
  assert.equal(fills, 5);
  assert.equal(gradients, 5);
  assert(drawing.result().curves > 0);
  const coordinates = drawing.result().coordinates;
  assert(coordinates.includes(-960) && coordinates.includes(960));
});

test("terrain gradients start above every crest rather than clipping peaks to a flat color", () => {
  const view = renderer();
  view.channels = [new Float32Array(256).fill(.9)];
  view.signal = { low: .8, mid: 1, high: .5, level: 1 };
  updateGeneralMotion(view, 1);
  const paths = new CurveSceneGeometry();
  const createGradient = paths.createLinearGradient.bind(paths);
  let gradientTop;
  let layers = 0;
  paths.createLinearGradient = (...coordinates) => {
    gradientTop = paths.point(coordinates[0], coordinates[1]).y;
    return createGradient(...coordinates);
  };
  paths.fill = () => {
    const ridge = paths.path.slice(0, -2);
    assert(gradientTop <= Math.min(...ridge.map(point => point.y)) + 1e-8);
    layers++;
  };
  paths.stroke = () => {};
  paths.begin({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  drawGeneralScene(view, paths, "terrain", 2048, 576, 1024, 288);
  assert.equal(layers, 5);
});

test("terrain fill closures stay below low valleys and outside the moving camera", () => {
  for (const [width, height] of [[1440, 900], [390, 844], [3200, 900]]) {
    const view = renderer();
    view.channels = [new Float32Array(256).fill(-1)];
    view.signal = { low: 0, mid: 0, high: 0, level: 0 };
    view.tone.bands.fill(0);
    const motion = updateGeneralMotion(view, 1);
    motion.energyChannels.forEach(channel => channel.fill(0));
    const paths = new CurveSceneGeometry();
    const fill = paths.fill.bind(paths);
    let layers = 0;
    paths.fill = () => {
      const ridge = paths.path.slice(0, -2);
      const [lowerRight, lowerLeft] = paths.path.slice(-2);
      assert(lowerRight.y > Math.max(...ridge.map(point => point.y)), "A valley cannot cross the polygon's closing edge");
      assert.equal(lowerRight.y, lowerLeft.y);
      assert(lowerLeft.x < -width * .06 && lowerRight.x > width * 1.06, "Camera sway must not reveal vertical sides");
      assert(lowerLeft.y > height * 1.06, "Camera sway must not reveal a horizontal floor edge");
      layers++;
      fill();
    };
    paths.begin({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    drawGeneralScene(view, paths, "terrain", width, height, width / 2, height / 2);
    assert.equal(layers, 5);
  }
});

test("terrain includes bounded traveling streaks without advancing state during a crossfade", () => {
  const view = renderer();
  let strokes = 0;
  const drawing = capture();
  const context = new Proxy(drawing.context, {
    get: (target, name) => name === "stroke" ? () => strokes++ : target[name]
  });
  view.drawScene(context, "terrain", 1920, 1080, 960, 540);
  assert(strokes > 10 && strokes <= 64);
  const first = render(view, "terrain");
  assert.deepEqual(render(view, "terrain"), first);
  view.elapsed += .1;
  assert.notEqual(render(view, "terrain").signature, first.signature);
  view.quality = .25;
  strokes = 0;
  view.drawScene(context, "terrain", 1920, 1080, 960, 540);
  assert(strokes > 0 && strokes <= 18);
});

test("prism uses the SID crystal's four-point translucent facets and fine straight edges", () => {
  const view = renderer();
  const drawing = capture();
  const settings = {};
  let fills = 0;
  let vertices = 0;
  const context = new Proxy(drawing.context, {
    get: (target, name) => (...values) => {
      if (name === "beginPath") vertices = 0;
      if (["moveTo", "lineTo"].includes(name)) vertices++;
      if (name === "fill") { fills++; assert.equal(vertices, 4); }
      if (["arc", "quadraticCurveTo", "bezierCurveTo"].includes(name)) assert.fail(name);
      return target[name](...values);
    },
    set: (target, name, value) => { settings[name] = value; target[name] = value; return true; }
  });
  view.drawScene(context, "prism", 1920, 1080, 960, 540);
  assert.equal(fills, 12 * 9);
  assert.equal(settings.lineWidth, 1080 * .0015);
  assert.equal(settings.lineJoin, "miter");
  assert.equal(settings.lineCap, "butt");
});

test("diffraction draws only flowing fans without a central polygon", () => {
  const drawing = capture();
  const context = new Proxy(drawing.context, {
    get: (target, name) => ["closePath", "lineTo"].includes(name)
      ? () => assert.fail(`Unexpected diffraction ornament: ${name}`)
      : target[name]
  });
  renderer().drawScene(context, "diffraction", 1920, 1080, 960, 540);
  assert(drawing.result().curves > 0);
});

test("Interference and Weave close every spline with matching endpoints and tangents", () => {
  for (const scene of ["interference", "weave"]) {
    for (const quality of [.25, 1]) {
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        const view = renderer();
        view.quality = quality;
        view.channels = [Float32Array.from({ length: 96 }, (_, index) => index / 95 * 2 - 1)];
        const drawing = capture();
        let start;
        let firstCurve;
        let lastCurve;
        let closed = false;
        let loops = 0;
        const context = new Proxy(drawing.context, {
          get: (target, name) => (...values) => {
            if (name === "beginPath") { start = undefined; firstCurve = undefined; lastCurve = undefined; closed = false; }
            if (name === "moveTo") { assert.equal(start, undefined); start = values; }
            if (name === "quadraticCurveTo") { firstCurve ??= values; lastCurve = values; }
            if (name === "lineTo") assert.fail(`${scene} must not close with a straight segment`);
            if (name === "closePath") {
              assert.deepEqual(lastCurve.slice(2), start);
              for (let axis = 0; axis < 2; axis++) {
                const outgoing = firstCurve[axis] - start[axis];
                const incoming = start[axis] - lastCurve[axis];
                assert(Math.abs(outgoing - incoming) < 1e-9, `${scene} tangent discontinuity`);
              }
              closed = true;
              loops++;
            }
            if (name === "stroke") assert(closed, `${scene} must be closed before stroking`);
            return target[name](...values);
          }
        });
        view.drawScene(context, scene, width, height, width / 2, height / 2);
        assert(loops >= 6);
        assert.equal(drawing.result().depth, 0);
      }
    }
  }
});

test("non-SID playback opens on the filled Terrain scene and keeps every other scene in rotation", () => {
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  try {
    const view = new ImmersiveVisualizer({ dataset: {}, getContext: () => ({}) });
    assert.equal(view.scene, "terrain");
    assert.equal(view.previousScene, "terrain");
    assert.equal(view.canvas.dataset.scene, "terrain");
    assert.equal(view.sceneDeck.length, GENERAL_SCENES.length - 1);
    assert(!view.sceneDeck.includes("terrain"));
    view.sidSceneMode = true;
    view.directScene(0);
    assert.equal(view.scene, "terrain");
    assert.equal(new Set([view.scene, ...view.sceneDeck]).size, GENERAL_SCENES.length);
  } finally {
    if (originalObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalObserver;
  }
});

test("general director visits every replacement and never enters the retired scene deck", () => {
  const view = Object.assign(renderer(), {
    canvas: { dataset: {} }, camera: { phase: 0 }, transitionDuration: 1,
    music: { beatInterval: .5, toneFast: [], toneCentroidFast: .5 }
  });
  view.directScene(0);
  const visited = new Set([view.scene]);
  for (let change = 0; change < GENERAL_SCENES.length - 1; change++) {
    view.directScene(view.sceneDuration + 4);
    assert(GENERAL_SCENES.includes(view.scene));
    visited.add(view.scene);
  }
  assert.equal(visited.size, GENERAL_SCENES.length);
});

test("manual scene navigation wraps both decks, resets holds and supports paused SID", () => {
  for (const sidState of [undefined, { playing: true }, { playing: false }]) {
    const view = Object.assign(renderer(), {
      canvas: { dataset: {} }, camera: { phase: 0 }, transitionDuration: 1,
      music: { beatInterval: .5, toneFast: [], toneCentroidFast: .5 },
      getSidState: () => sidState
    });
    view.directScene(0, {}, sidState);
    const initial = view.scene;
    const visited = new Set();
    const count = sidState ? 8 : GENERAL_SCENES.length;
    for (let index = 0; index < count; index++) {
      const previous = view.scene;
      const previousSeed = view.sceneSeed;
      view.stepScene(1);
      assert.equal(view.previousScene, previous);
      assert.equal(view.previousSceneSeed, previousSeed);
      assert.equal(view.sceneElapsed, 0);
      assert.equal(view.sceneDuration, view.scene === "voxel-flight" ? 60 : ["metaball-foundry", "particle-assembly"].includes(view.scene) ? 36 : 20);
      assert.equal(view.sceneTransition, 1, "Manual selection must show the selected effect without an outgoing crossfade");
      assert.equal(view.canvas.dataset.scene, view.scene);
      assert.equal(view.canvas.dataset.transitionReason, "keyboard-next");
      assert(!view.sceneDeck.includes(view.scene));
      visited.add(view.scene);
    }
    assert.equal(visited.size, count);
    assert.equal(view.scene, initial);
    view.stepScene(-1);
    assert.notEqual(view.scene, initial);
    assert.equal(view.canvas.dataset.transitionReason, "keyboard-previous");
    view.stepScene(1);
    assert.equal(view.scene, initial);
    view.directScene(.1, { beat: true, strongBeat: true }, sidState);
    assert.equal(view.scene, initial, "Automatic transitions must honor the restarted hold");
  }
});

test("all scene changes respect a persistent hold before musical transitions", () => {
  for (const sidState of [undefined, { playing: true }]) {
    for (const reason of ["returnFromDrop", "toneBoundary", "phraseBoundary", "sectionBoundary", "strongBeat", "beat"]) {
      const view = Object.assign(renderer(), {
        canvas: { dataset: {} }, camera: { phase: 0 }, transitionDuration: 1,
        music: { beatInterval: .5, toneFast: [], toneCentroidFast: .5 }
      });
      view.directScene(0, {}, sidState);
      for (let change = 0; change < 3; change++) {
        const previous = view.scene;
        view.directScene(view.sceneDuration - .1, { [reason]: true }, sidState);
        assert.equal(view.scene, previous, reason);
        view.directScene(4.1, { [reason]: true }, sidState);
        assert.notEqual(view.scene, previous, reason);
        assert.equal(view.sceneDuration, view.scene === "voxel-flight" ? 60 : ["metaball-foundry", "particle-assembly"].includes(view.scene) ? 36 : 20);
      }
    }
  }
});

test("scene arcs reveal gradually, reserve peaks for strong cues and release before exit", () => {
  const view = Object.assign(renderer(), { scene: "metaball-foundry", sceneElapsed: 0, sceneDuration: 36 });
  view.updateSceneArc();
  assert.equal(view.sceneArc.phase, "arrival");
  assert.equal(view.sceneArc.reveal, 0);
  view.sceneElapsed = 14;
  view.elapsed = 14;
  view.updateSceneArc({ beat: true, strongBeat: true });
  assert.equal(view.sceneArc.phase, "development");
  assert.equal(view.sceneArc.peakAt, undefined);
  view.updateSceneArc({ strongBeat: true, phraseBoundary: true });
  assert.equal(view.sceneArc.peakAt, 14);
  view.sceneElapsed = 15;
  view.updateSceneArc();
  assert.equal(view.sceneArc.phase, "peak");
  assert.equal(view.sceneArc.climax, 1);
  view.sceneElapsed = 33;
  view.updateSceneArc({ returnFromDrop: true });
  assert.equal(view.sceneArc.phase, "release");
  assert(view.sceneArc.release > 0 && view.sceneArc.release < 1);
  assert.equal(view.sceneArc.peakAt, 14);
  view.sceneArc = undefined;
  view.sceneElapsed = 14;
  view.elapsed = 20;
  view.updateSceneArc({ returnFromDrop: true });
  assert.equal(view.sceneArc.peakAt, undefined, "A recent reveal must not repeat immediately");
  view.elapsed = 50;
  view.signal.level = 0;
  view.updateSceneArc({ returnFromDrop: true });
  assert.equal(view.sceneArc.peakAt, undefined, "Silence must not trigger a peak");
});

test("Foundry choreography is refresh-independent and preserves the outgoing arc", () => {
  const states = [];
  for (const rate of [30, 60, 120, 240]) {
    const view = Object.assign(renderer(), { scene: "metaball-foundry", sceneDuration: 36 });
    for (let frame = 0; frame <= rate * 36; frame++) {
      view.elapsed = view.sceneElapsed = frame / rate;
      view.updateSceneArc({ returnFromDrop: frame === rate * 14 });
    }
    states.push(structuredClone(view.sceneArc));
    const outgoing = view.sceneArc;
    view.sceneArc = undefined;
    view.sceneElapsed = 0;
    view.updateSceneArc();
    assert.deepEqual(outgoing, states.at(-1));
    assert.equal(view.sceneArc.reveal, 0);
  }
  for (const state of states) assert.deepEqual(state, states[0]);
  assert.equal(states[0].release, 1);
});

test("Voxel Flight stays featured for a full minute under continuous musical events", () => {
  for (const rate of [30, 60, 144, 240]) {
    const view = Object.assign(renderer(), {
      canvas: { dataset: {} }, camera: { phase: 0 }, transitionDuration: 1,
      music: { beatInterval: .5, toneFast: [], toneCentroidFast: .5 }
    });
    view.directScene(0);
    view.sceneDeck = ["voxel-flight", "silk"];
    view.directScene(24);
    assert.equal(view.scene, "voxel-flight");
    assert.equal(view.sceneElapsed, 0);
    assert.equal(view.sceneDuration, 60);
    const event = { beat: true, strongBeat: true, returnFromDrop: true, toneBoundary: true, phraseBoundary: true, sectionBoundary: true };
    for (let frame = 0; frame < 59 * rate; frame++) view.directScene(1 / rate, event);
    assert.equal(view.scene, "voxel-flight");
    view.directScene(1.01, event);
    assert.equal(view.scene, "silk");
    assert.equal(view.sceneDuration, 20);
    view.sceneDeck = ["voxel-flight", "silk"];
    view.directScene(24);
    view.directScene(63.9);
    assert.equal(view.scene, "voxel-flight", "Without musical events the flight must wait for its maximum hold");
    view.directScene(.2);
    assert.equal(view.scene, "silk");
  }
});

test("general crossfade keeps the outgoing seed and balances both scenes around the midpoint", () => {
  const drawing = capture();
  drawing.context.createRadialGradient = () => ({ addColorStop() {} });
  const calls = [];
  let starDraws = 0;
  const context = new Proxy(drawing.context, {
    get: (target, name) => name === "createRadialGradient" ? () => ({ addColorStop() {} }) : target[name]
  });
  const view = Object.assign(renderer(), {
    context, canvas: { width: 1440, height: 900 },
    pointer: { x: 0, y: 0 }, camera: { x: 0, y: 0, microX: 0, microY: 0, roll: 0, zoom: 1 },
    previousScene: "silk", scene: "aperture", previousSceneSeed: .8, sceneSeed: .2, sceneTransition: .5,
    drawStarfield: () => { assert.equal(calls.length, 0); starDraws++; },
    drawScene: (context, scene, width, height, centerX, centerY, seed) => calls.push([scene, seed, context.globalAlpha]), drawVignette() {}
  });
  view.paint(.016);
  assert.deepEqual(calls, [["silk", .8, .5], ["aperture", .2, .5]]);
  calls.length = 0;
  view.sceneTransition = 0;
  view.paint(.016);
  assert.deepEqual(calls, [["silk", .8, 1], ["aperture", .2, 0]]);
  calls.length = 0;
  view.sceneTransition = .9;
  view.paint(.016);
  assert.equal(calls.length, 2);
  assert(calls[0][2] > 0);
  assert.equal(starDraws, 3);
  view.canvas.dataset = {};
  view.camera.phase = 0;
  view.music = { beatInterval: .5, toneFast: [], toneCentroidFast: .5 };
  view.sidSceneMode = false;
  view.sceneDeck = [...GENERAL_SCENES];
  for (const scene of ["metaball-foundry", "particle-assembly", "feedback-bloom"]) {
    calls.length = 0;
    context.globalAlpha = 1;
    view.scene = GENERAL_SCENES[GENERAL_SCENES.indexOf(scene) - 1];
    view.stepScene(1);
    view.paint(.016);
    assert.deepEqual(calls, [[scene, view.sceneSeed, 1]], "The first manual frame must paint only the selected scene");
  }
});

test("starfield persists through scene changes and drawing never advances it", () => {
  const view = Object.assign(renderer(), {
    canvas: { dataset: {} }, camera: { phase: 0 }, transitionDuration: 1,
    music: { beatInterval: .5, toneFast: [], toneCentroidFast: .5 }
  });
  view.updateStarfield(1);
  const stars = view.starfield.stars;
  const time = view.starfield.time;
  view.directScene(0);
  view.directScene(24);
  assert.equal(view.sceneTransition, 0);
  assert.equal(view.transitionDuration, 1);
  assert.equal(view.starfield.stars, stars);
  assert.equal(view.starfield.time, time);
  for (const [width, height] of [[3840, 2160], [390, 844]]) {
    const drawing = capture();
    view.drawStarfield(drawing.context, width, height);
    view.drawStarfield(drawing.context, width, height);
    assert.equal(drawing.result().depth, 0);
    assert.equal(view.starfield.time, time);
  }
  view.updateStarfield(1, { playing: false });
  assert.equal(view.starfield.time, time);
  view.updateStarfield(1, { playing: true });
  assert(view.starfield.time > time);
  assert.equal(view.starfield.stars, stars);
  assert.equal(stars.length, 360);
  assert(stars.every((star) => star.size >= 1 && star.size <= 2.1));
});

test("strobe detects fresh attacks without a timed gap or sustained-tone retriggers", () => {
  for (const rate of [30, 60, 240]) {
    const view = renderer();
    view.setStrobeEnabled(true);
    const measure = level => ({ level, low: level, mid: level * .3, high: level * .15 });
    const hits = [];
    for (let frame = 0; frame < 30; frame++) {
      const hit = view.detectStrobeHit(measure(frame % 3 === 0 ? .5 : .05));
      view.updateStrobe(1 / rate, { beat: hit });
      if (hit) {
        hits.push(frame);
        assert.equal(view.strobe.opacity, .28);
      }
    }
    assert.deepEqual(hits, Array.from({ length: 10 }, (_, index) => index * 3));
    view.strobeOnset = undefined;
    assert.equal(view.detectStrobeHit(measure(0)), false);
    assert.equal(view.detectStrobeHit(measure(.01)), false, "Small rises must stay below the higher gate");
    assert.equal(view.detectStrobeHit(measure(0)), false);
    assert.equal(view.detectStrobeHit(measure(.15)), false, "Weak intro pulses must not flash");
    assert.equal(view.detectStrobeHit(measure(.4)), true);
    for (let frame = 0; frame < 100; frame++) assert.equal(view.detectStrobeHit(measure(.4)), false);
    assert.equal(view.detectStrobeHit(measure(0)), false);
    assert.equal(view.detectStrobeHit(measure(.02)), false, "Quiet fluctuations must not flash after sustained audio");
    for (let frame = 0; frame < 100; frame++) {
      assert.equal(view.detectStrobeHit(measure(frame % 2 ? .025 : 0)), false);
    }
    assert.equal(view.detectStrobeHit(measure(0)), false);
    assert.equal(view.detectStrobeHit(measure(.4)), true, "Clear attacks must still trigger immediately");
  }
});

test("strobe rejects weak intro pulses and non-bass-dominant filtered attacks", () => {
  const view = renderer();
  for (let pulse = 0; pulse < 20; pulse++) {
    assert.equal(view.detectStrobeHit({ low: .02, mid: 0, high: 0, bassRatio: 1 }), false);
    assert.equal(view.detectStrobeHit({ low: .2, mid: 0, high: 0, bassRatio: 1 }), false);
  }
  for (const bassRatio of [.1, .25, .5, .74]) {
    view.strobeOnset = undefined;
    assert.equal(view.detectStrobeHit({ low: .5, mid: 0, high: 0, bassRatio }), false);
  }
  view.strobeOnset = undefined;
  assert.equal(view.detectStrobeHit({ low: .5, mid: 0, high: 0, bassRatio: .8 }), true);
});

test("strobe follows attacks over continuing bass without retriggering one sustained hit", () => {
  const view = renderer();
  const measure = low => ({ low, mid: 0, high: 0, bassRatio: 1 });
  for (let pulse = 0; pulse < 10; pulse++) {
    for (let frame = 0; frame < 15; frame++) assert.equal(view.detectStrobeHit(measure(0)), false);
    assert.equal(view.detectStrobeHit(measure(.3)), true);
  }
  view.strobeOnset = undefined;
  assert.equal(view.detectStrobeHit(measure(.6)), true);
  for (let pulse = 0; pulse < 10; pulse++) {
    assert.equal(view.detectStrobeHit(measure(.4)), false);
    assert.equal(view.detectStrobeHit(measure(.6)), false, "Minor modulation must not repeat a sustained hit");
  }
  for (let frame = 0; frame < 15; frame++) assert.equal(view.detectStrobeHit(measure(.2)), false);
  assert.equal(view.detectStrobeHit(measure(.6)), true, "A distinct attack after bass subsides still fires");
  view.strobeOnset = undefined;
  for (let frame = 0; frame <= 120; frame++) {
    assert.equal(view.detectStrobeHit(measure(frame / 120 * .68)), false, "Gradual bass swells must not flash");
  }
});

test("strobe ringing tails must cross the baseline before another attack", () => {
  const view = renderer();
  const measure = low => ({ low, mid: 0, high: 0, bassRatio: .8 });
  assert.equal(view.detectStrobeHit(measure(.8), 1 / 144), true);
  assert.equal(view.detectStrobeHit(measure(.5), 1 / 144), false);
  assert.equal(view.detectStrobeHit(measure(.7), 1 / 144), false);
  assert.equal(view.strobeOnset.armed, false);
  for (let frame = 0; frame < 40; frame++) view.detectStrobeHit(measure(.12), 1 / 144);
  assert.equal(view.detectStrobeHit(measure(.7), 1 / 144), true);
});

test("strobe follows timed beats at 30-240 Hz over background bass", () => {
  for (const rate of [30, 60, 144, 240]) {
    for (const bpm of [90, 128, 174]) {
      const view = renderer();
      const interval = 60 / bpm;
      const hits = [];
      for (let frame = 0; frame < Math.ceil((.5 + interval * 8) * rate); frame++) {
        const time = frame / rate;
        const beat = Math.floor((time - .5) / interval);
        const phase = time - .5 - beat * interval;
        const envelope = time < .5 ? 0 : Math.min(1, phase / .012) * Math.exp(-Math.max(0, phase - .012) / .065);
        const low = .12 + envelope * .65;
        if (view.detectStrobeHit({ low, mid: 0, high: 0, bassRatio: .8 }, 1 / rate)) hits.push(time);
      }
      assert.equal(hits.length, 8, `${rate}Hz at ${bpm} BPM: ${hits}`);
      hits.forEach((time, beat) => assert(Math.abs(time - (.5 + beat * interval)) < .05, `${rate}Hz onset alignment`));
    }
  }
});

test("strobe follows bass beats under a steady full-band mix and above unity", () => {
  for (const rate of [30, 60, 144, 240]) {
    for (const bpm of [90, 128, 174]) {
      for (const [background, amplitude] of [[.12, .65], [.45, .55], [1.1, .8]]) {
        const view = renderer();
        const interval = 60 / bpm;
        const hits = [];
        for (let frame = 0; frame < Math.ceil((.5 + interval * 8) * rate); frame++) {
          const time = frame / rate;
          const beat = Math.floor((time - .5) / interval);
          const phase = time - .5 - beat * interval;
          const envelope = time < .5 ? 0 : Math.min(1, phase / .012) * Math.exp(-Math.max(0, phase - .012) / .065);
          const low = background + envelope * amplitude;
          const fullBand = Math.hypot(1.4, low);
          if (view.detectStrobeHit({ low, mid: 0, high: 0, fullBand, bassRatio: low / fullBand }, 1 / rate) && time >= .5) hits.push(time);
        }
        assert.equal(hits.length, 8, `${rate}Hz, ${bpm}BPM, bass bed ${background}: ${hits}`);
        hits.forEach((time, beat) => assert(Math.abs(time - (.5 + beat * interval)) < .05));
      }
    }
  }
});

test("signal smoothing has the same attack and release at every display rate", () => {
  const keys = ["level", "peak", "low", "mid", "high"];
  const results = [];
  for (const hz of [60, 120, 144, 240, 360]) {
    const view = renderer();
    view.signal = Object.fromEntries([...keys, "flux"].map(key => [key, 0]));
    view.previousSignal = { ...view.signal };
    const loud = Object.fromEntries(keys.map(key => [key, .8]));
    const quiet = Object.fromEntries(keys.map(key => [key, .1]));
    for (let frame = 0; frame < hz / 6; frame++) view.smoothSignal(loud, 1 / hz);
    const attack = { ...view.signal };
    for (let frame = 0; frame < hz / 6; frame++) view.smoothSignal(quiet, 1 / hz);
    results.push({ attack, release: { ...view.signal } });
  }
  for (const result of results) for (const phase of ["attack", "release"]) for (const key of keys) {
    assert(Math.abs(result[phase][key] - results[0][phase][key]) < 1e-12, `${phase}/${key}`);
  }
});

test("audio analysis preserves opposite-phase stereo and examines every captured sample", () => {
  const left = Float32Array.from({ length: 1024 }, (_, index) => Math.sin(index * .15) * .08);
  const inverted = Float32Array.from(left, value => -value);
  const measure = channels => {
    const view = renderer();
    Object.assign(view, { getSource: () => ({ sampleRate: 48000, readChannels: () => channels }),
      previousSignal: { low: 0, mid: 0, high: 0 }, music: { toneReady: false } });
    view.readSignal(1 / 120);
    return view;
  };
  const mono = measure([left]);
  const stereo = measure([left, inverted]);
  assert.deepEqual(stereo.measuredSignal, mono.measuredSignal);
  assert.deepEqual(stereo.tone, mono.tone);
  const impulse = new Float32Array(1024);
  impulse[513] = .5;
  assert(measure([impulse]).measuredSignal.level > 0, "Sparse 256-point reads must not miss an interleaved transient");
  const invalid = measure([new Float32Array([NaN, Infinity, -Infinity])]);
  assert(Object.values(invalid.measuredSignal).every(Number.isFinite));
});

test("module strobe does not promote quiet low-frequency PCM with visual gain", () => {
  const view = renderer();
  const source = { revision: 0, readChannels: () => [new Float32Array(256).fill(.02)] };
  Object.assign(view, {
    getSource: () => source, music: { toneReady: false },
    previousSignal: { level: 0, low: 0, mid: 0, high: 0 }
  });
  for (let pulse = 0; pulse < 10; pulse++) {
    for (const amplitude of [0, .02]) {
      source.revision++;
      source.readChannels = () => [new Float32Array(256).fill(amplitude)];
      view.readSignal();
      assert.equal(view.strobeHit, false);
    }
  }
  assert(view.measuredSignal.low > .22, "The waveform may remain visually responsive without flashing");
});

test("strobe requires bass attacks rather than midrange, treble or overall volume", () => {
  const view = renderer();
  assert.equal(view.detectStrobeHit({ low: .4, mid: 0, high: 0 }), true);
  assert.equal(view.detectStrobeHit({ low: .39, mid: 0, high: 0 }), false);
  assert.equal(view.detectStrobeHit({ low: .5, mid: 0, high: 0 }), false, "A ripple within the same bass hit must not re-arm the trigger");
  const quiet = { level: .08, low: .06, mid: .05, high: .04 };
  const reset = () => { view.strobeOnset = undefined; view.detectStrobeHit(quiet); };
  reset();
  assert.equal(view.detectStrobeHit({ level: .5, low: .08, mid: .2, high: .9 }), false, "Treble-led attacks must not flash");
  reset();
  view.detectStrobeHit({ level: .6, low: .6, mid: .3, high: .2 });
  view.detectStrobeHit({ level: .6, low: .6, mid: .3, high: .2 });
  assert.equal(view.detectStrobeHit({ level: .9, low: .6, mid: .9, high: .8 }), false, "Midrange and volume increases without bass attack must not flash");
  reset();
  for (let step = 1; step <= 30; step++) {
    const level = .08 + step * .02;
    assert.equal(view.detectStrobeHit({ level, low: level, mid: level, high: level * .5 }), false, "Gradual swells must not flash");
  }
  reset();
  assert.equal(view.detectStrobeHit({ level: .6, low: .4, mid: .7, high: .55 }), false, "Mid-led snare-like attacks must not flash");
  for (const impact of [
    { level: .6, low: .8, mid: .3, high: .15 },
    { level: .08, low: .5, mid: .1, high: .05 }
  ]) {
    reset();
    for (let hit = 0; hit < 8; hit++) {
      assert.equal(view.detectStrobeHit(impact), true, "Bass impacts must trigger without a cooldown or overall volume rise");
      assert.equal(view.detectStrobeHit(quiet), false);
    }
  }
});

test("strobe does not retrigger cached audio or synthesize hits without a source", () => {
  const view = renderer();
  const source = { revision: 1, readChannels: () => [new Float32Array(256).fill(.3)] };
  Object.assign(view, {
    getSource: () => source,
    previousSignal: { level: 0, low: 0, mid: 0, high: 0 },
    music: { toneReady: false }, signalSource: undefined
  });
  view.readSignal();
  assert.equal(view.strobeHit, true);
  const onset = view.strobeOnset;
  view.readSignal();
  assert.equal(view.strobeHit, false);
  assert.equal(view.strobeOnset, onset);
  source.revision++;
  view.readSignal();
  assert.equal(view.strobeHit, false);
  for (let frame = 0; frame < 12; frame++) {
    source.revision++;
    source.readChannels = () => [new Float32Array(256).fill(frame % 2 ? .3 : .001)];
    view.readSignal();
    assert.equal(view.strobeHit, Boolean(frame % 2), "Fresh PCM attacks must trigger without waiting for scene beats");
  }
  view.getSource = () => undefined;
  view.readSignal();
  assert.equal(view.strobeHit, false);
  assert.equal(view.strobeOnset, undefined);
  view.getSource = () => source;
  source.readChannels = () => [new Float32Array(256).fill(.5)];
  source.readBassEnergy = () => 0;
  source.revision++;
  view.readSignal();
  assert.equal(view.strobeHit, false, "Full-band audio cannot override a silent bass analyser");
  source.readBassEnergy = () => .5;
  source.readBassRatio = () => .2;
  source.revision++;
  view.readSignal();
  assert.equal(view.strobeHit, false, "Filtered leakage must not override the full-band reference");
  source.readBassEnergy = () => 0;
  source.revision++;
  view.readSignal();
  source.readBassEnergy = () => .5;
  source.readBassRatio = () => .95;
  source.revision++;
  view.readSignal();
  assert.equal(view.strobeHit, true, "Filtered bass must trigger without an overall level rise");
});

test("explicit strobe follows every detected beat even with reduced motion", () => {
  for (const rate of [30, 60, 240]) {
    const view = renderer();
    view.updateStrobe(1 / rate, { beat: true });
    assert.equal(view.strobe, undefined);
    assert.equal(view.setStrobeEnabled(true), true);
    const flashes = [];
    let peak = 0;
    for (let frame = 0; frame < rate * 5; frame++) {
      const previousFlash = view.strobe.lastFlashAt;
      view.updateStrobe(1 / rate, { beat: true });
      if (view.strobe.lastFlashAt !== previousFlash) {
        flashes.push(view.strobe.lastFlashAt);
        assert.equal(view.strobe.opacity, .28, "Flash must peak on the detected beat frame");
      }
      peak = Math.max(peak, view.strobe.opacity);
      assert(view.strobe.opacity >= 0 && view.strobe.opacity <= .28);
    }
    assert(peak > .25);
    assert.equal(flashes.length, rate * 5, "No detected beats may be skipped by a strobe cooldown");
    view.updateStrobe(.2);
    assert.equal(view.strobe.opacity, 0);
    const lastFlash = view.strobe.lastFlashAt;
    view.signal.level = 0;
    view.updateStrobe(1, { beat: false });
    assert.equal(view.strobe.lastFlashAt, lastFlash);
    view.signal.level = .01;
    view.updateStrobe(.01, { beat: true });
    assert.equal(view.strobe.opacity, .28, "Quiet detected beats must not be rejected by a second threshold");
    view.updateStrobe(.08);
    assert.equal(view.strobe.opacity, .07);
    view.updateStrobe(.01, { beat: true }, { playing: false });
    assert.equal(view.strobe.opacity, 0);
    view.setStrobeEnabled(false);
    assert.equal(view.strobe.opacity, 0);
    view.setStrobeEnabled(true);
    view.reducedMotion = true;
    view.updateStrobe(.01, { beat: true });
    assert.equal(view.strobeEnabled, true);
    assert.equal(view.strobe.opacity, .28);
    assert.equal(view.setStrobeEnabled(true), true);
    view.setStrobeEnabled(false);
    view.updateStrobe(.01, { beat: true });
    assert.equal(view.strobe.opacity, 0);
  }
});

test("strobe draws one bounded overlay without advancing its envelope", () => {
  const view = renderer();
  view.reducedMotion = true;
  const drawing = capture();
  view.drawStrobe(drawing.context, 1440, 900);
  assert.equal(drawing.result().points, 0);
  view.setStrobeEnabled(true);
  view.updateStrobe(.01, { beat: true });
  view.updateStrobe(.08);
  const state = structuredClone(view.strobe);
  view.drawStrobe(drawing.context, 1440, 900);
  assert.equal(drawing.result().points, 1);
  assert.equal(drawing.result().depth, 0);
  assert.deepEqual(view.strobe, state);
  view.setStrobeEnabled(false);
  view.drawStrobe(drawing.context, 1440, 900);
  assert.equal(drawing.result().points, 1);
});

test("starfield remains translucent even at maximum energy and respects parent alpha", () => {
  const view = renderer();
  view.updateStarfield(0);
  Object.assign(view.starfield, { energy: 1, bass: 1, treble: 1, accent: 1 });
  const alphas = [];
  const context = {
    globalAlpha: .5,
    save() { this.savedAlpha = this.globalAlpha; },
    restore() { this.globalAlpha = this.savedAlpha; },
    beginPath() {}, arc() {},
    fill() { alphas.push(this.globalAlpha); }
  };
  view.drawStarfield(context, 1440, 900);
  assert.equal(alphas.length, 360);
  assert(alphas.every(alpha => alpha > 0 && alpha <= .235));
  assert.equal(context.globalAlpha, .5);
});

test("starfield motion is refresh-rate independent and reduced motion is slower", () => {
  const advance = (rate, reducedMotion) => {
    const view = Object.assign(renderer(), { reducedMotion });
    for (let frame = 0; frame < rate; frame++) view.updateStarfield(1 / rate);
    return view.starfield.time;
  };
  assert(Math.abs(advance(30, false) - advance(240, false)) < 1e-12);
  assert(advance(60, true) < advance(60, false) * .2);
});

test("starfield draws only points on circular orbits and reacts smoothly to sound", () => {
  const view = renderer();
  view.signal = { level: 0, low: 0, high: 0 };
  view.updateStarfield(0);
  view.starfield.stars = [{ angle: 0, orbit: 1, depth: .5, size: 1, tint: .5 }];
  const geometry = (width, height) => {
    const arcs = [];
    const drawing = capture();
    const context = new Proxy(drawing.context, {
      get: (target, name) => name === "stroke" ? () => assert.fail("Stars must not draw trails")
        : name === "arc" ? (...values) => { arcs.push(values); target.arc(...values); } : target[name]
    });
    view.drawStarfield(context, width, height);
    assert.equal(arcs.length, 1);
    const [head] = arcs;
    assert.equal(head[3], 0);
    assert.equal(head[4], Math.PI * 2);
    const orbit = Math.hypot(head[0] - width / 2, head[1] - height / 2);
    assert(orbit > Math.hypot(width, height) * .5, "outer orbit must extend beyond every viewport corner, even in silence");
    assert.equal(drawing.result().depth, 0);
    return { orbit, size: head[2], angle: Math.atan2(head[1] - height / 2, head[0] - width / 2) };
  };
  const quiet = geometry(1440, 900);
  view.signal = { level: 1, low: 1, high: 1 };
  view.updateStarfield(1 / 60, undefined, { beat: true, strongBeat: true });
  assert(view.starfield.bass > 0 && view.starfield.bass < .1);
  const active = geometry(1440, 900);
  assert(active.orbit > quiet.orbit);
  assert(active.size > quiet.size);
  assert(active.angle > quiet.angle);
  geometry(390, 844);
  geometry(3840, 2160);
  geometry(3440, 1440);
  geometry(900, 900);
  const state = structuredClone(view.starfield);
  view.updateStarfield(1, { playing: false }, { beat: true });
  assert.deepEqual(view.starfield, state);
  for (let frame = 0; frame < 180; frame++) {
    view.signal = { level: 0, low: 0, high: 0 };
    view.updateStarfield(1 / 60);
  }
  assert(view.starfield.accent < .01);
  assert(view.starfield.bass < .01);
});