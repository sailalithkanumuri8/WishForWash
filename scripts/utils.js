// Small shared helpers.

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Current height of the fixed nav, used as the scroll offset for anchors. */
export function navHeight() {
  const header = document.getElementById('site-header');
  return header ? header.getBoundingClientRect().height : 0;
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(el) {
  if (el.closest('[inert], [hidden]')) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return el.getClientRects().length > 0;
}

/** Visible, focusable descendants of an element, in DOM order. */
export function focusableIn(root) {
  return qsa(FOCUSABLE, root).filter(isVisible);
}

/**
 * Keep keyboard focus inside `container` while active (dialogs, menus).
 * Escape calls `onEscape`. Focus returns to the opener on deactivate.
 */
export function createFocusTrap(container, { onEscape } = {}) {
  let returnTo = null;
  let active = false;

  function onKeydown(event) {
    if (event.key === 'Escape') {
      if (onEscape) {
        event.preventDefault();
        onEscape(event);
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(container);
    if (items.length === 0) {
      event.preventDefault();
      container.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !container.contains(current))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (current === last || !container.contains(current))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  return {
    get active() {
      return active;
    },
    activate(initialFocus) {
      if (active) return;
      active = true;
      returnTo = document.activeElement;
      document.addEventListener('keydown', onKeydown, true);
      const target = initialFocus || focusableIn(container)[0] || container;
      target.focus({ preventScroll: true });
    },
    deactivate({ returnFocus = true } = {}) {
      if (!active) return;
      active = false;
      document.removeEventListener('keydown', onKeydown, true);
      if (returnFocus && returnTo && typeof returnTo.focus === 'function' && document.contains(returnTo)) {
        returnTo.focus({ preventScroll: true });
      }
      returnTo = null;
    },
  };
}

/** Run `fn` once the element first comes near the viewport. */
export function whenNear(el, fn, rootMargin = '200px') {
  if (!('IntersectionObserver' in window)) {
    fn();
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    { rootMargin },
  );
  io.observe(el);
  return () => io.disconnect();
}

/** Track whether an element is on screen (used to pause animations). */
export function observeVisibility(el, onChange, rootMargin = '0px') {
  if (!('IntersectionObserver' in window)) {
    onChange(true);
    return () => {};
  }
  const io = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    onChange(entry.isIntersecting);
  }, { rootMargin });
  io.observe(el);
  return () => io.disconnect();
}

/** Announce a message to screen readers through a shared live region. */
let liveRegion;
export function announce(message) {
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.className = 'visually-hidden';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = '';
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 60);
}
