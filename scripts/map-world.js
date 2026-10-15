// "Zoom out to the world" (PRD stretch goal), loaded only when asked for.
// The Georgia map hands off to a globe that spins out from Georgia and drops
// pins on Engineers Without Borders at Georgia Tech projects in Nepal and
// Malawi, linking Georgia to SDG 6 worldwide.

import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import georgiaOutline from '../assets/map/georgia-outline.json';
import { gsap } from './motion.js';

const W = 1000;
const H = 1148;
const CENTER = [W / 2, H / 2 - 30];
const RADIUS = 410;
const ATLANTA = [-84.39, 33.75];
const START = { lon: -83.5, lat: 32.7, scale: 2600 };
const END = { lon: 4, lat: 16, scale: RADIUS };

const PROJECTS = [
  {
    id: 'nepal',
    country: 'Nepal',
    at: [84.12, 28.39],
    title: 'Nepal: water for Chisopani Bhirke',
    text: 'EWB-GT students are designing a water supply for a village of about 1,000 people.',
    href: 'https://ce.gatech.edu/news/2025/11/georgia-tech-students-work-bring-clean-water-nepal',
    source: 'me-nepal-2025',
  },
  {
    id: 'malawi',
    country: 'Malawi',
    at: [34.3, -13.25],
    title: 'Malawi: "Sanitation Solutions"',
    text: "EWB-GT's GT Malawi team placed third in Georgia's 2024 student water design contest.",
    href: 'https://ce.gatech.edu/news/2024/04/cee-students-continue-dominance-2024-georgia-association-water-professionals',
    source: 'cee-gawp-2024',
  },
];

let ui = null;

// Numbered citation matching the footer Sources list.
function cite(id) {
  const n = document.getElementById(`src-${id}`)?.dataset.n;
  return n ? `<sup><a class="cite" href="#src-${id}" data-src="${id}" aria-label="Source ${n}">${n}</a></sup>` : '';
}

