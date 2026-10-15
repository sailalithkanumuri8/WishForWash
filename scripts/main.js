// Entry point: wire up each section, then start the motion layer.
// Every initializer is isolated so one failure never blanks the page; the HTML
// is fully readable on its own.

import 'lenis/dist/lenis.css';
import { ScrollTrigger, scrollToTarget, startMotion } from './motion.js';
import './effects.js';
import './issue.js';
import { initNav } from './nav.js';
import { initHero } from './hero.js';
import { initMap } from './map.js';
import { initWatch } from './watch.js';
import './campus.js';
import { initSolutions } from './solutions.js';
import { initAct } from './pledge-quiz.js';
import { navHeight } from './utils.js';

/** Citations open the collapsed Sources list and glide to the right entry. */
function initSources() {
  const details = document.getElementById('sources');
  if (!details) return;
  details.addEventListener('toggle', () => ScrollTrigger.refresh());

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#src-"]');
    if (!link) return;
    const item = document.getElementById(link.getAttribute('href').slice(1));
    if (!item) return;
    event.preventDefault();
    if (!details.open) {
      details.open = true;
      ScrollTrigger.refresh();
    }
    item.classList.remove('is-highlighted');
    void item.offsetWidth; // restart the highlight animation
    item.classList.add('is-highlighted');
    scrollToTarget(item, {
      offset: navHeight() + 24,
      onComplete: () => {
        item.setAttribute('tabindex', '-1');
        item.focus({ preventScroll: true });
      },
    });
  });
}

const initializers = [
  ['nav', initNav],
  ['sources', initSources],
  ['hero', initHero],
  ['map', initMap],
  ['watch', initWatch],
  ['solutions', initSolutions],
  ['act', initAct],
];

for (const [name, init] of initializers) {
  try {
    init();
  } catch (error) {
    console.error(`[init] ${name} failed`, error);
  }
}

startMotion();
