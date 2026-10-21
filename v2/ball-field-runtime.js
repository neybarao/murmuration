// Ball Field runtime (v2).
// A square grid of balls placed in 3D, bent by scatter, displace, twist and rotation, all looping
// seamlessly. Every position is a closed-form function of (ball index, loop progress), so the whole
// animation runs in the vertex shader: the CPU only updates a handful of uniforms per frame and
// issues one instanced draw. There are no per-ball buffers; ball positions come from gl_InstanceID.
//
// Self-containment rule (same as v1): Download JS serializes BALL_FIELD_DEFAULTS and
// createBallFieldRuntime with Function.prototype.toString(), so this function may reference only
// itself, BALL_FIELD_DEFAULTS and browser globals.

const BALL_FIELD_DEFAULTS = Object.freeze({
  zoom: 50,              // 0..100, 50 = fit, wheel/pinch moves it; high values put the camera inside the field
  tilt: 55,              // degrees the sheet leans away from the viewer
  playing: true,
  loopLength: 30,        // seconds
  gridSpacing: 2,        // world units between balls (field is 520 units wide)
  ballSize: 90,          // diameter, % of grid spacing
  scatter: 9,            // world units
  scatterMotion: 360,    // degrees each ball orbits its scatter point
  scatterCycles: 1,
  displace: 0,           // world units out of the sheet, scaled by the displace property
  displaceProperty: 'centerX',
  displaceSwing: 75,     // world units of travelling wave
  displaceCycles: 1,
  twistAngle: 6,         // degrees around the vertical axis, scaled by the twist property
  twistProperty: 'centerX',
  twistSwing: 120,       // degrees of travelling wave
  twistCycles: 1,
  rotationAxis: 'x',
  rotation: 0,           // degrees, static offset
  rotationCycles: 1,     // whole turns per loop
  colors: {
    light: { ball: '#111111', background: '#FFFFFF' },
    dark: { ball: '#EDEDED', background: '#0E1012' }
  }
});

