import * as THREE from "./vendor/three/three.module.min.js";
import { drawGeneralScene } from "./general-scenes.js?v=44";

const STRIDE = 9;
const PAINTS = 32;
const PAINT_WIDTH = 6;

function color(value, opacity, premultiply = true) {
  const components = value.match(/[-+]?(?:\d*\.)?\d+/g).map(Number);
  const shade = new THREE.Color().setHSL(components[0] / 360, components[1] / 100, components[2] / 100);
  const alpha = (components[3] ?? 1) * opacity;
  const factor = premultiply ? alpha : 1;
  return [shade.r * factor, shade.g * factor, shade.b * factor, alpha];
}

export class CurveSceneGeometry {
  constructor() {
    this.vertices = new Float32Array(65536 * STRIDE);
    this.indices = new Uint32Array(262144);
    this.paints = new Float32Array(PAINTS * PAINT_WIDTH * 4);
    this.path = [];
    this.pool = [];
    this.normals = new Float64Array(4096);
    this.quadratic = new THREE.QuadraticBezierCurve();
    this.cubic = new THREE.CubicBezierCurve();
    this.sample = new THREE.Vector2();
    this.stack = [];
  }

  begin(transform, alpha = 1) {
    this.vertexCount = 0;
    this.indexCount = 0;
    this.paintCount = 0;
    this.transform = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
    this.globalAlpha = alpha;
    this.lineWidth = 1;
    this.stack.length = 0;
  }

  save() {
    this.stack.push([this.transform.slice(), this.globalAlpha, this.lineWidth, this.fillStyle, this.strokeStyle]);
  }

  restore() {
    [this.transform, this.globalAlpha, this.lineWidth, this.fillStyle, this.strokeStyle] = this.stack.pop();
  }

  translate(horizontal, vertical) {
    const matrix = this.transform;
    matrix[4] += matrix[0] * horizontal + matrix[2] * vertical;
    matrix[5] += matrix[1] * horizontal + matrix[3] * vertical;
  }

  rotate(angle) {
    const matrix = this.transform;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const first = matrix[0];
    const second = matrix[1];
    matrix[0] = first * cosine + matrix[2] * sine;
    matrix[1] = second * cosine + matrix[3] * sine;
    matrix[2] = matrix[2] * cosine - first * sine;
    matrix[3] = matrix[3] * cosine - second * sine;
  }

  point(horizontal, vertical, target = this.sample) {
    const matrix = this.transform;
    return target.set(matrix[0] * horizontal + matrix[2] * vertical + matrix[4],
      matrix[1] * horizontal + matrix[3] * vertical + matrix[5]);
  }

  append(point) {
    const index = this.path.length;
    const stored = this.pool[index] ??= new THREE.Vector2();
    stored.copy(point);
    this.path.push(stored);
  }

  beginPath() {
    this.path.length = 0;
    this.closed = false;
  }

  moveTo(horizontal, vertical) {
    this.append(this.point(horizontal, vertical));
  }

  lineTo(horizontal, vertical) {
    this.append(this.point(horizontal, vertical));
  }

  quadraticCurveTo(controlX, controlY, endX, endY) {
    const curve = this.quadratic;
    curve.v0.copy(this.path.at(-1));
    this.point(controlX, controlY, curve.v1);
    this.point(endX, endY, curve.v2);
    const curvature = Math.hypot(curve.v0.x - 2 * curve.v1.x + curve.v2.x, curve.v0.y - 2 * curve.v1.y + curve.v2.y);
    const divisions = Math.max(1, Math.ceil(Math.sqrt(curvature / 2)));
    for (let step = 1; step <= divisions; step++) this.append(curve.getPoint(step / divisions, this.sample));
  }

  bezierCurveTo(firstX, firstY, secondX, secondY, endX, endY) {
    const curve = this.cubic;
    curve.v0.copy(this.path.at(-1));
    this.point(firstX, firstY, curve.v1);
    this.point(secondX, secondY, curve.v2);
    this.point(endX, endY, curve.v3);
    const curvature = Math.max(
      Math.hypot(curve.v0.x - 2 * curve.v1.x + curve.v2.x, curve.v0.y - 2 * curve.v1.y + curve.v2.y),
      Math.hypot(curve.v1.x - 2 * curve.v2.x + curve.v3.x, curve.v1.y - 2 * curve.v2.y + curve.v3.y));
    const divisions = Math.max(1, Math.ceil(Math.sqrt(curvature * 1.5)));
    for (let step = 1; step <= divisions; step++) this.append(curve.getPoint(step / divisions, this.sample));
  }

