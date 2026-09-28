import * as THREE from "./vendor/three/three.module.min.js";

export const SHADER_SCENES = ["checker-tunnel", "voxel-flight", "raster-twist", "metaball-foundry", "polar-plasma"];
export const WAVEFORM_POINTS = 256;
const WAVEFORM_RADIUS = 16;
const waveformKernel = Float64Array.from({ length: WAVEFORM_RADIUS * 2 + 1 }, (_, index) =>
  Math.exp(-.5 * ((index - WAVEFORM_RADIUS) / 7) ** 2));
const waveformWeight = waveformKernel.reduce((sum, value) => sum + value, 0);

function horizonDirection(longitude, latitude, rotation, target, offset) {
  const tilt = 23.44 * Math.PI / 180;
  const observer = 48 * Math.PI / 180;
  const horizontal = Math.cos(longitude) * Math.cos(latitude);
  const orbital = Math.sin(longitude) * Math.cos(latitude);
  const vertical = Math.sin(latitude);
  const equatorial = orbital * Math.cos(tilt) - vertical * Math.sin(tilt);
  const polar = orbital * Math.sin(tilt) + vertical * Math.cos(tilt);
  const meridian = Math.cos(rotation) * horizontal + Math.sin(rotation) * equatorial;
  target[offset] = -Math.sin(rotation) * horizontal + Math.cos(rotation) * equatorial;
  target[offset + 1] = Math.cos(observer) * meridian + Math.sin(observer) * polar;
  target[offset + 2] = -Math.sin(observer) * meridian + Math.cos(observer) * polar;
}

