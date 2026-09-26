import { GENERAL_SCENES, drawGeneralScene, updateGeneralMotion, drawCrystalFacets } from "./general-scenes.js?v=19";
import { ShaderScenes } from "./shader-scenes.js?v=6";

const TAU = Math.PI * 2;
const SID_SCENES = ["sid-warp", "sid-weave", "sid-crystal", "sid-storm", "sid-matrix", "sid-lissajous", "sid-radar", "sid-machine"];
const SCENES = GENERAL_SCENES;
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
  constructor(canvas, { getSource, getSidState, onFrame, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.getSource = getSource;
    this.getSidState = getSidState;
    this.onFrame = onFrame;
    this.reducedMotion = reducedMotion;
    this.scene = "terrain";
    this.previousScene = this.scene;
    this.sceneDeck = shuffle(SCENES.filter((scene) => scene !== this.scene));
    this.sceneSeed = randomUnit();
    this.previousSceneSeed = this.sceneSeed;
    this.sceneElapsed = 0;
    this.sceneDuration = 20;
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
    this.sidRegisterFeedback = new Map();
    this.sidFeedbackChip = undefined;
    this.sidLastWriteCycle = -Infinity;
    this.sidVoices = [];
    this.sidTime = 0;
    this.sidSceneMode = false;
    this.quality = .65;
    this.frameBudget = { fastest: Infinity, elapsed: 0, frames: 0, stressed: 0, healthy: 0, skipFirst: true };
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

  start() {
    if (this.animationFrame !== undefined) return;
    this.prepareShaderScenes();
    this.resize();
    this.lastTime = performance.now();
    this.frameBudget = { fastest: Infinity, elapsed: 0, frames: 0, stressed: 0, healthy: 0, skipFirst: true };
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
    this.shaderScenes?.dispose();
    this.shaderScenes = undefined;
  }

  resize() {
    this.resizePending = true;
  }

  applyResize() {
    this.resizePending = false;
    const bounds = this.canvas.getBoundingClientRect();
    this.pixelRatio = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * this.pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * this.pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  adaptQuality(interval, cost) {
    const budget = this.frameBudget;
    if (budget.skipFirst) { budget.skipFirst = false; return; }
    if (!Number.isFinite(interval) || interval <= 0 || interval > 250) return;
    budget.fastest = Math.min(budget.fastest, Math.max(1000 / 360, interval));
    budget.elapsed += interval;
    budget.frames++;
    const cpuBudget = Math.min(4, budget.fastest * .35);
    if (cost > cpuBudget || interval > budget.fastest * 1.45) budget.stressed++;
    if (budget.elapsed < 1000) return;
    let quality = this.quality;
    if (budget.stressed / budget.frames > .15) {
      quality = Math.max(.25, quality - .12);
      budget.healthy = 0;
    } else if (budget.stressed === 0) {
      budget.healthy += budget.elapsed;
      if (budget.healthy >= 5000) {
        quality = Math.min(1, quality + .04);
        budget.healthy = 0;
      }
    } else budget.healthy = 0;
    budget.elapsed = 0;
    budget.frames = 0;
    budget.stressed = 0;
    if (quality !== this.quality) {
      this.quality = quality;
      this.canvas.dataset.quality = quality.toFixed(2);
    }
  }

  detailCount(full, minimum = 3) {
    const quality = (this.quality ?? 1) * (this.sceneTransition < 1 ? .72 : 1);
    return Math.max(minimum, Math.round(full * quality));
  }

  readSignal() {
    this.strobeHit = false;
    const source = this.getSource?.();
    const revision = source?.revision;
    if (source && Number.isFinite(revision) && source === this.signalSource && revision === this.signalRevision && this.measuredSignal) {
      this.smoothSignal(this.measuredSignal);
      return;
    }
    if (source !== this.signalSource || (Number.isFinite(revision) && revision < this.signalRevision)) this.strobeOnset = undefined;
    this.signalSource = source;
    this.signalRevision = revision;
    this.measuredSignal = undefined;
    const channels = [];
    if (source) {
      try {
        if (typeof source.readChannels === "function") {
          const availableChannels = source.readChannels();
          for (let index = 0; index < Math.min(8, availableChannels.length); index++) channels.push(availableChannels[index]);
        }
        else for (let index = 0; index < Math.min(8, source.streamCount); index++) channels.push(source.readChannel(index));
      } catch {
        channels.length = 0;
      }
    }
    this.channels = channels;
    if (!channels.length) {
      this.strobeOnset = undefined;
      const idle = 0.035 + Math.sin(this.elapsed * 0.7) * 0.008;
      this.smoothSignal({ level: idle, peak: idle, low: idle, mid: idle * 0.7, high: idle * 0.4 });
      return;
    }

    const points = SPECTRAL_POINTS;
    const monoSamples = this.monoSamples ??= new Float32Array(points);
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
      let mono = 0;
      for (const channel of channels) mono += sampleAt(channel, position);
      mono /= channels.length;
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
    this.measuredSignal = {
      level: clamp(Math.pow(Math.sqrt(squareSum / points), 0.45) * 1.6),
      peak: clamp(Math.sqrt(peak) * 1.2),
      low: clamp(Math.pow(low / points, 0.45) * 2.4),
      mid: clamp(Math.pow(mid / points, 0.45) * 2.6),
      high: clamp(Math.pow(high / points, 0.45) * 2)
    };
    const bassEnergy = source?.readBassEnergy?.();
    const strobeNow = performance.now() / 1000;
    const strobeDelta = this.strobeOnset && Number.isFinite(this.strobeReadAt)
      ? Math.max(0, strobeNow - this.strobeReadAt) : 1 / 60;
    this.strobeReadAt = strobeNow;
    this.detectStrobeHit(Number.isFinite(bassEnergy)
      ? { low: bassEnergy, mid: 0, high: 0, bassRatio: source?.readBassRatio?.(), fullBand: source?.readFullBandEnergy?.() }
      : { low: low / points * 4, mid: mid / points * 4, high: high / points * 4 }, strobeDelta);
    this.smoothSignal(this.measuredSignal);
  }

  detectStrobeHit(measured, delta = 1 / 60) {
    const detector = this.strobeOnset ??= {
      previous: { low: 0 }, baseline: 0, referenceBaseline: 0, peakBass: 0, floorBass: 0, armed: true
    };
    const duration = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const previousBaseline = detector.baseline;
    detector.baseline = mix(previousBaseline, measured.low, 1 - Math.exp(-duration / .08));
    const rise = measured.low - detector.baseline;
    const reference = Number.isFinite(measured.fullBand) ? measured.fullBand
      : measured.bassRatio > 0 ? measured.low / measured.bassRatio : measured.low;
    detector.referenceBaseline = mix(detector.referenceBaseline, reference, 1 - Math.exp(-duration / .08));
    const referenceRise = Math.max(0, reference - detector.referenceBaseline);
    const bassAttack = !Number.isFinite(measured.bassRatio) || measured.bassRatio >= .75
      || (measured.bassRatio >= .25 && rise >= referenceRise * .75);
    const threshold = Math.max(.10, detector.baseline * .25);
    if (!detector.armed) {
      detector.peakBass = Math.max(detector.peakBass, measured.low);
      const release = detector.peakBass - (detector.peakBass - detector.floorBass) * .35;
      if (measured.low < release && measured.low < detector.baseline) detector.armed = true;
    }
    this.strobeHit = detector.armed && rise > threshold
      && measured.low > detector.previous.low && measured.low > .22
      && bassAttack
      && measured.low > measured.mid * 1.35 && measured.low > measured.high;
    if (this.strobeHit) {
      detector.armed = false;
      detector.peakBass = measured.low;
      detector.floorBass = previousBaseline;
    }
    detector.previous = measured;
    return this.strobeHit;
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

  directScene(delta, musicalEvent = {}, sidState) {
    const sidMode = Boolean(sidState);
    if (sidMode !== this.sidSceneMode) {
      this.sidSceneMode = sidMode;
      const scenes = sidMode ? SID_SCENES : SCENES;
      this.scene = sidMode ? scenes[0] : "terrain";
      this.previousScene = this.scene;
      this.previousSceneSeed = this.sceneSeed;
      this.sceneDeck = shuffle(scenes.filter((scene) => scene !== this.scene));
      this.sceneElapsed = 0;
      this.sceneDuration = 20;
      this.sceneTransition = 1;
      this.canvas.dataset.scene = this.scene;
      this.canvas.dataset.transitionReason = "opening";
    }
    if (sidState?.playing === false) return;
    const directionSpeed = this.reducedMotion ? 0.4 : 1;
    this.sceneElapsed += delta * directionSpeed;
    this.sceneTransition = Math.min(1, this.sceneTransition + delta / this.transitionDuration);
    const minimumHold = this.sceneDuration;
    const fallbackAt = this.sceneDuration + 2;
    let transitionReason;
    if (this.sceneElapsed >= minimumHold) {
      if (musicalEvent.returnFromDrop) transitionReason = "drop-return";
      else if (musicalEvent.toneBoundary) transitionReason = "tone-shift";
      else if (musicalEvent.phraseBoundary) transitionReason = "phrase-boundary";
      else if (musicalEvent.sectionBoundary && this.sceneElapsed >= (sidMode ? 7 : 12)) transitionReason = "section-shift";
      else if (musicalEvent.strongBeat && this.sceneElapsed >= this.sceneDuration) transitionReason = "accent";
    }
    if (!transitionReason && this.sceneElapsed >= fallbackAt && musicalEvent.beat) transitionReason = "fallback-beat";
    if (!transitionReason && this.sceneElapsed >= fallbackAt + 2) transitionReason = "maximum-hold";
    if (!transitionReason) return;

    if (!this.sceneDeck.length) this.sceneDeck = shuffle((sidMode ? SID_SCENES : SCENES).filter((scene) => scene !== this.scene));
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
    this.sceneDuration = 20;
    this.transitionDuration = clamp(this.music.beatInterval * 2, 0.8, 1.2) * (this.reducedMotion ? 1.25 : 1);
    this.sceneTransition = 0;
    this.music.beatsSinceScene = 0;
    this.music.toneSlow = [...this.music.toneFast];
    this.music.toneCentroidSlow = this.music.toneCentroidFast;
    this.music.toneShiftDuration = 0;
    this.canvas.dataset.scene = this.scene;
    this.canvas.dataset.transitionReason = transitionReason;
  }

  updateStarfield(delta, sidState, musicalEvent = {}) {
    this.starfield ??= {
      time: 0, energy: 0, bass: 0, treble: 0, pulse: 0, accent: 0,
      stars: Array.from({ length: 360 }, () => ({
        angle: randomUnit() * TAU,
        orbit: Math.sqrt(randomUnit()),
        depth: randomUnit(),
        size: 1 + randomUnit() * 1.1,
        tint: randomUnit()
      }))
    };
    if (sidState?.playing === false) return;
    const field = this.starfield;
    const motion = this.reducedMotion ? .15 : 1;
    const energy = clamp(this.signal.level ?? 0);
    const bass = clamp(this.signal.low ?? 0);
    field.energy = mix(field.energy, energy, follow(delta, .18));
    field.bass = mix(field.bass, bass, follow(delta, .24));
    field.treble = mix(field.treble, clamp(this.signal.high ?? 0), follow(delta, .14));
    if (musicalEvent.beat) field.pulse = Math.min(1, field.pulse + (musicalEvent.strongBeat ? .8 : .45));
    field.pulse *= Math.exp(-delta / .45);
    field.accent = mix(field.accent, field.pulse, follow(delta, .12));
    field.time += delta * motion * (.12 + energy * .3 + bass * .14);
  }

  drawStarfield(context, width, height) {
    if (!this.starfield) return;
    const field = this.starfield;
    const motion = this.reducedMotion ? .15 : 1;
    const scale = Math.hypot(width, height) * .65;
    const pixelRatio = this.pixelRatio ?? 1;
    context.save();
    const baseAlpha = context.globalAlpha;
    context.globalCompositeOperation = "source-over";
    for (const star of field.stars) {
      const angle = star.angle + field.time * (.5 + (1 - star.depth) * .8);
      const orbit = scale * star.orbit * (.85 + motion * (field.bass * .1 + field.accent * .05));
      const horizontal = width * .5 + Math.cos(angle) * orbit;
      const vertical = height * .5 + Math.sin(angle) * orbit;
      const radius = star.size * (.8 + (1 - star.depth) * .8 + field.treble * .45) * pixelRatio;
      context.globalAlpha = baseAlpha * (.16 + (1 - star.depth) * .18 + field.energy * .08 + motion * field.accent * .05);
      context.fillStyle = star.tint < .2 ? "#f5d9b0" : star.tint > .8 ? "#9adbea" : "#e3edf2";
      context.beginPath();
      context.arc(horizontal, vertical, radius, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  setStrobeEnabled(enabled) {
    this.strobeEnabled = Boolean(enabled) && !this.reducedMotion;
    this.strobe = { time: 0, lastFlashAt: -Infinity, age: 1, opacity: 0 };
    return this.strobeEnabled;
  }

  updateStrobe(delta, musicalEvent = {}, sidState) {
    if (this.reducedMotion && this.strobeEnabled) this.setStrobeEnabled(false);
    if (!this.strobeEnabled || sidState?.playing === false) {
      if (this.strobe) {
        this.strobe.opacity = 0;
        this.strobe.age = 1;
      }
      return;
    }
    const strobe = this.strobe;
    strobe.time += delta;
    strobe.age += delta;
    if (musicalEvent.beat) {
      strobe.age = 0;
      strobe.lastFlashAt = strobe.time;
    }
    strobe.opacity = strobe.age < .16 ? (1 - strobe.age / .16) ** 2 * .28 : 0;
  }

  drawStrobe(context, width, height) {
    if (!this.strobeEnabled || this.reducedMotion || !this.strobe?.opacity) return;
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = this.strobe.opacity;
    context.fillStyle = "#e9f5ff";
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  draw(time) {
    const startedAt = performance.now();
    const interval = time - this.lastTime;
    const delta = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.elapsed += delta * (this.reducedMotion ? 0.22 : 1);
    this.pointer.x = mix(this.pointer.x, this.pointer.targetX, follow(delta, .47));
    this.pointer.y = mix(this.pointer.y, this.pointer.targetY, follow(delta, .47));
    this.readSignal();
    const sidState = this.getSidState?.();
    const sidFeedback = sidState ? this.applySidRegisterFeedback(sidState, delta) : undefined;
    if (!sidState) {
      this.sidFeedbackChip = undefined;
      this.sidVoices = [];
    }
    const musicalEvent = this.analyzeMusic(delta);
    if (!sidState) updateGeneralMotion(this, delta, musicalEvent);
    this.updateCamera(delta, musicalEvent);
    this.directScene(delta, musicalEvent, sidState);
    this.updateStarfield(delta, sidState, musicalEvent);
    this.updateStrobe(delta, { beat: this.strobeHit }, sidState);
    if (this.resizePending || (this.pixelRatio !== undefined && this.pixelRatio !== (globalThis.devicePixelRatio || 1))) this.applyResize();
    this.paint(delta, sidState, sidFeedback);
    if (this.onFrame) {
      this.onFrame({
        time,
        elapsed: this.elapsed,
        scene: this.scene,
        sceneTransition: this.sceneTransition,
        signal: this.signal,
        music: this.music,
        channels: this.channels,
        sidState,
        sidFeedback,
        musicalEvent
      });
    }
    this.adaptQuality(interval, performance.now() - startedAt);
    this.animationFrame = requestAnimationFrame((nextTime) => this.draw(nextTime));
  }

  paint(delta, sidState, sidFeedback) {
    const context = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const centerX = width * (0.5 + this.pointer.x * 0.035);
    const centerY = height * (0.5 + this.pointer.y * 0.025);
    const cameraX = this.camera.x + this.camera.microX;
    const cameraY = this.camera.y + this.camera.microY;
    const backgroundX = centerX + cameraX * width * 0.28;
    const backgroundY = centerY + cameraY * height * 0.28;
    const progress = clamp(this.sceneTransition);
    const blend = progress * progress * (3 - 2 * progress);
    const visualSeed = mix(this.previousSceneSeed, this.sceneSeed, blend);
    const hue = 116 + visualSeed * 210 + Math.sin(this.elapsed * 0.08) * 28 + this.signal.high * 56;
    const background = context.createRadialGradient(backgroundX, backgroundY, 0, backgroundX, backgroundY, Math.hypot(width, height) * 0.72);
    background.addColorStop(0, sidState ? hsla(hue + 18, 54, 11 + this.signal.level * 5) : "#14191c");
    background.addColorStop(0.42, sidState ? "#07161d" : "#0b1013");
    background.addColorStop(1, "#020609");
    context.globalCompositeOperation = "source-over";
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    this.drawStarfield(context, width, height);

    context.save();
    context.translate(centerX + cameraX * width, centerY + cameraY * height);
    context.rotate(this.camera.roll);
    context.scale(this.camera.zoom, this.camera.zoom);
    context.translate(-centerX, -centerY);
    if (sidState) {
      if (this.sceneTransition < 1) {
        context.save();
        context.globalAlpha = 1 - blend;
        this.drawSidScene(context, this.previousScene, width, height, sidState, sidFeedback);
        context.restore();
      }
      context.save();
      context.globalAlpha = blend;
      this.drawSidScene(context, this.scene, width, height, sidState, sidFeedback);
      context.restore();
    } else if (this.sceneTransition < 1) {
      if (blend < 1) {
        context.save();
        context.globalAlpha = 1 - blend;
        this.drawScene(context, this.previousScene, width, height, centerX, centerY, this.previousSceneSeed);
        context.restore();
      }
      context.save();
      context.globalAlpha = blend;
      this.drawScene(context, this.scene, width, height, centerX, centerY, this.sceneSeed);
      context.restore();
    } else {
      this.drawScene(context, this.scene, width, height, centerX, centerY, this.sceneSeed);
    }
    context.restore();
    this.drawVignette(context, width, height);
    this.drawStrobe(context, width, height);
  }

  applySidRegisterFeedback(sidState, delta) {
    const registerFeedback = this.updateSidRegisterFeedback(sidState, delta);
    const playing = sidState.playing !== false;
    if (playing) this.sidTime += delta * (this.reducedMotion ? .18 : 1);
    const filter = sidState.filter ?? { cutoff: 0, resonance: 0, routing: 0, mode: 0, volume: 15 };
    registerFeedback.voices = sidState.voices.map((voice, index) => {
      const routed = Boolean(filter.routing & (1 << index));
      const audible = filter.volume > 0 && Boolean(voice.control & 0xf0) && !(voice.control & 8)
        && !(index === 2 && filter.voice3Off && !routed) && (!routed || Boolean(filter.mode));
      const target = audible ? clamp(voice.envelopeLevel ?? Number(Boolean(voice.control & 1))) * filter.volume / 15 : 0;
      const previous = this.sidVoices[index] ?? { energy: 0, pitch: 0, duty: .5 };
      previous.energy = audible ? mix(previous.energy, target, follow(delta, .09)) : 0;
      previous.pitch = mix(previous.pitch, Math.log2(1 + voice.frequency) / 16, follow(delta, .18));
      previous.duty = mix(previous.duty, voice.pulseWidth / 4095, follow(delta, .12));
      previous.routed = routed;
      previous.audible = audible;
      this.sidVoices[index] = previous;
      return previous;
    });
    let minimum = 1;
    let maximum = 0;
    for (const value of sidState.digi ?? []) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    registerFeedback.digiSwing = clamp(maximum - minimum);
    registerFeedback.filter = filter;
    const registerActivity = Math.max(...registerFeedback.voiceActivity, registerFeedback.filterActivity);
    this.signal.flux = Math.max(this.signal.flux, registerActivity * .14);
    this.signal.high = clamp(this.signal.high + registerActivity * .035);
    return registerFeedback;
  }

  sidWaveform(voice, position) {
    const step = ((position % 1) + 1) % 1;
    let value = 0;
    let count = 0;
    if (voice.control & 0x10) { value += 1 - 4 * Math.abs(step - .5); count++; }
    if (voice.control & 0x20) { value += step * 2 - 1; count++; }
    if (voice.control & 0x40) { value += step < voice.pulseWidth / 4095 ? 1 : -1; count++; }
    if (voice.control & 0x80) { value += Math.sin(Math.floor(position * 64) * 127.1 + voice.frequency) * .8; count++; }
    return count ? value / count : 0;
  }

  drawSidScene(context, scene, width, height, state, feedback) {
    context.save();
    context.globalCompositeOperation = "lighter";
    if (scene === "sid-warp") this.drawSidWarp(context, width, height, state, feedback);
    else if (scene === "sid-weave") this.drawSidWeave(context, width, height, state, feedback);
    else if (scene === "sid-crystal") this.drawSidCrystal(context, width, height, state, feedback);
    else if (scene === "sid-storm") this.drawSidStorm(context, width, height, state, feedback);
    else if (scene === "sid-matrix") this.drawSidMatrix(context, width, height, state, feedback);
    else if (scene === "sid-lissajous") this.drawSidLissajous(context, width, height, state, feedback);
    else if (scene === "sid-radar") this.drawSidRadar(context, width, height, state, feedback);
    else this.drawSidMachine(context, width, height, state, feedback);
    context.restore();
  }

  drawSidWarp(context, width, height, state, feedback) {
    const time = this.sidTime;
    const scale = Math.min(width, height);
    const cutoff = feedback.filter.cutoff / 2047;
    const centerX = width * (.5 + Math.sin(time * .21) * .12);
    const centerY = height * (.4 + Math.cos(time * .17) * .05);
    const count = this.detailCount(this.reducedMotion ? 22 : 42, 8);
    const points = this.detailCount(120, 48);
    for (let layer = 0; layer < count; layer++) {
      const voiceIndex = layer % 3;
      const voice = state.voices[voiceIndex];
      const visual = feedback.voices[voiceIndex];
      const depth = ((layer / count + time * (.08 + cutoff * .05)) % 1);
      const radius = scale * (.012 + depth * depth * 1.05);
      const sides = 3 + Math.floor(visual.duty * 5);
      const spin = time * .12 + depth * (1.5 + cutoff * 3);
      context.beginPath();
      for (let point = 0; point <= points; point++) {
        const turn = point / points;
        const angle = turn * TAU + spin;
        const polygon = Math.cos(Math.PI / sides) / Math.cos((turn * TAU % (TAU / sides)) - Math.PI / sides);
        const wave = this.sidWaveform(voice, turn * (3 + Math.floor(visual.pitch * 8)) + time * .2);
        const distance = radius * (polygon + wave * visual.energy * .2);
        const horizontal = centerX + Math.cos(angle) * distance * (width / height > 1.5 ? 1.3 : 1);
        const vertical = centerY + Math.sin(angle) * distance;
        point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
      }
      context.closePath();
      context.strokeStyle = hsla([168, 18, 48][voiceIndex] + depth * 35, 95, 65, (.12 + visual.energy * .65) * Math.sin(depth * Math.PI));
      context.lineWidth = Math.max(1, scale * .003 * depth);
      context.stroke();
    }
  }

  drawSidWeave(context, width, height, state, feedback) {
    const time = this.sidTime;
    const scale = Math.min(width, height);
    const strands = this.detailCount(this.reducedMotion ? 9 : 18);
    const points = this.detailCount(150, 48);
    for (let voiceIndex = 0; voiceIndex < 3; voiceIndex++) {
      const voice = state.voices[voiceIndex];
      const visual = feedback.voices[voiceIndex];
      const ring = voice.control & 4 && voice.control & 0x10;
      for (let strand = 0; strand < strands; strand++) {
        const depth = strand / strands;
        context.beginPath();
        for (let point = 0; point <= points; point++) {
          const position = point / points;
          const angle = position * TAU * (1 + visual.pitch * 2) - time * .6 + voiceIndex * TAU / 3;
          const wave = this.sidWaveform(voice, position * 5 + depth * .2 + time * .1);
          const modulation = ring ? Math.sin(angle * 3) : 1;
          const horizontal = position * width;
          const vertical = height * .43 + Math.sin(angle + depth * .8) * height * (.08 + visual.energy * .12)
            + wave * modulation * scale * .07 * visual.energy + (depth - .5) * scale * (.06 + visual.duty * .1);
          point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
        }
        context.strokeStyle = hsla([166, 8, 45][voiceIndex] + depth * 35, 90, 67, .1 + visual.energy * .4);
        context.lineWidth = Math.max(1, scale * .0014);
        context.stroke();
      }
    }
  }

  drawSidCrystal(context, width, height, state, feedback) {
    const time = this.sidTime;
    const scale = Math.min(width, height);
    const sectors = 8 + 2 * Math.floor(feedback.filter.resonance / 5);
    const layers = this.detailCount(this.reducedMotion ? 5 : 9);
    const cutoff = feedback.filter.cutoff / 2047;
    context.translate(width * .5, height * .41);
    drawCrystalFacets(context, scale, time, sectors, layers, cutoff, feedback.voices,
      (voiceIndex, position) => this.sidWaveform(state.voices[voiceIndex], position));
  }

  drawSidStorm(context, width, height, state, feedback) {
    const time = this.sidTime;
    const scale = Math.min(width, height);
    const count = this.detailCount(this.reducedMotion ? 100 : 260, 40);
    const cutoff = feedback.filter.cutoff / 2047;
    for (let particle = 0; particle < count; particle++) {
      const voiceIndex = particle % 3;
      const visual = feedback.voices[voiceIndex];
      const angle = particle * 2.399963 + time * .035;
      const phase = (particle * .618034 + time * (.12 + visual.pitch * .1)) % 1;
      const spread = phase * phase;
      const wave = this.sidWaveform(state.voices[voiceIndex], phase * 3 + time * .1);
      const bend = angle + Math.sin(phase * 5 + time * .2) * cutoff * .5;
      const distance = spread * scale * .9;
      const tail = scale * (.008 + visual.energy * .1 + feedback.digiSwing * .06) * spread;
      const centerX = width * .5 + wave * visual.energy * scale * .05;
      const centerY = height * .4;
      context.beginPath();
      context.moveTo(centerX + Math.cos(bend) * distance, centerY + Math.sin(bend) * distance);
      context.lineTo(centerX + Math.cos(bend) * (distance + tail), centerY + Math.sin(bend) * (distance + tail));
      context.strokeStyle = hsla([163, 16, 48][voiceIndex], 95, 72, Math.sin(phase * Math.PI) * (.15 + visual.energy * .75));
      context.lineWidth = Math.max(1, spread * scale * .004);
      context.stroke();
    }
    for (let voiceIndex = 0; voiceIndex < 3; voiceIndex++) {
      const energy = feedback.voices[voiceIndex].energy;
      context.beginPath();
      for (let point = 0; point <= 180; point++) {
        const position = point / 180;
        const horizontal = position * width;
        const vertical = height * (.32 + voiceIndex * .09) + this.sidWaveform(state.voices[voiceIndex], position * 9 + time * .2) * scale * .07 * energy;
        point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
      }
      context.strokeStyle = hsla([163, 16, 48][voiceIndex], 90, 80, .1 + energy * .6);
      context.stroke();
    }
  }

  drawSidMatrix(context, width, height, state, feedback) {
    const time = this.sidTime;
    const columns = this.detailCount(width < height ? 21 : 42, 12);
    const rows = this.detailCount(this.reducedMotion ? 14 : 24, 8);
    const cellWidth = width * .92 / columns;
    const cellHeight = height * .5 / rows;
    const cutoff = feedback.filter.cutoff / 2047;
    for (let column = 0; column < columns; column++) {
      const voiceIndex = column % 3;
      const voice = state.voices[voiceIndex];
      const visual = feedback.voices[voiceIndex];
      const wave = this.sidWaveform(voice, column / columns * 8 + time * .1);
      for (let row = 0; row < rows; row++) {
        const travel = (row / rows + time * (.08 + visual.pitch * .08) + column * .137) % 1;
        const pulse = Math.pow(1 - travel, 5);
        const gate = row / rows < (.12 + visual.energy * .85 + wave * .05);
        const register = this.sidRegisterFeedback.get(column % 25)?.level ?? 0;
        const light = gate ? .08 + pulse * (.4 + visual.energy * .5) : .025;
        context.fillStyle = hsla([164, 12, 48][voiceIndex] + (row / rows > cutoff ? 0 : 28), 90, 60 + register * 20, light);
        context.fillRect(width * .04 + column * cellWidth, height * .17 + row * cellHeight, cellWidth * .72, cellHeight * (.35 + visual.duty * .45));
      }
    }
    context.strokeStyle = hsla(320, 95, 76, .2 + feedback.digiSwing * .7);
    context.lineWidth = 2;
    context.beginPath();
    for (let point = 0; point <= 200; point++) {
      const position = point / 200;
      const horizontal = width * (.04 + position * .92);
      const vertical = height * (.18 + cutoff * .47) - (sampleAt(state.digi, position) - feedback.filter.volume / 15) * height * .04;
      point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
    }
    context.stroke();
  }

  drawSidLissajous(context, width, height, state, feedback) {
    const time = this.sidTime;
    const scale = Math.min(width, height);
    const layers = this.detailCount(this.reducedMotion ? 5 : 12, 2);
    const points = this.detailCount(360, 96);
    for (let voiceIndex = 0; voiceIndex < 3; voiceIndex++) {
      const voice = state.voices[voiceIndex];
      const visual = feedback.voices[voiceIndex];
      const source = feedback.voices[(voiceIndex + 2) % 3];
      const ratio = voice.control & 2 ? 2 : 2 + Math.floor(visual.pitch * 4);
      const otherRatio = 3 + Math.floor(source.pitch * 3);
      for (let layer = 0; layer < layers; layer++) {
        const depth = layer / layers;
        context.beginPath();
        for (let point = 0; point <= points; point++) {
          const phase = point / points * TAU;
          const twist = time * .17 + voiceIndex * 1.1 + depth * .12;
          const waveform = this.sidWaveform(voice, point / points * ratio + time * .08);
          const radius = scale * (.16 + visual.energy * .14 + depth * .035);
          const horizontal = width * .5 + Math.sin(phase * ratio + twist) * radius * (width > height ? 1.6 : 1);
          const vertical = height * .41 + Math.sin(phase * otherRatio) * radius * .8 + waveform * visual.energy * scale * .035;
          point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
        }
        context.strokeStyle = hsla([170, 350, 48][voiceIndex] + depth * 18, 94, 72, .06 + visual.energy * .2);
        context.lineWidth = Math.max(1, scale * .0013);
        context.stroke();
      }
    }
  }

  drawSidRadar(context, width, height, state, feedback) {
    const time = this.sidTime;
    const scale = Math.min(width, height);
    const sectors = this.detailCount(this.reducedMotion ? 48 : 96, 24);
    const cutoff = feedback.filter.cutoff / 2047;
    context.translate(width * .5, height * .41);
    for (let sector = 0; sector < sectors; sector++) {
      const voiceIndex = sector % 3;
      const visual = feedback.voices[voiceIndex];
      const angle = sector / sectors * TAU + time * .1;
      const wave = this.sidWaveform(state.voices[voiceIndex], sector / sectors * 9 + time * .1);
      const inner = scale * (.08 + cutoff * .07);
      const outer = inner + scale * (.06 + visual.energy * .18 + wave * visual.energy * .05);
      const sweep = (sector / sectors + time * .12) % 1;
      context.beginPath();
      context.arc(0, 0, inner, angle, angle + TAU / sectors * .7);
      context.arc(0, 0, outer, angle + TAU / sectors * .7, angle, true);
      context.closePath();
      context.fillStyle = hsla([166, 14, 46][voiceIndex], 93, 62, .1 + visual.energy * .35 + Math.pow(sweep, 8) * .25);
      context.fill();
      context.strokeStyle = hsla([166, 14, 46][voiceIndex], 95, 78, .2 + visual.energy * .45);
      context.lineWidth = Math.max(1, scale * .001);
      context.stroke();
    }
    for (let register = 0; register < 25; register++) {
      const activity = this.sidRegisterFeedback.get(register)?.level ?? 0;
      const angle = register / 25 * TAU - time * .06;
      context.strokeStyle = hsla(register < 21 ? [166, 14, 46][Math.floor(register / 7)] : 310, 95, 70, .15 + activity * .7);
      context.lineWidth = Math.max(1, scale * .004);
      context.beginPath();
      context.arc(0, 0, scale * (.36 + activity * .02), angle, angle + TAU / 25 * .55);
      context.stroke();
    }
  }

  drawSidMachine(context, width, height, sidState, feedback) {
    const time = this.sidTime;
    const portrait = height > width;
    const scale = Math.min(width, height);
    const { filter, voices, digiSwing } = feedback;
    const cutoff = filter.cutoff / 2047;
    const resonance = filter.resonance / 15;
    const hues = [167, 12, 47];
    const centers = portrait
      ? [[width * .28, height * .34], [width * .72, height * .34], [width * .5, height * (height < 700 ? .48 : .54)]]
      : [[width * .22, height * .43], [width * .5, height * .43], [width * .78, height * .43]];
    const radius = Math.min(width * (portrait ? .19 : .135), height * .2);
    const filterY = height * (portrait ? height < 700 ? .61 : .65 : .68);
    context.save();
    context.globalCompositeOperation = "lighter";
    const layers = this.detailCount(this.reducedMotion ? 10 : 22, 6);
    for (let layer = 0; layer < layers; layer++) {
      const depth = layer / layers;
      const spread = .1 + depth * depth * 1.8;
      context.strokeStyle = hsla(185 + (filter.mode & 0x40 ? 145 : 0) + depth * 35, 72, 58, .035 + depth * .1);
      context.lineWidth = Math.max(1, scale * .001);
      context.beginPath();
      for (let point = 0; point <= 96; point++) {
        const position = point / 96;
        const horizontal = (position - .5) * width * spread + width * .5;
        const ridge = Math.sin(position * TAU * (2 + cutoff * 9) - time + depth * 5);
        const vertical = height * .2 + depth * height * .56 + ridge * scale * (.014 + resonance * .035) * depth;
        point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
      }
      context.stroke();
    }
    for (const [index, voice] of sidState.voices.entries()) {
      const visual = voices[index];
      const [centerX, centerY] = centers[index];
      const activity = feedback.voiceActivity[index];
      const sourceIndex = (index + 2) % 3;
      const [sourceX, sourceY] = centers[sourceIndex];
      const ring = Boolean(voice.control & 4) && Boolean(voice.control & 0x10);
      const sync = Boolean(voice.control & 2);
      if ((ring || sync) && !(voice.control & 8)) {
        context.strokeStyle = hsla(ring ? 320 : 185, 92, 72, .18 + visual.energy * .45);
        context.lineWidth = Math.max(1, scale * .0015);
        context.setLineDash(sync ? [scale * .009, scale * .007] : []);
        context.beginPath();
        context.moveTo(sourceX, sourceY);
        context.bezierCurveTo(sourceX, sourceY - radius * 1.5, centerX, centerY - radius * 1.5, centerX, centerY);
        context.stroke();
        context.setLineDash([]);
      }
      if (visual.routed) {
        context.strokeStyle = hsla(hues[index], 90, 65, .12 + visual.energy * .35);
        context.beginPath();
        context.moveTo(centerX, centerY + radius * .65);
        context.bezierCurveTo(centerX, filterY, width * (.15 + cutoff * .7), centerY, width * (.15 + cutoff * .7), filterY);
        context.stroke();
      }
      const turns = 3 + Math.floor(visual.pitch * 9);
      const rotation = time * (.08 + visual.pitch * .16) * (index === 1 ? -1 : 1);
      const shellCount = this.detailCount(this.reducedMotion ? 4 : 8, 2);
      const points = this.detailCount(192, 64);
      for (let shell = shellCount - 1; shell >= 0; shell--) {
        const depth = shell / shellCount;
        context.beginPath();
        for (let point = 0; point <= points; point++) {
          const position = point / points;
          const angle = position * TAU + rotation + depth * .3;
          const oscillator = this.sidWaveform(voice, position * turns + time * .15 + depth * .12);
          const modulation = ring ? Math.sin(position * TAU * (2 + Math.floor(voices[sourceIndex].pitch * 7))) : 1;
          const folded = sync ? Math.abs(Math.sin(angle * 3)) * .15 : 0;
          const contour = .55 + depth * .35 + oscillator * modulation * visual.energy * (.16 + visual.duty * .2) + folded * visual.energy;
          const breath = 1 + Math.sin(angle * (3 + Math.floor(this.sceneSeed * 4)) + time * .3) * .08 * visual.energy;
          const horizontal = centerX + Math.cos(angle) * radius * contour * breath;
          const vertical = centerY + Math.sin(angle) * radius * contour * (1 + visual.energy * .15);
          point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
        }
        context.closePath();
        context.strokeStyle = hsla(hues[index] + depth * 22, 85, 60 + (1 - depth) * 18, visual.audible ? .12 + visual.energy * .4 * (1 - depth * .65) : .035);
        context.lineWidth = Math.max(1, scale * (shell === 0 ? .0022 : .001));
        context.stroke();
      }
      for (let register = 0; register < 7; register++) {
        const level = this.sidRegisterFeedback.get(index * 7 + register)?.level ?? 0;
        const angle = register / 7 * TAU - time * .08;
        const inner = radius * 1.08;
        const outer = inner + radius * (.05 + level * .25);
        context.strokeStyle = hsla(hues[index], 90, 75, .1 + level * .55);
        context.lineWidth = Math.max(1, scale * .002);
        context.beginPath();
        context.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
        context.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
        context.stroke();
      }
      if (visual.energy > .01) {
        context.strokeStyle = hsla(hues[index], 94, 76, .2 + activity * .3);
        context.lineWidth = Math.max(1, scale * .0015);
        context.beginPath();
        for (let point = 0; point <= 120; point++) {
          const position = point / 120;
          const horizontal = centerX + (position - .5) * radius * 2.7;
          const vertical = centerY + this.sidWaveform(voice, position * turns + time * .2) * radius * .24 * visual.energy;
          point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
        }
        context.stroke();
      }
    }
    for (let band = 0; band < 3; band++) {
      const enabled = Boolean(filter.mode & (0x10 << band));
      context.strokeStyle = hsla(185 + band * 65, 90, 70, enabled ? .3 + resonance * .3 : .04);
      context.lineWidth = Math.max(1, scale * .0015);
      context.beginPath();
      for (let point = 0; point <= 180; point++) {
        const position = point / 180;
        const distance = position - (.08 + cutoff * .84);
        const peak = Math.exp(-distance * distance * (60 + resonance * 220));
        const response = band === 0 ? 1 / (1 + Math.exp(distance * 20)) : band === 1 ? peak : 1 / (1 + Math.exp(-distance * 20));
        const horizontal = width * (.06 + position * .88);
        const vertical = filterY - (response * .045 + peak * resonance * .035) * height + band * scale * .008;
        point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
      }
      context.stroke();
    }
    if (digiSwing > .001) {
      context.strokeStyle = hsla(320, 95, 76, .5 + digiSwing * .3);
      context.lineWidth = Math.max(1, scale * .002);
      context.beginPath();
      for (let point = 0; point <= 256; point++) {
        const position = point / 256;
        const horizontal = position * width;
        const vertical = filterY + scale * .04 - (sampleAt(sidState.digi, position) - filter.volume / 15) * scale * .09;
        point ? context.lineTo(horizontal, vertical) : context.moveTo(horizontal, vertical);
      }
      context.stroke();
    }
    context.restore();
  }

  updateSidRegisterFeedback(sidState, delta) {
    if (sidState.chip !== this.sidFeedbackChip || sidState.revision < this.sidFeedbackRevision) {
      this.sidRegisterFeedback.clear();
      this.sidVoices = [];
      this.sidFeedbackChip = sidState.chip;
      this.sidLastWriteCycle = -Infinity;
    }
    this.sidFeedbackRevision = sidState.revision;
    for (const [address, activity] of this.sidRegisterFeedback) {
      activity.level *= Math.exp(-delta / .9);
      if (activity.level < .01) this.sidRegisterFeedback.delete(address);
    }
    for (const write of sidState.writes ?? []) {
      if (write.cyclePhi1 <= this.sidLastWriteCycle) continue;
      const activity = this.sidRegisterFeedback.get(write.address) ?? { level: 0 };
      activity.level = Math.min(1, activity.level + .45);
      this.sidRegisterFeedback.set(write.address, activity);
      this.sidLastWriteCycle = write.cyclePhi1;
    }
    const voiceActivity = [0, 1, 2].map((voice) => {
      const offset = voice * 7;
      let level = 0;
      for (let address = offset; address < offset + 7; address++) level = Math.max(level, this.sidRegisterFeedback.get(address)?.level ?? 0);
      return level;
    });
    const filterActivity = Math.max(...[0x15, 0x16, 0x17, 0x18].map((address) => this.sidRegisterFeedback.get(address)?.level ?? 0));
    return { voiceActivity, filterActivity };
  }

  drawScene(context, scene, width, height, centerX, centerY, seed = this.sceneSeed) {
    drawGeneralScene(this, context, scene, width, height, centerX, centerY, seed);
  }

  prepareShaderScenes() {
    if (this.shaderUnavailable || typeof document === "undefined" || !this.canvas?.getContext) return false;
    if (!this.shaderScenes) {
      try {
        this.shaderScenes = new ShaderScenes();
      } catch (error) {
        this.shaderUnavailable = true;
        console.warn("GPU visualizer unavailable; using Canvas scenes.", error);
        return false;
      }
    }
    return true;
  }

  drawShaderScene(context, scene, width, height, seed) {
    if (!this.prepareShaderScenes()) return false;
    return this.shaderScenes.draw(context, scene, width, height,
      this.generalMotion ?? { time: this.elapsed, signal: this.signal, channels: this.channels }, seed, this.quality);
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