  closePath() {
    this.closed = true;
    const first = this.path[0];
    const last = this.path.at(-1);
    if (this.path.length > 1 && first.distanceToSquared(last) < 1e-12) this.path.pop();
  }

  createLinearGradient(startX, startY, endX, endY) {
    const start = this.point(startX, startY, new THREE.Vector2());
    const end = this.point(endX, endY, new THREE.Vector2());
    const horizontal = end.x - start.x;
    const vertical = end.y - start.y;
    const length = Math.max(1e-12, horizontal * horizontal + vertical * vertical);
    return {
      axis: [horizontal / length, vertical / length, -(start.x * horizontal + start.y * vertical) / length],
      stops: [],
      addColorStop(offset, value) { this.stops.push([offset, value]); }
    };
  }

  paint(style) {
    if (typeof style === "string") return { shade: color(style, this.globalAlpha), index: -1, axis: [0, 0, 0] };
    if (![2, 5].includes(style.stops.length) || this.paintCount >= PAINTS) throw new Error("Unsupported curve gradient");
    const index = this.paintCount++;
    const offset = index * PAINT_WIDTH * 4;
    if (style.stops.length === 2) {
      const first = color(style.stops[0][1], this.globalAlpha, false);
      const last = color(style.stops[1][1], this.globalAlpha, false);
      for (let stop = 0; stop < 5; stop++) {
        const position = stop / 4;
        for (let component = 0; component < 4; component++) {
          this.paints[offset + stop * 4 + component] = first[component] + (last[component] - first[component]) * position;
        }
        if (stop > 0) this.paints[offset + 20 + stop - 1] = position;
      }
      return { shade: [1, 0, 0, 0], index, axis: style.axis };
    }
    style.stops.forEach(([position, value], stop) => {
      this.paints.set(color(value, this.globalAlpha), offset + stop * 4);
      if (stop > 0) this.paints[offset + 20 + stop - 1] = position;
    });
    return { shade: [0, 0, 0, 0], index, axis: style.axis };
  }

  vertex(horizontal, vertical, paint, coverage = 1) {
    if ((this.vertexCount + 1) * STRIDE > this.vertices.length) {
      const expanded = new Float32Array(this.vertices.length * 2);
      expanded.set(this.vertices);
      this.vertices = expanded;
    }
    const offset = this.vertexCount++ * STRIDE;
    const values = this.vertices;
    values[offset] = horizontal;
    values[offset + 1] = vertical;
    values[offset + 2] = paint.shade[0];
    values[offset + 3] = paint.shade[1];
    values[offset + 4] = paint.shade[2];
    values[offset + 5] = paint.shade[3];
    values[offset + 6] = horizontal * paint.axis[0] + vertical * paint.axis[1] + paint.axis[2];
    values[offset + 7] = paint.index;
    values[offset + 8] = coverage;
    return this.vertexCount - 1;
  }

  triangle(first, second, third) {
    if (this.indexCount + 3 > this.indices.length) {
      const expanded = new Uint32Array(this.indices.length * 2);
      expanded.set(this.indices);
      this.indices = expanded;
    }
    this.indices[this.indexCount++] = first;
    this.indices[this.indexCount++] = second;
    this.indices[this.indexCount++] = third;
  }

