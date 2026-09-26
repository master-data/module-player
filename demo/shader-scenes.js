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
float baseElevation(vec2 position) {
  float coarse = texture2D(terrainMap, position / 160.0).r;
  float ridge = texture2D(terrainMap, position / 57.0 + vec2(.31, .67)).r;
  float swell = sin(position.x * .11 + clock * .42) * cos(position.y * .085 - clock * .25);
  return pow(coarse, 1.6) * (24.0 + audio.x * 1.6 + impact * .6)
    + ridge * ridge * 3.0 + swell * (audio.y * .5 + impact * .2);
}
float elevation(vec2 position) {
  vec2 wave = waveAt(.5 + sin(position.x * .035 + position.y * .018) * .5);
  vec2 crossing = waveAt(.5 + sin(position.y * .027 - position.x * .016) * .5);
  return baseElevation(position) + wave.x * 1.6 + crossing.y * 1.1;
}
float surface(vec2 position, float distanceAlong) {
  return elevation(position);
}
vec3 sky(vec3 direction) {
  float altitude = max(direction.y, 0.0);
  vec3 color = mix(vec3(.57, .62, .67), vec3(.07, .20, .37), pow(altitude, .45));
  vec3 sun = normalize(vec3(-.65, .42, .7));
  color += vec3(1.0, .69, .36) * pow(max(dot(direction, sun), 0.0), 160.0) * 1.4;
  return color;
}
void main() {
  vec2 screen = (gl_FragCoord.xy * 2.0 - resolution) / resolution.y;
  float travel = clock * 2.7 + seed * 120.0;
  vec2 path = vec2(sin(travel * .025) * 12.0, travel);
  float altitude = baseElevation(path) + 7.8 + audio.x * .5;
  vec3 origin = vec3(path.x, altitude, path.y);
  vec3 forward = normalize(vec3(cos(travel * .025) * .3, -.24, 1.0));
  vec3 horizontal = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 vertical = cross(forward, horizontal);
  vec3 direction = normalize(forward * 1.6 + horizontal * screen.x + vertical * screen.y);
  float distanceAlong = .15;
  float lastDistance = distanceAlong;
  bool hit = false;
  vec3 point = origin;
  for (int stepIndex = 0; stepIndex < 1024; stepIndex++) {
    point = origin + direction * distanceAlong;
    float gap = point.y - surface(point.xz, distanceAlong);
    if (gap < max(.015, distanceAlong / resolution.y * .7)) { hit = true; break; }
    if (distanceAlong > 150.0) break;
    lastDistance = distanceAlong;
    distanceAlong += clamp(gap * .2, .01, 1.6 + detail * .4);
  }
  vec3 color = sky(direction);
  if (hit) {
    for (int refine = 0; refine < 5; refine++) {
      float middle = (lastDistance + distanceAlong) * .5;
      vec3 probe = origin + direction * middle;
      if (probe.y > surface(probe.xz, middle)) lastDistance = middle;
      else distanceAlong = middle;
    }
    point = origin + direction * distanceAlong;
    float epsilon = .14;
    float floorHeight = surface(point.xz, distanceAlong);
    vec3 normal = normalize(vec3(
      surface(point.xz - vec2(epsilon, 0.0), distanceAlong) - surface(point.xz + vec2(epsilon, 0.0), distanceAlong),
      epsilon * 2.0,
      surface(point.xz - vec2(0.0, epsilon), distanceAlong) - surface(point.xz + vec2(0.0, epsilon), distanceAlong)));
    vec3 sun = normalize(vec3(-.65, .42, .7));
    float shade = 1.0;
    for (int shadowStep = 1; shadowStep <= 8; shadowStep++) {
      float offset = float(shadowStep) * .65;
      vec3 probe = point + sun * offset;
      shade = min(shade, smoothstep(-.3, .5, probe.y - elevation(probe.xz)));
    }
    vec3 rock = mix(vec3(.035, .12, .075), vec3(.27, .30, .28), smoothstep(3.0, 10.0, floorHeight));
    rock = mix(rock, vec3(.46, .50, .48), smoothstep(12.0, 17.0, floorHeight) * smoothstep(.55, .9, normal.y));
    float diffuse = max(dot(normal, sun), 0.0);
    color = rock * (vec3(.13, .22, .28) + vec3(1.5, 1.22, .83) * diffuse * (.2 + shade * .8));
    color += vec3(.012, .026, .025) * pow(diffuse, 4.0) * (audio.z + impact * .2);
    float visibility = exp(-distanceAlong * .0075) * (1.0 - smoothstep(100.0, 150.0, distanceAlong));
    color = mix(sky(direction), color, visibility);
  }
  gl_FragColor = vec4(finish(color), 1.0);
}`;

function heightTexture() {
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
      for (let octave = 0; octave < 6; octave++) {
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

export class ShaderScenes {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, depth: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.texture = heightTexture();
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.waveform = new Float32Array(128);
    this.uniforms = {
      resolution: { value: new THREE.Vector2() }, clock: { value: 0 }, seed: { value: 0 },
      audio: { value: new THREE.Vector4() }, impact: { value: 0 }, detail: { value: 1 },
      terrainMap: { value: this.texture }, waveform: { value: this.waveform }
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

  draw(context, name, width, height, state, seed, quality) {
    if (this.renderer.getContext().isContextLost()) return false;
    const canvas = this.renderer.domElement;
    if (canvas.width !== width || canvas.height !== height) this.renderer.setSize(width, height, false);
    const { signal, time, impact = 0 } = state;
    this.uniforms.resolution.value.set(width, height);
    this.uniforms.clock.value = time;
    this.uniforms.seed.value = seed;
    this.uniforms.audio.value.set(signal.low, signal.mid, signal.high, signal.level);
    this.uniforms.impact.value = impact;
    this.uniforms.detail.value = quality;
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
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}