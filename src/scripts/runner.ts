// "Corré como piyo": a runner in the spirit of Chrome's offline dino game, on a 2D canvas.
// Own implementation. The tuning follows the well-known Chromium game constants (gravity 0.6,
// jump velocity -10, drop velocity -5, min jump height 30, acceleration 0.001 per frame, speed 6→13,
// gap = width·speed + minGap·0.6 … ×1.5, birds at three heights, frame-rate independent stepping),
// scaled ×1.1 for this 640×200 world so it feels like the original.
import { SPRITES, rasterize, type Sprite } from './sprites';

export interface ObstacleDef {
  name: string;
  en: string;
  article: string;
  kind: 'ground' | 'air';
  sprite: string;
  weight: number;
}

export interface RunnerOptions {
  canvas: HTMLCanvasElement;
  obstacles: ObstacleDef[];
  ink: string;
  accent: string;
  paper: string;
  night: string;
  onState?: (s: RunnerState) => void;
}

export interface RunnerState {
  phase: 'idle' | 'running' | 'dead';
  score: number;
  best: number;
  hit?: ObstacleDef;
}

const BEST_KEY = 'piyoRunnerBest';
const H = 200;
const GROUND_Y = 160;
const MS_PER_FRAME = 1000 / 60;

const K = 1.1;
const GRAVITY = 0.6 * K;
const JUMP_V = -10 * K;
const DROP_V = -5 * K;
const MIN_JUMP_H = 30 * K;
const SPEED_DROP = 3;
const ACCEL = 0.001;
const SPEED_START = 6;
const SPEED_MAX = 13;
const GAP_COEF = 0.6;
const MAX_GAP_COEF = 1.5;
const MIN_GAP_GROUND = 120;
const MIN_GAP_AIR = 150;
const BIRD_MIN_SPEED = 8.5;
const PLAYER_SCALE = 2;
const OBST_SCALE = 3; // obstacles are drawn bigger than the player, like the large cacti

type Sheet = Record<string, HTMLCanvasElement>;