  offsets(closed) {
    const points = this.path;
    if (this.normals.length < points.length * 2) this.normals = new Float64Array(points.length * 4);
    for (let index = 0; index < points.length; index++) {
      const previous = points[closed ? (index + points.length - 1) % points.length : Math.max(0, index - 1)];
      const current = points[index];
      const next = points[closed ? (index + 1) % points.length : Math.min(points.length - 1, index + 1)];
      let beforeX = current.x - previous.x;
      let beforeY = current.y - previous.y;
      let afterX = next.x - current.x;
      let afterY = next.y - current.y;
      const beforeLength = Math.hypot(beforeX, beforeY);
      const afterLength = Math.hypot(afterX, afterY);
      if (!beforeLength) { beforeX = afterX; beforeY = afterY; }
      if (!afterLength) { afterX = beforeX; afterY = beforeY; }
      const beforeScale = Math.max(1e-12, Math.hypot(beforeX, beforeY));
      const afterScale = Math.max(1e-12, Math.hypot(afterX, afterY));
      const normalX = -beforeY / beforeScale - afterY / afterScale;
      const normalY = beforeX / beforeScale + afterX / afterScale;
      const normalScale = Math.max(1e-12, Math.hypot(normalX, normalY));
      const projection = Math.max(.5, (normalX * -afterY + normalY * afterX) / (normalScale * afterScale));
      this.normals[index * 2] = normalX / normalScale / projection;
      this.normals[index * 2 + 1] = normalY / normalScale / projection;
    }
  }

  edgeVertex(index, radius, paint, coverage) {
    const point = this.path[index];
    return this.vertex(point.x + this.normals[index * 2] * radius,
      point.y + this.normals[index * 2 + 1] * radius, paint, coverage);
  }

  fill() {
    if (this.path.length < 3) return;
    const paint = this.paint(this.fillStyle);
    const triangles = THREE.ShapeUtils.triangulateShape(this.path, []);
    const start = this.vertexCount;
    for (const point of this.path) this.vertex(point.x, point.y, paint);
    for (const triangle of triangles) {
      this.triangle(start + triangle[0], start + triangle[1], start + triangle[2]);
    }
    this.offsets(true);
    const outward = THREE.ShapeUtils.isClockWise(this.path) ? 1 : -1;
    const fringe = this.vertexCount;
    for (let index = 0; index < this.path.length; index++) this.edgeVertex(index, outward, paint, 0);
    for (let index = 0; index < this.path.length; index++) {
      const next = (index + 1) % this.path.length;
      this.triangle(start + index, start + next, fringe + next);
      this.triangle(start + index, fringe + next, fringe + index);
    }
  }

  stroke() {
    if (this.path.length < 2) return;
    const paint = this.paint(this.strokeStyle);
    const radius = this.lineWidth * Math.hypot(this.transform[0], this.transform[1]) * .5;
    const core = Math.max(0, radius - .5);
    const fringe = radius + .5;
    this.offsets(this.closed);
    const start = this.vertexCount;
    for (let index = 0; index < this.path.length; index++) {
      this.edgeVertex(index, -fringe, paint, 0);
      this.edgeVertex(index, -core, paint, 1);
      this.edgeVertex(index, core, paint, 1);
      this.edgeVertex(index, fringe, paint, 0);
    }
    const count = this.closed ? this.path.length : this.path.length - 1;
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % this.path.length;
      for (let ring = 0; ring < 3; ring++) {
        const first = start + index * 4 + ring;
        const second = start + next * 4 + ring;
        this.triangle(first, second, second + 1);
        this.triangle(first, second + 1, first + 1);
      }
    }
    if (!this.closed) {
      for (const index of [0, this.path.length - 1]) {
        const point = this.path[index];
        const angle = Math.atan2(this.normals[index * 2 + 1], this.normals[index * 2]) + (index ? Math.PI : 0);
        const steps = Math.max(8, Math.ceil(Math.sqrt(radius) * 3));
        const center = this.vertex(point.x, point.y, paint);
        const boundary = this.vertexCount;
        for (let step = 0; step <= steps; step++) {
          const direction = angle + step / steps * Math.PI;
          const cosine = Math.cos(direction);
          const sine = Math.sin(direction);
          this.vertex(point.x + cosine * core, point.y + sine * core, paint);
          this.vertex(point.x + cosine * fringe, point.y + sine * fringe, paint, 0);
          if (step < steps) {
            const first = boundary + step * 2;
            this.triangle(center, first, first + 2);
            this.triangle(first, first + 1, first + 3);
            this.triangle(first, first + 3, first + 2);
          }
        }
      }
    }
  }
}

