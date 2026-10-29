// Solutions: flip cards (24).

import { hasFinePointer, motionEnabled } from './prefs.js';
import { qs, qsa } from './utils.js';

/* --------------------------------------------------------------------------
   24. Flip cards: click (or hover on desktop) to turn problem -> solution
   -------------------------------------------------------------------------- */

function initFlips() {
  const list = qs('.flips');
  if (!list) return;
  list.classList.add('is-enhanced');

  qsa('[data-flip]', list).forEach((card) => {
    const front = qs('.flip__front', card);
    const back = qs('.flip__back', card);
    const openBtn = qs('.flip__front .flip__btn', card);
    const backBtn = qs('.flip__back .flip__btn', card);

    function setFlipped(flipped, { focus = false } = {}) {
      card.classList.toggle('is-flipped', flipped);
      openBtn.setAttribute('aria-expanded', String(flipped));
      // Only the visible face is reachable by keyboard and screen readers.
      front.inert = flipped;
      back.inert = !flipped;
      if (focus) (flipped ? backBtn : openBtn).focus({ preventScroll: true });
    }

    // Hover flips on mouse devices (after a short intent delay) and flips back
    // when the pointer leaves, unless the card was flipped deliberately.
    let pinned = false;
    let hoverTimer = 0;
    let hoverFlippedAt = 0;

    setFlipped(false);
    openBtn.addEventListener('click', () => {
      window.clearTimeout(hoverTimer);
      pinned = true;
      setFlipped(true, { focus: true });
    });
    backBtn.addEventListener('click', () => {
      // A click that lands mid-flip right after a hover flip was aimed at the front.
      if (performance.now() - hoverFlippedAt < 700) return;
      pinned = false;
      setFlipped(false, { focus: true });
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && card.classList.contains('is-flipped')) {
        pinned = false;
        setFlipped(false, { focus: true });
      }
    });

    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse' || !hasFinePointer() || !motionEnabled()) return;
      hoverTimer = window.setTimeout(() => {
        if (card.classList.contains('is-flipped')) return;
        hoverFlippedAt = performance.now();
        setFlipped(true);
      }, 160);
    });
    card.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') return;
      window.clearTimeout(hoverTimer);
      if (!pinned && !card.contains(document.activeElement)) setFlipped(false);
    });
  });
}

export function initSolutions() {
  initFlips();
}
