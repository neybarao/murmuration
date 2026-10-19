// Murmuration runtime: the single simulation shared by the editor preview and the exported module.
//
// `createMurmurationRuntime` is deliberately self-contained apart from two top-level bindings,
// `MURMURATION_DEFAULTS` (below) and `createParticleRenderer` (particle-renderer.js). The export
// step serializes all three with Function.prototype.toString(), so nothing else may be referenced
// from outside the function body.
const MURMURATION_DEFAULTS = Object.freeze({
  particles: 16000,
  speed: 0.55,
  turbulence: 0.42,
  rotation: 0,
  axis: "horizontal",
  shape: "ridge",
  coverage: 0.72,
  formationScale: 1.18,
  ambientParticles: 0.34,
  spread: 0.88,
  scatter: 0.34,
  coordination: 0.8,
  gathering: 0.55,
  dispersal: 0.38,
  reformation: 0.64,
  responsiveness: 0.35,
  calmness: 0.82,
  dataStructure: 0.32,
  patternSubtlety: 0.74,
  negativeSpace: 0.62,
  edgeSoftness: 0.8,
  depth: 0.55,
  grain: 0.48,
  crest: 0.62,
  arch: 0.54,
  density: 0.72,
  particleSize: 0.72,
  fade: 0.22,
  centerAttenuation: 0,
  particleColor: "#C2C2C2",
  backgroundColor: "#FFFFFF"
});

