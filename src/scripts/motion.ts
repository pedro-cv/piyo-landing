// Shared motion layer: Lenis smooth scroll + GSAP/ScrollTrigger and the text/image reveals used
// across the page. Everything degrades to "visible and still" under prefers-reduced-motion.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

export { gsap, ScrollTrigger };

export const reduced =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type MotionState = { lenis: Lenis | null; ScrollTrigger: typeof ScrollTrigger };
declare global {
  interface Window {
    __piyoMotion?: MotionState;
  }
}

/** Creates Lenis (unless reduced motion) and wires it to ScrollTrigger. Idempotent. */
export function initMotion(): MotionState {
  if (window.__piyoMotion) return window.__piyoMotion;
  let lenis: Lenis | null = null;
  if (!reduced) {
    lenis = new Lenis({ duration: 1.2, easing: (t) => 1 - Math.pow(1 - t, 3) });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis!.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  window.__piyoMotion = { lenis, ScrollTrigger };
  window.addEventListener('load', () => ScrollTrigger.refresh());
  // The page changes height after the triggers are measured (lazy hero seam reserving its band, fonts, images).
  // Without a refresh the last triggers keep positions beyond the real end of the page and never fire, which
  // left the footer heading unfilled on tall screens. Refresh once per frame when the document resizes.
  let pending = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => ScrollTrigger.refresh());
  });
  ro.observe(document.documentElement);
  ro.observe(document.body);
  return window.__piyoMotion;
}

export function scrollTo(target: string | number, duration = 1) {
  const m = window.__piyoMotion;
  if (m?.lenis) m.lenis.scrollTo(target, { duration });
  else gsap.to(window, { scrollTo: target, duration, ease: 'power2.inOut' });
}

/** Full text for screen readers while the split spans stay aria-hidden. aria-label is not allowed on p/span/h*
 * text containers, so the readable copy lives in a visually hidden span instead. */
function srText(text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'sr-only';
  s.textContent = text.trim();
  return s;
}

/** Wraps each character in .char (and words in .word so lines wrap naturally). */
export function splitChars(el: HTMLElement): HTMLElement[] {
  if (el.dataset.split === 'chars') return Array.from(el.querySelectorAll<HTMLElement>('.char'));
  const text = el.textContent ?? '';
  el.textContent = '';
  el.classList.add('split');
  el.dataset.split = 'chars';
  el.appendChild(srText(text));
  const chars: HTMLElement[] = [];
  text.split(/(\s+)/).forEach((part) => {
    if (!part) return;
    if (/^\s+$/.test(part)) {
      el.appendChild(document.createTextNode(' '));
      return;
    }
    const word = document.createElement('span');
    word.className = 'word';
    word.setAttribute('aria-hidden', 'true');
    for (const ch of Array.from(part)) {
      const c = document.createElement('span');
      c.className = 'char';
      c.textContent = ch;
      word.appendChild(c);
      chars.push(c);
    }
    el.appendChild(word);
  });
  return chars;
}

/** Wraps each word in a masked container so it can slide up into view. */
export function splitWordsMasked(el: HTMLElement): HTMLElement[] {
  if (el.dataset.split === 'words') return Array.from(el.querySelectorAll<HTMLElement>('.mask > .word'));
  const text = el.textContent ?? '';
  el.textContent = '';
  el.dataset.split = 'words';
  el.appendChild(srText(text));
  const words: HTMLElement[] = [];
  text.trim().split(/\s+/).forEach((w, i) => {
    if (i) el.appendChild(document.createTextNode(' '));
    const mask = document.createElement('span');
    mask.className = 'mask';
    mask.setAttribute('aria-hidden', 'true');
    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = w;
    mask.appendChild(word);
    el.appendChild(mask);
    words.push(word);
  });
  return words;
}

/** Hero title: characters grow from the baseline with a random stagger (on load). */
export function heroTitleIn(el: HTMLElement, delay = 0.2) {
  const chars = splitChars(el);
  if (reduced) return;
  gsap.set(chars, { transformOrigin: '50% 100%' });
  gsap.fromTo(
    chars,
    { scaleY: 0 },
    { scaleY: 1, duration: 1.2, ease: 'power4.out', stagger: { each: 0.05, from: 'random' }, delay },
  );
}

