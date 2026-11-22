import { clearStash, stash } from "./client";

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
type Entry = { id: string; name: string; kind: string; group: string; blurb: string; accepts: string };
let index: Promise<Entry[]>;
const list = () => (index ??= fetch("/tools.json").then((r) => r.json()).catch((e) => { index = undefined; throw e; }));

// A file handed between tools is stored only for the navigation. Anything left from an interrupted one is removed here.
if (!new URLSearchParams(location.search).has("with")) clearStash().catch(() => { /* Storage may be unavailable, and then nothing was stored. */ });

// Earlier versions stored typed text with settings. Anything in the old format is deleted.
try { for (const k of Object.keys(localStorage)) if (k.startsWith("lathe:") && !/^lathe:(model|settings):/.test(k)) localStorage.removeItem(k); } catch { /* Private windows can refuse storage. */ }

// Command palette
const dlg = $<HTMLDialogElement>("dialog.palette"), input = dlg.querySelector("input"), ul = dlg.querySelector("ul");
let hits: Entry[] = [], sel = 0;
const score = (t: Entry, q: string) => {
  const name = t.name.toLowerCase(), id = t.id.replace(/-/g, " "), hay = `${name} ${id} ${t.blurb.toLowerCase()} ${t.group.toLowerCase()}`, words = q.split(/\s+/).filter(Boolean);
  if (!words.every((w) => hay.includes(w))) return 0;
  return (name === q || id === q ? 100 : 0) + (name.startsWith(q) ? 40 : 0) + words.reduce((a, w) => a + (name.includes(w) || id.includes(w) ? 10 : 1), 0) - name.length / 40;
};
const draw = () => {
  ul.replaceChildren(...hits.map((t, i) => {
    const li = document.createElement("li"), a = document.createElement("a"), s = document.createElement("small");
    li.role = "none"; a.id = `palette-${i}`; a.role = "option"; a.setAttribute("aria-selected", String(i === sel));
    a.href = `/${t.id}`; a.tabIndex = -1; a.textContent = t.name; s.textContent = t.kind === "pdf" ? `PDF, ${t.group}` : `Images, ${t.group}`; a.append(s); li.append(a); return li;
  }));
  if (hits.length) input.setAttribute("aria-activedescendant", `palette-${sel}`); else input.removeAttribute("aria-activedescendant");
  ul.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
};
const search = async () => {
  const q = input.value.trim().toLowerCase(), all = await list().catch(() => [] as Entry[]);
  hits = q ? all.map((t) => [t, score(t, q)] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 30).map((x) => x[0]) : all.slice(0, 12);
  sel = 0; draw();
};
const openPalette = () => { input.value = ""; dlg.showModal(); search(); };
input.addEventListener("input", search);
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % (hits.length || 1); draw(); }
  if (e.key === "Enter" && hits[sel]) location.href = `/${hits[sel].id}`;
});
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
document.querySelectorAll("[data-palette]").forEach((b) => b.addEventListener("click", openPalette));
addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); dlg.open ? dlg.close() : openPalette(); } });
if (/Win|Linux/.test(navigator.platform)) document.querySelectorAll("kbd").forEach((k) => (k.textContent = "Ctrl K"));
if ("serviceWorker" in navigator && !import.meta.env.DEV) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { /* Offline support is optional. A navigation can also abort registration. */ }));

