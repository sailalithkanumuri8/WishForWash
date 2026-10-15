// Hero: loader (1), pixel wordmark assembly (9), floating globe with water that
// tilts toward the cursor (10), a drop that falls into the globe with looping
// ripples (11), the bobbing bottle with twinkling sparkles (12) and three wave
// layers with scroll parallax (13). The "Scroll to dive in" bounce (14) is CSS.

import { gsap, registerMotion, SplitType } from './motion.js';
import { hasFinePointer, motionEnabled } from './prefs.js';
import { qs, qsa } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

/* --------------------------------------------------------------------------
   Globe overlay: falling drop, ripples and a water sheen that can tilt
   -------------------------------------------------------------------------- */

function buildGlobeFx(globe) {
  const [w, h] = (globe.dataset.size || '1100 1000').split(/\s+/).map(Number);
  const [cx, cy, rx, ry] = (globe.dataset.water || '').split(/\s+/).map(Number);
  if (!w || !h || !rx) return null;

  const svg = svgEl('svg', { class: 'hero__globe-fx', viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: 'sheen-grad', x1: '0', y1: '0', x2: '1', y2: '0' });
  [
    ['0', 0],
    ['0.35', 0.55],
    ['0.5', 0.15],
    ['0.7', 0.45],
    ['1', 0],
  ].forEach(([offset, opacity]) =>
    grad.appendChild(svgEl('stop', { offset, 'stop-color': '#ffffff', 'stop-opacity': String(opacity) })),
  );
  defs.appendChild(grad);
  svg.appendChild(defs);

  // A thin highlight lying on the water surface; it rotates with the cursor.
  const sheen = svgEl('g', { class: 'globe-sheen' });
  sheen.appendChild(
    svgEl('ellipse', {
      cx,
      cy,
      rx: rx * 0.92,
      ry: ry * 0.62,
      fill: 'none',
      stroke: 'url(#sheen-grad)',
      'stroke-width': Math.max(4, ry * 0.08),
      opacity: '0.85',
    }),
  );
  svg.appendChild(sheen);

  const ripples = svgEl('g', { class: 'globe-ripples' });
  for (let i = 0; i < 3; i += 1) {
    ripples.appendChild(svgEl('ellipse', { class: 'globe-ripple', cx, cy, rx: rx * 0.62, ry: ry * 0.5 }));
  }
  svg.appendChild(ripples);

  const dropH = Math.max(28, ry * 0.55);
  const drop = svgEl('path', {
    class: 'globe-drop',
    d: `M${cx} ${cy - dropH}c-${dropH * 0.18} ${dropH * 0.42}-${dropH * 0.36} ${dropH * 0.58}-${dropH * 0.36} ${dropH * 0.8}a${dropH * 0.36} ${dropH * 0.36} 0 0 0 ${dropH * 0.72} 0c0-${dropH * 0.22}-${dropH * 0.18}-${dropH * 0.38}-${dropH * 0.36}-${dropH * 0.8}Z`,
    fill: '#d9ecfa',
    stroke: '#2f64a8',
    'stroke-width': '3',
  });
  // SVG user units map 1:1 to px in CSS transforms, so the fall scales with the art.
  drop.style.setProperty('--drop-from', `${-(cy - dropH - h * 0.04)}px`);
  svg.appendChild(drop);

  (qs('.hero__globe-tilt', globe) || globe).appendChild(svg);
  return { svg, sheen, cx, cy };
}

/* --------------------------------------------------------------------------
   Bottle sparkles (decorative)
   -------------------------------------------------------------------------- */

const SPARKLES = [
  { left: '-12%', top: '18%', delay: '0s', size: 18 },
  { left: '88%', top: '6%', delay: '0.8s', size: 14 },
  { left: '96%', top: '58%', delay: '1.5s', size: 20 },
  { left: '-6%', top: '70%', delay: '2.1s', size: 12 },
];

function addSparkles(bottle) {
  SPARKLES.forEach(({ left, top, delay, size }) => {
    const span = document.createElement('span');
    span.className = 'sparkle';
    span.setAttribute('aria-hidden', 'true');
    Object.assign(span.style, { left, top, animationDelay: delay, width: `${size}px`, height: `${size}px` });
    span.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M12 0c.8 6.4 5.6 11.2 12 12-6.4.8-11.2 5.6-12 12-.8-6.4-5.6-11.2-12-12C6.4 11.2 11.2 6.4 12 0Z" fill="currentColor"/></svg>';
    bottle.appendChild(span);
  });
}

/* --------------------------------------------------------------------------
   Intro: loader -> wordmark -> copy
   -------------------------------------------------------------------------- */

function markVisited() {
  try {
    localStorage.setItem('wfw-visited', '1');
  } catch {
    /* private mode: the loader simply shows again next time */
  }
}

