// Video export for the Ball Field lab (editor only; not part of Download JS).
// Records exactly one loop of one screen, background only: a separate runtime renders into an
// off-screen canvas at the chosen size, so no editor UI can appear in the video.
//
// Two methods, so they can be compared:
// - "realtime":  MediaRecorder captures the canvas while the loop plays in real time.
//                Simple, but frame timing follows the machine and the container depends on the browser.
// - "frames":    WebCodecs renders and encodes every frame at an exact loop position, then mp4-muxer
//                writes an H.264 MP4. Frame-perfect at any size; needs VideoEncoder support.

const VIDEO_SIZES = {
  '720p': { label: '1280 × 720', width: 1280, height: 720, pixelRatio: 1 },
  '1080p': { label: '1920 × 1080', width: 1920, height: 1080, pixelRatio: 1 },
  '4k': { label: '3840 × 2160 (4K)', width: 3840, height: 2160, pixelRatio: 2 },
  vertical: { label: '1080 × 1920 (vertical)', width: 1080, height: 1920, pixelRatio: 1 },
  square: { label: '1080 × 1080 (square)', width: 1080, height: 1080, pixelRatio: 1 }
};

// Dense fields of small dots are hard to compress, so bitrates are generous.
const bitrateFor = (width, height, fps) => Math.round(width * height * fps * 0.35);

function videoSupport() {
  const recorderTypes = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const recorderType = typeof MediaRecorder === 'function'
    ? recorderTypes.find(type => MediaRecorder.isTypeSupported(type)) || ''
    : '';
  return {
    realtime: !!recorderType && typeof HTMLCanvasElement.prototype.captureStream === 'function',
    recorderType,
    frames: typeof VideoEncoder === 'function' && typeof VideoFrame === 'function' && typeof Mp4Muxer === 'object'
  };
}

// An off-screen runtime with one state, sized to the output (CSS size × fixed pixel ratio).
function createRecordingField(settings, theme, size, playing) {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed', left: '0', top: '0', width: `${size.width / size.pixelRatio}px`, height: `${size.height / size.pixelRatio}px`,
    opacity: '0', pointerEvents: 'none', zIndex: '-10', isolation: 'isolate', overflow: 'hidden'
  });
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const field = createBallFieldRuntime(host, {
    states: { recording: { ...settings, playing } }, initialState: 'recording', theme,
    pixelRatio: size.pixelRatio, respectReducedMotion: false
  });
  return { field, dispose() { field.destroy(); host.remove(); } };
}

async function recordFrames({ settings, theme, size, fps, onProgress, signal }) {
  const { width, height } = size;
  const bitrate = bitrateFor(width, height, fps);
  // H.264 High profile; level 5.1 for 4K, 4.0 for 1080p and below. Fall back to Main and Baseline.
  // VP9 in MP4 is the fallback for browsers without an H.264 encoder (it plays in Chrome and Firefox,
  // not in QuickTime).
  const big = width * height > 1920 * 1088;
  const codecs = [
    ...(big ? ['avc1.640033', 'avc1.4d0033'] : ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']).map(codec => ({ codec, muxCodec: 'avc', avc: { format: 'avc' } })),
    { codec: big ? 'vp09.00.51.08' : 'vp09.00.41.08', muxCodec: 'vp9' }
  ];
  let config = null, muxCodec = '';
  for (const option of codecs) {
    const candidate = { codec: option.codec, width, height, bitrate, framerate: fps, latencyMode: 'quality', ...(option.avc ? { avc: option.avc } : {}) };
    const result = await VideoEncoder.isConfigSupported(candidate).catch(() => ({ supported: false }));
    if (result.supported) { config = candidate; muxCodec = option.muxCodec; break; }
  }
  if (!config) throw new Error('This browser cannot encode H.264 or VP9 at this size. Try a smaller size or the real-time method.');

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: muxCodec, width, height, frameRate: fps },
    fastStart: 'in-memory'
  });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: error => { encodeError = error; }
  });
  encoder.configure(config);

  const recording = createRecordingField(settings, theme, size, false);
  const total = Math.max(1, Math.round(settings.loopLength * fps));
  const frameDuration = 1e6 / fps;
  try {
    await new Promise(r => requestAnimationFrame(r)); // let the off-screen canvas size itself
    for (let i = 0; i < total; i++) {
      if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      // Frame i shows loop position i / total, so the last frame leads straight back into the first.
      const canvas = recording.field.renderAt(i / total);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDuration), duration: Math.round(frameDuration) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
      if (i % 4 === 0) { onProgress && onProgress(i / total); await new Promise(r => setTimeout(r, 0)); }
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    onProgress && onProgress(1);
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), extension: 'mp4', codec: config.codec, frames: total };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    recording.dispose();
  }
}

async function recordRealtime({ settings, theme, size, fps, onProgress, signal, recorderType }) {
  const recording = createRecordingField(settings, theme, size, true);
  const stream = recording.field.canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: recorderType, videoBitsPerSecond: bitrateFor(size.width, size.height, fps) });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
  const duration = settings.loopLength * 1000;
  try {
    await new Promise(r => requestAnimationFrame(r));
    const done = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error('Recording failed'));
    });
    recording.field.seek(0);
    recorder.start(250);
    const started = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - started;
        onProgress && onProgress(Math.min(1, elapsed / duration));
        if (signal && signal.aborted) { clearInterval(timer); reject(new DOMException('Export cancelled', 'AbortError')); }
        else if (elapsed >= duration) { clearInterval(timer); resolve(); }
      }, 50);
    });
    recorder.stop();
    await done;
    const type = recorder.mimeType || recorderType;
    return { blob: new Blob(chunks, { type }), extension: type.includes('mp4') ? 'mp4' : 'webm', codec: type };
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach(track => track.stop());
    recording.dispose();
  }
}

async function exportBallFieldVideo({ method, settings, theme, sizeKey, fps, onProgress, signal }) {
  const support = videoSupport();
  const size = VIDEO_SIZES[sizeKey] || VIDEO_SIZES['1080p'];
  const options = { settings, theme, size, fps, onProgress, signal };
  const started = performance.now();
  let result;
  if (method === 'frames') {
    if (!support.frames) throw new Error('Frame-by-frame export needs WebCodecs (recent Chrome, Edge or Safari).');
    result = await recordFrames(options);
  } else {
    if (!support.realtime) throw new Error('This browser cannot record the canvas in real time.');
    result = await recordRealtime({ ...options, recorderType: support.recorderType });
  }
  return { ...result, seconds: (performance.now() - started) / 1000, size, fps };
}
