# Ball Field Lab (v2)

Two effects, chosen with the Effect control (or `settings.effect`):

- **Ball Action** (`ballAction`, default): reproduces the reference prototype's grid effect.
- **Organic** (`organic`): the first v2 motion, with waves that travel across the sheet and a twist
  around the vertical axis.

Each effect is a preset in `BALL_FIELD_EFFECTS`; switching effect loads its preset.

`maxBallSize` (CSS px) softly caps the on-screen diameter, so balls passing close to the camera
stop growing. Defaults: 2.5 px for Ball Action, 7 px for Organic.

`centerAttenuation` (0 to 1) uses v1's mask: balls fade between 25% and 75% of the screen width,
easing out to 15% and 85%; at 1 they keep 5% opacity. It is kept when switching effect.

A grid of balls placed in 3D and bent by scatter, displace, twist and rotation, looping seamlessly.
Inspired by a colleague's "Ball Action" prototype; reimplemented from scratch (no code reused) because
that version draws every ball on the CPU with Canvas 2D and reaches about 7 fps at 67,600 balls.

Open `v2/index.html` through a local server (for example `npx serve .` from the repo root).
`?renderer=canvas2d` forces the fallback.

## Why it is fast

- Every ball position is a closed-form function of (ball index, loop progress). The whole simulation
  runs in the vertex shader; the CPU sets a few uniforms and issues one instanced draw per frame.
- No per-ball buffers: grid position and random seeds come from `gl_InstanceID`, so changing the grid
  spacing costs nothing.
- No trails, no `preserveDrawingBuffer`, no depth buffer, no sorting (all balls share one color).
- Rendering stops while paused, while the tab is hidden, and under `prefers-reduced-motion`
  (the lab overrides the last one).
- Device pixel ratio is capped at 2.

Measured in headless Chromium (software WebGL, so frame rate there is not meaningful): our frame code
takes about 0.1 to 0.3 ms of main-thread CPU for 67,600 balls. Real CPU, GPU and power use on your
machine still need measuring in Activity Monitor or the browser's performance panel.

## Files

| File | Responsibility |
| --- | --- |
| `ball-field-runtime.js` | `createBallFieldRuntime()` and `BALL_FIELD_DEFAULTS`. Self-contained (serialized by Download JS). |
| `ball-field-export.js` | Builds the downloadable `ball-field-background.js` module. |
| `index.html` | Editor: controls, share link (`#s=`), wheel/pinch zoom, Download JS. |

Runtime API: `update(settings)`, `setTheme('light'|'dark')`, `play()`, `pause()`, `seek(0..1)`,
`stats()`, `destroy()`.

## Differences from the reference

- Displace, twist, rotation, ball size and camera distance follow measurements of the reference
  (ball positions captured from its canvas draw calls), so the same slider values give the same shapes.
  Framing differs: v2 scales the flat sheet to cover the screen, so it appears about 1.35x larger.
- Red, Green, Blue and Brightness properties need a source image and are not implemented yet.
- Rotation axes `X15Z` and `XY15Z` are not implemented.
- The Canvas 2D fallback caps drawing at about 9,000 balls and draws squares.

## Tests

`node tests/ball-field-browser.cjs` (Playwright with Chromium): backend, ball count, console errors,
frame CPU, loop closure, share link round trip, exported module, fallback, phone layout.
