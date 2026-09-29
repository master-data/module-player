import { IcosahedronGeometry, OctahedronGeometry, PerspectiveCamera, TorusKnotGeometry, Vector3 } from "./vendor/three/three.module.min.js";

export const GENERAL_SCENES = ["aperture", "silk", "contours", "diffraction", "cascade", "interference", "weave", "prism", "monolith", "wavegarden", "terrain", "helix", "copper", "checker-tunnel", "raster-twist", "dot-vortex", "voxel-flight", "metaball-foundry", "particle-assembly", "feedback-bloom", "polar-plasma", "rotozoom-mosaic", "oscilloscope-orbit", "ribbon-loom", "echo-chamber", "phosphor-bobs", "glenz-vector", "copper-ribbons"];

const TAU = Math.PI * 2;
const CURVE_KERNEL = Float64Array.from({ length: 33 }, (_, index) => Math.exp(-.5 * ((index - 16) / 7) ** 2));
const CURVE_WEIGHT = CURVE_KERNEL.reduce((sum, weight) => sum + weight, 0);
const PALETTES = {
  aperture: [188, 205, 188, 28, 205, 188], silk: [12, 183], contours: [162, 44], diffraction: [38, 200],
  cascade: [195, 16], interference: [176, 342], weave: [40, 186], prism: [188, 38],
  monolith: [190, 32], wavegarden: [165, 345], copper: [18, 182],
  "checker-tunnel": [168, 332], "raster-twist": [192, 22], "dot-vortex": [42, 178]
};

function ink(hue, alpha = 1, lightness = 68) {
  return `hsla(${hue} 82% ${lightness}% / ${alpha})`;
}

function sample(data, position) {
  if (!data?.length) return 0;
  const offset = Math.max(0, Math.min(data.length - 1, position * (data.length - 1)));
  const index = Math.floor(offset);
  return (data[index] || 0) + ((data[Math.min(index + 1, data.length - 1)] || 0) - (data[index] || 0)) * (offset - index);
}

function filterCurveWaveform(renderer, channels) {
  const filtered = renderer.curveWaveform ??= [new Float64Array(256), new Float64Array(256)];
  for (let side = 0; side < 2; side++) {
    const source = channels[side] ?? channels[0];
    for (let index = 0; index < filtered[side].length; index++) {
      let value = 0;
      for (let tap = 0; tap < CURVE_KERNEL.length; tap++) {
        value += sample(source, (index + tap - 16) / 255) * CURVE_KERNEL[tap];
      }
      filtered[side][index] = value / CURVE_WEIGHT;
    }
  }
  return filtered;
}

function stroke(context, hue, alpha, width) {
  context.strokeStyle = ink(hue, Math.min(1, alpha * 1.35));
  context.lineWidth = width;
  context.stroke();
}

class CurvedPath {
  constructor(context) {
    this.context = context;
  }

  begin(closed = false) {
    this.context.beginPath();
    this.started = false;
    this.closed = closed;
    this.hasSegment = false;
  }

  point(horizontal, vertical) {
    if (this.started) {
      const midpointX = (this.horizontal + horizontal) * .5;
      const midpointY = (this.vertical + vertical) * .5;
      if (this.closed && !this.hasSegment) {
        this.startX = midpointX;
        this.startY = midpointY;
        this.context.moveTo(midpointX, midpointY);
      } else {
        this.context.quadraticCurveTo(this.horizontal, this.vertical, midpointX, midpointY);
      }
      this.hasSegment = true;
    } else {
      this.firstX = horizontal;
      this.firstY = vertical;
      if (!this.closed) this.context.moveTo(horizontal, vertical);
      this.started = true;
    }
    this.horizontal = horizontal;
    this.vertical = vertical;
  }

  end() {
    if (this.closed && this.hasSegment) {
      this.context.quadraticCurveTo(this.horizontal, this.vertical,
        (this.horizontal + this.firstX) * .5, (this.vertical + this.firstY) * .5);
      this.context.quadraticCurveTo(this.firstX, this.firstY, this.startX, this.startY);
      this.context.closePath();
      return;
    }
    this.context.lineTo(this.horizontal, this.vertical);
  }
}

function updateShaderWaveform(motion, delta, hasAudio) {
  const size = 256;
  const state = motion.shaderWaveform ??= {
    channels: [new Float64Array(size), new Float64Array(size)],
    velocities: [new Float64Array(size), new Float64Array(size)],
    targets: [new Float32Array(size), new Float32Array(size)],
    age: 0, ready: false
  };
  state.age += delta;
  if (!hasAudio) {
    state.targets.forEach(channel => channel.fill(0));
    state.ready = false;
    state.age = 0;
  } else if (!state.ready || state.age >= .16) {
    let bestOffset = 0;
    let bestScore = -Infinity;
    if (state.ready) {
      for (let offset = 0; offset < size; offset++) {
        let score = 0;
        for (let index = 0; index < size; index += 8) {
          const sourceIndex = (index + offset) % size;
          score += state.targets[0][index] * motion.traceChannels[0][sourceIndex]
            + state.targets[1][index] * motion.traceChannels[1][sourceIndex];
        }
        if (score > bestScore) {
          bestScore = score;
          bestOffset = offset;
        }
      }
    }
    for (let side = 0; side < 2; side++) {
      for (let index = 0; index < size; index++) {
        state.targets[side][index] = motion.traceChannels[side][(index + bestOffset) % size];
      }
    }
    state.age = 0;
    state.ready = true;
  }
  const frequency = 10;
  const decay = Math.exp(-frequency * delta);
  for (let side = 0; side < 2; side++) {
    for (let index = 0; index < size; index++) {
      const offset = state.channels[side][index] - state.targets[side][index];
      const momentum = state.velocities[side][index] + frequency * offset;
      state.channels[side][index] = state.targets[side][index] + (offset + momentum * delta) * decay;
      state.velocities[side][index] = (state.velocities[side][index] - frequency * momentum * delta) * decay;
    }
  }
}

function updateFeedbackHistory(motion, delta, hasAudio, key = "feedback", capacity = 24) {
  const history = motion[key] ??= { time: 0, tick: -1, head: 0, count: 0,
    frames: Array.from({ length: capacity }, () => ({ time: 0, low: 0, impact: 0, level: 0,
      channels: [new Float32Array(96), new Float32Array(96)] })) };
  history.time += delta;
  const tick = Math.floor((history.time + 1e-9) / .12);
  if (history.tick === tick) return;
  history.tick = tick;
  const frame = history.frames[history.head];
  frame.time = history.time;
  frame.clock = motion.time;
  frame.mid = motion.signal.mid;
  frame.low = motion.signal.low;
  frame.impact = motion.impact;
  frame.level = hasAudio ? motion.signal.level : 0;
  for (let side = 0; side < 2; side++) {
    const source = hasAudio ? motion.shaderWaveform.channels[side] : undefined;
    for (let point = 0; point < 96; point++) {
      let value = 0;
      for (let tap = 0; tap < CURVE_KERNEL.length; tap++) {
        value += sample(source, point / 95 + (tap - 16) / 255) * CURVE_KERNEL[tap];
      }
      frame.channels[side][point] = value / CURVE_WEIGHT;
    }
  }
  history.head = (history.head + 1) % history.frames.length;
  history.count = Math.min(history.frames.length, history.count + 1);
}

