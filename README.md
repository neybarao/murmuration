# Murmuration Background

## Rendering Backend

The runtime defaults to native WebGL2 rendering with the existing CPU simulation.
Compare `?renderer=webgl2` with `?renderer=canvas2d` using the same shared configuration
(append `&renderer=...` when a query string already exists). Open one version at a time.
If WebGL2 initialization is unavailable or fails, the app uses Canvas 2D.

Download JS embeds the renderer with no dependencies or new preset fields. The factory
accepts an optional runtime setting: `{ renderer: "canvas2d" }` forces the baseline;
the default is `"webgl2"`.

Particles use one instanced draw, plus a background draw. Fractional square coverage
is computed in the fragment shader. Exact visual equivalence with Canvas compositing
is not guaranteed, and CPU/GPU/power improvements require measurement. This renderer
uses `preserveDrawingBuffer` for trails, which may add GPU cost. Context restoration
rebuilds GPU resources but starts with an empty trail history.

Run `node tests/runtime-cache.cjs` for fallback regression tests. With Playwright and
Chrome available and a local server on port 4174, run `node tests/webgl-browser.cjs`
for browser rendering, exported module, and desktop/mobile checks.

## Architecture

One runtime drives both the lab preview and the downloaded module, so a behavior change is made once.

| File | Responsibility |
| --- | --- |
| `murmuration-runtime.js` | `createMurmurationRuntime()`: simulation, state transitions, lifecycle. Also defines `MURMURATION_DEFAULTS`, the single source of default parameter values. |
| `particle-renderer.js` | `createParticleRenderer()`: batched WebGL2 drawing with automatic Canvas 2D fallback. |
| `murmuration-export.js` | Builds the downloadable module and the integration snippet. |
| `index.html` | Editor only: controls, saved Home/Chat collections, share links, overlays. It drives the runtime through its public API (`update`, `setState`, `transitionTo`, `clear`), as an integrator would. |

Download JS serializes `createParticleRenderer`, `createMurmurationRuntime` and `MURMURATION_DEFAULTS` with `Function.prototype.toString()`. For that reason `createMurmurationRuntime` and `createParticleRenderer` must stay self-contained: they may reference only each other and `MURMURATION_DEFAULTS`. `tests/runtime-cache.cjs` evaluates the generated module in an empty sandbox to catch a missing dependency.

## Baseline

Murmuration Background is a dependency-free WebGL2 animation with Canvas 2D fallback for web application backgrounds. It renders a field of particles that behaves like a flock and can reorganize between named visual states.

