# Renderer Exploration Handoff

## Single Runtime Refactor

The editor preview and the exported module now share one runtime
(`murmuration-runtime.js`). The duplicated simulation that used to live in `index.html`
was removed. `tests/runtime-cache.cjs` compares the new runtime against the pre-refactor
editor (commit `a0f4cf9`) draw call by draw call, so any behavior change shows up as a
failing hash. See the README "Architecture" section for the file layout and the
self-containment rule that Download JS depends on.

## WebGL2 Release Update

WebGL2 has been approved as the default renderer, with automatic Canvas 2D fallback
when initialization is unavailable. CPU simulation and the preset schema are unchanged.
Browser tests cover actual Copy, Download JS import, preview-link round trips, and
fallback; run `tests/export-browser.cjs` with Playwright and the local server.
Particle recycling now seeds from the stable particle index rather than multiplying
the previous seed repeatedly, avoiding unbounded seed growth during long sessions.
The exploration notes below describe the original plan, now implemented for rendering.

The optimized Canvas 2D version is the approved baseline. Keep its visual behavior,
named Home/Chat states, organic transitions, and export API intact.

## Next Session

- Explore a native WebGL2 renderer on a new branch, retaining Canvas 2D as a fallback.
- First compare rendering the same CPU-simulated particles in one batched GPU draw.
  Moving simulation to GPU shaders is a separate experiment, not an assumed improvement.
- Consider OffscreenCanvas with a worker separately: freeing the main thread does
  not necessarily reduce total CPU usage or power consumption.
- Keep configuration files unchanged and avoid adding a large runtime dependency.
- Compare identical configurations and viewports with only one animation open.
  Measure sustained CPU, frame times, memory, and responsiveness alongside real UI.
- Validate all shapes, Home/Chat transitions, shared links, Copy, and Download JS.

## Baseline Validation

Run `node tests/runtime-cache.cjs` from the repository root. Tests cover deterministic
Canvas draw parity against commit `1887661`, cache invalidation, attenuation edges,
particle count changes, and listener/RAF cleanup in a simulated DOM environment.
They do not replace browser visual checks or performance measurements.

Recent user screenshots showed lower CPU than the online version, but these are
single samples with different frame/listener counts, not controlled benchmarks.
Manual offscreen drawing culling was tried and removed after reported CPU regression.
