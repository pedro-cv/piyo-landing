// Pixelation-to-sharp image reveal on a 2D canvas (the atelier-north effect, own implementation).
// The <img> stays in the DOM for accessibility and layout; the canvas paints over it.
import { gsap, ScrollTrigger, reduced } from './motion';

export function pixelReveal(img: HTMLImageElement, canvas: HTMLCanvasElement, opts: { start?: string; duration?: number } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const start = opts.start ?? 'top 80%';
  const duration = opts.duration ?? 1.5;
  const state = { p: 0 };
  let w = 0;
  let h = 0;
  let dpr = 1;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };

  // Cover-fit the image into the canvas box.
  const draw = () => {
    if (!img.naturalWidth) return;
    const p = state.p;
    const natural = img.naturalWidth;
    const minW = 18;
    const pxW = Math.max(minW, Math.round(minW + (natural - minW) * Math.pow(p, 2.5)));
    const ratio = img.naturalHeight / img.naturalWidth;
    const pxH = Math.max(1, Math.round(pxW * ratio));
    const off = document.createElement('canvas');
    off.width = pxW;
    off.height = pxH;
    const octx = off.getContext('2d')!;
    octx.imageSmoothingEnabled = p > 0.98;
    octx.drawImage(img, 0, 0, pxW, pxH);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = p > 0.98;
    const scale = Math.max(w / pxW, h / pxH);
    const dw = pxW * scale;
    const dh = pxH * scale;
    ctx.drawImage(off, (w - dw) / 2, (h - dh) / 2, dw, dh);
  };

  const ready = () => {
    size();
    if (reduced) {
      state.p = 1;
      draw();
      canvas.dataset.done = '1';
      return;
    }
    gsap.set(canvas, { scale: 1.1, transformOrigin: '50% 50%' });
    draw();
    const tl = gsap.timeline({ paused: true, onComplete: () => (canvas.dataset.done = '1') });
    tl.to(state, { p: 1, duration, ease: 'none', onUpdate: draw }, 0);
    tl.to(canvas, { scale: 1, duration, ease: 'power2.out' }, 0);
    // Replays each time the image comes into focus, scrolling down or up; resets while off screen.
    ScrollTrigger.create({
      trigger: canvas,
      start,
      end: 'bottom 15%',
      onEnter: () => tl.restart(),
      onEnterBack: () => tl.restart(),
      onLeave: () => tl.pause(0),
      onLeaveBack: () => tl.pause(0),
    });
  };

  const ro = new ResizeObserver(() => {
    size();
    draw();
  });
  ro.observe(canvas);

  if (img.complete && img.naturalWidth) ready();
  else img.addEventListener('load', ready, { once: true });
  ScrollTrigger.addEventListener('refreshInit', () => size());
}
