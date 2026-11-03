// Hero seam: as the page scrolls, the bottom band of the hero photo dissolves into a grid of
// monospaced glyphs that spell the camba vocabulary; each glyph takes the colour of the photo under it.
// Own implementation in three.js of the idea behind Codrops' "Typeset" seam (studied, not copied).
import {
  CanvasTexture,
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector4,
  WebGLRenderer,
  type IUniform,
} from 'three';
import { gsap, reduced } from './motion';

export interface SeamOptions {
  host: HTMLElement; // absolutely positioned strip inside the hero (we size and place it)
  hero: HTMLElement; // the 100svh hero box
  img: HTMLImageElement; // the hero photo (object-fit: cover)
  text: string; // what the grid spells, in caps
  fontFamily: string;
  paper: string; // page background colour
  ink: string;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uRes;        // strip size in css px
  uniform vec2 uCell;       // cell size in css px
  uniform float uRowsAbove; // rows above the hero edge
  uniform float uRowsBelow; // rows below the edge (on the page)
  uniform float uCols;
  uniform float uProgress;  // 0..1 travel of the edge up the screen
  uniform float uTravel;    // px
  uniform float uVelocity;  // px/s, smoothed
  uniform sampler2D uAtlas; // glyphs in one row, white on transparent
  uniform float uAtlasCount;
  uniform sampler2D uText;  // glyph indices in the red channel, 1 px tall
  uniform float uTextLen;
  uniform sampler2D uPhoto;
  uniform vec4 uPhotoRect;  // x, y, w, h of the cover-fitted photo, relative to the strip top-left (css px)
  uniform float uStripTop;  // strip top inside the hero (css px)
  uniform float uHeroH;
  uniform vec3 uPaper;
  uniform vec3 uInk;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  // Same veil the CSS gradient applies over the hero photo so tinted glyphs match the picture.
  float veil(float t) {
    float a = mix(0.34, 0.16, clamp(t / 0.6, 0.0, 1.0));
    float b = mix(0.16, 0.48, clamp((t - 0.6) / 0.4, 0.0, 1.0));
    return t < 0.6 ? a : b;
  }
  vec3 photoAt(vec2 p) {
    vec2 uv = (p - uPhotoRect.xy) / uPhotoRect.zw;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return uPaper;
    vec3 c = texture(uPhoto, uv).rgb;
    float t = clamp((uStripTop + p.y) / uHeroH, 0.0, 1.0);
    return mix(c, vec3(0.0), veil(t));
  }

  void main() {
    vec2 px = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y); // y down from the strip top
    vec2 cell = floor(px / uCell);
    float row = cell.y;
    float col = cell.x;
    if (col >= uCols) discard;
    // depth: 0 = row touching the edge from above; rows below the edge are negative; plus rowsBelow offset
    float depthIdx = (uRowsAbove - 1.0 - row) + uRowsBelow;
    float totalRows = uRowsAbove + uRowsBelow;
    float fade = clamp(uProgress / 0.05, 0.0, 1.0);
    float n = (vnoise(cell * vec2(0.35, 0.6)) - 0.5) * 8.0 * fade;
    float reach = uProgress * totalRows * 1.5 + n;
    if (depthIdx >= reach) discard;

    // which glyph: read the text left to right, top row down, wrapping
    float idx = mod(row * uCols + col, uTextLen);
    float glyph = texelFetch(uText, ivec2(int(idx), 0), 0).r * 255.0;
    // thinning towards the page
    float keep = clamp((depthIdx + 1.0) / (uRowsBelow + 3.0), 0.0, 1.0);
    bool blank = hash12(cell + 7.0) >= keep;
    // scramble while scrolling fast
    float scrambleP = min(abs(uVelocity) / 4000.0, 0.6);
    float seed = floor(uTravel / 32.0);
    if (hash12(cell * 1.7 + seed) < scrambleP) glyph = floor(hash12(cell * 3.1 + seed * 0.37) * uAtlasCount);

