# Renderer Exploration Handoff

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