function playIntro(delay = 0) {
  const wordmark = qs('.wordmark__text');
  const intro = qsa('[data-hero-intro]');
  if (!wordmark || !motionEnabled()) return;

  // 9. Pixel wordmark assembles block by block: each letter builds up in
  // stepped rows, like pixels stacking.
  const split = new SplitType(wordmark, { types: 'chars', tagName: 'span' });
  const tl = gsap.timeline({
    delay,
    onComplete: () => {
      split.revert();
      gsap.set(intro, { clearProps: 'all' });
    },
  });
  tl.fromTo(
    split.chars,
    { clipPath: 'inset(100% 0% 0% 0%)', y: 18 },
    { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: 0.42, ease: 'steps(6)', stagger: 0.055 },
  );
  tl.fromTo(
    intro,
    { opacity: 0, y: 22, filter: 'blur(6px)' },
    { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out', stagger: 0.08 },
    0.2,
  );
}

function runLoader() {
  const loader = qs('#loader');
  const visible = loader && getComputedStyle(loader).display !== 'none';
  if (!visible) {
    markVisited();
    playIntro(0.05);
    return;
  }
  const water = qs('.loader__water', loader);
  const wave = qs('.loader__wave', loader);
  const drop = qs('.loader__drop', loader);
  loader.style.animation = 'none'; // the JS timeline takes over from the CSS failsafe

  // 1. A drop outline fills with water, then splashes into the hero (1.2s).
  gsap
    .timeline({
      onComplete: () => {
        loader.classList.add('is-done');
        markVisited();
      },
    })
    .fromTo(water, { attr: { y: 128 } }, { attr: { y: 8 }, duration: 0.8, ease: 'power1.inOut' }, 0)
    .fromTo(wave, { y: 128, x: 0 }, { y: 8, x: -48, duration: 0.8, ease: 'power1.inOut' }, 0)
    .to(drop, { scale: 14, duration: 0.4, ease: 'power2.in', transformOrigin: '50% 65%' }, 0.8)
    .to(loader, { opacity: 0, duration: 0.32, ease: 'power1.out' }, 0.86)
    .add(() => playIntro(0), 0.78);
}

/* --------------------------------------------------------------------------
   Motion modules
   -------------------------------------------------------------------------- */

// 10. Globe and hands float (CSS); the globe and the water sheen lean toward the cursor.
registerMotion('globe-tilt', ({ enabled }) => {
  const globe = qs('[data-globe]');
  const fx = globe?.__fx;
  if (!enabled || !globe || !hasFinePointer()) return;
  // The outer element floats with a CSS loop; the inner wrapper takes the tilt.
  const tilt = qs('.hero__globe-tilt', globe);
  const img = qs('.hero__globe-img', globe);
  const hero = qs('#home');
  const rotY = gsap.quickTo(tilt, 'rotationY', { duration: 0.8, ease: 'power3.out' });
  const rotX = gsap.quickTo(tilt, 'rotationX', { duration: 0.8, ease: 'power3.out' });
  const sheenRot = fx ? gsap.quickTo(fx.sheen, 'rotation', { duration: 0.9, ease: 'power3.out' }) : null;
  const sheenX = fx ? gsap.quickTo(fx.sheen, 'x', { duration: 0.9, ease: 'power3.out' }) : null;
  gsap.set(tilt, { transformPerspective: 900 });
  if (fx) gsap.set(fx.sheen, { svgOrigin: `${fx.cx} ${fx.cy}` });

  const onMove = (event) => {
    const rect = img.getBoundingClientRect();
    const px = (event.clientX - (rect.left + rect.width / 2)) / window.innerWidth;
    const py = (event.clientY - (rect.top + rect.height / 2)) / window.innerHeight;
    rotY(px * 8);
    rotX(-py * 5);
    sheenRot?.(px * 16);
    sheenX?.(px * 24);
  };
  const onLeave = () => {
    rotY(0);
    rotX(0);
    sheenRot?.(0);
    sheenX?.(0);
  };
  hero.addEventListener('pointermove', onMove);
  hero.addEventListener('pointerleave', onLeave);
  return () => {
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
  };
});

// 13. Wave layers drift (CSS) and separate with scroll parallax.
registerMotion('hero-parallax', ({ enabled, gsap: g }) => {
  if (!enabled) return;
  const hero = qs('#home');
  qsa('[data-wave-layer]').forEach((layer) => {
    const depth = parseFloat(layer.dataset.waveLayer) || 0;
    if (!depth) return;
    g.to(layer, {
      yPercent: -28 * depth,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
    });
  });
  g.to('.hero__art', {
    yPercent: -8,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });
});

export function initHero() {
  const globe = qs('[data-globe]');
  if (globe) globe.__fx = buildGlobeFx(globe);
  const bottle = qs('[data-bottle]');
  if (bottle) addSparkles(bottle);
  runLoader();
}
