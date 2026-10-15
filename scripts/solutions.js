// Solutions: flip cards (24) and the parking-lot vs EcoCommons slider (25).

import { hasFinePointer, motionEnabled } from './prefs.js';
import { clamp, qs, qsa } from './utils.js';

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

    setFlipped(false);
    openBtn.addEventListener('click', () => setFlipped(true, { focus: true }));
    backBtn.addEventListener('click', () => setFlipped(false, { focus: true }));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && card.classList.contains('is-flipped')) setFlipped(false, { focus: true });
    });

    // Hover flips on mouse devices; it flips back when the pointer leaves
    // unless the card was flipped deliberately with a click.
    let pinned = false;
    openBtn.addEventListener('click', () => (pinned = true));
    backBtn.addEventListener('click', () => (pinned = false));
    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && hasFinePointer() && motionEnabled()) setFlipped(true);
    });
    card.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && !pinned && card.contains(document.activeElement) === false) setFlipped(false);
    });
  });
}

/* --------------------------------------------------------------------------
   25. Before/after slider with a water-drop handle (pointer events)
   -------------------------------------------------------------------------- */

function initCompare() {
  const stage = qs('[data-compare]');
  if (!stage) return;
  const range = qs('.compare__range', stage);

  const setPos = (percent) => {
    const value = clamp(percent, 0, 100);
    stage.style.setProperty('--pos', `${value}%`);
    range.value = String(Math.round(value));
    range.setAttribute('aria-valuetext', `${Math.round(value)}% parking lot, ${100 - Math.round(value)}% EcoCommons`);
  };

  const fromEvent = (event) => {
    const rect = stage.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * 100;
  };

  let dragging = false;
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
    setPos(fromEvent(event));
  });
  stage.addEventListener('pointermove', (event) => {
    if (dragging) setPos(fromEvent(event));
  });
  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
    if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);
  stage.addEventListener('lostpointercapture', () => {
    dragging = false;
    stage.classList.remove('is-dragging');
  });

  // Keyboard and assistive tech drive the native range input.
  range.addEventListener('input', () => setPos(Number(range.value)));
  setPos(Number(range.value) || 50);
}

export function initSolutions() {
  initFlips();
  initCompare();
}
