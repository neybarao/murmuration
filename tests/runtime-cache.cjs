const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

function boot(html) {
  const script = html.slice(html.indexOf('  <script>') + 10, html.lastIndexOf('  </script>'));
  let random = 12345;
  const math = Object.create(Math);
  math.random = () => ((random = (random * 1664525 + 1013904223) >>> 0) / 4294967296);
  const frames = new Map();
  let id = 0;
  const pixels = [];
  const registrations = new Set();
  const eventTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Map());
        const callbacks = listeners.get(type);
        if (callbacks.has(callback)) return;
        const registration = { type, callback };
        callbacks.set(callback, registration);
        registrations.add(registration);
      },
      removeEventListener(type, callback) {
        const callbacks = listeners.get(type);
        registrations.delete(callbacks?.get(callback));
        callbacks?.delete(callback);
      },
      dispatch(type, target) {
        for (const callback of listeners.get(type)?.keys() || []) callback({ target });
      }
    };
  };
  const context2d = { setTransform() {}, fillRect(...args) {
    assert(args.every(Number.isFinite));
    pixels.push([...args, this.globalAlpha]);
  } };
  const element = () => ({ style: { setProperty() {} }, dataset: {}, classList: { toggle() {} },
    setAttribute() {}, ...eventTarget(), appendChild() {}, remove() {},
    cloneNode: () => ({ getContext: () => null }),
    getBoundingClientRect: () => ({ width: 1280, height: 720 }), getContext: () => context2d });
  const elements = new Map();
  const sandbox = { Math: math, console, URL, URLSearchParams, TextEncoder, TextDecoder,
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
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
    cancelAnimationFrame(key) { frames.delete(key); }
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const run = code => vm.runInContext(code, ctx, { timeout: 3000 });
  if (html.includes('src="./particle-renderer.js"')) run(fs.readFileSync('particle-renderer.js', 'utf8'));
  run(script);
  return { run, pixels, frames, element, ctx, registrations, elements };
}

const current = fs.readFileSync('index.html', 'utf8');
// Compare optimization parity with the same bounded reseeding fix on the old runtime.
const previous = execFileSync('git', ['show', '1887661:index.html'], { encoding: 'utf8' })
  .replaceAll('resetParticle(i, seed)', 'resetParticle(i)');