// Home: the spindle, and routing a dropped file to the right tools
const spindle = $("#spindle");
if (spindle) {
  let spin = 0;
  const route = async (files: File[]) => {
    if (!files.length) return;
    const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name), pdfs = files.filter(isPdf).length, heic = files.some((f) => /\.hei[cf]$/i.test(f.name) || /hei[cf]/.test(f.type)), svg = files.every((f) => /\.svg$/i.test(f.name));
    const ids = pdfs === files.length ? (pdfs > 1 ? ["merge-pdf", "compress-pdf", "protect-pdf", "organize-pdf", "pdf-metadata", "watermark-pdf"] : ["compress-pdf", "organize-pdf", "split-pdf", "protect-pdf", "pdf-to-images", "pdf-to-text", "sign-pdf", "redact-pdf"])
      : pdfs ? ["images-to-pdf"] : svg ? ["optimize-svg", "svg-to-png", "convert-image"]
      : [...(heic ? ["heic-to-jpg", "heic-to-png"] : []), "compress-image", "convert-image", "resize-image", ...(files.length > 1 ? ["images-to-pdf", "collage", "make-gif"] : ["crop-image", "remove-background", "adjust-image", "remove-metadata", "ocr-image"])];
    if (pdfs && pdfs !== files.length) { const pics = files.filter((f) => !isPdf(f)); files = pics; }
    const all = await list(), box = $("#route");
    box.querySelector("h2").textContent = files.length === 1 ? `What should happen to ${files[0].name}?` : `What should happen to these ${files.length} files?`;
    box.querySelector(".chips").replaceChildren(...ids.map((id) => { const a = document.createElement("a"), t = all.find((x) => x.id === id); a.className = "chip"; a.href = `/${id}?with=files`; a.textContent = t.name; a.onclick = async (e) => {
      e.preventDefault();
      try { await stash(files); location.href = a.href; }
      catch { clearStash().catch(() => {}); box.querySelector(".stash-full")?.remove(); const m = document.createElement("p"); m.className = "alert stash-full"; m.role = "alert"; m.textContent = "Your browser storage is full. Open the tool first, then add your file there."; box.append(m); }
    }; return a; }));
    box.classList.add("on"); box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    spin = 1;
  };
  const inp = $<HTMLInputElement>("#home-input");
  inp.addEventListener("change", () => route([...inp.files]));
  addEventListener("dragover", (e) => { e.preventDefault(); spin = 1; });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) spin = 0; });
  addEventListener("drop", (e) => { e.preventDefault(); route([...e.dataTransfer.files]); });
  addEventListener("paste", (e) => route([...e.clipboardData.files]));
  (window as any).launchQueue?.setConsumer?.(async (p: any) => route(await Promise.all(p.files.map((h: any) => h.getFile()))));

  // The workpiece: a turned steel profile with brass collars, lit by a light that follows the pointer.
  // Compiling the shader is slow on phones, so it waits until the page has finished its first work.
  const c = spindle.querySelector("canvas"), whenIdle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  whenIdle(() => {
    const gl = c.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) return;
    const FS = `#version 300 es
precision highp float; in vec2 v; out vec4 o; uniform float T, A; uniform vec2 R, L; uniform vec3 B;
float sb(float a,float b,float x){return smoothstep(a,b,x);}
float rad(float x){ float r=.46; r-=.13*sb(.135,.15,x); r+=.09*sb(.25,.262,x)-.09*sb(.33,.342,x); r-=.08*sb(.46,.49,x); r+=.05*(1.-pow(abs(x-.62)/.13,2.))*step(abs(x-.62),.13); r+=.12*sb(.76,.772,x)-.04*sb(.87,.88,x); r-=.13*sb(.955,.97,x); r+=.012*sin(x*170.)*step(.5,fract(x*2.))*step(.49,x)*step(x,.495); return r; }
float h(float n){return fract(sin(n)*43758.5453);} float noise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(h(i),h(i+1.),f);}
bool brass(float x){return (x>.25&&x<.342)||(x>.87&&x<.955);}
void main(){ float x=v.x, y=v.y-.5, r=rad(x), e=fwidth(y)*1.2, m=1.-smoothstep(r-e,r+e,abs(y)); if(m<=0.){o=vec4(0);return;}
 float dx=.0016, s=(rad(x+dx)-rad(x-dx))/(2.*dx), ny=y/r; float nz=sqrt(max(0.,1.-ny*ny)); vec3 n=normalize(vec3(-s*ny*nz*.75,ny,nz));
 float ang=asin(clamp(ny,-1.,1.)), g=noise(x*R.x*.52+sin(ang*2.+T)*.28)*.5+noise(x*R.x*.17+7.)*.5; float cut=sin(x*R.x*.9+ang*2.)*.5+.5;
 vec3 l=normalize(vec3(L.x-x,L.y,.72)), V=vec3(0,0,1), H=normalize(l+V); vec3 tan=vec3(0,1,0); tan=normalize(tan-n*dot(n,tan)); float th=dot(tan,H), nh=max(dot(n,H),0.), sp=pow(max(0.,sqrt(max(0.,1.-th*th))),170.)*.95+pow(nh,18.)*.2;
 float pass=exp(-pow((x-fract(T*.055)*1.3+.15)/.035,2.))*A*.65; float env=.17+.72*pow(.5+.5*n.y,2.2)+.26*pow(max(0.,1.-abs(n.y-.42)*3.3),3.)+.12*pow(max(0.,-n.y),3.);
 vec3 base=brass(x)?vec3(.86,.64,.3):mix(vec3(.5,.56,.67),vec3(.72,.77,.85),g); vec3 c=base*(env*(.76+.3*g)+.05*cut)+mix(vec3(1),base,brass(x)?.55:.15)*(sp*(.68+.5*g)+pass);
 float edge=smoothstep(.035,.0,abs(s)>1.2?.0:1.), steps=smoothstep(.6,3.5,abs(s)); c*=1.-steps*.34; c+=edge*0.; c*=.68+.32*nz; c=pow(c,vec3(.92)); o=vec4(c*m,m); }`;
    const VS = `#version 300 es
in vec2 p; out vec2 v; void main(){ v=p*.5+.5; gl_Position=vec4(p,0,1); }`;
    const compile = (t: number, src: string) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const U = { T: gl.getUniformLocation(prog, "T"), A: gl.getUniformLocation(prog, "A"), R: gl.getUniformLocation(prog, "R"), L: gl.getUniformLocation(prog, "L") };
    c.style.background = "transparent"; spindle.style.background = "none";
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lx = 0.32, ly = 0.34, tx = 0.32, ty = 0.34, t = 0, a = 0, last = performance.now(), visible = true, raf = 0;
    addEventListener("pointermove", (e) => { const b = c.getBoundingClientRect(); tx = (e.clientX - b.left) / b.width; ty = Math.max(-0.4, Math.min(0.9, 0.5 - (e.clientY - b.top) / b.height)); if (still) frame(performance.now()); }, { passive: true });
    const size = () => { const k = Math.min(devicePixelRatio, 2), w = Math.round(c.clientWidth * k), h = Math.round(c.clientHeight * k); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); } };
    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; size();
      lx += (tx - lx) * Math.min(1, dt * 5); ly += (ty - ly) * Math.min(1, dt * 5); a += (spin - a) * Math.min(1, dt * 3); t += dt * (0.22 + a * 3);
      gl.uniform1f(U.T, t); gl.uniform1f(U.A, a); gl.uniform2f(U.R, c.clientWidth, c.clientHeight); gl.uniform2f(U.L, lx, ly); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame); else raf = 0;
    }
    const wake = () => { if (!raf && !still) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }).observe(c);
    document.addEventListener("visibilitychange", wake);
    addEventListener("resize", () => (still ? frame(performance.now()) : wake()));
    frame(performance.now());
  });
}
