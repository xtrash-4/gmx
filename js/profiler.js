// Frame profiler, enabled with ?profile=1 (main.js). Measures, per frame:
// - CPU time of each game system between prof.mark() calls
// - CPU time of renderPipeline.render() (scene traversal + command encoding)
// - GPU time of the frame's render passes (WebGPU timestamp queries, when the adapter supports them)
// - draw calls and triangles (renderer.info, reset by three.js at the start of every animation frame)
// Read the averages from the console: window.__perf.report()

function createProfiler(windowSize = 240) {
  const samples = new Map(); // name -> ring of ms
  const push = (name, value) => {
    let ring = samples.get(name);
    if (!ring) samples.set(name, (ring = []));
    ring.push(value);
    if (ring.length > windowSize) ring.shift();
  };

  let t0 = 0;
  let last = 0;
  let lastFrameEnd = 0;
  let gpuPending = false;

  const prof = {
    start() {
      t0 = last = performance.now();
    },
    mark(name) {
      const now = performance.now();
      push(name, now - last);
      last = now;
    },
    endFrame(renderer, renderScale) {
      const now = performance.now();
      push('render (CPU)', now - last);
      push('CPU total', now - t0);
      if (lastFrameEnd) push('frame interval', now - lastFrameEnd);
      lastFrameEnd = now;
      const info = renderer.info.render;
      push('draw calls', info.drawCalls);
      push('triangles (k)', info.triangles / 1000);
      push('render scale', renderScale);
      // One GPU timing query in flight at a time
      if (renderer.backend.trackTimestamp && !gpuPending) {
        gpuPending = true;
        renderer.resolveTimestampsAsync('render').then((ms) => {
          if (Number.isFinite(ms) && ms > 0) push('GPU (ms)', ms);
        }).catch(() => {}).finally(() => { gpuPending = false; });
      }
    },
    report() {
      const out = {};
      for (const [name, ring] of samples) {
        if (!ring.length) continue;
        const sorted = [...ring].sort((a, b) => a - b);
        const avg = ring.reduce((a, b) => a + b, 0) / ring.length;
        out[name] = {
          avg: Math.round(avg * 100) / 100,
          p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
          n: ring.length
        };
      }
      return out;
    },
    reset() {
      samples.clear();
    }
  };
  globalThis.__perf = prof;
  return prof;
}

export { createProfiler };