export function flightSkyDirections(time, seed = 0, target = new Float64Array(6)) {
  const days = Math.max(0, Number.isFinite(time) ? time : 0) / 1200;
  const solarLongitude = Math.PI * 2 / 3 + days * Math.PI * 2 / 365.25;
  const ascension = Math.atan2(Math.sin(solarLongitude) * Math.cos(23.44 * Math.PI / 180), Math.cos(solarLongitude));
  const rotation = ascension + 1.28 + (Number.isFinite(seed) ? seed : 0) * .1 + days * Math.PI * 2;
  const lunarLongitude = solarLongitude + 2.35 + days * Math.PI * 2 / 29.53;
  const lunarLatitude = Math.sin(lunarLongitude - .8) * 5.145 * Math.PI / 180;
  horizonDirection(solarLongitude, 0, rotation, target, 0);
  horizonDirection(lunarLongitude, lunarLatitude, rotation, target, 3);
  return target;
}

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
uniform sampler2D waveformMap;
vec2 waveformPoint(int index) {
  return texelFetch(waveformMap, ivec2(clamp(index, 0, ${WAVEFORM_POINTS - 1}), 0), 0).rg;
}
vec2 waveAt(float position) {
  float offset = clamp(position, 0.0, 1.0) * ${WAVEFORM_POINTS - 1}.0;
  int index = int(floor(offset));
  float fraction = fract(offset);
  vec2 before = waveformPoint(index - 1);
  vec2 start = waveformPoint(index);
  vec2 end = waveformPoint(index + 1);
  vec2 after = waveformPoint(index + 2);
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
  float twist = clock * .35 + seed * PI * 2.0 + point.y * 1.35
    + sin(point.y * 1.1 + clock * .21) * (.65 + audio.y * .25) + impact * .12;
  vec2 radial = point.xz - vec2(axis, wave.y * min(.32, aspect * .2));
  float cosine = cos(twist);
  float sine = sin(twist);
  return vec3(cosine * radial.x - sine * radial.y, point.y, sine * radial.x + cosine * radial.y);
}
float ribbon(vec3 point) {
  float width = min(.95, resolution.x / resolution.y * 1.22) * (1.0 + audio.x * .09 + impact * .06);
  vec3 bounds = abs(ribbonLocal(point)) - vec3(width, 2.08, width * .65);
  return length(max(bounds, 0.0)) + min(max(bounds.x, max(bounds.y, bounds.z)), 0.0) - .14;
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
  float epsilon = .012;
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
  float softbox = pow(max(dot(normal, normalize(light - direction)), 0.0), 18.0);
  float rim = pow(max(dot(normal, normalize(rimLight - direction)), 0.0), 26.0);
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
uniform vec3 pigmentFlow;
uniform vec3 pigmentSpectrum;
uniform vec4 terrainAudio;
uniform vec3 sunDirection;
uniform vec3 moonDirection;
float mountainMass(vec2 position) {
  float coarse = texture2D(terrainMap, position / 190.0).r;
  return pow(coarse, 2.2) * 93.2;
}
float baseElevation(vec2 position) {
  float rolling = texture2D(terrainMap, position / 100.0 + vec2(.31, .67)).r;
  float mass = mountainMass(position);
  float drainage = texture2D(terrainMap, position / 38.0 + vec2(.17, .43)).r;
  float gullies = pow(1.0 - abs(drainage * 2.0 - 1.0), 3.0);
  vec2 along = waveAt(.5 + sin(position.x * .0045 + position.y * .0015) * .5);
  vec2 across = waveAt(.5 + sin(position.y * .004 - position.x * .002) * .5);
  float crest = clamp(.5 + along.x * .3 + across.y * .2, 0.0, 1.0);
  float separation = abs(along.x - across.y) * .5;
  float ridges = mass * (.18 + crest * .82);
  return ridges + rolling * 3.0 - gullies * 4.0 * smoothstep(5.0, 28.0, mass)
    - separation * 9.0;
}
float elevation(vec2 position) {
  return baseElevation(position);
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
vec3 terrainPigment(vec3 point, vec3 normal, vec3 rock, float mineral, float strata, float snow, float distanceAlong, out vec3 radiance) {
  vec3 pigmentBands = max(audio.xyz - .025, 0.0) / .975 * (.55 + pigmentSpectrum * 1.35);
  float activity = smoothstep(.025, .3, audio.w);
  float phase = point.y * .19 + point.x * .025 - point.z * .018
    + mineral * 4.0 + pigmentFlow.y + pigmentSpectrum.y * .6 + impact * .12;
  float current = sin(point.x * .045 + point.z * .02 + pigmentFlow.x);
  float basin = smoothstep(.18, .8, mineral + normal.y * .18 + current * .16);
  float seam = .5 + .5 * sin(phase + pigmentBands.y * .8);
  float seamWidth = max(fwidth(phase), .025);
  float veins = smoothstep(.6 - seamWidth, .94 + seamWidth, seam);
  float finePhase = point.y * .65 + strata * 3.0 + mineral * 2.0 + pigmentFlow.z + pigmentBands.z * .35;
  float fineWidth = max(fwidth(finePhase), .02);
  float filaments = smoothstep(.65 - fineWidth, 1.0 + fineWidth, sin(finePhase));
  filaments *= 1.0 - smoothstep(.5, 1.8, fineWidth);
  filaments *= 1.0 - smoothstep(70.0, 180.0, distanceAlong);
  vec3 weights = pigmentBands * vec3(.3 + basin * .7, veins * .8, filaments * .9);
  float warmShare = smoothstep(.22, .58, weights.y / max(weights.x + weights.y, .001));
  vec3 pigment = mix(vec3(.008, .32, .46), vec3(.62, .025, .095), warmShare);
  float strength = dot(weights, vec3(1.0));
  pigment = mix(pigment, vec3(.62, .48, .19), min(1.0, weights.z / max(strength, .001) * 1.6));
  float luminance = dot(rock, vec3(.2126, .7152, .0722));
  pigment *= luminance / max(dot(pigment, vec3(.2126, .7152, .0722)), .025);
  float surgePhase = length(point.xz) * .14 + point.y * .11 + mineral * .8 - pigmentFlow.x * 2.3;
  float surgeWidth = max(fwidth(surgePhase) * .5, .015);
  float surge = smoothstep(.94 - surgeWidth, .995 + surgeWidth, sin(surgePhase));
  surge *= 1.0 - smoothstep(.4, 1.2, surgeWidth);
  float contourPhase = point.y * .42 + strata * .55 - pigmentFlow.y * 1.6;
  float contourWidth = max(fwidth(contourPhase) * .5, .015);
  float contours = smoothstep(.96 - contourWidth, .995 + contourWidth, sin(contourPhase));
  contours *= 1.0 - smoothstep(.35, 1.1, contourWidth);
  vec3 light = vec3(.015, .65, 1.0) * surge * pigmentBands.x
    + vec3(1.0, .035, .16) * contours * pigmentBands.y
    + vec3(1.0, .72, .22) * filaments * pigmentBands.z;
  radiance = (1.0 - exp(-light * 2.0)) * activity * (.025 + min(impact, 1.2) * .012)
    * (1.0 - snow * .8) * (.5 + normal.y * .5)
    * (1.0 - smoothstep(120.0, 220.0, distanceAlong));
  float coverage = activity * .28 * (1.0 - exp(-strength * 2.2)) * (1.0 - snow * .85);
  return mix(rock, pigment, coverage);
}
vec3 sunlightColor() {
  return mix(vec3(1.1, 1.03, .92), vec3(1.0, .39, .14), 1.0 - smoothstep(0.0, .45, sunDirection.y));
}
vec3 sky(vec3 direction, bool celestial) {
  float altitude = .5 * (direction.y + sqrt(direction.y * direction.y + .0016));
  float daylight = smoothstep(-.12, .15, sunDirection.y);
  vec3 horizon = mix(vec3(.012, .019, .035), vec3(.16, .26, .36), daylight);
  vec3 zenith = mix(vec3(.001, .004, .012), vec3(.012, .055, .14), daylight);
  vec3 color = mix(horizon, zenith, 1.0 - exp(-altitude * 3.0));
  float towardSun = max(dot(direction.xz, sunDirection.xz)
    / max(length(direction.xz) * length(sunDirection.xz), .001), 0.0);
  float twilight = exp(-pow((sunDirection.y + .025) / .12, 2.0));
  color += vec3(.48, .13, .035) * twilight * exp(-altitude * 8.0) * pow(towardSun, 4.0);
  if (!celestial) return color;
  float footprint = 1.2 / resolution.y;
  float sunDistance = length(direction - sunDirection);
  float sunDisc = 1.0 - smoothstep(.00465 - footprint, .00465 + footprint, sunDistance);
  float sunVisible = smoothstep(-.012, .008, sunDirection.y);
  color += sunlightColor() * sunVisible * (sunDisc * 4.0 + exp(-sunDistance * sunDistance * 160.0) * .24);
  float moonDistance = length(direction - moonDirection);
  float moonDisc = 1.0 - smoothstep(.0045 - footprint, .0045 + footprint, moonDistance);
  if (moonDisc > 0.0 && moonDirection.y > -.01) {
    vec3 tangent = (direction - moonDirection * dot(direction, moonDirection)) / .0045;
    vec3 moonNormal = normalize(tangent - moonDirection * sqrt(max(0.0, 1.0 - dot(tangent, tangent))));
    float lit = max(dot(moonNormal, sunDirection), 0.0);
    float maria = texture2D(terrainMap, moonNormal.xz * .8 + .5).r;
    vec3 moon = vec3(.48, .51, .55) * (.025 + lit * .85) * (.65 + maria * .35);
    color = mix(color, color * daylight * .65 + moon, moonDisc);
  }
  vec2 starPosition = vec2(atan(direction.z, direction.x) / (2.0 * PI) + .5, asin(clamp(direction.y, -1.0, 1.0)) / PI + .5) * vec2(360.0, 180.0);
  vec2 cell = floor(starPosition);
  float random = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  vec2 starOffset = .2 + .6 * fract(sin(vec2(dot(cell, vec2(269.5, 183.3)), dot(cell, vec2(113.5, 271.9)))) * 43758.5453);
  float star = (1.0 - smoothstep(.025, .11 + min(length(fwidth(starPosition)), .3), length(fract(starPosition) - starOffset))) * step(.982, random);
  vec3 starColor = mix(vec3(.65, .78, 1.0), vec3(1.0, .83, .62), fract(random * 327.0));
  color += starColor * star * (.22 + .95 * (1.0 - daylight)) * smoothstep(-.02, .16, direction.y) * (1.0 - moonDisc);
  return color;
}
float terrainShadow(vec3 point, vec3 normal, vec3 light) {
  if (light.y <= 0.0) return 0.0;
  float distanceAlong = .6;
  float visibility = 1.0;
  for (int shadowStep = 0; shadowStep < 24; shadowStep++) {
    vec3 probe = point + normal * .35 + light * distanceAlong;
    float gap = probe.y - elevation(probe.xz);
    if (gap < .025) return 0.0;
    visibility = min(visibility, 10.0 * gap / distanceAlong);
    distanceAlong += clamp(gap * .5, .6, 10.0);
    if (distanceAlong > 150.0) break;
  }
  return clamp(visibility, 0.0, 1.0);
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
  vec3 color = sky(direction, true);
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
    float daylight = smoothstep(-.12, .15, sunDirection.y);
    float solarStrength = smoothstep(-.012, .10, sunDirection.y);
    float lunarPhase = .5 - .5 * dot(sunDirection, moonDirection);
    float lunarStrength = (1.0 - daylight) * smoothstep(0.0, .15, moonDirection.y) * lunarPhase * .08;
    vec3 dominantLight = sunDirection.y > 0.0 ? sunDirection : moonDirection;
    float shade = terrainShadow(point, normal, dominantLight);
    float mineral = texture2D(terrainMap, point.xz / 32.0).r;
    float strata = texture2D(terrainMap, vec2(point.x * .045 + point.z * .02, point.y * .14)).r;
    vec3 rock = mix(vec3(.075, .065, .052), vec3(.26, .235, .19), mineral);
    rock *= .72 + strata * .55;
    float meadow = (1.0 - smoothstep(14.0, 30.0, point.y)) * smoothstep(.55, .9, normal.y);
    rock = mix(rock, mix(vec3(.035, .065, .022), vec3(.11, .15, .045), mineral), meadow * .85);
    float snow = smoothstep(38.0, 55.0, point.y + (mineral - .5) * 9.0)
      * smoothstep(.65, .93, normal.y);
    rock = mix(rock, vec3(.57, .64, .69), snow);
    vec3 radiance;
    rock = terrainPigment(point, normal, rock, mineral, strata, snow, distanceAlong, radiance);
    float diffuse = max(dot(normal, sunDirection), 0.0);
    float moonDiffuse = max(dot(normal, moonDirection), 0.0);
    float skyExposure = .35 + .65 * normal.y;
    vec3 ambient = mix(vec3(.018, .027, .045), vec3(.12, .18, .25), daylight);
    vec3 direct = sunlightColor() * diffuse * solarStrength + vec3(.52, .65, .88) * moonDiffuse * lunarStrength;
    color = rock * (ambient * skyExposure + direct * (.08 + shade * .92));
    color += radiance * (.4 + shade * .6);
    color += vec3(.012, .026, .025) * pow(diffuse, 4.0) * solarStrength * (audio.z + impact * .2);
    float visibility = exp(-distanceAlong * .0018) * (1.0 - smoothstep(200.0, flightRange, distanceAlong));
    color = mix(sky(direction, false), color, visibility);
  }
  float visibleDistance = hit ? distanceAlong : flightRange;
  vec2 beaconLocation = vec2(0.0);
  vec3 lamp = vec3(beaconLocation.x, elevation(beaconLocation) + 22.0, beaconLocation.y);
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
      float halo = exp(-radius * radius / 1.4) * (.3 + beaconPulse);
      float shaft = exp(-dot(separation.xz, separation.xz) / (.025 + footprint * footprint))
        * exp(-abs(separation.y) / 2.8) * beaconPulse;
      float visibility = 1.0 - smoothstep(110.0, flightRange, along);
      color += visibility * (vec3(1.0, .48, .12) * (core * (1.4 + beaconPulse * 2.0) + halo * .85)
        + vec3(1.0, .65, .28) * shaft * .8);
    }
  }
  vec3 beamDirection = normalize(vec3(sin(flightClock * .65), -.025, cos(flightClock * .65)));
  float beam = 0.0;
  float beamStep = min(visibleDistance, 180.0) / 64.0;
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int beamIndex = 0; beamIndex < 64; beamIndex++) {
    vec3 point = origin + direction * (float(beamIndex) + jitter) * beamStep;
    vec3 fromLamp = point - lamp;
    float along = dot(fromLamp, beamDirection);
    if (along <= 0.0 || along >= 160.0) continue;
    float radius = length(fromLamp - beamDirection * along);
    float cone = 1.0 - smoothstep(along * .032 + .18, along * .045 + .3, radius);
    if (cone <= 0.0) continue;
    float clear = 1.0;
    for (int shadowIndex = 1; shadowIndex <= 16; shadowIndex++) {
      vec3 probe = mix(lamp, point, float(shadowIndex) / 16.0);
      if (probe.y < elevation(probe.xz)) { clear = 0.0; break; }
    }
    beam += cone * clear * exp(-along * .008) * beamStep;
  }
  color += vec3(1.0, .68, .3) * (1.0 - exp(-beam * .24)) * (.65 + beaconPulse);
  gl_FragColor = vec4(finish(color) + (jitter - .5) / 255.0, 1.0);
}`;

const plasmaShader = common + waveformShader + `
void main() {
  vec3 bands = clamp(audio.xyz, 0.0, 1.0);
  float phase = clock * .16 + seed * PI * 2.0;
  vec2 point = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y);
  point += vec2(sin(phase * .37), cos(phase * .31)) * .18;
  vec2 positions = .5 + .45 * point / sqrt(vec2(1.0) + point * point);
  vec2 wave = vec2(waveAt(positions.x).x, waveAt(positions.y).y);
  float radius = sqrt(dot(point, point) + .16);
  float twist = sin(radius * 1.4 - phase * .5) * (.45 + bands.y * .3)
    + wave.x * .24 + wave.y * .18 + clamp(impact, 0.0, 1.2) * .12;
  point = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * point;
  vec2 radial = point / radius;
  vec2 harmonic = vec2(radial.x * radial.x - radial.y * radial.y, 2.0 * radial.x * radial.y);
  harmonic = vec2(harmonic.x * radial.x - harmonic.y * radial.y,
    harmonic.x * radial.y + harmonic.y * radial.x);
  float field = .5 + .22 * sin(radius * (3.8 + bands.x * .55) - phase + harmonic.x * 1.5)
    + .18 * sin(point.x * 1.6 + point.y * 1.3 + phase * .7 + wave.y * .6)
    + (.06 + bands.z * .04) * cos(radius * 6.1 + harmonic.y * 1.4 + phase * .5);
  float edgeWidth = max(fwidth(field), .0008);
  vec3 ink = vec3(.008, .009, .012);
  vec3 color = mix(ink, vec3(.015, .48, .65), smoothstep(.24 - edgeWidth, .24 + edgeWidth, field));
  color = mix(color, ink, smoothstep(.38 - edgeWidth, .38 + edgeWidth, field));
  color = mix(color, vec3(.48, .018, .38), smoothstep(.50 - edgeWidth, .50 + edgeWidth, field));
  color = mix(color, ink, smoothstep(.64 - edgeWidth, .64 + edgeWidth, field));
  color = mix(color, vec3(.65, .72, .78), smoothstep(.76 - edgeWidth, .76 + edgeWidth, field));
  color = mix(color, ink, smoothstep(.83 - edgeWidth, .83 + edgeWidth, field));
  color *= .72 + clamp(audio.w, 0.0, 1.0) * .12 + .1 * cos(radius * 1.8 + phase * .3);
  gl_FragColor = vec4(finish(color), 1.0);
}`;

const foundryShader = common + waveformShader + `
uniform vec4 foundryBodies[6];
uniform vec4 composition;
float foundryDistance(vec3 point) {
  float distanceToBody = length(point - foundryBodies[0].xyz) - foundryBodies[0].w;
  float softness = .32 + composition.z * .22;
  for (int body = 1; body < 6; body++) {
    float nextDistance = length(point - foundryBodies[body].xyz) - foundryBodies[body].w;
    float blend = clamp(.5 + .5 * (nextDistance - distanceToBody) / softness, 0.0, 1.0);
    distanceToBody = mix(nextDistance, distanceToBody, blend) - softness * blend * (1.0 - blend);
  }
  return distanceToBody;
}
vec3 studio(vec3 direction) {
  vec3 shade = mix(vec3(.02), vec3(.18), smoothstep(-.5, .8, direction.y));
  float key = exp(-pow(abs(direction.x + .38) / .28, 4.0) - pow(abs(direction.y - .42) / .62, 4.0));
  vec2 wave = waveAt(direction.x * .46 + .5);
  vec2 gap = direction.y - vec2(.24, -.24) - wave * .3;
  vec2 width = max(vec2(.012), min(vec2(.045), fwidth(gap) * 1.2));
  vec2 ribbon = exp(-pow(gap / width, vec2(2.0)))
    + .18 * exp(-pow(gap / .065, vec2(2.0)));
  float ends = 1.0 - smoothstep(.8, .97, abs(direction.x));
  return shade + key * vec3(.95) + ends * (ribbon.x * vec3(.85, .92, 1.0)
    + ribbon.y * vec3(1.0, .94, .87)) * (.65 + min(audio.w, 1.0) * .35);
}
void main() {
  vec2 screen = (gl_FragCoord.xy * 2.0 - resolution) / resolution.y;
  float aspect = resolution.x / resolution.y;
  float distanceToCamera = (4.7 + composition.w * .7) * max(1.0, .85 / aspect);
  float angle = clock * .065 + seed * PI * 2.0;
  vec3 origin = vec3(sin(angle) * distanceToCamera, .45, cos(angle) * distanceToCamera);
  vec3 forward = normalize(-origin);
  vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, forward);
  vec3 direction = normalize(forward * 2.0 + right * screen.x + up * screen.y);
  vec3 color = mix(vec3(.003, .006, .008), vec3(.028, .037, .038), exp(-dot(screen, screen) * .35));
  float projection = dot(origin, direction);
  float discriminant = projection * projection - dot(origin, origin) + 9.0;
  if (discriminant > 0.0) {
    float distanceAlong = max(0.0, -projection - sqrt(discriminant));
    float farDistance = -projection + sqrt(discriminant);
    bool hit = false;
    vec3 point = origin;
    for (int stepIndex = 0; stepIndex < 256; stepIndex++) {
      if (stepIndex >= int(mix(192.0, 256.0, detail)) || distanceAlong > farDistance) break;
      point = origin + direction * distanceAlong;
      float gap = foundryDistance(point);
      if (gap < max(.001, distanceAlong / resolution.y * .65)) { hit = true; break; }
      distanceAlong += max(.001, gap * .95);
    }
    if (hit) {
      float epsilon = max(.0015, distanceAlong / resolution.y * .35);
      vec2 offset = vec2(1.0, -1.0) * .5773 * epsilon;
      vec3 normal = normalize(offset.xyy * foundryDistance(point + offset.xyy)
        + offset.yyx * foundryDistance(point + offset.yyx)
        + offset.yxy * foundryDistance(point + offset.yxy)
        + offset.xxx * foundryDistance(point + offset.xxx));
      vec3 reflection = reflect(direction, normal);
      float facing = max(dot(normal, -direction), 0.0);
      float fresnel = .55 + .45 * pow(1.0 - facing, 5.0);
      float diffuse = max(dot(normal, normalize(vec3(-.6, .8, .5))), 0.0);
      color = studio(reflection) * fresnel + vec3(.075, .085, .09) * diffuse;
      color *= .45 + composition.x * .55;
    }
  }
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
    this.mountainTexture = heightTexture(5);
    this.flightTexture = createFlightHeightTexture(this.mountainTexture);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.waveform = new Float32Array(WAVEFORM_POINTS * 2);
    this.waveformTexture = new THREE.DataTexture(this.waveform, WAVEFORM_POINTS, 1, THREE.RGFormat, THREE.FloatType);
    this.waveformTexture.needsUpdate = true;
    this.uniforms = {
      resolution: { value: new THREE.Vector2() }, clock: { value: 0 }, seed: { value: 0 },
      audio: { value: new THREE.Vector4() }, impact: { value: 0 }, detail: { value: 1 },
      terrainMap: { value: this.texture }, flightMap: { value: this.flightTexture },
      waveformMap: { value: this.waveformTexture }, beaconPulse: { value: 0 }, flightClock: { value: 0 },
      cameraAudio: { value: new THREE.Vector4() },
      composition: { value: new THREE.Vector4(1, 1, 0, 0) },
      foundryBodies: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
      pigmentFlow: { value: new THREE.Vector3() }, pigmentSpectrum: { value: new THREE.Vector3() },
      terrainAudio: { value: new THREE.Vector4() },
      sunDirection: { value: new THREE.Vector3() }, moonDirection: { value: new THREE.Vector3() }
    };
    this.materials = [tunnelShader, terrainShader, rasterShader, foundryShader, plasmaShader].map(fragmentShader => new THREE.ShaderMaterial({
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
    const source = this.waveformSource ??= new Float32Array(WAVEFORM_POINTS * 2);
    for (let side = 0; side < 2; side++) {
      const samples = channels[side] ?? channels[0];
      for (let point = 0; point < WAVEFORM_POINTS; point++) {
        let value = 0;
        if (samples?.length) {
          const offset = point / (WAVEFORM_POINTS - 1) * (samples.length - 1);
          const index = Math.floor(offset);
          const start = Number.isFinite(samples[index]) ? samples[index] : 0;
          const end = Number.isFinite(samples[Math.min(index + 1, samples.length - 1)])
            ? samples[Math.min(index + 1, samples.length - 1)] : 0;
          value = THREE.MathUtils.lerp(start, end, offset - index);
        }
        source[point * 2 + side] = THREE.MathUtils.clamp(value, -1, 1);
      }
    }
    for (let point = 0; point < WAVEFORM_POINTS; point++) {
      for (let side = 0; side < 2; side++) {
        let value = 0;
        for (let tap = 0; tap < waveformKernel.length; tap++) {
          const index = Math.max(0, Math.min(WAVEFORM_POINTS - 1, point + tap - WAVEFORM_RADIUS));
          value += source[index * 2 + side] * waveformKernel[tap];
        }
        value /= waveformWeight;
        this.waveform[point * 2 + side] = THREE.MathUtils.clamp(value * 4 / (1 + Math.abs(value) * 3), -1, 1);
      }
    }
    this.waveformTexture.needsUpdate = true;
  }

  updateFoundry(state, seed, arc) {
    const reveal = arc?.reveal ?? 1;
    const development = arc?.development ?? 1;
    const climax = arc?.climax ?? 0;
    const release = arc?.release ?? 0;
    this.uniforms.composition.value.set(reveal, development, climax, release);
    const bodies = this.uniforms.foundryBodies.value;
    const low = THREE.MathUtils.clamp(state.signal.low, 0, 1);
    const beat = THREE.MathUtils.clamp(state.impact ?? 0, 0, 1.2);
    bodies[0].set(0, 0, 0, .7 + low * .18 + beat * .06 + climax * .35);
    for (let body = 1; body < 6; body++) {
      const phase = body / 5 * Math.PI * 2 + state.time * .19 + seed * Math.PI * 2;
      const spread = (1.05 + development * .3 + release * .35) * (1 - climax * .84);
      const energy = THREE.MathUtils.clamp([state.signal.low, state.signal.mid, state.signal.high][body % 3], 0, 1);
      bodies[body].set(Math.cos(phase) * spread,
        Math.sin(phase * 1.6 + state.time * .13) * spread * .65,
        Math.sin(phase) * spread * .65,
        (.35 + energy * .14 + beat * .045) * (.15 + reveal * .85) * (1 - release * .35));
    }
  }

  draw(context, name, width, height, state, seed, quality, beaconPulse = 0, flightTime = state.time, arc) {
    if (this.renderer.getContext().isContextLost()) return false;
    const canvas = this.renderer.domElement;
    if (canvas.width !== width || canvas.height !== height) this.renderer.setSize(width, height, false);
    const { signal, time, impact = 0 } = state;
    this.uniforms.resolution.value.set(width, height);
    this.uniforms.clock.value = time;
    this.uniforms.flightClock.value = flightTime;
    const sky = flightSkyDirections(flightTime, seed, this.skyDirections ??= new Float64Array(6));
    this.uniforms.sunDirection.value.set(sky[0], sky[1], sky[2]);
    this.uniforms.moonDirection.value.set(sky[3], sky[4], sky[5]);
    const cameraAudio = state.flight?.values;
    this.uniforms.cameraAudio.value.set(cameraAudio?.[0] ?? 0, cameraAudio?.[1] ?? 0,
      cameraAudio?.[2] ?? 0, cameraAudio?.[3] ?? 0);
    const pigmentFlow = state.pigmentFlow;
    this.uniforms.pigmentFlow.value.set(pigmentFlow?.[0] ?? 0, pigmentFlow?.[1] ?? 0, pigmentFlow?.[2] ?? 0);
    const spectrum = state.bands;
    this.uniforms.pigmentSpectrum.value.set(spectrum ? spectrum[0] + spectrum[1] : signal.low,
      spectrum ? spectrum[2] + spectrum[3] : signal.mid, spectrum ? spectrum[4] + spectrum[5] : signal.high);
    const terrainAudio = state.terrain?.values;
    this.uniforms.terrainAudio.value.set(THREE.MathUtils.clamp(terrainAudio?.[0] ?? signal.low, 0, 1),
      THREE.MathUtils.clamp(terrainAudio?.[1] ?? signal.mid, 0, 1),
      THREE.MathUtils.clamp(terrainAudio?.[2] ?? signal.high, 0, 1),
      THREE.MathUtils.clamp(terrainAudio?.[3] ?? impact, 0, 1.2));
    this.uniforms.seed.value = seed;
    this.uniforms.audio.value.set(signal.low, signal.mid, signal.high, signal.level);
    this.uniforms.impact.value = impact;
    this.uniforms.detail.value = quality;
    if (name === "metaball-foundry") this.updateFoundry(state, seed, arc);
    this.uniforms.terrainMap.value = name === "voxel-flight" ? this.mountainTexture : this.texture;
    this.uniforms.beaconPulse.value = Number.isFinite(beaconPulse) ? THREE.MathUtils.clamp(beaconPulse, 0, 1) : 0;
    if (name === "raster-twist" || name === "voxel-flight" || name === "metaball-foundry" || name === "polar-plasma") this.updateWaveform(state.shaderWaveform?.channels ?? state.traceChannels ?? state.channels);
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
    this.waveformTexture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}