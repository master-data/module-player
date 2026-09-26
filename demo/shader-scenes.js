import * as THREE from "./vendor/three/three.module.min.js";

export const SHADER_SCENES = ["checker-tunnel", "voxel-flight", "raster-twist"];

const vertexShader = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const common = `
precision highp float;
uniform vec2 resolution;
uniform float clock;
uniform float seed;
uniform vec4 audio;
uniform float impact;
uniform float detail;
uniform sampler2D terrainMap;
const float PI = 3.14159265359;
vec3 finish(vec3 color) { return pow(max(color, 0.0), vec3(0.4545)); }
`;

const tunnelShader = common + `
vec2 axis(float depth) {
  return vec2(sin(depth * .065 + clock * .07), cos(depth * .051 + clock * .06))
    * vec2(2.3, 1.7);
}
float wall(vec3 point) {
  return (3.4 + audio.x * .18 + impact * .08) - length(point.xy - axis(point.z));
}
void main() {
  vec2 screen = (gl_FragCoord.xy * 2.0 - resolution) / resolution.y;
  float travel = clock * 3.0 + seed * 80.0;
  vec3 origin = vec3(axis(travel), travel);
  vec3 forward = normalize(vec3((axis(travel + 2.0) - axis(travel)) / 2.0, 1.0));
  vec3 horizontal = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 vertical = cross(forward, horizontal);
  vec3 direction = normalize(forward * 1.8 + horizontal * screen.x + vertical * screen.y);
  float distanceAlong = 0.0;
  vec3 point = origin;
  bool hit = false;
  for (int stepIndex = 0; stepIndex < 768; stepIndex++) {
    point = origin + direction * distanceAlong;
    float gap = wall(point);
    if (gap < max(.002, distanceAlong / resolution.y)) { hit = true; break; }
    if (distanceAlong > 180.0) break;
    distanceAlong += max(.002, gap * .8);
  }
  vec3 fog = vec3(.002, .004, .006);
  vec3 color = fog;
  if (hit) {
    vec2 radial = point.xy - axis(point.z);
    float angle = atan(radial.y, radial.x) + point.z * .025 + sin(clock * .12) * .12 + audio.y * .06;
    vec2 tile = vec2(angle * 8.0 / PI, point.z * .42);
    vec2 footprint = vec2(length(dFdx(radial)), length(dFdy(radial))) / max(length(radial), .01);
    float angularWidth = (footprint.x + footprint.y) * 8.0 / PI + fwidth(point.z) * .025 * 8.0 / PI;
    vec2 filterWidth = max(vec2(angularWidth, fwidth(point.z) * .42), vec2(.001));
    vec2 checker = sin(PI * tile);
    float pattern = .5 + .5 * (2.0 * smoothstep(-filterWidth.x * PI, filterWidth.x * PI, checker.x) - 1.0)
      * (2.0 * smoothstep(-filterWidth.y * PI, filterWidth.y * PI, checker.y) - 1.0);
    pattern = mix(pattern, .5, smoothstep(.3, 1.0, max(filterWidth.x, filterWidth.y)));
    vec3 normal = normalize(vec3(-radial, dot(radial, (axis(point.z + .01) - axis(point.z - .01)) / .02)));
    vec3 lamp = origin + vec3(-1.2, 1.3, 5.0);
    vec3 lightDirection = normalize(lamp - point);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float specular = pow(max(dot(normal, normalize(lightDirection - direction)), 0.0), 18.0);
    vec3 surface = mix(vec3(.006, .009, .012), vec3(.045, .075, .083), pattern);
    vec2 materialPosition = vec2(cos(angle), sin(angle)) * .24 + vec2(point.z * .009, point.z * .013);
    float clouds = texture2D(terrainMap, materialPosition).r;
    float flow = sin(angle * 6.0 + point.z * .8 + clouds * 6.0 + sin(angle * 4.0 - point.z * .19));
    float veins = smoothstep(.4 - fwidth(flow), .8 + fwidth(flow), flow);
    float weave = sin(angle * 48.0 + point.z * 7.0) * sin(angle * 48.0 - point.z * 7.0);
    float etching = (.5 + .5 * weave) * (1.0 - smoothstep(.15, .7, angularWidth * 6.0 + fwidth(point.z) * 7.0 / PI));
    vec3 textureBlend = smoothstep(vec3(.04), vec3(.75), audio.xyz) * clamp(audio.w * 2.5, 0.0, 1.0);
    surface *= mix(1.0, .55 + clouds * 1.1, textureBlend.x * .8);
    vec3 flowingSurface = mix(vec3(.009, .025, .027), vec3(.065, .034, .022), veins) * (.5 + pattern * .5);
    surface = mix(surface, flowingSurface, textureBlend.y * .65);
    surface *= 1.0 - etching * textureBlend.z * .25;
    float pulse = pow(.5 + .5 * sin(point.z * .35 - clock * .7), 6.0);
    color = surface * (.3 + diffuse * .65) + specular * vec3(.025, .04, .05) * (.5 + audio.z * .2);
    vec3 glow = mix(vec3(.007, .055, .065), vec3(.065, .012, .018), .5 + .5 * sin(angle * 2.0 + clock * .09));
    color += glow * pulse * (.3 + audio.w * .35 + impact * .12);
    color += vec3(.008, .025, .026) * etching * veins * textureBlend.z;
    float visibility = exp(-distanceAlong * .026) * (1.0 - smoothstep(85.0, 145.0, distanceAlong));
    color = mix(fog, color, visibility);
  }
  gl_FragColor = vec4(finish(color), 1.0);
}`;

