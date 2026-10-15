// Explore Georgia: the interactive map (PRD "Interactive Georgia map spec").
//
// tools/render/map.js writes the static markup (inline SVG, six <button> drops
// and the list of stories), so the section reads fine without JavaScript. This
// module adds the behavior: tooltip + region tint, the dialog panel with prev /
// next, the camera zoom (SVG viewBox tween), filters, the rivers and list
// toggles, the progress tracker and "Water Explorer" badge, and the world view.

import confetti from 'canvas-confetti';
import regionsData from '../data/regions.json';
import sourcesData from '../data/sources.json';
import { gsap, lockScroll, registerMotion, ScrollTrigger, scrollToTarget } from './motion.js';
import { motionEnabled } from './prefs.js';
import { announce, clamp, createFocusTrap, observeVisibility, qs, qsa } from './utils.js';

// Optional photos and their credits (added by the photo pipeline). Missing files
// fall back to an illustrated placeholder.
const photoUrls = import.meta.glob('../assets/img/places/*.webp', { eager: true, query: '?url', import: 'default' });
const creditModules = import.meta.glob('../data/photo-credits.json', { eager: true, import: 'default' });
const photoCredits = Object.values(creditModules)[0] || [];

const regions = [...regionsData].sort((a, b) => a.order - b.order);
const byId = new Map(regions.map((r) => [r.id, r]));
const sources = new Map(sourcesData.map((s) => [s.id, s]));

// Pins whose true locations sit closer than this (in screen px) fan out on
// leader lines; as the camera zooms in and they separate, the offsets shrink.
const DECLUTTER_PX = 58;

const sheetQuery = window.matchMedia('(max-width: 767px)');
const overlayQuery = window.matchMedia('(min-width: 768px) and (max-width: 1199px)');
// Phones on their side are too short for a bottom sheet: the panel becomes a
// right-hand drawer instead (same query as the drawer rules in main.css).
const drawerQuery = window.matchMedia('(max-height: 500px) and (min-width: 568px) and (max-width: 1199px)');

/** How an open panel is shown: a bottom sheet, a side drawer, or inside the layout. */
function panelMode() {
  if (drawerQuery.matches) return 'drawer';
  if (sheetQuery.matches) return 'sheet';
  return 'inline';
}

let app;
let stage;
let svg;
let panel;
let tip;
let world;
let backdrop;
let panelHome;
let base = { x: 0, y: 0, w: 1000, h: 1148 };
const view = { ...base };
const stageSize = { w: 0, h: 0 };
const pins = new Map();
const drops = new Map();
const cards = new Map();
let zoomTween = null;
let activeId = null;
let hoverId = null;
let completed = false;
let trap = null;
let worldOpen = false;
const visited = new Set();

/* --------------------------------------------------------------------------
   Small helpers
   -------------------------------------------------------------------------- */

