// Motion preference: the single source of truth for "should things move?"
// Starts from the system "reduce motion" setting; the nav's Motion switch
// overrides it and the choice is remembered for the next visit.

const KEY = 'wfw-motion';
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const listeners = new Set();

function readSaved() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let enabled = (() => {
  const saved = readSaved();
  return saved ? saved === 'on' : !reduceQuery.matches;
})();

document.documentElement.classList.toggle('motion-off', !enabled);

/** True when animations are allowed. */
export function motionEnabled() {
  return enabled;
}

/** Turn motion on or off for the whole site. */
export function setMotion(on, { persist = true } = {}) {
  const next = Boolean(on);
  if (persist) {
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      /* storage unavailable: the choice lasts for this page view */
    }
  }
  if (next === enabled) return;
  enabled = next;
  document.documentElement.classList.toggle('motion-off', !enabled);
  listeners.forEach((fn) => fn(enabled));
}

/** Subscribe to changes; returns an unsubscribe function. */
export function onMotionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

reduceQuery.addEventListener('change', (event) => {
  // Follow the system setting unless the visitor chose explicitly.
  if (!readSaved()) setMotion(!event.matches, { persist: false });
});

/** Desktop-style pointer (mouse or trackpad) that can hover. */
export function hasFinePointer() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
