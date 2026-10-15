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

// Measure triggers top to bottom on every refresh. Modules register in import
// order, not page order, and a trigger below a pin must be measured after that
// pin adds its spacing or it fires early.
ScrollTrigger.addEventListener('refreshInit', () => ScrollTrigger.sort());

export { gsap, ScrollTrigger, SplitType };

/** Where the Watch and campus pins run: wide enough, and tall enough to fit a pinned card. */
export const PIN_QUERY = '(min-width: 768px) and (min-height: 600px)';

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

/**
 * Keep the reader on the same content when the width changes (rotating a phone,
 * resizing a window) or the pins switch on or off. Crossing a breakpoint
 * rebuilds the pins, and GSAP clears its saved scroll position when pins are
 * created inside gsap.matchMedia(), so its refresh would land at the top of the
 * page. The position is noted whenever scrolling settles, before any reflow.
 * Height-only resizes (a mobile URL bar) are left alone.
 */
function keepPlaceOnResize() {
  let width = window.innerWidth;
  let saved = null; // the reading position, updated whenever scrolling settles
  let pending = null; // the position to put back after a width or pin change
  let settle = 0;
  let idle = 0;

  const readingLine = () => navHeight() + 8;

  // A modest block at (or just below) the reading line that scrolls with the
  // page, or failing that the section there. Several probes, since a gap or a
  // section-wide canvas may sit at one; blocks about to scroll off are skipped.
  // Where the reader is gets stored as a share of the block's height, so it
  // still lands right when the block reflows to a new height.
  const place = (el, r, y) => ({ el, gap: Math.min(0, y - r.top), share: Math.max(0, (y - r.top) / r.height) });
  const capture = () => {
    const y = readingLine();
    for (const dy of [0, 40, 120, 200]) {
      for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
        for (const el of document.elementsFromPoint(window.innerWidth * fx, y + dy)) {
          if (el.closest('.site-header, .map-panel, .map-backdrop')) break;
          const r = el.getBoundingClientRect();
          if (el.closest('main, footer') && r.height > 0 && r.height < window.innerHeight * 1.5 && r.bottom > y + 24) {
            return place(el, r, y);
          }
        }
      }
    }
    for (const section of document.querySelectorAll('main > section, footer > section')) {
      const r = section.getBoundingClientRect();
      if (r.top <= y && r.bottom > y + 24) return place(section, r, y);
    }
    return null;
  };

  const remember = () => {
    if (!pending) saved = capture();
  };
  remember();
  window.addEventListener(
    'scroll',
    () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(remember, 150);
    },
    { passive: true },
  );

  const restore = () => {
    const a = pending;
    if (!a?.el.isConnected) return;
    const into = a.gap < 0 ? a.gap : a.share * a.el.getBoundingClientRect().height;
    scrollToTarget(a.el, { immediate: true, offset: readingLine() - into });
  };

  const hold = () => {
    pending ||= saved;
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      restore();
      pending = null;
      remember();
    }, 900);
  };

  window.addEventListener('resize', () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    hold();
  });
  window.matchMedia(PIN_QUERY).addEventListener('change', hold);
  ScrollTrigger.addEventListener('refresh', () => pending && restore());
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

  keepPlaceOnResize();

  // Content that expands later (transcript, map list, quiz results, pledge card)
  // changes the page height; re-measure pins and triggers when that happens.
  if ('ResizeObserver' in window) {
    let lastHeight = document.body.scrollHeight;
    let timer = 0;
    // Window resizes are left to ScrollTrigger, which refreshes on its own;
    // a second refresh from here mid-resize only adds churn.
    let resizing = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizing);
      resizing = window.setTimeout(() => {
        resizing = 0;
        lastHeight = document.body.scrollHeight;
      }, 1000);
    });
    new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (resizing) return;
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
