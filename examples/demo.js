import { createReporter } from '/reporter/index.js';

const reporter = createReporter();
const canvas = document.querySelector('canvas');
let animation = 0;
let draw;
reporter.onStart(async ({ params }) => {
  reporter.phaseStart('load');
  canvas.width = 960;
  canvas.height = 540;
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is unavailable');
  reporter.phaseEnd('load');
  reporter.phaseStart('process');
  const block = (ms) => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      /* deliberate jank */
    }
  };
  if (params?.janky) block(350);
  const vertices = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
  ]);
  reporter.phaseEnd('process');
  reporter.phaseStart('compile');
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(
    program,
    compile(
      gl.VERTEX_SHADER,
      `#version 300 es
  in vec3 position; uniform float angle; out vec3 color;
  void main(){float c=cos(angle),s=sin(angle);vec3 p=mat3(c,0.,-s,0.,1.,0.,s,0.,c)*position;p=mat3(1.,0.,0.,0.,.8,.6,0.,-.6,.8)*p;gl_Position=vec4(p.x*.45,p.y*.8,p.z*.2,3.+p.z*.3);color=position*.3+.6;}`,
    ),
  );
  gl.attachShader(
    program,
    compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
  precision highp float; in vec3 color; out vec4 outColor; void main(){outColor=vec4(color,1.);}`,
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.enable(gl.DEPTH_TEST);
  const angle = gl.getUniformLocation(program, 'angle');
  let frame = 0;
  const started = performance.now();
  draw = () => {
    const token = reporter.frameBegin({ animationTime: (performance.now() - started) / 1000 });
    if (params?.janky && ++frame % 40 === 0) block(80);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.027, 0.063, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(angle, (performance.now() - started) / 1000);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    reporter.frameEnd(token);
  };
  draw();
  gl.finish();
  reporter.phaseEnd('compile');
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  reporter.environment({
    api: 'webgl2',
    canvasSize: { width: canvas.width, height: canvas.height },
    gpuAdapter: {
      description: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    },
  });
  reporter.ready();
  const tick = () => {
    draw();
    animation = requestAnimationFrame(tick);
  };
  animation = requestAnimationFrame(tick);
});
reporter.onCapture(() => {
  draw();
  return canvas;
});
window.addEventListener(
  'pagehide',
  () => {
    cancelAnimationFrame(animation);
    reporter.dispose();
  },
  { once: true },
);
