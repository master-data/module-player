import assert from "node:assert/strict";
import test from "node:test";
import { GENERAL_SCENES, updateGeneralMotion } from "../demo/general-scenes.js";
import { ImmersiveVisualizer } from "../demo/immersive-visualizer.js";

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
  assert.equal(GENERAL_SCENES.length, 12);
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
        if (!["terrain", "prism", "helix"].includes(scene)) assert(result.minimumWidth / resolution >= 4.5, scene);
        if (!["cascade", "prism", "monolith"].includes(scene)) assert(result.curves > 0, scene);
      }
    }
  }
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
  assert(verticalTravel > 40);
});

test("helix restores the original opposing 2.35-turn strands and 26 full-width rungs", () => {
  assert(GENERAL_SCENES.includes("helix"));
  const view = renderer();
  view.channels = [];
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
    const expected = Math.sin(position * Math.PI * 2 * 2.35 + view.elapsed * .34)
      * 1080 * (.18 + view.signal.low * .08);
    assert.equal(first[0], position * 1920 - 960);
    assert.equal(second[0], first[0]);
    assert(Math.abs(first[1] - expected) < 1e-8);
    assert(Math.abs(second[1] + expected) < 1e-8);
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
    view.directScene(24);
    assert(GENERAL_SCENES.includes(view.scene));
    visited.add(view.scene);
  }
  assert.equal(visited.size, GENERAL_SCENES.length);
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
  assert.equal(stars.length, 180);
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