function build(container) {
  const countries = feature(world, world.objects.countries).features;
  const land = { type: 'FeatureCollection', features: countries };
  const highlights = {
    type: 'FeatureCollection',
    features: countries.filter((c) => PROJECTS.some((p) => p.country === c.properties.name)),
  };
  const georgia = { type: 'Feature', geometry: georgiaOutline };
  const arcs = PROJECTS.map((p) => {
    const interpolate = geoInterpolate(ATLANTA, p.at);
    return { type: 'LineString', coordinates: Array.from({ length: 65 }, (_, i) => interpolate(i / 64)) };
  });

  container.innerHTML = `<div class="map-world__inner" role="region" aria-label="World view: Georgia Tech student water projects">
<svg class="map-world__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Globe showing Georgia, Nepal and Malawi, with arcs from Atlanta to each project">
<defs><radialGradient id="globe-shade" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#5b93d2"/><stop offset="1" stop-color="#1d4a87"/></radialGradient></defs>
<path class="map-world__sphere"/><path class="map-world__grid"/><path class="map-world__land"/><path class="map-world__hi"/><path class="map-world__ga"/>
<g class="map-world__arcs">${arcs.map(() => '<path class="map-world__arc" pathLength="1"/>').join('')}</g>
<g class="map-world__pins">${PROJECTS.map(
    (p) =>
      `<g class="map-world__pin"><g class="map-world__pin-body"><path d="M0-30C-4-21-11-15-11-8a11 11 0 0 0 22 0C11-15 4-21 0-30Z"/><circle r="3.5" cy="-8"/><text x="16" y="-6">${p.country}</text></g></g>`,
  ).join('')}<g class="map-world__home"><circle r="9"/><circle r="4"/><text x="15" y="6">Georgia Tech</text></g></g>
</svg>
<ul class="map-world__cards" role="list">${PROJECTS.map(
    (p) =>
      `<li class="map-world__card"><strong><a href="${p.href}" target="_blank" rel="noopener">${p.title}</a></strong>` +
      `<span>${p.text}${cite(p.source)}</span></li>`,
  ).join('')}</ul>
<button class="btn btn--primary btn--sm map-world__back" type="button"><svg class="icon" aria-hidden="true"><use href="#i-map-pin"></use></svg>Back to Georgia</button>
</div>`;

  const svg = container.querySelector('svg');
  const q = (sel) => svg.querySelector(sel);
  const projection = geoOrthographic().translate(CENTER).clipAngle(90).precision(0.6);
  const path = geoPath(projection);
  const graticule = geoGraticule10();
  const arcEls = [...svg.querySelectorAll('.map-world__arc')];
  const pinEls = [...svg.querySelectorAll('.map-world__pin')];
  const home = q('.map-world__home');

  function render({ lon, lat, scale }) {
    projection.rotate([-lon, -lat]).scale(scale);
    q('.map-world__sphere').setAttribute('d', path({ type: 'Sphere' }) || '');
    q('.map-world__grid').setAttribute('d', path(graticule) || '');
    q('.map-world__land').setAttribute('d', path(land) || '');
    q('.map-world__hi').setAttribute('d', path(highlights) || '');
    q('.map-world__ga').setAttribute('d', path(georgia) || '');
    arcs.forEach((arc, i) => arcEls[i].setAttribute('d', path(arc) || ''));
    const center = [lon, lat];
    PROJECTS.forEach((p, i) => {
      const visible = geoDistance(p.at, center) < Math.PI / 2 - 0.05;
      const [x, y] = projection(p.at);
      pinEls[i].setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      pinEls[i].style.visibility = visible ? 'visible' : 'hidden';
    });
    const [hx, hy] = projection(ATLANTA);
    home.setAttribute('transform', `translate(${hx.toFixed(1)} ${hy.toFixed(1)})`);
    home.style.visibility = geoDistance(ATLANTA, center) < Math.PI / 2 ? 'visible' : 'hidden';
  }

  return {
    root: container.firstElementChild,
    render,
    arcEls,
    pinEls: [...svg.querySelectorAll('.map-world__pin-body')],
    cards: [...container.querySelectorAll('.map-world__card')],
    back: container.querySelector('.map-world__back'),
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Open the world view inside `container` (the map stage). Resolves once the
 * opening animation has started; `onClose` runs after the view is dismissed.
 */
export async function showWorld({ container, motion, onClose }) {
  ui ||= build(container);
  container.hidden = false;
  const state = { t: 0 };
  const frame = () => {
    const t = state.t;
    // Zoom out in log space for a natural "pull back", spin as we go.
    const eased = 1 - Math.pow(1 - t, 3);
    ui.render({
      lon: lerp(START.lon, END.lon, eased),
      lat: lerp(START.lat, END.lat, eased),
      scale: Math.exp(lerp(Math.log(START.scale), Math.log(END.scale), Math.min(1, t * 1.25))),
    });
  };

  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    document.removeEventListener('keydown', onKey);
    const done = () => {
      container.hidden = true;
      gsap.set([ui.root, ...ui.cards, ...ui.pinEls, ...ui.arcEls, ui.back], { clearProps: 'all' });
      onClose?.();
    };
    if (!motion) {
      done();
      return;
    }
    gsap
      .timeline({ onComplete: done })
      .to([...ui.cards, ui.back], { autoAlpha: 0, y: 12, duration: 0.25 })
      .to(state, { t: 0, duration: 1.4, ease: 'power2.inOut', onUpdate: frame }, 0.1)
      .to(ui.root, { autoAlpha: 0, duration: 0.45 }, 1.15);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  ui.back.onclick = close;
  document.addEventListener('keydown', onKey);

  if (!motion) {
    state.t = 1;
    frame();
    ui.arcEls.forEach((el) => el.style.setProperty('stroke-dashoffset', '0'));
    ui.back.focus({ preventScroll: true });
    return;
  }

  gsap.set(ui.root, { opacity: 0 });
  gsap.set([...ui.cards, ui.back], { opacity: 0, y: 14 });
  gsap.set(ui.pinEls, { opacity: 0 });
  gsap.set(ui.arcEls, { strokeDashoffset: 1 });
  frame();
  gsap
    .timeline({ onComplete: () => !closing && ui.back.focus({ preventScroll: true }) })
    .to(ui.root, { opacity: 1, duration: 0.5 })
    .to(state, { t: 1, duration: 2.4, ease: 'power1.inOut', onUpdate: frame }, 0.15)
    .to(ui.arcEls, { strokeDashoffset: 0, duration: 1, stagger: 0.2, ease: 'power2.inOut' }, 2.3)
    .fromTo(ui.pinEls, { opacity: 0, y: -40 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.18, ease: 'bounce.out' }, 2.9)
    .to([...ui.cards, ui.back], { opacity: 1, y: 0, duration: 0.5, stagger: 0.1 }, 3.1);
}
