const TAU = Math.PI * 2;
const SCENES = [
  "orbit", "horizon", "lattice", "aurora", "cathedral", "vortex", "constellation", "prism",
  "helix", "monolith", "bloom", "rainfall", "eclipse", "ribbons", "tunnel", "terrain", "pulsefield", "infinity",
  "kaleidoscope", "quasar", "wavegarden", "dreamweb"
];
const SPECTRAL_POINTS = 256;
const SPECTRAL_BINS = [2, 3, 5, 7, 10, 14, 20, 28, 39, 54, 72, 96];
let spectralKernels;

function getSpectralKernels() {
  spectralKernels ??= SPECTRAL_BINS.map((bin) => {
    const cosine = new Float32Array(SPECTRAL_POINTS);
    const sine = new Float32Array(SPECTRAL_POINTS);
    for (let index = 0; index < SPECTRAL_POINTS; index++) {
      const window = 0.5 - 0.5 * Math.cos(TAU * index / (SPECTRAL_POINTS - 1));
      const angle = TAU * bin * index / SPECTRAL_POINTS;
      cosine[index] = Math.cos(angle) * window;
      sine[index] = Math.sin(angle) * window;
    }
    return { cosine, sine };
  });
  return spectralKernels;
}

function randomUnit() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 0x100000000;
  }
  return Math.random();
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(randomUnit() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function follow(delta, timeConstant) {
  return 1 - Math.exp(-delta / Math.max(0.001, timeConstant));
}

function sampleAt(data, position) {
  if (!data?.length) return 0;
  return data[Math.min(data.length - 1, Math.max(0, Math.floor(position * data.length)))] || 0;
}

function hsla(hue, saturation, lightness, alpha = 1) {
  return `hsla(${((hue % 360) + 360) % 360} ${saturation}% ${lightness}% / ${alpha})`;
}

export class ImmersiveVisualizer {
  constructor(canvas, { getSource, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.getSource = getSource;
    this.reducedMotion = reducedMotion;
    this.scene = SCENES[Math.floor(randomUnit() * SCENES.length)];
    this.previousScene = this.scene;
    this.sceneDeck = shuffle(SCENES.filter((scene) => scene !== this.scene));
    this.sceneSeed = randomUnit();
    this.previousSceneSeed = this.sceneSeed;
    this.sceneElapsed = 0;
    this.sceneDuration = 26;
    this.sceneTransition = 1;
    this.transitionDuration = 1;
    this.canvas.dataset.scene = this.scene;
    this.animationFrame = undefined;
    this.lastTime = 0;
    this.elapsed = 0;
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.camera = {
      x: 0,
      y: 0,
      zoom: 1.035,
      roll: 0,
      velocityX: 0,
      velocityY: 0,
      velocityZoom: 0,
      velocityRoll: 0,
      gazeX: 0,
      gazeY: 0,
      nextGazeAt: 0,
      microX: 0,
      microY: 0,
      kick: 0,
      phase: randomUnit() * TAU
    };
    this.signal = { level: 0, peak: 0, low: 0, mid: 0, high: 0, flux: 0 };
    this.previousSignal = { low: 0, mid: 0, high: 0 };
    this.tone = { bands: Array(6).fill(1 / 6), centroid: 0.5 };
    this.music = {
      time: 0,
      fastEnergy: 0,
      slowEnergy: 0,
      longEnergy: 0,
      onsetAverage: 0.018,
      onsetDeviation: 0.012,
      lastBeatAt: -10,
      beatInterval: 0.5,
      beatCount: 0,
      beatsSinceScene: 0,
      quietDuration: 0,
      dropArmed: false,
      sectionFast: 0,
      sectionSlow: 0,
      sectionShiftDuration: 0,
      toneFast: Array(6).fill(1 / 6),
      toneSlow: Array(6).fill(1 / 6),
      toneCentroidFast: 0.5,
      toneCentroidSlow: 0.5,
      toneShiftDuration: 0,
      toneReady: false,
      previousLow: 0
    };
    this.canvas.dataset.transitionReason = "opening";
    this.channels = [];
    this.particles = Array.from({ length: reducedMotion ? 54 : 110 }, (_, index) => this.createParticle(index / 110));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.onPointerMove = (event) => {
      this.pointer.targetX = event.clientX / Math.max(1, innerWidth) * 2 - 1;
      this.pointer.targetY = event.clientY / Math.max(1, innerHeight) * 2 - 1;
    };
    this.onPointerLeave = () => {
      this.pointer.targetX = 0;
      this.pointer.targetY = 0;
    };
  }

  createParticle(depth = Math.random()) {
    return {
      angle: Math.random() * TAU,
      radius: 0.15 + Math.random() * 1.15,
      depth: depth || Math.random(),
      speed: 0.08 + Math.random() * 0.16,
      size: 0.35 + Math.random() * 1.7,
      drift: (Math.random() - 0.5) * 0.08
    };
  }

  start() {
    if (this.animationFrame !== undefined) return;
    this.resize();
    this.lastTime = performance.now();
    addEventListener("pointermove", this.onPointerMove, { passive: true });
    addEventListener("pointerleave", this.onPointerLeave);
    this.animationFrame = requestAnimationFrame((time) => this.draw(time));
  }

  stop() {
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    removeEventListener("pointermove", this.onPointerMove);
    removeEventListener("pointerleave", this.onPointerLeave);
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  readSignal() {
    const source = this.getSource?.();
    const channels = [];
    if (source) {
      try {
        for (let index = 0; index < Math.min(8, source.streamCount); index++) channels.push(source.readChannel(index));
      } catch {
        channels.length = 0;
      }
    }
    this.channels = channels;
    if (!channels.length) {
      const idle = 0.035 + Math.sin(this.elapsed * 0.7) * 0.008;
      this.smoothSignal({ level: idle, peak: idle, low: idle, mid: idle * 0.7, high: idle * 0.4 });
      return;
    }

    const points = SPECTRAL_POINTS;
    const monoSamples = new Float32Array(points);
    let squareSum = 0;
    let peak = 0;
    let low = 0;
    let mid = 0;
    let high = 0;
    let previous = 0;
    let slow = 0;
    let fast = 0;
    for (let index = 0; index < points; index++) {
      const position = index / points;
      const mono = channels.reduce((sum, data) => sum + sampleAt(data, position), 0) / channels.length;
      monoSamples[index] = mono;
      slow += (mono - slow) * 0.055;
      fast += (mono - fast) * 0.24;
      squareSum += mono * mono;
      peak = Math.max(peak, Math.abs(mono));
      low += Math.abs(slow);
      mid += Math.abs(fast - slow);
      high += Math.abs(mono - previous);
      previous = mono;
    }
    this.readTone(monoSamples);
    this.smoothSignal({
      level: clamp(Math.pow(Math.sqrt(squareSum / points), 0.45) * 1.6),
      peak: clamp(Math.sqrt(peak) * 1.2),
      low: clamp(Math.pow(low / points, 0.45) * 2.4),
      mid: clamp(Math.pow(mid / points, 0.45) * 2.6),
      high: clamp(Math.pow(high / points, 0.45) * 2)
    });
  }

  readTone(samples) {
    const magnitudes = getSpectralKernels().map(({ cosine, sine }) => {
      let real = 0;
      let imaginary = 0;
      for (let index = 0; index < samples.length; index++) {
        real += samples[index] * cosine[index];
        imaginary -= samples[index] * sine[index];
      }
      return Math.hypot(real, imaginary);
    });
    const bands = Array.from({ length: 6 }, (_, index) => magnitudes[index * 2] + magnitudes[index * 2 + 1]);
    const total = Math.max(Number.EPSILON, bands.reduce((sum, value) => sum + value, 0));
    this.tone.bands = bands.map((value) => value / total);
    this.tone.centroid = this.tone.bands.reduce((sum, value, index) => sum + value * (index + 0.5) / 6, 0);
    if (!this.music.toneReady) {
      this.music.toneFast = [...this.tone.bands];
      this.music.toneSlow = [...this.tone.bands];
      this.music.toneCentroidFast = this.tone.centroid;
      this.music.toneCentroidSlow = this.tone.centroid;
      this.music.toneReady = true;
    }
  }

  smoothSignal(next) {
    const flux = Math.max(0, next.low - this.previousSignal.low) + Math.max(0, next.mid - this.previousSignal.mid) + Math.max(0, next.high - this.previousSignal.high);
    for (const key of ["level", "peak", "low", "mid", "high"]) {
      const response = next[key] > this.signal[key] ? 0.34 : 0.09;
      this.signal[key] = mix(this.signal[key], next[key], response);
    }
    this.signal.flux = mix(this.signal.flux, clamp(flux * 2.4), flux > this.signal.flux ? 0.5 : 0.08);
    this.previousSignal = next;
  }

  analyzeMusic(delta) {
    const music = this.music;
    music.time += delta;
    const energy = clamp(this.signal.low * 0.46 + this.signal.mid * 0.34 + this.signal.high * 0.2);
    music.fastEnergy = mix(music.fastEnergy, energy, follow(delta, 0.08));
    music.slowEnergy = mix(music.slowEnergy, energy, follow(delta, 0.72));
    music.longEnergy = mix(music.longEnergy, energy, follow(delta, 7.5));

    const lowRise = Math.max(0, this.signal.low - music.previousLow);
    const onset = Math.max(0, music.fastEnergy - music.slowEnergy) + this.signal.flux * 0.48 + lowRise * 0.34;
    music.previousLow = this.signal.low;
    music.onsetAverage = mix(music.onsetAverage, onset, follow(delta, 2.8));
    music.onsetDeviation = mix(music.onsetDeviation, Math.abs(onset - music.onsetAverage), follow(delta, 3.8));
    const threshold = music.onsetAverage + music.onsetDeviation * 1.75 + 0.008;
    const minimumBeatGap = clamp(music.beatInterval * 0.52, 0.22, 0.42);
    const beat = onset > threshold && music.time - music.lastBeatAt > minimumBeatGap;
    const strongBeat = beat && onset > threshold * 1.55;
    if (beat) {
      const interval = music.time - music.lastBeatAt;
      if (interval >= 0.28 && interval <= 1.2) music.beatInterval = mix(music.beatInterval, interval, 0.18);
      music.lastBeatAt = music.time;
      music.beatCount++;
      music.beatsSinceScene++;
    }

    const balance = this.signal.low * 0.78 + this.signal.mid * 0.22 - this.signal.high * 0.62;
    music.sectionFast = mix(music.sectionFast, balance, follow(delta, 0.8));
    music.sectionSlow = mix(music.sectionSlow, balance, follow(delta, 9));
    const sectionDifference = Math.abs(music.sectionFast - music.sectionSlow);
    music.sectionShiftDuration = sectionDifference > 0.13 ? music.sectionShiftDuration + delta : Math.max(0, music.sectionShiftDuration - delta * 1.5);

    for (let index = 0; index < this.tone.bands.length; index++) {
      music.toneFast[index] = mix(music.toneFast[index], this.tone.bands[index], follow(delta, 0.65));
      music.toneSlow[index] = mix(music.toneSlow[index], this.tone.bands[index], follow(delta, 11));
    }
    music.toneCentroidFast = mix(music.toneCentroidFast, this.tone.centroid, follow(delta, 0.65));
    music.toneCentroidSlow = mix(music.toneCentroidSlow, this.tone.centroid, follow(delta, 11));
    const bandDistance = music.toneFast.reduce((sum, value, index) => sum + Math.abs(value - music.toneSlow[index]), 0) * 0.5;
    const centroidDistance = Math.abs(music.toneCentroidFast - music.toneCentroidSlow);
    const toneDistance = bandDistance + centroidDistance * 0.7;
    music.toneShiftDuration = toneDistance > 0.105 && music.fastEnergy > 0.06
      ? music.toneShiftDuration + delta
      : Math.max(0, music.toneShiftDuration - delta * 1.2);

    const quietThreshold = Math.max(0.055, music.longEnergy * 0.56);
    if (music.fastEnergy < quietThreshold) {
      music.quietDuration += delta;
      if (music.quietDuration > 0.55) music.dropArmed = true;
    } else {
      music.quietDuration = 0;
    }
    const returnFromDrop = beat && music.dropArmed && music.fastEnergy >= quietThreshold;
    if (returnFromDrop) music.dropArmed = false;

    return {
      beat,
      strongBeat,
      phraseBoundary: beat && music.beatsSinceScene >= 16 && music.beatCount % 16 === 0,
      sectionBoundary: beat && music.sectionShiftDuration > 1.15,
      toneBoundary: beat && music.toneShiftDuration > 0.7,
      returnFromDrop,
      toneDistance,
      onset,
      threshold
    };
  }

  updateCamera(delta, musicalEvent) {
    const camera = this.camera;
    const motion = this.reducedMotion ? 0.28 : 1;
    if (musicalEvent.strongBeat) camera.kick = Math.min(0.022, camera.kick + 0.006 + this.signal.peak * 0.01);
    camera.kick = mix(camera.kick, 0, follow(delta, 0.42));
    const time = this.elapsed;
    if (time >= camera.nextGazeAt) {
      camera.gazeX = (randomUnit() - 0.5) * 0.032;
      camera.gazeY = (randomUnit() - 0.5) * 0.024;
      camera.nextGazeAt = time + 2.8 + randomUnit() * 5.4;
    }
    const beatAngle = this.music.beatCount * 2.39996 + camera.phase;
    const bodySwayX = Math.sin(time * 0.071 + camera.phase) * 0.011 + Math.sin(time * 0.029 + camera.phase * 1.7) * 0.006;
    const bodySwayY = Math.cos(time * 0.061 + camera.phase * 0.8) * 0.009 + Math.sin(time * 0.023 + camera.phase * 2.1) * 0.005;
    const targetX = motion * (camera.gazeX + bodySwayX + Math.cos(beatAngle) * camera.kick * 0.55);
    const targetY = motion * (camera.gazeY + bodySwayY + Math.sin(beatAngle) * camera.kick * 0.4);
    const targetZoom = 1.045 + motion * (Math.sin(time * 0.19 + camera.phase) * 0.006 + Math.sin(time * 0.047) * 0.004 + this.signal.low * 0.012 + camera.kick * 0.5);
    const targetRoll = motion * (Math.sin(time * 0.037 + camera.phase * 1.4) * 0.007 + camera.gazeX * 0.16 + Math.sin(beatAngle) * camera.kick * 0.3);
    const integrate = (key, velocityKey, target, tension, damping) => {
      camera[velocityKey] += (target - camera[key]) * tension * delta;
      camera[velocityKey] *= Math.exp(-damping * delta);
      camera[key] += camera[velocityKey] * delta;
    };
    integrate("x", "velocityX", targetX, 2.5, 2.2);
    integrate("y", "velocityY", targetY, 2.1, 2);
    integrate("zoom", "velocityZoom", targetZoom, 3, 2.6);
    integrate("roll", "velocityRoll", targetRoll, 2.2, 2.1);
    camera.microX = motion * (Math.sin(time * 1.73 + camera.phase) * 0.0007 + Math.sin(time * 2.37) * 0.00035);
    camera.microY = motion * (Math.cos(time * 1.41 + camera.phase) * 0.00055 + Math.sin(time * 2.11) * 0.0003);
  }

  directScene(delta, musicalEvent = {}) {
    const directionSpeed = this.reducedMotion ? 0.4 : 1;
    this.sceneElapsed += delta * directionSpeed;
    this.sceneTransition = Math.min(1, this.sceneTransition + delta / this.transitionDuration);
    const minimumHold = 18;
    const fallbackAt = this.sceneDuration + 18;
    let transitionReason;
    if (this.sceneElapsed >= minimumHold) {
      if (musicalEvent.returnFromDrop) transitionReason = "drop-return";
      else if (musicalEvent.toneBoundary) transitionReason = "tone-shift";
      else if (musicalEvent.phraseBoundary) transitionReason = "phrase-boundary";
      else if (musicalEvent.sectionBoundary && this.sceneElapsed >= 22) transitionReason = "section-shift";
      else if (musicalEvent.strongBeat && this.sceneElapsed >= this.sceneDuration) transitionReason = "accent";
    }
    if (!transitionReason && this.sceneElapsed >= fallbackAt && musicalEvent.beat) transitionReason = "fallback-beat";
    if (!transitionReason && this.sceneElapsed >= fallbackAt + 4) transitionReason = "maximum-hold";
    if (!transitionReason) return;

    if (!this.sceneDeck.length) this.sceneDeck = shuffle(SCENES.filter((scene) => scene !== this.scene));
    const nextScene = this.sceneDeck.shift();
    this.previousScene = this.scene;
    this.previousSceneSeed = this.sceneSeed;
    this.scene = nextScene;
    this.sceneSeed = randomUnit();
    this.camera.phase = (this.camera.phase + 0.9 + this.sceneSeed * 2.2) % TAU;
    this.camera.gazeX = (randomUnit() - 0.5) * 0.026;
    this.camera.gazeY = (randomUnit() - 0.5) * 0.02;
    this.camera.kick = Math.max(this.camera.kick, 0.016);
    this.sceneElapsed = 0;
    this.sceneDuration = 24 + randomUnit() * 10 + (1 - this.signal.level) * 4;
    this.transitionDuration = clamp(this.music.beatInterval * 1.6, 0.65, 1.2) * (this.reducedMotion ? 1.25 : 1);
    this.sceneTransition = 0.08;
    this.music.beatsSinceScene = 0;
    this.music.toneSlow = [...this.music.toneFast];
    this.music.toneCentroidSlow = this.music.toneCentroidFast;
    this.music.toneShiftDuration = 0;
    this.canvas.dataset.scene = this.scene;
    this.canvas.dataset.transitionReason = transitionReason;
  }

  draw(time) {
    const delta = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.elapsed += delta * (this.reducedMotion ? 0.22 : 1);
    this.pointer.x = mix(this.pointer.x, this.pointer.targetX, 0.035);
    this.pointer.y = mix(this.pointer.y, this.pointer.targetY, 0.035);
    this.readSignal();
    const musicalEvent = this.analyzeMusic(delta);
    this.updateCamera(delta, musicalEvent);
    this.directScene(delta, musicalEvent);
    this.paint(delta);
    this.animationFrame = requestAnimationFrame((nextTime) => this.draw(nextTime));
  }

  paint(delta) {
    const context = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width * (0.5 + this.pointer.x * 0.035);
    const centerY = height * (0.5 + this.pointer.y * 0.025);
    const cameraX = this.camera.x + this.camera.microX;
    const cameraY = this.camera.y + this.camera.microY;
    const backgroundX = centerX + cameraX * width * 0.28;
    const backgroundY = centerY + cameraY * height * 0.28;
    const blend = 1 - Math.pow(1 - this.sceneTransition, 2.6);
    const visualSeed = mix(this.previousSceneSeed, this.sceneSeed, blend);
    const hue = 116 + visualSeed * 210 + Math.sin(this.elapsed * 0.08) * 28 + this.signal.high * 56;
    const background = context.createRadialGradient(backgroundX, backgroundY, 0, backgroundX, backgroundY, Math.hypot(width, height) * 0.72);
    background.addColorStop(0, hsla(hue + 18, 54, 11 + this.signal.level * 5));
    background.addColorStop(0.42, "#07161d");
    background.addColorStop(1, "#020609");
    context.globalCompositeOperation = "source-over";
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.save();
    context.translate(centerX + cameraX * width, centerY + cameraY * height);
    context.rotate(this.camera.roll);
    context.scale(this.camera.zoom, this.camera.zoom);
    context.translate(-centerX, -centerY);
    if (this.sceneTransition < 1) {
      if (blend < 0.62) {
        context.save();
        context.globalAlpha = 1 - blend;
        this.drawScene(context, this.previousScene, width, height, centerX, centerY, hue - 18);
        context.restore();
      }
      context.save();
      context.globalAlpha = blend;
      this.drawScene(context, this.scene, width, height, centerX, centerY, hue);
      context.restore();
    } else {
      this.drawScene(context, this.scene, width, height, centerX, centerY, hue);
    }
    this.drawParticles(context, width, height, centerX, centerY, hue, delta);
    context.restore();
    this.drawVignette(context, width, height);
  }

  drawScene(context, scene, width, height, centerX, centerY, hue) {
    if (scene === "horizon") this.drawHorizon(context, width, height, centerX, centerY, hue);
    else if (scene === "lattice") this.drawLattice(context, width, height, centerX, centerY, hue);
    else if (scene === "aurora") this.drawAurora(context, width, height, centerX, centerY, hue);
    else if (scene === "cathedral") this.drawCathedral(context, width, height, centerX, centerY, hue);
    else if (scene === "vortex") this.drawVortex(context, width, height, centerX, centerY, hue);
    else if (scene === "constellation") this.drawConstellation(context, width, height, centerX, centerY, hue);
    else if (scene === "prism") this.drawPrism(context, width, height, centerX, centerY, hue);
    else if (scene === "helix") this.drawHelix(context, width, height, centerX, centerY, hue);
    else if (scene === "monolith") this.drawMonolith(context, width, height, centerX, centerY, hue);
    else if (scene === "bloom") this.drawBloom(context, width, height, centerX, centerY, hue);
    else if (scene === "rainfall") this.drawRainfall(context, width, height, centerX, centerY, hue);
    else if (scene === "eclipse") this.drawEclipse(context, width, height, centerX, centerY, hue);
    else if (scene === "ribbons") this.drawRibbons(context, width, height, centerX, centerY, hue);
    else if (scene === "tunnel") this.drawTunnel(context, width, height, centerX, centerY, hue);
    else if (scene === "terrain") this.drawTerrain(context, width, height, centerX, centerY, hue);
    else if (scene === "pulsefield") this.drawPulsefield(context, width, height, centerX, centerY, hue);
    else if (scene === "infinity") this.drawInfinity(context, width, height, centerX, centerY, hue);
    else if (scene === "kaleidoscope") this.drawKaleidoscope(context, width, height, centerX, centerY, hue);
    else if (scene === "quasar") this.drawQuasar(context, width, height, centerX, centerY, hue);
    else if (scene === "wavegarden") this.drawWavegarden(context, width, height, centerX, centerY, hue);
    else if (scene === "dreamweb") this.drawDreamweb(context, width, height, centerX, centerY, hue);
    else this.drawOrbit(context, width, height, centerX, centerY, hue);
  }

  drawOrbit(context, width, height, centerX, centerY, hue) {
    const scale = Math.min(width, height);
    const source = this.channels[0];
    const other = this.channels[1] || source;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.translate(centerX, centerY);
    context.rotate(this.elapsed * 0.025 + this.pointer.x * 0.08);

    for (let layer = 8; layer >= 0; layer--) {
      const depth = layer / 8;
      const radius = scale * (0.075 + depth * 0.37) * (1 + this.signal.low * 0.1);
      const alpha = 0.07 + (1 - depth) * 0.09;
      context.beginPath();
      for (let point = 0; point <= 220; point++) {
        const turn = point / 220;
        const wave = (sampleAt(source, turn) + sampleAt(other, 1 - turn)) * 0.5;
        const ripple = wave * scale * (0.028 + depth * 0.045) + Math.sin(turn * TAU * 3 + this.elapsed * 0.8 + layer) * scale * 0.003;
        const angle = turn * TAU + layer * 0.025;
        const x = Math.cos(angle) * (radius + ripple);
        const y = Math.sin(angle) * (radius + ripple) * (0.76 + this.pointer.y * 0.08);
        if (point) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.closePath();
      context.strokeStyle = hsla(hue + depth * 115, 92, 67, alpha + this.signal.level * 0.28);
      context.lineWidth = Math.max(1, scale * (0.001 + (1 - depth) * 0.0015));
      context.stroke();
    }

    const coreRadius = scale * (0.035 + this.signal.level * 0.035);
    const core = context.createRadialGradient(0, 0, 0, 0, 0, coreRadius * 5);
    core.addColorStop(0, "rgba(255,255,255,.95)");
    core.addColorStop(0.12, hsla(hue + 22, 100, 72, 0.9));
    core.addColorStop(1, hsla(hue, 100, 50, 0));
    context.fillStyle = core;
    context.beginPath();
    context.arc(0, 0, coreRadius * 5, 0, TAU);
    context.fill();
    context.restore();
  }

  drawHorizon(context, width, height, centerX, centerY, hue) {
    const horizon = centerY + height * 0.08;
    const source = this.channels[0];
    const other = this.channels[1] || source;
    context.save();
    context.globalCompositeOperation = "lighter";
    const columns = Math.max(48, Math.min(120, Math.floor(width / 13)));
    for (let column = 0; column < columns; column++) {
      const position = column / (columns - 1);
      const sample = Math.abs(sampleAt(source, position) - sampleAt(other, 1 - position) * 0.35);
      const envelope = Math.sin(position * Math.PI);
      const tower = height * (0.025 + sample * 0.24 + this.signal.mid * envelope * 0.18);
      const x = position * width;
      const barWidth = Math.max(1, width / columns * 0.36);
      const gradient = context.createLinearGradient(0, horizon - tower, 0, horizon + tower);
      gradient.addColorStop(0, hsla(hue + position * 100, 95, 72, 0.75));
      gradient.addColorStop(0.5, hsla(hue + 28, 90, 55, 0.12));
      gradient.addColorStop(1, hsla(hue + position * 100, 95, 66, 0.52));
      context.fillStyle = gradient;
      context.fillRect(x, horizon - tower, barWidth, tower * 2);
    }
    this.drawWaveRibbon(context, source, width, horizon, height * 0.18, hue + 8, 0);
    this.drawWaveRibbon(context, other, width, horizon, -height * 0.18, hue + 110, Math.PI);
    context.restore();
  }

  drawLattice(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    context.save();
    context.globalCompositeOperation = "lighter";
    const horizon = height * (0.37 + this.pointer.y * 0.025);
    context.strokeStyle = hsla(hue, 82, 60, 0.14 + this.signal.level * 0.08);
    context.lineWidth = Math.max(1, width * 0.0008);
    for (let line = 0; line < 18; line++) {
      const depth = line / 17;
      const y = horizon + Math.pow(depth, 2.25) * height * 0.72;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    for (let line = -14; line <= 14; line++) {
      context.beginPath();
      context.moveTo(centerX + line * width * 0.018, horizon);
      context.lineTo(centerX + line * width * 0.095, height);
      context.stroke();
    }
    for (let layer = 0; layer < 6; layer++) {
      const offset = (layer - 2.5) * height * 0.095;
      const spread = height * (0.06 + layer * 0.012);
      this.drawWaveRibbon(context, layer % 2 ? source : other, width, centerY + offset, spread, hue + layer * 22, layer * 0.7);
    }
    context.restore();
  }

  drawAurora(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let band = 0; band < 9; band++) {
      const data = band % 2 ? source : other;
      const baseY = height * (0.15 + band * 0.087) + this.pointer.y * height * 0.025;
      const amplitude = height * (0.025 + this.signal.mid * 0.075 + band * 0.0025);
      const thickness = height * (0.018 + this.signal.low * 0.035);
      context.beginPath();
      for (let point = 0; point <= 120; point++) {
        const position = point / 120;
        const wave = sampleAt(data, position) * amplitude + Math.sin(position * TAU * (1.2 + band * 0.07) + this.elapsed * 0.25 + band) * amplitude * 0.34;
        const x = position * width;
        const y = baseY + wave;
        if (point) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      for (let point = 120; point >= 0; point--) {
        const position = point / 120;
        const wave = sampleAt(data, position) * amplitude + Math.sin(position * TAU * (1.2 + band * 0.07) + this.elapsed * 0.25 + band) * amplitude * 0.34;
        context.lineTo(position * width, baseY + wave + thickness * Math.sin(position * Math.PI));
      }
      context.closePath();
      const gradient = context.createLinearGradient(0, baseY - amplitude, width, baseY + amplitude);
      gradient.addColorStop(0, hsla(hue + band * 17, 94, 64, 0.04));
      gradient.addColorStop(0.5, hsla(hue + 70 + band * 9, 96, 68, 0.18 + this.signal.level * 0.16));
      gradient.addColorStop(1, hsla(hue + 150 + band * 12, 92, 61, 0.03));
      context.fillStyle = gradient;
      context.fill();
    }
    context.restore();
  }

  drawCathedral(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const floor = height * 0.86;
    const scale = Math.min(width, height);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (let column = -20; column <= 20; column++) {
      const position = (column + 20) / 40;
      const distance = Math.abs(column) / 20;
      const sample = Math.abs(sampleAt(source, position));
      const x = centerX + column * width * 0.023;
      const towerHeight = height * (0.13 + (1 - distance) * 0.43 + sample * 0.22 + this.signal.low * 0.1);
      context.beginPath();
      context.moveTo(x, floor);
      context.lineTo(x, floor - towerHeight);
      context.strokeStyle = hsla(hue + distance * 125, 94, 68, 0.22 + (1 - distance) * 0.42);
      context.lineWidth = Math.max(1, scale * (0.0014 + (1 - distance) * 0.002));
      context.stroke();
    }
    for (let arch = 0; arch < 9; arch++) {
      const depth = arch / 8;
      context.beginPath();
      context.ellipse(centerX, floor, scale * (0.09 + depth * 0.48), height * (0.22 + depth * 0.63), 0, Math.PI, TAU);
      context.strokeStyle = hsla(hue + 35 + arch * 11, 90, 68, 0.08 + (1 - depth) * 0.22);
      context.lineWidth = Math.max(1, scale * 0.0015);
      context.stroke();
    }
    const floorGlow = context.createLinearGradient(0, floor - scale * 0.05, 0, floor + scale * 0.08);
    floorGlow.addColorStop(0, hsla(hue + 60, 100, 70, 0.32));
    floorGlow.addColorStop(1, hsla(hue + 60, 100, 50, 0));
    context.fillStyle = floorGlow;
    context.fillRect(0, floor - scale * 0.05, width, scale * 0.13);
    context.restore();
  }

  drawVortex(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const scale = Math.min(width, height);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.translate(centerX, centerY);
    context.rotate(this.elapsed * 0.11 + this.pointer.x * 0.12);
    for (let arm = 0; arm < 7; arm++) {
      const data = arm % 2 ? source : other;
      context.beginPath();
      for (let point = 0; point <= 190; point++) {
        const position = point / 190;
        const wave = sampleAt(data, position);
        const radius = scale * (0.018 + position * 0.59 + wave * 0.035);
        const angle = arm / 7 * TAU + position * TAU * (2.15 + this.signal.low * 0.55) + wave * 0.32;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * (0.72 + this.pointer.y * 0.06);
        if (point) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.strokeStyle = hsla(hue + arm * 31, 96, 67, 0.18 + this.signal.level * 0.38);
      context.lineWidth = Math.max(1, scale * (0.0014 + this.signal.peak * 0.002));
      context.stroke();
    }
    const core = context.createRadialGradient(0, 0, 0, 0, 0, scale * 0.18);
    core.addColorStop(0, "rgba(255,255,255,.92)");
    core.addColorStop(0.15, hsla(hue + 65, 100, 70, 0.75));
    core.addColorStop(1, hsla(hue, 100, 52, 0));
    context.fillStyle = core;
    context.beginPath();
    context.arc(0, 0, scale * 0.18, 0, TAU);
    context.fill();
    context.restore();
  }

  drawConstellation(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const points = [];
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let index = 0; index < 84; index++) {
      const position = index / 83;
      const orbit = index % 3;
      const angle = position * TAU * (1.15 + orbit * 0.42) + this.elapsed * (0.025 + orbit * 0.012);
      const wave = sampleAt(orbit % 2 ? source : other, position);
      const radiusX = width * (0.13 + orbit * 0.105 + wave * 0.035);
      const radiusY = height * (0.14 + orbit * 0.105 + wave * 0.04);
      points.push({
        x: centerX + Math.cos(angle) * radiusX + this.pointer.x * width * 0.018 * orbit,
        y: centerY + Math.sin(angle) * radiusY + this.pointer.y * height * 0.018 * orbit,
        energy: Math.abs(wave)
      });
    }
    context.lineWidth = Math.max(0.7, width * 0.0007);
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const next = points[(index + 7 + index % 5) % points.length];
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(next.x, next.y);
      context.strokeStyle = hsla(hue + index * 2.7, 86, 68, 0.045 + point.energy * 0.16);
      context.stroke();
      const radius = 0.8 + point.energy * 5 + this.signal.high * 1.5;
      context.fillStyle = hsla(hue + index * 3.2, 98, 78, 0.35 + point.energy * 0.6);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  drawPrism(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const scale = Math.min(width, height);
    const segments = 14;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.translate(centerX, centerY);
    context.rotate(this.elapsed * 0.035 + this.pointer.x * 0.08);
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment / segments * TAU;
      const nextAngle = (segment + 0.72) / segments * TAU;
      const sample = Math.abs(sampleAt(segment % 2 ? source : other, segment / segments));
      const inner = scale * (0.055 + this.signal.low * 0.045);
      const outer = scale * (0.3 + sample * 0.24 + this.signal.mid * 0.08);
      const gradient = context.createRadialGradient(0, 0, inner, 0, 0, outer);
      gradient.addColorStop(0, hsla(hue + segment * 19, 100, 76, 0.06));
      gradient.addColorStop(0.62, hsla(hue + 70 + segment * 23, 96, 63, 0.12 + sample * 0.2));
      gradient.addColorStop(1, hsla(hue + 155 + segment * 17, 100, 68, 0.02));
      context.fillStyle = gradient;
      context.strokeStyle = hsla(hue + segment * 24, 96, 72, 0.13 + sample * 0.36);
      context.lineWidth = Math.max(1, scale * 0.0012);
      context.beginPath();
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      context.lineTo(Math.cos(nextAngle) * outer * (0.72 + sample * 0.18), Math.sin(nextAngle) * outer * (0.72 + sample * 0.18));
      context.closePath();
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  drawHelix(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const strands = [[], []];
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let strand = 0; strand < 2; strand++) {
      context.beginPath();
      for (let point = 0; point <= 150; point++) {
        const position = point / 150;
        const phase = position * TAU * 2.35 + this.elapsed * 0.34 + strand * Math.PI;
        const wave = sampleAt(strand ? other : source, position);
        const x = position * width;
        const y = centerY + Math.sin(phase) * height * (0.18 + this.signal.low * 0.08) + wave * height * 0.055;
        strands[strand].push({ x, y });
        if (point) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.strokeStyle = hsla(hue + strand * 112, 96, 70, 0.48 + this.signal.level * 0.32);
      context.lineWidth = Math.max(1.5, width * 0.0022);
      context.stroke();
    }
    for (let point = 0; point < strands[0].length; point += 6) {
      context.beginPath();
      context.moveTo(strands[0][point].x, strands[0][point].y);
      context.lineTo(strands[1][point].x, strands[1][point].y);
      context.strokeStyle = hsla(hue + point * 1.8, 84, 70, 0.08 + this.signal.mid * 0.2);
      context.lineWidth = 1;
      context.stroke();
    }
    context.restore();
  }

  drawMonolith(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const floor = height * 0.82;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let slab = -9; slab <= 9; slab++) {
      const position = (slab + 9) / 18;
      const sample = Math.abs(sampleAt(source, position));
      const distance = Math.abs(slab) / 9;
      const slabWidth = width * (0.018 + (1 - distance) * 0.016);
      const slabHeight = height * (0.12 + (1 - distance) * 0.48 + sample * 0.22);
      const x = centerX + slab * width * 0.043 - slabWidth / 2;
      const gradient = context.createLinearGradient(x, floor - slabHeight, x + slabWidth, floor);
      gradient.addColorStop(0, hsla(hue + distance * 120, 92, 74, 0.5));
      gradient.addColorStop(0.45, hsla(hue + 35, 90, 52, 0.12));
      gradient.addColorStop(1, hsla(hue + 145, 96, 66, 0.4));
      context.fillStyle = gradient;
      context.fillRect(x, floor - slabHeight, slabWidth, slabHeight);
      context.globalAlpha *= 0.23;
      context.fillRect(x, floor + 5, slabWidth, slabHeight * 0.38);
      context.globalAlpha /= 0.23;
    }
    context.restore();
  }

  drawBloom(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const scale = Math.min(width, height);
    const petals = 18;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.translate(centerX, centerY);
    context.rotate(this.elapsed * 0.025);
    for (let petal = 0; petal < petals; petal++) {
      const angle = petal / petals * TAU;
      const sample = Math.abs(sampleAt(source, petal / petals));
      const length = scale * (0.2 + sample * 0.24 + this.signal.mid * 0.12);
      const widthAtCenter = scale * (0.035 + this.signal.low * 0.025);
      context.save();
      context.rotate(angle);
      context.beginPath();
      context.moveTo(0, 0);
      context.bezierCurveTo(length * 0.28, -widthAtCenter, length * 0.78, -widthAtCenter * 0.56, length, 0);
      context.bezierCurveTo(length * 0.78, widthAtCenter * 0.56, length * 0.28, widthAtCenter, 0, 0);
      context.fillStyle = hsla(hue + petal * 17, 96, 64, 0.075 + sample * 0.18 + this.signal.level * 0.08);
      context.strokeStyle = hsla(hue + 70 + petal * 13, 98, 73, 0.22 + sample * 0.4);
      context.fill();
      context.stroke();
      context.restore();
    }
    context.restore();
  }

  drawRainfall(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (let drop = 0; drop < 110; drop++) {
      const seed = Math.abs(Math.sin(drop * 91.731) * 43758.5453) % 1;
      const speed = 0.025 + (drop % 11) * 0.003 + this.signal.high * 0.035;
      const progress = (seed + this.elapsed * speed) % 1;
      const x = ((drop * 0.618033 + this.pointer.x * 0.03) % 1 + 1) % 1 * width;
      const y = progress * height;
      const sample = Math.abs(sampleAt(source, drop / 110));
      const length = height * (0.018 + sample * 0.09 + this.signal.peak * 0.025);
      const gradient = context.createLinearGradient(x, y - length, x, y);
      gradient.addColorStop(0, hsla(hue + drop * 2.2, 92, 68, 0));
      gradient.addColorStop(1, hsla(hue + 60 + drop * 1.4, 98, 75, 0.22 + sample * 0.5));
      context.strokeStyle = gradient;
      context.lineWidth = 0.7 + sample * 2.2;
      context.beginPath();
      context.moveTo(x, y - length);
      context.lineTo(x, y);
      context.stroke();
    }
    context.restore();
  }

  drawEclipse(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const scale = Math.min(width, height);
    const radius = scale * (0.19 + this.signal.low * 0.035);
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let ray = 0; ray < 96; ray++) {
      const angle = ray / 96 * TAU + this.elapsed * 0.018;
      const sample = Math.abs(sampleAt(source, ray / 96));
      const inner = radius * 0.95;
      const outer = radius * (1.18 + sample * 0.9 + this.signal.high * 0.18);
      context.beginPath();
      context.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
      context.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
      context.strokeStyle = hsla(hue + ray * 1.8, 98, 72, 0.08 + sample * 0.52);
      context.lineWidth = 0.8 + sample * 2;
      context.stroke();
    }
    context.globalCompositeOperation = "source-over";
    const disk = context.createRadialGradient(centerX - radius * 0.24, centerY - radius * 0.22, 0, centerX, centerY, radius);
    disk.addColorStop(0, "#12252d");
    disk.addColorStop(0.7, "#050b0f");
    disk.addColorStop(1, "#010304");
    context.fillStyle = disk;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, TAU);
    context.fill();
    context.restore();
  }

  drawRibbons(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let ribbon = 0; ribbon < 11; ribbon++) {
      const data = ribbon % 2 ? source : other;
      const startY = height * (-0.04 + ribbon * 0.105);
      const waveA = sampleAt(data, ribbon / 11);
      const waveB = sampleAt(data, 1 - ribbon / 11);
      const thickness = height * (0.012 + this.signal.mid * 0.025);
      context.beginPath();
      context.moveTo(-width * 0.08, startY);
      context.bezierCurveTo(width * 0.26, startY + waveA * height * 0.22, width * 0.7, startY - waveB * height * 0.24, width * 1.08, startY + Math.sin(this.elapsed * 0.2 + ribbon) * height * 0.05);
      context.lineTo(width * 1.08, startY + thickness);
      context.bezierCurveTo(width * 0.72, startY - waveB * height * 0.24 + thickness, width * 0.24, startY + waveA * height * 0.22 + thickness, -width * 0.08, startY + thickness);
      context.closePath();
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, hsla(hue + ribbon * 13, 94, 65, 0.03));
      gradient.addColorStop(0.5, hsla(hue + 80 + ribbon * 11, 98, 68, 0.12 + this.signal.level * 0.14));
      gradient.addColorStop(1, hsla(hue + 170 + ribbon * 7, 94, 62, 0.025));
      context.fillStyle = gradient;
      context.fill();
    }
    context.restore();
  }

  drawTunnel(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const scale = Math.min(width, height);
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let frame = 17; frame >= 0; frame--) {
      const progress = ((frame / 18 + this.elapsed * 0.025) % 1);
      const eased = progress * progress;
      const sample = Math.abs(sampleAt(source, progress));
      const halfWidth = width * (0.025 + eased * 0.66);
      const halfHeight = height * (0.025 + eased * 0.66);
      const offsetX = this.pointer.x * width * (0.02 + eased * 0.04);
      const offsetY = this.pointer.y * height * (0.02 + eased * 0.04);
      context.save();
      context.translate(centerX + offsetX, centerY + offsetY);
      context.rotate(Math.sin(this.elapsed * 0.08 + frame * 0.31) * 0.12 + sample * 0.04);
      context.strokeStyle = hsla(hue + frame * 13, 96, 70, 0.06 + eased * 0.34 + sample * 0.18);
      context.lineWidth = Math.max(1, scale * (0.001 + eased * 0.002));
      context.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
      context.restore();
    }
    context.restore();
  }

  drawTerrain(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const layers = 5;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer < layers; layer++) {
      const depth = layer / (layers - 1);
      const data = layer % 2 ? source : other;
      const baseY = height * (0.28 + depth * 0.64);
      const amplitude = height * (0.035 + (layers - 1 - layer) * 0.009 + this.signal.low * 0.04);
      context.beginPath();
      context.moveTo(0, height);
      context.lineTo(0, baseY);
      for (let point = 0; point <= 64; point++) {
        const position = point / 64;
        const wave = Math.abs(sampleAt(data, position)) * amplitude + Math.sin(position * TAU * (1.4 + layer * 0.18) + this.elapsed * 0.08) * amplitude * 0.35;
        context.lineTo(position * width, baseY - wave);
      }
      context.lineTo(width, height);
      context.closePath();
      const gradient = context.createLinearGradient(0, baseY - amplitude, 0, height);
      gradient.addColorStop(0, hsla(hue + layer * 18, 94, 68, 0.13 + (8 - layer) * 0.012));
      gradient.addColorStop(1, hsla(hue + 110 + layer * 9, 84, 24, 0.015));
      context.fillStyle = gradient;
      context.strokeStyle = hsla(hue + 55 + layer * 16, 96, 72, 0.16 + this.signal.mid * 0.17);
      context.lineWidth = 1;
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  drawPulsefield(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const columns = 15;
    const rows = 9;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const position = (row * columns + column) / (rows * columns - 1);
        const sample = Math.abs(sampleAt(source, position));
        const x = (column + 0.5) / columns * width + this.pointer.x * width * 0.012 * (row - rows / 2);
        const y = (row + 0.5) / rows * height + this.pointer.y * height * 0.012 * (column - columns / 2);
        const distance = Math.hypot(x - centerX, y - centerY) / Math.hypot(width, height);
        const pulse = (Math.sin(distance * 32 - this.elapsed * 1.4) + 1) * 0.5;
        const radius = 1 + sample * 6 + pulse * this.signal.peak * 3.5;
        context.fillStyle = hsla(hue + distance * 260 + pulse * 35, 96, 72, 0.16 + sample * 0.48);
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
      }
    }
    context.restore();
  }

  drawInfinity(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const scale = Math.min(width, height);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.translate(centerX, centerY);
    context.rotate(this.pointer.x * 0.08);
    for (let layer = 0; layer < 8; layer++) {
      const data = layer % 2 ? source : other;
      const size = scale * (0.22 + layer * 0.035);
      context.beginPath();
      for (let point = 0; point <= 220; point++) {
        const position = point / 220;
        const angle = position * TAU + this.elapsed * (0.025 + layer * 0.002);
        const denominator = 1 + Math.sin(angle) ** 2;
        const wave = sampleAt(data, position);
        const x = Math.cos(angle) / denominator * size * (1 + wave * 0.12);
        const y = Math.sin(angle) * Math.cos(angle) / denominator * size * (1 + wave * 0.18);
        if (point) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.strokeStyle = hsla(hue + layer * 26, 96, 70, 0.11 + this.signal.level * 0.19 + (7 - layer) * 0.018);
      context.lineWidth = Math.max(1, scale * (0.001 + (7 - layer) * 0.00025));
      context.stroke();
    }
    context.restore();
  }

  drawKaleidoscope(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const scale = Math.min(width, height);
    const segments = 10 + Math.floor(this.sceneSeed * 7) * 2;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.translate(centerX, centerY);
    context.rotate(this.elapsed * (0.018 + this.sceneSeed * 0.025));
    for (let segment = 0; segment < segments; segment++) {
      context.save();
      context.rotate(segment / segments * TAU);
      if (segment % 2) context.scale(1, -1);
      for (let layer = 0; layer < 5; layer++) {
        const data = layer % 2 ? source : other;
        context.beginPath();
        for (let point = 0; point <= 48; point++) {
          const position = point / 48;
          const wave = Math.abs(sampleAt(data, position));
          const radius = scale * (0.055 + position * (0.28 + layer * 0.026) + wave * 0.07);
          const angle = (position - 0.5) * (TAU / segments) * (0.55 + layer * 0.08);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (point) context.lineTo(x, y);
          else context.moveTo(x, y);
        }
        context.strokeStyle = hsla(hue + layer * 37 + segment * 3, 98, 70, 0.08 + this.signal.level * 0.19);
        context.lineWidth = Math.max(0.7, scale * 0.0011);
        context.stroke();
      }
      context.restore();
    }
    context.restore();
  }

  drawQuasar(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    const scale = Math.min(width, height);
    const tilt = -0.2 + this.sceneSeed * 0.4;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.translate(centerX, centerY);
    context.rotate(tilt);
    for (let ring = 11; ring >= 0; ring--) {
      const depth = ring / 11;
      const radiusX = scale * (0.08 + depth * 0.46);
      const radiusY = radiusX * (0.12 + this.sceneSeed * 0.08);
      context.beginPath();
      for (let point = 0; point <= 150; point++) {
        const position = point / 150;
        const angle = position * TAU + this.elapsed * (0.035 + depth * 0.02);
        const wave = sampleAt(ring % 2 ? source : other, position) * scale * 0.018;
        const x = Math.cos(angle) * (radiusX + wave);
        const y = Math.sin(angle) * (radiusY + wave * 0.2);
        if (point) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.strokeStyle = hsla(hue + depth * 150, 100, 70, 0.08 + (1 - depth) * 0.22 + this.signal.level * 0.08);
      context.lineWidth = Math.max(1, scale * (0.001 + (1 - depth) * 0.0017));
      context.stroke();
    }
    const jetLength = scale * (0.42 + this.signal.peak * 0.22);
    const jetWidth = scale * (0.012 + this.signal.low * 0.025);
    for (const direction of [-1, 1]) {
      const jet = context.createLinearGradient(0, 0, 0, jetLength * direction);
      jet.addColorStop(0, "rgba(255,255,255,.9)");
      jet.addColorStop(0.2, hsla(hue + 80, 100, 70, 0.6));
      jet.addColorStop(1, hsla(hue + 150, 100, 60, 0));
      context.fillStyle = jet;
      context.beginPath();
      context.moveTo(-jetWidth, 0);
      context.lineTo(jetWidth, 0);
      context.lineTo(jetWidth * 0.12, jetLength * direction);
      context.lineTo(-jetWidth * 0.12, jetLength * direction);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  drawWavegarden(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const other = this.channels[1] || source;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer < 10; layer++) {
      const depth = layer / 9;
      const data = layer % 2 ? source : other;
      const baseY = height * (0.08 + depth * 0.82);
      const amplitude = height * (0.025 + (1 - depth) * 0.07 + this.signal.low * 0.025);
      context.beginPath();
      for (let point = 0; point <= 96; point++) {
        const position = point / 96;
        const audio = sampleAt(data, position);
        const swell = Math.sin(position * TAU * (1.1 + this.sceneSeed * 1.4) + this.elapsed * (0.08 + depth * 0.03) + layer * 0.7);
        const cross = Math.sin(position * TAU * 3.2 - this.elapsed * 0.05 + layer) * 0.25;
        const x = position * width;
        const y = baseY + (swell + cross) * amplitude + audio * amplitude * 1.4;
        if (point) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.strokeStyle = hsla(hue + depth * 180, 94, 70, 0.12 + (1 - depth) * 0.16 + this.signal.mid * 0.1);
      context.lineWidth = Math.max(1, width * (0.0008 + (1 - depth) * 0.0011));
      context.stroke();
    }
    context.restore();
  }

  drawDreamweb(context, width, height, centerX, centerY, hue) {
    const source = this.channels[0];
    const nodes = [];
    const nodeCount = 72;
    context.save();
    context.globalCompositeOperation = "lighter";
    for (let node = 0; node < nodeCount; node++) {
      const position = node / nodeCount;
      const seedAngle = position * TAU * (3 + Math.floor(this.sceneSeed * 4));
      const wave = sampleAt(source, position);
      const radius = Math.min(width, height) * (0.08 + position * 0.45 + wave * 0.035);
      nodes.push({
        x: centerX + Math.cos(seedAngle + this.elapsed * 0.012) * radius * (1.3 + this.pointer.x * 0.06),
        y: centerY + Math.sin(seedAngle + this.elapsed * 0.012) * radius * (0.72 + this.pointer.y * 0.05),
        energy: Math.abs(wave)
      });
    }
    for (let node = 0; node < nodes.length; node++) {
      const point = nodes[node];
      for (const offset of [5, 13, 29]) {
        const target = nodes[(node + offset) % nodes.length];
        context.beginPath();
        context.moveTo(point.x, point.y);
        const controlX = centerX + (point.x + target.x - centerX * 2) * (0.12 + this.sceneSeed * 0.12);
        const controlY = centerY + (point.y + target.y - centerY * 2) * (0.12 + this.sceneSeed * 0.12);
        context.quadraticCurveTo(controlX, controlY, target.x, target.y);
        context.strokeStyle = hsla(hue + node * 3.6 + offset, 92, 70, 0.025 + point.energy * 0.1 + this.signal.level * 0.025);
        context.lineWidth = 0.55 + point.energy * 0.7;
        context.stroke();
      }
      context.fillStyle = hsla(hue + node * 4, 100, 76, 0.22 + point.energy * 0.58);
      context.beginPath();
      context.arc(point.x, point.y, 0.8 + point.energy * 3.5, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  drawWaveRibbon(context, data, width, centerY, spread, hue, phase) {
    context.beginPath();
    for (let point = 0; point <= 160; point++) {
      const position = point / 160;
      const wave = data?.length ? sampleAt(data, position) : Math.sin(position * TAU * 3 + this.elapsed + phase) * 0.05;
      const x = position * width;
      const y = centerY + wave * spread + Math.sin(position * TAU + phase + this.elapsed * 0.28) * spread * 0.06;
      if (point) context.lineTo(x, y);
      else context.moveTo(x, y);
    }
    context.strokeStyle = hsla(hue, 96, 68, 0.42 + this.signal.level * 0.46);
    context.lineWidth = Math.max(1.5, width * 0.0018);
    context.stroke();
  }

  drawParticles(context, width, height, centerX, centerY, hue, delta) {
    context.save();
    context.globalCompositeOperation = "lighter";
    const scale = Math.min(width, height);
    for (const particle of this.particles) {
      const previousDepth = particle.depth;
      particle.depth -= delta * particle.speed * (0.32 + this.signal.level * 2.3 + this.signal.flux * 2);
      particle.angle += particle.drift * delta;
      if (particle.depth <= 0.015) Object.assign(particle, this.createParticle(1));
      const depth = Math.max(0.02, particle.depth);
      const previousScale = 1 / Math.max(0.02, previousDepth);
      const projection = 1 / depth;
      const radius = particle.radius * scale * 0.055;
      const x = centerX + Math.cos(particle.angle) * radius * projection;
      const y = centerY + Math.sin(particle.angle) * radius * projection * 0.72;
      const previousX = centerX + Math.cos(particle.angle) * radius * previousScale;
      const previousY = centerY + Math.sin(particle.angle) * radius * previousScale * 0.72;
      if (x < -20 || x > width + 20 || y < -20 || y > height + 20) {
        Object.assign(particle, this.createParticle(1));
        continue;
      }
      context.beginPath();
      context.moveTo(previousX, previousY);
      context.lineTo(x, y);
      context.strokeStyle = hsla(hue + particle.radius * 84, 92, 72, clamp((1 - depth) * 0.65 + this.signal.high * 0.25));
      context.lineWidth = particle.size * Math.min(3.5, projection * 0.16);
      context.stroke();
    }
    context.restore();
  }

  drawVignette(context, width, height) {
    const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.18, width / 2, height / 2, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.72, "rgba(0,0,0,.16)");
    vignette.addColorStop(1, "rgba(0,0,0,.74)");
    context.globalCompositeOperation = "source-over";
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
  }
}