const waveformShader = `
uniform vec2 waveform[64];
vec2 waveAt(float position) {
  float offset = clamp(position, 0.0, 1.0) * 63.0;
  int index = int(floor(offset));
  float fraction = fract(offset);
  vec2 before = waveform[max(0, index - 1)];
  vec2 start = waveform[index];
  vec2 end = waveform[min(63, index + 1)];
  vec2 after = waveform[min(63, index + 2)];
  return clamp(.5 * ((2.0 * start) + (-before + end) * fraction
    + (2.0 * before - 5.0 * start + 4.0 * end - after) * fraction * fraction
    + (-before + 3.0 * start - 3.0 * end + after) * fraction * fraction * fraction), -1.0, 1.0);
}
`;

const rasterShader = common + waveformShader + `
vec3 ribbonLocal(vec3 point) {
  float aspect = resolution.x / resolution.y;
  vec2 wave = waveAt((point.y + 2.08) / 4.16);
  float axis = wave.x * min(.72, aspect * .65);
  float twist = clock * .55 + seed * PI * 2.0 + point.y * 2.0
    + sin(point.y * 1.1 + clock * .21) * (.65 + audio.y * .25) + impact * .12;
  vec2 radial = point.xz - vec2(axis, wave.y * min(.32, aspect * .2));
  float cosine = cos(twist);
  float sine = sin(twist);
  return vec3(cosine * radial.x - sine * radial.y, point.y, sine * radial.x + cosine * radial.y);
}
float ribbon(vec3 point) {
  float width = min(.95, resolution.x / resolution.y * 1.22) * (1.0 + audio.x * .09 + impact * .06);
  vec3 bounds = abs(ribbonLocal(point)) - vec3(width, 2.08, width * .65);
  return length(max(bounds, 0.0)) + min(max(bounds.x, max(bounds.y, bounds.z)), 0.0) - .085;
}
void main() {
  vec2 screen = (gl_FragCoord.xy * 2.0 - resolution) / resolution.y;
  vec3 origin = vec3(screen * 2.65, 6.0);
  vec3 direction = vec3(0.0, 0.0, -1.0);
  float distanceAlong = 0.0;
  float tolerance = 1.2 / resolution.y;
  float closest = 100.0;
  vec3 nearest = origin;
  vec3 point = origin;
  bool hit = false;
  for (int stepIndex = 0; stepIndex < 192; stepIndex++) {
    point = origin + direction * distanceAlong;
    float gap = ribbon(point);
    if (gap < closest) { closest = gap; nearest = point; }
    if (gap < tolerance * .15) { hit = true; break; }
    if (distanceAlong > 9.0) break;
    distanceAlong += max(gap * .85, tolerance * .1);
  }
  float coverage = hit ? 1.0 : 1.0 - smoothstep(0.0, tolerance * 2.0, closest);
  if (coverage <= 0.0) { gl_FragColor = vec4(0.0); return; }
  if (!hit) point = nearest;
  float epsilon = .003;
  vec3 normal = normalize(vec3(
    ribbon(point + vec3(epsilon, 0.0, 0.0)) - ribbon(point - vec3(epsilon, 0.0, 0.0)),
    ribbon(point + vec3(0.0, epsilon, 0.0)) - ribbon(point - vec3(0.0, epsilon, 0.0)),
    ribbon(point + vec3(0.0, 0.0, epsilon)) - ribbon(point - vec3(0.0, 0.0, epsilon))));
  vec3 local = ribbonLocal(point);
  vec3 light = normalize(vec3(-.7, .5, 1.2));
  vec3 rimLight = normalize(vec3(.9, -.2, .8));
  float diffuse = max(dot(normal, light), 0.0);
  float fresnel = pow(1.0 - max(normal.z, 0.0), 3.0);
  float iridescence = .5 + .5 * sin(local.y * 1.4 + normal.x * 2.5 + clock * .13);
  vec3 metal = mix(vec3(.045, .28, .30), vec3(.48, .14, .055), iridescence);
  metal = mix(metal, vec3(.4, .49, .5), fresnel * .4);
  float softbox = pow(max(dot(normal, normalize(light - direction)), 0.0), 32.0);
  float rim = pow(max(dot(normal, normalize(rimLight - direction)), 0.0), 48.0);
  vec3 color = metal * (.25 + diffuse * .65);
  color += vec3(.45, .55, .58) * softbox * (.6 + audio.z * .15);
  color += vec3(.3, .12, .055) * rim * .45 + metal * fresnel * (.2 + audio.z * .15);
  color = color / (vec3(1.0) + color * .6);
  gl_FragColor = vec4(finish(color) * coverage, coverage);
}`;