const esc = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const iconSvg = (name, cls = '') =>
  `<svg class="icon${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function statText(stat, value = stat.value) {
  const n = Number(value).toLocaleString('en-US', {
    minimumFractionDigits: stat.decimals || 0,
    maximumFractionDigits: stat.decimals || 0,
  });
  return `${stat.prefix || ''}${n}${stat.suffix || ''}`;
}

// Citations use the same numbers as the footer Sources list.
function cite(id) {
  const src = sources.get(id);
  const n = document.getElementById(`src-${id}`)?.dataset.n || '';
  const title = src ? `${src.publisher ? `${src.publisher}: ` : ''}${src.title}` : '';
  return `<sup><a class="cite" href="#src-${id}" data-src="${id}" aria-label="Source ${n}" title="${esc(title)}">${n}</a></sup>`;
}

// "[[source-id]]" becomes a citation and "*E. coli*" becomes italic.
const withCitations = (text) =>
  esc(text)
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/\[\[([\w-]+)\]\]/g, (_, id) => cite(id));

function photoFor(region) {
  const src = region.image?.src;
  if (!src) return null;
  const url = photoUrls[`../${src}`];
  if (!url) return null;
  const fileName = src.split('/').pop();
  const credit = photoCredits.find((c) => c.file === src || (c.file && c.file.split('/').pop() === fileName));
  return {
    url,
    alt: credit?.alt || region.image.alt,
    author: credit?.author || region.image.credit,
    license: credit?.license || region.image.license,
    href: credit?.sourceUrl || region.image.creditUrl,
  };
}

/* --------------------------------------------------------------------------
   Camera: SVG viewBox + screen-space pins
   -------------------------------------------------------------------------- */

function pinPoint(region) {
  return [(region.pin.x / 100) * base.w, (region.pin.y / 100) * base.h];
}

function layoutPins() {
  const { w: sw, h: sh } = stageSize;
  if (!sw) return;
  const k = sw / view.w;
  const points = new Map(
    regions.map((r) => {
      const [px, py] = pinPoint(r);
      return [r.id, [(px - view.x) * k, (py - view.y) * k]];
    }),
  );
  for (const r of regions) {
    const li = pins.get(r.id);
    const [x, y] = points.get(r.id);
    let dx = 0;
    let dy = 0;
    if (r.offset) {
      let nearest = Infinity;
      for (const [id, p] of points) if (id !== r.id) nearest = Math.min(nearest, Math.hypot(p[0] - x, p[1] - y));
      const f = clamp(1 - nearest / DECLUTTER_PX, 0, 1);
      dx = r.offset.dx * f;
      dy = r.offset.dy * f;
    }
    const len = Math.hypot(dx, dy);
    li.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    li.style.setProperty('--dx', `${dx.toFixed(1)}px`);
    li.style.setProperty('--dy', `${dy.toFixed(1)}px`);
    li.style.setProperty('--len', `${len.toFixed(1)}px`);
    li.style.setProperty('--ang', `${Math.atan2(dy, dx).toFixed(3)}rad`);
    li.classList.toggle('has-leader', len > 4);
    li.classList.toggle('is-out', x < -24 || y < -24 || x > sw + 24 || y > sh + 56);
  }
  if (hoverId) placeTip(hoverId);
}

function applyView() {
  svg.setAttribute('viewBox', `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${view.h.toFixed(2)}`);
  // Labels and strokes counter-scale so they stay the same size on screen.
  app.style.setProperty('--map-zoom', (base.w / view.w).toFixed(4));
  layoutPins();
}

// Where on the stage the open hotspot should sit, given where the panel goes.
function focusPoint() {
  const mode = panelMode();
  if (mode === 'drawer') return { fx: 0.28, fy: 0.5 };
  if (mode === 'sheet') return { fx: 0.5, fy: 0.3 };
  if (overlayQuery.matches) return { fx: 0.26, fy: 0.45 };
  return { fx: 0.5, fy: 0.45 };
}

function viewFor(region) {
  const z = region.zoom || 2.2;
  const w = base.w / z;
  const h = base.h / z;
  const [cx, cy] = pinPoint(region);
  const { fx, fy } = focusPoint();
  return {
    x: clamp(cx - w * fx, base.x - w * 0.3, base.x + base.w - w * 0.7),
    y: clamp(cy - h * fy, base.y - h * 0.3, base.y + base.h - h * 0.7),
    w,
    h,
  };
}

function zoomTo(target, duration = 1.1) {
  zoomTween?.kill();
  zoomTween = null;
  if (!motionEnabled() || duration === 0) {
    Object.assign(view, target);
    applyView();
    return;
  }
  zoomTween = gsap.to(view, { ...target, duration, ease: 'power3.inOut', onUpdate: applyView });
}

/* --------------------------------------------------------------------------
   Hover / focus: drop grows, region tints aqua, tooltip shows name + issue
   -------------------------------------------------------------------------- */

function refreshHot() {
  const hot = new Set();
  if (hoverId) hot.add(byId.get(hoverId).region);
  if (activeId) hot.add(byId.get(activeId).region);
  qsa('.map-region', svg).forEach((path) => path.classList.toggle('is-hot', hot.has(path.dataset.region)));
  for (const [id, li] of pins) li.classList.toggle('is-hot', id === hoverId);
}

function placeTip(id) {
  const drop = drops.get(id);
  if (!drop || !tip) return;
  const stageRect = stage.getBoundingClientRect();
  const rect = drop.getBoundingClientRect();
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  let x = rect.left + rect.width / 2 - stageRect.left - tipW / 2;
  let y = rect.top - stageRect.top - tipH - 10;
  const below = y < 4;
  if (below) y = rect.bottom - stageRect.top + 10;
  x = clamp(x, 4, stageRect.width - tipW - 4);
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  tip.classList.toggle('is-below', below);
}

function showTip(id) {
  const r = byId.get(id);
  hoverId = id;
  tip.innerHTML = `${iconSvg(r.icon)}<span class="map-tip__text"><strong>${esc(r.name)}</strong><span>${esc(r.issue)}</span></span>`;
  tip.hidden = false;
  placeTip(id);
  tip.classList.add('is-visible');
  refreshHot();
}

function hideTip(id) {
  if (id && hoverId !== id) return;
  hoverId = null;
  tip.classList.remove('is-visible');
  tip.hidden = true;
  refreshHot();
}

/* --------------------------------------------------------------------------
   Panel (aria-modal dialog)
   -------------------------------------------------------------------------- */

function panelHTML(region) {
  const index = regions.indexOf(region);
  const total = regions.length;
  const prev = regions[(index - 1 + total) % total];
  const next = regions[(index + 1) % total];
  const photo = photoFor(region);
  const src = sources.get(region.stat.source);
  const external = region.action.href.startsWith('http') ? ' target="_blank" rel="noopener"' : '';
  const credit = photo
    ? `Photo: ${photo.href ? `<a href="${esc(photo.href)}" target="_blank" rel="noopener">${esc(photo.author || 'Wikimedia Commons')}</a>` : esc(photo.author || '')}${photo.license ? `, ${esc(photo.license)}` : ''}`
    : '';
  const figure = photo
    ? `<figure class="map-panel__photo"><img src="${photo.url}" alt="${esc(photo.alt)}" width="960" height="640" decoding="async"><figcaption>${credit}</figcaption></figure>`
    : `<div class="map-panel__photo map-panel__photo--art" aria-hidden="true">${iconSvg(region.icon)}</div>`;

  return `<div class="map-panel__card on-light">
