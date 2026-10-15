// GSAP + Lenis setup, the reduced-motion switch, and the site-wide motion layer.
//
// Every animated feature registers itself with `registerMotion(name, setup)`.
// `setup({ enabled })` runs inside a gsap.context, so when the visitor flips the
// Motion switch (or their system setting changes) we revert everything and run
// each setup again in the new mode. Setups may return a cleanup function for
// anything GSAP doesn't own (event listeners, rAF loops, SplitType instances).

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import SplitType from 'split-type';
import { motionEnabled, onMotionChange } from './prefs.js';
import { clamp, navHeight, qsa } from './utils.js';

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger, SplitType };

const modules = [];
let started = false;
let lenis = null;

const tick = (time) => lenis?.raf(time * 1000);

function startLenis() {
  if (lenis) return;
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
}

function stopLenis() {
  if (!lenis) return;
  gsap.ticker.remove(tick);
  lenis.destroy();
  lenis = null;
  gsap.ticker.lagSmoothing(500, 33);
}

/** The active Lenis instance (null when motion is off). */
export function getLenis() {
  return lenis;
}

/** Pause or resume page scrolling (used by the mobile menu and dialogs). */
export function lockScroll(locked) {
  if (lenis) {
    if (locked) lenis.stop();
    else lenis.start();
  }
  document.documentElement.classList.toggle('scroll-locked', locked);
}

/**
 * Glide to a section or element, offset by the nav height.
 * Falls back to an instant jump when motion is off.
 */
export function scrollToTarget(target, { immediate = false, offset, onComplete } = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;
  // Content may have just expanded (e.g. the Sources list); refresh Lenis's scroll limit first.
  lenis?.resize();
  const top =
    el.id === 'home'
      ? 0
      : Math.max(0, el.getBoundingClientRect().top + window.scrollY - (offset ?? navHeight()));
  if (lenis && !immediate && motionEnabled()) {
    const distance = Math.abs(top - window.scrollY);
    lenis.scrollTo(top, {
      duration: clamp(distance / 2600, 0.7, 1.6),
      easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      onComplete,
    });
  } else if (lenis) {
    lenis.scrollTo(top, { immediate: true, force: true });
    onComplete?.();
  } else {
    window.scrollTo(0, top);
    onComplete?.();
  }
}

function runModule(entry) {
  const enabled = motionEnabled();
  entry.ctx = gsap.context(() => {
    try {
      entry.cleanup = entry.setup({ enabled, gsap, ScrollTrigger }) || null;
    } catch (error) {
      console.error(`[motion] "${entry.name}" failed to start`, error);
    }
  });
}

function teardownModule(entry) {
  try {
    entry.cleanup?.();
  } catch (error) {
    console.error(`[motion] "${entry.name}" cleanup failed`, error);
  }
  entry.cleanup = null;
  entry.ctx?.revert();
  entry.ctx = null;
}

/**
 * Register an animated feature. `setup({ enabled, gsap, ScrollTrigger })` runs
 * now (if motion has started) and again whenever the motion setting changes.
 */
export function registerMotion(name, setup) {
  const entry = { name, setup, ctx: null, cleanup: null };
  modules.push(entry);
  if (started) {
    runModule(entry);
    ScrollTrigger.refresh();
  }
  return entry;
}

function rebuild() {
  [...modules].reverse().forEach(teardownModule);
  if (motionEnabled()) startLenis();
  else stopLenis();
  modules.forEach(runModule);
  ScrollTrigger.refresh();
}

/** True when an element hasn't scrolled into view yet (so it can animate in). */
export function isBelowFold(el, ratio = 0.92) {
  return el.getBoundingClientRect().top > window.innerHeight * ratio;
}

/** Start the motion layer (called once from main.js after modules register). */
export function startMotion() {
  if (started) return;
  started = true;
  if (motionEnabled()) startLenis();
  modules.forEach(runModule);
  document.documentElement.classList.add('motion-ready');
  onMotionChange(rebuild);

  // Late-loading fonts and images change layout; keep trigger positions honest.
  const refresh = () => ScrollTrigger.refresh();
  document.fonts?.ready.then(refresh);
  window.addEventListener('load', refresh, { once: true });

  // Content that expands later (transcript, map list, quiz results, pledge card)
  // changes the page height; re-measure pins and triggers when that happens.
  if ('ResizeObserver' in window) {
    let lastHeight = document.body.scrollHeight;
    let timer = 0;
    new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const height = document.body.scrollHeight;
        if (Math.abs(height - lastHeight) > 2) {
          lastHeight = height;
          ScrollTrigger.refresh();
          lastHeight = document.body.scrollHeight;
        }
      }, 200);
    }).observe(document.querySelector('main') || document.body);
  }
}

