// Deterministic regression tests for the shared runtime.
//
// The reference is the pre-refactor editor (commit a0f4cf9), which kept a handwritten simulation
// inside index.html. Both implementations run in a vm with an identical seeded Math.random, and
// every particle draw call (x, y, w, h, alpha, fill color) is compared exactly. These tests do not
// replace browser visual checks (tests/webgl-browser.cjs) or performance measurements.
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const REFERENCE = 'a0f4cf9';
const fromGit = file => execFileSync('git', ['show', `${REFERENCE}:${file}`], { encoding: 'utf8' });
const fromDisk = file => fs.readFileSync(file, 'utf8');
const inlineScript = html => html.slice(html.indexOf('  <script>') + 10, html.lastIndexOf('  </script>'));
const SHAPES = ['ridge', 'wave', 'arch', 'vortex', 'veil', 'spiral', 'circle', 'flock', 'swoop', 'split-flock'];

function sandbox({ scripts = [], spy = false } = {}) {
  let seed = 12345;
  const math = Object.create(Math);
  math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const calls = { sin: 0, exp: 0, pow: 0 };
  if (spy) {
    for (const name of Object.keys(calls)) {
      const original = Math[name];
      math[name] = (...args) => { calls[name]++; return original(...args); };
    }
  }
  const frames = new Map();
  let frameId = 0;
  const registrations = new Set();
  const eventTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Map());
        const byCallback = listeners.get(type);
        if (byCallback.has(callback)) return;
        const registration = { type, callback };
        byCallback.set(callback, registration);
        registrations.add(registration);
      },
      removeEventListener(type, callback) {
        const byCallback = listeners.get(type);
        registrations.delete(byCallback?.get(callback));
        byCallback?.delete(callback);
      },
      dispatch(type, target) { for (const callback of listeners.get(type)?.keys() || []) callback({ target }); }
    };
  };

  // Every draw call is hashed rather than stored, so long scenarios stay cheap.
  let buffer = new Float64Array(1 << 16), length = 0, drawCalls = 0;
  const record = (...values) => {
    assert(values.every(Number.isFinite), `non-finite draw value: ${values}`);
    if (length + values.length > buffer.length) {
      const next = new Float64Array(buffer.length * 2); next.set(buffer); buffer = next;
    }
    for (const value of values) buffer[length++] = value;
    drawCalls++;
  };
  const digest = () => {
    const hash = crypto.createHash('sha1').update(Buffer.from(buffer.buffer, 0, length * 8)).digest('hex');
    const result = `${hash}:${drawCalls}`;
    length = 0; drawCalls = 0;
    return result;
  };
  const context2d = {
    globalAlpha: 1, fillStyle: '#000000', setTransform() {},
    fillRect(x, y, w, h) {
      const color = typeof this.fillStyle === 'string' ? parseInt(this.fillStyle.slice(1), 16) : 0;
      record(x, y, w, h, this.globalAlpha, color);
    }
  };
  const element = () => ({ style: { setProperty() {} }, dataset: {}, classList: { toggle() {} },
    setAttribute() {}, ...eventTarget(), appendChild() {}, remove() {},
    cloneNode: () => ({ getContext: () => null }),
    getBoundingClientRect: () => ({ width: 1280, height: 720 }), getContext: () => context2d });
  const elements = new Map();
  const global = { Math: math, console, URL, URLSearchParams, TextEncoder, TextDecoder,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    location: { href: 'http://localhost/', search: '' }, history: { replaceState() {} },
    performance: { now: () => 0 }, navigator: { hardwareConcurrency: 8 },
    document: { hidden: false, createElement: element, ...eventTarget(),
      querySelectorAll: () => [], getElementById(key) {
        if (!elements.has(key)) elements.set(key, element());
        return elements.get(key);
      } },
    matchMedia: () => ({ matches: false, ...eventTarget() }),
    ...eventTarget(),
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  global.window = global;
  const context = vm.createContext(global);
  const run = code => vm.runInContext(code, context, { timeout: 20000 });
  scripts.forEach(run);
  // Runs every pending animation callback once, in registration order, like one browser frame.
  const step = (timestamp = 16) => {
    const pending = [...frames.entries()].sort((a, b) => a[0] - b[0]);
    frames.clear();
    for (const [, callback] of pending) callback(timestamp);
  };
  return { run, step, frames, registrations, element, elements, digest, calls, context };
}

const runtimeScripts = () => [fromDisk('particle-renderer.js'), fromDisk('murmuration-runtime.js'), fromDisk('murmuration-export.js')];
const bootReference = () => {
  const app = sandbox({ scripts: [fromGit('particle-renderer.js'), inlineScript(fromGit('index.html'))] });
  app.digest(); // discard setup draws
  return app;
};
const bootRuntime = (options = {}) => {
  const app = sandbox({ scripts: runtimeScripts(), ...options });
  app.context.host = app.element();
  app.run('var bg = createMurmurationRuntime(host, { renderer: "canvas2d" });');
  app.digest();
  return app;
};