The lab at [www.neybarao.com/murmuration](https://www.neybarao.com/murmuration/) is the source of truth for visual tuning. Use **Download JS** to generate a self-contained ES module with the current `home` and `chat` state collections.

## What the Download Contains

The downloaded `murmuration-background.js` exports:

- `murmurationStates`: the tuned `home` and `chat` state collections, each with light and dark colors.
- `defaultTransitionDuration`: the duration selected in the lab, in milliseconds.
- `createMurmurationBackground()`: creates and controls a Canvas instance.

The overlay preview is lab-only and is not exported. The lab's current theme appears in the snippet as the `theme` option; the host application should pass its own theme and call `setTheme()` when it changes.

## Quick Start

Create a positioning context for the background and keep application content above it.

```html
<main class="screen">
  <div id="murmuration-bg" aria-hidden="true"></div>
  <section class="content">
    <!-- Application UI -->
  </section>
</main>
```

```css
.screen {
  isolation: isolate;
  min-height: 100dvh;
  position: relative;
}

.content {
  position: relative;
  z-index: 1;
}
```

```js
import {
  createMurmurationBackground,
  murmurationStates
} from "./murmuration-background.js";

const murmuration = createMurmurationBackground(
  document.querySelector("#murmuration-bg"),
  {
    states: murmurationStates,
    initialState: "home",
    transitionDuration: 200
  }
);
```

The target element is styled by the module as an absolute, full-size background with `z-index: -1`. Its parent must therefore establish a stacking context, as in the example above.

## State Transitions

Use names from the `states` object to transition the flock.

```js
murmuration.transitionTo("chat");
murmuration.transitionTo("home");
```

An optional second argument overrides the configured transition duration for one call.

```js
murmuration.transitionTo("chat", 320);
```

Numeric parameters interpolate with a smooth cubic ease. Shape changes retain the flock simulation: particles receive an initial steering impulse and then regroup organically, rather than jumping to predetermined coordinates. Because this is a physical regrouping, the visible silhouette may continue settling after the numeric transition duration has elapsed.

## Adding More States

State names are application-defined. Add collections at initialization time or register them later.

```js
const states = {
  home: murmurationStates.home,
  chat: murmurationStates.chat,
  results: {
    ...murmurationStates.chat,
    shape: "spiral",
    spread: 1.08,
    speed: 0.28,
    centerAttenuation: 0.72
  }
};

const murmuration = createMurmurationBackground(
  document.querySelector("#murmuration-bg"),
  { states, initialState: "home" }
);

murmuration.transitionTo("results");
```

Or add a state after initialization:

```js
murmuration.setState("results", {
  ...murmurationStates.chat,
  shape: "spiral",
  spread: 1.08
});

murmuration.transitionTo("results");
```

## Runtime API

### `createMurmurationBackground(element, options)`

Creates the canvas element, starts the animation loop, and returns a controller. The target element is made absolutely positioned and the canvas fills it.

| Option | Type | Description |
| --- | --- | --- |
| `states` | `Record<string, State>` | Named state collections. Defaults to `murmurationStates` from the downloaded module. |
| `initialState` | `string` | State shown at startup. Defaults to the first supplied state. |
| `transitionDuration` | `number` | Default transition duration in milliseconds. Default: `200`. |
| `renderer` | `"webgl2"` \| `"canvas2d"` | Backend. Defaults to `"webgl2"` with automatic Canvas 2D fallback. |
| `theme` | `"light"` \| `"dark"` | Which `colors` pair to use. Default: `"light"`. |
| Other state properties | `State` fields | One-off overrides applied on top of the initial state. |

### Controller

| Member | Description |
| --- | --- |
| `canvas` | The generated `<canvas>` element. `canvas.dataset.renderer` is `webgl2` or `canvas2d`. |
| `activeParticles` | Read-only count of particles currently simulated, after runtime limits. |
| `activeState` | Read-only name of the most recently selected state. |
| `theme`, `setTheme(name)` | Read the active theme, or switch between `"light"` and `"dark"` colors. Unknown names are ignored. |
| `transitionTo(name, duration?)` | Transitions to a registered state. Throws for an unknown name. |
| `setState(name, state)` | Adds or replaces a named state. |
| `update(options)` | Applies direct overrides to the current animation. Changing `shape` steers the flock toward the new formation, and changing `shape` or `axis` clears stale trails. An edit made during a transition becomes part of that transition's destination. Prefer named states for application screens. |
| `clear()` | Repaints the background color, discarding trails. |
| `destroy()` | Stops animation, removes listeners and the resize observer, and removes the canvas. Safe to call twice; later calls to the controller are ignored. Call on view teardown. |

## State Parameters

A state, as saved by the lab and exported, has these 14 settings plus `colors`. Keep numeric values inside the ranges; the lab enforces them and code integrations should too. Anything omitted uses the built-in default.

| Parameter | Range | Effect |
| --- | --- | --- |
| `shape` | See Shapes | Target formation. |
| `axis` | `horizontal`, `vertical`, `diagonal` | Primary orientation of the formation. |
| `formationScale` | `0.7-1.8` | Scale of the main formation. |
| `spread` | `0.35-1.4` | Horizontal and radial expansion. |
| `scatter` | `0-1.2` | Random positional variation around the formation. |
| `crest` | `0.1-1.1` | Height of waves, ridges, and flock heads. |
| `rotation` | `-35-35` | Rotation in degrees. |
| `speed` | `0-2` | Simulation speed. |
| `particles` | `2000-32000` | Particle count. Higher values increase visual density and CPU/GPU work. |
| `particleSize` | `0.35-1.8` | Canvas particle size in CSS pixels. |
| `fade` | `0.04-0.5` | Background repaint opacity per frame. Lower values leave longer trails. |
| `centerAttenuation` | `0-1` | Reduces particle opacity inside the central 70% of the viewport width. At `1`, center particles retain 5% of their unattenuated opacity. |
| `depth` | `0-1` | Per-particle opacity variation. |
| `grain` | `0-1` | Temporal opacity variation. |
| `colors` | `{ light, dark }` | One `{ particleColor, backgroundColor }` pair (CSS colors) per theme. See Light and Dark Themes. |

The runtime still understands the older fine-tuning keys (`coverage`, `ambientParticles`, `coordination`, `gathering`, `dispersal`, `reformation`, `responsiveness`, `calmness`, `turbulence`, `dataStructure`, `patternSubtlety`, `negativeSpace`, `edgeSoftness`, `arch`, `density`). The lab no longer shows or exports them and they keep the Home defaults, but an integration can still pass them through `update()` or a state. Flat `particleColor` and `backgroundColor` also still work and override the theme pair.

### Shapes

`ridge`, `wave`, `arch`, `vortex`, `veil`, `spiral`, `circle`, `flock`, `swoop`, and `split-flock` are supported values for `shape`.

Two formations are not a function of a single coordinate:

- `circle` is a flat ring facing the viewer with nothing in the middle. `spread` and `formationScale` set its radius, `scatter` loosens it, and `crest` adds a slow ripple along the circumference. It ignores `axis` and `rotation`, which cannot change a circle. Ambient particles orbit outside the ring instead of crossing the middle.
- `swoop` is a cloud that wanders across the screen, wheels, and expands and contracts like a breath, with no repeating track. `spread` and `formationScale` set its length and `crest` the ripple along its edges. `axis` and `rotation` still apply on top of its own heading.

## Light and Dark Themes

Each state stores one color pair per theme, so Home and Chat each have their own light and dark colors. The lab's Light/Dark switch only chooses which pair is shown and edited; nothing is overwritten when you switch screens or themes. The exported file carries both pairs.

```js
const murmuration = createMurmurationBackground(element, { initialState: "home", theme: "dark" });

// When the host application changes theme:
murmuration.setTheme("light");
```

`theme` is `"light"` (default) or `"dark"`. `setTheme()` re-resolves the colors of the current state, also inside a running transition, and repaints. `murmuration.theme` reads the active theme. `update({ colors })` accepts a `{ light, dark }` object and applies the active theme's pair.

## Accessibility and Reduced Motion

The animation is decorative. Keep the background container out of the accessibility tree with `aria-hidden="true"` and do not place interactive content inside it.

For users who prefer reduced motion, either pause the effect by setting `speed: 0` or do not create the instance.

```js
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const murmuration = reducedMotion
  ? null
  : createMurmurationBackground(document.querySelector("#murmuration-bg"));
```

## Performance Guidance

- The runtime caps internal canvas resolution and pauses when the document is hidden or the user prefers reduced motion.
- `particles` remains the visual-density setting in the exported configuration, but runtime quality limits it to `10000` active particles on desktop-class devices and `6000` on narrow or constrained devices. The configuration object is not changed.
- The internal canvas uses a maximum device-pixel ratio of `1` on desktop-class devices and `0.75` on constrained devices. The CSS size remains unchanged.
- Particle positions, velocity, seeds, and ambient flags use typed arrays internally to reduce garbage collection and per-frame memory overhead.
- Static random values are cached per particle and refreshed when its seed changes. This uses 64 additional bytes per allocated particle in exchange for fewer repeated calculations. A disabled center attenuation bypasses the mask calculation.
- Flicker and motion randomness are cached until their respective simulation-time intervals change, and refreshed or invalidated when a particle resets. These temporal caches add 56 bytes per allocated particle (8 for flicker, 48 for motion). They do not change the exported configuration or reduce the simulation frequency. Browser CPU savings must be measured on the target device.
- Start from the tuned `16000` particles as a visual upper bound and test the resulting active count on target hardware.
- Use one animation instance per visible page or route.
- Call `destroy()` when a screen unmounts.
- Avoid changing `particles` frequently at runtime because growing the active count can reallocate the internal particle buffers.

## Local Preview and Deploy

Open `index.html` directly, or serve the repository locally:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

GitHub Actions deploys the lab to GitHub Pages when `main` is updated.