/* --------------------------------------------------------------------------
   Site-wide effects
   -------------------------------------------------------------------------- */

// 3. Nav "water level" progress bar, scrubbed by scroll position.
registerMotion('progress', () => {
  const bar = document.querySelector('.nav-progress__bar');
  if (!bar) return;
  gsap.set(bar, { '--progress': 0 });
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => bar.style.setProperty('--progress', self.progress.toFixed(4)),
  });
});

// 6. Content fades up from a slight blur to crisp, in staggered groups.
registerMotion('reveal', ({ enabled }) => {
  const underlines = qsa('.card-title--underline');
  if (!enabled) {
    underlines.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const from = { opacity: 0, y: 28, filter: 'blur(6px)' };
  const to = { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, ease: 'power3.out', clearProps: 'filter,transform' };

  qsa('[data-reveal]').forEach((el) => {
    if (!isBelowFold(el)) return;
    gsap.set(el, from);
    ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      once: true,
      onEnter: () => gsap.to(el, to),
    });
  });

  qsa('[data-reveal-group]').forEach((group) => {
    if (!isBelowFold(group)) return;
    const items = Array.from(group.children);
    gsap.set(items, { ...from, y: 34 });
    ScrollTrigger.create({
      trigger: group,
      start: 'top 88%',
      once: true,
      onEnter: () => gsap.to(items, { ...to, stagger: 0.08 }),
    });
  });

  underlines.forEach((el) => {
    if (!isBelowFold(el)) {
      el.classList.add('is-in');
      return;
    }
    el.classList.remove('is-in');
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => el.classList.add('is-in'),
    });
  });

  return () => underlines.forEach((el) => el.classList.add('is-in'));
});

// Section headlines rise in word by word (SplitType).
registerMotion('headlines', ({ enabled }) => {
  if (!enabled) return;
  const splits = qsa('[data-split]').filter((el) => isBelowFold(el)).map((el) => {
    const split = new SplitType(el, { types: 'words', tagName: 'span' });
    gsap.set(split.words, { opacity: 0, yPercent: 60 });
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () =>
        gsap.to(split.words, {
          opacity: 1,
          yPercent: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.05,
        }),
    });
    return split;
  });
  return () => splits.forEach((split) => split.revert());
});

// 5. Wave dividers between sections gently undulate (path morph, paused off-screen).
const WAVE_W = 1440;
const WAVE_H = 90;
const WAVE_POINTS = 24;

function wavePath(phase, seed) {
  const pts = [];
  for (let i = 0; i <= WAVE_POINTS; i += 1) {
    const x = (i / WAVE_POINTS) * WAVE_W;
    const y =
      44 +
      16 * Math.sin((x / WAVE_W) * Math.PI * 2 * 1.15 + phase + seed) +
      8 * Math.sin((x / WAVE_W) * Math.PI * 2 * 2.6 - phase * 1.4 + seed * 2);
    pts.push([x, y]);
  }
  let d = `M0 ${WAVE_H}L${pts[0][0]} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    d += `Q${px.toFixed(1)} ${py.toFixed(1)} ${((px + x) / 2).toFixed(1)} ${((py + y) / 2).toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${last[0]} ${last[1].toFixed(1)}L${WAVE_W} ${WAVE_H}Z`;
}

registerMotion('dividers', ({ enabled }) => {
  if (!enabled) return;
  let alive = true; // a reverted tween must not redraw the path after cleanup
  const items = qsa('.wave-divider__path').map((path, index) => {
    const state = { phase: 0, original: path.getAttribute('d'), seed: index * 1.7 };
    const tween = gsap.to(state, {
      phase: Math.PI * 2,
      duration: 9 + (index % 3),
      ease: 'none',
      repeat: -1,
      paused: true,
      onUpdate: () => {
        if (alive) path.setAttribute('d', wavePath(state.phase, state.seed));
      },
    });
    path.setAttribute('d', wavePath(0, state.seed));
    ScrollTrigger.create({
      trigger: path.closest('.section'),
      start: 'top bottom',
      end: 'top top-=120',
      onToggle: (self) => (self.isActive ? tween.play() : tween.pause()),
    });
    return { path, state };
  });
  return () => {
    alive = false;
    items.forEach(({ path, state }) => path.setAttribute('d', state.original));
  };
});