    vec2 local = fract(px / uCell);
    vec2 auv = vec2((glyph + local.x) / uAtlasCount, local.y);
    float a = blank ? 0.0 : texture(uAtlas, auv).a;
    vec2 center = (cell + 0.5) * uCell;
    vec3 inkCol = mix(photoAt(center), uInk, 0.15);
    vec3 color = mix(uPaper, inkCol, a);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

function supportsWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export function mountSeam(o: SeamOptions): () => void {
  if (reduced || !supportsWebGL2()) {
    o.host.style.display = 'none';
    return () => {};
  }
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  o.host.appendChild(canvas);
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const paper = new Color(o.paper);
  const ink = new Color(o.ink);

  const photoTex = new Texture(o.img);
  photoTex.flipY = false;
  photoTex.colorSpace = SRGBColorSpace;
  photoTex.minFilter = LinearFilter;
  photoTex.generateMipmaps = false;

  const uniforms: Record<string, IUniform> = {
    uRes: { value: new Vector2(1, 1) },
    uCell: { value: new Vector2(8, 10) },
    uRowsAbove: { value: 8 },
    uRowsBelow: { value: 1 },
    uCols: { value: 1 },
    uProgress: { value: 0 },
    uTravel: { value: 0 },
    uVelocity: { value: 0 },
    uAtlas: { value: null },
    uAtlasCount: { value: 1 },
    uText: { value: null },
    uTextLen: { value: 1 },
    uPhoto: { value: photoTex },
    uPhotoRect: { value: new Vector4() },
    uStripTop: { value: 0 },
    uHeroH: { value: 1 },
    uPaper: { value: paper },
    uInk: { value: ink },
  };
  const material = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false });
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));

  // Text as glyph indices
  const text = o.text.toUpperCase();
  const charset = Array.from(new Set(Array.from(text)));
  const indexOf = new Map(charset.map((c, i) => [c, i]));
  const textData = new Uint8Array(text.length);
  Array.from(text).forEach((c, i) => (textData[i] = indexOf.get(c) ?? 0));
  const textTex = new DataTexture(textData, text.length, 1, RedFormat, UnsignedByteType);
  textTex.minFilter = NearestFilter;
  textTex.magFilter = NearestFilter;
  textTex.flipY = false;
  textTex.needsUpdate = true;
  uniforms.uText.value = textTex;
  uniforms.uTextLen.value = text.length;

  let atlasTex: CanvasTexture | null = null;
  let fontSize = 0;
  let cellW = 8;
  let cellH = 10;

  const buildAtlas = (size: number) => {
    const ratio = 2;
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = `500 ${size}px ${o.fontFamily}`;
    cellW = Math.max(4, Math.ceil(probe.measureText('M').width));
    cellH = Math.round(size * 1.3);
    const c = document.createElement('canvas');
    c.width = cellW * ratio * charset.length;
    c.height = cellH * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.font = `500 ${size}px ${o.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    charset.forEach((ch, i) => ctx.fillText(ch, i * cellW + cellW / 2, cellH / 2 + 0.5));
    atlasTex?.dispose();
    atlasTex = new CanvasTexture(c);
    atlasTex.flipY = false;
    atlasTex.minFilter = LinearFilter;
    atlasTex.generateMipmaps = false;
    uniforms.uAtlas.value = atlasTex;
    uniforms.uAtlasCount.value = charset.length;
    uniforms.uCell.value.set(cellW, cellH);
  };

  let heroTop = 0;
  let heroH = 1;
  let stripTop = 0;
  let onScreen = true;
  let last = { p: -1, t: -1, v: -1 };

  const layout = () => {
    const r = o.hero.getBoundingClientRect();
    heroTop = r.top + window.scrollY;
    heroH = r.height;
    const w = r.width;
    const size = Math.round(Math.min(14, Math.max(10, window.innerWidth / 100)));
    if (size !== fontSize) {
      fontSize = size;
      buildAtlas(size);
    }
    const rowsBelow = 1;
    // The band takes ~28% of the hero (max 16 rows); the hero reserves it below its text via --seam-h.
    const rowsAbove = Math.max(4, Math.min(16, Math.floor((heroH * 0.28) / cellH)));
    const cols = Math.ceil(w / cellW);
    const stripH = (rowsAbove + rowsBelow) * cellH;
    o.hero.style.setProperty('--seam-h', `${rowsAbove * cellH}px`);
    // Re-measure: reserving the band can change the hero height when content is taller than the viewport.
    heroH = o.hero.getBoundingClientRect().height;
    stripTop = heroH - rowsAbove * cellH;
    o.host.style.top = `${stripTop}px`;
    o.host.style.height = `${stripH}px`;
    o.host.style.left = '0';
    o.host.style.width = '100%';

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, stripH, false);
    uniforms.uRes.value.set(w, stripH);
    uniforms.uRowsAbove.value = rowsAbove;
    uniforms.uRowsBelow.value = rowsBelow;
    uniforms.uCols.value = cols;
    uniforms.uStripTop.value = stripTop;
    uniforms.uHeroH.value = heroH;

    // cover-fit box of the photo in hero px, then relative to the strip
    const iw = o.img.naturalWidth || 16;
    const ih = o.img.naturalHeight || 9;
    const s = Math.max(w / iw, heroH / ih);
    const dw = iw * s;
    const dh = ih * s;
    uniforms.uPhotoRect.value.set((w - dw) / 2, (heroH - dh) / 2 - stripTop, dw, dh);
    last.p = -1;
  };

  let vel = 0;
  let prevY = window.scrollY;
  let prevT = performance.now();
  const tick = () => {
    const y = window.scrollY;
    const now = performance.now();
    const dt = Math.max(1, now - prevT) / 1000;
    const raw = (y - prevY) / dt;
    prevY = y;
    prevT = now;
    vel += (raw - vel) * 0.3;
    if (Math.abs(vel) < 2) vel = 0;
    const edgeOnScreen = heroTop + heroH - y; // distance from viewport top to the hero edge
    const travel = Math.max(0, window.innerHeight - edgeOnScreen);
    const progress = Math.min(1, travel / window.innerHeight);
    onScreen = edgeOnScreen > -cellH * 2 && edgeOnScreen < window.innerHeight + heroH;
    if (!onScreen) return;
    if (progress === last.p && travel === last.t && vel === last.v) return;
    last = { p: progress, t: travel, v: vel };
    uniforms.uProgress.value = progress;
    uniforms.uTravel.value = travel;
    uniforms.uVelocity.value = vel;
    renderer.render(scene, camera);
  };

  const start = async () => {
    // The atlas is baked from a canvas: wait for the mono font so the fallback never gets baked in.
    try {
      await document.fonts.load(`500 12px ${o.fontFamily}`);
      await document.fonts.ready;
    } catch {
      /* fonts API unavailable: draw with whatever is loaded */
    }
    photoTex.needsUpdate = true;
    layout();
    gsap.ticker.add(tick);
  };
  if (o.img.complete && o.img.naturalWidth) void start();
  else o.img.addEventListener('load', () => void start(), { once: true });

  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  };
  window.addEventListener('resize', onResize);
  // The hero can grow after load (font swap, content taller than the viewport): follow it.
  const ro = new ResizeObserver(onResize);
  ro.observe(o.hero);

  return () => {
    gsap.ticker.remove(tick);
    ro.disconnect();
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    material.dispose();
    atlasTex?.dispose();
    textTex.dispose();
    photoTex.dispose();
    canvas.remove();
  };
}
