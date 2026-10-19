// Canvas-compatible drawing surface for the experimental batched WebGL2 renderer.
function createParticleRenderer(original, backend = 'webgl2') {
  const fallback = () => {
    original.dataset.renderer = 'canvas2d';
    return { canvas: original, context: original.getContext('2d', { alpha: false }), backend: 'canvas2d' };
  };
  if (backend === 'canvas2d') return fallback();
  const canvas = original.cloneNode(false);
  let gl;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, depth: false, stencil: false }); }
  catch { return fallback(); }
  if (!gl) return fallback();
  let program, buffer, vao, viewportUniform, colorUniform;
  let width = 1, height = 1, scale = 1, count = 0, capacity = 0;
  let data = new Float32Array(0), destroyed = false, contextLost = false;
  let batchColor = '#000000', lastColor = '', rgb = [0, 0, 0];
  function initialize() {
    const shaders = [];
    try {
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
        precision highp float;
        layout(location=0) in vec4 rect;
        layout(location=1) in float opacity;
        uniform vec2 viewport;
        out vec4 bounds;
        out float alpha;
        void main() {
          vec2 corners[6] = vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
          vec2 low = floor(rect.xy), high = ceil(rect.xy + rect.zw);
          vec2 p = mix(low, high, corners[gl_VertexID]);
          gl_Position = vec4(p.x / viewport.x * 2.0 - 1.0, 1.0 - p.y / viewport.y * 2.0, 0, 1);
          bounds = vec4(rect.xy, rect.xy + rect.zw);
          alpha = opacity;
        }`));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        uniform vec2 viewport;
        uniform vec3 color;
        in vec4 bounds;
        in float alpha;
        out vec4 result;
        void main() {
          vec2 pixel = vec2(gl_FragCoord.x, viewport.y - gl_FragCoord.y);
          vec2 coverage = max(vec2(0), min(pixel + .5, bounds.zw) - max(pixel - .5, bounds.xy));
          result = vec4(color, alpha * coverage.x * coverage.y);
        }`));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      buffer = gl.createBuffer();
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
      gl.vertexAttribDivisor(1, 1);
      viewportUniform = gl.getUniformLocation(program, 'viewport');
      colorUniform = gl.getUniformLocation(program, 'color');
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DITHER);
      capacity = 0;
    } finally {
      shaders.forEach(shader => gl.deleteShader(shader));
    }
  }
  try { initialize(); }
  catch (error) {
    console.warn('WebGL2 initialization failed; using Canvas 2D.', error);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
    return fallback();
  }
  function flush() {
    if (!count || destroyed || gl.isContextLost()) { count = 0; return; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    if (capacity < data.length) {
      capacity = data.length;
      gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 5);
    if (batchColor !== lastColor) {
      const hex = Number.parseInt(batchColor.slice(1), 16);
      rgb = [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
      lastColor = batchColor;
    }
    gl.uniform2f(viewportUniform, canvas.width, canvas.height);
    gl.uniform3f(colorUniform, ...rgb);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    count = 0;
  }
  const context = {
    globalAlpha: 1, fillStyle: '#000000',
    setTransform(s) {
      count = 0;
      scale = s;
      width = canvas.width / s;
      height = canvas.height / s;
    },
    fillRect(x, y, w, h) {
      if (destroyed || contextLost) return;
      const background = x === 0 && y === 0 && w >= width && h >= height;
      if (count && (batchColor !== this.fillStyle || background)) flush();
      batchColor = this.fillStyle;
      if ((count + 1) * 5 > data.length) {
        const next = new Float32Array(Math.max(1024 * 5, data.length * 2));
        next.set(data); data = next;
      }
      const i = count++ * 5;
      data[i] = x * scale; data[i + 1] = y * scale;
      data[i + 2] = w * scale; data[i + 3] = h * scale;
      data[i + 4] = this.globalAlpha;
      if (background) flush();
    },
    flush,
    destroy() {
      destroyed = true;
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); gl.deleteProgram(program);
      data = new Float32Array(0);
    }
  };
  const lost = event => { event.preventDefault(); contextLost = true; count = 0; };
  const restored = () => { if (!destroyed) { initialize(); contextLost = false; } };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  if (original.parentNode) original.replaceWith(canvas);
  canvas.dataset.renderer = 'webgl2';
  return { canvas, context, backend: 'webgl2' };
}