const baseline = boot(previous);
const updated = boot(current);
const attenuationResults = [];
for (const app of [baseline, updated]) {
  attenuationResults.push(app.run(`JSON.stringify([0, 0.3, 1].flatMap(amount => {
    settings.centerAttenuation = amount;
    return [-1, 0, .15 - 1e-12, .15, .15 + 1e-12, .2, .25 - 1e-12, .25, .5, .75, .75 + 1e-12, .8, .85 - 1e-12, .85, 1, 2,
      ...Array.from({ length: 1001 }, (_, i) => i / 1000)].map(position => centerAttenuationAt(position * w));
  }))`));
}
assert.equal(attenuationResults[1], attenuationResults[0], 'attenuation matches original formula including boundaries');
for (const app of [baseline, updated]) {
  app.pixels.length = 0;
  for (const shape of ['ridge', 'wave', 'arch', 'vortex', 'veil', 'spiral', 'circle', 'flock', 'swoop', 'split-flock']) {
    app.run(`settings.shape = '${shape}'; settings.centerAttenuation = 0.7; draw();`);
  }
  app.run('settings.particles = 2000; syncParticleCount(); settings.particles = 16000; syncParticleCount(); draw();');
  for (const time of [490, 499, 500, 999, 1000, 1500]) {
    app.run(`t = ${time}; settings.speed = 0; draw();`);
    app.run('particleX[0] = -100; draw();');
  }
}
assert.deepEqual(updated.pixels, baseline.pixels, 'rendering must match baseline exactly');
for (const app of [baseline, updated]) {
  app.pixels.length = 0;
  app.run(`settings.speed = 0; settings.particleSize = 1; particleCount = 8;
    particleX.set([-2, -0.5, 1280, 1279.5, 100, 100, 100, 100]);
    particleY.set([100, 100, 100, 100, -2, -0.5, 720, 719.5]); draw();`);
}
assert.equal(updated.pixels.length, 9, 'draw background plus all eight edge particles');
assert.deepEqual(updated.pixels, baseline.pixels, 'edge particles must remain unchanged');
for (const app of [baseline, updated]) {
  app.pixels.length = 0;
  app.run('particleX.fill(100, 0, 8); particleY.fill(100, 0, 8); t += 500; draw(); settings.particles = 16000; syncParticleCount();');
}
assert.deepEqual(updated.pixels, baseline.pixels, 're-entering particles retain correct opacity');
assert.equal(updated.run('particleCount'), 10000);
const recycling = boot(current);
recycling.run(`
  settings.speed = 0;
  particleCount = 1;
  for (let cycle = 0; cycle < 100; cycle++) {
    particleX[0] = -100;
    draw();
    if (!Number.isFinite(particleSeed[0]) || particleSeed[0] > 914 || particleSeed[0] < 13)
      throw Error('Particle reseeding must remain bounded');
    if (!Number.isFinite(particleX[0]) || !Number.isFinite(particleY[0]))
      throw Error('Particle position must remain finite');
  }
`);
updated.run(`
  var savedSin = Math.sin, randomSinCalls = 0;
  Math.sin = (...args) => { randomSinCalls++; return savedSin(...args); };
  motionRandom.fill(NaN);
  for (let slot = 0; slot < 3; slot++) {
    cachedMotionRandom(0, slot, 17, slot === 1 ? 911 : 0);
    cachedMotionRandom(0, slot, 17, slot === 1 ? 911 : 0);
    cachedMotionRandom(0, slot, 18, slot === 1 ? 911 : 0);
  }
`);
assert.equal(updated.run('randomSinCalls'), 6, 'each motion channel recalculates only on epoch changes');
updated.run('Math.sin = savedSin; resetParticle(0);');
assert.equal(updated.run('Number.isNaN(motionRandom[0]) && Number.isNaN(motionRandom[2]) && Number.isNaN(motionRandom[4])'), true);
// A non-ridge target must not evaluate the discarded ridge exponential/power.
updated.run(`
  var savedExp = Math.exp, savedPow = Math.pow;
  var expCalls = 0, powCalls = 0;
  Math.exp = (...args) => { expCalls++; return savedExp(...args); };
  Math.pow = (...args) => { powCalls++; return savedPow(...args); };
  var formationIndex = particleField.findIndex(value => value === 0);
  settings.shape = 'wave'; targetFor(formationIndex, 100);
`);
assert.equal(updated.run('expCalls'), 2);
assert.equal(updated.run('powCalls'), 0);
updated.run('Math.exp = savedExp; Math.pow = savedPow;');
updated.run('settings.centerAttenuation = 0; if (centerAttenuationAt(640) !== 1) throw Error("attenuation");');
const moduleCode = updated.run('exportedModule()').replace(/export /g, '');
updated.ctx.host = updated.element();
updated.run(moduleCode + '\nvar controller = createMurmurationBackground(host);');
updated.run('controller.update({ particles: 2000 }); controller.update({ particles: 16000 }); controller.transitionTo("chat", 0);');
for (const callback of [...updated.frames.values()]) callback(16);
updated.run('controller.destroy();');
const exportedPixels = [];
for (const html of [previous, current]) {
  const app = boot(html);
  app.ctx.host = app.element();
  app.run(app.run('exportedModule()').replace(/export /g, '') + '\nvar controller = createMurmurationBackground(host);');
  app.pixels.length = 0;
  for (const shape of ['ridge', 'wave', 'arch', 'vortex', 'veil', 'spiral', 'circle', 'flock', 'swoop', 'split-flock']) {
    app.run(`controller.update({ shape: '${shape}', centerAttenuation: 0.7 });`);
    const callbacks = [...app.frames.values()];
    app.frames.clear();
    for (const callback of callbacks) callback(16);
  }
  app.run('controller.update({ speed: 40 });');
  for (let frame = 0; frame < 5; frame++) {
    const callbacks = [...app.frames.values()];
    app.frames.clear();
    for (const callback of callbacks) callback(16);
  }
  exportedPixels.push(app.pixels);
  app.run('controller.destroy();');
}
assert.deepEqual(exportedPixels[1], exportedPixels[0], 'exported shapes must match baseline exactly');
const lifecycle = boot(current);
const initialListeners = lifecycle.registrations.size;
for (let cycle = 0; cycle < 30; cycle++) {
  lifecycle.elements.get('responseToggle').dispatch('click');
  const pending = [...lifecycle.frames.values()];
  lifecycle.frames.clear();
  for (const callback of pending) callback(10000);
  const speed = lifecycle.elements.get('speed');
  speed.value = 0.55;
  speed.dispatch('input', speed);
  assert.equal(lifecycle.registrations.size, initialListeners, 'UI listeners must not accumulate');
  lifecycle.pixels.length = 0;
}
lifecycle.ctx.host = lifecycle.element();
lifecycle.run(lifecycle.run('exportedModule()').replace(/export /g, ''));
for (let cycle = 0; cycle < 30; cycle++) {
  const pendingFrames = lifecycle.frames.size;
  lifecycle.run('var instance = createMurmurationBackground(host); instance.update({ speed: 0.2 }); instance.transitionTo("chat", 200);');
  assert.equal(lifecycle.registrations.size, initialListeners + 3, 'runtime owns three listeners');
  lifecycle.run('instance.destroy();');
  assert.equal(lifecycle.registrations.size, initialListeners, 'destroy removes all runtime listeners');
  assert.equal(lifecycle.frames.size, pendingFrames, 'destroy cancels animation and transition frames');
  lifecycle.pixels.length = 0;
}
console.log(`PASS: ${initialListeners} tracked UI listeners stable after 30 transitions/edits; 30 runtime create/destroy cycles clean up all listeners and RAF callbacks`);
console.log('PASS: exact draw parity across 10 shapes, edge re-entry, count shrink/grow, attenuation, exported runtime initialization/update/transition/destroy');
