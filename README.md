# Murmuration Background

Murmuration Background is a dependency-free Canvas 2D animation for web application backgrounds. It renders a field of particles that behaves like a flock and can reorganize between named visual states.

The lab at [www.neybarao.com/murmuration](https://www.neybarao.com/murmuration/) is the source of truth for visual tuning. Use **Download JS** to generate a self-contained ES module with the current `home` and `chat` state collections.

## What the Download Contains

The downloaded `murmuration-background.js` exports:

- `murmurationStates`: the tuned `home` and `chat` state collections.
- `defaultTransitionDuration`: the duration selected in the lab, in milliseconds.
- `createMurmurationBackground()`: creates and controls a Canvas instance.

The exported runtime does not include the lab-only `theme` or `overlay` settings. Those belong to the host application UI, not the background animation.

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

Creates the Canvas element, starts the animation loop, and returns a controller.

| Option | Type | Description |
| --- | --- | --- |
| `states` | `Record<string, State>` | Named state collections. Defaults to `murmurationStates` from the downloaded module. |
| `initialState` | `string` | State shown at startup. Defaults to the first supplied state. |
| `transitionDuration` | `number` | Default transition duration in milliseconds. Default: `200`. |
| Other state properties | `State` fields | One-off overrides applied on top of the initial state. |

### Controller

| Member | Description |
| --- | --- |
| `canvas` | The generated `<canvas>` element. |
| `activeState` | Read-only name of the most recently selected state. |
| `transitionTo(name, duration?)` | Transitions to a registered state. Throws for an unknown name. |
| `setState(name, state)` | Adds or replaces a named state. |
| `update(options)` | Applies direct overrides to the current animation. Prefer named states for application screens. |
| `destroy()` | Stops animation, removes listeners, and removes the canvas. Call on view teardown. |

## State Parameters

All numeric controls should remain within the ranges below. The lab enforces these bounds; code integrations should do the same.

### Core

| Parameter | Range | Effect |
| --- | --- | --- |
| `particles` | `2000-32000` | Particle count. Higher values increase visual density and CPU/GPU work. |
| `speed` | `0-2` | Simulation speed. |
| `rotation` | `-35-35` | Rotation in degrees. |
| `axis` | `horizontal`, `vertical`, `diagonal` | Primary orientation of the formation. |
| `shape` | See Shapes | Target formation. |
| `coverage` | `0-1` | Overall occupied area and ambient drift. |
| `formationScale` | `0.7-1.8` | Scale of the main formation. |
| `ambientParticles` | `0-0.75` | Proportion of particles that float outside the main formation. |
| `spread` | `0.35-1.4` | Horizontal and radial expansion. |
| `scatter` | `0-1.2` | Random positional variation around the formation. |

### Swarm Behavior

| Parameter | Range | Effect |
| --- | --- | --- |
| `coordination` | `0-1` | Velocity damping and flock cohesion. |
| `gathering` | `0-1` | Pull toward the formation. |
| `dispersal` | `0-1` | Periodic expansion of the formation. |
| `reformation` | `0-1` | Attraction back toward each particle target. |
| `responsiveness` | `0-1` | Sensitivity to flow and target movement. |
| `calmness` | `0-1` | Reduces motion noise and turbulence. |

### Pattern

| Parameter | Range | Effect |
| --- | --- | --- |
| `turbulence` | `0-1.4` | Flow-field variation. |
| `dataStructure` | `0-1` | Quantizes particle paths into more legible bands. |
| `patternSubtlety` | `0-1` | Controls the prominence of the main crest. |
| `negativeSpace` | `0-1` | Creates gaps in the center of the formation. |
| `edgeSoftness` | `0-1` | Softens density changes at formation edges. |
| `crest` | `0.1-1.1` | Height of waves, ridges, and flock heads. |
| `arch` | `0.1-1.1` | Opening and curvature of the formation. |
| `density` | `0.1-1` | Thickness of the particle band. |

### Visual

| Parameter | Range | Effect |
| --- | --- | --- |
| `particleSize` | `0.35-1.8` | Canvas particle size in CSS pixels. |
| `fade` | `0.04-0.5` | Background repaint opacity per frame. Lower values leave longer trails. |
| `centerAttenuation` | `0-1` | Reduces particle opacity inside the central 70% of the viewport width. At `1`, center particles retain 5% of their unattenuated opacity. |
| `depth` | `0-1` | Per-particle opacity variation. |
| `grain` | `0-1` | Temporal opacity variation. |
| `particleColor` | CSS color string | Particle fill color. |
| `backgroundColor` | CSS color string | Canvas background color. |

### Shapes

`ridge`, `wave`, `arch`, `vortex`, `veil`, `spiral`, `circle`, `flock`, `swoop`, and `split-flock` are supported values for `shape`.

## Light and Dark Host Themes

Theme is intentionally controlled by the host application. Apply colors in each state when a theme changes, then transition or update the animation.

```js
const lightColors = {
  backgroundColor: "#FFFFFF",
  particleColor: "#C2C2C2"
};

const darkColors = {
  backgroundColor: "#000000",
  particleColor: "#737373"
};

murmuration.update(darkColors);
```

For state-specific colors, merge the colors into the relevant state before calling `transitionTo()`.

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

- Start from the tuned `16000` particles only on desktop-class targets.
- Use `6000-10000` particles for constrained devices and test on target hardware.
- Use one animation instance per visible page or route.
- Call `destroy()` when a screen unmounts.
- Avoid changing `particles` frequently at runtime because it reallocates the particle collection.

## Local Preview and Deploy

Open `index.html` directly, or serve the repository locally:

```bash
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

GitHub Actions deploys the lab to GitHub Pages when `main` is updated.