// ---- Reference parity -------------------------------------------------------------------------
// Each operation mirrors what the reference editor did for the same control interaction.
const referenceOps = {
  set(app, patch) {
    for (const [key, value] of Object.entries(patch)) {
      // A <select> only fires "change" when its value actually changes.
      app.run(`{
        const key = ${JSON.stringify(key)}, value = ${JSON.stringify(value)}, changed = settings[key] !== value;
        settings[key] = value;
        if (key === 'shape' && changed) { nudgeTowardsFormation(); clearFrame(); }
        if (key === 'axis' && changed) clearFrame();
        if (key === 'particles' || key === 'ambientParticles') syncParticleCount();
      }`);
    }
  },
  clear: app => app.run('clearFrame()'),
  toState: (app, name) => app.run(`setPreviewState(${JSON.stringify(name)})`)
};
const runtimeOps = {
  set: (app, patch) => app.run(`bg.update(${JSON.stringify(patch)});`),
  clear: app => app.run('bg.clear()'),
  toState: (app, name, config) => app.run(`bg.setState(${JSON.stringify(name)}, ${JSON.stringify(config)}); bg.transitionTo(${JSON.stringify(name)}, 200);`)
};

const reference = bootReference();
const runtime = bootRuntime();
const responseConfig = JSON.parse(reference.run('JSON.stringify(stateConfigs.response)'));
const trace = [];
function phase(label, apply, frames = 4, timestamps) {
  apply();
  for (let i = 0; i < frames; i++) {
    const ts = timestamps ? timestamps[i % timestamps.length] : 16;
    reference.step(ts); runtime.step(ts);
  }
  const expected = reference.digest(), actual = runtime.digest();
  assert.equal(actual, expected, `draw output diverged from the reference at: ${label}`);
  trace.push(label);
}

phase('initial frames', () => {}, 40);
phase('center attenuation 0.7', () => { referenceOps.set(reference, { centerAttenuation: 0.7 }); runtimeOps.set(runtime, { centerAttenuation: 0.7 }); });
for (const shape of SHAPES) {
  phase(`shape ${shape}`, () => { referenceOps.set(reference, { shape }); runtimeOps.set(runtime, { shape }); }, 6);
}
phase('particle count shrink', () => { referenceOps.set(reference, { particles: 2000 }); runtimeOps.set(runtime, { particles: 2000 }); });
phase('particle count grow (capped by device policy)', () => { referenceOps.set(reference, { particles: 16000 }); runtimeOps.set(runtime, { particles: 16000 }); });
phase('recycling and flicker epochs', () => {
  const patch = { speed: 2, scatter: 1.2, turbulence: 1.4, centerAttenuation: 0.3 };
  referenceOps.set(reference, patch); runtimeOps.set(runtime, patch);
}, 150);
phase('full attenuation', () => { referenceOps.set(reference, { centerAttenuation: 1 }); runtimeOps.set(runtime, { centerAttenuation: 1 }); });
phase('no attenuation', () => { referenceOps.set(reference, { centerAttenuation: 0 }); runtimeOps.set(runtime, { centerAttenuation: 0 }); });
for (const axis of ['vertical', 'diagonal']) {
  phase(`axis ${axis}`, () => {
    const patch = { axis, rotation: 20 };
    referenceOps.set(reference, patch); runtimeOps.set(runtime, patch);
  });
}
phase('ambient particles', () => { referenceOps.set(reference, { ambientParticles: 0.6 }); runtimeOps.set(runtime, { ambientParticles: 0.6 }); }, 6);
phase('colors', () => {
  const patch = { particleColor: '#abcdef', backgroundColor: '#123456' };
  referenceOps.set(reference, patch); runtimeOps.set(runtime, patch);
}, 3);
phase('state transition Home to Chat (interpolation + settle)', () => {
  referenceOps.toState(reference, 'response');
  runtimeOps.toState(runtime, 'response', { ...responseConfig, particleColor: '#abcdef', backgroundColor: '#123456' });
}, 6, [16, 80, 120, 199, 250, 400]);
phase('state transition Chat to Home', () => {
  referenceOps.toState(reference, 'information');
  runtimeOps.toState(runtime, 'information', { ...JSON.parse(reference.run('JSON.stringify(stateConfigs.information)')), particleColor: '#abcdef', backgroundColor: '#123456' });
}, 6, [16, 100, 250, 300, 400, 500]);
console.log(`PASS: exact draw parity with reference ${REFERENCE} across ${trace.length} phases (${SHAPES.length} shapes, axes, attenuation, counts, recycling, colors, transitions)`);

// ---- Hot-path cost: caching must not regress ---------------------------------------------------
{
  const measure = app => {
    const { calls } = app;
    for (const key of Object.keys(calls)) calls[key] = 0;
    return calls;
  };
  const referenceSpy = sandbox({ scripts: [fromGit('particle-renderer.js'), inlineScript(fromGit('index.html'))], spy: true });
  const runtimeSpy = bootRuntime({ spy: true });
  referenceOps.set(referenceSpy, { shape: 'wave' }); runtimeOps.set(runtimeSpy, { shape: 'wave' });
  measure(referenceSpy); measure(runtimeSpy);
  for (let i = 0; i < 30; i++) { referenceSpy.step(); runtimeSpy.step(); }
  assert.deepEqual(runtimeSpy.calls, referenceSpy.calls, 'per-frame Math.sin/exp/pow counts must match the cached reference');
  console.log(`PASS: hot-path math calls unchanged over 30 wave frames (${JSON.stringify(runtimeSpy.calls)})`);
}