function createBallFieldRuntime(el, options = {}) {
  const PROPERTIES = ['x', 'y', 'centerX', 'centerY', 'radius', 'random', 'diamond', 'rectangle', 'fastTop'];
  const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], xy: [1, 1, 0], xz: [1, 0, 1], yz: [0, 1, 1], xyz: [1, 1, 1] };
  const FIELD = 520, HALF = FIELD / 2, FOV = 40 * Math.PI / 180, TAU = Math.PI * 2;
  const FALLBACK_MAX_BALLS = 9000;
  const {
    renderer = 'webgl2', theme = 'light', maxPixelRatio = 2,
    respectReducedMotion = true, onFrame = null
  } = options;
  const settings = mergeSettings(BALL_FIELD_DEFAULTS, options.settings || {});
  let activeTheme = theme === 'dark' ? 'dark' : 'light';
  let progress = 0, last = 0, raf = 0, destroyed = false, dirty = true;
  let fps = 0, fpsFrames = 0, fpsStart = 0, frameCpu = 0;
  let width = 1, height = 1, ratio = 1;

  function mergeSettings(base, next) {
    const out = { ...base, ...next };
    out.colors = {
      light: { ...base.colors.light, ...(next.colors && next.colors.light) },
      dark: { ...base.colors.dark, ...(next.colors && next.colors.dark) }
    };
    return out;
  }

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', zIndex: '-1' });
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(canvas);

  // ---------- shared math (mirrored in GLSL below) ----------
  function hash(x) {
    x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  const rand = (id, k) => hash((Math.imul(id, 4) + k) >>> 0) / 4294967295;
  function property(index, nx, ny, r) {
    switch (index) {
      case 0: return nx * 0.5 + 0.5;
      case 1: return ny * 0.5 + 0.5;
      case 2: return Math.abs(nx);
      case 3: return Math.abs(ny);
      case 4: return Math.min(Math.hypot(nx, ny) / Math.SQRT2, 1);
      case 5: return r;
      case 6: return (Math.abs(nx) + Math.abs(ny)) * 0.5;
      case 7: return Math.max(Math.abs(nx), Math.abs(ny));
      default: return Math.pow(ny * 0.5 + 0.5, 3);
    }
  }
  function axisRotation(axis, angle) {
    const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const x = axis[0] / len, y = axis[1] / len, z = axis[2] / len;
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return [ // row-major
      t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c
    ];
  }
  function multiply(a, b) {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
    return o;
  }
  // Everything the frame needs, derived once per frame from settings and progress.
  function frameParameters() {
    const s = settings;
    const side = Math.max(1, Math.round(FIELD / Math.max(0.5, s.gridSpacing)));
    const zoomFactor = Math.pow(2, (s.zoom - 50) / 12.5);
    const fitDistance = HALF * 1.3 / Math.tan(FOV / 2);
    const phase = progress * TAU;
    const spin = axisRotation(AXES[s.rotationAxis] || AXES.x, s.rotation * Math.PI / 180 + Math.round(s.rotationCycles) * phase);
    const tilt = axisRotation(AXES.x, -s.tilt * Math.PI / 180);
    const deg = Math.PI / 180;
    return {
      side, count: side * side,
      spacing: FIELD / side,
      camDist: fitDistance / zoomFactor,
      focal: (height * ratio) * 0.5 / Math.tan(FOV / 2),
      phase,
      rot: multiply(tilt, spin),
      ballSize: Math.max(0.01, s.ballSize / 100) * (FIELD / side),
      scatter: [s.scatter, s.scatterMotion * deg, Math.round(s.scatterCycles)],
      displace: [s.displace, s.displaceSwing, Math.round(s.displaceCycles), Math.max(0, PROPERTIES.indexOf(s.displaceProperty))],
      twist: [s.twistAngle * deg, s.twistSwing * deg, Math.round(s.twistCycles), Math.max(0, PROPERTIES.indexOf(s.twistProperty))]
    };
  }
  function hexToRgb(hex) {
    const value = Number.parseInt(String(hex).replace('#', '').slice(0, 6), 16) || 0;
    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
  }

  // ---------- WebGL2 backend ----------
  function createWebGL() {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) return null;
    const vertex = `#version 300 es
      precision highp float;
      precision highp int;
      uniform int side;
      uniform float spacing, phase, camDist, focal, ballSize;
      uniform vec2 viewport;
      uniform mat3 rot;
      uniform vec3 scatterP;
      uniform vec4 displaceP, twistP;
      out vec2 local;
      out float halfPx, coverage;
      const float TAU = 6.28318530718;
      uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
      float rand(uint id, uint k) { return float(hash(id * 4u + k)) / 4294967295.0; }
      float property(int i, vec2 n, float r) {
        if (i == 0) return n.x * .5 + .5;
        if (i == 1) return n.y * .5 + .5;
        if (i == 2) return abs(n.x);
        if (i == 3) return abs(n.y);
        if (i == 4) return min(length(n) / 1.41421356, 1.);
        if (i == 5) return r;
        if (i == 6) return (abs(n.x) + abs(n.y)) * .5;
        if (i == 7) return max(abs(n.x), abs(n.y));
        return pow(n.y * .5 + .5, 3.);
      }
      vec3 rotateAround(vec3 v, vec3 k, float a) {
        float c = cos(a), s = sin(a);
        return v * c + cross(k, v) * s + k * dot(k, v) * (1. - c);
      }
      void main() {
        int id = gl_InstanceID;
        uint uid = uint(id);
        float r0 = rand(uid, 0u), r1 = rand(uid, 1u), r2 = rand(uid, 2u), r3 = rand(uid, 3u);
        float denom = max(float(side - 1), 1.);
        vec2 n = side > 1 ? vec2(float(id % side), float(id / side)) / denom * 2. - 1. : vec2(0);
        vec3 p = vec3(n * (spacing * denom * .5), 0.);
        float f = property(int(displaceP.w), n, r0);
        p.z += displaceP.x * f + displaceP.y * sin(displaceP.z * phase - f * TAU);
        f = property(int(twistP.w), n, r0);
        float twist = twistP.x * f + twistP.y * sin(twistP.z * phase - f * TAU);
        p = vec3(p.x * cos(twist) + p.z * sin(twist), p.y, -p.x * sin(twist) + p.z * cos(twist));
        if (scatterP.x != 0.) {
          float z = r0 * 2. - 1., a = r1 * TAU, s = sqrt(max(0., 1. - z * z));
          vec3 dir = vec3(s * cos(a), s * sin(a), z) * (.35 + .65 * r2);
          vec3 axis = normalize(vec3(r3 - .5, r2 - .5, r1 - .5) + vec3(1e-3, 2e-3, 3e-3));
          p += rotateAround(dir, axis, scatterP.y * sin(scatterP.z * phase + r3 * TAU)) * scatterP.x;
        }
        vec3 q = rot * p;
        float depth = camDist - q.z;
        if (depth < 1.) { gl_Position = vec4(2., 2., 2., 1.); return; }
        float diameter = ballSize * focal / depth;
        float d = max(diameter, 1.);
        coverage = min(diameter, 1.) * min(diameter, 1.);
        halfPx = d * .5;
        vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2. - 1.;
        float pad = halfPx + .75;
        local = corner * pad / halfPx;
        vec2 px = q.xy * focal / depth + corner * pad;
        gl_Position = vec4(px / (viewport * .5), 0., 1.);
      }`;
    const fragment = `#version 300 es
      precision mediump float;
      uniform vec3 color;
      in vec2 local;
      in float halfPx, coverage;
      out vec4 result;
      void main() {
        float a = clamp((1. - length(local)) * halfPx + .5, 0., 1.) * coverage;
        if (a <= 0.) discard;
        result = vec4(color * a, a);
      }`;
    let program, vao, u = {};
    function build() {
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
      program = gl.createProgram();
      gl.attachShader(program, vs); gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      vao = gl.createVertexArray(); // no attributes: everything comes from gl_InstanceID
      for (const name of ['side', 'spacing', 'phase', 'camDist', 'focal', 'ballSize', 'viewport', 'rot', 'scatterP', 'displaceP', 'twistP', 'color']) {
        u[name] = gl.getUniformLocation(program, name);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    try { build(); } catch (error) { console.warn('Ball Field: WebGL2 setup failed, using Canvas 2D.', error); return null; }
    let lost = false;
    const onLost = event => { event.preventDefault(); lost = true; };
    const onRestored = () => { try { u = {}; build(); lost = false; dirty = true; schedule(); } catch (error) { console.warn(error); } };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return {
      name: 'webgl2',
      draw(fp, colors) {
        if (lost) return;
        const bg = hexToRgb(colors.background), ink = hexToRgb(colors.ball);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(bg[0], bg[1], bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        const m = fp.rot; // row-major -> column-major
        gl.uniformMatrix3fv(u.rot, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
        gl.uniform1i(u.side, fp.side);
        gl.uniform1f(u.spacing, fp.spacing);
        gl.uniform1f(u.phase, fp.phase);
        gl.uniform1f(u.camDist, fp.camDist);
        gl.uniform1f(u.focal, fp.focal);
        gl.uniform1f(u.ballSize, fp.ballSize);
        gl.uniform2f(u.viewport, canvas.width, canvas.height);
        gl.uniform3f(u.scatterP, ...fp.scatter);
        gl.uniform4f(u.displaceP, ...fp.displace);
        gl.uniform4f(u.twistP, ...fp.twist);
        gl.uniform3f(u.color, ...ink);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, fp.count);
        return fp.count;
      },
      destroy() {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        gl.deleteProgram(program); gl.deleteVertexArray(vao);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    };
  }

  // ---------- Canvas 2D fallback (same math on the CPU, ball count capped) ----------
  function createCanvas2D() {
    const ctx = canvas.getContext('2d', { alpha: false });
    return {
      name: 'canvas2d',
      draw(fp, colors) {
        const stride = Math.max(1, Math.ceil(Math.sqrt(fp.count / FALLBACK_MAX_BALLS)));
        const cw = canvas.width, ch = canvas.height, cx = cw / 2, cy = ch / 2, m = fp.rot;
        const denom = Math.max(fp.side - 1, 1), halfWidth = fp.spacing * denom * 0.5;
        const [sAmount, sMotion, sCycles] = fp.scatter, [dAmount, dSwing, dCycles, dProp] = fp.displace;
        const [tAngle, tSwing, tCycles, tProp] = fp.twist;
        const size = fp.ballSize * stride;
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.background;
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = colors.ball;
        let drawn = 0;
        for (let iy = 0; iy < fp.side; iy += stride) for (let ix = 0; ix < fp.side; ix += stride) {
          const id = iy * fp.side + ix;
          const r0 = rand(id, 0), r1 = rand(id, 1), r2 = rand(id, 2), r3 = rand(id, 3);
          const nx = fp.side > 1 ? ix / denom * 2 - 1 : 0, ny = fp.side > 1 ? iy / denom * 2 - 1 : 0;
          let x = nx * halfWidth, y = ny * halfWidth, z = 0;
          let f = property(dProp, nx, ny, r0);
          z += dAmount * f + dSwing * Math.sin(dCycles * fp.phase - f * TAU);
          f = property(tProp, nx, ny, r0);
          const tw = tAngle * f + tSwing * Math.sin(tCycles * fp.phase - f * TAU);
          const c = Math.cos(tw), s = Math.sin(tw);
          [x, z] = [x * c + z * s, -x * s + z * c];
          if (sAmount) {
            const dz = r0 * 2 - 1, a = r1 * TAU, sr = Math.sqrt(Math.max(0, 1 - dz * dz)), k = 0.35 + 0.65 * r2;
            const v = [sr * Math.cos(a) * k, sr * Math.sin(a) * k, dz * k];
            let ax = r3 - 0.5 + 1e-3, ay = r2 - 0.5 + 2e-3, az = r1 - 0.5 + 3e-3;
            const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
            const ang = sMotion * Math.sin(sCycles * fp.phase + r3 * TAU), ca = Math.cos(ang), sa = Math.sin(ang);
            const dot = ax * v[0] + ay * v[1] + az * v[2];
            x += (v[0] * ca + (ay * v[2] - az * v[1]) * sa + ax * dot * (1 - ca)) * sAmount;
            y += (v[1] * ca + (az * v[0] - ax * v[2]) * sa + ay * dot * (1 - ca)) * sAmount;
            z += (v[2] * ca + (ax * v[1] - ay * v[0]) * sa + az * dot * (1 - ca)) * sAmount;
          }
          const qx = m[0] * x + m[1] * y + m[2] * z, qy = m[3] * x + m[4] * y + m[5] * z, qz = m[6] * x + m[7] * y + m[8] * z;
          const depth = fp.camDist - qz;
          if (depth < 1) continue;
          const d = Math.max(1, size * fp.focal / depth);
          const px = cx + qx * fp.focal / depth, py = cy - qy * fp.focal / depth;
          if (px + d < 0 || py + d < 0 || px - d > cw || py - d > ch) continue;
          ctx.fillRect(px - d / 2, py - d / 2, d, d);
          drawn++;
        }
        return drawn;
      },
      destroy() {}
    };
  }

  let backend = renderer === 'canvas2d' ? null : createWebGL();
  if (!backend) backend = createCanvas2D();
  canvas.dataset.renderer = backend.name;
  let drawnBalls = 0;

  function resize() {
    const rect = el.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    ratio = Math.min(maxPixelRatio, window.devicePixelRatio || 1);
    const w = Math.round(width * ratio), h = Math.round(height * ratio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    dirty = true;
    schedule();
  }
  function render() {
    const start = performance.now();
    drawnBalls = backend.draw(frameParameters(), settings.colors[activeTheme]) || 0;
    frameCpu = performance.now() - start;
    dirty = false;
  }
  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const animating = () => settings.playing && !document.hidden && !(respectReducedMotion && reducedMotion && reducedMotion.matches);
  function tick(now) {
    raf = 0;
    if (destroyed) return;
    if (animating()) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      progress = (progress + dt / Math.max(0.5, settings.loopLength)) % 1;
      dirty = true;
      fpsFrames++;
      if (!fpsStart) fpsStart = now;
      if (now - fpsStart >= 500) { fps = fpsFrames * 1000 / (now - fpsStart); fpsFrames = 0; fpsStart = now; }
    } else { last = 0; fps = 0; fpsFrames = 0; fpsStart = 0; }
    if (dirty) render();
    if (onFrame) onFrame(stats());
    if (animating()) raf = requestAnimationFrame(tick);
  }
  function schedule() { if (!raf && !destroyed) raf = requestAnimationFrame(tick); }
  function stats() {
    return { backend: backend.name, balls: frameParameters().count, drawn: drawnBalls, fps, frameCpu, progress, playing: animating() };
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(el); else window.addEventListener('resize', resize);
  const onVisibility = () => schedule();
  document.addEventListener('visibilitychange', onVisibility);
  if (reducedMotion && reducedMotion.addEventListener) reducedMotion.addEventListener('change', onVisibility);
  resize();

  return {
    canvas,
    get backend() { return backend.name; },
    get settings() { return mergeSettings(settings, {}); },
    get theme() { return activeTheme; },
    get progress() { return progress; },
    update(next) {
      if (destroyed) return;
      const merged = mergeSettings(settings, next || {});
      Object.assign(settings, merged);
      dirty = true; schedule();
    },
    setTheme(name) { if (name === 'light' || name === 'dark') { activeTheme = name; dirty = true; schedule(); } },
    play() { settings.playing = true; schedule(); },
    pause() { settings.playing = false; schedule(); },
    seek(value) { progress = ((Number(value) % 1) + 1) % 1; dirty = true; schedule(); },
    stats,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      if (resizeObserver) resizeObserver.disconnect(); else window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (reducedMotion && reducedMotion.removeEventListener) reducedMotion.removeEventListener('change', onVisibility);
      backend.destroy();
      canvas.remove();
    }
  };
}
