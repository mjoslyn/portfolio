// Floating partial-width shaders + scroll reveals.
// Each .shaderbay gets its own WebGL fragment shader (psychedelic plasma),
// seeded differently so no two read the same. CSS gradient fallback if WebGL is gone.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ───────────── scroll reveals ───────────── */
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* ───────────── floating shaders ───────────── */
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;

// Inigo Quilez cosine palette
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){
  return a + b * cos(6.28318 * (c * t + d));
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float t = u_time * 0.18 + u_seed * 10.0;

  float v = 0.0;
  v += sin((p.x * 3.0 + t));
  v += sin((p.y * 4.0 - t * 0.8 + u_seed));
  v += sin((p.x + p.y) * 3.5 + t * 0.6);
  v += sin(length(p - vec2(sin(t*0.5), cos(t*0.4)) * 0.3) * 8.0 - t);
  v = v / 4.0;

  vec3 col = pal(
    v + u_seed,
    vec3(0.5),
    vec3(0.5),
    vec3(1.0, 1.0, 1.0),
    vec3(0.0 + u_seed, 0.33, 0.67)
  );

  // print-fuzz: scanline + grain so it matches the featured fields
  float scan = sin(gl_FragCoord.y * 1.4) * 0.04;
  float grain = fract(sin(dot(gl_FragCoord.xy + u_seed, vec2(12.9898, 78.233))) * 43758.5453) * 0.08;
  col += scan + grain - 0.04;

  // soft vignette toward the edges
  float vig = smoothstep(1.1, 0.2, length(uv - 0.5));
  gl_FragColor = vec4(col * vig, 1.0);
}`;

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function fallback(bay) {
  const seed = Number(bay.dataset.shader) || 0;
  const hue = (seed * 67) % 360;
  const d = document.createElement("div");
  d.style.cssText = `position:absolute;height:100%;border:1px solid var(--line);
    mix-blend-mode:screen;opacity:.6;`;
  d.style.background = `conic-gradient(from ${hue}deg, #ff3d9a, #34e0e8, #ffb648, #ff3d9a)`;
  // match the css positioning the canvas would have used
  if (bay.classList.contains("shaderbay--right")) { d.style.right = "-4vw"; d.style.width = "46%"; d.style.top = "-10%"; }
  else if (bay.classList.contains("shaderbay--left")) { d.style.left = "-4vw"; d.style.width = "40%"; d.style.top = "8%"; }
  else { d.style.left = "22%"; d.style.width = "38%"; d.style.top = "-6%"; }
  bay.appendChild(d);
}

const canvases = [];

function initBay(bay) {
  const canvas = document.createElement("canvas");
  bay.appendChild(canvas);
  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) {
    canvas.remove();
    fallback(bay);
    return;
  }
  const prog = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) {
    canvas.remove();
    fallback(bay);
    return;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uSeed = gl.getUniformLocation(prog, "u_seed");
  const seed = (Number(bay.dataset.shader) || 0) * 0.37 + 0.11;

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = bay.clientWidth || 400;
    const h = bay.clientHeight || 200;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  size();
  window.addEventListener("resize", size);

  canvases.push({ gl, prog, uRes, uTime, uSeed, seed, canvas, bay });
}

let visible = true;
const visObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const c = canvases.find((c) => c.bay === e.target);
    if (c) c.onscreen = e.isIntersecting;
  }
});

document.querySelectorAll(".shaderbay").forEach(initBay);
canvases.forEach((c) => visObserver.observe(c.bay));

if (canvases.length && !reduceMotion) {
  let start = performance.now();
  function frame(now) {
    const t = (now - start) / 1000;
    for (const c of canvases) {
      if (c.onscreen === false) continue;
      const { gl } = c;
      gl.useProgram(c.prog);
      gl.uniform2f(c.uRes, c.canvas.width, c.canvas.height);
      gl.uniform1f(c.uTime, t);
      gl.uniform1f(c.uSeed, c.seed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} else {
  // draw a single static frame so the bays are not empty
  for (const c of canvases) {
    const { gl } = c;
    gl.uniform2f(c.uRes, c.canvas.width, c.canvas.height);
    gl.uniform1f(c.uTime, c.seed * 3.0);
    gl.uniform1f(c.uSeed, c.seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