export function mountRunner(o: RunnerOptions) {
  const ctx = o.canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 640;
  const sheet: Sheet = {};
  const bakeSheet = (ink: string) => {
    for (const [k, s] of Object.entries(SPRITES)) {
      const small = k.startsWith('piyo') || k === 'cloud' || k === 'tuft' || k === 'stone';
      sheet[k] = rasterize(s, small ? PLAYER_SCALE : OBST_SCALE, ink, o.accent);
    }
  };
  bakeSheet(o.ink);

  const state: RunnerState = { phase: 'idle', score: 0, best: readBest() };
  let speed = SPEED_START;
  let distance = 0;
  let frames = 0;
  let night = false;

  const PW = 28 * PLAYER_SCALE;
  const PH = 28 * PLAYER_SCALE;
  const PH_DUCK = 16 * PLAYER_SCALE;
  const P = { x: 50, y: GROUND_Y, vy: 0, ducking: false, jumping: false, speedDrop: false, reachedMin: false, holding: false };
  type Obs = { def: ObstacleDef; x: number; y: number; w: number; h: number; gap: number; frame: number };
  let obstacles: Obs[] = [];
  let clouds: { x: number; y: number; v: number }[] = [];
  let tufts: { x: number; k: string }[] = [];

  const weighted = o.obstacles.flatMap((d) => Array(d.weight).fill(d) as ObstacleDef[]);
  const spriteOf = (def: ObstacleDef, f: number): Sprite & { key: string } => {
    const k2 = `${def.sprite}_${(f % 2) + 1}`;
    const key = SPRITES[k2] ? k2 : def.sprite;
    return { ...SPRITES[key], key };
  };

  const resize = () => {
    const r = o.canvas.getBoundingClientRect();
    W = r.width < 560 ? 360 : 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    o.canvas.width = Math.round(r.width * dpr);
    o.canvas.height = Math.round(((r.width * H) / W) * dpr);
    o.canvas.style.height = `${(r.width * H) / W}px`;
  };

  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const reset = () => {
    speed = SPEED_START;
    distance = 0;
    frames = 0;
    obstacles = [];
    clouds = Array.from({ length: 4 }, (_, i) => ({ x: i * 170 + rand(0, 60), y: rand(20, 80), v: rand(0.35, 0.7) }));
    tufts = Array.from({ length: 16 }, (_, i) => ({ x: i * 44 + rand(0, 30), k: Math.random() < 0.65 ? 'tuft' : 'stone' }));
    P.y = GROUND_Y;
    P.vy = 0;
    P.ducking = false;
    P.jumping = false;
    P.speedDrop = false;
    P.holding = false;
    state.score = 0;
    state.hit = undefined;
    night = false;
    bakeSheet(o.ink);
  };

  const emit = () => o.onState?.({ ...state });
  const start = () => {
    reset();
    state.phase = 'running';
    emit();
  };

  // Player actions with the dino semantics: hold = full jump, release early = short jump, down in the air = fast drop.
  const startJump = () => {
    if (state.phase !== 'running') {
      start();
      return;
    }
    if (!P.jumping && !P.ducking) {
      P.jumping = true;
      P.vy = JUMP_V;
      P.reachedMin = false;
      P.speedDrop = false;
      P.holding = true;
    }
  };
  const endJump = () => {
    P.holding = false;
    if (P.jumping && P.reachedMin && P.vy < DROP_V) P.vy = DROP_V;
  };
  const setDuck = (on: boolean) => {
    if (state.phase !== 'running') return;
    if (on && P.jumping) {
      P.speedDrop = true;
      P.vy = Math.max(P.vy, 1);
    }
    P.ducking = on && !P.jumping;
  };

  const gapFor = (w: number, def: ObstacleDef) => {
    // Chromium: width·speed + minGap·0.6. Our sprites are ~2× wider than the cacti, so the width term is halved
    // to keep the same rhythm (≈ 220–330 px between obstacles at the start, tighter as speed grows).
    const minGap = Math.round((w * speed) / 2 + (def.kind === 'air' ? MIN_GAP_AIR : MIN_GAP_GROUND) * GAP_COEF);
    return Math.round(rand(minGap, minGap * MAX_GAP_COEF));
  };
  const spawn = () => {
    let def = weighted[Math.floor(Math.random() * weighted.length)];
    if (def.kind === 'air' && speed < BIRD_MIN_SPEED) def = weighted.find((d) => d.kind === 'ground') ?? def;
    const s = spriteOf(def, 0);
    const w = s.w * OBST_SCALE;
    const h = s.h * OBST_SCALE;
    let y = GROUND_Y - h;
    if (def.kind === 'air') {
      // three heights like the pterodactyl: low (jump), mid (duck or jump), high (run under)
      const standingTop = GROUND_Y - PH;
      const level = Math.floor(Math.random() * 3);
      y = [standingTop + 12, standingTop - 10, standingTop - h - 6][level];
    }
    obstacles.push({ def, x: W + 4, y, w, h, gap: gapFor(w, def), frame: 0 });
  };

  const hits = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
    const i = 5;
    return a.x + i < b.x + b.w - i && a.x + a.w - i > b.x + i && a.y + i < b.y + b.h - i && a.y + a.h - i > b.y + i;
  };

  // One update of `dt` frames (dt ≈ 1 at 60 Hz, fractional on other refresh rates).
  const update = (dt: number) => {
    frames += dt;
    distance += speed * dt;
    if (speed < SPEED_MAX) speed = Math.min(SPEED_MAX, speed + ACCEL * dt);
    state.score = Math.floor(distance / 20);

    const wantNight = Math.floor(state.score / 700) % 2 === 1;
    if (wantNight !== night) {
      night = wantNight;
      bakeSheet(night ? o.paper : o.ink);
    }

    if (P.jumping) {
      const g = GRAVITY * (P.speedDrop ? SPEED_DROP : 1);
      P.y += P.vy * dt;
      P.vy += g * dt;
      if (GROUND_Y - P.y > MIN_JUMP_H) P.reachedMin = true;
      if (!P.holding && P.reachedMin && P.vy < DROP_V) P.vy = DROP_V;
      if (P.y >= GROUND_Y) {
        P.y = GROUND_Y;
        P.vy = 0;
        P.jumping = false;
        P.speedDrop = false;
      }
    }

    const last = obstacles[obstacles.length - 1];
    if (!last || W - (last.x + last.w) > last.gap) spawn();
    for (const ob of obstacles) {
      ob.x -= speed * dt;
      ob.frame = Math.floor(frames / 10);
    }
    obstacles = obstacles.filter((ob) => ob.x + ob.w > -10);
    for (const c of clouds) {
      c.x -= c.v * dt;
      if (c.x < -40) {
        c.x = W + rand(0, 60);
        c.y = rand(20, 80);
      }
    }
    for (const t of tufts) {
      t.x -= speed * dt;
      if (t.x < -10) t.x = W + rand(0, 40);
    }

    const ph = P.ducking ? PH_DUCK : PH;
    const box = { x: P.x, y: P.y - ph, w: PW, h: ph };
    for (const ob of obstacles) {
      if (hits(box, ob)) {
        state.phase = 'dead';
        state.hit = ob.def;
        if (state.score > state.best) {
          state.best = state.score;
          writeBest(state.best);
        }
        emit();
        return;
      }
    }
    if (Math.floor(frames) % 15 === 0) emit();
  };

  const draw = () => {
    const sx = o.canvas.width / W;
    ctx.setTransform(sx, 0, 0, sx, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = night ? o.night : o.paper;
    ctx.fillRect(0, 0, W, H);

    for (const c of clouds) ctx.drawImage(sheet.cloud, c.x, c.y, 18 * 1.4, 5 * 1.4);
    ctx.fillStyle = night ? o.paper : o.ink;
    ctx.fillRect(0, GROUND_Y + 1, W, 1);
    for (const t of tufts) ctx.drawImage(sheet[t.k], t.x, GROUND_Y + 4);

    for (const ob of obstacles) {
      const s = spriteOf(ob.def, ob.frame);
      ctx.drawImage(sheet[s.key], ob.x, ob.y);
    }

    let key: string;
    if (state.phase === 'dead') key = 'piyo_dead';
    else if (P.ducking) key = 'piyo_duck';
    else if (P.jumping || state.phase !== 'running') key = 'piyo_run_1';
    else key = Math.floor(frames / 5) % 2 ? 'piyo_run_2' : 'piyo_run_1';
    const spr = sheet[key];
    ctx.drawImage(spr, P.x, P.y - spr.height);

    ctx.fillStyle = night ? o.paper : o.ink;
    ctx.font = '500 12px "Kode Mono Variable", "Kode Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`HI ${String(state.best).padStart(5, '0')}  ${String(state.score).padStart(5, '0')}`, W - 12, 20);

    if (state.phase !== 'running') {
      ctx.textAlign = 'center';
      ctx.font = '500 13px "Kode Mono Variable", "Kode Mono", monospace';
      ctx.fillText(state.phase === 'idle' ? '[ ESPACIO / TOCÁ ]  PARA CORRER' : '[ ESPACIO / TOCÁ ]  OTRA VEZ', W / 2, 70);
      if (state.phase === 'dead' && state.hit) {
        ctx.font = '500 11px "Kode Mono Variable", "Kode Mono", monospace';
        ctx.fillText(`¡ELAY! CHOCASTE CON ${state.hit.article} ${state.hit.name} (${state.hit.en})`.toUpperCase(), W / 2, 92);
      }
    }
  };

  // Frame-rate independent loop (dt measured in 60 Hz frames, like the original).
  let last = performance.now();
  let raf = 0;
  let visible = true;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (!visible) {
      last = now;
      return;
    }
    const dt = Math.min(3, (now - last) / MS_PER_FRAME);
    last = now;
    if (state.phase === 'running') update(dt);
    draw();
  };

  const onKey = (e: KeyboardEvent) => {
    if (document.activeElement !== o.canvas && state.phase === 'idle') return;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      if (e.repeat) return;
      startJump();
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      setDuck(true);
    } else if (e.code === 'Enter' && state.phase !== 'running') start();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') endJump();
    if (e.code === 'ArrowDown' || e.code === 'KeyS') setDuck(false);
  };
  let touchStartY = 0;
  let touchDucked = false;
  const onPointerDown = (e: PointerEvent) => {
    o.canvas.focus({ preventScroll: true });
    e.preventDefault();
    touchStartY = e.clientY;
    touchDucked = false;
    startJump(); // a tap always jumps; swipe down to duck
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || state.phase !== 'running') return;
    if (!touchDucked && e.clientY - touchStartY > 24) {
      touchDucked = true;
      endJump();
      setDuck(true);
    }
  };
  const onPointerUp = () => {
    endJump();
    if (touchDucked) setDuck(false);
    touchDucked = false;
  };
  const onVis = () => {
    visible = document.visibilityState === 'visible';
    last = performance.now();
  };
  const onBlur = () => endJump();

  o.canvas.addEventListener('keydown', onKey);
  o.canvas.addEventListener('keyup', onKeyUp);
  o.canvas.addEventListener('pointerdown', onPointerDown);
  o.canvas.addEventListener('pointermove', onPointerMove);
  o.canvas.addEventListener('pointerup', onPointerUp);
  o.canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(resize);
  ro.observe(o.canvas);

  resize();
  reset();
  emit();
  (o.canvas as HTMLCanvasElement & { __runner?: unknown }).__runner = {
    get state() {
      return state;
    },
    get player() {
      return P;
    },
    get obstacles() {
      return obstacles;
    },
  };
  if (reduced) draw();
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    o.canvas.removeEventListener('keydown', onKey);
    o.canvas.removeEventListener('keyup', onKeyUp);
    o.canvas.removeEventListener('pointerdown', onPointerDown);
    o.canvas.removeEventListener('pointermove', onPointerMove);
    o.canvas.removeEventListener('pointerup', onPointerUp);
    o.canvas.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
  };
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* private mode */
  }
}