<span class="map-panel__grip" aria-hidden="true"></span>
<div class="map-panel__top">
<p class="label map-panel__issue">${iconSvg(region.icon)}<span>${esc(region.issue)}</span></p>
<button class="map-panel__close" type="button" data-close aria-label="Close details">${iconSvg('x')}</button>
</div>
${figure}
<h3 class="map-panel__title" id="map-panel-title" tabindex="-1">${esc(region.name)}</h3>
<p class="map-panel__headline">${esc(region.headline)}</p>
<div class="map-panel__stat">
<p class="map-panel__num"><span data-map-count aria-hidden="true">${esc(statText(region.stat))}</span><span class="visually-hidden">${esc(statText(region.stat))}</span></p>
<p class="map-panel__label">${withCitations(region.stat.label)}${cite(region.stat.source)}</p>
<a class="map-source" href="${esc(src.url)}" target="_blank" rel="noopener">Source: ${esc(src.publisher || src.title)}${iconSvg('external-link')}</a>
</div>
<p class="map-panel__story">${withCitations(region.story)}</p>
<p class="map-panel__done">${iconSvg('sprout')}<span><strong>What's being done:</strong> ${withCitations(region.done)}</span></p>
<p class="map-panel__why">${iconSvg('graduation-cap')}<span><strong>Why this matters to you:</strong> ${esc(region.whyYou)}</span></p>
<a class="btn btn--navy map-panel__action" href="${esc(region.action.href)}"${external}>${esc(region.action.label)}${iconSvg('arrow-right')}</a>
<nav class="map-panel__nav" aria-label="More hotspots">
<button class="map-panel__step" type="button" data-step="-1" aria-label="Previous hotspot: ${esc(prev.name)}">${iconSvg('chevron-left')}<span class="map-panel__step-name">${esc(prev.shortName)}</span><span class="map-panel__step-word">Previous</span></button>
<p class="map-panel__count">${index + 1} / ${total}</p>
<button class="map-panel__step" type="button" data-step="1" aria-label="Next hotspot: ${esc(next.name)}"><span class="map-panel__step-name">${esc(next.shortName)}</span><span class="map-panel__step-word">Next</span>${iconSvg('chevron-right')}</button>
</nav>
</div>`;
}

function countUp(region) {
  const el = qs('[data-map-count]', panel);
  const { stat } = region;
  if (!el) return;
  if (!motionEnabled() || stat.count === false) {
    el.textContent = statText(stat);
    return;
  }
  const state = { v: stat.countFrom ?? 0 };
  el.textContent = statText(stat, state.v);
  gsap.to(state, {
    v: stat.value,
    duration: 1.2,
    ease: 'power2.out',
    delay: 0.15,
    onUpdate: () => (el.textContent = statText(stat, stat.decimals ? state.v : Math.round(state.v))),
  });
}

function updateProgress() {
  const count = visited.size;
  const counter = qs('[data-progress-count]', app);
  if (counter) counter.textContent = String(count);
  qsa('.map-progress__drops li', app).forEach((li, i) => li.classList.toggle('is-filled', i < count));
  for (const [id, li] of pins) li.classList.toggle('is-visited', visited.has(id));
  if (count === regions.length && !completed) complete();
}

function open(id, { step = false } = {}) {
  const region = byId.get(id);
  if (!region) return;
  const wasOpen = Boolean(activeId);
  activeId = id;
  visited.add(id);
  hideTip();
  gsap.killTweensOf(backdrop); // a close that is still fading out must not win

  panel.innerHTML = panelHTML(region);
  panel.scrollTop = 0;
  const card = qs('.map-panel__card', panel);
  for (const [pid, li] of pins) li.classList.toggle('is-active', pid === id);
  refreshHot();

  if (!wasOpen) {
    panel.hidden = false;
    app.classList.add('is-open');
    const mode = panelMode();
    if (mode !== 'inline') {
      // Bring the map up under the nav so the zoomed hotspot shows beside the panel.
      scrollToTarget(stage, { immediate: true });
      // Sections are stacking contexts, so the fixed sheet or drawer lives on <body> while open.
      document.body.append(backdrop, panel);
      backdrop.hidden = false;
      lockScroll(true);
    }
    if (motionEnabled()) {
      const from = { sheet: { yPercent: 100 }, drawer: { xPercent: 100 }, inline: { xPercent: 14, opacity: 0 } }[mode];
      gsap.fromTo(card, from, { xPercent: 0, yPercent: 0, opacity: 1, duration: 0.55, ease: 'power3.out' });
      if (mode !== 'inline') gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.4 });
    }
    trap.activate(qs('#map-panel-title', panel));
  } else if (motionEnabled()) {
    gsap.fromTo(card.children, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.02, ease: 'power2.out' });
  }

  if (step) {
    // Keep keyboard focus on the arrow that was used and say where we landed.
    const again = qs(`[data-step="${step}"]`, panel);
    again?.focus({ preventScroll: true });
    announce(`${region.name}. ${region.headline}`);
  }

  if (motionEnabled()) zoomTo(viewFor(region));
  countUp(region);
  updateProgress();
}

function close({ restoreFocus = true } = {}) {
  if (!activeId) return;
  const id = activeId;
  activeId = null;
  trap.deactivate({ returnFocus: false });
  for (const li of pins.values()) li.classList.remove('is-active');
  refreshHot();
  app.classList.remove('is-open');
  const wasModal = !backdrop.hidden; // a sheet or drawer
  const finish = () => {
    if (activeId) return; // reopened while closing: the new panel stays
    panel.hidden = true;
    panel.innerHTML = '';
    backdrop.hidden = true;
    gsap.set(backdrop, { clearProps: 'all' });
    // Return a portaled sheet to its home in the map layout.
    if (panel.parentElement !== panelHome) panelHome.append(panel, backdrop);
  };
  if (wasModal) lockScroll(false);
  const card = qs('.map-panel__card', panel);
  if (motionEnabled() && card) {
    let to = { xPercent: 14, autoAlpha: 0 };
    if (wasModal) to = panelMode() === 'drawer' ? { xPercent: 100 } : { yPercent: 100 };
    gsap.to(card, { ...to, duration: 0.35, ease: 'power2.in', onComplete: finish });
    if (wasModal) gsap.to(backdrop, { autoAlpha: 0, duration: 0.3 });
  } else {
    finish();
  }
  zoomTo(base, 0.9);
  if (restoreFocus) drops.get(id)?.focus({ preventScroll: true });
}

function step(delta) {
  if (!activeId) return;
  const index = regions.findIndex((r) => r.id === activeId);
  const next = regions[(index + delta + regions.length) % regions.length];
  open(next.id, { step: String(delta) });
}

/* --------------------------------------------------------------------------
   Completion: droplet confetti + "Water Explorer" badge
   -------------------------------------------------------------------------- */

let dropShape = null;
function celebrate(originEl) {
  if (!motionEnabled()) return;
  try {
    dropShape ||= confetti.shapeFromPath({ path: 'M12 1C9 8 3 12.5 3 18a9 9 0 0 0 18 0c0-5.5-6-10-9-17Z' });
    const rect = originEl.getBoundingClientRect();
    const origin = {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    };
    const options = {
      shapes: [dropShape],
      colors: ['#8fd3f0', '#55b6da', '#d9ecfa', '#ffffff', '#b3a369'],
      scalar: 1.5,
      gravity: 0.9,
      ticks: 220,
      zIndex: 80,
      disableForReducedMotion: true,
    };
    confetti({ ...options, particleCount: 70, spread: 70, startVelocity: 38, angle: 60, origin });
    confetti({ ...options, particleCount: 70, spread: 70, startVelocity: 38, angle: 120, origin });
  } catch {
    /* confetti is decoration only */
  }
}

function complete() {
  completed = true;
  const badge = document.createElement('div');
  badge.className = 'map-badge';
  badge.setAttribute('data-badge', '');
  badge.innerHTML = `<span class="map-badge__seal" aria-hidden="true">${iconSvg('award')}</span>