/** Characters rise into view inside a mask when the element scrolls in. */
export function charsUp(el: HTMLElement, start = 'top 80%') {
  const chars = splitChars(el);
  el.querySelectorAll<HTMLElement>('.word').forEach((w) => w.classList.add('mask'));
  if (reduced) return;
  gsap.fromTo(
    chars,
    { yPercent: 110 },
    { yPercent: 0, duration: 1.2, ease: 'power4.out', stagger: 0.04, scrollTrigger: { trigger: el, start, once: true } },
  );
}

/** Outlined heading filled by a left-to-right clip-path wipe, scrubbed with scroll. */
export function wipeHeading(el: HTMLElement) {
  const fill = el.querySelector<HTMLElement>('.wipe-fill');
  if (!fill || reduced) return;
  const closed = 'polygon(0 0, 0 0, 0 100%, 0 100%)';
  const open = 'polygon(0 0, 100% 0, 100% 100%, 0 100%)';
  let swapped = false;
  // A heading near the end of the page (the footer) may have no scroll room left to scrub through, and on a tall
  // screen clamp() collapses start and end onto the same pixel. In that case play the wipe once on entry instead.
  const useTimed = () => {
    if (swapped) return;
    swapped = true;
    tween.scrollTrigger?.kill();
    tween.kill();
    gsap.fromTo(fill, { clipPath: closed }, {
      clipPath: open,
      duration: 1.6,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 95%', once: true },
    });
  };
  const tween = gsap.fromTo(fill, { clipPath: closed }, {
    clipPath: open,
    ease: 'none',
    scrollTrigger: {
      trigger: el,
      start: 'clamp(top 80%)',
      end: 'clamp(top 20%)',
      scrub: 1.5,
      onRefresh: (self) => {
        if (self.end - self.start < window.innerHeight * 0.25) useTimed();
      },
    },
  });
  const st = tween.scrollTrigger;
  if (st && st.end - st.start < window.innerHeight * 0.25) useTimed();
}

/** Words slide up through masks when the element enters the viewport. */
export function wordsIn(el: HTMLElement, start = 'top 80%', stagger = 0.08) {
  const words = splitWordsMasked(el);
  if (reduced) return;
  gsap.fromTo(
    words,
    { yPercent: 110 },
    { yPercent: 0, duration: 1.2, ease: 'power3.out', stagger, scrollTrigger: { trigger: el, start, once: true } },
  );
}

/** Generic fade/rise for blocks (cards, paragraphs). */
export function riseIn(els: Element[] | NodeListOf<Element>, start = 'top 85%', stagger = 0.1) {
  const list = Array.from(els);
  if (!list.length || reduced) return;
  list.forEach((el, i) => {
    gsap.fromTo(
      el,
      { y: 32, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 1, ease: 'power3.out', delay: (i % 3) * stagger, scrollTrigger: { trigger: el, start, once: true } },
    );
  });
}

/** Floating tags: slow endless bob. */
export function floatTags(els: Element[] | NodeListOf<Element>) {
  if (reduced) return;
  Array.from(els).forEach((el) => {
    gsap.fromTo(
      el,
      { y: -8 },
      { y: 8, duration: gsap.utils.random(1.2, 1.8), ease: 'sine.inOut', yoyo: true, repeat: -1, delay: gsap.utils.random(0, 1) },
    );
  });
}

/** Header hides on scroll down and returns (items dropping in) on scroll up. */
export function headerAutoHide(header: HTMLElement) {
  if (reduced) return;
  const items = header.querySelectorAll<HTMLElement>('[data-nav-item]');
  let hidden = false;
  ScrollTrigger.create({
    start: 80,
    onUpdate: (self) => {
      const down = self.direction === 1;
      if (down && !hidden) {
        hidden = true;
        gsap.to(header, { yPercent: -110, duration: 0.45, ease: 'power3.inOut' });
      } else if (!down && hidden) {
        hidden = false;
        gsap.to(header, { yPercent: 0, duration: 0.45, ease: 'power3.out' });
        gsap.fromTo(items, { y: -40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.08, ease: 'power3.out' });
      }
    },
  });
}