const terrainShader = common + waveformShader + `
uniform float beaconPulse;
uniform sampler2D flightMap;
uniform float flightClock;
uniform vec4 cameraAudio;
float mountainMass(vec2 position) {
  float coarse = texture2D(terrainMap, position / 190.0).r;
  return pow(coarse, 2.2) * (90.0 + audio.x * 2.0 + impact);
}
float baseElevation(vec2 position) {
  float rolling = texture2D(terrainMap, position / 100.0 + vec2(.31, .67)).r;
  return mountainMass(position) + rolling * 3.0;
}
float elevation(vec2 position) {
  vec2 wave = waveAt(.5 + sin(position.x * .035 + position.y * .018) * .5);
  vec2 crossing = waveAt(.5 + sin(position.y * .027 - position.x * .016) * .5);
  return baseElevation(position) + wave.x * .6 + crossing.y * (.4 + audio.y * .1);
}
const float flightRange = 240.0;
vec2 flightPath(float travel) {
  float angle = travel * .014 + sin(travel * .008) * .35;
  float radius = 68.0 + sin(travel * .011) * 22.0;
  return vec2(sin(angle), cos(angle)) * radius;
}
float flightHeight(vec2 position, float time) {
  vec2 coordinate = position / 190.0 * 128.0 - .5;
  vec2 base = floor(coordinate);
  vec2 fraction = fract(coordinate);
  vec2 inverse = 1.0 - fraction;
  vec2 weight0 = inverse * inverse * inverse / 6.0;
  vec2 weight1 = (3.0 * fraction * fraction * fraction - 6.0 * fraction * fraction + 4.0) / 6.0;
  vec2 weight2 = (-3.0 * fraction * fraction * fraction + 3.0 * fraction * fraction + 3.0 * fraction + 1.0) / 6.0;
  vec2 weight3 = fraction * fraction * fraction / 6.0;
  vec2 lowerWeight = weight0 + weight1;
  vec2 upperWeight = weight2 + weight3;
  vec2 lower = (base - .5 + weight1 / lowerWeight) / 128.0;
  vec2 upper = (base + 1.5 + weight3 / upperWeight) / 128.0;
  float ground = texture2D(flightMap, lower).r * lowerWeight.x * lowerWeight.y
    + texture2D(flightMap, vec2(upper.x, lower.y)).r * upperWeight.x * lowerWeight.y
    + texture2D(flightMap, vec2(lower.x, upper.y)).r * lowerWeight.x * upperWeight.y
    + texture2D(flightMap, upper).r * upperWeight.x * upperWeight.y;
  return ground + 9.0 + (sin(time * .24 + seed * PI * 2.0) * .5 + .5) * 16.0;
}
vec3 sky(vec3 direction) {
  float altitude = max(direction.y, 0.0);
  vec3 color = mix(vec3(.46, .56, .66), vec3(.045, .16, .31), pow(altitude, .45));
  vec3 sun = normalize(vec3(-.65, .42, .7));
  color += vec3(1.0, .69, .36) * pow(max(dot(direction, sun), 0.0), 160.0) * 1.4;
  return color;
}
float beaconBox(vec3 origin, vec3 direction, vec3 center, vec3 bounds) {
  vec3 inverse = (step(vec3(0.0), direction) * 2.0 - 1.0) / max(abs(direction), vec3(.000001));
  vec3 first = (center - bounds - origin) * inverse;
  vec3 second = (center + bounds - origin) * inverse;
  vec3 entry = min(first, second);
  vec3 exit = max(first, second);
  float nearDistance = max(entry.x, max(entry.y, entry.z));
  float farDistance = min(exit.x, min(exit.y, exit.z));
  return farDistance >= max(nearDistance, 0.0) ? max(nearDistance, 0.0) : 10000.0;
}
void main() {
  vec2 screen = (gl_FragCoord.xy * 2.0 - resolution) / resolution.y;
  float travel = flightClock * 11.0 + seed * 120.0;
  vec2 path = flightPath(travel);
  vec2 ahead = flightPath(travel + 10.0);
  vec2 beyond = flightPath(travel + 22.0);
  vec2 heading = normalize(ahead - path);
  vec2 nextHeading = normalize(beyond - ahead);
  vec2 sway = vec2(heading.y, -heading.x) * cameraAudio.w * 2.5;
  path += sway;
  ahead += sway;
  float lift = cameraAudio.x * 4.0 + cameraAudio.y * 1.5;
  vec3 origin = vec3(path.x, flightHeight(path, flightClock) + lift, path.y);
  float climb = (flightHeight(ahead, flightClock + 10.0 / 11.0) + lift - origin.y) / max(length(ahead - path), 1.0);
  float pitch = -.16 + .42 * climb / sqrt(1.0 + climb * climb) + cameraAudio.x * .03 - cameraAudio.z * .02;
  float turn = heading.x * nextHeading.y - heading.y * nextHeading.x;
  float bank = .3 * turn / sqrt(.012 + turn * turn) + cameraAudio.w * .055
    + sin(flightClock * .19 + seed * PI * 2.0) * .035
    + sin(flightClock * .4 + seed * PI * 2.0) * cameraAudio.y * .025;
  float yaw = sin(flightClock * .16 + seed * PI * 2.0) * .045 + cameraAudio.w * .045;
  heading = normalize(mix(heading, normalize(-path), .8 + sin(flightClock * .15) * .06));
  heading = vec2(heading.x * cos(yaw) + heading.y * sin(yaw), heading.y * cos(yaw) - heading.x * sin(yaw));
  vec3 forward = normalize(vec3(heading.x, pitch, heading.y));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);
  vec3 horizontal = right * cos(bank) + up * sin(bank);
  vec3 vertical = up * cos(bank) - right * sin(bank);
  vec3 direction = normalize(forward * (1.45 - cameraAudio.z * .035) + horizontal * screen.x + vertical * screen.y);
  float distanceAlong = 0.0;
  float lastDistance = 0.0;
  bool hit = false;
  for (int stepIndex = 0; stepIndex < 1024; stepIndex++) {
    if (distanceAlong > flightRange) break;
    vec3 probe = origin + direction * distanceAlong;
    float gap = probe.y - elevation(probe.xz);
    if (gap < max(.012, distanceAlong / resolution.y * .65)) { hit = true; break; }
    lastDistance = distanceAlong;
    distanceAlong += clamp(gap * .16, .006, 2.0);
  }
  vec3 color = sky(direction);
  if (hit) {
    for (int refine = 0; refine < 5; refine++) {
      float middle = (lastDistance + distanceAlong) * .5;
      vec3 probe = origin + direction * middle;
      if (probe.y > elevation(probe.xz)) lastDistance = middle;
      else distanceAlong = middle;
    }
    vec3 point = origin + direction * distanceAlong;
    float epsilon = .45;
    vec3 normal = normalize(vec3(
      elevation(point.xz - vec2(epsilon, 0.0)) - elevation(point.xz + vec2(epsilon, 0.0)),
      epsilon * 2.0,
      elevation(point.xz - vec2(0.0, epsilon)) - elevation(point.xz + vec2(0.0, epsilon))));
    vec3 sun = normalize(vec3(-.65, .42, .7));
    float shade = 1.0;
    for (int shadowStep = 1; shadowStep <= 12; shadowStep++) {
      float offset = float(shadowStep) * .9;
      vec3 probe = point + normal * .12 + sun * offset;
      shade = min(shade, smoothstep(-.25, .6, probe.y - elevation(probe.xz)));
    }
    float mineral = texture2D(terrainMap, point.xz / 32.0).r;
    vec3 rock = mix(vec3(.065, .075, .08), vec3(.24, .22, .19), mineral);
    float meadow = (1.0 - smoothstep(10.0, 20.0, point.y)) * smoothstep(.45, .8, normal.y);
    rock = mix(rock, vec3(.065, .13, .08), meadow * .7);
    float snow = smoothstep(17.0, 29.0, point.y + mineral * 5.0)
      * smoothstep(.35, .8, normal.y);
    rock = mix(rock, vec3(.72, .79, .82), snow);
    float diffuse = max(dot(normal, sun), 0.0);
    color = rock * (vec3(.24, .30, .34) + vec3(1.1, .98, .8) * diffuse * (.4 + shade * .6));
    color += vec3(.012, .026, .025) * pow(diffuse, 4.0) * (audio.z + impact * .2);
    float visibility = exp(-distanceAlong * .0035) * (1.0 - smoothstep(170.0, flightRange, distanceAlong));
    color = mix(sky(direction), color, visibility);
  }
  float visibleDistance = hit ? distanceAlong : flightRange;
  vec2 beaconLocation = vec2(0.0);
  vec3 lamp = vec3(beaconLocation.x, baseElevation(beaconLocation) + 22.0, beaconLocation.y);
  {
    float towerDistance = beaconBox(origin, direction, lamp - vec3(0.0, 11.0, 0.0), vec3(.5, 11.0, .5));
    float visibility = 1.0 - smoothstep(110.0, flightRange, length(lamp - origin));
    if (towerDistance < visibleDistance) {
      vec3 towerPoint = origin + direction * towerDistance;
      float cap = smoothstep(lamp.y - 1.0, lamp.y - .65, towerPoint.y);
      vec3 towerColor = mix(vec3(.025, .035, .04), vec3(.55, .055, .008) * (.45 + beaconPulse * 3.0), cap);
      color = mix(color, towerColor, visibility * exp(-towerDistance * .006));
      visibleDistance = towerDistance;
    }
  }
  {
    lamp.y += .25;
    float along = dot(lamp - origin, direction);
    if (along > 0.0 && along < visibleDistance) {
      vec3 separation = origin + direction * along - lamp;
      float radius = length(separation);
      float footprint = max(along / resolution.y, .025);
      float core = 1.0 - smoothstep(.12, .20 + footprint, radius);
      float halo = exp(-radius * radius / 1.4) * beaconPulse;
      float shaft = exp(-dot(separation.xz, separation.xz) / (.025 + footprint * footprint))
        * exp(-abs(separation.y) / 2.8) * beaconPulse;
      float visibility = 1.0 - smoothstep(110.0, flightRange, along);
      color += visibility * (vec3(1.0, .32, .055) * (core * (.4 + beaconPulse * 2.0) + halo * .65)
        + vec3(1.0, .65, .28) * shaft * .8);
    }
  }
  vec3 beamDirection = normalize(vec3(sin(flightClock * .65), -.08, cos(flightClock * .65)));
  float beam = 0.0;
  float beamStep = min(visibleDistance, 150.0) / 40.0;
  for (int beamIndex = 0; beamIndex < 40; beamIndex++) {
    vec3 point = origin + direction * (float(beamIndex) + .5) * beamStep;
    vec3 fromLamp = point - lamp;
    float along = dot(fromLamp, beamDirection);
    if (along <= 0.0 || along >= 120.0) continue;
    float radius = length(fromLamp - beamDirection * along);
    float cone = 1.0 - smoothstep(along * .018 + .15, along * .06 + .35, radius);
    if (cone <= 0.0) continue;
    float clear = 1.0;
    for (int shadowIndex = 1; shadowIndex <= 16; shadowIndex++) {
      vec3 probe = mix(lamp, point, float(shadowIndex) / 16.0);
      if (probe.y < elevation(probe.xz)) { clear = 0.0; break; }
    }
    beam += cone * clear * exp(-along * .025) * beamStep;
  }
  color += vec3(1.0, .52, .18) * (1.0 - exp(-beam * .12)) * (.16 + beaconPulse * .84);
  gl_FragColor = vec4(finish(color), 1.0);
}`;

