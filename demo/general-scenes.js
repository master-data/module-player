export const GENERAL_SCENES = ["aperture", "silk", "contours", "diffraction", "cascade", "interference", "weave", "prism", "monolith", "wavegarden", "terrain", "helix"];

const TAU = Math.PI * 2;
const PALETTES = {
  aperture: [174, 38], silk: [12, 183], contours: [162, 44], diffraction: [38, 200],
  cascade: [195, 16], interference: [176, 342], weave: [40, 186], prism: [188, 38],
  monolith: [190, 32], wavegarden: [165, 345]
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
  for (let side = 0; side < 2; side++) {
    const data = channels[side] ?? channels[0];
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

  if (scene === "terrain") {
    const layers = 5;
    const points = detail(64, 24);
    const bottom = height - centerY;
    const terrainTime = time;
    const response = renderer.reducedMotion ? .3 : 1;
    const hue = 150 + seed * 30 + Math.sin(terrainTime * .08) * 18;
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer < layers; layer++) {
      const depth = layer / (layers - 1);
      const side = layer % 2 ? 0 : 1;
      const data = side ? right : left;
      const energyData = motion?.energyChannels?.[side];
      const band = Math.min(1, bands[layer] * 2.5);
      const base = height * (.28 + depth * .64) - centerY
        - height * response * (low * (.025 + depth * .025) + impact * (.035 + (1 - depth) * .035));
      const amplitude = height * (.035 + (layers - 1 - layer) * .009
        + response * (low * .075 + band * .045 + impact * .055));
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
        curve.point(position * width - centerX, base - headroom * Math.tanh(wave / headroom));
      }
      curve.end();
      context.lineTo(width - centerX, bottom);
      context.lineTo(-centerX, bottom);
      context.closePath();
      const gradient = context.createLinearGradient(0, base - amplitude, 0, bottom);
      gradient.addColorStop(0, `hsla(${hue + layer * 18} 94% 68% / ${.13 + (8 - layer) * .012})`);
      gradient.addColorStop(1, `hsla(${hue + 110 + layer * 9} 84% 24% / .015)`);
      context.fillStyle = gradient;
      context.fill();
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
    const amplitude = height * (.18 + low * .08 + impact * .035);
    const ordinate = (position, strand) => Math.sin(position * TAU * 2.35 + time * .34 + strand * Math.PI)
      * amplitude + sample(strand ? right : left, position) * height * .055;
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
      curve.begin();
      for (let point = 0; point <= points; point++) {
        const position = point / points;
        const swell = Math.sin(position * TAU * (1.1 + seed * 1.4) + time * (.08 + depth * .03) + layer * .7);
        const cross = Math.sin(position * TAU * 3.2 - time * .05 + layer) * .25;
        const vertical = base + (swell + cross) * amplitude
          + sample(layer % 2 ? left : right, position) * amplitude * 1.4;
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
    for (let family = 0; family < 2; family++) {
      for (let strand = 0; strand < strands; strand++) {
        const depth = strand / (strands - 1);
        curve.begin();
        for (let point = 0; point <= points; point++) {
          const position = point / points;
          const phase = position * TAU * (.75 + seed * .35) + time * .18 + family * 2.7;
          const taper = Math.sin(position * Math.PI);
          const horizontal = (position - .5) * width * 1.12;
          const fold = Math.sin(phase + depth * 1.8 + impact * .24) * height * (.13 + low * .12 + impact * .09);
          const vertical = fold + (depth - .5) * scale * .18 * Math.cos(phase * .7)
            + audio(position, family) * scale * .09 * taper * (1 + mid);
          curve.point(horizontal, vertical);
        }
        curve.end();
        stroke(context, palette[family] + depth * 15, .16 + depth * .34 + level * .12, lineWidth);
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
    const columns = detail(width > height ? 60 : 36, 18);
    const rows = detail(28, 10);
    const cellWidth = width * .88 / columns;
    const cellHeight = height * .65 / rows;
    const travel = time * .17;
    for (let column = 0; column < columns; column++) {
      const position = column / (columns - 1);
      const band = bands[Math.min(5, Math.floor(position * 6))];
      const energy = Math.min(1, Math.abs(audio(position, column % 2)) * .55 + band * 1.8 + level * .18 + impact * .26);
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
    const rings = detail(18, 7);
    const segments = 6;
    const points = detail(32, 12);
    context.rotate(time * .045);
    for (let ring = 0; ring < rings; ring++) {
      const depth = ring / (rings - 1);
      const radius = scale * (.08 + depth * .31) * (1 + low * .2 + impact * .2);
      for (let segment = 0; segment < segments; segment++) {
        const energy = Math.min(1, bands[segment] * 2 + mid * .15);
        const start = segment / segments * TAU + depth * (.7 + Math.sin(time * .16) * .2 + impact * .25);
        curve.begin();
        for (let point = 0; point <= points; point++) {
          const position = point / points;
          const angle = start + position * TAU / segments * (.64 + energy * .23);
          const ripple = audio((segment + position) / segments, segment % 2) * scale * .055;
          const horizontal = Math.cos(angle) * (radius + ripple);
          const vertical = Math.sin(angle) * (radius + ripple);
          curve.point(horizontal, vertical);
        }
        curve.end();
        stroke(context, palette[segment % 3 === 0 ? 1 : 0] + depth * 18, .2 + energy * .5 + depth * .15, lineWidth * (ring % 7 === 0 ? 2 : 1));
      }
    }
  }
  context.restore();
}