export function updateGeneralMotion(renderer, delta, musicalEvent = {}) {
  const points = 96;
  const signalKeys = ["low", "mid", "high", "level"];
  const energyOffset = points * 2 + signalKeys.length + 6;
  const size = energyOffset + points * 2;
  const motion = renderer.generalMotion ??= {
    values: new Float64Array(size), velocities: new Float64Array(size),
    targets: new Float64Array(size), signal: {}, channels: []
  };
  if (!motion.channels.length) {
    motion.channels = [motion.values.subarray(0, points), motion.values.subarray(points, points * 2)];
    motion.bands = motion.values.subarray(points * 2 + signalKeys.length, energyOffset);
    motion.energyChannels = [motion.values.subarray(energyOffset, energyOffset + points), motion.values.subarray(energyOffset + points)];
  }
  const channels = renderer.channels ?? [];
  const traceChannels = motion.traceChannels ??= [new Float32Array(256), new Float32Array(256)];
  for (let side = 0; side < 2; side++) {
    const data = channels[side] ?? channels[0];
    for (let index = 0; index < traceChannels[side].length; index++) {
      let value = sample(data, index / (traceChannels[side].length - 1));
      if (data?.length > traceChannels[side].length) {
        value = 0;
        const start = Math.floor(index * data.length / traceChannels[side].length);
        const end = Math.floor((index + 1) * data.length / traceChannels[side].length);
        for (let offset = start; offset < end; offset++) {
          if (Number.isFinite(data[offset]) && Math.abs(data[offset]) > Math.abs(value)) value = data[offset];
        }
      }
      traceChannels[side][index] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }
    for (let index = 0; index < points; index++) {
      const position = index / (points - 1);
      const spacing = 1 / (points - 1);
      motion.targets[side * points + index] = (
        sample(data, position - spacing) + sample(data, position) * 2 + sample(data, position + spacing)
      ) * .25;
      motion.targets[energyOffset + side * points + index] = (
        Math.abs(sample(data, position - spacing)) + Math.abs(sample(data, position)) * 2 + Math.abs(sample(data, position + spacing))
      ) * .25;
    }
  }
  for (const [index, key] of signalKeys.entries()) {
    motion.targets[points * 2 + index] = (renderer.measuredSignal ?? renderer.signal)?.[key] ?? 0;
  }
  for (let index = 0; index < 6; index++) {
    motion.targets[points * 2 + signalKeys.length + index] = channels.length ? renderer.tone?.bands[index] ?? 0 : 0;
  }
  const elapsed = Math.max(0, delta);
  updateShaderWaveform(motion, elapsed, channels.length > 0);
  const waveformFrequency = renderer.reducedMotion ? 8 : 22;
  const envelopeFrequency = renderer.reducedMotion ? 8 : 32;
  const waveformDecay = Math.exp(-waveformFrequency * elapsed);
  const envelopeDecay = Math.exp(-envelopeFrequency * elapsed);
  for (let index = 0; index < size; index++) {
    const frequency = index < points * 2 ? waveformFrequency : envelopeFrequency;
    const decay = index < points * 2 ? waveformDecay : envelopeDecay;
    const offset = motion.values[index] - motion.targets[index];
    const momentum = motion.velocities[index] + frequency * offset;
    motion.values[index] = motion.targets[index] + (offset + momentum * elapsed) * decay;
    motion.velocities[index] = (motion.velocities[index] - frequency * momentum * elapsed) * decay;
  }
  for (const [index, key] of signalKeys.entries()) motion.signal[key] = motion.values[points * 2 + index];
  motion.impact ??= 0;
  motion.impactVelocity ??= 0;
  if (musicalEvent.beat) {
    const strength = musicalEvent.returnFromDrop ? 1.2 : musicalEvent.strongBeat ? 1 : .7;
    motion.impactVelocity = Math.min(55, motion.impactVelocity + strength * 48) * (renderer.reducedMotion ? .25 : 1);
  }
  const impactFrequency = 18;
  const impactDecay = Math.exp(-impactFrequency * elapsed);
  const momentum = motion.impactVelocity + impactFrequency * motion.impact;
  motion.impact = (motion.impact + momentum * elapsed) * impactDecay;
  motion.impactVelocity = (motion.impactVelocity - impactFrequency * momentum * elapsed) * impactDecay;
  motion.time ??= renderer.elapsed ?? 0;
  motion.time += elapsed * (.8 + motion.signal.level * 1.8 + motion.impact * 2) * (renderer.reducedMotion ? .22 : 1);
  const pigmentFlow = motion.pigmentFlow ??= new Float64Array(3);
  const pigmentActivity = channels.length ? Math.max(0, Math.min(1, (motion.signal.level - .025) / .275)) : 0;
  for (let index = 0; index < 3; index++) {
    const balance = Math.max(0, motion.bands[index * 2] + motion.bands[index * 2 + 1]);
    const energy = Math.max(0, motion.signal[signalKeys[index]]);
    pigmentFlow[index] += elapsed * pigmentActivity * (.12 + balance * .9 + energy * .28 + motion.impact * .12)
      * (renderer.reducedMotion ? .2 : 1);
  }
  const terrain = motion.terrain ??= { values: new Float64Array(4), velocities: new Float64Array(4) };
  for (let index = 0; index < 4; index++) {
    const frequency = renderer.reducedMotion ? 5 : index === 3 ? 20 : 12;
    const decay = Math.exp(-frequency * elapsed);
    const measured = index === 3 ? motion.impact : motion.targets[points * 2 + index];
    const target = channels.length ? Math.max(0, Math.min(index === 3 ? 1.2 : 1, measured)) * (renderer.reducedMotion ? .2 : 1) : 0;
    const offset = terrain.values[index] - target;
    const velocity = terrain.velocities[index] + frequency * offset;
    terrain.values[index] = target + (offset + velocity * elapsed) * decay;
    terrain.velocities[index] = (terrain.velocities[index] - frequency * velocity * elapsed) * decay;
  }
  const flight = motion.flight ??= { values: new Float64Array(4), velocities: new Float64Array(4) };
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < points; index++) {
    leftEnergy += motion.targets[energyOffset + index] / points;
    rightEnergy += motion.targets[energyOffset + points + index] / points;
  }
  const totalEnergy = leftEnergy + rightEnergy;
  const balance = (rightEnergy - leftEnergy) / (totalEnergy + .04) * Math.min(1, totalEnergy * 4);
  const flightFrequency = 3.5;
  const flightDecay = Math.exp(-flightFrequency * elapsed);
  for (let index = 0; index < 4; index++) {
    const measured = index === 3 ? balance : motion.targets[points * 2 + index];
    const target = channels.length ? Math.max(-1, Math.min(1, measured)) * (renderer.reducedMotion ? .2 : 1) : 0;
    const offset = flight.values[index] - target;
    const velocity = flight.velocities[index] + flightFrequency * offset;
    flight.values[index] = target + (offset + velocity * elapsed) * flightDecay;
    flight.velocities[index] = (flight.velocities[index] - flightFrequency * velocity * elapsed) * flightDecay;
  }
  if (renderer.scene === "feedback-bloom" || (renderer.previousScene === "feedback-bloom" && renderer.sceneTransition < 1)) {
    updateFeedbackHistory(motion, elapsed * (renderer.reducedMotion ? .22 : 1), channels.length > 0);
  } else {
    motion.feedback = undefined;
  }
  if (renderer.scene === "oscilloscope-orbit" || (renderer.previousScene === "oscilloscope-orbit" && renderer.sceneTransition < 1)) {
    updateFeedbackHistory(motion, elapsed * (renderer.reducedMotion ? .22 : 1), channels.length > 0, "orbitHistory", 8);
  } else {
    motion.orbitHistory = undefined;
  }
  if (renderer.scene === "phosphor-bobs" || (renderer.previousScene === "phosphor-bobs" && renderer.sceneTransition < 1)) {
    updateFeedbackHistory(motion, elapsed * (renderer.reducedMotion ? .22 : 1), channels.length > 0, "bobHistory", 4);
    const bobs = motion.bobs ??= {
      time: 0, serial: 0, cursor: 0,
      slots: Array.from({ length: 8 }, () => ({ born: -Infinity, size: 1, phase: 0 }))
    };
    bobs.time += elapsed * (renderer.reducedMotion ? .22 : 1);
    if (musicalEvent.beat && channels.length && ((renderer.measuredSignal ?? renderer.signal)?.level ?? 0) > .025) {
      const births = musicalEvent.strongBeat || musicalEvent.returnFromDrop ? 2 : 1;
      for (let birth = 0; birth < births; birth++) {
        for (let offset = 0; offset < bobs.slots.length; offset++) {
          const index = (bobs.cursor + offset) % bobs.slots.length;
          const slot = bobs.slots[index];
          if (bobs.time - slot.born < 3.2) continue;
          bobs.serial++;
          slot.born = bobs.time;
          slot.size = .65 + (Math.sin(bobs.serial * 2.39996) * .5 + .5) * .5;
          slot.phase = bobs.serial * 2.39996;
          bobs.cursor = (index + 1) % bobs.slots.length;
          break;
        }
      }
    }
  } else {
    motion.bobHistory = undefined;
    motion.bobs = undefined;
  }
  return motion;
}

export function drawCrystalFacets(context, scale, time, sectors, layers, cutoff, voices, waveform) {
  context.lineJoin = "miter";
  context.lineCap = "butt";
  context.rotate(Math.sin(time * .13) * .4);
  for (let sector = 0; sector < sectors; sector++) {
    context.save();
    context.rotate(sector / sectors * TAU);
    for (let layer = layers; layer > 0; layer--) {
      const voiceIndex = (sector + layer) % 3;
      const visual = voices[voiceIndex];
      const wave = waveform(voiceIndex, layer * .13 + time * .12);
      const radius = scale * layer / layers * (.28 + visual.energy * .13);
      const spread = radius * (.14 + visual.duty * .3);
      const offset = wave * visual.energy * scale * .035;
      const hue = [178, 352, 44][voiceIndex];
      context.beginPath();
      context.moveTo(radius * .32, 0);
      context.lineTo(radius + offset, -spread);
      context.lineTo(radius * (1.2 + cutoff * .25), 0);
      context.lineTo(radius + offset, spread);
      context.closePath();
      context.fillStyle = `hsla(${hue + layer * 3} 95% 55% / ${.025 + visual.energy * .09})`;
      context.fill();
      context.strokeStyle = `hsla(${hue} 95% 76% / ${.16 + visual.energy * .4})`;
      context.lineWidth = Math.max(1, scale * .0015);
      context.stroke();
    }
    context.restore();
  }
}