export class CurveScenes {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, depth: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    this.paths = new CurveSceneGeometry();
    this.texture = new THREE.DataTexture(this.paths.paints, PAINT_WIDTH, PAINTS, THREE.RGBAFormat, THREE.FloatType);
    this.texture.needsUpdate = true;
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { resolution: { value: new THREE.Vector2() }, paints: { value: this.texture } },
      vertexShader: `
        uniform vec2 resolution;
        attribute vec4 shade;
        attribute vec2 paint;
        attribute float coverage;
        varying vec4 pixelShade;
        varying vec2 pixelPaint;
        varying float pixelCoverage;
        void main() {
          pixelShade = shade; pixelPaint = paint; pixelCoverage = coverage;
          gl_Position = vec4(position.x / resolution.x * 2.0 - 1.0, 1.0 - position.y / resolution.y * 2.0, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D paints;
        varying vec4 pixelShade;
        varying vec2 pixelPaint;
        varying float pixelCoverage;
        vec4 stopColor(float column, float row) { return texture2D(paints, vec2((column + .5) / 6.0, row)); }
        void main() {
          vec4 shade = pixelShade;
          if (pixelPaint.y >= 0.0) {
            float row = (pixelPaint.y + .5) / 32.0;
            vec4 stops = stopColor(5.0, row);
            float position = clamp(pixelPaint.x, 0.0, 1.0);
            if (position < stops.x) shade = mix(stopColor(0.0, row), stopColor(1.0, row), position / stops.x);
            else if (position < stops.y) shade = mix(stopColor(1.0, row), stopColor(2.0, row), (position - stops.x) / (stops.y - stops.x));
            else if (position < stops.z) shade = mix(stopColor(2.0, row), stopColor(3.0, row), (position - stops.y) / (stops.z - stops.y));
            else shade = mix(stopColor(3.0, row), stopColor(4.0, row), (position - stops.z) / (stops.w - stops.z));
            if (pixelShade.r > .5) shade.rgb *= shade.a;
          }
          gl_FragColor = shade * clamp(pixelCoverage, 0.0, 1.0);
        }`
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.Camera();
    this.bindVertices();
    this.renderer.compile(this.scene, this.camera);
  }

  bindVertices() {
    this.buffer = new THREE.InterleavedBuffer(this.paths.vertices, STRIDE).setUsage(THREE.DynamicDrawUsage);
    this.indexBuffer = new THREE.BufferAttribute(this.paths.indices, 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setIndex(this.indexBuffer);
    this.geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(this.buffer, 2, 0));
    this.geometry.setAttribute("shade", new THREE.InterleavedBufferAttribute(this.buffer, 4, 2));
    this.geometry.setAttribute("paint", new THREE.InterleavedBufferAttribute(this.buffer, 2, 6));
    this.geometry.setAttribute("coverage", new THREE.InterleavedBufferAttribute(this.buffer, 1, 8));
  }

  draw(view, context, name, width, height, centerX, centerY, seed) {
    if (this.renderer.getContext().isContextLost()) return false;
    const additive = ["wavegarden", "helix", "terrain", "feedback-bloom"].includes(name);
    this.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    const canvas = this.renderer.domElement;
    if (canvas.width !== width || canvas.height !== height) this.renderer.setSize(width, height, false);
    this.paths.begin(context.getTransform(), context.globalAlpha);
    drawGeneralScene(view, this.paths, name, width, height, centerX, centerY, seed);
    if (this.buffer.array !== this.paths.vertices || this.indexBuffer.array !== this.paths.indices) {
      this.geometry.dispose();
      this.bindVertices();
    }
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, this.paths.vertexCount * STRIDE);
    this.buffer.needsUpdate = true;
    this.indexBuffer.clearUpdateRanges();
    this.indexBuffer.addUpdateRange(0, this.paths.indexCount);
    this.indexBuffer.needsUpdate = true;
    this.texture.needsUpdate = this.paths.paintCount > 0;
    this.geometry.setDrawRange(0, this.paths.indexCount);
    this.material.uniforms.resolution.value.set(width, height);
    this.renderer.render(this.scene, this.camera);
    context.save();
    context.resetTransform();
    context.globalAlpha = 1;
    if (additive) context.globalCompositeOperation = "lighter";
    context.drawImage(canvas, 0, 0);
    context.restore();
    return true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}