function createMurmurationRuntime(el, {
  states,
  initialState,
  transitionDuration = 200,
  renderer = 'webgl2',
  theme = 'light',
  ...options
} = {}) {
  const defaultSettings = MURMURATION_DEFAULTS;
  let activeTheme = theme === 'dark' ? 'dark' : 'light';
  // A state may carry `colors: { light: {...}, dark: {...} }`. The pair for the active theme becomes
  // the flat particleColor/backgroundColor the simulation uses. States without `colors` use their
  // flat colors for every theme.
  const resolveState = state => {
    const { colors, ...flat } = { ...defaultSettings, ...state };
    return Object.assign(flat, colors && colors[activeTheme]);
  };
  // Shallow copy so setState() never mutates the caller's collection object.
  const collections = states && Object.keys(states).length ? { ...states } : { default: { ...defaultSettings } };
  let activeState = initialState && collections[initialState] ? initialState : Object.keys(collections)[0];
  const settings = { ...resolveState(collections[activeState]), ...options };
  const surface = createParticleRenderer(document.createElement("canvas"), renderer);
  const canvas = surface.canvas;
  const ctx = surface.context;
  Object.assign(el.style, { position: "absolute", inset: "0", overflow: "hidden", zIndex: "-1" });
  Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" });
  el.appendChild(canvas);
  const target = { x: 0, y: 0 };
  let particleCount = 0;
  let particleX = new Float32Array(0), particleY = new Float32Array(0);
  let velocityX = new Float32Array(0), velocityY = new Float32Array(0);
  let particleSeed = new Float32Array(0);
  // Float64 preserves the exact pseudo-random values used by the simulation.
  const staticOffsets = [307, 719, 611, 101, 202, 42, 9, 33];
  let staticRandom = new Float64Array(0);
  let flickerCache = new Float64Array(0);
  let flickerEpoch = NaN;
  let motionRandom = new Float64Array(0);
  let particleField = new Uint8Array(0);
  let w = 1, h = 1, dpr = 1, t = 0, animationId = 0, transitionFrame = 0, transition = null, destroyed = false, sized = false;
  let centerX = .5, centerY = .55, minDimension = 1, rotationCos = 1, rotationSin = 0, dispersalPulse = 0, shapeSubtlety = 1;
  // Per-frame factors for the two formations that are not a simple function of one coordinate.
  let ringShape = false, ringRadius = 0, ringHalfWidth = 0, haloRadius = 0;
  let swoopShape = false, swoopX = 0, swoopY = 0, swoopCos = 1, swoopSin = 0, swoopLength = 0, swoopWidth = 0, swoopFitX = 1, swoopFitY = 1;
  const diagonalCos = Math.SQRT1_2;
  const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const rand = seed => {
    const x = Math.sin(seed * 127.1) * 43758.5453123;
    return x - Math.floor(x);
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const smoothstep = (min, max, value) => {
    const progress = clamp((value - min) / (max - min), 0, 1);
    return progress * progress * (3 - 2 * progress);
  };
  const centerAttenuationAt = x => {
    if (settings.centerAttenuation === 0) return 1;
    const horizontalPosition = x / w;
    if (horizontalPosition <= .15 || horizontalPosition >= .85) return 1;
    if (horizontalPosition >= .25 && horizontalPosition <= .75) return 1 - settings.centerAttenuation * .95;
    const centerBand = horizontalPosition < .25
      ? smoothstep(.15, .25, horizontalPosition)
      : 1 - smoothstep(.75, .85, horizontalPosition);
    return 1 - centerBand * settings.centerAttenuation * .95;
  };
  const isConstrainedDevice = () => {
    const cores = navigator.hardwareConcurrency || 8;
    const memory = navigator.deviceMemory || 8;
    return w < 768 || cores <= 4 || memory <= 4;
  };
  const effectiveParticleCount = () => Math.min(settings.particles, isConstrainedDevice() ? 6000 : 10000);
  const renderScale = () => isConstrainedDevice() ? .75 : 1;
  const ensureParticleCapacity = count => {
    if (particleX.length >= count) return;
    const capacity = Math.max(count, Math.ceil(Math.max(1, particleX.length) * 1.5));
    const nextX = new Float32Array(capacity), nextY = new Float32Array(capacity);
    const nextVelocityX = new Float32Array(capacity), nextVelocityY = new Float32Array(capacity);
    const nextSeed = new Float32Array(capacity), nextField = new Uint8Array(capacity);
    nextX.set(particleX); nextY.set(particleY); nextVelocityX.set(velocityX); nextVelocityY.set(velocityY);
    nextSeed.set(particleSeed); nextField.set(particleField);
    const nextRandom = new Float64Array(capacity * staticOffsets.length);
    nextRandom.set(staticRandom);
    staticRandom = nextRandom;
    const nextFlicker = new Float64Array(capacity);
    nextFlicker.set(flickerCache);
    flickerCache = nextFlicker;
    const nextMotion = new Float64Array(capacity * 6);
    nextMotion.fill(NaN);
    nextMotion.set(motionRandom);
    motionRandom = nextMotion;
    particleX = nextX; particleY = nextY; velocityX = nextVelocityX; velocityY = nextVelocityY;
    particleSeed = nextSeed; particleField = nextField;
  };
  const resetParticle = (index, source = index + 1) => {
    const r = Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    const field = rand(index + 78) < settings.ambientParticles;
    particleX[index] = field ? Math.random() * w : w * .5 + Math.cos(a) * r * w * .42;
    particleY[index] = field ? Math.random() * h : h * .58 + Math.sin(a) * r * h * .28;
    velocityX[index] = (Math.random() - .5) * .6; velocityY[index] = (Math.random() - .5) * .6;
    particleSeed[index] = source * 13.37 + Math.random() * 900;
    flickerCache[index] = rand(particleSeed[index] + Math.floor(t * .002));
    motionRandom[index * 6] = motionRandom[index * 6 + 2] = motionRandom[index * 6 + 4] = NaN;
    for (let slot = 0; slot < staticOffsets.length; slot++) {
      staticRandom[index * staticOffsets.length + slot] = rand(particleSeed[index] + staticOffsets[slot]);
    }
    particleField[index] = field ? 1 : 0;
  };
  const updateFrameConstants = () => {
    const angle = settings.rotation * Math.PI / 180;
    rotationCos = Math.cos(angle);
    rotationSin = Math.sin(angle);
    dispersalPulse = settings.dispersal * (.5 + .5 * Math.sin(t * .0014));
    shapeSubtlety = .45 + settings.patternSubtlety * .75;
    ringShape = settings.shape === "circle";
    swoopShape = settings.shape === "swoop";
    if (ringShape) {
      // A flat ring facing the viewer: isotropic scale so it stays round, nothing in the middle.
      const scale = (1 + settings.coverage * .38) * (1 + dispersalPulse * .34 - settings.gathering * .18);
      ringRadius = minDimension * .26 * settings.spread * settings.formationScale * scale;
      ringHalfWidth = minDimension * (.01 + .045 * settings.density) * (.6 + .8 * settings.edgeSoftness) * (1 + settings.scatter * .8) * scale;
      haloRadius = ringRadius * 1.03 + ringHalfWidth;
    } else if (swoopShape) {
      // A cloud that wanders, wheels and breathes. Sums of incommensurate sines keep the path
      // from repeating visibly; the breathing phase is itself slowly modulated.
      const breath = .5 + .5 * Math.sin(t * .0017 + .8 * Math.sin(t * .0006));
      const heading = .45 * Math.sin(t * .0007 + .3) + .25 * Math.sin(t * .0017 + 1.1);
      swoopCos = Math.cos(heading);
      swoopSin = Math.sin(heading);
      swoopX = w * (.14 * Math.sin(t * .0006 + .7) + .06 * Math.sin(t * .0015 + 2.1));
      swoopY = h * (.08 * Math.sin(t * .0008 + 1.9) + .04 * Math.sin(t * .0019));
      swoopLength = w * .25 * settings.spread * settings.formationScale * (.78 + .44 * breath);
      swoopWidth = h * (.09 + .17 * settings.density) * (.45 + breath);
      // The shared post-processing enlarges every shape about the center; pre-divide so the
      // cloud keeps the size designed here.
      swoopFitX = 1 / (1 + settings.coverage * .38);
      swoopFitY = 1 / (1 + settings.coverage * .5);
    }
  };
  const cachedMotionRandom = (index, slot, epoch, offset = 0) => {
    const base = index * 6 + slot * 2;
    if (motionRandom[base] !== epoch) {
      motionRandom[base] = epoch;
      motionRandom[base + 1] = rand(particleSeed[index] + offset + epoch);
    }
    return motionRandom[base + 1];
  };
  const targetFor = (index, out = target) => {
    const seed = particleSeed[index];
    if (particleField[index]) {
      const ax = cachedMotionRandom(index, 0, Math.floor(t * .003));
      const ay = cachedMotionRandom(index, 1, Math.floor(t * .002), 911);
      const driftX = Math.sin(t * .0007 + seed) * w * .08 * settings.coverage;
      const driftY = Math.cos(t * .0006 + seed) * h * .08 * settings.coverage;
      if (ringShape) {
        // Each ambient particle orbits near its own bearing. Retargets only hop a short angle, so
        // their paths never cut across the empty middle of the ring.
        const angle = staticRandom[index * 8 + 3] * Math.PI * 2 + t * .00022 + (ax - .5) * .6;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        // Distance from the center to the viewport edge along this bearing (inset 4%). Fitting the
        // band into it avoids clamping, which would pile particles up along an invisible rectangle.
        const reach = Math.min(
          Math.abs(cos) > 1e-4 ? (cos > 0 ? w * .96 - centerX : centerX - w * .04) / Math.abs(cos) : Infinity,
          Math.abs(sin) > 1e-4 ? (sin > 0 ? h * .96 - centerY : centerY - h * .04) / Math.abs(sin) : Infinity
        );
        const inner = Math.min(haloRadius * 1.08, reach * .55);
        const outer = Math.min(haloRadius * 1.98, reach * .92);
        const radius = inner + ay * (outer - inner);
        out.x = centerX + cos * radius + driftX * .25;
        out.y = centerY + sin * radius + driftY * .25;
        return out;
      }
      out.x = w * (.08 + ax * .84) + driftX;
      out.y = h * (.08 + ay * .84) + driftY;
      return out;
    }
    const n = (cachedMotionRandom(index, 2, Math.floor(t * .018)) - .5) * (settings.turbulence + settings.scatter + dispersalPulse * .5);
    if (ringShape) {
      const turn = staticRandom[index * 8] * Math.PI * 2 + t * .00035;
      // Triangular radial profile: dense core, soft edges.
      const radial = staticRandom[index * 8 + 1] + staticRandom[index * 8 + 2] - 1;
      const radius = ringRadius * (1 + Math.sin(turn * 3 + t * .0011) * .02 * settings.crest) + (radial + n * .6) * ringHalfWidth;
      out.x = centerX + Math.cos(turn) * radius;
      out.y = centerY + Math.sin(turn) * radius;
      return out;
    }
    const u = ((seed * .618033 + t * .00035) % 1) * 2 - 1;
    const abs = Math.abs(u);
    const structureStep = Math.round(u * 18) / 18;
    const structuredU = u * (1 - settings.dataStructure * .42) + structureStep * settings.dataStructure * .42;
    const band = h * (.025 + .21 * settings.density * (1 - Math.exp(-abs * (2 + settings.edgeSoftness * 2.4))));
    let x = w * .5 + structuredU * w * .54 * settings.spread * settings.formationScale, y;
    if (settings.shape === "wave") {
      y = h * .55 + Math.sin(u * Math.PI * 1.4 + t * .0025) * h * .2 * settings.crest + n * band;
    } else if (settings.shape === "arch") {
      y = h * .68 - Math.sin((1 - abs) * Math.PI) * h * .34 * settings.crest + n * band;
    } else if (settings.shape === "vortex") {
      const turn = u * Math.PI * 2.4 + t * .003 + seed * .01;
      const radius = (.12 + abs * .42 + n * .04) * minDimension * settings.spread * settings.formationScale;
      x = w * .5 + Math.cos(turn) * radius;
      y = h * .54 + Math.sin(turn) * radius * (.5 + settings.arch * .5);
    } else if (settings.shape === "veil") {
      y = h * (.5 + u * .28) + Math.sin(u * Math.PI * 3 + t * .002) * h * .09 * settings.crest + n * band * 1.25;
    } else if (settings.shape === "spiral") {
      const turn = u * Math.PI * 3.6 + t * .0024 + n * .7;
      const radius = (.08 + abs * .54) * minDimension * settings.spread * settings.formationScale;
      x = w * .5 + Math.cos(turn) * radius;
      y = h * .55 + Math.sin(turn) * radius * (.35 + settings.arch * .55);
    } else if (settings.shape === "flock") {
      const head = Math.exp(-Math.pow(structuredU + .42, 2) * 28) * h * .3 * settings.crest;
      const shoulder = Math.exp(-Math.pow(structuredU - .12, 2) * 10) * h * .1;
      const trailingWing = Math.pow((structuredU + 1) * .5, 2.15) * h * .24 * settings.arch;
      x += Math.sin((structuredU + .2) * Math.PI) * w * .045 * settings.spread;
      y = h * .66 - head - shoulder + trailingWing + Math.sin(structuredU * Math.PI * 1.6 + t * .0017) * h * .035 + n * band * .72;
    } else if (swoopShape) {
      const reach = Math.abs(structuredU), reachPower = reach * Math.sqrt(reach);
      const along = (structuredU < 0 ? -reachPower : reachPower) * swoopLength;
      const taper = Math.sqrt(1 - reachPower);
      const across = ((staticRandom[index * 8 + 1] + staticRandom[index * 8 + 2] - 1) * swoopWidth
        + Math.sin(structuredU * Math.PI * 1.8 + t * .0023) * swoopWidth * .35 * settings.crest) * taper + n * band * .5;
      x = centerX + (swoopX + along * swoopCos - across * swoopSin) * swoopFitX;
      y = centerY + (swoopY + along * swoopSin + across * swoopCos) * swoopFitY;
    } else if (settings.shape === "split-flock") {
      const branch = staticRandom[index * 8 + 2] > .5 ? -1 : 1;
      const localU = structuredU * .78;
      x = w * .5 + branch * w * .19 * settings.spread + localU * w * .28 * settings.spread * settings.formationScale;
      y = h * (.55 + branch * .045) + Math.sin(localU * Math.PI * 1.3 + t * .0018) * h * .12 * settings.crest + n * band * .55;
    } else {
      const structuredAbs = Math.abs(structuredU);
      const crest = Math.exp(-structuredAbs * structuredAbs * 5.4) * h * .36 * settings.crest * shapeSubtlety;
      const wing = Math.pow(abs, 1.7) * h * .24 * settings.arch;
      y = h * (.62 + .09 * Math.sin(u * Math.PI + t * .002)) - crest + wing + n * band;
    }
    const expansion = 1 + dispersalPulse * .34 - settings.gathering * .18;
    const coverageLift = 1 + settings.coverage * .38;
    x = w * .5 + (x - w * .5) * expansion * coverageLift;
    y = h * .55 + (y - h * .55) * expansion * (1 + settings.coverage * .5);
    x += (staticRandom[index * 8 + 3] - .5) * w * (.08 + settings.coverage * .18) * settings.scatter * (1.3 - settings.calmness * .5);
    y += (staticRandom[index * 8 + 4] - .5) * h * (.08 + settings.coverage * .2) * settings.scatter * (1.3 - settings.calmness * .5);
    const hollow = Math.exp(-u * u * 18) * settings.arch * settings.negativeSpace;
    // The swoop cloud wheels freely, so a fixed screen-space gap would read as a streak.
    if (!swoopShape && staticRandom[index * 8 + 5] < hollow * .55) y += h * (.13 + .16 * staticRandom[index * 8 + 6]);
    const dx = x - centerX, dy = y - centerY;
    if (settings.axis === "vertical") {
      x = centerX + dy; y = centerY + dx;
    } else if (settings.axis === "diagonal") {
      x = centerX + dx * diagonalCos - dy * diagonalCos;
      y = centerY + dx * diagonalCos + dy * diagonalCos;
    }
    const rdx = x - centerX, rdy = y - centerY;
    out.x = centerX + rdx * rotationCos - rdy * rotationSin;
    out.y = centerY + rdx * rotationSin + rdy * rotationCos;
    return out;
  };
  const syncParticleCount = () => {
    const count = effectiveParticleCount();
    ensureParticleCapacity(count);
    while (particleCount < count) {
      resetParticle(particleCount, particleCount + 1);
      particleCount += 1;
    }
    particleCount = count;
    for (let i = 0; i < particleCount; i++) particleField[i] = rand(i + 78) < settings.ambientParticles ? 1 : 0;
  };
  const nudgeTowardsFormation = (multiplier = .02) => {
    updateFrameConstants();
    for (let i = 0; i < particleCount; i++) {
      if (particleField[i]) continue;
      const nextTarget = targetFor(i);
      velocityX[i] += (nextTarget.x - particleX[i]) * multiplier;
      velocityY[i] += (nextTarget.y - particleY[i]) * multiplier;
    }
  };
  const easeInOutCubic = value => value < .5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
  const clearFrame = () => {
    ctx.globalAlpha = 1; ctx.fillStyle = settings.backgroundColor; ctx.fillRect(0, 0, w, h);
  };
  function resize() {
    if (destroyed) return;
    const box = el.getBoundingClientRect();
    const nextDpr = Math.min(window.devicePixelRatio || 1, renderScale());
    const nextW = Math.max(1, Math.floor(box.width)), nextH = Math.max(1, Math.floor(box.height));
    // Spurious resize notifications must not reset the canvas and its trails.
    if (sized && nextW === w && nextH === h && nextDpr === dpr) return;
    sized = true; dpr = nextDpr; w = nextW; h = nextH;
    centerX = w * .5; centerY = h * .55; minDimension = Math.min(w, h);
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncParticleCount();
    clearFrame();
  }
  // Parameters interpolate over `duration`; particles keep their position and velocity and
  // regroup physically toward the new targets, so settling may outlast the interpolation.
  function transitionTo(name, duration = transitionDuration) {
    if (destroyed) return;
    if (!Object.prototype.hasOwnProperty.call(collections, name)) {
      throw new Error(`Unknown murmuration state: ${name}`);
    }
    cancelAnimationFrame(transitionFrame);
    // An interrupted transition continues from the current interpolated values.
    const previous = { ...settings };
    const nextSettings = resolveState(collections[name]);
    const immediateKeys = ["particles", "ambientParticles", "shape", "axis", "particleColor", "backgroundColor"];
    const numericKeys = Object.keys(nextSettings).filter(key =>
      typeof previous[key] === "number" &&
      typeof nextSettings[key] === "number" &&
      !immediateKeys.includes(key)
    );
    immediateKeys.forEach(key => { settings[key] = nextSettings[key]; });
    syncParticleCount();
    if (previous.shape !== settings.shape) nudgeTowardsFormation();
    activeState = name;
    transition = { nextSettings };
    if (!(duration > 0)) {
      Object.assign(settings, nextSettings);
      syncParticleCount();
      transition = null;
      return;
    }
    const start = performance.now();
    const tick = now => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = easeInOutCubic(progress);
      numericKeys.forEach(key => {
        settings[key] = previous[key] + (nextSettings[key] - previous[key]) * eased;
      });
      if (progress < 1) {
        transitionFrame = requestAnimationFrame(tick);
      } else {
        Object.assign(settings, nextSettings);
        syncParticleCount();
        transition = null;
      }
    };
    transitionFrame = requestAnimationFrame(tick);
  }
  function update(nextOptions = {}) {
    if (destroyed) return;
    if (nextOptions.colors) {
      const { colors, ...rest } = nextOptions;
      nextOptions = Object.assign(rest, colors[activeTheme]);
    }
    const shapeChanged = nextOptions.shape !== undefined && nextOptions.shape !== settings.shape;
    const compositionChanged = shapeChanged || (nextOptions.axis !== undefined && nextOptions.axis !== settings.axis);
    Object.assign(settings, nextOptions);
    // An edit made mid-transition becomes part of the destination instead of being overwritten.
    if (transition) Object.assign(transition.nextSettings, nextOptions);
    if ("particles" in nextOptions || "ambientParticles" in nextOptions) syncParticleCount();
    if (shapeChanged) nudgeTowardsFormation();
    if (compositionChanged) clearFrame();
  }
  const shouldAnimate = () => !document.hidden && !reducedMotionQuery.matches;
  const stopAnimation = () => {
    cancelAnimationFrame(animationId);
    animationId = 0;
  };
  const startAnimation = () => {
    if (!shouldAnimate() || animationId) return;
    animationId = requestAnimationFrame(frame);
    ctx.flush?.();
  };
  const updateAnimationState = () => {
    if (shouldAnimate()) startAnimation();
    else stopAnimation();
  };
  function frame() {
    animationId = 0;
    if (!shouldAnimate()) return;
    t += 16 * settings.speed;
    updateFrameConstants();
    ctx.globalAlpha = settings.fade; ctx.fillStyle = settings.backgroundColor; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1; ctx.fillStyle = settings.particleColor;
    const attraction = .0016 + settings.reformation * .0024 + settings.gathering * .0012;
    const flowForce = (.012 + settings.responsiveness * .018) * settings.turbulence * (1.2 - settings.calmness * .55);
    const damping = .86 + settings.coordination * .08 + settings.calmness * .04;
    const movementScale = settings.speed * (.65 + settings.responsiveness * .55);
    const depthScale = settings.depth * .5;
    const fieldOpacity = .34 + settings.coverage * .22;
    const grainScale = settings.grain * .34;
    const nextFlickerEpoch = Math.floor(t * .002);
    const refreshFlicker = nextFlickerEpoch !== flickerEpoch;
    flickerEpoch = nextFlickerEpoch;
    for (let i = 0; i < particleCount; i++) {
      const seed = particleSeed[i];
      const nextTarget = targetFor(i);
      let x = particleX[i], y = particleY[i], vx = velocityX[i], vy = velocityY[i];
      const flow = Math.sin((x * .006) + (y * .004) + t * .004 + seed);
      vx += (nextTarget.x - x) * attraction + Math.cos(flow + seed) * flowForce;
      vy += (nextTarget.y - y) * attraction + Math.sin(flow * 1.7) * flowForce * .78;
      vx *= damping; vy *= damping;
      x += vx * movementScale; y += vy * movementScale;
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) {
        resetParticle(i);
        x = particleX[i]; y = particleY[i]; vx = velocityX[i]; vy = velocityY[i];
      }
      particleX[i] = x; particleY[i] = y; velocityX[i] = vx; velocityY[i] = vy;
      if (refreshFlicker) flickerCache[i] = rand(particleSeed[i] + flickerEpoch);
      const flicker = flickerCache[i];
      const depth = .32 + depthScale * staticRandom[i * 8 + 7];
      const opacity = (.12 + depth + flicker * grainScale) * (particleField[i] ? fieldOpacity : 1) * centerAttenuationAt(x);
      ctx.globalAlpha = Math.min(.92, Math.max(.04, opacity));
      ctx.fillRect(x, y, settings.particleSize, settings.particleSize);
    }
    animationId = requestAnimationFrame(frame);
  }
  const onResize = () => resize();
  addEventListener("resize", onResize);
  // Also follow container-driven size changes (collapsing sidebars, layout shifts).
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  resizeObserver?.observe(el);
  document.addEventListener("visibilitychange", updateAnimationState);
  reducedMotionQuery.addEventListener("change", updateAnimationState);
  resize();
  startAnimation();
  return {
    canvas,
    get activeState() { return activeState; },
    get activeParticles() { return particleCount; },
    setState(name, state) { collections[name] = { ...defaultSettings, ...state }; },
    transitionTo,
    update,
    clear() { if (!destroyed) clearFrame(); },
    get theme() { return activeTheme; },
    // Switches to the other palette of the active state without touching anything else.
    setTheme(name) {
      if (destroyed || (name !== 'light' && name !== 'dark')) return;
      activeTheme = name;
      const { particleColor, backgroundColor } = resolveState(collections[activeState]);
      Object.assign(settings, { particleColor, backgroundColor });
      if (transition) Object.assign(transition.nextSettings, { particleColor, backgroundColor });
      clearFrame();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      transition = null;
      stopAnimation();
      cancelAnimationFrame(transitionFrame);
      removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", updateAnimationState);
      reducedMotionQuery.removeEventListener("change", updateAnimationState);
      ctx.destroy?.();
      canvas.remove();
    }
  };
}