// ---- Seed bounds and long-run stability --------------------------------------------------------
{
  const source = fs.readFileSync('murmuration-runtime.js', 'utf8');
  assert(!/resetParticle\(i,/.test(source), 'recycling must reseed from the stable particle index, never from the previous seed');
  const app = bootRuntime();
  app.run('bg.update({ speed: 2, scatter: 1.2, turbulence: 1.4 });');
  for (let i = 0; i < 600; i++) app.step(); // record() asserts every draw value is finite
  app.digest();
  console.log('PASS: 600 high-recycling frames stay finite');
}

// ---- Export module: self-contained and identical to the editor runtime ---------------------------
{
  const states = JSON.parse(reference.run('JSON.stringify({ home: stateSnapshot(stateConfigs.information), chat: stateSnapshot(stateConfigs.response) })'));
  const editor = sandbox({ scripts: runtimeScripts() });
  const moduleSource = editor.run(`buildMurmurationModule({ states: ${JSON.stringify(states)}, transitionDuration: 750 })`);
  assert(/^export function createMurmurationBackground/m.test(moduleSource) && /^export const murmurationStates/m.test(moduleSource));
  assert(moduleSource.includes('defaultTransitionDuration = 750'));
  assert(!/"theme"|"overlay"/.test(moduleSource), 'editor-only fields must not be exported');
  const snippet = editor.run(`buildMurmurationSnippet({ states: ${JSON.stringify(states)}, transitionDuration: 750 })`);
  assert(snippet.includes('transitionDuration: 750') && snippet.includes('"chat"'));

  // A fresh sandbox with no editor scripts proves the module carries everything it needs.
  const consumer = sandbox();
  consumer.context.host = consumer.element();
  consumer.run(moduleSource.replace(/^export /gm, ''));
  consumer.run('var controller = createMurmurationBackground(host, { renderer: "canvas2d" });');
  const direct = sandbox({ scripts: runtimeScripts() });
  direct.context.host = direct.element();
  direct.run(`var controller = createMurmurationRuntime(host, { states: ${JSON.stringify(states)}, transitionDuration: 750, renderer: "canvas2d" });`);
  consumer.digest(); direct.digest();
  const script = `controller.update({ shape: 'spiral', centerAttenuation: 0.5 });
    controller.setState('extra', { ...${JSON.stringify(states.home)}, shape: 'circle' });
    controller.transitionTo('extra', 100); controller.transitionTo('chat', 0);`;
  consumer.run(script); direct.run(script);
  for (let i = 0; i < 8; i++) { consumer.step(50 * i); direct.step(50 * i); }
  assert.equal(consumer.digest(), direct.digest(), 'exported module must render exactly like the editor runtime');
  assert.equal(consumer.run('controller.activeState'), 'chat');
  assert.throws(() => consumer.run('controller.transitionTo("missing")'), /Unknown murmuration state/);
  consumer.run('controller.destroy(); controller.update({ speed: 1 }); controller.transitionTo("home");');
  assert.equal(consumer.frames.size, 0, 'API calls after destroy() must not schedule work');
  console.log('PASS: exported module is self-contained, renders identically, rejects unknown states, and ignores calls after destroy()');
}

// ---- Lifecycle -----------------------------------------------------------------------------------
{
  const editor = sandbox({ scripts: [...runtimeScripts(), inlineScript(fromDisk('index.html'))] });
  const initialListeners = editor.registrations.size;
  for (let cycle = 0; cycle < 30; cycle++) {
    editor.elements.get('responseToggle').dispatch('click');
    editor.step(10000);
    const speed = editor.elements.get('speed');
    speed.value = 0.55;
    speed.dispatch('input', speed);
    assert.equal(editor.registrations.size, initialListeners, 'editor listeners must not accumulate');
  }
  const host = editor.element();
  editor.context.host = host;
  const baseline = editor.registrations.size;
  const pendingFrames = editor.frames.size;
  for (let cycle = 0; cycle < 30; cycle++) {
    editor.run('var instance = createMurmurationRuntime(host, { renderer: "canvas2d" }); instance.update({ speed: 0.2 }); instance.setState("a", {}); instance.transitionTo("a", 200);');
    assert.equal(editor.registrations.size, baseline + 3, 'runtime owns resize, visibility and reduced-motion listeners');
    editor.run('instance.destroy(); instance.destroy();');
    assert.equal(editor.registrations.size, baseline, 'destroy removes every runtime listener');
    assert.equal(editor.frames.size, pendingFrames, 'destroy cancels animation and transition frames');
  }
  console.log(`PASS: ${initialListeners} editor listeners stable over 30 transitions/edits; 30 runtime create/destroy cycles leak no listeners or frames`);
}