export function drawGeneralScene(renderer, context, scene, width, height, centerX, centerY, seed = renderer.sceneSeed) {
  if (scene === "checker-tunnel" || scene === "voxel-flight" || scene === "raster-twist" || scene === "metaball-foundry" || scene === "polar-plasma" || scene === "rotozoom-mosaic" || scene === "ribbon-loom" || scene === "phosphor-bobs") {
    if (renderer.drawShaderScene?.(context, scene, width, height, seed)) return;
    if (scene === "voxel-flight") return drawGeneralScene(renderer, context, "terrain", width, height, centerX, centerY, seed + .37);
  }
  const palette = PALETTES[scene] ?? PALETTES.aperture;
  const scale = Math.min(width, height);
  const detail = (full, minimum) => renderer.detailCount(renderer.reducedMotion ? full * .7 : full, minimum);
  const motion = renderer.generalMotion;
  const time = motion?.time ?? renderer.elapsed;
  const impact = Math.min(1.2, motion?.impact ?? 0);
  const { low, mid, high, level } = motion?.signal ?? renderer.signal;
  const bands = motion?.bands ?? renderer.tone?.bands ?? [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6];
  const channels = motion?.channels ?? renderer.channels;
  const left = channels[0];
  const right = channels[1] ?? left;
  const traces = motion?.traceChannels ?? channels;
  const trace = (position, side = 0) => sample(traces[side] ?? traces[0], position);
  const smoothTraces = ["silk", "wavegarden", "helix", "terrain", "metaball-foundry", "particle-assembly", "feedback-bloom", "polar-plasma", "rotozoom-mosaic", "oscilloscope-orbit", "ribbon-loom", "echo-chamber", "phosphor-bobs", "glenz-vector", "copper-ribbons"].includes(scene)
    ? filterCurveWaveform(renderer, motion?.shaderWaveform?.channels ?? traces) : undefined;
  const audio = (position, side = 0) => {
    const value = sample(side ? right : left, position);
    return value * 4 / (1 + Math.abs(value) * 3);
  };
  const pixelRatio = renderer.canvas?.clientWidth > 0 ? width / renderer.canvas.clientWidth : 1;
  const lineWidth = Math.max(5.5 * pixelRatio, scale * .008) * (1 + impact * .18);
  const curve = new CurvedPath(context);
  context.save();
  context.translate(centerX, centerY);
  context.lineCap = "round";
  context.lineJoin = "round";

  if (scene === "copper-ribbons") {
    const copper = renderer.copperRibbons ??= {
      ribbons: Array.from({ length: 6 }, (_, index) => ({ index, samples: new Float64Array(49 * 3), depth: 0 })),
      ordered: [], shades: [10, 22, 36, 27, 13], hues: [24, 188, 348], segments: 0
    };
    const segments = copper.segments = detail(48, 12);
    const bass = Math.max(0, Math.min(1, low));
    const mids = Math.max(0, Math.min(1, mid));
    const treble = Math.max(0, Math.min(1, high));
    const thickness = height * (.018 + bass * .012 + Math.max(0, impact) * .024);
    for (const ribbon of copper.ribbons) {
      const phase = ribbon.index / 6 * TAU + seed * TAU;
      for (let point = 0; point <= segments; point++) {
        const position = point / segments;
        const angle = position * TAU * .55 + time * .24 + phase;
        const twist = position * TAU * (.65 + mids * .25) - time * .18 + phase;
        const leftWave = sample(smoothTraces[0], position);
        const rightWave = sample(smoothTraces[1], position);
        const offset = point * 3;
        ribbon.samples[offset] = Math.sin(angle) * height * (.23 + mids * .025)
          + height * .055 * (leftWave * Math.cos(phase) + rightWave * Math.sin(phase));
        ribbon.samples[offset + 1] = thickness * (.2 + .8 * Math.abs(Math.cos(twist)));
        ribbon.samples[offset + 2] = Math.cos(angle) * .8 + Math.sin(twist) * .2;
      }
    }
    for (let segment = 0; segment < segments; segment++) {
      const start = segment * 3;
      const end = start + 3;
      const leftEdge = (segment / segments - .5) * width * .96;
      const rightEdge = ((segment + 1) / segments - .5) * width * .96;
      for (const [index, ribbon] of copper.ribbons.entries()) {
        ribbon.depth = (ribbon.samples[start + 2] + ribbon.samples[end + 2]) * .5;
        copper.ordered[index] = ribbon;
      }
      copper.ordered.sort((first, second) => first.depth - second.depth);
      for (const ribbon of copper.ordered) {
        const points = ribbon.samples;
        for (let band = 0; band < copper.shades.length; band++) {
          const top = band / copper.shades.length * 2 - 1;
          const bottom = (band + 1) / copper.shades.length * 2 - 1;
          context.beginPath();
          context.moveTo(leftEdge, points[start] + points[start + 1] * top);
          context.lineTo(rightEdge, points[end] + points[end + 1] * top);
          context.lineTo(rightEdge, points[end] + points[end + 1] * bottom);
          context.lineTo(leftEdge, points[start] + points[start + 1] * bottom);
          context.closePath();
          const brightness = copper.shades[band] + (ribbon.depth + 1) * 1.5 + (band === 2 ? treble * 3 : 0);
          context.fillStyle = `hsla(${copper.hues[ribbon.index % 3]} 26% ${brightness}% / 1)`;
          context.fill();
        }
      }
    }
  } else if (scene === "glenz-vector") {
    if (!renderer.glenzProjection) {
      const sources = [new IcosahedronGeometry(1.4, 0), new OctahedronGeometry(1.4, 0)].map(geometry => {
        const positions = Float32Array.from(geometry.getAttribute("position").array);
        geometry.dispose();
        return positions;
      });
      renderer.glenzProjection = {
        sources, camera: new PerspectiveCamera(48, 1, .1, 80),
        axis: new Vector3(.3, .8, .4).normalize(), light: new Vector3(-.4, .7, 1).normalize(),
        normal: new Vector3(), edge: new Vector3(), center: new Vector3(), gaze: new Vector3(),
        faces: Array.from({ length: 40 }, () => ({ points: [new Vector3(), new Vector3(), new Vector3()],
          depth: 0, hue: 0, brightness: 0, opacity: 0 })), ordered: []
      };
    }
    const projection = renderer.glenzProjection;
    const { camera, axis, light, normal, edge, center, gaze, faces, ordered } = projection;
    camera.aspect = width / height;
    camera.position.set(Math.sin(time * .06) * .8, Math.sin(time * .07) * .4, 8.6 * Math.max(1, .9 / camera.aspect));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const bass = Math.max(0, Math.min(1, low));
    const mids = Math.max(0, Math.min(1, mid));
    const treble = Math.max(0, Math.min(1, high));
    const source = projection.sources[detail(20, 8) < 14 ? 1 : 0];
    const perForm = source.length / 9;
    ordered.length = perForm * 2;
    for (let form = 0; form < 2; form++) {
      const orbit = time * .12 + form * Math.PI;
      for (let index = 0; index < perForm; index++) {
        const face = faces[form * perForm + index];
        for (let vertex = 0; vertex < 3; vertex++) {
          const point = face.points[vertex].fromArray(source, index * 9 + vertex * 3);
          const leftWave = sample(smoothTraces[0], point.y / 2.8 + .5);
          const rightWave = sample(smoothTraces[1], point.x / 2.8 + .5);
          point.multiplyScalar(1 + bass * .12 + Math.max(0, impact) * .16 + leftWave * .12 + rightWave * .08);
          point.applyAxisAngle(axis, time * (form ? -.19 : .16) + seed * TAU + form * 1.4);
          point.x += Math.cos(orbit) * (.44 + mids * .2 + bass * .12);
          point.y += Math.sin(time * .15 + form * Math.PI) * .18;
          point.z += Math.sin(orbit) * .35;
        }
        normal.subVectors(face.points[1], face.points[0]);
        edge.subVectors(face.points[2], face.points[0]);
        normal.cross(edge).normalize();
        center.copy(face.points[0]).add(face.points[1]).add(face.points[2]).multiplyScalar(1 / 3);
        gaze.subVectors(camera.position, center);
        face.depth = gaze.lengthSq();
        face.hue = form ? 38 : 188;
        face.brightness = 18 + Math.max(0, normal.dot(light)) * 17 + treble * 3;
        face.opacity = normal.dot(gaze) > 0 ? .43 : .14;
        for (const point of face.points) {
          point.project(camera);
          point.x *= width * .5;
          point.y *= -height * .5;
        }
        ordered[form * perForm + index] = face;
      }
    }
    ordered.sort((first, second) => second.depth - first.depth);
    context.lineWidth = Math.max(.65 * pixelRatio, scale * .0012);
    for (const face of ordered) {
      context.beginPath();
      context.moveTo(face.points[0].x, face.points[0].y);
      context.lineTo(face.points[1].x, face.points[1].y);
      context.lineTo(face.points[2].x, face.points[2].y);
      context.closePath();
      context.fillStyle = `hsla(${face.hue} 28% ${face.brightness}% / ${face.opacity})`;
      context.fill();
      context.strokeStyle = `hsla(${face.hue} 20% ${face.brightness + 5}% / .26)`;
      context.stroke();
    }
  } else if (scene === "phosphor-bobs") {
    const projection = renderer.bobProjection ??= { camera: new PerspectiveCamera(48, 1, .1, 80),
      point: new Vector3(), axis: new Vector3(.25, .8, .3).normalize(),
      spheres: Array.from({ length: 40 }, (_, index) => ({ index, horizontal: 0, vertical: 0, depth: 0, radius: 0 })) };
    const { camera, point, axis, spheres } = projection;
    camera.aspect = width / height;
    camera.position.set(0, 0, 9.8 * Math.max(1, .85 / camera.aspect));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const count = detail(40, 16);
    const points = detail(16, 8);
    const history = motion?.bobHistory;
    const frames = history?.count ?? 0;
    const live = { time: history?.time ?? 0, clock: time, low, mid, impact, level, channels: smoothTraces };
    for (let trail = 0; trail <= frames; trail++) {
      const frame = trail === frames ? live : history.frames[(history.head - frames + trail + history.frames.length) % history.frames.length];
      const age = (history?.time ?? 0) - frame.time;
      if (age > .48 || (trail < frames && (frame.level < .001 || age < .001))) continue;
      const bass = Math.max(0, Math.min(1, frame.low));
      const mids = Math.max(0, Math.min(1, frame.mid));
      const expansion = 1 + bass * .12 + Math.max(0, Math.min(1.2, frame.impact)) * .24;
      const opacity = trail === frames ? .92 : Math.exp(-age * 6) * .16;
      for (let index = 0; index < count; index++) {
        const sphere = spheres[index];
        sphere.index = index;
        const phase = index / count * TAU;
        const angle = phase + frame.clock * .3;
        const leftWave = sample(frame.channels[0], (1 - Math.cos(phase)) * .5);
        const rightWave = sample(frame.channels[1], (1 - Math.cos(phase)) * .5);
        point.set(Math.cos(angle * 2) * (1.75 + leftWave * .45),
          Math.sin(angle * 3) * (1.15 + rightWave * .4),
          Math.sin(angle + frame.clock * .13) * (.7 + mids * .6));
        point.multiplyScalar(expansion).applyAxisAngle(axis, frame.clock * .09 + seed * TAU);
        sphere.depth = point.z;
        const distance = camera.position.z - point.z;
        sphere.radius = height / (2 * Math.tan(24 * Math.PI / 180) * distance) * (.115 + bass * .025);
        point.project(camera);
        sphere.horizontal = point.x * width * .5;
        sphere.vertical = -point.y * height * .5;
      }
      const ordered = projection.ordered ??= [];
      ordered.length = count;
      for (let index = 0; index < count; index++) ordered[index] = spheres[index];
      ordered.sort((first, second) => first.depth - second.depth);
      for (const sphere of ordered) {
        for (let shade = 0; shade < 5; shade++) {
          const radius = sphere.radius * (1 - shade * .18);
          const offset = sphere.radius * shade * .065;
          curve.begin(true);
          for (let vertex = 0; vertex < points; vertex++) {
            const angle = vertex / points * TAU;
            curve.point(sphere.horizontal - offset + Math.cos(angle) * radius,
              sphere.vertical - offset + Math.sin(angle) * radius);
          }
          curve.end();
          const brightness = 10 + shade * 8 + (trail === frames ? Math.max(0, Math.min(1, high)) * shade : 0);
          context.fillStyle = `hsla(${sphere.index % 2 ? 24 : 187} ${shade === 4 ? 12 : 26}% ${brightness}% / ${opacity})`;
          context.fill();
        }
      }
    }
  } else if (scene === "echo-chamber") {
    const projection = renderer.chamberProjection ??= {
      camera: new PerspectiveCamera(58, 1, .1, 100), point: new Vector3(),
      yawAxis: new Vector3(0, 1, 0), rollAxis: new Vector3(0, 0, 1),
      vertices: new Float64Array(64),
      corners: [[-1, -.7], [-.7, -1], [.7, -1], [1, -.7], [1, .7], [.7, 1], [-.7, 1], [-1, .7]]
    };
    const { camera, point, yawAxis, rollAxis, vertices, corners } = projection;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const count = detail(18, 6);
    const bass = Math.max(0, Math.min(1, low));
    const mids = Math.max(0, Math.min(1, mid));
    const treble = Math.max(0, Math.min(1, high));
    const phase = ((time * .38) % 1 + 1) % 1;
    const expansion = 1 + bass * .15 + impact * .17;
    const radii = [1, .96, .86, .835];
    const recess = [.05, 0, 0, .12];
    for (let frame = count - 1; frame >= 0; frame--) {
      const depth = (frame + 1 - phase) / count;
      const fade = Math.min(1, depth * count) * Math.min(1, (1 - depth) * count);
      const opacity = fade * (.3 + (1 - depth) * .65);
      const distance = 3.5 + depth * 32;
      const yaw = Math.sin(depth * 3 + time * .18) * .20 / Math.max(1, camera.aspect);
      const roll = Math.sin(time * .13 + seed * TAU) * .16 + depth * (.15 + mids * .3);
      const driftX = Math.sin(depth * 4 + time * .15) * .45 + sample(smoothTraces[0], depth) * .9;
      const driftY = Math.cos(depth * 3 + time * .11) * .3 + sample(smoothTraces[1], depth) * .75;
      for (let band = 0; band < radii.length; band++) {
        for (let corner = 0; corner < corners.length; corner++) {
          point.set(corners[corner][0] * 3.8 * camera.aspect * radii[band] * expansion,
            corners[corner][1] * 3.8 * radii[band] * expansion, -recess[band]);
          point.applyAxisAngle(yawAxis, yaw).applyAxisAngle(rollAxis, roll);
          point.x += driftX;
          point.y += driftY;
          point.z -= distance;
          point.project(camera);
          const offset = (band * 8 + corner) * 2;
          vertices[offset] = point.x * width * .5;
          vertices[offset + 1] = -point.y * height * .5;
        }
      }
      for (let side = 0; side < 8; side++) {
        const light = .6 + Math.cos(side * Math.PI / 4 - .8 + roll) * .25 + treble * .06;
        for (let band = 0; band < 3; band++) {
          const start = band * 8 + side;
          const next = band * 8 + (side + 1) % 8;
          context.beginPath();
          context.moveTo(vertices[start * 2], vertices[start * 2 + 1]);
          context.lineTo(vertices[next * 2], vertices[next * 2 + 1]);
          context.lineTo(vertices[(next + 8) * 2], vertices[(next + 8) * 2 + 1]);
          context.lineTo(vertices[(start + 8) * 2], vertices[(start + 8) * 2 + 1]);
          context.closePath();
          const brightness = band === 0 ? 30 + light * 20 : band === 1 ? 18 + light * 14 : 12 + light * 8;
          context.fillStyle = `hsla(192 ${band === 1 ? 18 : 10}% ${brightness}% / ${opacity})`;
          context.fill();
        }
      }
    }
  } else if (scene === "ribbon-loom") {
    const columns = detail(56, 16);
    const rows = Math.ceil(columns * height / width);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const bass = Math.max(0, Math.min(1, low));
    const mids = Math.max(0, Math.min(1, mid));
    const treble = Math.max(0, Math.min(1, high));
    const angle = .3 + Math.sin(time * .07) * .3 + seed * 1.4;
    const ribbonWidth = .18 + bass * .055 + impact * .035;
    const shade = (across, shadow, base) => {
      const normalized = Math.max(-1, Math.min(1, across / ribbonWidth));
      const crown = Math.sqrt(Math.max(0, 1 - normalized * normalized));
      const glint = Math.max(0, 1 - Math.abs(normalized - .28)) ** 16 * (.18 + treble * .22);
      return base.map(value => (value * (.30 + crown * .55) + glint * .24) * (1 - shadow * .55));
    };
    const shadowAt = value => {
      const distance = Math.max(0, Math.min(1, (Math.abs(value) - ribbonWidth) / .09));
      return 1 - distance * distance * (3 - 2 * distance);
    };
    for (let row = -1; row <= rows; row++) {
      for (let column = -1; column <= columns; column++) {
        const horizontal = ((column + .5) * cellWidth * 2 - width) / scale;
        const vertical = (height - (row + .5) * cellHeight * 2) / scale;
        let across = (Math.cos(angle) * horizontal + Math.sin(angle) * vertical) * 2.2;
        let down = (-Math.sin(angle) * horizontal + Math.cos(angle) * vertical) * 2.2;
        const leftWave = sample(smoothTraces[0], .5 + .45 * down / Math.sqrt(1 + down * down));
        const rightWave = sample(smoothTraces[1], .5 + .45 * across / Math.sqrt(1 + across * across));
        across += Math.sin(down * 1.4 + time * .24) * (.18 + mids * .16) + leftWave * .28;
        down += Math.sin(across * 1.25 - time * .20) * (.16 + mids * .14) + rightWave * .28;
        const cellX = Math.floor(across + .5);
        const cellY = Math.floor(down + .5);
        const localX = across - cellX;
        const localY = down - cellY;
        const over = ((cellX + cellY) % 2 + 2) % 2 === 0;
        const onVertical = Math.abs(localX) < ribbonWidth;
        const onHorizontal = Math.abs(localY) < ribbonWidth;
        let color = [.008, .011, .014];
        if (onVertical && (over || !onHorizontal)) color = shade(localX, over ? 0 : shadowAt(localY), [.14, .18, .19]);
        else if (onHorizontal) color = shade(localY, over ? shadowAt(localX) : 0, [.16, .055, .065]);
        context.fillStyle = `rgb(${color.map(value => Math.round(value ** .4545 * 255)).join(" ")})`;
        context.fillRect(column * cellWidth - centerX, row * cellHeight - centerY, cellWidth + 1, cellHeight + 1);
      }
    }
  } else if (scene === "rotozoom-mosaic") {
    const extent = detail(9, 4);
    const density = extent / 9;
    const bass = Math.max(0, Math.min(1, low));
    const mids = Math.max(0, Math.min(1, mid));
    const treble = Math.max(0, Math.min(1, high));
    context.fillStyle = "#1e2125";
    context.fillRect(-centerX, -centerY, width, height);
    for (let layer = 1; layer >= 0; layer--) {
      const angle = time * (.10 + layer * .035) * (1 - layer * 2) + seed * TAU + layer * .7;
      const zoom = (2.4 + .35 * Math.sin(time * .13 + layer) + bass * .3 + impact * .16) * 1.45 ** layer * density;
      const size = scale / (2 * zoom);
      const driftX = Math.sin(time * .09) * (.18 + mids * .24);
      const driftY = Math.cos(time * .07) * (.18 + mids * .24);
      const maximumZoom = (2.4 + .35 + .3 + 1.2 * .16) * 1.45 ** layer * density;
      const columns = Math.ceil((Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / scale * maximumZoom + 1);
      const rows = Math.ceil((Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / scale * maximumZoom + 1);
      const diamond = (column, row, radius) => {
        for (let corner = 0; corner < 4; corner++) {
          const phase = corner * Math.PI / 2;
          const across = column - driftX + Math.cos(phase) * radius;
          const down = row - driftY + Math.sin(phase) * radius;
          const horizontal = (Math.cos(angle) * across - Math.sin(angle) * down) * size;
          const vertical = -(Math.sin(angle) * across + Math.cos(angle) * down) * size;
          if (corner === 0) context.moveTo(horizontal, vertical);
          else context.lineTo(horizontal, vertical);
        }
        context.closePath();
      };
      for (let row = -rows; row <= rows; row++) {
        for (let column = -columns; column <= columns; column++) {
          const leftWave = sample(smoothTraces[0], .5 + .45 * Math.sin(column * .37));
          const rightWave = sample(smoothTraces[1], .5 + .45 * Math.cos(row * .31));
          const outer = .36 + bass * .03 + leftWave * .05;
          const inner = .12 + treble * .10 + rightWave * .04;
          context.beginPath();
          diamond(column + .045, row - .065, outer);
          context.fillStyle = "rgb(0 0 0 / .35)";
          context.fill();
          context.beginPath();
          diamond(column, row, outer);
          diamond(column, row, inner);
          const pigment = ((column + row * 2 + layer) % 3 + 3) % 3;
          const color = [[.20, .145, .07], [.055, .105, .16], [.18, .20, .21]][pigment];
          context.fillStyle = `rgb(${color.map(value => Math.round((value * (1 - layer * .48) * .76) ** .4545 * 255)).join(" ")})`;
          context.fill("evenodd");
        }
      }
    }
  } else if (scene === "polar-plasma") {
    const columns = detail(56, 16);
    const rows = Math.ceil(columns * height / width);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const phase = time * .16 + seed * TAU;
    const bass = Math.max(0, Math.min(1, low));
    const mids = Math.max(0, Math.min(1, mid));
    const treble = Math.max(0, Math.min(1, high));
    const ease = (start, end, value) => {
      const fraction = Math.max(0, Math.min(1, (value - start) / (end - start)));
      return fraction * fraction * (3 - 2 * fraction);
    };
    for (let row = -1; row <= rows; row++) {
      for (let column = -1; column <= columns; column++) {
        const horizontal = ((column + .5) * cellWidth * 2 - width) / scale + Math.sin(phase * .37) * .18;
        const vertical = (height - (row + .5) * cellHeight * 2) / scale + Math.cos(phase * .31) * .18;
        const leftWave = sample(smoothTraces[0], .5 + .45 * horizontal / Math.sqrt(1 + horizontal * horizontal));
        const rightWave = sample(smoothTraces[1], .5 + .45 * vertical / Math.sqrt(1 + vertical * vertical));
        const radius = Math.sqrt(horizontal * horizontal + vertical * vertical + .16);
        const twist = Math.sin(radius * 1.4 - phase * .5) * (.45 + mids * .3) + leftWave * .24 + rightWave * .18 + impact * .12;
        const across = Math.cos(twist) * horizontal + Math.sin(twist) * vertical;
        const down = -Math.sin(twist) * horizontal + Math.cos(twist) * vertical;
        const radialX = across / radius;
        const radialY = down / radius;
        const harmonicX = radialX ** 3 - 3 * radialX * radialY * radialY;
        const harmonicY = 3 * radialX * radialX * radialY - radialY ** 3;
        const field = .5 + .22 * Math.sin(radius * (3.8 + bass * .55) - phase + harmonicX * 1.5)
          + .18 * Math.sin(across * 1.6 + down * 1.3 + phase * .7 + rightWave * .6)
          + (.06 + treble * .04) * Math.cos(radius * 6.1 + harmonicY * 1.4 + phase * .5);
        const ink = [.008, .009, .012];
        const color = [...ink];
        const edgeWidth = .006;
        for (const [target, threshold] of [[[.035, .12, .14], .24], [ink, .38],
          [[.15, .055, .085], .50], [ink, .64], [[.17, .19, .20], .76], [ink, .83]]) {
          const blend = ease(threshold - edgeWidth, threshold + edgeWidth, field);
          for (let component = 0; component < 3; component++) color[component] += (target[component] - color[component]) * blend;
        }
        const light = .72 + Math.max(0, Math.min(1, level)) * .12 + .1 * Math.cos(radius * 1.8 + phase * .3);
        context.fillStyle = `rgb(${color.map(value => Math.round((value * light) ** .4545 * 255)).join(" ")})`;
        context.fillRect(column * cellWidth - centerX, row * cellHeight - centerY, cellWidth + 1, cellHeight + 1);
      }
    }
  } else if (scene === "feedback-bloom") {
    const history = motion?.feedback;
    const count = history?.count ?? 0;
    const points = detail(96, 24);
    const live = { time: history?.time ?? 0, low, impact, level, channels: smoothTraces };
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer <= count; layer++) {
      const frame = layer === count ? live : history.frames[(history.head - count + layer + history.frames.length) % history.frames.length];
      const age = (history?.time ?? 0) - frame.time;
      if (age > 3 || (layer < count && frame.level < .001)) continue;
      const fade = Math.exp(-age * 1.15);
      const reach = scale * (.14 + Math.max(0, Math.min(1, frame.low)) * .065 + Math.min(1.2, frame.impact) * .075) * (1 + age * .42);
      for (let side = 0; side < 2; side++) {
        curve.begin(true);
        for (let point = 0; point < points; point++) {
          const phase = point / points * TAU;
          const angle = phase + time * .045 + seed * TAU + (side ? -1 : 1) * (.16 + age * .22);
          const wave = sample(frame.channels[side], (1 - Math.cos(phase * 3)) * .5);
          const radius = reach * (1 + wave * .42 + Math.cos(phase * 5) * .08);
          curve.point(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        curve.end();
        context.strokeStyle = `hsla(${side ? 350 : 165} 52% ${layer === count ? 80 : 64}% / ${fade * (layer === count ? .5 : .12) * (.25 + Math.min(1, frame.level))})`;
        context.lineWidth = pixelRatio * (layer === count ? 2.2 : 1.3 + age * .55);
        context.stroke();
      }
    }
  } else if (scene === "oscilloscope-orbit") {
    const projection = renderer.orbitProjection ??= { camera: new PerspectiveCamera(48, 1, .1, 80),
      point: new Vector3(), axis: new Vector3() };
    const { camera, point, axis } = projection;
    const movement = renderer.reducedMotion ? .25 : 1;
    const cameraPhase = seed * TAU;
    camera.aspect = width / height;
    camera.position.set(Math.sin(time * .10 + cameraPhase) * 1.1 * movement,
      Math.cos(time * .083 + cameraPhase) * .65 * movement,
      (11.8 + Math.sin(time * .065 + cameraPhase) * .35 * movement) * Math.max(1, .96 / camera.aspect));
    camera.lookAt(Math.sin(time * .073 + cameraPhase) * .42 * movement,
      Math.sin(time * .057 + cameraPhase) * .28 * movement, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const history = motion?.orbitHistory;
    const count = history?.count ?? 0;
    const points = detail(192, 64);
    const live = { time: history?.time ?? 0, clock: time, low, mid, impact, level, channels: smoothTraces };
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer <= count; layer++) {
      const frame = layer === count ? live : history.frames[(history.head - count + layer + history.frames.length) % history.frames.length];
      const age = (history?.time ?? 0) - frame.time;
      if (age > .9 || (layer < count && frame.level < .001)) continue;
      const bass = Math.max(0, Math.min(1, frame.low));
      const mids = Math.max(0, Math.min(1, frame.mid));
      const expansion = 1 + bass * .18 + Math.max(0, Math.min(1.2, frame.impact)) * .28;
      const opacity = Math.exp(-age * 3.5) * (.12 + Math.max(0, Math.min(1, frame.level)) * .7);
      axis.set(.2 + Math.sin(frame.clock * .045 + cameraPhase) * .18 * movement,
        .8, .35 + Math.cos(frame.clock * .037 + cameraPhase) * .12 * movement).normalize();
      for (let side = 0; side < 2; side++) {
        curve.begin(true);
        for (let index = 0; index < points; index++) {
          const phase = index / points * TAU;
          const position = (1 - Math.cos(phase)) * .5;
          const primary = sample(frame.channels[side], position);
          const secondary = sample(frame.channels[1 - side], position);
          point.set(Math.cos(phase) * (1.85 + primary * .8), Math.sin(phase) * (1.05 + secondary * .65),
            Math.sin(phase * 2 + side * Math.PI / 2) * (.35 + mids * .5) + primary * .55);
          point.multiplyScalar(expansion);
          point.applyAxisAngle(axis, frame.clock * .12 + seed * TAU + side * .9);
          point.project(camera);
          curve.point(point.x * width * .5, -point.y * height * .5);
        }
        curve.end();
        if (layer === count) {
          context.strokeStyle = `hsla(${side ? 35 : 195} 75% 70% / ${opacity * .10})`;
          context.lineWidth = pixelRatio * 6;
          context.stroke();
        }
        context.strokeStyle = `hsla(${side ? 35 : 195} 65% ${layer === count ? 82 : 65}% / ${opacity * (layer === count ? 1 : .22)})`;
        context.lineWidth = pixelRatio * (layer === count ? 2 + Math.max(0, Math.min(1, high)) * .8 : 1.2);
        context.stroke();
      }
    }
  } else if (scene === "particle-assembly") {
    if (!renderer.assemblyProjection) {
      const geometry = new TorusKnotGeometry(1.7, .5, 128, 8);
      renderer.assemblyProjection = { camera: new PerspectiveCamera(58, 1, .1, 80),
        point: new Vector3(), axis: new Vector3(.3, .8, .2).normalize(), targets: geometry.getAttribute("position") };
      geometry.dispose();
    }
    const { camera, point, axis, targets } = renderer.assemblyProjection;
    const arc = scene === renderer.scene ? renderer.sceneArc : renderer.previousSceneArc;
    const reveal = arc?.reveal ?? 1;
    const development = arc?.development ?? 1;
    const climax = arc?.climax ?? 0;
    const release = arc?.release ?? 0;
    const gather = Math.min(1, .05 + development * .9 + climax * .2) * (1 - release);
    const response = renderer.reducedMotion ? .25 : 1;
    const bass = Math.max(0, Math.min(1, low));
    const mids = Math.max(0, Math.min(1, mid));
    const treble = Math.max(0, Math.min(1, high));
    const cameraTime = renderer.elapsed ?? time;
    camera.aspect = width / height;
    camera.position.set(Math.sin(cameraTime * .08 + seed * TAU) * .3 * response,
      Math.cos(cameraTime * .065 + seed) * .22 * response,
      (12 - (.25 + Math.sin(cameraTime * .09) * .25 + bass * .2) * response) * Math.max(1, .8 / camera.aspect));
    camera.lookAt(Math.sin(cameraTime * .05 + seed) * .14 * response, Math.cos(cameraTime * .07) * .1 * response, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const hash = value => {
      const noise = Math.sin(value * 127.1 + seed * 311.7) * 43758.5453;
      return noise - Math.floor(noise);
    };
    const count = detail(900, 240);
    const expansion = 1 + (bass * .24 + impact * .35) * response;
    for (let particle = 0; particle < count; particle++) {
      const index = Math.floor(particle / count * targets.count);
      point.fromBufferAttribute(targets, index);
      point.x = point.x * gather + ((hash(index * 3) - .5) * 7 + Math.sin(time * .19 + index) * .3) * (1 - gather);
      point.y = point.y * gather + ((hash(index * 3 + 1) - .5) * 7 + Math.cos(time * .17 + index) * .3) * (1 - gather);
      point.z = point.z * gather + (hash(index * 3 + 2) - .5) * 7 * (1 - gather);
      const position = index / (targets.count - 1);
      const leftWave = sample(smoothTraces[0], position);
      const rightWave = sample(smoothTraces[1], position);
      point.x += leftWave * (.5 + mids * .5) * response;
      point.y += rightWave * (.5 + mids * .5) * response;
      point.z += (leftWave - rightWave) * .3 * response;
      point.multiplyScalar(expansion);
      point.applyAxisAngle(axis, time * .17 + seed * TAU);
      const depth = point.z;
      point.project(camera);
      const horizontal = point.x * width * .5;
      const vertical = -point.y * height * .5;
      const radius = pixelRatio * (1.1 + (depth + 5) * .13 + treble * .6);
      const opacity = (.28 + reveal * .6) * (.65 + depth * .055);
      curve.begin(true);
      curve.point(horizontal - radius, vertical);
      curve.point(horizontal, vertical - radius);
      curve.point(horizontal + radius, vertical);
      curve.point(horizontal, vertical + radius);
      curve.end();
      context.fillStyle = particle % 7 === 0 ? `hsla(8 58% 70% / ${opacity})`
        : particle % 3 === 0 ? `hsla(165 52% 70% / ${opacity})` : `hsla(0 0% 92% / ${opacity})`;
      context.fill();
    }
  } else if (scene === "metaball-foundry") {
    const rings = detail(10, 4);
    const points = detail(32, 12);
    const arc = scene === renderer.scene ? renderer.sceneArc : renderer.previousSceneArc;
    const reveal = arc?.reveal ?? 1;
    const climax = arc?.climax ?? 0;
    const spread = (1 + (arc?.development ?? 1) * .2 + (arc?.release ?? 0) * .25) * (1 - climax * .84);
    for (let body = 0; body < 6; body++) {
      const phase = body / 6 * TAU + time * .19 + seed * TAU;
      const horizontal = body ? Math.cos(phase) * width * .2 * spread : 0;
      const vertical = body ? Math.sin(phase * 1.6) * height * .2 * spread : 0;
      const radius = scale * (.075 + low * .055 + impact * .12)
        * (body ? .15 + reveal * .85 : 1.3 + climax * .6);
      for (let ring = 0; ring < rings; ring++) {
        const depth = 1 - ring / rings;
        curve.begin(true);
        for (let point = 0; point < points; point++) {
          const angle = point / points * TAU;
          curve.point(horizontal + Math.cos(angle) * radius * depth - ring * radius * .015,
            vertical + Math.sin(angle) * radius * depth - ring * radius * .025);
        }
        curve.end();
        context.fillStyle = `hsla(0 0% ${18 + ring / rings * 65}% / .9)`;
        context.fill();
      }
      for (let side = 0; side < 2; side++) {
        curve.begin();
        for (let point = 0; point <= points; point++) {
          const position = point / points;
          const across = (position * 2 - 1) * .9;
          const reflection = ((side ? .22 : -.22) + sample(smoothTraces[side], position) * .32)
            * Math.sqrt(1 - across * across);
          curve.point(horizontal + across * radius, vertical + reflection * radius);
        }
        curve.end();
        context.strokeStyle = "hsla(0 0% 96% / .6)";
        context.lineWidth = lineWidth;
        context.stroke();
      }
    }
  } else if (scene === "copper") {
    const barHeight = height * (.055 + low * .025 + impact * .03);
    for (let bar = 0; bar < 9; bar++) {
      const phase = time * .48 + bar * .57 + seed * TAU;
      const vertical = Math.sin(phase) * height * (.29 + impact * .045)
        + Math.sin(phase * .61 + bar) * height * .06;
      const skew = Math.sin(phase * .37) * width * .06;
      const top = vertical - barHeight * .5;
      const gradient = context.createLinearGradient(0, top, 0, top + barHeight);
      for (let stop = 0; stop <= 16; stop++) {
        const position = stop / 16;
        const shine = Math.sin(position * Math.PI) ** 3;
        gradient.addColorStop(position, ink(palette[bar % 2] + bar * 8,
          .5 + shine * .45, 12 + shine * (58 + high * 12)));
      }
      context.fillStyle = gradient;
      context.fillRect(-width * .6 + skew, top, width * 1.2, barHeight);
    }
    const points = detail(128, 40);
    for (let ribbon = 0; ribbon < 3; ribbon++) {
      curve.begin();
      for (let point = 0; point <= points; point++) {
        const position = point / points;
        curve.point((position - .5) * width,
          Math.sin(position * TAU * 1.5 + time * .7 + ribbon * 2) * height * (.14 + mid * .08)
          + audio(position, ribbon % 2) * scale * (.08 + impact * .05));
      }
      curve.end();
      stroke(context, 175 + ribbon * 24, .65, lineWidth * .7);
    }
  } else if (scene === "checker-tunnel") {
    const rings = detail(30, 12);
    const sectors = detail(28, 12);
    const reach = Math.hypot(width, height) * .85;
    const travel = time * .7;
    const shift = travel % 1;
    const cell = Math.floor(travel);
    const vertex = (depth, sector) => {
      const radius = scale * .025 + reach * depth ** 2.3;
      const angle = sector / sectors * TAU + Math.sin(time * .21 + depth * 2) * .35
        + depth * (.55 + mid * .3) + impact * .13;
      const bend = (1 - depth) ** 2;
      return [Math.cos(angle) * radius + Math.sin(time * .31) * width * .15 * bend,
        Math.sin(angle) * radius + Math.cos(time * .27) * height * (.13 + low * .08 + impact * .07) * bend];
    };
    for (let ring = 0; ring < rings; ring++) {
      const near = (ring + shift) / rings;
      const far = (ring + 1 + shift) / rings;
      for (let sector = 0; sector < sectors; sector++) {
        const bright = ((ring - cell + sector) % 2 + 2) % 2;
        const corners = [vertex(near, sector), vertex(far, sector), vertex(far, sector + 1), vertex(near, sector + 1)];
        context.beginPath();
        context.moveTo(...corners[0]);
        for (const corner of corners.slice(1)) context.lineTo(...corner);
        context.closePath();
        context.fillStyle = ink(palette[bright], .35 + Math.min(1, far) * .55,
          bright ? 28 + level * 20 + Math.min(1, far) * 16 : 7 + Math.min(1, far) * 5);
        context.fill();
      }
    }
  } else if (scene === "raster-twist") {
    const slices = detail(128, 40);
    const span = height * .94;
    const ribbonWidth = Math.min(width * .3, height * .26) * (1 + low * .25 + impact * .22);
    for (let slice = 0; slice < slices; slice++) {
      const position = slice / slices;
      const next = (slice + 1) / slices;
      const phaseAt = value => time * .75 + Math.sin(value * TAU + time * .23) * (1.5 + mid)
        + value * TAU * (1.25 + impact * .18);
      const centerAt = value => Math.sin(value * TAU * .5 + time * .36) * width * .18
        + audio(value) * scale * .035;
      for (let face = 0; face < 4; face++) {
        const phase = phaseAt(position) + face * Math.PI / 2;
        const nextPhase = phaseAt(next) + face * Math.PI / 2;
        const front = Math.sin(phase + Math.PI / 4);
        const start = centerAt(position);
        const end = centerAt(next);
        context.beginPath();
        context.moveTo(start + Math.cos(phase) * ribbonWidth, (position - .5) * span);
        context.lineTo(end + Math.cos(nextPhase) * ribbonWidth, (next - .5) * span);
        context.lineTo(end + Math.cos(nextPhase + Math.PI / 2) * ribbonWidth, (next - .5) * span);
        context.lineTo(start + Math.cos(phase + Math.PI / 2) * ribbonWidth, (position - .5) * span);
        context.closePath();
        context.fillStyle = ink(palette[face % 2] + face * 12,
          front > 0 ? .92 : 0, 18 + Math.max(0, front) ** 3 * (55 + high * 12));
        context.fill();
      }
    }
  } else if (scene === "dot-vortex") {
    const rings = detail(38, 14);
    const spokes = detail(56, 18);
    for (let ring = rings - 1; ring >= 0; ring--) {
      const depth = (ring + 1) / rings;
      for (let spoke = 0; spoke < spokes; spoke++) {
        const angle = spoke / spokes * TAU + time * .25 + depth * (3 + mid * 1.5);
        const wave = Math.sin(angle * 3 - time * .8 + depth * 9);
        const radius = scale * depth * (.39 + low * .07 + impact * .09)
          * (1 + wave * (.12 + high * .08));
        const horizontal = Math.cos(angle) * radius * (1.1 + Math.sin(time * .17) * .2);
        const vertical = Math.sin(angle) * radius * height / scale * .85;
        const size = Math.max(pixelRatio, scale * .0045) * (.4 + depth * 1.3 + level * .5);
        context.fillStyle = ink(palette[spoke % 2] + wave * 18, .3 + depth * .65, 52 + wave * 18 + high * 12);
        context.fillRect(horizontal - size * .5, vertical - size * .5, size, size);
      }
    }
  } else if (scene === "terrain") {
    const layers = 5;
    const points = detail(64, 24);
    const previousRidge = renderer.terrainRidge ??= new Float64Array(65);
    const minimumGap = height * .065;
    const spacingSoftness = height * .035;
    const floor = height - centerY;
    const padding = Math.max(width, height) * .12;
    const terrainTime = time;
    const response = renderer.reducedMotion ? .3 : 1;
    const hue = 150 + seed * 30 + Math.sin(terrainTime * .08) * 18;
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer < layers; layer++) {
      const depth = layer / (layers - 1);
      const side = layer % 2 ? 0 : 1;
      const data = smoothTraces[side];
      const energyData = motion?.energyChannels?.[side];
      const band = Math.min(1, bands[layer] * 2.5);
      const base = height * (.28 + depth * .64) - centerY
        - height * response * (low * (.025 + depth * .025) + impact * (.035 + (1 - depth) * .035));
      const amplitude = height * (.035 + (layers - 1 - layer) * .009
        + response * (low * .075 + band * .045 + impact * .055));
      let bottom = floor + padding;
      let gradientTop = base - amplitude;
      curve.begin();
      for (let point = 0; point <= points; point++) {
        const position = point / points;
        const energy = sample(energyData, position);
        const contour = energyData ? energy * 5 / (1 + energy * 4) : Math.abs(audio(position, side));
        const swell = Math.sin(position * TAU * (1.4 + layer * .18) + terrainTime * .15 + band * response * .8);
        const ripple = Math.sin(position * TAU * (4 + layer) - terrainTime * .4 + depth * 3);
        const wave = contour * amplitude * (1 + mid * response)
          + swell * amplitude * .5
          + sample(data, position) * height * .1 * response
          + ripple * height * high * .018 * response;
        const headroom = Math.max(height * .04, base + centerY - height * .04);
        let vertical = base - headroom * Math.tanh(wave / headroom);
        if (layer > 0) {
          const boundary = previousRidge[point] + minimumGap;
          const distance = vertical - boundary;
          vertical = boundary + (distance + Math.hypot(distance, spacingSoftness)) * .5;
        }
        previousRidge[point] = vertical;
        if (point === 0) curve.point(-centerX - padding, vertical);
        curve.point(position * width - centerX, vertical);
        if (point === points) curve.point(width - centerX + padding, vertical);
        bottom = Math.max(bottom, vertical + padding);
        gradientTop = Math.min(gradientTop, vertical);
      }
      curve.end();
      context.lineTo(width - centerX + padding, bottom);
      context.lineTo(-centerX - padding, bottom);
      context.closePath();
      const gradient = context.createLinearGradient(0, gradientTop, 0, floor);
      gradient.addColorStop(0, `hsla(${hue + layer * 18} 94% 68% / ${.13 + (8 - layer) * .012})`);
      gradient.addColorStop(1, `hsla(${hue + 110 + layer * 9} 84% 24% / .015)`);
      context.fillStyle = gradient;
      if (context.fillBelowCurve) context.fillBelowCurve(bottom);
      else context.fill();
    }
    const streaks = detail(64, 18);
    for (let streak = 0; streak < streaks; streak++) {
      const identity = streak + seed * 997;
      const random = (offset) => {
        const value = Math.sin(identity * 12.9898 + offset * 78.233) * 43758.5453;
        return value - Math.floor(value);
      };
      const speed = .08 + random(1) * .16;
      const travel = time * speed * .65;
      const depth = 1 - ((random(2) + travel) % 1);
      const projection = 1 / Math.max(.02, depth);
      const previousProjection = 1 / Math.max(.02, depth + speed * .025);
      const angle = random(3) * TAU + terrainTime * (random(4) - .5) * .08;
      const radius = (.15 + random(5) * 1.15) * scale * .055;
      const horizontal = Math.cos(angle) * radius * projection;
      const vertical = Math.sin(angle) * radius * projection * .72;
      if (Math.abs(horizontal) > width * .52 || Math.abs(vertical) > height * .52) continue;
      const fade = Math.min(1, depth / .08, (1 - depth) / .12);
      context.beginPath();
      context.moveTo(Math.cos(angle) * radius * previousProjection, Math.sin(angle) * radius * previousProjection * .72);
      context.lineTo(horizontal, vertical);
      context.strokeStyle = `hsla(${hue + 35 + random(5) * 84} 92% 72% / ${fade * Math.min(.7, (1 - depth) * .65 + high * .25)})`;
      context.lineWidth = Math.max(.6 * pixelRatio, (.35 + random(6) * 1.7) * Math.min(3.5, projection * .16) * pixelRatio);
      context.stroke();
    }
  } else if (scene === "helix") {
    const points = detail(150, 48);
    const hue = 116 + seed * 210 + Math.sin(time * .08) * 28 + high * 56;
    const amplitude = height * (.3 + low * .0675 + impact * .11);
    const ordinate = (position, strand) => sample(smoothTraces[strand], position) * amplitude * (strand ? -1 : 1);
    context.globalCompositeOperation = "lighter";
    for (let strand = 0; strand < 2; strand++) {
      curve.begin();
      for (let point = 0; point <= points; point++) {
        const position = point / points;
        curve.point(position * width - centerX, ordinate(position, strand));
      }
      curve.end();
      context.strokeStyle = `hsla(${hue + strand * 112} 96% 70% / ${.48 + level * .32})`;
      context.lineWidth = Math.max(lineWidth, width * .0022);
      context.stroke();
    }
    for (let rung = 0; rung <= 25; rung++) {
      const position = rung / 25;
      const horizontal = position * width - centerX;
      context.beginPath();
      context.moveTo(horizontal, ordinate(position, 0));
      context.lineTo(horizontal, ordinate(position, 1));
      context.strokeStyle = `hsla(${hue + rung * 6 * 1.8} 84% 70% / ${.08 + mid * .2})`;
      context.lineWidth = pixelRatio;
      context.stroke();
    }
  } else if (scene === "monolith") {
    const floor = height * .82 - centerY;
    const hue = 150 + seed * 30 + Math.sin(time * .08) * 18;
    context.globalCompositeOperation = "lighter";
    for (let slab = -9; slab <= 9; slab++) {
      const position = (slab + 9) / 18;
      const energy = Math.abs(sample(left, position));
      const distance = Math.abs(slab) / 9;
      const barWidth = width * (.018 + (1 - distance) * .016);
      const barHeight = height * (.12 + (1 - distance) * .48 + energy * .22 + impact * .03);
      const horizontal = slab * width * .043 - barWidth / 2;
      const gradient = context.createLinearGradient(horizontal, floor - barHeight, horizontal + barWidth, floor);
      gradient.addColorStop(0, `hsla(${hue + distance * 120} 92% 74% / .5)`);
      gradient.addColorStop(.45, `hsla(${hue + 35} 90% 52% / .12)`);
      gradient.addColorStop(1, `hsla(${hue + 145} 96% 66% / .4)`);
      context.fillStyle = gradient;
      context.fillRect(horizontal, floor - barHeight, barWidth, barHeight);
      context.save();
      context.globalAlpha *= .23;
      context.fillRect(horizontal, floor + 5 * pixelRatio, barWidth, barHeight * .38);
      context.restore();
    }
  } else if (scene === "wavegarden") {
    const layers = 10;
    const points = detail(96, 36);
    const hue = 150 + seed * 30 + Math.sin(time * .08) * 18;
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer < layers; layer++) {
      const depth = layer / (layers - 1);
      const base = height * (.08 + depth * .82) - centerY;
      const amplitude = height * (.025 + (1 - depth) * .07 + low * .025 + impact * .025);
      const drift = Math.sin(time * (.08 + depth * .03) + layer * .7) * amplitude * .55;
      curve.begin();
      for (let point = 0; point <= points; point++) {
        const position = point / points;
        const vertical = base + drift + sample(smoothTraces[layer % 2], position) * amplitude * 2.2;
        curve.point(position * width - centerX, vertical);
      }
      curve.end();
      context.strokeStyle = `hsla(${hue + depth * 180} 94% 70% / ${.12 + (1 - depth) * .16 + mid * .1})`;
      context.lineWidth = lineWidth * (1.6 + (1 - depth) * 1.3);
      context.stroke();
    }
  } else if (scene === "silk") {
    const strands = detail(18, 7);
    const points = detail(160, 60);
    const strandWidth = Math.min(lineWidth * .45, width * 1.12 / 160 * .45, height * .55 / (strands - 1) * .22);
    for (let family = 0; family < 2; family++) {
      for (let strand = 0; strand < strands; strand++) {
        const depth = strand / (strands - 1);
        const drift = Math.sin(time * .18 + family * 2.7 + depth * .7) * height * .035;
        const amplitude = height * (.2 + low * .1 + impact * .11) * (.55 + depth * .45);
        curve.begin();
        for (let point = 0; point <= points; point++) {
          const position = point / points;
          const horizontal = (position - .5) * width * 1.12;
          const vertical = (depth - .5) * height * .55 + (family ? 1 : -1) * height * .06
            + drift + sample(smoothTraces[family], position) * amplitude;
          curve.point(horizontal, vertical);
        }
        curve.end();
        stroke(context, palette[family] + depth * 15, .16 + depth * .34 + level * .12, strandWidth);
      }
    }
  } else if (scene === "contours") {
    const layers = detail(26, 10);
    const points = detail(160, 56);
    for (let layer = 0; layer < layers; layer++) {
      const depth = layer / (layers - 1);
      curve.begin();
      for (let point = 0; point <= points; point++) {
        const position = point / points;
        const horizontal = (position - .5) * width * 1.08;
        const ridge = Math.exp(-Math.pow((position - .32 - Math.sin(time * .09) * .08) * 5, 2));
        const valley = Math.exp(-Math.pow((position - .73) * 6, 2));
        const wave = Math.sin(position * TAU * 2 + depth * 4 - time * .16);
        const vertical = (depth - .5) * height * .74 - ridge * scale * (.09 + low * .19 + impact * .13) * Math.sin(depth * Math.PI)
          + valley * scale * .15 * Math.cos(depth * 4) + wave * scale * (.024 + impact * .035)
          + audio(position, layer % 2) * scale * .07 * (mid + .3);
        curve.point(horizontal, vertical);
      }
      curve.end();
      stroke(context, layer % 6 === 0 ? palette[1] : palette[0] + depth * 22, .25 + depth * .4, lineWidth * (layer % 6 === 0 ? 1.6 : 1));
    }
  } else if (scene === "diffraction") {
    const lines = detail(32, 12);
    const spread = scale * (.15 + low * .2 + impact * .18);
    for (let family = 0; family < 2; family++) {
      context.save();
      context.rotate((family ? -1 : 1) * (.3 + Math.sin(time * .11) * .17 + impact * .11));
      for (let line = 0; line < lines; line++) {
        const depth = line / (lines - 1);
        const offset = (depth - .5) * spread * 2;
        const bend = audio(depth, family) * scale * .16 + Math.sin(depth * TAU + time * .3) * scale * .05;
        context.beginPath();
        context.moveTo(-width * .58, offset * 1.6);
        context.bezierCurveTo(-width * .2, offset * .25 + bend, width * .2, -offset * .25 - bend, width * .58, -offset * 1.6);
        stroke(context, palette[family] + depth * 14, .22 + Math.sin(depth * Math.PI) * .43, lineWidth);
      }
      context.restore();
    }
  } else if (scene === "cascade") {
    const columns = width > height ? 60 : 36;
    const rows = 28;
    const cellWidth = width * .88 / columns;
    const cellHeight = height * .65 / rows;
    const travel = time * .17;
    for (let column = 0; column < columns; column++) {
      const position = column / (columns - 1);
      const band = bands[Math.min(5, Math.floor(position * 6))];
      const energy = Math.min(1, Math.abs(audio(position, column % 2)) * .55 + band * level * 1.8 + level * .18 + impact * .26);
      for (let row = 0; row < rows; row++) {
        const depth = row / rows;
        const phase = ((depth + position * .65 - travel) % 1 + 1) % 1;
        const crest = Math.pow(.5 + Math.cos(phase * TAU) * .5, 6);
        const alpha = .06 + crest * (.3 + energy * .55);
        const horizontal = -width * .44 + column * cellWidth;
        const vertical = -height * .325 + row * cellHeight + Math.sin(position * TAU + time * .2) * scale * (.02 + impact * .06);
        context.fillStyle = ink(palette[0] + depth * 22 + (palette[1] - palette[0] - depth * 22) * crest, alpha, 56 + energy * 20);
        context.fillRect(horizontal, vertical, cellWidth * .72, cellHeight * (.28 + energy * .4));
      }
      const cap = energy * height * .18;
      context.fillStyle = ink(palette[1], .65);
      context.fillRect(-width * .44 + column * cellWidth, height * .36 - cap, cellWidth * .72, Math.max(lineWidth, cap));
    }
  } else if (scene === "interference") {
    const lines = detail(24, 10);
    const points = detail(120, 48);
    const separation = scale * (.08 + .07 * Math.sin(time * .13) + low * .08 + impact * .09);
    for (let family = 0; family < 2; family++) {
      for (let line = 0; line < lines; line++) {
        const depth = line / (lines - 1);
        const radius = scale * (.06 + depth * .42) * (1 + impact * .13);
        curve.begin(true);
        for (let point = 0; point < points; point++) {
          const position = point / points;
          const angle = position * TAU;
          const wave = audio(position, family) * scale * .06 * (1 + high);
          const horizontal = (family ? separation : -separation) + Math.cos(angle) * (radius + wave);
          const vertical = Math.sin(angle) * (radius + wave) * (.65 + mid * .15);
          curve.point(horizontal, vertical);
        }
        curve.end();
        stroke(context, palette[family] + depth * 10, .16 + (1 - depth) * .3, lineWidth * .85);
      }
    }
  } else if (scene === "weave") {
    const ribbons = detail(14, 6);
    const points = detail(160, 56);
    for (let ribbon = 0; ribbon < ribbons; ribbon++) {
      const depth = ribbon / (ribbons - 1);
      const family = ribbon % 2;
      curve.begin(true);
      for (let point = 0; point < points; point++) {
        const position = point / points;
        const angle = position * TAU;
        const phase = time * .16 + depth * .85 + impact * .5;
        const horizontal = Math.sin(angle * 2 + phase) * width * (.23 + depth * .09 + impact * .035);
        const vertical = Math.sin(angle * 3 - phase * .7) * height * (.17 + low * .13 + impact * .07)
          + audio(position, family) * scale * .075 * (1 + mid);
        curve.point(horizontal, vertical);
      }
      curve.end();
      stroke(context, palette[family] + depth * 18, .19 + level * .25, lineWidth);
    }
  } else if (scene === "prism") {
    const voices = [low, mid, high].map((energy, index) => ({
      energy: Math.min(1, energy + impact * .3),
      duty: Math.min(1, .2 + bands[index * 2] * 2)
    }));
    const cutoff = Math.min(1, (bands[3] + bands[4] + bands[5]) * 1.5);
    drawCrystalFacets(context, scale, time, 12, detail(9, 3), cutoff, voices,
      (voiceIndex, position) => audio(position % 1, voiceIndex % 2));
  } else {
    const blades = 6;
    const response = renderer.reducedMotion ? .3 : 1;
    const reach = Math.hypot(width, height);
    const travel = (renderer.elapsed ?? time) * .14 + seed * TAU;
    const zoom = 1.12 + response * (.2 + Math.sin(travel) * .2);
    context.translate(Math.sin(travel * .73) * scale * .075 * response,
      Math.cos(travel * .57) * scale * .055 * response);
    context.rotate(Math.sin(travel * .61) * .14 * response);
    const envelope = motion?.energyChannels?.[0] ?? left ?? [];
    let pressure = 0;
    for (const value of envelope) pressure += Math.abs(value);
    pressure /= Math.max(1, envelope.length);
    const frequencyGroups = [bands[0], (bands[1] + bands[2]) * .5, (bands[3] + bands[4]) * .5, bands[5]];
    const irises = frequencyGroups.map((group, layer) => {
      const frequency = Math.min(1, group * level * 6);
      const direction = layer % 2 ? 1 : -1;
      return {
        frequency,
        opacity: .28 + frequency * .2,
        rotation: seed * TAU + layer * .27 + direction * response
          * (time * (.075 + layer * .018) + frequency * .28 + impact * .12),
        twist: .52 + response * (frequency * .18 + impact * .12),
        inner: scale * zoom * (.105 + layer * .035
          + response * (frequency * .075 + impact * .04 + pressure * .12))
      };
    });
    const mirrorAxis = seed * TAU;
    const opticalInk = (hue, alpha, lightness) => `hsla(${hue} ${lightness > 65 ? 18 : 58}% ${lightness}% / ${alpha})`;
    const polar = (radius, angle) => [Math.cos(angle) * radius, Math.sin(angle) * radius];
    context.beginPath();
    for (let corner = 0; corner < 12; corner++) {
      const point = polar(irises[3].inner * 1.8, mirrorAxis + corner / 12 * TAU);
      if (corner === 0) context.moveTo(...point);
      else context.lineTo(...point);
    }
    context.closePath();
    context.fillStyle = opticalInk(palette[0], .95, 7 + irises[0].frequency * 5);
    context.fill();
    for (let layer = 0; layer < irises.length; layer++) {
      const iris = irises[layer];
      for (let shell = 2; shell >= 0; shell--) {
        const folded = .5 - .5 * Math.cos((iris.rotation + shell * iris.twist) * 6);
        const tip = (.18 + folded * .64) * Math.PI / 6;
        const inner = iris.inner * (.035 + shell * .24);
        const outer = iris.inner * (.48 + shell * .48);
        const hue = palette[(shell + layer) % palette.length];
        for (let sector = 0; sector < 6; sector++) {
          const axis = mirrorAxis + sector / 6 * TAU;
          for (const mirror of [-1, 1]) {
            curve.begin(true);
            curve.point(...polar(inner, axis));
            curve.point(...polar(outer, axis + mirror * tip));
            curve.point(...polar(inner + (outer - inner) * .55, axis + mirror * Math.PI / 6));
            curve.point(...polar(inner * .6, axis + mirror * tip));
            curve.end();
            context.fillStyle = opticalInk(hue, iris.opacity * .6 + .06, 24 + folded * 24 + iris.frequency * 14);
            context.fill();
          }
        }
      }
    }
    for (let layer = 0; layer < 4; layer++) {
      const side = layer % 2;
      const { frequency, opacity, rotation, twist, inner } = irises[layer];
      const energyData = motion?.energyChannels?.[side];
      const contourAt = position => {
        const energy = energyData ? sample(energyData, position) : Math.abs(sample(side ? right : left, position));
        return energy * 4 / (1 + energy * 3);
      };
      const outer = reach * (.72 - layer * .045) * zoom;
      for (let blade = 0; blade < blades; blade++) {
        const contour = contourAt((blade + .5) / blades);
        const energy = Math.min(1, frequency * .7 + contour * .3);
        const start = blade / blades * TAU + rotation;
        const hue = palette[(blade + layer) % palette.length];
        const gradient = context.createLinearGradient(
          Math.cos(start) * inner, Math.sin(start) * inner,
          Math.cos(start + twist) * outer, Math.sin(start + twist) * outer);
        gradient.addColorStop(0, opticalInk(hue, opacity + .12, 70 + energy * 10));
        gradient.addColorStop(.28, opticalInk(hue, opacity, 32 + energy * 12));
        gradient.addColorStop(.52, opticalInk(hue, opacity * .65, 8 + energy * 4));
        gradient.addColorStop(.78, opticalInk(hue, opacity + .08, 68 + energy * 10));
        gradient.addColorStop(1, opticalInk(hue, opacity * .8, 14 + energy * 9));
        const end = start + TAU / blades;
        const tipX = Math.cos(start) * inner;
        const tipY = Math.sin(start) * inner;
        const heelX = Math.cos(start + twist) * outer;
        const heelY = Math.sin(start + twist) * outer;
        context.beginPath();
        context.moveTo(tipX, tipY);
        context.lineTo(heelX, heelY);
        context.lineTo(Math.cos(end + twist + .08) * outer, Math.sin(end + twist + .08) * outer);
        context.lineTo(Math.cos(end) * inner, Math.sin(end) * inner);
        context.closePath();
        context.fillStyle = gradient;
        context.fill();
        stroke(context, hue, .025 + frequency * .04, lineWidth * .7);
        context.beginPath();
        context.moveTo(tipX, tipY);
        context.lineTo(Math.cos(end) * inner, Math.sin(end) * inner);
        stroke(context, hue, .08 + frequency * .12, lineWidth * .55);
      }
    }
  }
  context.restore();
}