<span class="map-badge__text"><span class="map-badge__title">Water Explorer</span><span class="map-badge__sub">All six explored</span></span>
<a class="btn btn--navy btn--sm" href="#act">Take Action${iconSvg('arrow-right')}</a>`;
  qs('.map-side', app).appendChild(badge);
  app.classList.add('is-complete');
  if (motionEnabled()) {
    gsap.fromTo(badge, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.7, ease: 'back.out(1.8)' });
  }
  celebrate(badge.offsetParent ? badge : stage);
  announce('All six hotspots explored. You earned the Water Explorer badge.');
}

/* --------------------------------------------------------------------------
   Filters, rivers, list view
   -------------------------------------------------------------------------- */

const FILTER_NAMES = { supply: 'water supply', quality: 'water quality', sanitation: 'sanitation' };

function applyFilter(next) {
  qsa('[data-filter]', app).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === next)));
  let shown = 0;
  for (const r of regions) {
    const match = next === 'all' || r.filters.includes(next);
    if (match) shown += 1;
    pins.get(r.id).classList.toggle('is-dim', !match);
    const card = cards.get(r.id);
    if (card) card.hidden = !match;
  }
  announce(
    next === 'all'
      ? `Showing all ${regions.length} hotspots.`
      : `Highlighting ${shown} of ${regions.length} hotspots about ${FILTER_NAMES[next]}.`,
  );
}

function setPressed(button, on) {
  button.setAttribute('aria-pressed', String(on));
}

/* --------------------------------------------------------------------------
   World view (stretch goal), loaded on demand
   -------------------------------------------------------------------------- */

async function openWorld() {
  if (worldOpen) return;
  if (activeId) close({ restoreFocus: false });
  worldOpen = true;
  app.classList.add('is-world');
  try {
    const { showWorld } = await import('./map-world.js');
    await showWorld({
      container: world,
      motion: motionEnabled(),
      onClose: () => {
        worldOpen = false;
        app.classList.remove('is-world');
        qs('[data-world-open]', app)?.focus({ preventScroll: true });
      },
    });
  } catch (error) {
    console.error('[map] world view failed to load', error);
    worldOpen = false;
    app.classList.remove('is-world');
  }
}

/* --------------------------------------------------------------------------
   Setup
   -------------------------------------------------------------------------- */

export function initMap() {
  app = qs('[data-map-app]');
  if (!app) return;
  stage = qs('[data-map-stage]', app);
  svg = qs('.map-svg', stage);
  panel = qs('[data-panel]', app);
  tip = qs('[data-tip]', app);
  world = qs('[data-world]', app);

  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  base = { x: vx, y: vy, w: vw, h: vh };
  Object.assign(view, base);

  panelHome = panel.parentElement;
  backdrop = document.createElement('div');
  backdrop.className = 'map-backdrop';
  backdrop.hidden = true;
  panelHome.appendChild(backdrop);

  qsa('.pin', stage).forEach((li) => {
    pins.set(li.dataset.id, li);
    drops.set(li.dataset.id, qs('.drop', li));
  });
  qsa('.map-story', app).forEach((card) => cards.set(card.dataset.id, card));

  trap = createFocusTrap(panel, { onEscape: () => close() });

  // Stage size drives pin positions and the label / stroke scale.
  const measure = () => {
    const rect = stage.getBoundingClientRect();
    stageSize.w = rect.width;
    stageSize.h = rect.height;
    if (rect.width) {
      app.style.setProperty('--map-unit', (base.w / rect.width).toFixed(4));
      app.style.setProperty('--stage-w', `${Math.round(rect.width)}px`);
      app.style.setProperty('--stage-h', `${Math.round(rect.height)}px`);
    }
    applyView();
  };
  new ResizeObserver(measure).observe(stage);
  measure();

  // Drops: click / Enter opens; hover and focus preview; arrows move between drops.
  for (const [id, drop] of drops) {
    drop.addEventListener('click', () => open(id));
    drop.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && showTip(id));
    drop.addEventListener('pointerleave', () => hideTip(id));
    drop.addEventListener('focus', () => showTip(id));
    drop.addEventListener('blur', () => hideTip(id));
  }
  qs('.map-pins', stage).addEventListener('keydown', (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
    const ids = regions.map((r) => r.id);
    const current = ids.indexOf(event.target.closest('.drop')?.dataset.hotspot);
    if (current === -1) return;
    event.preventDefault();
    let next = current + (keys[event.key] || 0);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = ids.length - 1;
    drops.get(ids[(next + ids.length) % ids.length]).focus();
  });

  // Panel controls (delegated; content is re-rendered per hotspot).
  panel.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
    const stepBtn = event.target.closest('[data-step]');
    if (stepBtn) step(Number(stepBtn.dataset.step));
    // In-page links (citations, actions) close the panel before the page scrolls.
    const link = event.target.closest('a[href^="#"]');
    if (link) close({ restoreFocus: false });
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    }
  });

  // A click anywhere outside the panel closes it (another drop switches instead).
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!activeId) return;
      if (panel.contains(event.target) || event.target.closest('.drop')) return;
      close({ restoreFocus: false });
    },
    true,
  );

  // Filters and toggles.
  qsa('[data-filter]', app).forEach((chip) => chip.addEventListener('click', () => applyFilter(chip.dataset.filter)));
  qs('[data-toggle="rivers"]', app)?.addEventListener('click', (event) => {
    const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    setPressed(event.currentTarget, on);
    app.classList.toggle('is-rivers-off', !on);
    announce(on ? 'Rivers shown.' : 'Rivers hidden.');
  });
  qs('[data-toggle="list"]', app)?.addEventListener('click', (event) => {
    const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    if (on) close({ restoreFocus: false });
    setPressed(event.currentTarget, on);
    app.classList.toggle('is-list', on);
    ScrollTrigger.refresh();
    announce(on ? 'Showing the six stories as a list.' : 'Showing the map.');
  });
  qs('[data-world-open]', app)?.addEventListener('click', openWorld);

  // "Zoom out to the world" links elsewhere on the page (Georgia Tech section):
  // the nav glides to #map, then the world view opens once the map is in view.
  let pendingWorld = false;
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-world-link]')) return;
    pendingWorld = true;
    window.setTimeout(() => {
      if (pendingWorld) {
        pendingWorld = false;
        openWorld();
      }
    }, 2600);
  });
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && pendingWorld) {
        pendingWorld = false;
        window.setTimeout(openWorld, 250);
      }
    },
    { threshold: 0.45 },
  ).observe(stage);

  // Pause the idle loops (pulsing drops, shimmering rivers) when off-screen.
  observeVisibility(app, (visible) => app.classList.toggle('is-offscreen', !visible), '100px');

  // Switching between sheet, drawer and inline while open (resize, rotation):
  // close, which also releases the scroll lock.
  for (const query of [sheetQuery, drawerQuery]) {
    query.addEventListener('change', () => {
      if (activeId) close({ restoreFocus: false });
    });
  }
}

/* --------------------------------------------------------------------------
   19. Enter: outline draws, rivers flow in, six drops fall and ripple
   -------------------------------------------------------------------------- */

let entered = false; // the intro plays once; it never replays after the map was seen

registerMotion('map-enter', ({ enabled }) => {
  if (!app) return;
  if (!enabled) {
    // Reduced motion: no camera moves; snap back to the full state view.
    zoomTween?.kill();
    zoomTween = null;
    Object.assign(view, base);
    applyView();
    const stop = observeVisibility(stage, (visible) => {
      if (visible) entered = true;
    });
    return stop;
  }
  if (entered) return;
  // A rebuild (Motion switch) reverts this context after cleanup runs, which can
  // replay callbacks once more; `alive` keeps them from touching the DOM.
  let alive = true;
  const q = (sel) => qsa(sel, svg);
  const dropEls = regions.map((r) => drops.get(r.id));
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });
  tl.fromTo(q('.map-outline'), { strokeDasharray: 1000, strokeDashoffset: 1000 }, {
    strokeDashoffset: 0,
    duration: 1.2,
    ease: 'power2.inOut',
    clearProps: 'strokeDasharray,strokeDashoffset',
  }, 0)
    .from(q('.map-regions, .map-land-shadow, .map-counties, .map-region-lines'), { opacity: 0, duration: 0.8 }, 0.25)
    .fromTo(q('.map-river'), { strokeDasharray: 1000, strokeDashoffset: 1000 }, {
      strokeDashoffset: 0,
      duration: 1.1,
      ease: 'power1.inOut',
      stagger: 0.15,
      clearProps: 'strokeDasharray,strokeDashoffset',
    }, 0.55)
    .from(q('.map-lakes, .map-rivers-minor, .map-neighbors'), { opacity: 0, duration: 0.7 }, 0.7)
    .from(q('.map-labels, .map-scale'), { opacity: 0, duration: 0.6 }, 0.95)
    .from(q('.map-shimmer'), { opacity: 0, duration: 0.6 }, 1.7)
    .from(dropEls, {
      y: -120,
      opacity: 0,
      duration: 0.8,
      ease: 'bounce.out',
      stagger: {
        each: 0.09,
        onComplete() {
          if (!alive) return;
          const li = this.targets()[0].closest('.pin');
          li.classList.remove('is-landed');
          void li.offsetWidth;
          li.classList.add('is-landed');
        },
      },
    }, 1.0);

  ScrollTrigger.create({
    trigger: stage,
    start: 'top 78%',
    once: true,
    onEnter: () => {
      if (!alive) return;
      entered = true;
      tl.play();
    },
  });

  // Keyboard users who tab in early see everything immediately. (Pointer focus
  // must not jump the drops mid-fall, or a tap would land on empty map.)
  const finish = (event) => {
    if (alive && tl.progress() < 1 && event.target.matches(':focus-visible')) tl.progress(1);
  };
  app.addEventListener('focusin', finish);
  // The context revert (which runs right after this) restores every from-state.
  return () => {
    alive = false;
    app.removeEventListener('focusin', finish);
    qsa('.pin.is-landed', stage).forEach((li) => li.classList.remove('is-landed'));
  };
});