function heightTexture(octaves = 6) {
  const size = 512;
  const values = new Uint16Array(size * size * 4);
  const hash = (horizontal, vertical) => {
    const value = Math.sin(horizontal * 127.1 + vertical * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const noise = (horizontal, vertical, period) => {
    const column = Math.floor(horizontal);
    const row = Math.floor(vertical);
    const smooth = value => value * value * (3 - 2 * value);
    const across = smooth(horizontal - column);
    const down = smooth(vertical - row);
    const value = (offsetX, offsetY) => hash((column + offsetX) % period, (row + offsetY) % period);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(value(0, 0), value(1, 0), across),
      THREE.MathUtils.lerp(value(0, 1), value(1, 1), across), down);
  };
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let value = 0;
      let amplitude = .5;
      for (let octave = 0; octave < octaves; octave++) {
        const period = 4 * 2 ** octave;
        value += noise(column / size * period, row / size * period, period) * amplitude;
        amplitude *= .5;
      }
      const offset = (row * size + column) * 4;
      values[offset] = values[offset + 1] = values[offset + 2] = THREE.DataUtils.toHalfFloat(value);
      values[offset + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(values, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createFlightHeightTexture(terrain) {
  const size = 128;
  const sourceSize = terrain.image.width;
  const block = sourceSize / size;
  let heights = new Float32Array(size * size);
  for (let row = 0; row < sourceSize; row++) {
    for (let column = 0; column < sourceSize; column++) {
      const height = THREE.DataUtils.fromHalfFloat(terrain.image.data[(row * sourceSize + column) * 4]);
      const index = Math.floor(row / block) * size + Math.floor(column / block);
      heights[index] = Math.max(heights[index], Math.pow(height, 2.2) * 93.2);
    }
  }
  const weights = [1, 4, 7, 10, 13, 10, 7, 4, 1];
  for (const maximum of [true, false]) {
    const radius = maximum ? 12 : 4;
    for (const horizontal of [true, false]) {
      const filtered = new Float32Array(heights.length);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          let value = 0;
          for (let offset = -radius; offset <= radius; offset++) {
            const sourceRow = horizontal ? row : (row + offset + size) % size;
            const sourceColumn = horizontal ? (column + offset + size) % size : column;
            const height = heights[sourceRow * size + sourceColumn];
            value = maximum ? Math.max(value, height) : value + height * weights[offset + radius] / 57;
          }
          filtered[row * size + column] = value;
        }
      }
      heights = filtered;
    }
  }
  const values = new Uint16Array(size * size * 4);
  for (let index = 0; index < heights.length; index++) {
    values[index * 4] = values[index * 4 + 1] = values[index * 4 + 2] = THREE.DataUtils.toHalfFloat(heights[index]);
    values[index * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const texture = new THREE.DataTexture(values, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class ShaderScenes {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, depth: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.texture = heightTexture();
    this.mountainTexture = heightTexture(3);
    this.flightTexture = createFlightHeightTexture(this.mountainTexture);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.waveform = new Float32Array(128);
    this.uniforms = {
      resolution: { value: new THREE.Vector2() }, clock: { value: 0 }, seed: { value: 0 },
      audio: { value: new THREE.Vector4() }, impact: { value: 0 }, detail: { value: 1 },
      terrainMap: { value: this.texture }, flightMap: { value: this.flightTexture },
      waveform: { value: this.waveform }, beaconPulse: { value: 0 }, flightClock: { value: 0 },
      cameraAudio: { value: new THREE.Vector4() }
    };
    this.materials = [tunnelShader, terrainShader, rasterShader].map(fragmentShader => new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false
    }));
    this.mesh = new THREE.Mesh(this.geometry, this.materials[0]);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    for (const material of this.materials) {
      this.mesh.material = material;
      this.renderer.compile(this.scene, this.camera);
    }
  }

  updateWaveform(channels = []) {
    for (let side = 0; side < 2; side++) {
      const samples = channels[side] ?? channels[0];
      for (let point = 0; point < 64; point++) {
        let value = 0;
        if (samples?.length) {
          const offset = point / 63 * (samples.length - 1);
          const index = Math.floor(offset);
          const start = Number.isFinite(samples[index]) ? samples[index] : 0;
          const end = Number.isFinite(samples[Math.min(index + 1, samples.length - 1)])
            ? samples[Math.min(index + 1, samples.length - 1)] : 0;
          value = THREE.MathUtils.lerp(start, end, offset - index);
        }
        this.waveform[point * 2 + side] = THREE.MathUtils.clamp(value * 4 / (1 + Math.abs(value) * 3), -1, 1);
      }
    }
  }

  draw(context, name, width, height, state, seed, quality, beaconPulse = 0, flightTime = state.time) {
    if (this.renderer.getContext().isContextLost()) return false;
    const canvas = this.renderer.domElement;
    if (canvas.width !== width || canvas.height !== height) this.renderer.setSize(width, height, false);
    const { signal, time, impact = 0 } = state;
    this.uniforms.resolution.value.set(width, height);
    this.uniforms.clock.value = time;
    this.uniforms.flightClock.value = flightTime;
    const cameraAudio = state.flight?.values;
    this.uniforms.cameraAudio.value.set(cameraAudio?.[0] ?? 0, cameraAudio?.[1] ?? 0,
      cameraAudio?.[2] ?? 0, cameraAudio?.[3] ?? 0);
    this.uniforms.seed.value = seed;
    this.uniforms.audio.value.set(signal.low, signal.mid, signal.high, signal.level);
    this.uniforms.impact.value = impact;
    this.uniforms.detail.value = quality;
    this.uniforms.terrainMap.value = name === "voxel-flight" ? this.mountainTexture : this.texture;
    this.uniforms.beaconPulse.value = Number.isFinite(beaconPulse) ? THREE.MathUtils.clamp(beaconPulse, 0, 1) : 0;
    if (name === "raster-twist" || name === "voxel-flight") this.updateWaveform(state.channels);
    this.mesh.material = this.materials[SHADER_SCENES.indexOf(name)];
    this.renderer.render(this.scene, this.camera);
    context.drawImage(canvas, 0, 0, width, height);
    return true;
  }

  dispose() {
    this.materials.forEach(material => material.dispose());
    this.geometry.dispose();
    this.texture.dispose();
    this.mountainTexture.dispose();
    this.flightTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}