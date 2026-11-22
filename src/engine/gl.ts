// One shader serves the photo editor, the film looks and the colour vision simulator.
const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv=vec2(p.x*.5+.5,.5-p.y*.5); gl_Position=vec4(p,0,1); }`;
const FS = `#version 300 es
precision highp float; in vec2 uv; out vec4 o; uniform sampler2D t; uniform vec2 px;
uniform float exposure,contrast,highlights,shadows,temperature,tint,saturation,vibrance,sharpen,vignette,grain; uniform mat3 cvd;
vec3 lin(vec3 c){ return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c)); }
vec3 srgb(vec3 c){ c=clamp(c,0.,1.); return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c)); }
float luma(vec3 c){ return dot(c,vec3(.2126,.7152,.0722)); }
float rnd(vec2 v){ return fract(sin(dot(v,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec4 s=texture(t,uv); float a=s.a; vec3 c=a>0.?s.rgb/a:s.rgb;
  if(sharpen>0.){ vec3 b=(texture(t,uv+vec2(px.x,0)).rgb+texture(t,uv-vec2(px.x,0)).rgb+texture(t,uv+vec2(0,px.y)).rgb+texture(t,uv-vec2(0,px.y)).rgb)*.25; c+=(s.rgb-b)*sharpen*2.5; }
  c=lin(clamp(c,0.,1.)); c*=pow(2.,exposure); c*=vec3(1.+temperature*.28,1.-abs(temperature)*.03-tint*.2,1.-temperature*.28)+vec3(tint*.1,0,tint*.1);
  float l=luma(c); c+=c*shadows*.9*pow(1.-clamp(l*2.2,0.,1.),2.); c+=c*highlights*.6*smoothstep(.35,1.,l);
  c=srgb(c); c=(c-.5)*(contrast>=0.?1.+contrast*1.4:1.+contrast*.85)+.5; c=clamp(c,0.,1.);
  l=luma(c); float m=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)); c=mix(vec3(l),c,1.+saturation+vibrance*(1.-m)*1.1);
  if(vignette>0.){ vec2 d=uv-.5; c*=1.-vignette*smoothstep(.25,.8,length(d)*1.25); }
  if(grain>0.){ c+=(rnd(uv*vec2(1./px.x,1./px.y))-.5)*grain*.22; }
  c=srgb(cvd*lin(clamp(c,0.,1.))); o=vec4(c*a,a);
}`;

export const CVD: Record<string, number[]> = {
  none: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  achromatopsia: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
};
export const LOOKS: Record<string, Record<string, number>> = {
  portra: { exposure: 0.08, contrast: -8, shadows: 18, highlights: -14, temperature: 14, tint: 3, saturation: -6, vibrance: 14, grain: 10 },
  velvia: { contrast: 22, saturation: 26, vibrance: 22, shadows: -6, temperature: 3 },
  "tri-x": { contrast: 26, saturation: -100, shadows: 8, grain: 24 },
  noir: { contrast: 58, saturation: -100, exposure: -0.15, vignette: 45, grain: 14 },
  fade: { contrast: -24, shadows: 34, highlights: -18, saturation: -18, temperature: 5 },
  teal: { contrast: 14, temperature: -8, tint: -6, vibrance: 28, highlights: -10, shadows: 10 },
  cool: { temperature: -24, exposure: 0.06, contrast: 6, saturation: -6 },
  sepia: { saturation: -78, temperature: 58, tint: 6, contrast: 4, vignette: 14 },
};

let gl: WebGL2RenderingContext, prog: WebGLProgram, canvas: OffscreenCanvas;
function setup() {
  canvas = new OffscreenCanvas(1, 1);
  gl = canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true }) as WebGL2RenderingContext;
  if (!gl) return;
  const sh = (type: number, src: string) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.bindAttribLocation(prog, 0, "p"); gl.linkProgram(prog); gl.useProgram(prog);
  gl.vertexAttribPointer(gl.getAttribLocation(prog, "p"), 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
}

const toLinear = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => { c = c < 0 ? 0 : c > 1 ? 1 : c; return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; };
const unit = (c: number) => (c < 0 ? 0 : c > 1 ? 1 : c);
const smooth = (a: number, z: number, x: number) => { const t = unit((x - a) / (z - a)); return t * t * (3 - 2 * t); };

/** The fragment shader above, line for line, for browsers without WebGL2. */
function shadeCpu(img: ImageData, v: Record<string, number>, cvd: string): ImageData {
  const { width: w, height: h, data: d } = img, out = new Uint8ClampedArray(d.length), m = CVD[cvd], gain = 2 ** (v.exposure ?? 0);
  const [contrast, highlights, shadows, temp, tint, sat, vib, sharpen, vignette, grain] = ["contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance", "sharpen", "vignette", "grain"].map((k) => (v[k] ?? 0) / 100);
  const wr = 1 + temp * 0.28 + tint * 0.1, wg = 1 - Math.abs(temp) * 0.03 - tint * 0.2, wb = 1 - temp * 0.28 + tint * 0.1, slope = contrast >= 0 ? 1 + contrast * 1.4 : 1 + contrast * 0.85;
  const pre = (i: number, c: number) => (d[i + c] * d[i + 3]) / 65025;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    let r: number, g: number, b: number;
    if (sharpen > 0) {
      const l = x ? i - 4 : i, e = x < w - 1 ? i + 4 : i, u = y ? i - w * 4 : i, n = y < h - 1 ? i + w * 4 : i, q = sharpen * 2.5;
      const edge = (c: number) => d[i + c] / 255 + (pre(i, c) - (pre(l, c) + pre(e, c) + pre(u, c) + pre(n, c)) * 0.25) * q;
      r = linear(unit(edge(0))); g = linear(unit(edge(1))); b = linear(unit(edge(2)));
    } else { r = toLinear[d[i]]; g = toLinear[d[i + 1]]; b = toLinear[d[i + 2]]; }
    r *= gain * wr; g *= gain * wg; b *= gain * wb;
    let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const dark = 1 - unit(l * 2.2), lift = 1 + shadows * 0.9 * dark * dark + highlights * 0.6 * smooth(0.35, 1, l);
    r = unit((gamma(r * lift) - 0.5) * slope + 0.5); g = unit((gamma(g * lift) - 0.5) * slope + 0.5); b = unit((gamma(b * lift) - 0.5) * slope + 0.5);
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = 1 + sat + vib * (1 - (Math.max(r, g, b) - Math.min(r, g, b))) * 1.1;
    r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
    if (vignette > 0) { const f = 1 - vignette * smooth(0.25, 0.8, Math.hypot((x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5) * 1.25); r *= f; g *= f; b *= f; }
    if (grain > 0) { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, t = (s - Math.floor(s) - 0.5) * grain * 0.22; r += t; g += t; b += t; }
    const R = linear(unit(r)), G = linear(unit(g)), B = linear(unit(b));
    out[i] = gamma(m[0] * R + m[1] * G + m[2] * B) * 255 + 0.5; out[i + 1] = gamma(m[3] * R + m[4] * G + m[5] * B) * 255 + 0.5; out[i + 2] = gamma(m[6] * R + m[7] * G + m[8] * B) * 255 + 0.5; out[i + 3] = d[i + 3];
  }
  return new ImageData(out, w, h);
}

export function shade(img: ImageData, v: Record<string, number>, cvd = "none"): ImageData {
  if (!gl) setup();
  const { width: w, height: h } = img;
  // No WebGL2, or an image larger than the GPU accepts: the same maths runs on the CPU.
  if (!gl || w > gl.getParameter(gl.MAX_TEXTURE_SIZE) || h > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return shadeCpu(img, v, cvd);
  canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length));
  const u = (n: string) => gl.getUniformLocation(prog, n);
  gl.uniform2f(u("px"), 1 / w, 1 / h);
  for (const k of ["contrast", "highlights", "shadows", "temperature", "tint", "saturation", "vibrance", "sharpen", "vignette", "grain"]) gl.uniform1f(u(k), (v[k] ?? 0) / 100);
  gl.uniform1f(u("exposure"), v.exposure ?? 0);
  gl.uniformMatrix3fv(u("cvd"), true, CVD[cvd]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = new Uint8ClampedArray(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  // readPixels is bottom-up and premultiplied.
  const row = w * 4, tmp = new Uint8ClampedArray(row);
  for (let y = 0; y < h >> 1; y++) { const a = y * row, b = (h - 1 - y) * row; tmp.set(out.subarray(a, a + row)); out.copyWithin(a, b, b + row); out.set(tmp, b); }
  for (let i = 0; i < out.length; i += 4) { const al = out[i + 3]; if (al && al < 255) { const f = 255 / al; out[i] *= f; out[i + 1] *= f; out[i + 2] *= f; } }
  return new ImageData(out, w, h);
}
